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
    let _bindings = LegacyBindings::install(rt.layer(), rt.view());
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
    let space = rt.roots().root("spaceStore");
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
    let _bindings = LegacyBindings::install(rt.layer(), rt.view());
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
    let params = get(rt.roots().root("routeStore"), "params");
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
    let _bindings = LegacyBindings::install(rt.layer(), rt.view());
    let mut screen = screen("/");
    let face0 = rt.roots().root("routeStore").unwrap();
    for i in 0..10 {
        rt.apply_screen(
            &mut screen,
            ScreenOp::SetPref {
                key: format!("we-test:s{i}"),
                value: Some(serde_json::json!(100 + i)),
            },
        );
    }
    let face1 = rt.roots().root("routeStore").unwrap();
    assert!(
        face0.strict_eq(&face1),
        "the routeStore binding must be one face, rebound never"
    );
}

#[test]
fn a_dialog_and_panel_open_are_the_next_shell_store_read() {
    // `shellStore.createSpaceOpen` read while false must not stay false
    // forever: the face overlays the view's `shell` member, which was
    // interned on first read and answered the first snapshot from then on.
    // Panels, lanes and dialogs read the same way.
    let bag = Arc::new(StoreBag::new());
    let rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    let _bindings = LegacyBindings::install(rt.layer(), rt.view());
    let mut screen = screen("/");
    rt.view().refresh(&screen);
    let shell = rt.roots().root("shellStore");
    let member = |key| get(shell.clone(), key);
    assert!(
        member("createSpaceOpen").strict_eq(&Value::Bool(false)),
        "closed before the write"
    );
    rt.apply_screen(
        &mut screen,
        ScreenOp::SetDialog {
            name: "create_space".into(),
            open: true,
        },
    );
    assert!(
        member("createSpaceOpen").strict_eq(&Value::Bool(true)),
        "the very next shellStore read must see the open dialog"
    );
    rt.apply_screen(
        &mut screen,
        ScreenOp::OpenTemplatePanel {
            id: "inspector".into(),
        },
    );
    assert!(
        get(Some(member("panels")), "inspector").strict_eq(&Value::Bool(true)),
        "the very next shellStore read must see the opened panel"
    );
    // …and through the `screen` spelling — the same live root.
    let view_shell = we_expr::Namespace::get(rt.view(), "shell");
    assert!(
        get(Some(view_shell), "createSpaceOpen").strict_eq(&Value::Bool(true)),
        "screen.shell sees it too"
    );
}

#[test]
fn a_theme_switch_is_the_next_theme_store_read() {
    // `themeStore.currentThemeId` while unset defers to the base store;
    // after `setCurrentTheme` lands the face must answer the screen's
    // current id — not the first snapshot the theme member interned.
    let bag = Arc::new(StoreBag::new());
    let rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    let _bindings = LegacyBindings::install(rt.layer(), rt.view());
    let mut screen = screen("/");
    rt.view().refresh(&screen);
    let theme = rt.roots().root("themeStore");
    let member = |key| get(theme.clone(), key);
    assert!(
        member("currentThemeId").is_undefined(),
        "unset defers to the base"
    );
    rt.apply_screen(
        &mut screen,
        ScreenOp::SetCurrentTheme {
            theme: "one".into(),
        },
    );
    assert!(
        member("currentThemeId").strict_eq(&Value::from("one")),
        "the very next themeStore read must see the theme just set"
    );
    rt.apply_screen(
        &mut screen,
        ScreenOp::SetCurrentTheme {
            theme: "two".into(),
        },
    );
    assert!(member("currentThemeId").strict_eq(&Value::from("two")));
    // …and `screen.theme.currentThemeId` — the same live root.
    let view_theme = we_expr::Namespace::get(rt.view(), "theme");
    assert!(
        get(Some(view_theme), "currentThemeId").strict_eq(&Value::from("two")),
        "screen.theme sees it too"
    );
}

#[test]
fn data_members_fall_through_and_screen_members_stay_the_screens() {
    // Overlay fall-through: `themeStore.builtInThemes` is store data the
    // screen never answers; `themeStore.themeFork` is always the screen's
    // (`null` = no fork) even when the base has its own opinion.
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(schema(), "test", bag.clone(), LocalState::new());
    let _bindings = LegacyBindings::install(rt.layer(), rt.view());
    bag.set_root(
        "themeStore",
        store(&[
            ("builtInThemes", Value::from(2.0)),
            ("themeFork", Value::from("store's-fork")),
        ]),
    );
    let screen = screen("/");
    rt.frame(&mut StaticHost::new(bag.clone()), &screen);
    let theme = rt.roots().root("themeStore");
    assert!(
        same(&get(theme.clone(), "builtInThemes"), &Value::from(2.0)),
        "a data member reads the base"
    );
    assert!(
        get(theme, "themeFork").strict_eq(&Value::Null),
        "an owned member is the screen's even when the base has one"
    );
}
