//! A session driven headless — resolve, dispatch, poll — no pixels.
use std::sync::Arc;

use serde_json::json;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{Session, Tick};
use we_template::{MountCx, ResolvedChild, RootSpec, SchemaNode, StoreBag};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

fn session(v: serde_json::Value) -> Session {
    Session::offline(
        RootSpec::Single {
            node: Box::new(schema(v)),
            cx: MountCx::explicit("test"),
            declared: we_template::Declared::default(),
        },
        Arc::new(StoreBag::new()),
        screen(),
    )
}

#[test]
fn resolve_gives_the_tree() {
    let mut s = session(json!({
        "type": "Column",
        "children": [
            { "type": "we-text", "props": { "text": "hello" } },
            { "type": "we-button", "props": { "label": "go" } }
        ]
    }));
    let root = s.resolve();
    assert_eq!(root.ty.as_ref(), "Column");
    assert_eq!(root.children.len(), 2);
    match &root.children[0] {
        ResolvedChild::Node(n) => assert_eq!(n.ty.as_ref(), "we-text"),
        _ => panic!("expected a node"),
    }
    // A second resolve with no input changes nothing — revision stays put.
    let resolves = s.stats().resolves;
    let root2 = s.resolve();
    assert!(Arc::ptr_eq(&root, &root2) || s.stats().resolves == resolves);
}

/// The same counter as the S8 `dispatch_then_poll`, adapted to the
/// `poll -> Tick` API: the dispatch's local write is observable — the
/// tick reports `dirty` — and a settled session reports a clean tick.
#[test]
fn dispatch_then_poll_reports_the_local_change() {
    let mut s = session(json!({
        "type": "we-button",
        "$localState": { "clicks": { "type": "number", "initial": 0 } },
        "props": {
            "label": { "$": "local.clicks" },
            "onClick": [{ "$setLocal": "clicks", "value": { "$": "local.clicks + 1" } }]
        }
    }));
    let root = s.resolve();
    // The declared local seeded, the bound prop read it, and the event prop
    // became a dispatchable handler — all three prove the schema parsed.
    let label = |n: &we_template::ResolvedNode| {
        n.props
            .get("label")
            .map(|v| v.js_string())
            .unwrap_or_default()
    };
    assert_eq!(label(&root), "0");
    assert!(
        root.handlers.contains_key("onClick"),
        "props.onClick should land in handlers: {:?}",
        root.handlers.keys().collect::<Vec<_>>()
    );

    s.dispatch(&root.id, "onClick", we_expr::Value::Undefined);
    // The write went straight to LocalState — nothing arrived, but the
    // revision moved: the tick is dirty with zero arrivals.
    let tick = s.poll();
    assert!(tick.dirty, "the local write moved the revision");
    assert_eq!(
        tick.completions + tick.query_events + tick.binding_changes + tick.screen_ops,
        0,
        "nothing arrived — the write was direct"
    );
    let root2 = s.resolve();
    assert_eq!(label(&root2), "1");

    // And again — the write accumulates, it was not a re-seed.
    s.dispatch(&root2.id, "onClick", we_expr::Value::Undefined);
    let root3 = s.resolve();
    assert_eq!(label(&root3), "2");
    assert_eq!(
        s.poll(),
        Tick::default(),
        "settled — a clean tick reports nothing"
    );
}
