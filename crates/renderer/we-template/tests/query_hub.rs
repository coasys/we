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
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, BundleTemplate, LocalState, PartSource, QueryEvent, QueryRequest, QuerySink,
    QuerySource, ResolvedChild, ResolvedNode, Runtime, SchemaNode, StaticHost, StoreBag, SubTicket,
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
    fn open(&self, ticket: SubTicket, request: &QueryRequest, sink: QuerySink) {
        self.opens
            .lock()
            .unwrap()
            .push((ticket, request.key(None).as_str().to_string()));
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

fn find_ty<'a>(node: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if node.ty.as_ref() == ty {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_ty(n, ty),
        _ => None,
    })
}
