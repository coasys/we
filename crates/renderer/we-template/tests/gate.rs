//! E3c-8a — the read boundary. Design 4.6.1's rows, 4.6.3's frames and
//! 4.6.5's handle taint, exercised through a `BindingSource` test double
//! and the real `Gate`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use indexmap::IndexMap;
use serde_json::json;
use we_expr::{HandleKind, HandleTable, MapNamespace, MountCx, Value};
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    inert, root_domain, taint_handles, BindingSource, Bound, DataRevision, DatasetHandle,
    DatasetSel, Declared, Gate, Invalidator, MemberTiers, PartDef, PartSource, RootLayer, Roots,
    SchemaNode, StaticHost, StoreBag, Tier,
};
use we_template::{LocalState, ResolvedChild, ResolvedNode, RootSpec, Runtime};

fn map(pairs: &[(&str, Value)]) -> Value {
    Value::Namespace(Arc::new(MapNamespace::new(
        pairs
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
    )))
}

/// The F2 double: a source that answers the v2 root names it knows,
/// profiles from its own bag's `profiles` root, and counts
/// subscriptions — the read-identity contract without a session.
#[derive(Debug)]
struct Double {
    bag: StoreBag,
    rev: AtomicU64,
    subs: AtomicU64,
    /// `name → (value, members)` — a root absent here is unserved.
    roots: Mutex<ServedMap>,
}

type ServedMap = IndexMap<Arc<str>, (Value, Option<MemberTiers>)>;

impl Double {
    fn new() -> Self {
        Double {
            bag: StoreBag::new(),
            rev: AtomicU64::new(1),
            subs: AtomicU64::new(0),
            roots: Mutex::new(ServedMap::new()),
        }
    }
    fn serve(&self, name: &str, value: Value, members: Option<MemberTiers>) {
        self.roots
            .lock()
            .unwrap()
            .insert(name.into(), (value, members));
    }
    fn bump(&self) {
        self.rev.fetch_add(1, Ordering::Relaxed);
    }
}

impl DataRevision for Double {
    fn revision(&self) -> u64 {
        self.rev.load(Ordering::Relaxed)
    }
    fn subscribe(&self, _inv: Invalidator) {
        self.subs.fetch_add(1, Ordering::Relaxed);
    }
}

impl BindingSource for Double {
    fn root(&self, name: &str, _mount: &MountCx) -> Option<Bound> {
        self.roots
            .lock()
            .unwrap()
            .get(name)
            .map(|(value, members)| Bound {
                value: value.clone(),
                members: members.clone(),
                domain: None,
            })
    }
    fn profile(&self, did: &str, _mount: &MountCx) -> Option<Value> {
        match self.bag.root("profiles") {
            Some(Value::Namespace(ns)) => match ns.get(did) {
                Value::Undefined => None,
                v => Some(v),
            },
            _ => None,
        }
    }
    fn ready(&self) -> bool {
        true
    }
    fn compat_roots(&self) -> &[Arc<str>] {
        &[]
    }
}

fn space_auth() -> MountCx {
    MountCx::explicit("space-mount")
}
fn app_auth() -> MountCx {
    MountCx::explicit_app("app-mount")
}

fn gated<'a>(
    layer: &'a RootLayer,
    bag: &'a StoreBag,
    src: &'a Double,
    gate: &'a Arc<Gate>,
    auth: MountCx,
) -> Roots<'a> {
    Roots::new(layer, bag).gated(src, gate, src.compat_roots(), auth, Declared::default())
}

fn get(v: &Value, key: &str) -> Value {
    match v {
        Value::Namespace(ns) => ns.get(key),
        Value::Obj(o) => o.get(key).cloned().unwrap_or(Value::Undefined),
        _ => Value::Undefined,
    }
}

fn obj(pairs: &[(&str, Value)]) -> Value {
    Value::Obj(Arc::new(
        pairs
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
    ))
}

fn rig() -> (Arc<StoreBag>, RootLayer, StoreBag, Double, Arc<Gate>) {
    // RootLayer borrows its bag — keep the bag Arc so callers can clone it.
    let layer_bag = Arc::new(StoreBag::new());
    (
        layer_bag.clone(),
        RootLayer::new(&layer_bag),
        StoreBag::new(),
        Double::new(),
        Arc::new(Gate::new(HandleTable::new())),
    )
}

// ── 4.6.1 root rows ─────────────────────────────────────────────────

#[test]
fn space_tier_cannot_read_the_app_root() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    src.serve("app", map(&[("token", Value::from("secret"))]), None);

    let denied = gated(&layer, &bag, &src, &gate, space_auth());
    assert!(denied.root("app").is_none());
    assert_eq!(gate.denial_count(), 1);

    let allowed = gated(&layer, &bag, &src, &gate, app_auth());
    let app = allowed.root("app").expect("app tier reads app");
    assert!(get(&app, "token").strict_eq(&Value::from("secret")));
}

#[test]
fn space_tier_reads_the_space_domain_roots() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    for name in ["space", "me", "system"] {
        src.serve(name, map(&[("id", Value::from(name))]), None);
        let roots = gated(&layer, &bag, &src, &gate, space_auth());
        assert!(
            get(&roots.root(name).unwrap_or_else(|| panic!("{name}")), "id")
                .strict_eq(&Value::from(name))
        );
    }
    assert_eq!(gate.denial_count(), 0);
}

#[test]
fn an_unknown_root_is_absent_and_never_served() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    // The source knows nothing called `nonsense`; core's table neither.
    assert_eq!(root_domain("nonsense", &[]), None);
    let roots = gated(&layer, &bag, &src, &gate, space_auth());
    assert!(roots.root("nonsense").is_none());
    // And a source that invents an unclassifiable answer is refused too:
    // the Bound domain is the only way a name the table missed is served.
    src.serve("exotic", map(&[]), None);
    let roots = gated(&layer, &bag, &src, &gate, space_auth());
    // `domain: None` on an unclassified name → no domain → absent.
    assert!(roots.root("exotic").is_none());
    // Both refusals are counted (Lal, missing (b)): an unknown root has a
    // verdict — one diagnostic per (mount, name) — not a silent `None`.
    assert_eq!(gate.denial_count(), 2, "unknown roots are counted");
    // Asked again, still one line each.
    assert!(roots.root("nonsense").is_none());
    assert_eq!(gate.denial_count(), 2);
}

// ── 4.6.1 member rows ───────────────────────────────────────────────

#[test]
fn screen_members_filter_by_the_core_table() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    src.serve(
        "screen",
        map(&[
            ("params", map(&[("id", Value::from("s1"))])),
            ("activeShellView", Value::from("dock")),
        ]),
        // A source's own table never weakens core's: even one that would
        // allow everything is overridden by `screen`'s fixed table.
        Some(MemberTiers::from_rows(&[("activeShellView", Tier::Space)])),
    );

    let space = gated(&layer, &bag, &src, &gate, space_auth())
        .root("screen")
        .expect("screen serves at space tier");
    // Space member — readable.
    assert!(get(&get(&space, "params"), "id").strict_eq(&Value::from("s1")));
    // App member — Undefined for space, denial counted.
    assert!(get(&space, "activeShellView").strict_eq(&Value::Undefined));
    // Enumeration does not leak the denied member's name.
    let keys = match &space {
        Value::Namespace(ns) => ns.keys(),
        _ => vec![],
    };
    assert!(!keys.iter().any(|k| k.as_ref() == "activeShellView"));

    let app = gated(&layer, &bag, &src, &gate, app_auth())
        .root("screen")
        .unwrap();
    assert!(get(&app, "activeShellView").strict_eq(&Value::from("dock")));
}

#[test]
fn screen_panels_are_filtered_to_declared_ids() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    src.serve(
        "screen",
        map(&[(
            "panels",
            map(&[
                ("p-mine", map(&[("open", Value::from(true))])),
                ("p-theirs", map(&[("open", Value::from(true))])),
            ]),
        )]),
        None,
    );
    let declared = Declared {
        panels: Arc::from(["p-mine".into()]),
        dialogs: Arc::from([]),
    };
    let roots =
        Roots::new(&layer, &bag).gated(&src, &gate, src.compat_roots(), space_auth(), declared);
    let panels = get(&roots.root("screen").unwrap(), "panels");
    assert!(get(&get(&panels, "p-mine"), "open").strict_eq(&Value::from(true)));
    assert!(get(&panels, "p-theirs").strict_eq(&Value::Undefined));
    let keys = match &panels {
        Value::Namespace(ns) => ns.keys(),
        _ => vec![],
    };
    assert_eq!(keys, vec![Arc::<str>::from("p-mine")]);
}

#[test]
fn a_compat_root_without_a_table_is_refused_wholesale() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    // `legacy` is core-classified Compat; the source serves it bare.
    src.serve("legacy", map(&[("sessionStore", map(&[]))]), None);
    let roots = gated(&layer, &bag, &src, &gate, space_auth());
    assert!(roots.root("legacy").is_none());
    assert_eq!(gate.denial_count(), 1);
}

#[test]
fn compat_members_respect_the_table_at_both_tiers() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    let compat: Arc<Vec<Arc<str>>> = Arc::new(vec!["sessionStore".into()]);
    src.serve(
        "sessionStore",
        map(&[
            ("loggedIn", Value::from(true)),
            ("agentUrl", Value::from("wss://x")),
        ]),
        Some(MemberTiers::from_rows(&[
            ("loggedIn", Tier::Space),
            ("agentUrl", Tier::App),
        ])),
    );
    let roots = Roots::new(&layer, &bag).gated(
        &src,
        &gate,
        compat.as_ref(),
        space_auth(),
        Declared::default(),
    );
    let session = roots.root("sessionStore").expect("compat root serves");
    assert!(get(&session, "loggedIn").strict_eq(&Value::from(true)));
    assert!(get(&session, "agentUrl").strict_eq(&Value::Undefined));
    // Unlisted member — denied.
    assert!(get(&session, "unlisted").strict_eq(&Value::Undefined));

    let app_roots = Roots::new(&layer, &bag).gated(
        &src,
        &gate,
        compat.as_ref(),
        app_auth(),
        Declared::default(),
    );
    assert!(get(&app_roots.root("sessionStore").unwrap(), "agentUrl")
        .strict_eq(&Value::from("wss://x")));
}

// ── 4.6.3 frames ────────────────────────────────────────────────────

#[test]
fn a_space_tier_part_cannot_read_its_callers_app_roots() {
    struct Parts;
    impl PartSource for Parts {
        fn part(&self, id: &str) -> Option<PartDef> {
            (id == "mod-widget").then(|| PartDef {
                schema: Arc::new(
                    serde_json::from_value::<SchemaNode>(json!({
                        "type": "Text",
                        "props": { "t": { "$": "app.token" } }
                    }))
                    .unwrap(),
                ),
                // The module's own stamp — Space; the caller is App.
                tier: Tier::Space,
                module: "mod".into(),
                needs: Arc::from([]),
            })
        }
    }
    let bag = StoreBag::from_snapshot(&json!({
        "stores": { "app": { "token": "secret" } }, "queries": {}, "invokes": {}
    }))
    .unwrap();
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "Column",
        "children": [
            { "type": "Text", "props": { "t": { "$": "app.token" } } },
            { "type": "$part", "props": { "id": "mod-widget" } }
        ]
    }))
    .unwrap();
    let bag = Arc::new(bag);
    let mut rt = Runtime::from_spec(
        RootSpec::Single {
            node: Box::new(node),
            cx: app_auth(),
            declared: we_template::Declared::default(),
        },
        bag.clone(),
        LocalState::new(),
    )
    .with_sources(None, Arc::new(Parts));
    // Gate the runtime: the default `BagBindings` serves the bag's `app`
    // root — denied at the part's space tier, allowed at the caller's.
    let mut host = StaticHost::new(bag);
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let root = rt.frame(&mut host, &screen).clone();

    // The caller's own read resolves; the part's is Undefined (inert
    // text falls through to the placeholder empty string).
    fn texts(n: &ResolvedNode, out: &mut Vec<(String, Value)>) {
        if let Some(v) = n.props.get("t") {
            out.push((n.ty.to_string(), v.clone()));
        }
        for c in &n.children {
            if let ResolvedChild::Node(n) = c {
                texts(n, out);
            }
        }
    }
    let mut ts = Vec::new();
    texts(&root, &mut ts);
    assert!(ts[0].1.strict_eq(&Value::from("secret")));
    assert!(ts[1].1.strict_eq(&Value::Undefined));
    assert!(rt.gate().denial_count() >= 1);
}

#[test]
fn values_crossing_into_a_part_are_made_inert() {
    let table = HandleTable::new();
    let h = table.mint(HandleKind::Dataset, "d");

    // A namespace — a root, a filtered view — never crosses.
    let ns = map(&[("token", Value::from("x"))]);
    assert!(inert(&ns).strict_eq(&Value::Undefined));
    // A handle crosses tainted: held and compared, never usable.
    let crossed = inert(&Value::handle(h));
    match &crossed {
        Value::Namespace(ns) => assert!(ns.as_handle().unwrap().is_tainted()),
        _ => panic!("handle expected"),
    }
    // Plain data survives whole; the inside of containers is scrubbed.
    let data = Value::List(Arc::new(vec![
        Value::from("a"),
        obj(&[("ok", Value::from(1.0)), ("ns", ns)]),
    ]));
    let out = inert(&data);
    let Value::List(items) = &out else {
        panic!("list")
    };
    assert!(items[0].strict_eq(&Value::from("a")));
    assert!(get(&items[1], "ok").strict_eq(&Value::from(1.0)));
    assert!(get(&items[1], "ns").strict_eq(&Value::Undefined));
}

// ── 4.6.5 handles ───────────────────────────────────────────────────

#[test]
fn dataset_selection_denies_space_and_foreign_or_tainted_handles() {
    let table = HandleTable::new();
    let gate = Gate::new(table.clone());

    // `Here` is always allowed — both tiers.
    assert!(gate.dataset(&space_auth(), &DatasetSel::Here).allowed());
    assert!(gate.dataset(&app_auth(), &DatasetSel::Here).allowed());

    // A named dataset needs App tier AND a handle this table knows.
    let h = table.mint(HandleKind::Dataset, "ds1");
    let sel = DatasetSel::Named(DatasetHandle::from_handle(h));
    assert!(!gate.dataset(&space_auth(), &sel).allowed());
    assert!(gate.dataset(&app_auth(), &sel).allowed());

    // A foreign table's handle — minted elsewhere — is refused.
    let foreign = HandleTable::new().mint(HandleKind::Dataset, "ds1");
    let sel = DatasetSel::Named(DatasetHandle::from_handle(foreign));
    assert!(!gate.dataset(&app_auth(), &sel).allowed());

    // A tainted handle is refused even at App tier.
    let tainted = table.mint(HandleKind::Dataset, "ds2").tainted();
    let sel = DatasetSel::Named(DatasetHandle::from_handle(tainted));
    assert!(!gate.dataset(&app_auth(), &sel).allowed());
}

#[test]
fn taint_handles_recurses_and_leaves_plain_data_alone() {
    let table = HandleTable::new();
    let h = table.mint(HandleKind::Dataset, "d");
    let v = Value::List(Arc::new(vec![
        Value::handle(h.clone()),
        obj(&[("inner", Value::handle(h))]),
        Value::from("plain"),
    ]));
    let out = taint_handles(&v);
    let Value::List(items) = &out else {
        panic!("list")
    };
    match &items[0] {
        Value::Namespace(ns) => assert!(ns.as_handle().expect("handle").is_tainted()),
        _ => panic!("handle namespace expected"),
    }
    match get(&items[1], "inner") {
        Value::Namespace(ns) => assert!(ns.as_handle().expect("handle").is_tainted()),
        _ => panic!("tainted handle inside the object expected"),
    }
    assert!(items[2].strict_eq(&Value::from("plain")));
}

// ── the source contract (F2's read identity, on the trait) ──────────

#[test]
fn the_source_answers_profiles_revisions_and_subscriptions() {
    let mut src = Double::new();
    src.bag = StoreBag::from_snapshot(&json!({
        "stores": { "profiles": { "did:1": { "name": "Ana" } } },
        "queries": {}, "invokes": {}
    }))
    .unwrap();
    let src = src;
    let layer_bag = Arc::new(StoreBag::new());
    let (layer, bag) = (RootLayer::new(&layer_bag), StoreBag::new());
    let gate = Arc::new(Gate::new(HandleTable::new()));
    let roots = gated(&layer, &bag, &src, &gate, space_auth());

    // `$agent`'s read — the source's `profile`, not a `profileStore` root.
    let p = roots.profile("did:1").expect("profile served");
    assert!(get(&p, "name").strict_eq(&Value::from("Ana")));
    assert!(roots.profile("did:none").is_none());

    // Revision is the source's word — it moves only when the source says.
    let before = src.revision();
    src.bump();
    assert_eq!(src.revision(), before + 1);
}

#[test]
fn two_views_one_source_stay_isolated_by_authority() {
    // E3c-6 across the boundary: two sessions share one bag+source; the
    // gate, not the store, decides who reads `app`. Neither view can
    // widen the other.
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    src.serve("app", map(&[("token", Value::from("t"))]), None);
    src.serve("space", map(&[("id", Value::from("s"))]), None);

    let space_view = gated(&layer, &bag, &src, &gate, space_auth());
    let app_view = gated(&layer, &bag, &src, &gate, app_auth());

    assert!(space_view.root("app").is_none());
    assert!(app_view.root("app").is_some());
    // The space view still reads what its tier grants.
    assert!(space_view.root("space").is_some());
    // One denial, for the space view's `app` ask — the app view's ask
    // logged none.
    assert_eq!(gate.denial_count(), 1);
}

// ── Round 2 (Lal) ───────────────────────────────────────────────────

/// A source that refuses everything — every root, every profile — for
/// every mount: the deliberate denial a gated path must treat as final.
#[derive(Debug)]
struct Refusing;

impl DataRevision for Refusing {
    fn revision(&self) -> u64 {
        1
    }
    fn subscribe(&self, _inv: Invalidator) {}
}

impl BindingSource for Refusing {
    fn root(&self, _name: &str, _mount: &MountCx) -> Option<Bound> {
        None
    }
    fn profile(&self, _did: &str, _mount: &MountCx) -> Option<Value> {
        None
    }
}

fn texts(n: &ResolvedNode, out: &mut Vec<Value>) {
    if let Some(v) = n.props.get("t") {
        out.push(v.clone());
    }
    for c in &n.children {
        if let ResolvedChild::Node(n) = c {
            texts(n, out);
        }
    }
}

/// F1 (Lal): a source's profile refusal is final. The shared bag holds
/// the profile (another consumer cached it); a Space mount and a module
/// part, both behind a source that refuses the DID, must bind the `{did}`
/// stub — never the bag's row.
#[test]
fn a_refused_profile_is_not_read_from_the_bag() {
    struct Parts;
    impl PartSource for Parts {
        fn part(&self, id: &str) -> Option<PartDef> {
            (id == "card").then(|| PartDef {
                schema: Arc::new(
                    serde_json::from_value::<SchemaNode>(json!({
                        "type": "$agent", "props": { "did": "did:a" },
                        "children": [{ "type": "Text", "props": { "t": { "$": "agent.name" } } }]
                    }))
                    .unwrap(),
                ),
                tier: Tier::Space,
                module: "mod".into(),
                needs: Arc::from([]),
            })
        }
    }
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": { "profileStore": { "profiles": { "did:a": { "did": "did:a", "name": "Ana" } } } },
            "queries": {}, "invokes": {}
        }))
        .unwrap(),
    );
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "Column",
        "children": [
            { "type": "$agent", "props": { "did": "did:a" },
              "children": [{ "type": "Text", "props": { "t": { "$": "agent.name" } } }] },
            { "type": "$part", "props": { "id": "card" } }
        ]
    }))
    .unwrap();
    let mut rt = Runtime::from_spec(
        RootSpec::Single {
            node: Box::new(node),
            cx: space_auth(),
            declared: Declared::default(),
        },
        bag.clone(),
        LocalState::new(),
    )
    .with_sources(None, Arc::new(Parts));
    rt.set_bindings(Arc::new(Refusing));
    let mut host = StaticHost::new(bag);
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let mut ts = Vec::new();
    texts(&root, &mut ts);
    assert_eq!(ts.len(), 2, "both $agent bodies resolve: {ts:?}");
    for t in &ts {
        assert!(
            t.strict_eq(&Value::Undefined),
            "refused profile leaked from the bag: {ts:?}"
        );
    }
}

/// F3 (Lal): a bare `Runtime` — no classified source installed — must not
/// serve a host's unclassified bag roots to a Space mount. The bag holds
/// `sessionStore`; the default source has no member table for it, so the
/// read is refused and counted, never labelled Space.
#[test]
fn a_bare_runtime_does_not_serve_unclassified_bag_roots_to_space() {
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": { "sessionStore": { "bootState": "secret-boot" } },
            "queries": {}, "invokes": {}
        }))
        .unwrap(),
    );
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "Text", "props": { "t": { "$": "sessionStore.bootState" } }
    }))
    .unwrap();
    let mut rt = Runtime::new(node, "space-mount", bag.clone(), LocalState::new());
    let mut host = StaticHost::new(bag);
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let mut ts = Vec::new();
    texts(&root, &mut ts);
    assert!(
        ts[0].strict_eq(&Value::Undefined),
        "unclassified bag root served to Space: {ts:?}"
    );
    assert_eq!(rt.gate().denial_count(), 1, "the refusal is counted");
}

// ── F4: cross-authority payloads ────────────────────────────────────

/// A namespace carrying `token`, filtered by the gate for an App mount —
/// it keeps App's view whoever reads it later.
fn app_filtered_token() -> Value {
    let gate = Arc::new(Gate::new(HandleTable::new()));
    gate.serve(
        "x",
        we_template::RootDomain::Space,
        Bound {
            value: map(&[("token", Value::from("app-secret"))]),
            members: Some(MemberTiers::from_rows(&[("token", Tier::App)])),
            domain: None,
        },
        &app_auth(),
        &Declared::default(),
    )
    .expect("served at App")
}

/// A payload carrying another frame's authority three ways: an
/// App-filtered namespace, a raw namespace, and an accessor whose answer
/// is App data.
fn smuggling_payload() -> Value {
    obj(&[
        ("app", app_filtered_token()),
        ("raw", map(&[("token", Value::from("raw-secret"))])),
        (
            "acc",
            Value::Callable(we_expr::CallableRef::accessor("acc", |_| {
                Value::from("acc-secret")
            })),
        ),
        ("plain", Value::from("ok")),
    ])
}

/// Rows for any request: one row holding the smuggling payload.
struct Smuggler;
impl we_template::QuerySource for Smuggler {
    fn open(
        &self,
        _ticket: we_template::SubTicket,
        _request: &we_template::QueryRequest,
        _handles: &HandleTable,
        sink: we_template::QuerySink,
    ) {
        sink.deliver(we_template::QueryEvent::Rows(Arc::new(vec![
            smuggling_payload(),
        ])));
    }
    fn close(&self, _ticket: we_template::SubTicket) {}
}

/// Parks every `$invoke` so the test completes it by hand.
#[derive(Default)]
struct Parking(Vec<we_template::Completer>);
impl we_template::Host for Parking {
    fn act(
        &mut self,
        _request: we_template::ActionRequest,
        done: we_template::Completer,
    ) -> we_template::Invoked {
        self.0.push(done);
        we_template::Invoked::Pending
    }
}

fn smuggle_tree() -> SchemaNode {
    let reads = |src: &str| {
        json!([
            { "type": "Text", "props": { "t": { "$": format!("{src}.app.token") } } },
            { "type": "Text", "props": { "t": { "$": format!("{src}.raw.token") } } },
            { "type": "Text", "props": { "t": { "$": format!("{src}.acc") } } },
            { "type": "Text", "props": { "t": { "$": format!("{src}.plain") } } }
        ])
    };
    let mut children = vec![json!({
        "type": "Button",
        "props": { "onClick": {
            "$invoke": "storeX.slow",
            "onSuccess": [{ "$setLocal": "got", "value": { "$": "result" } }]
        } }
    })];
    children.extend(reads("first(local.rows)").as_array().unwrap().clone());
    children.extend(reads("local.got").as_array().unwrap().clone());
    serde_json::from_value(json!({
        "type": "Column",
        "$localState": { "got": { "type": "object", "initial": null } },
        "$queries": { "rows": { "entity": "Task" } },
        "children": children
    }))
    .unwrap()
}

/// F4 (Lal): a query row and an `onSuccess` payload delivered into a
/// Space frame cannot carry another authority — an App-filtered
/// namespace, a raw namespace and an accessor inside them read Undefined
/// there; plain data survives.
#[test]
fn query_rows_and_callback_payloads_carry_no_foreign_authority() {
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::from_spec(
        RootSpec::Single {
            node: Box::new(smuggle_tree()),
            cx: space_auth(),
            declared: Declared::default(),
        },
        bag.clone(),
        LocalState::new(),
    )
    .with_sources(Some(Arc::new(Smuggler)), Arc::new(we_template::NoParts));
    let mut host = Parking::default();
    let mut screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let button = match &root.children[0] {
        ResolvedChild::Node(n) => n.id.clone(),
        _ => panic!("button"),
    };
    rt.dispatch(&mut host, &mut screen, &button, "onClick", Value::Null);
    let done = host.0.pop().expect("parked");
    let call = done.call_id();
    rt.complete(&mut host, &mut screen, call, Ok(smuggling_payload()));
    let root = rt.frame(&mut host, &screen).clone();
    let mut ts = Vec::new();
    texts(&root, &mut ts);
    assert_eq!(ts.len(), 8, "{ts:?}");
    let undefined = |v: &Value| v.strict_eq(&Value::Undefined);
    // Query row: app / raw / accessor stripped, plain kept.
    assert!(
        ts[..3].iter().all(undefined),
        "query row carried a foreign authority: {ts:?}"
    );
    assert!(ts[3].strict_eq(&Value::from("ok")), "{ts:?}");
    // Callback payload: the same.
    assert!(
        ts[4..7].iter().all(undefined),
        "onSuccess payload carried a foreign authority: {ts:?}"
    );
    assert!(ts[7].strict_eq(&Value::from("ok")), "{ts:?}");
}

// ── F2: one policy for screen facts ─────────────────────────────────

/// F2 (Lal; decision: core's screen table is the policy for every
/// spelling). The two screen facts TS grants at Space AND a shipped
/// Coasys template reads at Space — `layoutDirty` (templates/0 panel
/// body) and `collapsedLanes` (templates/0 routes and record view) — are
/// Space in core's own table; the rest of the chrome stays App.
#[test]
fn the_core_screen_table_grants_what_space_templates_read() {
    let tiers = we_template::screen_tiers();
    let tier = |m: &str| match tiers.rule(m) {
        Some(we_template::MemberRule::Member { tier }) => Some(*tier),
        _ => None,
    };
    assert_eq!(tier("layoutDirty"), Some(Tier::Space));
    assert_eq!(tier("collapsedLanes"), Some(Tier::Space));
    for chrome in [
        "activeShellView",
        "spaceSettingsOpen",
        "spaceSettingsTab",
        "panelsHidden",
        "panelMaximised",
        "createSpaceOpen",
        "joinSpaceOpen",
        "themeFork",
    ] {
        assert_eq!(tier(chrome), Some(Tier::App), "{chrome}");
    }
}

// ── F5: taint by the receiving frame ────────────────────────────────

/// Rows carrying a live handle minted in the runtime's own table.
struct HandleRows;
impl we_template::QuerySource for HandleRows {
    fn open(
        &self,
        _ticket: we_template::SubTicket,
        _request: &we_template::QueryRequest,
        handles: &HandleTable,
        sink: we_template::QuerySink,
    ) {
        let h = handles.mint(HandleKind::Dataset, "ds-1");
        sink.deliver(we_template::QueryEvent::Rows(Arc::new(vec![obj(&[(
            "h",
            Value::handle(h),
        )])])));
    }
    fn close(&self, _ticket: we_template::SubTicket) {}
}

/// A part at `tier` reading a handle from an inline `$each` query and a
/// named `$queries` query.
struct HandleParts(Tier);
impl PartSource for HandleParts {
    fn part(&self, id: &str) -> Option<PartDef> {
        (id == "reader").then(|| PartDef {
            schema: Arc::new(
                serde_json::from_value::<SchemaNode>(json!({
                    "type": "Column",
                    "$queries": { "named": { "entity": "Task" } },
                    "children": [
                        { "type": "$each",
                          "props": { "items": { "$query": { "entity": "Task" } } },
                          "children": [{ "type": "Text", "props": { "t": { "$": "item.h" } } }] },
                        { "type": "Text", "props": { "t": { "$": "first(local.named).h" } } }
                    ]
                }))
                .unwrap(),
            ),
            tier: self.0,
            module: "mod".into(),
            needs: Arc::from([]),
        })
    }
}

fn part_handles(mount: MountCx, part: Tier) -> Vec<bool> {
    let bag = Arc::new(StoreBag::new());
    let node: SchemaNode =
        serde_json::from_value(json!({ "type": "$part", "props": { "id": "reader" } })).unwrap();
    let mut rt = Runtime::from_spec(
        RootSpec::Single {
            node: Box::new(node),
            cx: mount,
            declared: Declared::default(),
        },
        bag.clone(),
        LocalState::new(),
    )
    .with_sources(Some(Arc::new(HandleRows)), Arc::new(HandleParts(part)));
    let mut host = StaticHost::new(bag);
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let mut ts = Vec::new();
    texts(&root, &mut ts);
    ts.iter()
        .map(|v| match v {
            Value::Namespace(ns) => ns.as_handle().expect("a handle").is_tainted(),
            other => panic!("handle expected, got {other:?}"),
        })
        .collect()
}

/// F5 (Lal): every delivery path taints by the RECEIVING frame — inline
/// `$each.items` included. A Space part under an App mount gets tainted
/// handles from both its inline and its named query; an App part under a
/// Space mount gets usable ones.
#[test]
fn query_handles_are_tainted_by_the_receiving_frame() {
    assert_eq!(
        part_handles(app_auth(), Tier::Space),
        vec![true, true],
        "[inline, named] in a Space part under an App mount"
    );
    assert_eq!(
        part_handles(space_auth(), Tier::App),
        vec![false, false],
        "[inline, named] in an App part under a Space mount"
    );
}

// ── F6: declared ids over any map shape ─────────────────────────────

/// F6 (Lal): a `DeclaredIds` member filters an ordinary object map the
/// same as a namespace, and refuses a shape it cannot filter (a list).
#[test]
fn declared_ids_filter_plain_objects_and_refuse_lists() {
    let (layer_bag, layer, bag, src, gate) = rig();
    let _ = &layer_bag;
    src.serve(
        "screen",
        map(&[
            (
                "panels",
                obj(&[
                    ("p-mine", obj(&[("open", Value::from(true))])),
                    ("p-theirs", obj(&[("open", Value::from(true))])),
                ]),
            ),
            (
                "dialogs",
                Value::List(Arc::new(vec![Value::from("d-theirs")])),
            ),
        ]),
        None,
    );
    let declared = Declared {
        panels: Arc::from(["p-mine".into()]),
        dialogs: Arc::from([]),
    };
    let roots =
        Roots::new(&layer, &bag).gated(&src, &gate, src.compat_roots(), space_auth(), declared);
    let screen = roots.root("screen").unwrap();
    let panels = get(&screen, "panels");
    assert!(get(&get(&panels, "p-mine"), "open").strict_eq(&Value::from(true)));
    assert!(
        get(&panels, "p-theirs").strict_eq(&Value::Undefined),
        "an undeclared id in a plain object leaked: {panels:?}"
    );
    let shown: Vec<String> = match &panels {
        Value::Namespace(ns) => ns.keys().iter().map(|k| k.to_string()).collect(),
        Value::Obj(o) => o.keys().map(|k| k.to_string()).collect(),
        _ => vec![],
    };
    assert_eq!(shown, vec!["p-mine".to_string()]);
    assert!(
        get(&screen, "dialogs").strict_eq(&Value::Undefined),
        "a list-shaped id map is refused"
    );
}
