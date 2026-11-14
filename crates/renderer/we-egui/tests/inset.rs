//! Inset box-shadows paint inside the padding box (CSS Backgrounds 3
//! §7.1: an inner shadow is drawn inside the padding edge), so a border
//! never covers the band it was meant to frame.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, we_expr::Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

fn s(v: &str) -> we_expr::Value {
    we_expr::Value::from(v)
}

fn obj(pairs: &[(&str, we_expr::Value)]) -> we_expr::Value {
    we_expr::Value::from(
        pairs
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
    )
}

/// The node's laid-out rect + every ClippedShape the frame emitted on the
/// node's layer (the walk's own clip pass runs inside `paint`, so what the
/// collector sees is post-clip output).
fn painted(root: &ResolvedNode) -> (egui::Rect, Vec<egui::epaint::ClippedShape>) {
    let registry = Registry::with_builtins();
    let out = RefCell::new((egui::Rect::NOTHING, Vec::new()));
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        let scx = StyleCx::empty();
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        let rect = lay
            .rects
            .get(&root.id)
            .copied()
            .unwrap_or(egui::Rect::NOTHING);
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let layer = ui.layer_id();
        let shapes: Vec<egui::epaint::ClippedShape> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| list.all_entries().cloned().collect())
                .unwrap_or_default()
        });
        *out.borrow_mut() = (rect, shapes);
    });
    harness.run_steps(2);
    let taken = out.borrow().clone();
    taken
}

/// Every rect shape filled with `color`, as its rect.
fn filled(shapes: &[egui::epaint::ClippedShape], color: egui::Color32) -> Vec<egui::Rect> {
    shapes
        .iter()
        .filter_map(|cs| match &cs.shape {
            egui::Shape::Rect(r) if r.fill == color => Some(r.rect),
            _ => None,
        })
        .collect()
}

#[test]
fn inset_shadow_starts_at_the_padding_edge() {
    let styles = obj(&[
        ("width", s("100px")),
        ("height", s("40px")),
        ("border", s("4px solid #000000")),
        ("box-shadow", s("inset 0 0 0 3px #ff0000")),
    ]);
    let n = node("div", "d", &[("styles", styles)]);
    let (rect, shapes) = painted(&n);
    let red = filled(&shapes, egui::Color32::from_rgb(255, 0, 0));
    assert!(!red.is_empty(), "the inset band paints");
    let padding = rect.shrink(4.0);
    for r in &red {
        assert!(
            padding.expand(0.01).contains_rect(*r),
            "band {r:?} stays inside the padding box {padding:?}"
        );
    }
    // The band is the 3px ring just inside the border: its outer edge is
    // the padding edge, so the top strip spans y = 4..7.
    let top = red
        .iter()
        .find(|r| (r.min.y - padding.min.y).abs() < 0.01 && r.width() > 50.0)
        .unwrap_or_else(|| panic!("a top strip at the padding edge: {red:?}"));
    assert!((top.height() - 3.0).abs() < 0.01, "3px band: {top:?}");
}
