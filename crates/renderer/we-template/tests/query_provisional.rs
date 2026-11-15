//! E3c-3: provisional compilation decided by query-slot identity, not by
//! spelling (E3c-design 2.1, Lal's E3c-3 scope). A compile that read a query
//! slot that has not loaded is never sent; once the sibling loads, the next
//! compile is sent narrow.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    LocalState, QueryEvent, QueryRequest, QuerySink, QuerySource, Runtime, SchemaNode, StaticHost,
    StoreBag, SubTicket,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
}

/// A source that records every request opened on it, and answers `Board`
/// only once `board_ready` is set — holding the unanswered sinks until then,
/// the way a live source holds a subscription it cannot fill yet.
struct Recording {
    board_ready: AtomicBool,
    asked: Mutex<Vec<String>>,
    held: Mutex<Vec<QuerySink>>,
}

impl Recording {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            board_ready: AtomicBool::new(false),
            asked: Mutex::new(Vec::new()),
            held: Mutex::new(Vec::new()),
        })
    }
    fn asked_for(&self, entity: &str) -> Vec<String> {
        self.asked
            .lock()
            .unwrap()
            .iter()
            .filter(|k| k.contains(&format!("\"e\":[\"{entity}\"]")))
            .cloned()
            .collect()
    }
}

impl QuerySource for Recording {
    fn open(&self, _ticket: SubTicket, request: &QueryRequest, sink: QuerySink) {
        let key = request.key(None);
        self.asked.lock().unwrap().push(key.as_str().to_string());
        if key.as_str().contains("\"e\":[\"Board\"]") {
            if self.board_ready.load(Ordering::SeqCst) {
                sink.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
                    &json!({ "id": "b1", "gathers": "g1" }),
                )])));
            } else {
                self.held.lock().unwrap().push(sink);
            }
            return;
        }
        sink.deliver(QueryEvent::Rows(Arc::new(Vec::new())));
    }

    fn close(&self, _ticket: SubTicket) {}
}

fn run(node: serde_json::Value, source: Arc<Recording>) -> (Runtime, StaticHost, ScreenState) {
    let bag = Arc::new(StoreBag::new());
    let rt = Runtime::new(schema(node), "test", bag.clone(), LocalState::new())
        .with_sources(Some(source), Arc::new(we_template::NoParts));
    (rt, StaticHost::new(bag), screen("/"))
}

/// The board lands: every held sink gets its rows, the way a live
/// subscription's first result arrives — then the frame runs.
fn board_lands(rt: &mut Runtime, host: &mut StaticHost, screen: &ScreenState, src: &Recording) {
    src.board_ready.store(true, Ordering::SeqCst);
    for sink in src.held.lock().unwrap().drain(..) {
        sink.deliver(QueryEvent::Rows(Arc::new(vec![Value::from_json(
            &json!({ "id": "b1", "gathers": "g1" }),
        )])));
    }
    rt.frame(host, screen);
}

#[test]
fn provisional_through_alias() {
    // `cards` reads the board through an `$each` alias, never spelling
    // `local.board`. The slot identity rides on the alias, so while the
    // board is loading `cards` is not sent — no wide Card request.
    let node = json!({ "type": "Column",
        "$queries": { "board": { "entity": "Board" } },
        "children": [{ "type": "$each",
            "props": { "items": { "$": "[local.board]" }, "as": "b" },
            "children": [{ "type": "Column",
                "$queries": { "cards": { "entity": "Card",
                    "scope": { "anchorId": { "$": "first(b).gathers" } } } },
                "children": [] }] }]
    });
    let src = Recording::new();
    let (mut rt, mut host, screen) = run(node, src.clone());
    rt.frame(&mut host, &screen);
    assert!(!src.asked_for("Board").is_empty(), "board was asked");
    assert!(
        src.asked_for("Card").is_empty(),
        "cards read an unloaded slot through an alias and was sent: {:?}",
        src.asked_for("Card")
    );
    board_lands(&mut rt, &mut host, &screen, &src);
    let cards = src.asked_for("Card");
    assert_eq!(cards.len(), 1, "only the narrow request: {cards:?}");
    assert!(cards[0].contains("\"anchorId\":\"g1\""), "{}", cards[0]);
}

#[test]
fn provisional_through_loaded_flag() {
    // Reading only `boardLoaded` is a read of the board's slot.
    let node = json!({ "type": "Column",
        "$queries": {
            "cards": { "entity": "Card",
                "where": { "status": { "$": "local.boardLoaded ? 'open' : local.unset" } } },
            "board": { "entity": "Board" }
        },
        "children": []
    });
    let src = Recording::new();
    let (mut rt, mut host, screen) = run(node, src.clone());
    rt.frame(&mut host, &screen);
    assert!(
        src.asked_for("Card").is_empty(),
        "cards read an unloaded Loaded flag and was sent: {:?}",
        src.asked_for("Card")
    );
    board_lands(&mut rt, &mut host, &screen, &src);
    let cards = src.asked_for("Card");
    assert_eq!(cards.len(), 1, "{cards:?}");
    assert!(cards[0].contains("\"status\":\"open\""), "{}", cards[0]);
}

#[test]
fn plain_local_named_like_a_slot_is_not_provisional() {
    // `boardLoaded` and `board` here are `$localState` fields, not query
    // slots: an operand they leave unresolved widens, as in TS.
    let node = json!({ "type": "Column",
        "$localState": {
            "board": { "type": "array", "initial": [] },
            "boardLoaded": { "type": "boolean", "initial": false }
        },
        "$queries": {
            "cards": { "entity": "Card",
                "where": { "status": { "$": "local.boardLoaded ? 'open' : local.unset" } },
                "scope": { "anchorId": { "$": "first(local.board).gathers" } } }
        },
        "children": []
    });
    let src = Recording::new();
    let (mut rt, mut host, screen) = run(node, src.clone());
    rt.frame(&mut host, &screen);
    let cards = src.asked_for("Card");
    assert_eq!(
        cards.len(),
        1,
        "a plain local never makes a query provisional"
    );
    assert!(
        cards[0].contains(r#""ir":{}"#),
        "the unresolved operands widened: {}",
        cards[0]
    );
}

#[test]
fn provisional_becomes_ready_when_sibling_loads() {
    // Lal's B1 case: `cards` follows `first(local.board).gathers`. While the
    // board loads, the wide read never goes out; once it lands, the narrow
    // one does.
    let node = json!({ "type": "Column",
        "$queries": {
            "cards": { "entity": "Card",
                "scope": { "anchorId": { "$": "first(local.board).gathers" } } },
            "board": { "entity": "Board" }
        },
        "children": [{ "type": "we-text",
            "props": { "text": { "$": "local.cardsLoaded" } } }]
    });
    let src = Recording::new();
    let (mut rt, mut host, screen) = run(node, src.clone());
    rt.frame(&mut host, &screen);
    rt.frame(&mut host, &screen);
    assert!(
        src.asked_for("Card").is_empty(),
        "{:?}",
        src.asked_for("Card")
    );
    board_lands(&mut rt, &mut host, &screen, &src);
    let cards = src.asked_for("Card");
    assert_eq!(cards.len(), 1, "{cards:?}");
    assert!(cards[0].contains("\"anchorId\":\"g1\""), "{}", cards[0]);
}
