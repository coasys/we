//! Avatar paint order: the face's disc is the base part's background, the
//! theme's inset bevel paints over it, and the face's foreground (initials,
//! identicon, icon) over both — retro's `we-avatar::part(base)` bevel must
//! survive the seeded initials fill.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, &str)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), we_expr::Value::from(*v)))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

struct Frame {
    rect: egui::Rect,
    prims: Vec<egui::epaint::ClippedPrimitive>,
}

fn frame(root: &ResolvedNode, target: &str, theme: &str) -> Frame {
    let registry = Registry::with_builtins();
    let out = RefCell::new((egui::Rect::NOTHING, Vec::new()));
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        // No anti-aliasing fringe: a 1px bevel line is then exactly 1px.
        ctx.tessellation_options_mut(|o| o.feathering = false);
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
        let rect = lay.rects[&NodeId::from(target)];
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let layer = ui.layer_id();
        let shapes: Vec<egui::epaint::ClippedShape> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| list.all_entries().cloned().collect())
                .unwrap_or_default()
        });
        *out.borrow_mut() = (rect, ctx.tessellate(shapes, 1.0));
    });
    harness.run_steps(2);
    let (rect, prims) = out.borrow().clone();
    Frame { rect, prims }
}

/// Every triangle covering `p`, in paint order, as its interpolated
/// (premultiplied) colour — the last one is what is on top. Glyph quads
/// count by their quad.
fn layers_at(f: &Frame, p: egui::Pos2) -> Vec<egui::Color32> {
    let mut out = Vec::new();
    for cp in &f.prims {
        if !cp.clip_rect.contains(p) {
            continue;
        }
        let egui::epaint::Primitive::Mesh(m) = &cp.primitive else {
            continue;
        };
        for t in m.indices.chunks_exact(3) {
            let [a, b, c] = [0, 1, 2].map(|i| m.vertices[t[i] as usize]);
            let cr = |u: egui::Vec2, v: egui::Vec2| u.x * v.y - u.y * v.x;
            let d = cr(b.pos - a.pos, c.pos - a.pos);
            if d.abs() < 1e-6 {
                continue;
            }
            let w1 = cr(b.pos - p, c.pos - p) / d;
            let w2 = cr(c.pos - p, a.pos - p) / d;
            let w3 = 1.0 - w1 - w2;
            if w1 >= -1e-4 && w2 >= -1e-4 && w3 >= -1e-4 {
                let ch = |f: fn(&egui::Color32) -> u8| {
                    (w1 * f(&a.color) as f32 + w2 * f(&b.color) as f32 + w3 * f(&c.color) as f32)
                        .round() as u8
                };
                out.push(egui::Color32::from_rgba_premultiplied(
                    ch(egui::Color32::r),
                    ch(egui::Color32::g),
                    ch(egui::Color32::b),
                    ch(egui::Color32::a),
                ));
            }
        }
    }
    out
}

fn top(f: &Frame, p: egui::Pos2) -> egui::Color32 {
    *layers_at(f, p)
        .last()
        .unwrap_or_else(|| panic!("something paints at {p:?}"))
}

fn near(c: egui::Color32, r: u8, g: u8, b: u8) -> bool {
    let d = |x: u8, y: u8| (x as i32 - y as i32).abs() <= 8;
    d(c.r(), r) && d(c.g(), g) && d(c.b(), b) && c.a() > 240
}

/// retro: `inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px
/// grey, inset 2px 2px #dfdfdf`. The outermost bottom/right pixel row is
/// #0a0a0a and the outermost top/left one #fff — over the seeded initials
/// disc — and the initials paint over both.
#[test]
fn retro_initials_avatar_keeps_its_bevel_under_the_letters() {
    let mut n = node("Row", "row", &[("ay", "start")]);
    n.children = vec![we_template::ResolvedChild::Node(Box::new(node(
        "we-avatar",
        "a",
        &[("initials", "Ada Lovelace"), ("size", "lg")],
    )))];
    let f = frame(&n, "a", "retro");
    let r = f.rect;
    assert!(r.width() >= 30.0, "a real avatar: {r:?}");
    let bottom = egui::pos2(r.center().x, r.max.y - 0.5);
    let right = egui::pos2(r.max.x - 0.5, r.center().y);
    let topl = egui::pos2(r.center().x, r.min.y + 0.5);
    let left = egui::pos2(r.min.x + 0.5, r.center().y + 6.0);
    for (p, name) in [(bottom, "bottom"), (right, "right")] {
        assert!(
            near(top(&f, p), 0x0a, 0x0a, 0x0a),
            "{name} edge shows the dark bevel: {:?}",
            layers_at(&f, p)
        );
    }
    for (p, name) in [(topl, "top"), (left, "left")] {
        assert!(
            near(top(&f, p), 0xff, 0xff, 0xff),
            "{name} edge shows the light bevel: {:?}",
            layers_at(&f, p)
        );
    }
    // The disc: the seeded fill sits under the bevel (first layer at the
    // edge), and the letters' quad is the last layer at the centre.
    let disc = layers_at(&f, r.center() + egui::vec2(0.0, r.height() * 0.4));
    let fill = *disc.first().expect("the disc paints");
    let centre = layers_at(&f, r.center());
    assert!(
        centre.len() >= 2 && *centre.last().unwrap() != fill,
        "the initials paint over the disc: {centre:?} (fill {fill:?})"
    );
    let edge = layers_at(&f, bottom);
    assert_eq!(
        edge.first(),
        Some(&fill),
        "the disc is under the bevel: {edge:?}"
    );
}
