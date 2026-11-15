//! Sessions that share one `StoreBag`.
//!
//! Sharing is a supported contract — the inbox tests subscribe two
//! sessions to one bag. What must hold across it: a session's own
//! bindings (its `screen` view, the legacy faces) are its own and never
//! the bag's, nothing a session installs may keep the bag alive, and the
//! data roots stay shared — one bag, many sessions' screens.
use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenOp, ScreenSchema, ScreenState};
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

fn get(root: Option<Value>, key: &str) -> Value {
    match root {
        Some(Value::Namespace(ns)) => ns.get(key),
        _ => Value::Undefined,
    }
}

/// `routeStore.href` — the legacy face's overlay of this session's `nav`.
fn route_href(s: &Session) -> Value {
    get(s.runtime.roots().root("routeStore"), "href")
}

fn navigate(to: &str) -> ScreenOp {
    ScreenOp::Navigate {
        to: to.into(),
        query: None,
        base_depth: None,
        replace: false,
    }
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

#[test]
fn two_sessions_on_one_bag_keep_their_own_screens() {
    // The shared-roots bug made the LAST install win: session B's
    // `screen`/faces overwrote session A's slots in the bag, so A read
    // B's route. Session bindings live in each runtime's own layer now.
    let bag = Arc::new(StoreBag::new());
    let mut one = Session::offline(spec(), bag.clone(), screen("/one"));
    let mut two = Session::offline(spec(), bag.clone(), screen("/two"));
    one.resolve();
    two.resolve();

    // Nothing session-shaped reached the shared table.
    assert!(bag.root("screen").is_none(), "screen is never the bag's");
    assert!(
        bag.root("routeStore").is_none(),
        "the faces are never the bag's"
    );

    // Different routes from the start, through both spellings.
    assert!(route_href(&one).strict_eq(&Value::from("/one")));
    assert!(route_href(&two).strict_eq(&Value::from("/two")));
    let screen_href = |s: &Session| get(Some(get(s.runtime.roots().root("screen"), "nav")), "href");
    assert!(screen_href(&one).strict_eq(&Value::from("/one")));
    assert!(screen_href(&two).strict_eq(&Value::from("/two")));

    // Alternating writes: each session's screen moves, the other's does
    // not — and a later write on the second session must not reach back.
    one.apply_screen(navigate("/one/b"));
    assert!(route_href(&one).strict_eq(&Value::from("/one/b")));
    assert!(
        route_href(&two).strict_eq(&Value::from("/two")),
        "one's navigation is not two's"
    );
    two.apply_screen(navigate("/two/c"));
    assert!(route_href(&two).strict_eq(&Value::from("/two/c")));
    assert!(
        route_href(&one).strict_eq(&Value::from("/one/b")),
        "two's navigation is not one's"
    );

    // A shell write the same way — the faces overlay each session's own
    // `shell`, not a shared one.
    one.apply_screen(ScreenOp::SetDialog {
        name: "create_space".into(),
        open: true,
    });
    let dialog = |s: &Session| get(s.runtime.roots().root("shellStore"), "createSpaceOpen");
    assert!(dialog(&one).strict_eq(&Value::Bool(true)));
    assert!(dialog(&two).strict_eq(&Value::Bool(false)));

    // The data roots stay shared: one `set_root` serves both sessions.
    let shared = Value::from("shared-data");
    bag.set_root("profileStore", shared.clone());
    assert!(one
        .runtime
        .roots()
        .root("profileStore")
        .unwrap()
        .strict_eq(&shared));
    assert!(two
        .runtime
        .roots()
        .root("profileStore")
        .unwrap()
        .strict_eq(&shared));
}

#[test]
fn a_second_session_install_does_not_move_the_firsts_faces() {
    // Install order was the failure mode: B's install rebound the bag
    // slots A's reads went through. Now each install writes its own
    // layer — A's `routeStore` is the same binding before and after B.
    let bag = Arc::new(StoreBag::new());
    let mut one = Session::offline(spec(), bag.clone(), screen("/one"));
    one.resolve();
    let face = one.runtime.roots().root("routeStore").unwrap();
    let _two = Session::offline(spec(), bag.clone(), screen("/two"));
    assert!(
        one.runtime
            .roots()
            .root("routeStore")
            .unwrap()
            .strict_eq(&face),
        "one's routeStore binding must not move when two installs"
    );
    // …and still reads one's screen.
    assert!(route_href(&one).strict_eq(&Value::from("/one")));
}
