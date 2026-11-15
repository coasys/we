//! E3c-7: every action carries its mount's identity — `Origin` gains the
//! stamped `tier` and `space`, fixed by the mount slot and never read
//! from the template. `meta.role` may only lower a tier; it cannot
//! raise one. Stamping only — nothing is filtered by these fields yet.
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use serde_json::json;
use we_expr::{MountCx, Tier, Value};
use we_screen::{ScreenOp, ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{
    ActionRequest, AppSpec, BundleTemplate, Completer, Host, Invoked, ResolvedChild, RootSpec,
    SchemaNode, StoreBag,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

/// Every request the host saw, kept for the assertions.
#[derive(Default)]
struct Log {
    requests: Vec<ActionRequest>,
}

struct RecordingHost(Rc<RefCell<Log>>);

impl Host for RecordingHost {
    fn act(&mut self, request: ActionRequest, _done: Completer) -> Invoked {
        self.0.borrow_mut().requests.push(request);
        Invoked::Done(Ok(Value::Null))
    }
}

fn session(spec: RootSpec, href: &str) -> (Session, Rc<RefCell<Log>>) {
    let log = Rc::new(RefCell::new(Log::default()));
    let s = Session::new(
        spec,
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), href),
        Box::new(RecordingHost(log.clone())),
    );
    (s, log)
}

/// A node whose `onTap` is an `$invoke` — every mount in these tests
/// gets one so its origin can be read back off the request log.
fn tap_node() -> SchemaNode {
    schema(json!({
        "type": "Column",
        "props": { "onTap": { "$invoke": "storeX.call", "args": [] } },
        "children": []
    }))
}

fn bundle_template(id: &str, meta: serde_json::Value, node: SchemaNode) -> BundleTemplate {
    BundleTemplate {
        id: id.into(),
        meta,
        node,
        key_order: vec![],
    }
}

fn spec_bundle(template_meta: serde_json::Value) -> RootSpec {
    RootSpec::App(Box::new(AppSpec {
        bundle: "testbundle".into(),
        app: Some(bundle_template("chrome", json!({}), tap_node())),
        template: Some(bundle_template("tpl", template_meta, tap_node())),
        pages: vec![],
        boot: None,
    }))
}

/// The origin of the request a mount's `onTap` produced — the mount is
/// found by the id prefix its nodes resolve under.
fn fire_and_origin(
    s: &mut Session,
    log: &Rc<RefCell<Log>>,
    mount_prefix: &str,
) -> (usize, we_template::Origin) {
    let root = s.resolve();
    let mut found = None;
    let mut stack = vec![root.as_ref()];
    while let Some(node) = stack.pop() {
        if node.id.as_str().starts_with(mount_prefix) && node.handlers.contains_key("onTap") {
            found = Some(node.id.clone());
            break;
        }
        for child in &node.children {
            if let ResolvedChild::Node(n) = child {
                stack.push(n);
            }
        }
    }
    let id = found.unwrap_or_else(|| panic!("no onTap node under {mount_prefix}"));
    let before = log.borrow().requests.len();
    s.dispatch(&id, "onTap", Value::Null);
    let log = log.borrow();
    assert!(log.requests.len() > before, "a request reached the host");
    (log.requests.len(), log.requests[before].origin.clone())
}

#[test]
fn meta_role_cannot_raise_tier() {
    // A space-slot template that declares `meta.role: 'app'` mounts at
    // Space anyway — the claim is refused; the slot, not the schema,
    // fixes the tier (4.4; `judgeBundle` judges bundle templates at
    // SPACE_TIER whatever their meta says).
    let spec = spec_bundle(json!({ "role": "app" }));
    let (mut s, log) = session(spec, "/space/preview-coasys");
    let (_, origin) = fire_and_origin(&mut s, &log, "space:");
    assert_eq!(
        origin.tier,
        Tier::Space,
        "meta.role 'app' on a space slot is a refused claim"
    );

    // The chrome on the same route stamps App — the slots differ by who
    // mounted them, not by anything the schema wrote.
    let (_, origin) = fire_and_origin(&mut s, &log, "app:");
    assert_eq!(origin.tier, Tier::App);
}

#[test]
fn meta_role_can_only_lower() {
    // The other half of the rule: `meta.role` may LOWER a tier. An app
    // chrome that declares a space-tier role mounts at Space.
    let spec = RootSpec::App(Box::new(AppSpec {
        bundle: "testbundle".into(),
        app: Some(bundle_template(
            "chrome",
            json!({ "role": "view" }),
            tap_node(),
        )),
        template: Some(bundle_template("tpl", json!({}), tap_node())),
        pages: vec![],
        boot: None,
    }));
    let (mut s, log) = session(spec, "/space/preview-coasys");
    let (_, origin) = fire_and_origin(&mut s, &log, "app:");
    assert_eq!(
        origin.tier,
        Tier::Space,
        "meta.role 'view' lowers the app slot's stamp"
    );
}

#[test]
fn offline_constructor_is_space_unless_told() {
    // `Session::offline`/`Session::new` with the plain `RootSpec::single`
    // — and even an authored `meta.role: 'app'` on the node — mounts at
    // Space with `Explicit` provenance; role is never consulted for it.
    let node = json!({
        "meta": { "role": "app" },
        "type": "Column",
        "props": { "onTap": { "$invoke": "storeX.call", "args": [] } },
        "children": []
    });
    let spec = RootSpec::single(schema(node.clone()), "test");
    let (mut s, log) = session(spec, "/");
    let (_, origin) = fire_and_origin(&mut s, &log, "test:");
    assert_eq!(origin.tier, Tier::Space, "the default is the untrusted one");

    // The same for the offline host's session.
    let mut s = Session::offline(
        RootSpec::single(schema(node.clone()), "test"),
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
    );
    let root = s.resolve();
    let _ = root;

    // "unless told": a caller that stamps the mount App gets App.
    let spec = RootSpec::Single {
        node: Box::new(schema(node)),
        cx: MountCx::explicit_app("test"),
    };
    let (mut s, log) = session(spec, "/");
    let (_, origin) = fire_and_origin(&mut s, &log, "test:");
    assert_eq!(
        origin.tier,
        Tier::App,
        "the caller said App — core trusts the caller, not the schema"
    );
}

#[test]
fn origin_space_is_stamped() {
    // On a space route every mount's origin carries the open space's
    // handle — the host's key for it is the route's space id. On the
    // landing there is no space to stamp.
    let spec = spec_bundle(json!({}));
    let (mut s, log) = session(spec, "/space/preview-coasys");
    let (_, origin) = fire_and_origin(&mut s, &log, "space:");
    let space = origin.space.expect("a space route stamps the space");
    assert_eq!(
        s.runtime.handles().key(space.handle()).as_deref(),
        Some("preview-coasys"),
        "the handle resolves to the route's space id"
    );

    let spec = spec_bundle(json!({}));
    let (mut s, log) = session(spec, "/");
    let (_, origin) = fire_and_origin(&mut s, &log, "app:");
    assert_eq!(origin.space, None, "the landing has no open space");
    assert_eq!(origin.tier, Tier::App);

    // A single explicit mount on a space route inherits the open space —
    // `Session::offline`'s mount is about the space the route names.
    let spec = RootSpec::single(tap_node(), "test");
    let (mut s, log) = session(spec, "/space/preview-coasys");
    let (_, origin) = fire_and_origin(&mut s, &log, "test:");
    let space = origin.space.expect("the route's space fills the mount");
    assert_eq!(
        s.runtime.handles().key(space.handle()).as_deref(),
        Some("preview-coasys")
    );
}

/// The `ds` a cell's key carries — parsed back the way a capture lookup
/// reads it.
fn ds_of(key: &we_template::QueryKey) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(key.as_str()).ok()?["ds"]
        .as_str()
        .map(str::to_string)
}

#[test]
fn two_spaces_do_not_share_a_cell() {
    // `Here` is keyed by the mount's space: one `$queries` block in two
    // spaces compiles to two pool cells — one per space — or the second
    // space's template would read the first space's rows.
    let mut s = Session::offline(
        RootSpec::single(
            schema(json!({
                "type": "Column",
                "$queries": { "q": { "entity": "Post" } },
                "children": []
            })),
            "test",
        ),
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/space/demo-a"),
    );
    let _ = s.resolve();
    let keys: Vec<_> = s
        .runtime
        .pool()
        .cells()
        .iter()
        .map(|c| c.key.clone())
        .collect();
    assert_eq!(keys.len(), 1, "the first space's query is one cell");
    assert_eq!(
        ds_of(&keys[0]).as_deref(),
        Some("demo-a"),
        "`Here` keys by the mount's space"
    );

    s.screen.apply(ScreenOp::Navigate {
        to: "/space/demo-b".into(),
        query: None,
        base_depth: None,
        replace: false,
    });
    let _ = s.resolve();
    let mut datasets: Vec<_> = s
        .runtime
        .pool()
        .cells()
        .iter()
        .filter_map(|c| ds_of(&c.key))
        .collect();
    datasets.sort();
    assert_eq!(
        datasets,
        ["demo-a".to_string(), "demo-b".to_string()],
        "the same question in a second space is a second cell"
    );
}
