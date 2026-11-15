//! F2 (Lal, E3c-8a r2): one policy for screen facts. Core's screen table
//! decides every spelling — a legacy alias (`shellStore.*`, `themeStore.*`,
//! `legacy.<store>.*`) never grants a screen fact at a tier the core table
//! refuses, even where `templateSurface.ts`'s row says Space.
use std::sync::Arc;

use serde_json::json;
use we_expr::{MountCx, Value};
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
