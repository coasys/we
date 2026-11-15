//! The adapter's live-base contract (5.1): nothing is captured at install,
//! so `set_root` swaps the base under the face and a screen change lands
//! in the view — a read after both answers the new base and the new
//! screen fact, through `LegacyBindings`.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::{MapNamespace, Value};
use we_legacy::LegacyBindings;
use we_screen::{ScreenOp, ScreenSchema, ScreenState};
use we_template::{LocalState, Runtime, SchemaNode, StaticHost, StoreBag};

fn schema() -> SchemaNode {
    serde_json::from_value(serde_json::json!({
        "type": "Column", "children": []
    }))
    .unwrap()
}

fn screen(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
}

fn store(members: &[(&str, Value)]) -> Value {
    let map: IndexMap<Arc<str>, Value> = members
        .iter()
        .map(|(k, v)| (Arc::from(*k), v.clone()))
        .collect();
    Value::namespace(MapNamespace::new(map))
}

fn get(root: Option<Value>, key: &str) -> Value {
    match root {
        Some(Value::Namespace(ns)) => ns.get(key),
        _ => Value::Undefined,
    }
}

fn same(a: &Value, b: &Value) -> bool {
    a.strict_eq(b)
}

#[test]
fn set_root_then_screen_change_then_read() {
    // The runtime-rebind residual, through the adapter: `set_root` writes
    // the base AFTER the faces are bound; a screen change refreshes the
    // view; one read answers the new base member and the new screen fact.
    let bag = Arc::new(StoreBag::new());
    let rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    let _bindings = LegacyBindings::install(&bag, rt.view());
    bag.set_root(
        "spaceStore",
        store(&[("root", Value::from("demo")), ("members", Value::from(3.0))]),
    );
    let mut screen = screen("/space/elsewhere");
    rt.apply_screen(
        &mut screen,
        ScreenOp::Navigate {
            to: "/space/demo".into(),
            query: None,
            base_depth: None,
            replace: false,
        },
    );
    let space = bag.root("spaceStore");
    assert!(
        same(
            &get(space.clone(), "spacePath"),
            &Value::from("/space/demo")
        ),
        "the screen fact must be the live one, got {:?}",
        get(space.clone(), "spacePath")
    );
    assert!(
        same(&get(space.clone(), "root"), &Value::from("demo")),
        "the base member must be the set_root store's"
    );
    assert!(
        same(&get(space, "members"), &Value::from(3.0)),
        "every base member forwards"
    );
}

#[test]
fn a_screen_change_is_visible_to_the_next_read() {
    // B8's twin on the legacy spelling: a write through the session's one
    // write path lands in the adapter's next read — no rebind in between.
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    let _bindings = LegacyBindings::install(&bag, rt.view());
    let mut screen = screen("/?x=old");
    rt.frame(&mut StaticHost::new(bag.clone()), &screen);
    rt.apply_screen(
        &mut screen,
        ScreenOp::SetParam {
            name: "x".into(),
            value: Some("new".into()),
            push: None,
        },
    );
    let params = get(bag.root("routeStore"), "params");
    assert!(
        same(&get(Some(params), "x"), &Value::from("new")),
        "routeStore.params.x must answer the write just made"
    );
}

#[test]
fn repeated_changes_never_stack_a_wrapper() {
    // B10's twin on the legacy spelling: ten screen changes later the
    // face is still the SAME binding — nothing wraps anything, so reads
    // stay O(1) and root identity never moves.
    let bag = Arc::new(StoreBag::new());
    let rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    let _bindings = LegacyBindings::install(&bag, rt.view());
    let mut screen = screen("/");
    let face0 = bag.root("routeStore").unwrap();
    for i in 0..10 {
        rt.apply_screen(
            &mut screen,
            ScreenOp::SetSurface {
                id: format!("s{i}"),
                width: 100.0 + i as f64,
                tier: "md".into(),
            },
        );
    }
    let face1 = bag.root("routeStore").unwrap();
    assert!(
        face0.strict_eq(&face1),
        "the routeStore binding must be one face, rebound never"
    );
}

#[test]
fn data_members_fall_through_and_screen_members_stay_the_screens() {
    // Overlay fall-through: `themeStore.builtInThemes` is store data the
    // screen never answers; `themeStore.themeFork` is always the screen's
    // (`null` = no fork) even when the base has its own opinion.
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    let _bindings = LegacyBindings::install(&bag, rt.view());
    bag.set_root(
        "themeStore",
        store(&[
            ("builtInThemes", Value::from(2.0)),
            ("themeFork", Value::from("store's-fork")),
        ]),
    );
    let screen = screen("/");
    rt.frame(&mut StaticHost::new(bag.clone()), &screen);
    let theme = bag.root("themeStore");
    assert!(
        same(&get(theme.clone(), "builtInThemes"), &Value::from(2.0)),
        "a data member reads the base"
    );
    assert!(
        get(theme, "themeFork").strict_eq(&Value::Null),
        "an owned member is the screen's even when the base has one"
    );
}
