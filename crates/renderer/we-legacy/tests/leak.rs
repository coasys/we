//! The adapter must not keep its bag alive: an installed face held an
//! `Arc<StoreBag>` while the bag held the face — a cycle that leaked the
//! whole bag (stores, query tables, screen snapshots) once per dropped
//! session or TUI reload. The backref is `Weak` now; a bag whose owners
//! all drop is freed.
use std::sync::Arc;

use we_expr::Value;
use we_legacy::LegacyBindings;
use we_screen::{ScreenOp, ScreenSchema, ScreenState};
use we_template::{LocalState, Runtime, SchemaNode, StoreBag};

fn schema() -> SchemaNode {
    serde_json::from_value(serde_json::json!({ "type": "Column", "children": [] })).unwrap()
}

fn get(root: Option<Value>, key: &str) -> Value {
    match root {
        Some(Value::Namespace(ns)) => ns.get(key),
        _ => Value::Undefined,
    }
}

#[test]
fn a_dropped_mount_frees_its_bag() {
    let bag = Arc::new(StoreBag::new());
    let weak = Arc::downgrade(&bag);
    let rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    {
        let bindings = LegacyBindings::install(&bag, rt.view());
        // The install really answered — the faces' weak backref is live.
        let mut screen = ScreenState::desktop(ScreenSchema::default(), "/?x=1");
        rt.apply_screen(
            &mut screen,
            ScreenOp::SetParam {
                name: "x".into(),
                value: Some("2".into()),
                push: None,
            },
        );
        let params = get(bag.root("routeStore"), "params");
        assert!(
            get(Some(params), "x").strict_eq(&Value::from("2")),
            "the installed face answers while owners are alive"
        );
        drop(bindings);
    }
    drop(rt);
    drop(bag);
    assert!(
        weak.upgrade().is_none(),
        "the installed faces must not keep the bag alive"
    );
}
