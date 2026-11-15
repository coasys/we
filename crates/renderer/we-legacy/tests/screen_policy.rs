//! F2 (Lal, E3c-8a r2): one policy for screen facts. Core's screen table
//! decides every spelling — a legacy alias (`shellStore.*`, `themeStore.*`,
//! `legacy.<store>.*`) never grants a screen fact at a tier the core table
//! refuses, even where `templateSurface.ts`'s row says Space.
use std::sync::Arc;

use serde_json::json;
use we_expr::{MountCx, Namespace, Value};
use we_legacy::LegacyBindings;
use we_screen::{ScreenOp, ScreenSchema, ScreenState, ThemeFork};
use we_template::{
    Declared, LocalState, ResolvedChild, ResolvedNode, RootSpec, Runtime, SchemaNode, StaticHost,
    StoreBag,
};

const READS: [&str; 9] = [
    // Chrome facts: App in core, Space in the TS rows.
    "shellStore.activeShellView",
    "legacy.shellStore.activeShellView",
    "shellStore.spaceSettingsOpen",
    "shellStore.spaceSettingsTab",
    "themeStore.themeFork",
    "legacy.themeStore.themeFork",
    // Space in both: still readable.
    "shellStore.collapsedLanes",
    "legacy.shellStore.collapsedLanes",
    "routeStore.currentPath",
];

fn tree() -> SchemaNode {
    let children: Vec<_> = READS
        .iter()
        .map(|src| json!({ "type": "Text", "props": { "t": { "$": src } } }))
        .collect();
    serde_json::from_value(json!({ "type": "Column", "children": children })).unwrap()
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

fn render(cx: MountCx) -> Vec<Value> {
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::from_spec(
        RootSpec::Single {
            node: Box::new(tree()),
            cx,
            declared: Declared::default(),
        },
        bag.clone(),
        LocalState::new(),
    );
    let legacy = LegacyBindings::install(rt.layer(), rt.view());
    rt.set_bindings(Arc::new(legacy));
    let mut screen = ScreenState::desktop(ScreenSchema::default(), "/");
    for op in [
        ScreenOp::OpenShellView {
            id: "settings".into(),
            path: None,
        },
        ScreenOp::OpenSpaceSettings {
            tab: Some("roles".into()),
            focus: None,
        },
        ScreenOp::SetLaneCollapsed {
            lane: "tree".into(),
            collapsed: true,
        },
    ] {
        rt.apply_screen(&mut screen, op);
    }
    screen.theme.start_theme_fork(ThemeFork {
        source: "dark".into(),
        name: "Mine".into(),
        icon: "".into(),
    });
    screen.version += 1;
    let mut host = StaticHost::new(bag);
    let root = rt.frame(&mut host, &screen).clone();
    let mut ts = Vec::new();
    texts(&root, &mut ts);
    ts
}

#[test]
fn a_legacy_alias_grants_no_screen_fact_the_core_table_refuses() {
    let app = render(MountCx::explicit_app("app"));
    // At App every spelling reads the live fact (the rig is real).
    for (src, v) in READS.iter().zip(&app) {
        assert!(!v.strict_eq(&Value::Undefined), "App lost {src}: {app:?}");
    }
    let space = render(MountCx::explicit("space"));
    for (src, v) in READS[..6].iter().zip(&space) {
        assert!(
            v.strict_eq(&Value::Undefined),
            "{src} granted at Space through a legacy alias: {space:?}"
        );
    }
    for (src, v) in READS[6..].iter().zip(&space[6..]) {
        assert!(
            !v.strict_eq(&Value::Undefined),
            "Space lost {src}: {space:?}"
        );
    }
}

/// N6 (Lal, E3c-8a r3): every key the `screen` view answers — its own
/// top-level keys and each of `nav`/`shell`/`theme`'s — has a rule in
/// core's screen table. A key added to the view without one fails here
/// (and the legacy aliases refuse it rather than falling back to its
/// `templateSurface.ts` row).
#[test]
fn every_screen_view_key_has_a_core_rule() {
    let core = we_template::screen_tiers();
    let view = we_template::ScreenView::new();
    let top = view.keys();
    assert!(!top.is_empty());
    for key in &top {
        assert!(core.rule(key).is_some(), "screen.{key} has no core rule");
    }
    for overlay in ["nav", "shell", "theme"] {
        let Some(we_template::MemberRule::Container { members, .. }) = core.rule(overlay) else {
            panic!("screen.{overlay} is not a core container");
        };
        let Value::Namespace(face) = view.get(overlay) else {
            panic!("the view does not answer {overlay}");
        };
        let keys = face.keys();
        assert!(!keys.is_empty(), "screen.{overlay} enumerates nothing");
        for key in keys {
            assert!(
                members.rule(&key).is_some(),
                "screen.{overlay}.{key} has no core rule"
            );
        }
    }
}
