//! N2 (Lal, E3c-8a r3): collapsed lanes at Space. The design rule is
//! "undeclared lanes are App": a Space template sees the collapse state of
//! the lanes it declares (`meta.panels[].home`) and of no other — not
//! chrome's, not another template's — through every spelling, and its
//! own `$panels` outlet for an undeclared lane resolves expanded.
use std::sync::Arc;

use serde_json::json;
use we_expr::{MountCx, Value};
use we_legacy::LegacyBindings;
use we_screen::{ScreenOp, ScreenSchema, ScreenState};
use we_template::{
    Declared, LocalState, ResolvedChild, ResolvedNode, RootSpec, Runtime, SchemaNode, StaticHost,
    StoreBag,
};

/// Every spelling of the collapsed-lane list. (`screen.collapsedLanes`,
/// the flattened form, is not answered by the view at any tier.)
const READS: [&str; 3] = [
    "screen.shell.collapsedLanes",
    "shellStore.collapsedLanes",
    "legacy.shellStore.collapsedLanes",
];

fn tree() -> SchemaNode {
    let mut children: Vec<_> = READS
        .iter()
        .map(|src| json!({ "type": "Text", "props": { "t": { "$": src } } }))
        .collect();
    // An outlet for chrome's lane, and one for the template's own.
    children.push(json!({ "type": "$panels", "props": { "lane": "chrome-side" } }));
    children.push(json!({ "type": "$panels", "props": { "lane": "tree" } }));
    serde_json::from_value(json!({ "type": "Column", "children": children })).unwrap()
}

fn walk(n: &ResolvedNode, texts: &mut Vec<Value>, outlets: &mut Vec<Value>) {
    if let Some(v) = n.props.get("t") {
        texts.push(v.clone());
    }
    if let Some(v) = n.props.get("collapsed") {
        outlets.push(v.clone());
    }
    for c in &n.children {
        if let ResolvedChild::Node(n) = c {
            walk(n, texts, outlets);
        }
    }
}

/// The four reads and the two outlets' `collapsed`, with chrome's lane
/// and `tree` both collapsed in the session.
fn render(cx: MountCx, declared: Declared) -> (Vec<Value>, Vec<Value>) {
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::from_spec(
        RootSpec::Single {
            node: Box::new(tree()),
            cx,
            declared,
        },
        bag.clone(),
        LocalState::new(),
    );
    let legacy = LegacyBindings::install(rt.layer(), rt.view());
    rt.set_bindings(Arc::new(legacy));
    let mut screen = ScreenState::desktop(ScreenSchema::default(), "/");
    for lane in ["chrome-side", "tree"] {
        rt.apply_screen(
            &mut screen,
            ScreenOp::SetLaneCollapsed {
                lane: lane.into(),
                collapsed: true,
            },
        );
    }
    screen.version += 1;
    let mut host = StaticHost::new(bag);
    let root = rt.frame(&mut host, &screen).clone();
    let (mut texts, mut outlets) = (Vec::new(), Vec::new());
    walk(&root, &mut texts, &mut outlets);
    assert_eq!(texts.len(), READS.len(), "{texts:?}");
    assert_eq!(outlets.len(), 2, "{outlets:?}");
    (texts, outlets)
}

fn lanes(v: &Value) -> Vec<String> {
    match v {
        Value::List(items) => {
            let mut out: Vec<String> = items
                .iter()
                .map(|i| match i {
                    Value::Str(s) => s.to_string(),
                    other => panic!("a lane name, got {other:?}"),
                })
                .collect();
            out.sort();
            out
        }
        other => panic!("a lane list, got {other:?}"),
    }
}

fn owning_tree() -> Declared {
    Declared::from_meta(&json!({ "panels": [{ "id": "nav", "home": "tree", "node": {} }] }))
}

#[test]
fn a_space_template_sees_only_the_lanes_it_declares() {
    // App: every collapsed lane in the session, every spelling.
    let (app, outlets) = render(MountCx::explicit_app("app"), Declared::default());
    for (src, v) in READS.iter().zip(&app) {
        assert_eq!(lanes(v), ["chrome-side", "tree"], "App at {src}");
    }
    assert!(
        outlets.iter().all(|c| c.strict_eq(&Value::Bool(true))),
        "{outlets:?}"
    );

    // Space, no lanes declared: no lane's name or state.
    let (space, outlets) = render(MountCx::explicit("space"), Declared::default());
    for (src, v) in READS.iter().zip(&space) {
        assert!(
            lanes(v).is_empty(),
            "a Space template declaring no lane read {src}: {space:?}"
        );
    }
    assert!(
        outlets.iter().all(|c| c.strict_eq(&Value::Bool(false))),
        "an undeclared lane's outlet showed its collapse state at Space: {outlets:?}"
    );

    // Space, owning `tree`: its own lane, never chrome's.
    let (own, outlets) = render(MountCx::explicit("space"), owning_tree());
    for (src, v) in READS.iter().zip(&own) {
        assert_eq!(lanes(v), ["tree"], "a Space template owning tree at {src}");
    }
    assert_eq!(
        outlets
            .iter()
            .map(|c| c.strict_eq(&Value::Bool(true)))
            .collect::<Vec<_>>(),
        [false, true],
        "[chrome-side, tree] outlets for a template owning tree"
    );
}

/// The shipped template that reads `collapsedLanes` at Space (Coasys
/// `templates/0`: `'tree' in shellStore.collapsedLanes` in its routes and
/// its `CollectionBlock:call` record view) declares that lane — a
/// `meta.panels` entry homed in `tree` — so the filter leaves its read
/// intact. The render baselines resolve with no lane collapsed and cannot
/// show this.
#[test]
fn coasys_declares_the_lane_it_reads() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../bundles/coasys.bundle.json"
    );
    let bundle: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let declared = Declared::from_meta(&bundle["templates"][0]["meta"]);
    assert!(
        declared.lanes.iter().any(|l| l.as_ref() == "tree"),
        "{:?}",
        declared.lanes
    );
    let (reads, _) = render(MountCx::explicit("space"), declared);
    for (src, v) in READS.iter().zip(&reads) {
        assert_eq!(lanes(v), ["tree"], "Coasys at {src}");
    }
}
