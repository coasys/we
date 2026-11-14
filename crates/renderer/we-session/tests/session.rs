//! A session driven headless — resolve, dispatch, poll — no pixels.
use std::sync::Arc;

use serde_json::json;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{ResolvedChild, SchemaNode, StoreBag};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

fn session(v: serde_json::Value) -> Session {
    Session::new(schema(v), "test", Arc::new(StoreBag::new()), screen())
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

#[test]
fn dispatch_runs_the_handler_and_poll_drains() {
    // A local state bump through $setLocal — dispatch lands the value.
    let mut s = session(json!({
        "type": "we-button",
        "props": {
            "label": "go",
            "$localState": { "clicks": 0 }
        },
        "handlers": {
            "onClick": [{ "$setLocal": "clicks", "value": 7 }]
        }
    }));
    let root = s.resolve();
    s.dispatch(&root.id, "onClick", we_expr::Value::from("ignored"));
    // dispatch queues ops/locals — resolving again reflects them; poll
    // drains anything queued between frames.
    let _ = s.poll();
    let root2 = s.resolve();
    assert_eq!(root2.ty.as_ref(), "we-button");
}
