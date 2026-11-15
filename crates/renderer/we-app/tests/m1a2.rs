//! M1 round A2 — the app frame no longer owns the glyph policy. A harness
//! that asks for `MissingGlyphPolicy::Panic` (kittest's default) must get a
//! strict frame from `frame_body`: a codepoint no installed font has panics.
//! Round A's `install_media` reset the policy to `Tofu` on every frame, so
//! no harness could ever render strictly.
use std::sync::Arc;

use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{SchemaNode, StoreBag};

fn app_with_text(text: &str) -> RendererApp {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "meta": { "name": "glyphs", "description": "", "icon": "text-aa" },
        "children": [{ "type": "we-text", "props": { "text": text } }]
    }))
    .expect("schema parses");
    RendererApp::new(
        schema,
        "glyphs",
        Arc::new(StoreBag::default()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    )
}

/// U+10FFFE is a noncharacter no font has. Under the harness's `Panic`
/// policy `frame_body` must not quietly downgrade it to tofu.
#[test]
#[should_panic(expected = "No glyph")]
fn a_strict_harness_gets_a_strict_frame() {
    let app = app_with_text("strict \u{10FFFE}");
    let mut harness = egui_kittest::Harness::builder()
        .with_context_setup(we_egui::install_media)
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(2);
}

// --- Every C2a route's resolved app tree has unique node ids. ---

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../../we-data/data/storemap-offline.json");

/// The ten routes C2a recorded — `coasys_shots.rs`'s list.
const ROUTES: [&str; 10] = [
    "index",
    "workflows",
    "channels",
    "channel-design",
    "calls",
    "call",
    "people",
    "dna",
    "person",
    "about",
];

/// The resolved app root for route `id`, built as `coasys_shots.rs` does
/// (`Runtime::app` over `OfflineData::from_route`) and resolved until its
/// queries settle.
fn resolved_route(truth: &serde_json::Value, id: &str) -> we_template::ResolvedNode {
    use we_data::{OfflineData, StoreMap};
    use we_template::{AppSpec, Bundle, LocalState, NoParts, Runtime, StaticHost};

    let map = StoreMap::parse(SEED_MAP).unwrap();
    let data = OfflineData::from_route(truth, id, Some(&map)).unwrap();
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let screen = ScreenState::desktop(
        ScreenSchema {
            pages: bundle
                .pages
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            ..ScreenSchema::default()
        },
        truth["routes"][id]["rust"].as_str().unwrap(),
    );
    let placeholder: SchemaNode =
        serde_json::from_value(serde_json::json!({ "type": "Column" })).unwrap();
    let registry = Registry::with_builtins();
    let types: std::collections::HashSet<&'static str> = registry.type_names().collect();
    let mut app = RendererApp::new(placeholder, "coasys", data.bag.clone(), screen, registry);
    let locals = LocalState::new();
    app.session.runtime = Runtime::app(spec, data.bag.clone(), locals.clone())
        .with_sources(Some(data.source()), Arc::new(NoParts))
        .with_dollar_types(move |ty| types.contains(ty));
    app.session.host = Box::new(StaticHost::new(data.bag.clone()));
    for _ in 0..4 {
        app.session.resolve();
    }
    app.session.runtime.resolved().unwrap().as_ref().clone()
}

fn ids<'a>(n: &'a we_template::ResolvedNode, out: &mut Vec<&'a str>) {
    out.push(n.id.as_str());
    for c in &n.children {
        if let we_template::ResolvedChild::Node(x) = c {
            ids(x, out);
        }
    }
}

/// Ids key layout rects, paint state and dispatch. The runtime assembles
/// the app tree from the chrome mount, the space/page mounts and two
/// synthetic wrappers (`root`, `frame`) — round A found `root` reusing the
/// chrome's `app:`. Run with `--release` to see this assertion rather than
/// the runtime's own `debug_assert!`.
#[test]
fn every_c2a_route_resolves_an_app_tree_with_unique_ids() {
    let truth: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
    for id in ROUTES {
        let root = resolved_route(&truth, id);
        let mut all = Vec::new();
        ids(&root, &mut all);
        assert!(
            all.len() > 50,
            "{id}: the app tree resolved ({} nodes)",
            all.len()
        );
        let mut seen = std::collections::HashSet::new();
        let dups: Vec<&str> = all.iter().copied().filter(|i| !seen.insert(*i)).collect();
        assert!(dups.is_empty(), "{id}: duplicate node ids {dups:?}");
    }
}
