//! M1a — the app frame's geometry on the real Coasys bundle: the resolved
//! root fills the viewport, `meta.frame`'s left band (the icon rail) is
//! carved off as the content viewport the mounted space fills, and a
//! `position: fixed` child with `height: 100%` spans the viewport instead
//! of collapsing against its zero-height static wrapper.
use std::sync::Arc;

use egui::Vec2;
use egui_kittest::Harness;
use serde_json::Value as Json;
use we_app::gallery::load_theme_set;
use we_app::RendererApp;
use we_data::{OfflineData, StoreMap};
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, Bundle, LocalState, NoParts, ResolvedChild, ResolvedNode, Runtime, SchemaNode,
    StaticHost,
};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../../we-data/data/storemap-offline.json");

fn app_for(truth: &Json, id: &str) -> RendererApp {
    let map = StoreMap::parse(SEED_MAP).unwrap();
    let data = OfflineData::from_route(truth, id, Some(&map)).unwrap();
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let spec = AppSpec {
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let path = truth["routes"][id]["rust"].as_str().unwrap();
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
        path,
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
    app.session.host = StaticHost::new(data.bag.clone(), locals);
    app
}

/// The resolved tree + its layout at the 1280×800 test viewport, laid out
/// exactly as `frame_body` does.
fn app_layout(id: &str) -> (ResolvedNode, we_egui::Layout) {
    let truth: Json = serde_json::from_str(SNAPSHOT).unwrap();
    let set = load_theme_set();
    let (theme, _) = set.theme("light");
    let mut app = app_for(&truth, id);
    app.theme = theme.clone();

    let mut harness = Harness::builder()
        .with_size(Vec2::new(1280.0, 800.0))
        .with_pixels_per_point(1.0)
        .with_context_setup(we_egui::install_media)
        .with_accessibility_check(false)
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(3);

    let app = harness.state();
    let root = app.session.runtime.resolved().unwrap().as_ref().clone();
    let ctx = harness.ctx.clone();
    let mcx = we_egui::MeasureCx::new(&ctx);
    let tokens = app.theme.tokens.clone();
    let scx = we_egui::StyleCx {
        tokens: &tokens,
        viewport: we_style::Size::new(1280.0, 800.0),
        container_width: 1280.0,
        ..we_egui::StyleCx::empty()
    };
    let lay = we_egui::layout(
        &mcx,
        &scx,
        &app.registry,
        &root,
        egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1280.0, 800.0)),
    );
    (root, lay)
}

fn find(n: &ResolvedNode, pred: &dyn Fn(&ResolvedNode) -> bool, out: &mut Vec<ResolvedNode>) {
    if pred(n) {
        out.push(n.clone());
    }
    for c in &n.children {
        if let ResolvedChild::Node(x) = c {
            find(x, pred, out);
        }
    }
}

/// Fix 3 — the web root is `min-height: 100vh`: the resolved root fills
/// the viewport, the content viewport sits right of the 72px rail band
/// (`meta.frame.left`), and the mounted space Row fills it at `100%`.
#[test]
fn app_root_fills_the_viewport_and_offsets_the_frame() {
    let (root, lay) = app_layout("index");
    assert_eq!(
        lay.size,
        egui::vec2(1280.0, 800.0),
        "the page fills the viewport, not a content-height strip"
    );
    let frame = lay
        .rects
        .get(&we_template::NodeId::from("frame"))
        .copied()
        .expect("the content viewport is in the tree");
    assert_eq!(
        frame,
        egui::Rect::from_min_size(egui::pos2(72.0, 0.0), egui::vec2(1208.0, 800.0)),
        "meta.frame.left=72 carves the rail band off the viewport"
    );
    let mut space = Vec::new();
    find(&root, &|n| n.id.as_str() == "space:", &mut space);
    let space = space.first().expect("the space mount resolved");
    let r = lay.rects.get(&space.id).copied().expect("space rect");
    assert!(
        (r.min.x - 72.0).abs() < 0.5 && (r.height() - 800.0).abs() < 0.5,
        "the space Row fills the content viewport at 100%: {r:?}"
    );
}
