//! Sessions that share one `StoreBag`.
//!
//! Sharing is a supported contract — the inbox tests subscribe two
//! sessions to one bag. What must hold across it: a session's own
//! bindings (its `screen` view, the legacy faces) are its own and never
//! the bag's, and nothing a session installs may keep the bag alive.
use std::sync::Arc;

use serde_json::json;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{MountCx, RootSpec, SchemaNode, StoreBag};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn spec() -> RootSpec {
    RootSpec::Single {
        node: Box::new(schema(json!({ "type": "Column", "children": [] }))),
        cx: MountCx::explicit("test"),
    }
}

fn screen(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
}

#[test]
fn a_dropped_session_frees_its_bag() {
    let bag = Arc::new(StoreBag::new());
    let weak = Arc::downgrade(&bag);
    {
        let _s = Session::offline(spec(), bag.clone(), screen("/"));
        assert!(weak.upgrade().is_some(), "live while the session lives");
    }
    drop(bag);
    assert!(
        weak.upgrade().is_none(),
        "the session's installs must not keep the bag alive"
    );
}
