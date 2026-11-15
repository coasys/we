//! E3c-4: the query hub — claims, refcounts, tickets, synchronous delivery
//! (E3c-design 2.2–2.4, row 8.2 E3c-4; TS reference `subscriptionPool.ts`).
//! E3c-5a adds the asynchronous half: `QuerySink` deliveries that land on
//! later frames, `Failed` answers, dead-ticket drops, the pass budget's
//! leftover work, and the quiet a loading source must keep.
//!
//! The pull path is gone: a site `claim`s a compiled request per pass,
//! `commit` diffs the pass's claims against the held set and calls
//! `source.open`/`source.close` at refcount edges, and a synchronous source
//! answers inside `open` by delivering on the `QuerySink` — which the
//! frame's `commit → drain` applies in the same pass, so an offline tree
//! settles in one frame.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value as Json};
use we_expr::{HandleTable, Value};
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, BundleTemplate, Compiled, DatasetSel, Inbox, LocalState, NodeId, PartSource,
    QueryEvent, QueryHub, QueryIr, QueryRequest, QuerySink, QuerySource, ResolvedChild,
    ResolvedNode, Runtime, SchemaNode, SiteId, SiteSlot, StaticHost, StoreBag, SubTicket,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
}

/// A `QuerySource` that records every `open`/`close` and answers
/// synchronously — unless the entity is in `hold`, in which case its ticket
/// stays open until [`Counting::deliver`] pushes rows through the saved
/// sink (the E3c-5a async shape, used here to stage provisional tests).
#[derive(Default)]
struct Counting {
    /// `(ticket, key)` of every `open`, in order.
    opens: Mutex<Vec<(SubTicket, String)>>,
    closes: Mutex<Vec<SubTicket>>,
    live: Mutex<HashMap<SubTicket, (QueryRequest, QuerySink)>>,
    /// Entity names `open` should not answer yet.
    hold: Mutex<Vec<Arc<str>>>,
    /// Entity names `open` answers with a `Failed` instead of rows.
    fail: Mutex<Vec<Arc<str>>>,
}

impl Counting {
    fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Entities `open` parks instead of answering.
    fn holding(&self, entity: &str) -> Arc<Self> {
        let me = Arc::new(Self::default());
        me.hold.lock().unwrap().push(entity.into());
        me
    }

    /// Entities `open` answers with `Failed("<entity> failed")`.
    fn failing(&self, entity: &str) -> Arc<Self> {
        let me = Arc::new(Self::default());
        me.fail.lock().unwrap().push(entity.into());
        me
    }

    /// The keys `open` was called with for requests naming `entity`.
    fn opens_for(&self, entity: &str) -> Vec<String> {
        self.opens
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, key)| key.contains(&format!("\"e\":[\"{entity}\"]")))
            .map(|(_, key)| key.clone())
            .collect()
    }

    fn open_count(&self) -> usize {
        self.opens.lock().unwrap().len()
    }

    fn close_count(&self) -> usize {
        self.closes.lock().unwrap().len()
    }

    /// Push `rows` to every live ticket whose request names `entity` — the
    /// async producer the inbox exists for.
    fn deliver(&self, entity: &str, rows: Vec<Value>) {
        for (_, (request, sink)) in self.live.lock().unwrap().iter() {
            if request.classes.iter().any(|c| c.as_ref() == entity) {
                sink.deliver(QueryEvent::Rows(Arc::new(rows.clone())));
            }
        }
    }

    /// Push a failure to every live ticket naming `entity`.
    fn deliver_failed(&self, entity: &str, error: Value) {
        for (_, (request, sink)) in self.live.lock().unwrap().iter() {
            if request.classes.iter().any(|c| c.as_ref() == entity) {
                sink.deliver(QueryEvent::Failed(error.clone()));
            }
        }
    }
}

impl QuerySource for Counting {
    fn open(
        &self,
        ticket: SubTicket,
        request: &QueryRequest,
        handles: &we_expr::HandleTable,
        sink: QuerySink,
    ) {
        self.opens
            .lock()
            .unwrap()
            .push((ticket, request.key(None, handles).as_str().to_string()));
        let held = request
            .classes
            .iter()
            .any(|c| self.hold.lock().unwrap().iter().any(|h| h == c));
        let failed = request
            .classes
            .iter()
            .any(|c| self.fail.lock().unwrap().iter().any(|f| f == c));
        self.live
            .lock()
            .unwrap()
            .insert(ticket, (request.clone(), sink.clone()));
        let entity = request.classes.first().cloned().unwrap_or("?".into());
        if held {
            return;
        }
        if failed {
            sink.deliver(QueryEvent::Failed(Value::from(
                format!("{entity} failed").as_str(),
            )));
            return;
        }
        sink.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
            &json!({ "id": format!("{entity}-1"), "kind": "Task" }),
        )])));
    }

    fn close(&self, ticket: SubTicket) {
        self.live.lock().unwrap().remove(&ticket);
        self.closes.lock().unwrap().push(ticket);
    }
}

fn rig(node: Json, source: Arc<Counting>) -> (Runtime, StaticHost, ScreenState, Arc<StoreBag>) {
    let bag = Arc::new(StoreBag::new());
    let rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new())
        .with_sources(Some(source), Arc::new(we_template::NoParts));
    (rt, StaticHost::new(bag.clone()), screen("/"), bag)
}

fn set_flag(bag: &StoreBag, name: &str, on: bool) {
    let root = bag
        .root("flags")
        .and_then(|v| v.to_json().as_object().cloned())
        .unwrap_or_default();
    let mut root = root;
    root.insert(name.to_string(), Json::Bool(on));
    bag.set_root("flags", Value::from_json(&Json::Object(root)));
}

#[test]
fn unmount_releases() {
    // A query under an `$if` branch: the pass that stops reaching the site
    // releases its claim at that pass's `commit` — `opened()` drops to 0
    // and the source hears exactly one `close`.
    let node = json!({ "type": "Column", "children": [
        { "type": "$if", "props": { "condition": { "$": "flags.a" },
            "then": { "type": "Row",
                "$queries": { "items": { "entity": "Task" } }, "children": [] } } }
    ]});
    let source = Counting::new();
    let (mut rt, mut host, screen, bag) = rig(node, source.clone());
    set_flag(&bag, "a", true);
    rt.frame(&mut host, &screen);
    assert_eq!(rt.hub().opened(), 1, "the held query is open at the source");
    assert_eq!(source.open_count(), 1);

    set_flag(&bag, "a", false);
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.hub().opened(),
        0,
        "unmount released the only claim on the key"
    );
    assert_eq!(
        source.close_count(),
        1,
        "the 1→0 key closed exactly once: {:?}",
        source.closes.lock().unwrap()
    );
}

#[test]
fn session_drop_closes_tickets() {
    // `Drop` on the hub closes every open ticket — a destroyed session
    // cannot leak subscriptions at the source.
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": "Task" } }, "children": [] });
    let source = Counting::new();
    let (mut rt, mut host, screen, _bag) = rig(node, source.clone());
    rt.frame(&mut host, &screen);
    assert_eq!(source.open_count(), 1);
    drop(rt);
    assert_eq!(
        source.close_count(),
        1,
        "dropping the runtime closed the open ticket"
    );
}

#[test]
fn two_sites_one_subscription() {
    // A named `$queries` site and an inline `{"$query"}` prop site asking
    // the identical request share one subscription: one `open`, the key
    // stays open while either site holds it, and the last release closes.
    let node = json!({ "type": "Column", "children": [
        { "type": "$if", "props": { "condition": { "$": "flags.a" },
            "then": { "type": "Row",
                "$queries": { "items": { "entity": "Task" } }, "children": [] } } },
        { "type": "$if", "props": { "condition": { "$": "flags.b" },
            "then": { "type": "List",
                "props": { "rows": { "$query": { "entity": "Task" } } } } } }
    ]});
    let source = Counting::new();
    let (mut rt, mut host, screen, bag) = rig(node, source.clone());
    set_flag(&bag, "a", true);
    set_flag(&bag, "b", true);
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.hub().opened(),
        1,
        "two sites on one request open one subscription"
    );
    assert_eq!(source.open_count(), 1);
    assert_eq!(rt.hub().held(), 1, "one key is held");

    // Release the named site — the inline site still holds the key.
    set_flag(&bag, "a", false);
    rt.frame(&mut host, &screen);
    assert_eq!(rt.hub().opened(), 1, "the surviving site keeps the ticket");
    assert_eq!(source.close_count(), 0, "no close while a holder remains");

    // Release the inline site — the last holder drops the ticket.
    set_flag(&bag, "b", false);
    rt.frame(&mut host, &screen);
    assert_eq!(rt.hub().opened(), 0);
    assert_eq!(source.close_count(), 1, "the last release closes");
}

#[test]
fn narrowed_query_never_sends_wide() {
    // `cards` reads `first(local.board).gathers`: while the board is
    // loading the compile is `Provisional` and no `Card` request reaches
    // the source — not once. Once the board lands the narrow request —
    // and only the narrow request — opens (Lal's B1 case 2).
    let node = json!({ "type": "Column",
        "$queries": {
            "cards": { "entity": "Card",
                "scope": { "anchorId": { "$": "first(local.board).gathers" } } },
            "board": { "entity": "Board" }
        },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.cards.length" } } }]
    });
    let source = Counting::new().holding("Board");
    let (mut rt, mut host, screen, _bag) = rig(node, source.clone());
    rt.frame(&mut host, &screen);
    assert_eq!(source.opens_for("Board").len(), 1, "board was asked");
    assert!(
        source.opens_for("Card").is_empty(),
        "cards read an unloaded slot — a wide request must never open: {:?}",
        source.opens_for("Card")
    );

    // The board answers; the next frame compiles the narrow request.
    source.deliver(
        "Board",
        vec![Value::from_json(&json!({ "id": "b1", "gathers": "g1" }))],
    );
    rt.frame(&mut host, &screen);
    let cards = source.opens_for("Card");
    assert_eq!(
        cards.len(),
        1,
        "exactly the narrow request opened: {cards:?}"
    );
    assert!(
        cards[0].contains("\"anchorId\":\"g1\""),
        "the opened request carries the resolved scope: {}",
        cards[0]
    );
}

#[test]
fn per_row_sites_share_a_key_and_a_row_scope_splits_it() {
    // Each `$each` row's node has its own `NodeId` — so its `$queries`
    // sites are distinct claims. Two rows asking the identical request
    // share one subscription (holders 2, one `open`); a request that reads
    // the row's own `item` compiles to different keys per row and opens
    // once per row.
    let node = json!({ "type": "Column", "children": [
        { "type": "$each", "props": {
            "items": [{ "id": "a" }, { "id": "b" }], "as": "item" },
          "children": [{ "type": "Row",
            "$queries": { "rowq": { "entity": "Task" } }, "children": [] }] }
    ]});
    let source = Counting::new();
    let (mut rt, mut host, screen, _bag) = rig(node, source.clone());
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.hub().opened(),
        1,
        "two per-row sites on one request share one ticket"
    );
    let cells = rt.hub().cells();
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].holders, 2, "both rows hold the shared key");

    // A request that reads the row is a different question per row.
    let node = json!({ "type": "Column", "children": [
        { "type": "$each", "props": {
            "items": [{ "id": "a" }, { "id": "b" }], "as": "item" },
          "children": [{ "type": "Row",
            "$queries": { "rowq": { "entity": "Task",
                "scope": { "anchorId": { "$": "item.id" } } } }, "children": [] }] }
    ]});
    let source = Counting::new();
    let (mut rt, mut host, screen, _bag) = rig(node, source.clone());
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.hub().opened(),
        2,
        "row-scoped requests are distinct keys — one subscription each"
    );
}

#[test]
fn repeated_part_sites_are_distinct_and_share() {
    // A `$part` mounted twice gets a distinct call-site `NodeId` per mount
    // (`part:{id}@{site}`), so its `$queries` sites are distinct claims —
    // on one request, one shared ticket with two holders.
    struct Parts;
    impl PartSource for Parts {
        fn part(&self, id: &str) -> Option<Arc<SchemaNode>> {
            (id == "widget").then(|| {
                Arc::new(schema(json!({ "type": "Row",
                    "$queries": { "items": { "entity": "Task" } }, "children": [] })))
            })
        }
    }
    let node = json!({ "type": "Column", "children": [
        { "type": "$part", "props": { "id": "widget" } },
        { "type": "$part", "props": { "id": "widget" } }
    ]});
    let source = Counting::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new())
        .with_sources(Some(source.clone()), Arc::new(Parts));
    let mut host = StaticHost::new(bag);
    let screen = screen("/");
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.hub().opened(),
        1,
        "two mounts of one part share the subscription"
    );
    let cells = rt.hub().cells();
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].holders, 2, "each part mount holds the key");
}

#[test]
fn two_templates_share_a_cell() {
    // The same query declared by the app chrome and the space template:
    // distinct sites (the NodeId names its mount), one shared subscription.
    let app: BundleTemplate = serde_json::from_value(json!({
        "id": "app", "meta": {}, "type": "Column",
        "$queries": { "items": { "entity": "Task" } } }))
    .unwrap();
    let template: BundleTemplate = serde_json::from_value(json!({
        "id": "tpl", "meta": {}, "type": "Column",
        "$queries": { "items": { "entity": "Task" } } }))
    .unwrap();
    let spec = AppSpec {
        app: Some(app),
        template: Some(template),
        pages: Vec::new(),
        boot: None,
        bundle: "test-bundle".into(),
    };
    let source = Counting::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::app(spec, bag.clone(), LocalState::new())
        .with_sources(Some(source.clone()), Arc::new(we_template::NoParts));
    let mut host = StaticHost::new(bag);
    let screen = screen("/app/anything");
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.hub().opened(),
        1,
        "identical requests across templates share a cell"
    );
    let cells = rt.hub().cells();
    assert_eq!(cells.len(), 1, "one key held");
    assert_eq!(cells[0].holders, 2, "both templates' sites hold it");
}

#[test]
fn a_synchronous_source_settles_a_dependent_chain_in_one_frame() {
    // `commit → drain` inside the pass loop: `q1` reads `q2`'s rows, `q2`
    // reads `q3`'s — a sync source answers inside `open`, so the chain
    // climbs within the one frame rather than one level per frame.
    let node = json!({ "type": "Column",
        "$queries": {
            "q1": { "entity": { "$": "first(local.q2).kind" } },
            "q2": { "entity": { "$": "first(local.q3).kind" } },
            "q3": { "entity": "Task" }
        },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.q1.length" } } }]
    });
    let source = Counting::new();
    let (mut rt, mut host, screen, _bag) = rig(node, source.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(1.0))),
        "the whole chain resolved within the first frame: {text:?}"
    );
    assert_eq!(
        rt.stats().resolves,
        1,
        "one resolve — commit→drain did the settling inside it"
    );
}

#[test]
fn subscribe_false_is_one_shot_and_stays_held() {
    // `subscribe: false` asks once: the source may answer inside `open`,
    // and the hub keeps the rows while the site holds the key — no re-ask
    // on later frames.
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": "Task", "subscribe": false } },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.items.length" } } }] });
    let source = Counting::new();
    let (mut rt, mut host, screen, _bag) = rig(node, source.clone());
    rt.frame(&mut host, &screen);
    rt.frame(&mut host, &screen);
    assert_eq!(
        source.open_count(),
        1,
        "a one-shot request opened once and stayed held"
    );
    assert_eq!(source.close_count(), 0);
}

#[test]
fn late_result_after_close_is_dropped() {
    // The site released, the ticket closed — a `deliver` the source pushes
    // afterwards lands on a tombstone: no entry, no visible change, no
    // dirty revision.
    let node = json!({ "type": "Column", "children": [
        { "type": "$if", "props": { "condition": { "$": "flags.a" },
            "then": { "type": "Row",
                "$queries": { "items": { "entity": "Task" } }, "children": [] } } }
    ]});
    let source = Counting::new().holding("Task");
    let (mut rt, mut host, screen, bag) = rig(node, source.clone());
    set_flag(&bag, "a", true);
    rt.frame(&mut host, &screen);
    let stale = source
        .live
        .lock()
        .unwrap()
        .values()
        .next()
        .map(|(_, sink)| sink.clone())
        .expect("the held ticket kept a sink");
    set_flag(&bag, "a", false);
    rt.frame(&mut host, &screen);
    assert_eq!(source.close_count(), 1);

    let before = rt.hub().revision();
    stale.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
        &json!({ "id": "ghost" }),
    )])));
    assert!(
        !rt.dirty(&screen),
        "a dead ticket's delivery cannot dirty the frame"
    );
    rt.frame(&mut host, &screen);
    assert_eq!(rt.hub().revision(), before, "the stale event was dropped");
    assert_eq!(rt.hub().held(), 0, "no entry resurrected");
}

#[test]
fn the_snapshot_table_source_answers_named_queries() {
    // The default source — the snapshot's `queries` table — answers a
    // named `$queries` field by `name_hint`, inside `open`, in one frame.
    // This is the render gate's path: no installed source at all.
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": {},
            "queries": { "items": [{ "id": "t1" }, { "id": "t2" }] },
        }))
        .unwrap(),
    );
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": "Task" } },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.items.length" } } }] });
    let mut rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new());
    let mut host = StaticHost::new(bag);
    let screen = screen("/");
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(2.0))),
        "the name-keyed table answered the named site: {text:?}"
    );
}

// ---- Round 2: Lal's review fixes ----

/// A request built by hand — the hub's contract needs no schema.
fn request(entity: &str) -> Compiled {
    Compiled::Ready(QueryRequest {
        classes: vec![entity.into()].into(),
        union: false,
        subscribe: true,
        dataset: DatasetSel::Here,
        ir: QueryIr::default(),
        name_hint: None,
        space: None,
    })
}

fn site(node: &str, slot: SiteSlot) -> SiteId {
    SiteId {
        node: NodeId::new(node),
        slot,
    }
}

fn hub() -> QueryHub {
    QueryHub::new(Arc::new(Inbox::default()), HandleTable::new())
}

/// F1: two sites swap one key inside a single commit — the final holder
/// count never reaches zero, so the ticket survives untouched.
#[test]
fn a_same_key_handoff_keeps_the_one_ticket() {
    let source = Counting::new().holding("Task");
    let mut hub = hub();
    let a = site("t:/a", SiteSlot::Prop("rows".into()));
    let b = site("t:/b", SiteSlot::Prop("rows".into()));

    hub.claim(a.clone(), request("Task"), None);
    hub.commit(source.clone());
    assert_eq!(hub.opened(), 1);
    let ticket = hub.cells()[0].ticket;

    hub.claim(b.clone(), request("Task"), None);
    hub.commit(source.clone());
    assert_eq!(hub.opened(), 1, "the ticket survives the handoff");
    assert_eq!(
        hub.cells()[0].ticket,
        ticket,
        "the same ticket — no close/open churn"
    );
    assert_eq!(source.open_count(), 1, "the source is not re-opened");
    assert_eq!(source.close_count(), 0, "the source is not closed");

    // And a later delivery still lands on the handed-off subscription.
    source.deliver("Task", vec![Value::from_json(&json!({ "id": "t9" }))]);
    hub.drain();
    assert_eq!(hub.cells()[0].view.rows.len(), 1);
    assert!(hub.cells()[0].view.loaded);
}

/// F1: two sites trade two keys — each key is positive before and after,
/// so neither ticket moves.
#[test]
fn a_two_key_swap_keeps_both_tickets() {
    let source = Counting::new().holding("Task").holding("Topic");
    let mut hub = hub();
    let a = site("t:/a", SiteSlot::Prop("rows".into()));
    let b = site("t:/b", SiteSlot::Prop("rows".into()));

    hub.claim(a.clone(), request("Task"), None);
    hub.claim(b.clone(), request("Topic"), None);
    hub.commit(source.clone());
    assert_eq!(hub.opened(), 2);
    let tickets: Vec<SubTicket> = hub.cells().iter().map(|c| c.ticket).collect();

    hub.claim(a.clone(), request("Topic"), None);
    hub.claim(b.clone(), request("Task"), None);
    hub.commit(source.clone());
    assert_eq!(hub.opened(), 2, "both keys keep their subscriptions");
    let mut now: Vec<SubTicket> = hub.cells().iter().map(|c| c.ticket).collect();
    now.sort_by_key(|t| t.raw());
    let mut before = tickets;
    before.sort_by_key(|t| t.raw());
    assert_eq!(now, before, "the same two tickets — no churn");
    assert_eq!(source.open_count(), 2, "no re-opens");
    assert_eq!(source.close_count(), 0, "no closes");
}

/// F1, through a frame: exclusive branches asking the identical request
/// hand the key between site ids as the flag flips.
#[test]
fn a_branch_handoff_does_not_churn_the_source() {
    let node = json!({ "type": "Column", "children": [
        { "type": "$if", "props": { "condition": { "$": "flags.a" },
            "then": { "type": "RowA",
                "$queries": { "items": { "entity": "Task" } }, "children": [] },
            "else": { "type": "RowB",
                "$queries": { "items": { "entity": "Task" } }, "children": [] } } }
    ]});
    let source = Counting::new().holding("Task");
    let (mut rt, mut host, screen, bag) = rig(node, source.clone());
    set_flag(&bag, "a", true);
    rt.frame(&mut host, &screen);
    assert_eq!(source.open_count(), 1, "branch A opened the key");

    set_flag(&bag, "a", false);
    rt.frame(&mut host, &screen);
    assert_eq!(rt.hub().opened(), 1, "branch B holds the same ticket");
    assert_eq!(source.open_count(), 1, "no reopen for the same key");
    assert_eq!(source.close_count(), 0, "no close churn mid-handoff");
}

/// F1, through a frame: the `$each` list's sole row is replaced — the new
/// row's site claims the identical request the replaced row's held.
#[test]
fn a_full_row_replacement_keeps_the_ticket() {
    let node = json!({ "type": "Column", "children": [
        { "type": "$each", "props": { "items": { "$": "rows" }, "as": "item" },
          "children": [{ "type": "Row",
            "$queries": { "items": { "entity": "Task" } }, "children": [] }] }
    ]});
    let source = Counting::new().holding("Task");
    let (mut rt, mut host, screen, bag) = rig(node, source.clone());
    bag.set_root("rows", Value::from_json(&json!([{ "id": "a" }])));
    rt.frame(&mut host, &screen);
    assert_eq!(source.open_count(), 1, "row a's site opened the key");

    bag.set_root("rows", Value::from_json(&json!([{ "id": "b" }])));
    rt.frame(&mut host, &screen);
    assert_eq!(rt.hub().opened(), 1, "row b holds the same subscription");
    assert_eq!(source.open_count(), 1, "no reopen on a whole-row swap");
    assert_eq!(source.close_count(), 0, "no close on a whole-row swap");
}

/// F3: a different source inherits every still-held key — the old
/// tickets close exactly once, the held keys reopen once, and the new
/// source's answer replaces the old one's.
#[test]
fn a_source_swap_reopens_every_held_key() {
    let a = Counting::new();
    let b = Counting::new();
    let mut hub = hub();
    hub.claim(
        site("t:/n0", SiteSlot::Prop("rows".into())),
        request("Task"),
        None,
    );
    hub.commit(a.clone());
    hub.drain();
    assert_eq!(a.open_count(), 1);
    assert_eq!(hub.cells()[0].view.rows.len(), 1, "A's rows landed");
    // The dead-ticket check: A's sink cannot reach the cell after close.
    let stale = a
        .live
        .lock()
        .unwrap()
        .values()
        .next()
        .map(|(_, sink)| sink.clone())
        .expect("A held a live sink");

    hub.claim(
        site("t:/n0", SiteSlot::Prop("rows".into())),
        request("Task"),
        None,
    );
    hub.commit(b.clone());
    assert_eq!(a.close_count(), 1, "A closed exactly once");
    assert_eq!(b.open_count(), 1, "the held key reopened on B");
    assert_eq!(hub.opened(), 1, "still one live ticket");
    // A's old ticket is dead: an event pushed on it is dropped at apply.
    stale.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
        &json!({ "id": "ghost" }),
    )])));
    hub.drain();
    assert!(
        !hub.cells()[0]
            .view
            .rows
            .iter()
            .any(|r| r.to_json()["id"].as_str() == Some("ghost")),
        "the swapped-out ticket's event died"
    );
    assert_eq!(hub.cells()[0].view.rows.len(), 1, "B's answer landed");

    // And B's live delivery replaces A's rows wholesale.
    b.deliver("Task", vec![Value::from_json(&json!({ "id": "from-b" }))]);
    hub.drain();
    let view = &hub.cells()[0].view;
    assert_eq!(view.rows.len(), 1);
    assert_eq!(
        view.rows[0].to_json()["id"].as_str(),
        Some("from-b"),
        "the cell answers from the new source"
    );
}

/// F3 (Lal N1), Runtime level: swap to a source that does NOT answer
/// inside `open`. The pass resolves with A's rows before `commit` swaps;
/// if the reset inside `commit` does not count as work the loop breaks on
/// a quiet `drain`, the tree caches A's rows behind `Loaded`, and `last`
/// records the frame — stale data forever. The swap must re-resolve:
/// `Loading` until B answers, and a claim derived from A's answer must
/// not stay held on B while its dependency reloads.
#[test]
fn a_source_swap_that_withholds_shows_loading_until_b_answers() {
    let node = json!({ "type": "Column",
        "$queries": {
            "items": { "entity": "Task" },
            "detail": { "entity": "Detail",
                "scope": { "anchorId": { "$": "first(local.items).id" } } }
        },
        "children": [
            { "type": "we-text",
              "props": { "text": { "$": "local.items.length" } } },
            { "type": "we-flag",
              "props": { "on": { "$": "local.itemsLoaded" } } }
        ] });
    let a = Counting::new();
    let b = Counting::new();
    b.hold
        .lock()
        .unwrap()
        .extend(["Task".into(), "Detail".into()]);
    let (mut rt, mut host, mut screen, _bag) = rig(node, a.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(1.0))),
        "A's row painted: {text:?}"
    );
    let on = find_ty(&root, "we-flag")
        .and_then(|n| n.props.get("on"))
        .cloned();
    assert!(
        matches!(&on, Some(Value::Bool(true))),
        "A's answer reported Loaded: {on:?}"
    );
    assert_eq!(rt.hub().held(), 2, "items + the A-derived detail held");

    rt = rt.with_sources(Some(b.clone()), Arc::new(we_template::NoParts));
    assert!(rt.dirty(&screen), "the swap reports dirty to the next poll");
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(0.0))),
        "loading, not A's rows: {text:?}"
    );
    let on = find_ty(&root, "we-flag")
        .and_then(|n| n.props.get("on"))
        .cloned();
    assert!(
        matches!(&on, Some(Value::Bool(false))),
        "the cells reset to Loading until B answers: {on:?}"
    );
    assert_eq!(a.close_count(), 2, "A closed both tickets, once each");
    assert_eq!(b.open_count(), 2, "both held keys reopened on B");
    assert_eq!(
        rt.hub().held(),
        1,
        "the A-derived detail claim did not stay held while items reload"
    );
    assert_eq!(
        b.close_count(),
        1,
        "the stale detail subscription closed on the settling pass"
    );
    assert!(
        !rt.dirty(&screen),
        "the loading tree is honest — the next poll is quiet until B answers"
    );

    // B answers through the sink it kept — the rows it gives replace the
    // loading state, and the dependent claim reopens on B's answer.
    b.deliver("Task", vec![Value::from_json(&json!({ "id": "b1" }))]);
    let (_, queries, _, _) = rt.drain_inbox(&mut host, &mut screen);
    assert_eq!(queries, 1, "B's delivery applied");
    assert!(rt.dirty(&screen), "the applied answer reports dirty");
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(1.0))),
        "B's row painted once it answered: {text:?}"
    );
    let on = find_ty(&root, "we-flag")
        .and_then(|n| n.props.get("on"))
        .cloned();
    assert!(
        matches!(&on, Some(Value::Bool(true))),
        "Loaded again: {on:?}"
    );
    let details = b.opens_for("Detail");
    assert_eq!(
        details.len(),
        2,
        "detail reopened on B with B-derived scope: {details:?}"
    );
    assert!(
        details[1].contains("\"anchorId\":\"b1\""),
        "the reopened detail asks B's anchor, not A's: {}",
        details[1]
    );
    assert_eq!(rt.hub().held(), 2, "items + the B-derived detail held");
}

/// F5: the anonymous `$query` prop claims key K *before* the named
/// `$queries.items` site in the same pass — K must still open with the
/// name, or the name-keyed snapshot table answers nothing for either.
/// Both orders share the one subscription and the named answer.
#[test]
fn an_anonymous_then_named_claim_shares_the_named_answer() {
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": {},
            "queries": { "items": [{ "id": "t1" }, { "id": "t2" }] },
        }))
        .unwrap(),
    );
    let node = json!({ "type": "Column", "children": [
        { "type": "List", "props": { "rows": { "$query": { "entity": "Task" } } },
          "children": [] },
        { "type": "Named", "$queries": { "items": { "entity": "Task" } },
          "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.items.length" } } }] }
    ]});
    let mut rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new());
    let mut host = StaticHost::new(bag);
    let screen = screen("/");
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(2.0))),
        "the named claim's rows answered the shared key: {text:?}"
    );
    let rows = find_ty(&root, "List")
        .and_then(|n| n.props.get("rows"))
        .cloned();
    assert!(
        matches!(&rows, Some(Value::List(r)) if r.len() == 2),
        "the anonymous claim sees them too: {rows:?}"
    );
    assert_eq!(rt.hub().opened(), 1, "both sites share one subscription");
}

#[test]
fn a_named_then_anonymous_claim_shares_the_named_answer() {
    // The same two claims, named first — the order that already worked.
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": {},
            "queries": { "items": [{ "id": "t1" }, { "id": "t2" }] },
        }))
        .unwrap(),
    );
    let node = json!({ "type": "Column", "children": [
        { "type": "Named", "$queries": { "items": { "entity": "Task" } },
          "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.items.length" } } }] },
        { "type": "List", "props": { "rows": { "$query": { "entity": "Task" } } },
          "children": [] }
    ]});
    let mut rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new());
    let mut host = StaticHost::new(bag);
    let screen = screen("/");
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(2.0))),
        "the named-first order still answers: {text:?}"
    );
    let rows = find_ty(&root, "List")
        .and_then(|n| n.props.get("rows"))
        .cloned();
    assert!(
        matches!(&rows, Some(Value::List(r)) if r.len() == 2),
        "the anonymous claim shares them: {rows:?}"
    );
    assert_eq!(rt.hub().opened(), 1, "both sites share one subscription");
}

/// F5, hub-level: a named claim landing on an already-open anonymous cell
/// updates the entry's hint and reopens the subscription so the
/// name-keyed source answers it.
#[test]
fn a_late_named_claim_reopens_the_unnamed_cell() {
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": {},
            "queries": { "items": [{ "id": "t1" }, { "id": "t2" }] },
        }))
        .unwrap(),
    );
    let source = Names::new(bag);
    let mut hub = hub();
    hub.claim(
        site("t:/l", SiteSlot::Prop("rows".into())),
        request("Task"),
        None,
    );
    hub.commit(source.clone());
    hub.drain();
    assert_eq!(source.hints(), vec![None], "the anonymous open had no name");
    assert!(!hub.cells()[0].view.loaded, "an unnamed ask is unanswered");

    hub.claim(
        site("t:/n", SiteSlot::Named("items".into())),
        request("Task"),
        None,
    );
    hub.claim(
        site("t:/l", SiteSlot::Prop("rows".into())),
        request("Task"),
        None,
    );
    hub.commit(source.clone());
    hub.drain();
    assert_eq!(
        source.hints(),
        vec![None, Some("items".into())],
        "the cell reopened with the merged hint"
    );
    assert_eq!(hub.cells()[0].view.rows.len(), 2, "the named answer landed");
}

/// F5 + dead tickets: the reopen a late named claim causes closes the old
/// ticket — so an event the source still pushes on it, after the reopen,
/// is dropped at apply (E3c-design 2.4/2.5). Without that drop the old
/// ticket's late rows would overwrite the cell the new ticket now serves.
#[test]
fn a_late_event_on_the_ticket_a_reopen_closed_is_dropped() {
    let source = Counting::new().holding("Task");
    let mut hub = hub();
    hub.claim(
        site("t:/l", SiteSlot::Prop("rows".into())),
        request("Task"),
        None,
    );
    hub.commit(source.clone());
    hub.drain();
    let old = hub.cells()[0].ticket;
    let stale = source
        .live
        .lock()
        .unwrap()
        .get(&old)
        .map(|(_, sink)| sink.clone())
        .expect("the anonymous open kept a sink");

    // The reopen: a later named claim adds a hint to the open cell.
    hub.claim(
        site("t:/n", SiteSlot::Named("items".into())),
        request("Task"),
        None,
    );
    hub.claim(
        site("t:/l", SiteSlot::Prop("rows".into())),
        request("Task"),
        None,
    );
    hub.commit(source.clone());
    hub.drain();
    assert_eq!(source.open_count(), 2, "the hint reopened the cell");
    assert_eq!(source.closes.lock().unwrap().clone(), vec![old]);
    assert_ne!(hub.cells()[0].ticket, old, "the cell moved to a new ticket");
    assert_eq!(hub.opened(), 1, "only the new ticket is live");

    let ghost = || QueryEvent::Rows(Arc::new(vec![Value::from_json(&json!({ "id": "ghost" }))]));

    // Nothing answered the new ticket yet: the stale event leaves it loading.
    let before = hub.revision();
    stale.deliver(ghost());
    assert!(!hub.drain(), "the old ticket's event is not a change");
    assert_eq!(hub.revision(), before, "no revision for a dead ticket");
    assert!(
        !hub.cells()[0].view.loaded,
        "still loading on the new ticket"
    );
    assert!(hub.cells()[0].view.rows.is_empty());

    // The new ticket answers; a later stale event cannot overwrite it.
    source.deliver("Task", vec![Value::from_json(&json!({ "id": "new" }))]);
    assert!(hub.drain(), "the new ticket's answer lands");
    let before = hub.revision();
    stale.deliver(ghost());
    assert!(!hub.drain(), "the old ticket's event is not a change");
    assert_eq!(hub.revision(), before, "no revision for a dead ticket");
    let view = &hub.cells()[0].view;
    assert!(view.loaded);
    assert_eq!(view.rows.len(), 1);
    assert_eq!(
        view.rows[0].to_json()["id"].as_str(),
        Some("new"),
        "the cell still shows the new ticket's rows"
    );
}

/// A source that answers by `name_hint` the way the snapshot table does —
/// recording the hint every `open` carried.
#[derive(Default)]
struct Names {
    bag: Arc<StoreBag>,
    opens: Mutex<Vec<Option<Arc<str>>>>,
}

impl Names {
    fn new(bag: Arc<StoreBag>) -> Arc<Self> {
        Arc::new(Self {
            bag,
            opens: Mutex::new(Vec::new()),
        })
    }
    fn hints(&self) -> Vec<Option<Arc<str>>> {
        self.opens.lock().unwrap().clone()
    }
}

impl QuerySource for Names {
    fn open(
        &self,
        _ticket: SubTicket,
        request: &QueryRequest,
        _handles: &HandleTable,
        sink: QuerySink,
    ) {
        self.opens.lock().unwrap().push(request.name_hint.clone());
        if let Some(name) = request.name_hint.as_deref() {
            match self.bag.query(name) {
                Value::List(rows) => sink.deliver(QueryEvent::Rows(rows)),
                Value::Undefined => {}
                other => sink.deliver(QueryEvent::Rows(Arc::new(vec![other]))),
            }
        }
    }
    fn close(&self, _ticket: SubTicket) {}
}

// ---- E3c-5a: asynchronous delivery ----
//
// A live source answers when it answers: `open` returns, the sink it kept
// pushes the event into the inbox, the push wakes the frontend, `poll`'s
// drain applies it to the ticket's cell, and the next frame paints it.
// `Failed` settles a cell loaded with no rows and its value readable as
// `local.<name>Error`; events on closed tickets die at apply; a loading
// source spins nothing.

/// `open` answers nothing; the rows arrive on a later frame through the
/// kept sink — the push wakes, the drain applies, the poll reports dirty
/// and the next frame paints them.
#[test]
fn loading_then_rows_on_a_later_frame() {
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": "Task" } },
        "children": [
            { "type": "we-text",
              "props": { "text": { "$": "local.items.length" } } },
            { "type": "we-flag",
              "props": { "on": { "$": "local.itemsLoaded" } } }
        ] });
    let source = Counting::new().holding("Task");
    let (mut rt, mut host, mut screen, _bag) = rig(node, source.clone());
    let wakes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let w = wakes.clone();
    rt.inbox().set_waker(Arc::new(move || {
        w.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }));

    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(0.0))),
        "an unanswered query paints empty: {text:?}"
    );
    let on = find_ty(&root, "we-flag")
        .and_then(|n| n.props.get("on"))
        .cloned();
    assert!(
        matches!(&on, Some(Value::Bool(false))),
        "Loaded stays false while the source is quiet: {on:?}"
    );
    assert!(
        !rt.dirty(&screen),
        "waiting is not work — the poll is quiet"
    );

    // The answer arrives between frames: `deliver` queues it and wakes.
    source.deliver("Task", vec![Value::from_json(&json!({ "id": "t1" }))]);
    assert_eq!(
        wakes.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the sink's push woke the frontend"
    );
    let (_, queries, _, _) = rt.drain_inbox(&mut host, &mut screen);
    assert_eq!(queries, 1, "the queued event applied to its cell");
    assert!(rt.dirty(&screen), "the applied answer reports dirty");

    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(1.0))),
        "the later frame paints the rows: {text:?}"
    );
    let on = find_ty(&root, "we-flag")
        .and_then(|n| n.props.get("on"))
        .cloned();
    assert!(
        matches!(&on, Some(Value::Bool(true))),
        "Loaded flips once rows land: {on:?}"
    );
}

/// A second live result on the same ticket replaces the first wholesale —
/// the shape a live subscription's update takes until E3c-5b reconciles
/// rows.
#[test]
fn second_live_result_appears() {
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": "Task" } },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "first(local.items).id" } } }] });
    let source = Counting::new(); // answers {id:"Task-1"} inside `open`
    let (mut rt, mut host, mut screen, _bag) = rig(node, source.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(Value::Str(s)) if s.as_ref() == "Task-1"),
        "the open answer painted: {text:?}"
    );

    source.deliver("Task", vec![Value::from_json(&json!({ "id": "Task-2" }))]);
    let (_, queries, _, _) = rt.drain_inbox(&mut host, &mut screen);
    assert_eq!(queries, 1, "the refill applied");
    assert!(rt.dirty(&screen));
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(Value::Str(s)) if s.as_ref() == "Task-2"),
        "the second result replaced the first wholesale: {text:?}"
    );
}

/// The claim was wide while a flag held and narrows when it drops — the
/// wide ticket closes and a result the source pushes on it afterwards is
/// a dead ticket's event: dropped, so the narrow cell's own answer stands
/// (its own key, its own ticket).
#[test]
fn narrow_result_not_overwritten_by_wide_late_result() {
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": { "$": "flags.a ? 'Wide' : 'Narrow'" } } },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "first(local.items).id" } } }] });
    let source = Counting::new();
    source
        .hold
        .lock()
        .unwrap()
        .extend(["Wide".into(), "Narrow".into()]);
    let (mut rt, mut host, mut screen, bag) = rig(node, source.clone());
    set_flag(&bag, "a", true);
    rt.frame(&mut host, &screen);
    assert_eq!(source.opens_for("Wide").len(), 1, "the wide request opened");
    let stale = source
        .live
        .lock()
        .unwrap()
        .values()
        .next()
        .map(|(_, sink)| sink.clone())
        .expect("the wide ticket kept a sink");

    set_flag(&bag, "a", false);
    rt.frame(&mut host, &screen);
    assert_eq!(
        source.opens_for("Narrow").len(),
        1,
        "the narrow request opened on its own ticket"
    );
    assert_eq!(source.close_count(), 1, "the wide ticket closed");

    // The narrow answer lands on the narrow ticket.
    source.deliver("Narrow", vec![Value::from_json(&json!({ "id": "n1" }))]);
    rt.drain_inbox(&mut host, &mut screen);
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(Value::Str(s)) if s.as_ref() == "n1"),
        "the narrow result painted: {text:?}"
    );

    // The wide result pushed on its closed ticket dies at apply — the
    // narrow cell keeps its own rows and the frame stays quiet.
    let before = rt.hub().revision();
    stale.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
        &json!({ "id": "wide-ghost" }),
    )])));
    let (_, queries, _, _) = rt.drain_inbox(&mut host, &mut screen);
    assert_eq!(queries, 0, "the dead ticket's event applied to nothing");
    assert!(!rt.dirty(&screen), "a dropped event cannot dirty the frame");
    assert_eq!(rt.hub().revision(), before, "no visible change");
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(Value::Str(s)) if s.as_ref() == "n1"),
        "the narrow result was not overwritten: {text:?}"
    );
}

/// A source that never answers leaves the entry `Loading` — and that is
/// all: one resolve, one `open`, then quiet frames. `Loading` is not an
/// event; nothing bumps, so nothing re-resolves.
#[test]
fn loading_source_does_not_spin() {
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": "Task" } },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.items.length" } } }] });
    let source = Counting::new().holding("Task");
    let (mut rt, mut host, screen, _bag) = rig(node, source.clone());
    rt.frame(&mut host, &screen);
    assert_eq!(rt.stats().resolves, 1, "the loading frame resolved once");
    assert_eq!(source.open_count(), 1, "the request opened and stays held");
    assert!(
        !rt.dirty(&screen),
        "Loading is not work — the poll is quiet"
    );

    rt.frame(&mut host, &screen);
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.stats().resolves,
        1,
        "an unanswered subscription does not re-resolve"
    );
    assert_eq!(source.open_count(), 1, "and is not re-asked");
    assert_eq!(rt.hub().held(), 1, "the claim stays held");
}

/// Nine dependent queries — each asks the entity the previous answer
/// names — outrun the eight-pass budget: the first frame shows the
/// partial tree, reports dirty and wakes; the second finishes; the third
/// is quiet.
#[test]
fn chain_longer_than_eight_continues_and_goes_quiet() {
    let node = json!({ "type": "Column",
        "$queries": {
            "q0": { "entity": "E0" },
            "q1": { "entity": { "$": "first(local.q0).kind" } },
            "q2": { "entity": { "$": "first(local.q1).kind" } },
            "q3": { "entity": { "$": "first(local.q2).kind" } },
            "q4": { "entity": { "$": "first(local.q3).kind" } },
            "q5": { "entity": { "$": "first(local.q4).kind" } },
            "q6": { "entity": { "$": "first(local.q5).kind" } },
            "q7": { "entity": { "$": "first(local.q6).kind" } },
            "q8": { "entity": { "$": "first(local.q7).kind" } }
        },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.q8.length" } } }] });
    let source = Arc::new(Stair::default());
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new())
        .with_sources(Some(source.clone()), Arc::new(we_template::NoParts));
    let wakes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let w = wakes.clone();
    rt.inbox().set_waker(Arc::new(move || {
        w.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }));
    let mut host = StaticHost::new(bag);
    let screen = screen("/");

    // Frame one: the climb opens one level per pass — E0..E7 inside the
    // budget — shows the partial tree, reports dirty and wakes.
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(0.0))),
        "the partial tree is what there is to show: {text:?}"
    );
    assert_eq!(rt.hub().held(), 8, "eight levels opened in eight passes");
    assert!(rt.dirty(&screen), "the leftover work reports dirty");
    assert_eq!(
        wakes.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the exhausted budget woke the frontend"
    );

    // Frame two: the climb resumes — the ninth level opens and delivers,
    // then a quiet pass ends it.
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::from(1.0))),
        "the second frame finished the chain: {text:?}"
    );
    assert_eq!(rt.hub().held(), 9, "all nine levels held");
    assert!(!rt.dirty(&screen), "done — quiet");

    // Frame three: nothing left, no resolve at all.
    rt.frame(&mut host, &screen);
    assert_eq!(rt.stats().resolves, 2, "two resolves, then quiet");
    assert_eq!(
        wakes.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "and no further wakes"
    );
    assert_eq!(
        source.opens.lock().unwrap().len(),
        9,
        "each level asked exactly once"
    );
}

/// Lal F2: a `Ready` claim on a cell an earlier pass filled answers inside
/// the pass. A second copy of the nine-level chain mounts once the first
/// has settled: every level's claim lands on a filled cell, so the next
/// level compiles from it in the same round and the whole chain settles in
/// one pass — no budget left over, no wake, no new `open` — where the cold
/// chain needed two frames.
#[test]
fn a_prefilled_cell_answers_inside_the_pass() {
    let chain = json!({
        "q0": { "entity": "E0" },
        "q1": { "entity": { "$": "first(local.q0).kind" } },
        "q2": { "entity": { "$": "first(local.q1).kind" } },
        "q3": { "entity": { "$": "first(local.q2).kind" } },
        "q4": { "entity": { "$": "first(local.q3).kind" } },
        "q5": { "entity": { "$": "first(local.q4).kind" } },
        "q6": { "entity": { "$": "first(local.q5).kind" } },
        "q7": { "entity": { "$": "first(local.q6).kind" } },
        "q8": { "entity": { "$": "first(local.q7).kind" } }
    });
    let node = json!({ "type": "Column", "children": [
        { "type": "Row", "$queries": chain.clone(), "children": [] },
        { "type": "$if", "props": { "condition": { "$": "flags.b" },
            "then": { "type": "Column", "$queries": chain,
                "children": [{ "type": "we-text",
                    "props": { "text": { "$": "first(local.q8).id" } } }] } } }
    ] });
    let source = Arc::new(Stair::default());
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new())
        .with_sources(Some(source.clone()), Arc::new(we_template::NoParts));
    let wakes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let w = wakes.clone();
    rt.inbox().set_waker(Arc::new(move || {
        w.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }));
    let mut host = StaticHost::new(bag.clone());
    let mut screen = screen("/");

    // The cold chain: two frames, as above.
    rt.frame(&mut host, &screen);
    rt.frame(&mut host, &screen);
    assert!(!rt.dirty(&screen), "the cold chain settled");
    assert_eq!(source.opens.lock().unwrap().len(), 9);

    // The warm copy: one frame, one pass. The flag write queues its own
    // invalidation and wakes for it; the poll drains it, as a frontend's
    // would, and the count starts after.
    set_flag(&bag, "b", true);
    rt.drain_inbox(&mut host, &mut screen);
    let woke = wakes.load(std::sync::atomic::Ordering::SeqCst);
    let resolves = rt.stats().resolves;
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(Value::Str(s)) if s.as_ref() == "E8-row"),
        "the warm chain reached the ninth level in one frame: {text:?}"
    );
    assert!(!rt.dirty(&screen), "nothing left over");
    assert_eq!(
        wakes.load(std::sync::atomic::Ordering::SeqCst),
        woke,
        "no exhausted budget, no wake"
    );
    assert_eq!(
        source.opens.lock().unwrap().len(),
        9,
        "every level shared a filled cell"
    );
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.stats().resolves,
        resolves + 1,
        "and the next frame is quiet"
    );
}

/// A `$queries` block whose compiles can never settle keeps the last
/// round's claims as its bounded fallback and warns (Lal F3) — and goes
/// quiet across frames: the rotating claims hit cells the first pass
/// already filled, so nothing visible moves again.
#[test]
fn oscillating_cycle_warns_and_goes_quiet() {
    // A host-function proxy for the oscillation the round bound exists
    // for, not an authored local cycle. Slots do fill inside a pass — a
    // `Ready` claim on a cell an earlier pass filled returns its rows at
    // once (`a_prefilled_cell_answers_inside_the_pass`) — but a fresh
    // mutual cycle gates: a compile that reads a sibling's unloaded slot
    // is `Provisional`, and claiming that returns an empty view even when
    // an equivalent cell exists, so no ready key rotates. `flip` instead
    // answers a different entity each call. Its period (three) divides
    // the six calls a pass makes (two queries, three rounds), so every
    // pass ends on the same pair B/C: the second frame reuses those cells
    // and goes quiet. A period that does not divide the calls would
    // alternate pairs between passes and keep waking — bounded per frame,
    // never quiet; that is the contract (quiet once nothing visible
    // changes), not a gap this pins.
    let node = json!({ "type": "Column",
        "$queries": {
            "qa": { "entity": { "$": "flip()" } },
            "qb": { "entity": { "$": "flip()" } }
        },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.qa.length" } } }] });
    let source = Counting::new(); // answers whatever opens
    let (mut rt, mut host, screen, bag) = rig(node, source.clone());
    let n = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let n2 = n.clone();
    bag.set_function(
        "flip",
        Arc::new(move |_| {
            let i = n2.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Value::from(["A", "B", "C"][(i % 3) as usize])
        }),
    );

    rt.frame(&mut host, &screen);
    // One retained diagnostic per node and pass (deduplicated within the
    // pass's warnings), not one ever: a later dirty resolve may say it again.
    assert_eq!(
        rt.stats()
            .warnings
            .iter()
            .filter(|w| w.contains("did not settle") && w.contains("dependency cycle"))
            .count(),
        1,
        "the settle loop exhausted its bound and warned once: {:?}",
        rt.stats().warnings
    );
    assert!(
        !rt.dirty(&screen),
        "kept the bounded fallback — the poll is quiet"
    );

    rt.frame(&mut host, &screen);
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.stats().resolves,
        1,
        "claims rotate over filled cells — no re-resolve, no spin"
    );
}

/// `Failed` settles the cell loaded with no rows and its value readable
/// as `local.<name>Error`; a healthy sibling's `<name>Error` reads
/// `undefined`. A `Failed` that lands after rows clears them — the
/// table's `any → Failed` rule — still loaded.
#[test]
fn failed_query_reports_loaded_with_error() {
    let node = json!({ "type": "Column",
        "$queries": {
            "items": { "entity": "Task" },
            "fine": { "entity": "Ok" },
            "late": { "entity": "Late" }
        },
        "children": [
            { "type": "we-err",  "props": { "v": { "$": "local.itemsError" } } },
            { "type": "we-flag", "props": { "on": { "$": "local.itemsLoaded" } } },
            { "type": "we-num",  "props": { "v": { "$": "local.items.length" } } },
            { "type": "we-ok",   "props": { "v": { "$": "local.fineError" } } },
            { "type": "we-late", "props": { "err": { "$": "local.lateError" },
                "n": { "$": "local.late.length" },
                "on": { "$": "local.lateLoaded" } } }
        ] });
    let source = Counting::new().failing("Task");
    source.hold.lock().unwrap().push("Late".into());
    let (mut rt, mut host, mut screen, _bag) = rig(node, source.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let err = find_ty(&root, "we-err")
        .and_then(|n| n.props.get("v"))
        .cloned();
    assert!(
        matches!(&err, Some(Value::Str(s)) if s.as_ref() == "Task failed"),
        "local.itemsError carries the failure: {err:?}"
    );
    let on = find_ty(&root, "we-flag")
        .and_then(|n| n.props.get("on"))
        .cloned();
    assert!(
        matches!(&on, Some(Value::Bool(true))),
        "a failed read reports loaded, as WE does: {on:?}"
    );
    let n = find_ty(&root, "we-num")
        .and_then(|n| n.props.get("v"))
        .cloned();
    assert!(
        matches!(&n, Some(v) if v.strict_eq(&Value::from(0.0))),
        "and no rows: {n:?}"
    );
    let ok = find_ty(&root, "we-ok")
        .and_then(|n| n.props.get("v"))
        .cloned();
    assert!(
        matches!(&ok, Some(Value::Undefined)),
        "a healthy query's <name>Error reads undefined: {ok:?}"
    );

    // Rows arrive late, then a failure replaces them — `any → Failed`.
    source.deliver("Late", vec![Value::from_json(&json!({ "id": "l1" }))]);
    rt.drain_inbox(&mut host, &mut screen);
    rt.frame(&mut host, &screen);
    source.deliver_failed("Late", Value::from("late broke"));
    rt.drain_inbox(&mut host, &mut screen);
    let root = rt.frame(&mut host, &screen).clone();
    let late = find_ty(&root, "we-late").expect("we-late mounts");
    assert!(
        matches!(late.props.get("err"), Some(Value::Str(s)) if s.as_ref() == "late broke"),
        "the later failure landed on <name>Error: {:?}",
        late.props.get("err")
    );
    assert!(
        matches!(late.props.get("n"), Some(v) if v.strict_eq(&Value::from(0.0))),
        "the rows are gone: {:?}",
        late.props.get("n")
    );
    assert!(
        matches!(late.props.get("on"), Some(Value::Bool(true))),
        "still loaded: {:?}",
        late.props.get("on")
    );
}

/// A snapshot-style source: answers inside `open`, each row naming the
/// entity the next link of a chain asks.
#[derive(Default)]
struct Stair {
    opens: Mutex<Vec<String>>,
}

impl QuerySource for Stair {
    fn open(
        &self,
        _ticket: SubTicket,
        request: &QueryRequest,
        handles: &HandleTable,
        sink: QuerySink,
    ) {
        let entity = request.classes.first().cloned().unwrap_or("?".into());
        self.opens
            .lock()
            .unwrap()
            .push(request.key(None, handles).as_str().to_string());
        let next = entity
            .strip_prefix('E')
            .and_then(|n| n.parse::<u64>().ok())
            .map(|n| format!("E{}", n + 1))
            .unwrap_or_else(|| "E0".into());
        sink.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
            &json!({ "id": format!("{entity}-row"), "kind": next }),
        )])));
    }

    fn close(&self, _ticket: SubTicket) {}
}

fn find_ty<'a>(node: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if node.ty.as_ref() == ty {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_ty(n, ty),
        _ => None,
    })
}

// ---- E3c-5a round 2 (Lal F1): `<name>Error` never shadows an authored name ----
//
// `<name>Error` is the port's extension — WE synthesises only `<name>` and
// `<name>Loaded` (`SchemaRenderer.tsx`), and those two keep WE's rule: the
// query's accessors spread over `$local`, so they win. The Error companion
// has no WE meaning to defend, so an authored name always wins over it: a
// `$localState` field, or a query, of the same name.

/// `$localState: { saveError }` beside `$queries: { save }` keeps the
/// authored field — its value, its `$fields` membership, and the
/// `$setLocal`/`$resetLocal` that find it through `$owner`.
#[test]
fn an_authored_local_wins_over_the_error_companion() {
    let node = json!({ "type": "Column",
        "$localState": { "saveError": { "type": "string", "initial": "authored" } },
        "$queries": { "save": { "entity": "Task" } },
        "props": {
            "onEdit": { "$setLocal": "saveError", "value": "edited" },
            "onReset": { "$resetLocal": "$scope" }
        },
        "children": [
            { "type": "we-err", "props": { "v": { "$": "local.saveError" } } },
            { "type": "we-fields", "props": { "v": { "$": "local['$fields']" } } }
        ] });
    let source = Counting::new().failing("Task");
    let bag = Arc::new(StoreBag::new());
    let locals = LocalState::new();
    let mut rt = Runtime::new(schema(node), "test", bag.clone(), locals.clone())
        .with_sources(Some(source), Arc::new(we_template::NoParts));
    let mut host = StaticHost::new(bag);
    let mut screen = screen("/");
    let err_of = |root: &ResolvedNode| {
        find_ty(root, "we-err")
            .and_then(|n| n.props.get("v"))
            .cloned()
    };

    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    let err = err_of(&root);
    assert!(
        matches!(&err, Some(Value::Str(s)) if s.as_ref() == "authored"),
        "the authored field wins over the failed query's companion: {err:?}"
    );
    let fields = find_ty(&root, "we-fields")
        .and_then(|n| n.props.get("v"))
        .cloned();
    assert!(
        matches!(&fields, Some(Value::List(l))
            if l.iter().any(|v| v.strict_eq(&Value::from("saveError")))),
        "the authored field stays in local.$fields: {fields:?}"
    );

    rt.dispatch(&mut host, &mut screen, &owner, "onEdit", Value::Null);
    assert!(
        locals
            .get(&owner, "saveError")
            .strict_eq(&Value::from("edited")),
        "$setLocal still finds the authored field: {:?}",
        locals.get(&owner, "saveError")
    );
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        matches!(&err_of(&root), Some(Value::Str(s)) if s.as_ref() == "edited"),
        "and the read follows it: {:?}",
        err_of(&root)
    );
    rt.dispatch(&mut host, &mut screen, &owner, "onReset", Value::Null);
    assert!(
        locals
            .get(&owner, "saveError")
            .strict_eq(&Value::from("authored")),
        "$resetLocal restores the authored initial: {:?}",
        locals.get(&owner, "saveError")
    );
}

/// A query named `fooError` beside a query `foo` keeps its rows under its
/// own name, whichever is declared first — `foo`'s error is then not
/// readable by that name, and that is the price of the collision.
#[test]
fn an_authored_query_wins_over_the_error_companion_in_either_order() {
    for order in [["foo", "fooError"], ["fooError", "foo"]] {
        // Spelled as text: a `json!` map may sort its keys, and the order
        // the two are declared in is the point.
        let decl = |name: &str| {
            let entity = if name == "foo" { "Broken" } else { "Task" };
            format!("\"{name}\": {{ \"entity\": \"{entity}\" }}")
        };
        let queries = format!("{{ {}, {} }}", decl(order[0]), decl(order[1]));
        let mut node = json!({ "type": "Column",
            "children": [
                { "type": "we-n", "props": { "v": { "$": "first(local.fooError).id" } } },
                { "type": "we-on", "props": { "v": { "$": "local.fooLoaded" } } }
            ] });
        node["$queries"] = serde_json::from_str(&queries).unwrap();
        let source = Counting::new().failing("Broken");
        let (mut rt, mut host, screen, _bag) = rig(node, source);
        let root = rt.frame(&mut host, &screen).clone();
        let v = find_ty(&root, "we-n")
            .and_then(|n| n.props.get("v"))
            .cloned();
        assert!(
            matches!(&v, Some(Value::Str(s)) if s.as_ref() == "Task-1"),
            "{order:?}: local.fooError is the query of that name: {v:?}"
        );
        let on = find_ty(&root, "we-on")
            .and_then(|n| n.props.get("v"))
            .cloned();
        assert!(
            matches!(&on, Some(Value::Bool(true))),
            "{order:?}: foo's own companions are untouched: {on:?}"
        );
    }
}

// ---- E3c-5a round 2 (Lal F3): `<name>Error` clears, and is a tracked read ----

/// A subscription that fails and later supplies rows on the same ticket
/// recovers: `<name>Error` reads `undefined` again, Loaded stays true, the
/// rows render.
#[test]
fn a_later_success_clears_the_error() {
    let node = json!({ "type": "Column",
        "$queries": { "items": { "entity": "Task" } },
        "children": [{ "type": "we-q", "props": {
            "err": { "$": "local.itemsError" },
            "on": { "$": "local.itemsLoaded" },
            "n": { "$": "local.items.length" } } }] });
    let source = Counting::new().failing("Task");
    let (mut rt, mut host, mut screen, _bag) = rig(node, source.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let q = find_ty(&root, "we-q").expect("we-q mounts");
    assert!(
        matches!(q.props.get("err"), Some(Value::Str(s)) if s.as_ref() == "Task failed"),
        "failed first: {:?}",
        q.props.get("err")
    );

    source.deliver("Task", vec![Value::from_json(&json!({ "id": "t1" }))]);
    let (_, queries, _, _) = rt.drain_inbox(&mut host, &mut screen);
    assert_eq!(queries, 1, "the success on the same ticket applied");
    let root = rt.frame(&mut host, &screen).clone();
    let q = find_ty(&root, "we-q").expect("we-q mounts");
    assert!(
        matches!(q.props.get("err"), Some(Value::Undefined)),
        "the error cleared: {:?}",
        q.props.get("err")
    );
    assert!(
        matches!(q.props.get("on"), Some(Value::Bool(true))),
        "still loaded: {:?}",
        q.props.get("on")
    );
    assert!(
        matches!(q.props.get("n"), Some(v) if v.strict_eq(&Value::from(1.0))),
        "the rows render: {:?}",
        q.props.get("n")
    );
}

/// A query that reads `local.itemsError` is a dependent of `items`: it is
/// withheld while `items` loads (the read is noted, the slot is unloaded),
/// asks the fallback once `items` fails, and moves back when it recovers.
#[test]
fn a_dependent_recomputes_on_the_error() {
    let node = json!({ "type": "Column",
        "$queries": {
            "items": { "entity": "Task" },
            "dep": { "entity": { "$": "local.itemsError ? 'Fallback' : 'Primary'" } }
        },
        "children": [] });
    let source = Counting::new().holding("Task");
    let (mut rt, mut host, mut screen, _bag) = rig(node, source.clone());
    rt.frame(&mut host, &screen);
    assert!(
        source.opens_for("Primary").is_empty() && source.opens_for("Fallback").is_empty(),
        "the dependent waits for items to settle"
    );

    source.deliver_failed("Task", Value::from("broke"));
    rt.drain_inbox(&mut host, &mut screen);
    rt.frame(&mut host, &screen);
    assert_eq!(
        source.opens_for("Fallback").len(),
        1,
        "the failure asks the fallback"
    );
    assert!(
        source.opens_for("Primary").is_empty(),
        "and never the primary"
    );

    source.deliver("Task", vec![Value::from_json(&json!({ "id": "t1" }))]);
    rt.drain_inbox(&mut host, &mut screen);
    rt.frame(&mut host, &screen);
    assert_eq!(
        source.opens_for("Primary").len(),
        1,
        "the recovery moves it back"
    );
    assert_eq!(source.close_count(), 1, "and closes the fallback");
}
