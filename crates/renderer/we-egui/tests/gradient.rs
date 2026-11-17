//! `background-image` gradients paint. Glow parity: Coasys Glow lays three
//! radial gradients over every `bg: page` surface (`surfaceImages.page`,
//! `--we-surface-image-page`) and one over the chrome; Rust resolved the
//! value to `BgImage::Gradient` and painted nothing, so the page was the
//! flat surface colour.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedNode};

fn column(props: &[(&str, &str)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from("root"),
        ty: Arc::from("Column"),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), we_expr::Value::from(*v)))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
        surfaces: Default::default(),
    }
}

/// Images uploaded while a frame was painted, by texture.
type Images = std::collections::HashMap<egui::TextureId, Arc<egui::ColorImage>>;

/// The tessellated frame for `root` laid out at 400x400 from the origin,
/// and the images its textures hold (a gradient is rasterised into one).
fn frame(root: &ResolvedNode) -> (Vec<egui::epaint::ClippedPrimitive>, Images) {
    let registry = Registry::with_builtins();
    let out = RefCell::new(Vec::new());
    let images = RefCell::new(Images::new());
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        let scx = StyleCx::empty();
        let area = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(400.0, 400.0));
        let lay = layout(&MeasureCx::new(&ctx), &scx, &registry, root, area);
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let mut delta = ctx.tex_manager().write().take_delta();
        for (id, deltas) in &delta.set {
            for d in deltas {
                if let (None, egui::ImageData::Color(img)) = (d.pos, &d.image) {
                    images.borrow_mut().insert(*id, img.clone());
                }
            }
        }
        delta.clear();
        let layer = ui.layer_id();
        let shapes: Vec<egui::epaint::ClippedShape> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| list.all_entries().cloned().collect())
                .unwrap_or_default()
        });
        *out.borrow_mut() = ctx.tessellate(shapes, 1.0);
    });
    harness.run_steps(2);
    drop(harness);
    (out.into_inner(), images.into_inner())
}

/// The colour the frame ends up with at `p`: every covering triangle
/// composited over black in paint order (premultiplied source-over) — a
/// textured one reads its texture at `p`'s texel, as the renderer's nearest
/// sampling does.
fn color_at(
    (prims, images): &(Vec<egui::epaint::ClippedPrimitive>, Images),
    p: egui::Pos2,
) -> [f32; 3] {
    let mut acc = [0.0f32; 3];
    for cp in prims {
        let egui::epaint::Primitive::Mesh(m) = &cp.primitive else {
            continue;
        };
        // The default texture is the font atlas, whose white texel an
        // untextured mesh reads; any other is a gradient's image.
        let image = if m.texture_id == egui::TextureId::default() {
            None
        } else {
            let Some(image) = images.get(&m.texture_id) else {
                continue;
            };
            Some(image)
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
            if w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4 {
                continue;
            }
            // Only the fully-covered interior: skip feathering rims.
            let ch = |f: fn(egui::Color32) -> u8| {
                (w1 * f(a.color) as f32 + w2 * f(b.color) as f32 + w3 * f(c.color) as f32) / 255.0
            };
            let mut src = [ch(|c| c.r()), ch(|c| c.g()), ch(|c| c.b()), ch(|c| c.a())];
            if let Some(img) = image {
                let uv = a.uv.to_vec2() * w1 + b.uv.to_vec2() * w2 + c.uv.to_vec2() * w3;
                let [iw, ih] = img.size;
                let x = ((uv.x * iw as f32) as usize).min(iw - 1);
                let y = ((uv.y * ih as f32) as usize).min(ih - 1);
                let texel = img.pixels[y * iw + x].to_array();
                for (i, v) in src.iter_mut().enumerate() {
                    *v *= f32::from(texel[i]) / 255.0;
                }
            }
            for i in 0..3 {
                acc[i] = src[i] + acc[i] * (1.0 - src[3]);
            }
        }
    }
    acc
}

#[test]
fn a_linear_gradient_paints_from_its_first_stop_to_its_last() {
    let f = frame(&column(&[
        ("width", "400px"),
        ("height", "400px"),
        ("bg", "#000000"),
        (
            "bgImage",
            "linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))",
        ),
    ]));
    let left = color_at(&f, egui::pos2(5.0, 200.0));
    let mid = color_at(&f, egui::pos2(200.0, 200.0));
    let right = color_at(&f, egui::pos2(395.0, 200.0));
    assert!(left[0] > 0.9 && left[2] < 0.1, "left {left:?}");
    assert!(right[2] > 0.9 && right[0] < 0.1, "right {right:?}");
    assert!(
        (mid[0] - 0.5).abs() < 0.08 && (mid[2] - 0.5).abs() < 0.08,
        "mid {mid:?}"
    );
}

#[test]
fn radial_layers_composite_first_on_top() {
    // Glow's shape: explicit radii, a position outside the box, a stop
    // into `transparent` — and two layers, the first painted over the second.
    let f = frame(&column(&[
        ("width", "400px"),
        ("height", "400px"),
        ("bg", "#000000"),
        (
            "bgImage",
            "radial-gradient(200px 200px at 0% 0%, rgba(0, 255, 0, 1), transparent 100%), \
             radial-gradient(200px 200px at 100% 100%, rgba(0, 0, 255, 0.5), transparent 100%)",
        ),
    ]));
    let tl = color_at(&f, egui::pos2(2.0, 2.0));
    let half = color_at(&f, egui::pos2(100.0, 0.5));
    let far = color_at(&f, egui::pos2(200.0, 200.0));
    let br = color_at(&f, egui::pos2(398.0, 398.0));
    assert!(tl[1] > 0.9, "top-left {tl:?}");
    assert!(
        (half[1] - 0.5).abs() < 0.1,
        "half way along the ray {half:?}"
    );
    assert!(far.iter().all(|c| *c < 0.05), "outside both {far:?}");
    assert!(
        (br[2] - 0.5).abs() < 0.08 && br[1] < 0.05,
        "bottom-right {br:?}"
    );
}
