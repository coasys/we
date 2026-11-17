//! Text egui lays out itself — a `TextEdit`, a painter label — never goes
//! through `text_job`, so it carries no variation coordinates of ours and
//! is set at whatever the font's `FontTweak` says. For Mozilla Text
//! (default instance wght 200) and Bricolage Grotesque (default instance
//! wght 800, opsz 96) that tweak is what makes a field, a select and a
//! form-field label read at the CSS default 400 rather than at the file's
//! default instance. Measured on rendered pixels against an explicit 400
//! run of the same text, at the same size, laid out through `text_job`.

#[path = "support/gpu.rs"]
mod gpu;

use std::sync::Arc;

use egui::Vec2;
use egui_kittest::Harness;
use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, id: &str, props: Vec<(&str, Value)>) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .into_iter()
            .map(|(k, v)| (Arc::from(k), v))
            .collect::<IndexMap<Arc<str>, Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        surfaces: Default::default(),
        transition: None,
    }
}

fn s(v: &str) -> Value {
    Value::from(v)
}

/// `child` alone in a white column.
fn page(child: ResolvedNode) -> ResolvedNode {
    let mut root = node(
        "Column",
        "root",
        vec![("bg", s("#ffffff")), ("p", s("8px"))],
    );
    root.children = vec![ResolvedChild::Node(Box::new(child))];
    root
}

/// The controls all lay out at egui's default `FontId` size; the
/// reference runs are set there too.
const SIZE: &str = "14px";
const SAMPLE: &str = "Hamburgefonstiv";

/// The surfaces under test, each built with `text` (empty for the blank
/// frame the ink is measured against) in `family`.
#[derive(Clone, Copy, Debug)]
enum Surface {
    /// `we-input`: an egui `TextEdit`.
    Input,
    /// `we-select`'s trigger: `painter.text` with the control font.
    Select,
    /// `we-form-field`'s label row: `painter.text` with the theme face.
    FieldLabel,
}

impl Surface {
    fn build(self, text: &str, family: &str) -> ResolvedNode {
        match self {
            Surface::Input => node(
                "we-input",
                "root/c",
                // A styled field: the box is ours (white), egui's frame is off.
                // The field's text follows its fontSize, so it is set at the
                // reference run's — this test is about the weight.
                vec![
                    ("value", s(text)),
                    ("fontFamily", s(family)),
                    ("fontSize", s(SIZE)),
                    ("bg", s("#ffffff")),
                ],
            ),
            Surface::Select => {
                let opt: IndexMap<Arc<str>, Value> = [
                    (Arc::from("value"), s("a")),
                    (Arc::from("label"), s(SAMPLE)),
                ]
                .into_iter()
                .collect();
                node(
                    "we-select",
                    "root/c",
                    vec![
                        (
                            "options",
                            Value::List(Arc::new(vec![Value::Obj(Arc::new(opt))])),
                        ),
                        // The blank frame shows the empty placeholder.
                        ("value", s(if text.is_empty() { "" } else { "a" })),
                        ("placeholder", s("")),
                        ("fontFamily", s(family)),
                    ],
                )
            }
            Surface::FieldLabel => node(
                "we-form-field",
                "root/c",
                vec![("label", s(text)), ("fontFamily", s(family))],
            ),
        }
    }
}

/// One render, as per-pixel luminance (0 black … 255 white).
fn render(root: &ResolvedNode) -> Vec<f32> {
    let registry = Registry::with_builtins();
    let theme = we_app::gallery::load_theme_set()
        .iter()
        .find(|t| &*t.id == "light")
        .expect("light tokens recorded")
        .clone();
    let size = Vec2::new(320.0, 120.0);
    let mut harness = Harness::builder()
        .renderer(gpu::serial())
        .with_size(size)
        .with_pixels_per_point(1.0)
        .with_accessibility_check(false)
        .with_context_setup(|ctx| {
            we_egui::install_media(ctx);
            // Every surface inks in black — a TextEdit takes its colour
            // from the widget state, the painter labels from the visuals,
            // and this one override reaches both.
            ctx.all_styles_mut(|s| s.visuals.override_text_color = Some(egui::Color32::BLACK));
        })
        .build_ui(|ui| {
            let ctx = ui.ctx().clone();
            let mut scx = StyleCx::empty();
            scx.tokens = &theme.tokens;
            scx.theme = "light";
            let lay = layout(
                &MeasureCx::new(&ctx),
                &scx,
                &registry,
                root,
                egui::Rect::from_min_size(egui::Pos2::ZERO, size),
            );
            let mut events = Vec::new();
            let mut edit = EditState::default();
            paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        });
    harness.run_steps(4);
    let image = harness.render().expect("render");
    image
        .pixels()
        .map(|p| (p[0] as f32 + p[1] as f32 + p[2] as f32) / 3.0)
        .collect()
}

/// The text's ink, in fully covered pixels: per pixel, how far the frame
/// with text moved from the blank frame towards black, so whatever the
/// control paints behind its text (a fill, a box) cancels out.
fn ink(with: &ResolvedNode, blank: &ResolvedNode) -> f32 {
    let a = render(with);
    let b = render(blank);
    a.iter()
        .zip(&b)
        .map(|(&t, &e)| {
            // A pixel already near black in the blank frame (a border)
            // cannot show ink.
            if e < 24.0 {
                return 0.0;
            }
            ((e - t) / e).clamp(0.0, 1.0)
        })
        .sum()
}

/// A `we-text` run through `text_job`, black on white, at `weight`.
fn reference(family: &str, weight: &str) -> f32 {
    let run = |text: &str| {
        page(node(
            "we-text",
            "root/c",
            vec![
                ("text", s(text)),
                ("fontFamily", s(family)),
                ("fontSize", s(SIZE)),
                ("fontWeight", s(weight)),
                ("color", s("#000000")),
            ],
        ))
    };
    ink(&run(SAMPLE), &run(""))
}

/// Each face, with the weight its default instance sits at — the weight
/// the controls would fall back to without the tweak.
const FACES: [(&str, &str); 2] = [
    ("'Mozilla Text', serif", "200"),
    ("'Bricolage Grotesque', sans-serif", "800"),
];

/// Within this share of the explicit 400 run's ink. Measured at HEAD, at
/// 14px: every surface lands within 0.1% of it in both faces (the same
/// outlines; only the pen position differs). Without the tweak the
/// controls would be set at the default instance, measured here as an
/// explicit run at that weight: Mozilla 200 is 16% lighter, Bricolage 800
/// (at the run's opsz — the real fallback, opsz 96, differs further) 49%
/// heavier. 3% is thirty times the noise and a fifth of the smaller gap.
const TOLERANCE: f32 = 0.03;

#[test]
fn text_outside_text_job_is_set_at_400() {
    let mut failures = Vec::new();
    for (family, default_weight) in FACES {
        let regular = reference(family, "400");
        let fallback = reference(family, default_weight);
        assert!(
            (fallback - regular).abs() / regular > 2.0 * TOLERANCE,
            "{family}: the default instance ({fallback}) must be distinguishable from 400 ({regular})"
        );
        for surface in [Surface::Input, Surface::Select, Surface::FieldLabel] {
            let got = ink(
                &page(surface.build(SAMPLE, family)),
                &page(surface.build("", family)),
            );
            let drift = (got - regular) / regular;
            eprintln!(
                "{family} {surface:?}: ink {got:.1}, 400 {regular:.1}, {default_weight} {fallback:.1}, drift {:+.1}%",
                drift * 100.0
            );
            if drift.abs() > TOLERANCE {
                failures.push(format!(
                    "{family} {surface:?}: ink {got:.1} is {:+.1}% from the 400 run ({regular:.1}); \
                     the default instance ({default_weight}) is {fallback:.1}",
                    drift * 100.0
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
