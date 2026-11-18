//! PNG of the three space graphs over the coasys fixture.
//!
//! `WE_SAVE_GRAPH_SHOTS=1` writes `crates/renderer/notes-e16/{schema,knowledge,content}.png`.
//! The gate renders each view and checks a label. It does not write files.
#[path = "support/gpu.rs"]
mod gpu;

use std::sync::Arc;

use egui::Vec2;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use indexmap::IndexMap;
use we_egui::{
    install_coasys_fixture, layout, paint, EditState, MeasureCx, Registry, StyleCx, WidgetEvent,
};
use we_expr::Value;
use we_template::{NodeId, ResolvedNode};

const W: f32 = 1280.0;
const H: f32 = 800.0;

fn s(v: &str) -> Value {
    Value::from(v)
}
fn n(v: f64) -> Value {
    Value::from(v)
}
fn obj(pairs: &[(&str, Value)]) -> Value {
    Value::from(
        pairs
            .iter()
            .map(|(k, v)| (Arc::<str>::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
    )
}
fn list(items: Vec<Value>) -> Value {
    Value::List(Arc::new(items))
}

fn view_node(kind: &str) -> ResolvedNode {
    let (seeds, expansion) = match kind {
        "schema" => (
            obj(&[("source", s("schema"))]),
            obj(&[("defaultDepth", n(0.0))]),
        ),
        "knowledge" => (
            list(vec![
                obj(&[
                    ("source", s("query")),
                    (
                        "options",
                        obj(&[("entity", s("CollectionBlock")), ("limit", n(40.0))]),
                    ),
                ]),
                obj(&[
                    ("source", s("query")),
                    (
                        "options",
                        obj(&[("entity", s("Relationship")), ("limit", n(60.0))]),
                    ),
                ]),
            ]),
            obj(&[
                ("defaultDepth", n(1.0)),
                ("direction", s("out")),
                ("limit", n(20.0)),
                ("maxNodes", n(500.0)),
            ]),
        ),
        "content" => (
            obj(&[
                ("source", s("query")),
                (
                    "options",
                    obj(&[("entity", s("CollectionBlock")), ("limit", n(30.0))]),
                ),
            ]),
            obj(&[
                ("defaultDepth", n(1.0)),
                ("direction", s("out")),
                ("expanders", list(vec![s("collection")])),
                ("maxNodes", n(400.0)),
            ]),
        ),
        other => panic!("unknown view {other}"),
    };
    let mut node = ResolvedNode {
        id: NodeId::from(kind),
        ty: Arc::from("GraphView"),
        props: IndexMap::new(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        surfaces: Default::default(),
        transition: None,
    };
    node.props.insert(Arc::from("seeds"), seeds);
    node.props.insert(Arc::from("expansion"), expansion);
    node.props.insert(
        Arc::from("layout"),
        obj(&[
            ("type", s("force")),
            ("options", obj(&[("distance", n(130.0))])),
        ]),
    );
    node
}

fn render(kind: &str, label: &str) {
    let root = view_node(kind);
    let registry = Registry::with_builtins();
    let mut harness = Harness::builder()
        .renderer(gpu::serial())
        .with_size(Vec2::new(W, H))
        .with_pixels_per_point(1.0)
        .build_ui(move |ui| {
            let ctx = ui.ctx().clone();
            install_coasys_fixture(&ctx);
            we_egui::install_media(&ctx);
            let scx = StyleCx::empty();
            let lay = layout(
                &MeasureCx::new(&ctx),
                &scx,
                &registry,
                &root,
                egui::Rect::from_min_size(egui::Pos2::ZERO, Vec2::new(W, H)),
            );
            let mut events: Vec<WidgetEvent> = Vec::new();
            let mut edit = EditState::default();
            paint(
                ui,
                &registry,
                &scx,
                &root,
                &lay,
                &mut events,
                &mut edit,
                0.0,
            );
        });
    harness.run();
    harness.get_by_label(label);
    harness.get_by_label("zoom 100%");
    let image = harness.render().expect("wgpu render");
    assert!(image.width() == W as u32 && image.height() == H as u32);
    let ink = image
        .pixels()
        .filter(|p| p[0] != p[1] || p[1] != p[2])
        .count();
    assert!(ink > 100, "{kind} has too little ink ({ink})");
    if std::env::var_os("WE_SAVE_GRAPH_SHOTS").is_some() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../notes-e16")
            .join(format!("{kind}.png"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        image.save(&path).unwrap();
    }
}

#[test]
fn schema_view_shot() {
    render("schema", "AgentSettings");
}

#[test]
fn knowledge_view_shot() {
    render("knowledge", "Weekly sync");
}

#[test]
fn content_view_shot() {
    render("content", "Weekly sync");
}
