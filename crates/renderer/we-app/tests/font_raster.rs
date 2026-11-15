//! What the WE faces look like once rasterised, measured on rendered pixels:
//! the variable faces reach the weight a style asks for (and the CSS
//! default, 400, when it asks for none), only a face without that weight
//! gets the synthesised bold the browser would give it, and VT323 — a
//! pixel font — lands on whole physical pixels at 1x and 2x.

#[path = "support/gpu.rs"]
mod gpu;

use std::cell::RefCell;
use std::sync::Arc;

use egui::Vec2;
use egui_kittest::Harness;
use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

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
        surfaces: Default::default(),
        transition: None,
    }
}

/// Black `text` on white, in `family` at `size`, `weight` when given.
fn text_node(text: &str, family: &str, size: &str, weight: Option<&str>) -> ResolvedNode {
    let mut props = vec![
        ("text", text),
        ("fontFamily", family),
        ("fontSize", size),
        ("color", "#000000"),
    ];
    if let Some(w) = weight {
        props.push(("fontWeight", w));
    }
    let t = node("we-text", "root/t", &props);
    let mut root = node("Column", "root", &[("bg", "#ffffff"), ("p", "8px")]);
    root.children = vec![ResolvedChild::Node(Box::new(t))];
    root
}

/// One render: per-pixel ink coverage (0 white … 1 black), row-major, and
/// how many text shapes the frame painted.
struct Shot {
    w: usize,
    h: usize,
    ink: Vec<f32>,
    text_shapes: usize,
}

impl Shot {
    fn at(&self, x: usize, y: usize) -> f32 {
        self.ink[y * self.w + x]
    }
    fn total(&self) -> f32 {
        self.ink.iter().sum()
    }
    /// Inked columns `[first, last]`.
    fn x_extent(&self) -> (usize, usize) {
        let cols: Vec<usize> = (0..self.w)
            .filter(|&x| (0..self.h).any(|y| self.at(x, y) > 0.02))
            .collect();
        (*cols.first().expect("ink"), *cols.last().expect("ink"))
    }
}

fn shoot(root: ResolvedNode, ppp: f32) -> Shot {
    let registry = Registry::with_builtins();
    // The recorded light table: `fontWeight: '700'` resolves through
    // `var(--we-font-weight-700)`, which an empty table would drop.
    let theme = we_app::gallery::load_theme_set()
        .iter()
        .find(|t| &*t.id == "light")
        .expect("light tokens recorded")
        .clone();
    let shapes = RefCell::new(0usize);
    let size = Vec2::new(320.0, 80.0);
    let mut harness = Harness::builder()
        .renderer(gpu::serial())
        .with_size(size)
        .with_pixels_per_point(ppp)
        .with_context_setup(we_egui::install_media)
        .build_ui(|ui| {
            let ctx = ui.ctx().clone();
            let mut scx = StyleCx::empty();
            scx.tokens = &theme.tokens;
            scx.theme = "light";
            let lay = layout(
                &MeasureCx::new(&ctx),
                &scx,
                &registry,
                &root,
                egui::Rect::from_min_size(egui::Pos2::ZERO, size),
            );
            let mut events = Vec::new();
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
            let layer = ui.layer_id();
            *shapes.borrow_mut() = ctx.graphics(|g| {
                g.get(layer)
                    .map(|l| {
                        l.all_entries()
                            .filter(|cs| matches!(cs.shape, egui::Shape::Text(_)))
                            .count()
                    })
                    .unwrap_or(0)
            });
        });
    harness.run_steps(4);
    let image = harness.render().expect("render");
    let (w, h) = (image.width() as usize, image.height() as usize);
    let ink = image
        .pixels()
        .map(|p| 1.0 - (p[0] as f32 + p[1] as f32 + p[2] as f32) / (3.0 * 255.0))
        .collect();
    let text_shapes = *shapes.borrow();
    Shot {
        w,
        h,
        ink,
        text_shapes,
    }
}

const SAMPLE: &str = "Hamburgefonstiv";

/// Mozilla Text (wght 200–700, default instance 200) and Bricolage
/// Grotesque (wght 200–800, default instance 800): a 700 run is wider and
/// darker than a 400 run, a run that names no weight is the CSS default
/// 400 — not the file's default instance — and the bold is the face's own,
/// painted once, with no synthesised second pass on top.
#[test]
fn variable_faces_reach_the_requested_weight() {
    for family in ["'Mozilla Text', serif", "'Bricolage Grotesque', sans-serif"] {
        let regular = shoot(text_node(SAMPLE, family, "24px", Some("400")), 1.0);
        let bold = shoot(text_node(SAMPLE, family, "24px", Some("700")), 1.0);
        let unset = shoot(text_node(SAMPLE, family, "24px", None), 1.0);
        let width = |s: &Shot| {
            let (a, b) = s.x_extent();
            b - a + 1
        };
        assert!(
            width(&bold) > width(&regular),
            "{family}: 700 is wider ({} vs {})",
            width(&bold),
            width(&regular)
        );
        assert!(
            bold.total() > regular.total() * 1.2,
            "{family}: 700 is darker ({} vs {})",
            bold.total(),
            regular.total()
        );
        let drift = (unset.total() - regular.total()).abs() / regular.total();
        assert!(
            drift < 0.01 && width(&unset) == width(&regular),
            "{family}: no weight is 400 (ink {} vs {}, width {} vs {})",
            unset.total(),
            regular.total(),
            width(&unset),
            width(&regular)
        );
        assert_eq!(
            bold.text_shapes, 1,
            "{family}: a real 700 is painted once, no synthetic pass"
        );
    }
}

/// DM Sans ships one static 400 face, so a 700 request is synthesised —
/// as the browser does for it — and comes out darker than 400.
#[test]
fn a_static_face_still_gets_the_synthesised_bold() {
    let family = "'DM Sans', sans-serif";
    let regular = shoot(text_node(SAMPLE, family, "24px", Some("400")), 1.0);
    let bold = shoot(text_node(SAMPLE, family, "24px", Some("700")), 1.0);
    assert_eq!(bold.text_shapes, 2, "synthesised bold: a second pass");
    assert!(bold.total() > regular.total() * 1.1);
}

/// VT323 is drawn on a pixel grid. At the sizes the retro theme uses, at
/// 1x and 2x, every inked column and row of `HIH` reaches full coverage
/// somewhere — a stem is whole pixels, with no partial-alpha fringe column
/// beside it and no half-covered row along the baseline or cap height.
/// Ink comes first: a blank image has no partial pixels either, so the
/// glyphs must be there, spanning most of an em per glyph, before their
/// edges are judged.
#[test]
fn vt323_lands_on_whole_pixels() {
    for ppp in [1.0, 2.0] {
        for size in ["14px", "16px", "18px", "24px"] {
            let shot = shoot(text_node("HIH", "'VT323', monospace", size, None), ppp);
            let px = size.trim_end_matches("px").parse::<f32>().unwrap() * ppp;
            let full = shot.ink.iter().filter(|&&a| a > 0.98).count() as f32;
            assert!(
                full > px * px * 0.1,
                "VT323 {size} at {ppp}x: {full} fully covered pixels, too few for HIH"
            );
            let (first, last) = shot.x_extent();
            let width = (last - first + 1) as f32;
            assert!(
                width > px * 0.9 && width < px * 3.0,
                "VT323 {size} at {ppp}x: HIH spans {width} px"
            );
            let fringe_cols: Vec<(usize, f32)> = (0..shot.w)
                .map(|x| (x, (0..shot.h).map(|y| shot.at(x, y)).fold(0.0, f32::max)))
                .filter(|&(_, m)| m > 0.02 && m < 0.98)
                .collect();
            let fringe_rows: Vec<(usize, f32)> = (0..shot.h)
                .map(|y| (y, (0..shot.w).map(|x| shot.at(x, y)).fold(0.0, f32::max)))
                .filter(|&(_, m)| m > 0.02 && m < 0.98)
                .collect();
            assert!(
                fringe_cols.is_empty() && fringe_rows.is_empty(),
                "VT323 {size} at {ppp}x: partial columns {fringe_cols:?}, rows {fringe_rows:?}"
            );
        }
    }
}
