//! A theme's `animation` moves what the element paints: cyberpunk's
//! `glitched` keyframes skew a heading (and the line under it) over 3s,
//! played in reverse.
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

/// Paint a cyberpunk heading once per entry of `times` (the frame clock,
/// seconds) and return, per frame, the heading's rect and its green line.
fn frames(times: &[f64], reduced: bool) -> Vec<(egui::Rect, Paint)> {
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
    let registry = Registry::with_builtins();
    let table = we_style::TokenTable::new(
        [(
            Arc::<str>::from("--we-color-accent-500"),
            Arc::<str>::from("#00ff00"),
        )]
        .into_iter()
        .collect(),
    );
    let out = RefCell::new(Vec::new());
    let times = times.to_vec();
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        ctx.tessellation_options_mut(|o| o.feathering = false);
        we_egui::defaults::set_reduced_motion(&ctx, reduced);
        let n = out.borrow().len();
        let Some(now) = times.get(n).copied() else {
            return;
        };
        let mut scx = StyleCx::empty();
        scx.tokens = &table;
        scx.theme = "cyberpunk";
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
            now,
        );
        let layer = ui.layer_id();
        let shapes: Vec<egui::epaint::ClippedShape> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| list.all_entries().cloned().collect())
                .unwrap_or_default()
        });
        let mut p = Paint::default();
        for prim in ctx.tessellate(shapes, ctx.pixels_per_point()) {
            if let egui::epaint::Primitive::Mesh(m) = &prim.primitive {
                collect(m, green, &mut p);
            }
        }
        out.borrow_mut().push((lay.rects[&NodeId::from("c/h")], p));
    });
    harness.run_steps(times.len());
    drop(harness);
    out.into_inner()
}

/// The skew the line's bottom-left corner shows: how far it moved left of
/// the unskewed box, beyond the `left` offset, per px below the centre.
fn skew_deg(rect: egui::Rect, p: &Paint, dx: f32) -> f32 {
    let min = p.min.unwrap();
    let below = rect.max.y - rect.center().y;
    ((min.x - rect.min.x - dx) / below).atan().to_degrees()
}

#[test]
fn glitch_skews_the_heading_in_reverse() {
    // Started at t=0. `reverse` puts t=0 on the 100% frame (no skew), the
    // 51–59% band (+5°) at 41–49% of the 3s run, and 0–10% (-15°, left
    // -4px) at 90–100%.
    let f = frames(&[0.0, 0.45 * 3.0, 0.95 * 3.0, 3.0 + 0.95 * 3.0], false);
    let (r0, p0) = &f[0];
    assert!(skew_deg(*r0, p0, 0.0).abs() < 0.2, "t=0: {p0:?}");
    let (r1, p1) = &f[1];
    // A positive skew leans the part below the centre right, so the
    // line's leftmost point is its top-left corner. `left` is still 2px
    // there: 2px at 11% against an `auto` base does not interpolate, and
    // holds until the interval's midpoint.
    let top_shift = p1.min.unwrap().x - r1.min.x;
    let want = 2.0 + 5f32.to_radians().tan() * ((r1.max.y - 10.0) - r1.center().y);
    assert!((top_shift - want).abs() < 0.3, "+5°: {top_shift} vs {want}");
    let (r2, p2) = &f[2];
    let s = skew_deg(*r2, p2, -4.0);
    assert!((s + 15.0).abs() < 0.3, "-15° at 95% of the run: {s}");
    // Infinite: the second iteration repeats the first.
    let (r3, p3) = &f[3];
    assert!((skew_deg(*r3, p3, -4.0) + 15.0).abs() < 0.3);
}

#[test]
fn reduced_motion_holds_the_heading_still() {
    let f = frames(&[0.0, 0.95 * 3.0], true);
    let (r, p) = &f[1];
    assert!((p.min.unwrap().x - r.min.x).abs() < 0.01, "{p:?}");
}
