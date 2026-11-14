//! `clip-path: polygon(…)` — the clip only removes pixels from the
//! element's normal output (background, borders, shadows, children); it
//! adds none. The border box is the reference box the polygon's
//! coordinates resolve against, not an extra crop: output outside the box
//! but inside the polygon (an outer shadow, overflow) stays. A degenerate
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
/// overhanging coordinates add no paint: the clip only removes pixels, and
/// this button's own output (background, border, label — no shadow, no
/// overflow) lies in its border box, so nothing lands outside it. (Output
/// that does fall outside the box survives where the polygon covers it —
/// see `an_expanded_polygon_keeps_shadow_and_overflow_outside_the_border_box`.)
#[test]
fn the_slab_overhang_adds_no_paint() {
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
        "this button paints nothing outside its border box: bounds {b:?} vs {rect:?}"
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

/// Every vertex the subtree emitted — meshes unpacked; galleys/paths would
/// be a shape the clip output still carries.
fn mesh_verts(shapes: &[egui::epaint::ClippedShape]) -> Vec<egui::Pos2> {
    let mut out = Vec::new();
    fn walk(s: &egui::Shape, out: &mut Vec<egui::Pos2>) {
        match s {
            egui::Shape::Mesh(m) => out.extend(m.vertices.iter().map(|v| v.pos)),
            egui::Shape::Vec(v) => v.iter().for_each(|s| walk(s, out)),
            _ => {}
        }
    }
    for cs in shapes {
        walk(&cs.shape, &mut out);
    }
    out
}

/// The cyberpunk input: `border: 10px` top/bottom, `2px` sides, a 60px
/// field and a notch polygon whose top edge dips `0 → 5px` at `60%`. CSS
/// paints the rectangular borders first and clips them — the clip adds no
/// stroke of its own: at the notch row y=5 only the border's 5..10 strip
/// survives, nothing paints at y=10..15, and the little diagonal step
/// carries no line.
#[test]
fn polygon_clip_keeps_the_rectangular_borders_only() {
    let styles = obj(&[
        (
            "clip-path",
            s("polygon(0 5px, 5px 0, calc(60% - 5px) 0, 60% 5px, 100% 5px, 100% calc(100% - 5px), calc(100% - 5px) calc(100% - 3px), calc(80% - 3px) calc(100% - 3px), calc(80% - 5px) calc(100% - 0px), 0 calc(100% - 0px), 0% calc(100% - 0px))"),
        ),
        ("border-top", s("10px solid #00f0ff")),
        ("border-bottom", s("10px solid #00f0ff")),
        ("border-left", s("2px solid #00f0ff")),
        ("border-right", s("2px solid #00f0ff")),
        ("height", s("60px")),
        ("width", s("200px")),
    ]);
    let n = node("we-input", "i", &[("styles", styles)]);
    let (rect, shapes) = painted(&n);
    // No invented polygon-edge strokes — nothing painted as a path/line.
    fn has_lines(s: &egui::Shape) -> bool {
        match s {
            egui::Shape::LineSegment { .. } | egui::Shape::Path(_) => true,
            egui::Shape::Vec(v) => v.iter().any(has_lines),
            _ => false,
        }
    }
    assert!(
        !shapes.iter().any(|cs| has_lines(&cs.shape)),
        "a polygon-edge stroke survives: {shapes:?}"
    );
    let verts = mesh_verts(&shapes);
    let w = rect.width();
    // In the notch zone (x > 60% of width, inside the right border) the
    // top edge drops to y=5: the 10px border's visible remnant is the
    // 5..10 strip, and nothing paints at y=10..15.
    let notch: Vec<egui::Pos2> = verts
        .iter()
        .copied()
        .filter(|p| p.x > rect.min.x + 0.61 * w && p.x < rect.max.x - 2.0)
        .filter(|p| p.y < rect.min.y + 15.0 && p.y > rect.min.y - 1.0)
        .collect();
    assert!(
        notch
            .iter()
            .any(|p| p.y >= rect.min.y + 4.5 && p.y <= rect.min.y + 10.0),
        "the 5..10 border strip is missing: {notch:?}"
    );
    assert!(
        !notch.iter().any(|p| p.y > rect.min.y + 10.5),
        "paint below the top border in the notch band: {notch:?}"
    );
    // The top-left band y<5 starts only where the polygon's top edge sits.
    assert!(
        !verts
            .iter()
            .any(|p| p.x > rect.min.x + 0.62 * w && p.y < rect.min.y + 4.5),
        "paint above the notch edge: {:?}",
        verts
            .iter()
            .filter(|p| p.y < rect.min.y + 4.5)
            .collect::<Vec<_>>()
    );
}

// ---------- Round D: pixel coverage, pointer state --------------------------

/// Where the pointer is when the frame is sampled.
#[derive(Clone, Copy, PartialEq)]
enum Pointer {
    Rest,
    /// Over the root's centre.
    Hover,
    /// Over the root's centre with the primary button held.
    Press,
}

/// The tessellated frame: what the GPU would draw for the node's layer,
/// plus the root's rect. `theme` names the `data-we-theme` the component
/// stylesheet keys on.
struct Frame {
    rect: egui::Rect,
    prims: Vec<egui::epaint::ClippedPrimitive>,
}

fn frame(root: &ResolvedNode, theme: &str, pointer: Pointer) -> Frame {
    let registry = Registry::with_builtins();
    let out = RefCell::new((egui::Rect::NOTHING, Vec::new()));
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        let mut scx = StyleCx::empty();
        scx.theme = theme;
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
        let prims = ctx.tessellate(shapes, 1.0);
        *out.borrow_mut() = (rect, prims);
    });
    harness.run_steps(2);
    if pointer != Pointer::Rest {
        let at = out.borrow().0.center();
        harness.event(egui::Event::PointerMoved(at));
        harness.run_steps(2);
        if pointer == Pointer::Press {
            harness.event(egui::Event::PointerButton {
                pos: at,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::NONE,
            });
            harness.run_steps(2);
        }
    }
    let (rect, prims) = out.borrow().clone();
    Frame { rect, prims }
}

/// The opacity the frame paints at `p` — the highest interpolated vertex
/// alpha of any triangle covering it (0 = nothing drawn there). Glyph quads
/// count by their quad, which is what "the text survives" means.
fn alpha_at(f: &Frame, p: egui::Pos2) -> f32 {
    let mut best = 0.0f32;
    for cp in &f.prims {
        if !cp.clip_rect.contains(p) {
            continue;
        }
        let egui::epaint::Primitive::Mesh(m) = &cp.primitive else {
            continue;
        };
        for t in m.indices.chunks_exact(3) {
            let [a, b, c] = [0, 1, 2].map(|i| m.vertices[t[i] as usize]);
            let d = (b.pos - a.pos).x * (c.pos - a.pos).y - (b.pos - a.pos).y * (c.pos - a.pos).x;
            if d.abs() < 1e-6 {
                continue;
            }
            let w1 = ((b.pos - p).x * (c.pos - p).y - (b.pos - p).y * (c.pos - p).x) / d;
            let w2 = ((c.pos - p).x * (a.pos - p).y - (c.pos - p).y * (a.pos - p).x) / d;
            let w3 = 1.0 - w1 - w2;
            if w1 >= -1e-4 && w2 >= -1e-4 && w3 >= -1e-4 {
                let alpha =
                    (w1 * a.color.a() as f32 + w2 * b.color.a() as f32 + w3 * c.color.a() as f32)
                        / 255.0;
                best = best.max(alpha);
            }
        }
    }
    best
}

fn cyberpunk_button() -> ResolvedNode {
    let styles = obj(&[
        ("background-color", s("#00f0ff")),
        ("height", s("40px")),
        ("width", s("160px")),
    ]);
    node("we-button", "b", &[("label", s("ARM")), ("styles", styles)])
}

/// cyberpunk/index.css: the button slab is clipped at rest — its
/// bottom-left corner is cut away — and `:hover` sets `clip-path: none`.
/// A press is `:hover` + `:active` in CSS (the active rule says nothing
/// about the clip), so the corner stays open while held. The walk must
/// clip with the state the widget painted, not the resting style.
#[test]
fn cyberpunk_hover_and_press_open_the_clipped_corner() {
    let n = cyberpunk_button();
    let rest = frame(&n, "cyberpunk", Pointer::Rest);
    let corner = |f: &Frame| egui::pos2(f.rect.min.x + 3.0, f.rect.max.y - 3.0);
    let middle = |f: &Frame| f.rect.center() + egui::vec2(30.0, 8.0);
    assert!(
        alpha_at(&rest, middle(&rest)) > 0.9,
        "the slab paints at rest"
    );
    assert!(
        alpha_at(&rest, corner(&rest)) < 0.01,
        "at rest the bottom-left corner is cut: {}",
        alpha_at(&rest, corner(&rest))
    );
    for (p, name) in [(Pointer::Hover, "hover"), (Pointer::Press, "press")] {
        let f = frame(&n, "cyberpunk", p);
        assert!(
            alpha_at(&f, corner(&f)) > 0.9,
            "{name}: `clip-path: none` paints the corner: {}",
            alpha_at(&f, corner(&f))
        );
    }
}

/// The border box is only the polygon's reference box, never a second
/// crop: a polygon reaching 20px past every edge keeps the element's outer
/// shadow and an overflowing child where they fall inside the polygon,
/// though outside the border box — and still cuts what lies beyond it.
#[test]
fn an_expanded_polygon_keeps_shadow_and_overflow_outside_the_border_box() {
    let styles = obj(&[
        (
            "clip-path",
            s("polygon(-20px -20px, calc(100% + 20px) -20px, calc(100% + 20px) calc(100% + 20px), -20px calc(100% + 20px))"),
        ),
        ("background-color", s("#00f0ff")),
        ("box-shadow", s("0 0 0 10px #ff0000")),
        ("width", s("160px")),
        ("height", s("60px")),
        ("margin", s("40px")),
    ]);
    let mut n = node("Column", "c", &[("styles", styles)]);
    n.children = vec![ResolvedChild::Node(Box::new(node(
        "Column",
        "c/wide",
        &[(
            "styles",
            obj(&[
                ("background-color", s("#00ff00")),
                ("width", s("240px")),
                ("height", s("20px")),
                ("flex-shrink", s("0")),
            ]),
        )],
    )))];
    let f = frame(&n, "", Pointer::Rest);
    let r = f.rect;
    // The shadow's spread ring, 5px left of the border box.
    let shadow = egui::pos2(r.min.x - 5.0, r.center().y);
    assert!(
        alpha_at(&f, shadow) > 0.9,
        "the outer shadow inside the polygon survives: {}",
        alpha_at(&f, shadow)
    );
    // The child's overflow, 10px right of the border box (inside the polygon).
    let overflow = egui::pos2(r.max.x + 10.0, r.min.y + 10.0);
    assert!(
        alpha_at(&f, overflow) > 0.9,
        "the overflowing child inside the polygon survives: {}",
        alpha_at(&f, overflow)
    );
    // Beyond the polygon (30px right of the box) the child is cut.
    let beyond = egui::pos2(r.max.x + 30.0, r.min.y + 10.0);
    assert!(
        alpha_at(&f, beyond) < 0.01,
        "the child beyond the polygon is cut: {}",
        alpha_at(&f, beyond)
    );
}
