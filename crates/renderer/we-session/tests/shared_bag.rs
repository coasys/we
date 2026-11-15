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

/// The `where` each held claim of `s` carries for `field`.
fn claimed(s: &Session, field: &str) -> Vec<serde_json::Value> {
    s.runtime
        .hub()
        .cells()
        .iter()
        .map(|c| c.request.ir_json()["where"][field].clone())
        .collect()
}

#[test]
fn a_query_reading_screen_claims_for_its_own_sessions_route() {
    // The E3c-4 hub compiles a claim's args through the runtime's roots;
    // were they read from the shared bag, the last session's `screen`
    // would answer for both and each would claim the other's route.
    let spec = || RootSpec::Single {
        node: Box::new(schema(json!({
            "type": "Column",
            "$queries": {
                "rows": {
                    "entity": "Post",
                    "where": { "route": { "$": "screen.nav.href" } }
                }
            },
            "children": []
        }))),
        cx: MountCx::explicit("test"),
    };
    let bag = Arc::new(StoreBag::new());
    let mut one = Session::offline(spec(), bag.clone(), screen("/one"));
    let mut two = Session::offline(spec(), bag.clone(), screen("/two"));
    one.resolve();
    two.resolve();
    assert_eq!(claimed(&one, "route"), vec![json!("/one")]);
    assert_eq!(claimed(&two, "route"), vec![json!("/two")]);

    // One navigates: its claim follows, the other's stays.
    one.apply_screen(navigate("/one/b"));
    one.resolve();
    two.resolve();
    assert_eq!(claimed(&one, "route"), vec![json!("/one/b")]);
    assert_eq!(claimed(&two, "route"), vec![json!("/two")]);
}

#[test]
fn two_sessions_on_one_bag_keep_their_own_surfaces() {
    // E3c-13 × E3c-6: both sessions mount the same template under the
    // same mount id, so their host surface keys (`SurfaceKey::Host(test)`)
    // are equal. The surface table is the mount's own, like its `screen`
    // layer — one session's measure never reaches the other's tree, and
    // its report does not even dirty the other.
    fn surfaced() -> RootSpec {
        RootSpec::single(
            schema(json!({
                "type": "Row",
                "props": {
                    "w": { "$": "surface.width" },
                    "t": { "$": "surface.tier" }
                },
                "children": []
            })),
            "test",
        )
    }
    fn read(s: &mut Session) -> (Value, String) {
        let root = s.resolve();
        let w = root.props.get("w").cloned().unwrap_or(Value::Undefined);
        let t = root
            .props
            .get("t")
            .map(|v| v.to_text().to_string())
            .unwrap_or_default();
        (w, t)
    }

    let bag = Arc::new(StoreBag::new());
    let mut one = Session::offline(surfaced(), bag.clone(), screen("/"));
    let mut two = Session::offline(surfaced(), bag.clone(), screen("/"));
    let root_one = one.resolve();
    let root_two = two.resolve();
    assert_eq!(
        one.host_surfaces().first().map(|t| t.key.clone()),
        two.host_surfaces().first().map(|t| t.key.clone()),
        "the premise: both mounts claim the same host key"
    );

    one.report_host_surfaces(&root_one, 700.0);
    assert!(
        !two.poll().dirty,
        "session one's report must not dirty session two"
    );
    two.report_host_surfaces(&root_two, 1440.0);

    let (w1, t1) = read(&mut one);
    let (w2, t2) = read(&mut two);
    assert!(
        w1.strict_eq(&Value::from(700.0)),
        "one sees its own width: {w1:?}"
    );
    assert_eq!(t1, "sm", "one sees its own tier");
    assert!(
        w2.strict_eq(&Value::from(1440.0)),
        "two sees its own width: {w2:?}"
    );
    assert_eq!(t2, "lg", "two sees its own tier");

    // A later report on two leaves one exactly where it was — even when
    // one re-resolves for a reason of its own (a navigation), which is
    // the moment a measure kept anywhere shared would leak in.
    two.report_host_surfaces(&root_two, 950.0);
    assert!(!one.poll().dirty, "two's report never dirties one");
    let (w2, t2) = read(&mut two);
    assert!(w2.strict_eq(&Value::from(950.0)), "two moved: {w2:?}");
    assert_eq!(t2, "md");
    one.apply_screen(navigate("/elsewhere"));
    let (w1, t1) = read(&mut one);
    assert!(
        w1.strict_eq(&Value::from(700.0)),
        "one re-resolved and still reads its own width: {w1:?}"
    );
    assert_eq!(t1, "sm", "and its own tier");
}
