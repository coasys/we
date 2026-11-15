//! A theme's generated `::before`/`::after` boxes are laid out and painted:
//! cyberpunk's line under every heading, retro's dotted menu connector.
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

/// Triangles painted in `color`: their total area and bounding box.
#[derive(Debug, Default, Clone)]
struct Paint {
    area: f32,
    min: Option<egui::Pos2>,
    max: Option<egui::Pos2>,
}

fn collect(m: &egui::epaint::Mesh, color: egui::Color32, out: &mut Paint) {
    {
        {
            for t in m.indices.chunks_exact(3) {
                let v: Vec<_> = t.iter().map(|&i| m.vertices[i as usize]).collect();
                if v.iter().any(|v| v.color != color) {
                    continue;
                }
                let (a, b, c) = (v[0].pos, v[1].pos, v[2].pos);
                out.area += ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)).abs() / 2.0;
                for p in [a, b, c] {
                    out.min = Some(out.min.map_or(p, |m| m.min(p)));
                    out.max = Some(out.max.map_or(p, |m| m.max(p)));
                }
            }
        }
    }
}

/// Lay out and paint `root` under `theme` with `tokens`; return the
/// heading/host rect and what was painted in `color`.
fn run(
    root: ResolvedNode,
    host: &str,
    theme: &'static str,
    tokens: &[(&str, &str)],
    color: egui::Color32,
) -> (egui::Rect, Paint) {
    let registry = Registry::with_builtins();
    let table = we_style::TokenTable::new(
        tokens
            .iter()
            .map(|(k, v)| (Arc::<str>::from(*k), Arc::<str>::from(*v)))
            .collect(),
    );
    let seen = RefCell::new((egui::Rect::NOTHING, Paint::default()));
    let host = NodeId::from(host);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        // No feathering: every triangle is the shape's own, so areas and
        // edges compare exactly.
        ctx.tessellation_options_mut(|o| o.feathering = false);
        let mut scx = StyleCx::empty();
        scx.tokens = &table;
        scx.theme = theme;
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            &root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 300.0)),
        );
        let (mut events, mut edit) = (Vec::new(), EditState::default());
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
        let layer = ui.layer_id();
        let mut p = Paint::default();
        let shapes: Vec<egui::epaint::ClippedShape> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| list.all_entries().cloned().collect())
                .unwrap_or_default()
        });
        for prim in ctx.tessellate(shapes, ctx.pixels_per_point()) {
            if let egui::epaint::Primitive::Mesh(m) = &prim.primitive {
                collect(m, color, &mut p);
            }
        }
        *seen.borrow_mut() = (lay.rects[&host], p);
    });
    harness.run_steps(2);
    drop(harness);
    seen.into_inner()
}

/// Shoelace area of the heading-line polygon at width `w`.
fn line_area(w: f32) -> f32 {
    let pts = [
        (0.0, 0.0),
        (85.0, 0.0),
        (90.0, 5.0),
        (w, 5.0),
        (w, 6.0),
        (85.0, 6.0),
        (80.0, 10.0),
        (0.0, 10.0),
    ];
    let n = pts.len();
    (0..n)
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            a.0 * b.1 - b.0 * a.1
        })
        .sum::<f32>()
        .abs()
        / 2.0
}

#[test]
fn cyberpunk_heading_paints_its_line_clipped_to_the_polygon() {
    let green = egui::Color32::from_rgb(0, 255, 0);
    let mut root = node("Column", "c", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(node(
        "we-text",
        "c/h",
        &[
            ("variant", we_expr::Value::from("heading-lg")),
            ("text", we_expr::Value::from("Signals")),
        ],
    )))];
    let (rect, p) = run(
        root.clone(),
        "c/h",
        "cyberpunk",
        &[("--we-color-accent-500", "#00ff00")],
        green,
    );
    let (min, max) = (p.min.expect("the line painted"), p.max.unwrap());
    // 10px tall, sitting at the bottom of the heading box (the box grew by
    // the band), spanning its width.
    assert!((max.y - min.y - 10.0).abs() < 0.01, "{min:?}..{max:?}");
    assert!((max.y - rect.max.y).abs() < 0.01, "{max:?} vs {rect:?}");
    assert!((min.x - rect.min.x).abs() < 0.01 && (max.x - rect.max.x).abs() < 0.01);
    // Clipped to the polygon, not the full 10px band.
    let want = line_area(rect.width());
    assert!(
        (p.area - want).abs() < 2.0,
        "painted {} vs polygon {want} (band {})",
        p.area,
        rect.width() * 10.0
    );
    // Body text grows no line.
    let mut body = root;
    if let ResolvedChild::Node(n) = &mut body.children[0] {
        n.props
            .insert(Arc::from("variant"), we_expr::Value::from("body"));
    }
    let (_, p) = run(
        body,
        "c/h",
        "cyberpunk",
        &[("--we-color-accent-500", "#00ff00")],
        green,
    );
    assert_eq!(p.area, 0.0);
}

#[test]
fn retro_menu_item_draws_its_dotted_connector() {
    let mut root = node("Column", "c", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(node(
        "we-menu-item",
        "c/i",
        &[("label", we_expr::Value::from("Open"))],
    )))];
    // `grey` is #808080: the connector's dotted top border.
    let grey = egui::Color32::from_rgb(128, 128, 128);
    let (rect, p) = run(root, "c/i", "retro", &[], grey);
    let (min, max) = (p.min.expect("the connector painted"), p.max.unwrap());
    assert!(
        (min.x - rect.min.x).abs() <= 1.0,
        "left: 0 — {min:?} vs {rect:?}"
    );
    assert!(
        max.x - min.x <= 15.01 && max.x - min.x >= 12.0,
        "15px wide: {min:?}..{max:?}"
    );
    assert!(
        max.y - min.y <= 2.01,
        "a 1px dotted border: {min:?}..{max:?}"
    );
    assert!(min.y > rect.min.y && max.y < rect.max.y, "inside the row");
}

fn heading(extra: &[(&str, we_expr::Value)]) -> ResolvedNode {
    let mut props = vec![
        ("variant", we_expr::Value::from("heading-lg")),
        ("text", we_expr::Value::from("Signals")),
    ];
    props.extend(extra.iter().cloned());
    let mut root = node("Column", "c", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(node(
        "we-text", "c/h", &props,
    )))];
    root
}

#[test]
fn heading_line_is_composited_under_the_host_opacity() {
    let green = egui::Color32::from_rgb(0, 255, 0);
    let tokens = [("--we-color-accent-500", "#00ff00")];
    // Fully transparent: no line at all, in any shade.
    let zero = heading(&[("opacity", we_expr::Value::from(0.0))]);
    let (_, p) = run(zero.clone(), "c/h", "cyberpunk", &tokens, green);
    assert_eq!(p.area, 0.0, "an opacity-0 heading paints its line: {p:?}");
    let half_green = green.gamma_multiply(0.5);
    let (_, p) = run(zero, "c/h", "cyberpunk", &tokens, half_green);
    assert_eq!(p.area, 0.0);
    // Half: the line is faded with the heading, not opaque.
    let half = heading(&[("opacity", we_expr::Value::from(0.5))]);
    let (_, p) = run(half.clone(), "c/h", "cyberpunk", &tokens, green);
    assert_eq!(p.area, 0.0, "a faded heading paints an opaque line: {p:?}");
    let (_, p) = run(half, "c/h", "cyberpunk", &tokens, half_green);
    assert!(p.area > 0.0, "the faded line: {p:?}");
}

#[test]
fn heading_line_resolves_in_the_host_scope() {
    // The heading re-points the accent for itself and its descendants; its
    // generated line is one of them.
    let red = egui::Color32::from_rgb(255, 0, 0);
    let green = egui::Color32::from_rgb(0, 255, 0);
    let mut decl = IndexMap::new();
    decl.insert(
        Arc::<str>::from("--we-color-accent-500"),
        we_expr::Value::from("#ff0000"),
    );
    let root = heading(&[("styles", we_expr::Value::Obj(Arc::new(decl)))]);
    let tokens = [("--we-color-accent-500", "#00ff00")];
    let (_, p) = run(root.clone(), "c/h", "cyberpunk", &tokens, red);
    assert!(p.area > 0.0, "the line in the heading's own accent: {p:?}");
    let (_, p) = run(root, "c/h", "cyberpunk", &tokens, green);
    assert_eq!(p.area, 0.0, "the line in the theme accent: {p:?}");
}
