//! Dump the resolved type census for the tree panel.
use std::collections::BTreeMap;
use std::sync::Arc;
use we_app::RendererApp;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{Bundle, ResolvedChild, ResolvedNode, SchemaNode, StoreBag};
use we_widgets::Registry;

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("data/tree-snapshot.json");

fn census(n: &ResolvedNode, out: &mut BTreeMap<String, usize>, ids: &mut Vec<String>) {
    *out.entry(n.ty.to_string()).or_insert(0) += 1;
    ids.push(n.id.as_str().to_string());
    for c in &n.children {
        if let ResolvedChild::Node(x) = c {
            census(x, out, ids);
        }
    }
}

#[test]
fn dump() {
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let schema: SchemaNode = serde_json::from_value(
        bundle.templates.as_deref().unwrap()[0]
            .meta
            .get("panels")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("tree"))
            .and_then(|p| p.get("node"))
            .cloned()
            .unwrap(),
    )
    .unwrap();
    let bag = StoreBag::from_snapshot(&serde_json::from_str(SNAPSHOT).unwrap()).unwrap();
    let app = RendererApp::new(
        schema,
        "tree",
        Arc::new(bag),
        ScreenState::desktop(ScreenSchema::default(), "/space/demo?view=canvas"),
        Registry::with_builtins(),
    );
    let mut harness =
        egui_kittest::Harness::new_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run();
    let root = harness.state().session.runtime.resolved().unwrap().clone();
    let mut m = BTreeMap::new();
    let mut ids = Vec::new();
    census(&root, &mut m, &mut ids);
    for (k, v) in &m {
        println!("{k:30} {v}");
    }
    println!("TOTAL {}", ids.len());
    for i in &ids {
        println!("{i}");
    }
}

/// Release-mode perf reading for the space template alone (no egui):
/// resolve → fill → resolve until the pool is stable, timed per pass.
#[test]
fn space_template_resolve_perf() {
    use we_template::{AppSpec, LocalState, Runtime, StaticHost};
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let bag = Arc::new(StoreBag::from_snapshot(&serde_json::from_str(SNAPSHOT).unwrap()).unwrap());
    let locals = LocalState::new();
    let spec = AppSpec {
        app: None,
        template: bundle.templates.as_deref().unwrap().first().cloned(),
        pages: vec![],
        boot: None,
    };
    let mut rt = Runtime::app(spec, bag.clone(), locals.clone());
    let mut host = StaticHost::new(bag, locals);
    let screen = ScreenState::desktop(ScreenSchema::default(), "/space/demo?view=canvas");
    let root = rt.frame(&mut host, &screen).clone();
    let stats = rt.stats();
    println!(
        "PERF nodes={} resolves={} last_resolve={:?} warnings={}",
        stats.nodes,
        stats.resolves,
        stats.last_resolve,
        stats.warnings.len()
    );
    assert!(stats.nodes > 100);

    // Steady-state: cells already hold rows, so a bumped pool revision buys
    // exactly one resolve pass — the number an interactive frame pays.
    for _ in 0..5 {
        rt.pool().bump();
        let t0 = std::time::Instant::now();
        rt.frame(&mut host, &screen);
        println!("STEADY resolve {:?}", t0.elapsed());
    }
    let _ = root;
}
