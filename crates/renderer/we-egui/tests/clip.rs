//! `clip-path: polygon(…)` — the clip only removes pixels from the
//! element's normal output (background, borders, shadows, children); it
//! never authorizes geometry outside the border box, and a degenerate
//! polygon clips everything.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

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

fn bounds(shapes: &[egui::epaint::ClippedShape]) -> egui::Rect {
    shapes.iter().fold(egui::Rect::NOTHING, |acc, cs| {
        acc.union(cs.shape.visual_bounding_rect())
    })
}

/// The cyberpunk button slab — `polygon(-15px 0%, calc(100% + 15px) 0%,
/// calc(100% + 15px) 100%, 20px 100%, -15px calc(100% - 35px))`. The
/// overhanging coordinates only mean "open on that side": the painted
/// output is still the element's, so nothing lands outside the border box.
#[test]
fn polygon_clip_keeps_the_element_inside_its_border_box() {
    let styles = obj(&[
        (
            "clip-path",
            s("polygon(-15px 0%, calc(100% + 15px) 0%, calc(100% + 15px) 100%, 20px 100%, -15px calc(100% - 35px))"),
        ),
        ("background-color", s("#00f0ff")),
        ("border", s("2px solid #ff00aa")),
        ("height", s("40px")),
        ("width", s("160px")),
    ]);
    let n = node("we-button", "b", &[("label", s("ARM")), ("styles", styles)]);
    let (rect, shapes) = painted(&n);
    assert!(!shapes.is_empty(), "the button still paints something");
    let b = bounds(&shapes);
    assert!(
        b.is_finite() && rect.is_finite(),
        "bounds {b:?} rect {rect:?}"
    );
    assert!(
        b.min.x >= rect.min.x - 0.6
            && b.max.x <= rect.max.x + 0.6
            && b.min.y >= rect.min.y - 0.6
            && b.max.y <= rect.max.y + 0.6,
        "painted bounds {b:?} must stay inside the border box {rect:?}"
    );
}

/// A polygon with fewer than three distinct points (or zero area) is not
/// "no clip" — it clips the whole element: nothing paints.
#[test]
fn degenerate_polygon_paints_nothing() {
    for clip in [
        "polygon(0px 0px, 10px 10px)",          // two points
        "polygon(0px 0px, 10px 0px, 20px 0px)", // collinear — zero area
    ] {
        let styles = obj(&[
            ("clip-path", s(clip)),
            ("background-color", s("#00f0ff")),
            ("height", s("40px")),
            ("width", s("160px")),
        ]);
        let n = node("we-button", "b", &[("label", s("ARM")), ("styles", styles)]);
        let (_rect, shapes) = painted(&n);
        let painted = shapes
            .iter()
            .filter(|cs| !matches!(cs.shape, egui::Shape::Noop))
            .filter(|cs| cs.shape.visual_bounding_rect().is_finite())
            .count();
        assert_eq!(painted, 0, "degenerate {clip} still painted: {shapes:?}");
    }
}

/// Content the polygon cuts away is gone from the output — a text child
/// sitting in the clipped half leaves no glyphs behind.
#[test]
fn polygon_clip_removes_child_text() {
    // Left half open, right half closed: the "SHOWN" span sits left of the
    // cut; a second we-text ("HIDDEN") lays out in the clipped half.
    let styles = obj(&[
        (
            "clip-path",
            s("polygon(0px 0px, 50% 0px, 50% 100%, 0px 100%)"),
        ),
        ("background-color", s("#00f0ff")),
        ("width", s("200px")),
        ("height", s("80px")),
        ("padding", s("4px")),
        ("display", s("flex")),
        ("gap", s("8px")),
    ]);
    let mut n = node("Column", "c", &[("styles", styles)]);
    n.children = vec![
        ResolvedChild::Node(Box::new(node("we-text", "shown", &[("text", s("SHOWN"))]))),
        ResolvedChild::Node(Box::new(node(
            "we-text",
            "hid",
            &[
                ("text", s("HIDDEN")),
                ("styles", obj(&[("margin-left", s("90px"))])),
            ],
        ))),
    ];
    let (_rect, shapes) = painted(&n);
    let texts: Vec<String> = shapes
        .iter()
        .filter_map(|cs| match &cs.shape {
            egui::Shape::Text(t) => Some(t.galley.text().to_string()),
            _ => None,
        })
        .collect();
    assert!(
        !texts.iter().any(|t| t.contains("HIDDEN")),
        "the clipped-away text survives: {texts:?}"
    );
}
