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
        let bindings = LegacyBindings::install(rt.layer(), rt.view());
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
        let params = get(rt.roots().root("routeStore"), "params");
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

fn reading_tree() -> SchemaNode {
    serde_json::from_value(serde_json::json!({ "type": "Column", "children": [
        { "type": "Text", "props": { "t": { "$": "screen.params.x" } } },
        { "type": "Text", "props": { "t": { "$": "routeStore.params.x" } } },
        { "type": "Text", "props": { "t": { "$": "legacy.routeStore.params.x" } } }
    ] }))
    .unwrap()
}

/// F8 (Lal): the gate's cached wrappers must not keep the gate alive —
/// once a filtered root has been read, dropping the Runtime frees the
/// Gate (and everything its cache holds).
#[test]
fn dropping_the_runtime_frees_the_gate_after_a_filtered_read() {
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(reading_tree(), "test", bag.clone(), LocalState::new());
    let legacy = LegacyBindings::install(rt.layer(), rt.view());
    rt.set_bindings(Arc::new(legacy));
    let mut host = we_template::StaticHost::new(bag.clone());
    let screen = ScreenState::desktop(ScreenSchema::default(), "/?x=1");
    let _ = rt.frame(&mut host, &screen);
    assert!(
        rt.gate().served_len() > 0,
        "the reads went through the gate"
    );
    let gate = Arc::downgrade(rt.gate());
    drop(rt);
    drop(host);
    assert!(
        gate.upgrade().is_none(),
        "the gate survived its runtime (a wrapper <-> gate cycle)"
    );
}

/// F8 (Lal): unchanged reads through the real `LegacyBindings` reuse one
/// wrapper per root — the cache does not grow per read.
#[test]
fn unchanged_reads_do_not_grow_the_served_cache() {
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(reading_tree(), "test", bag.clone(), LocalState::new());
    let legacy = LegacyBindings::install(rt.layer(), rt.view());
    rt.set_bindings(Arc::new(legacy));
    let mut host = we_template::StaticHost::new(bag.clone());
    let mut screen = ScreenState::desktop(ScreenSchema::default(), "/?x=1");
    let _ = rt.frame(&mut host, &screen);
    let after_one = rt.gate().served_len();
    for i in 0..5 {
        // A screen change forces a re-resolve, re-reading every root.
        rt.apply_screen(
            &mut screen,
            ScreenOp::SetParam {
                name: "x".into(),
                value: Some(format!("{i}")),
                push: None,
            },
        );
        let _ = rt.frame(&mut host, &screen);
    }
    assert_eq!(rt.gate().served_len(), after_one, "one wrapper per root");
}
