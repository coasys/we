//! E3c-4: the query hub — claims, refcounts, tickets, synchronous delivery
//! (E3c-design 2.2–2.4, row 8.2 E3c-4; TS reference `subscriptionPool.ts`).
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
        self.live
            .lock()
            .unwrap()
            .insert(ticket, (request.clone(), sink.clone()));
        if !held {
            let entity = request.classes.first().cloned().unwrap_or("?".into());
            sink.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
                &json!({ "id": format!("{entity}-1"), "kind": "Task" }),
            )])));
        }
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
fn a_late_result_for_a_closed_ticket_is_dropped() {
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

fn find_ty<'a>(node: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if node.ty.as_ref() == ty {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_ty(n, ty),
        _ => None,
    })
}
