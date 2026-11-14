//! `--gallery style` — the design-system showcase: colour roles, the space
//! scale, radii and shadows, painted from `we_style::resolve` under the theme
//! picked in the debug strip. The same [`gallery_ui`] runs inside a
//! `egui_kittest::Harness` for the per-theme snapshots.

#[cfg(not(target_arch = "wasm32"))]
use std::path::PathBuf;
use std::sync::Arc;

use egui::{Color32, Stroke, StrokeKind, Ui, Vec2};
use we_expr::Value;
#[cfg(not(target_arch = "wasm32"))]
use we_style::ThemeSet;
use we_style::{Bag, Color, Direction, Polarity, Size, Style, StyleInput, Theme};

/// The recorded token tables ship with the repo — `tokens/<theme>.json`
/// beside `crates/`, the same layout `DEFAULT_BUNDLE` assumes.
#[cfg(not(target_arch = "wasm32"))]
pub fn tokens_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors/tokens")
}

/// Every theme with a recorded table, in the brief's six-theme order.
#[cfg(not(target_arch = "wasm32"))]
pub fn load_theme_set() -> ThemeSet {
    let mut set = ThemeSet::new();
    for id in THEME_ORDER {
        let path = tokens_dir().join(format!("{id}.json"));
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if let Ok(theme) = Theme::from_recorded(*id, polarity_for(id), &json) {
            set.push(theme);
        }
    }
    set
}

/// The six themes the conformance tables record, in a stable display order.
pub const THEME_ORDER: &[&str] = &["light", "dark", "black", "retro", "cyberpunk", "glow"];

/// The polarity each preset declares — `glow` is a dark theme.
pub fn polarity_for(id: &str) -> Polarity {
    match id {
        "light" | "retro" | "twitter" => Polarity::Light,
        _ => Polarity::Dark,
    }
}

fn color32(c: Color) -> Color32 {
    let [r, g, b, a] = c.to_premultiplied();
    Color32::from_rgba_premultiplied(
        (r * 255.0) as u8,
        (g * 255.0) as u8,
        (b * 255.0) as u8,
        (a * 255.0) as u8,
    )
}

fn bag1(key: &str, value: &str) -> Bag {
    [(Arc::from(key), Value::Str(Arc::from(value)))]
        .into_iter()
        .collect()
}

fn resolve1(input: &StyleInput, key: &str, value: &str) -> Style {
    we_style::resolve(&bag1(key, value), input)
}

/// `Dimension::to_px` plus the one symbolic unit the gallery can answer:
/// `Percent` against the box it is drawn in (`radius: 50%` rounds a rect).
fn dim_px(d: we_style::Dimension, input: &StyleInput, percent_of: f32) -> Option<f32> {
    match d {
        we_style::Dimension::Percent(p) => Some(p * percent_of),
        other => other.to_px(input.font_px, input.root_px, input.viewport),
    }
}

/// A swatch: the resolved colour as a filled rect, or a hollow box for a
/// value the table left unevaluated — the honest "paints nothing" state.
fn swatch(ui: &mut Ui, label: &str, color: Option<Color32>, detail: &str) {
    ui.horizontal(|ui| {
        let (rect, _) = ui.allocate_exact_size(Vec2::new(56.0, 20.0), egui::Sense::hover());
        match color {
            Some(c) => {
                ui.painter().rect_filled(rect, 2.0, c);
            }
            None => {
                ui.painter().rect_stroke(
                    rect,
                    2.0,
                    Stroke::new(1.0, Color32::GRAY),
                    StrokeKind::Inside,
                );
            }
        }
        ui.monospace(label);
        ui.weak(detail);
    });
}

const ROLES: &[&str] = &[
    "page",
    "chrome",
    "surface",
    "surface-raised",
    "surface-sunken",
    "surface-hover",
    "surface-active",
    "surface-sunken-hover",
    "field",
    "field-hover",
    "control-surface",
    "text",
    "text-muted",
    "text-faint",
    "on-inverse",
    "surface-inverse",
    "border",
    "border-strong",
    "border-hover",
    "item-hover",
    "selected",
    "on-selected",
    "text-selection",
    "overlay",
    "shadow-color",
    "focus",
    "accent",
    "accent-soft",
    "accent-text",
    "accent-border",
    "accent-hover",
    "accent-active",
    "on-accent",
    "on-accent-muted",
    "danger",
    "danger-soft",
    "danger-text",
    "danger-border",
    "on-danger",
    "success",
    "warning",
    "info",
];

const SPACES: &[&str] = &[
    "0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000",
];
const RADII: &[&str] = &[
    "0", "100", "200", "300", "400", "500", "600", "control", "surface", "card", "input", "avatar",
    "media", "pill", "full",
];
const SHADOWS: &[&str] = &["sm", "md", "lg", "xl", "2xl", "glow"];
const FONT_SIZES: &[&str] = &[
    "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000",
];
const FONT_WEIGHTS: &[&str] = &["300", "400", "500", "600", "700", "semibold", "bold"];
const LINE_HEIGHTS: &[&str] = &["none", "tight", "snug", "normal", "relaxed", "loose"];
const LETTER_SPACINGS: &[&str] = &["tighter", "tight", "normal", "wide", "wider", "widest"];
const TRANSITION_TOKENS: &[&str] = &["0", "100", "200", "300", "400", "500"];
const Z_LAYERS: &[&str] = &[
    "dropdown", "sticky", "chrome", "modal", "popover", "toast", "tooltip",
];

/// The showcase: roles as swatches, space as bars, radii as rounded corners,
/// shadows as lifted rects. Values the theme's table leaves unevaluated draw
/// hollow or report `unresolved` — visible *because* they resolve to
/// nothing, never guessed.
pub fn gallery_ui(ui: &mut Ui, theme: &Theme) {
    let vp = ui.ctx().content_rect().size();
    let input = StyleInput::new(&theme.tokens, Direction::Column);
    let input = StyleInput {
        viewport: Size::new(vp.x, vp.y),
        container_width: vp.x,
        ..input
    };
    let input = &input;

    egui::ScrollArea::vertical().show(ui, |ui| {
        ui.heading(format!("theme: {}", theme.id));
        ui.add_space(8.0);

        ui.heading("colour roles");
        egui::Grid::new("roles").num_columns(2).show(ui, |ui| {
            for (i, role) in ROLES.iter().enumerate() {
                let style = resolve1(input, "bg", role);
                let detail = style
                    .unsupported
                    .first()
                    .map(|u| u.to_string())
                    .unwrap_or_default();
                swatch(ui, role, style.paint.bg.map(color32), &detail);
                if i % 2 == 1 {
                    ui.end_row();
                }
            }
        });
        ui.add_space(8.0);

        ui.heading("space scale");
        for t in SPACES {
            let style = resolve1(input, "gap", t);
            ui.horizontal(|ui| {
                ui.monospace(format!("{t:>3}"));
                match style.layout.gap.map(|(d, _)| d) {
                    Some(d) => {
                        let px = d.to_px(input.font_px, input.root_px, input.viewport);
                        let w = px.unwrap_or(2.0).clamp(2.0, 300.0);
                        let (rect, _) =
                            ui.allocate_exact_size(Vec2::new(w, 12.0), egui::Sense::hover());
                        ui.painter().rect_filled(rect, 1.0, Color32::LIGHT_BLUE);
                        ui.weak(format!("{d:?}"));
                    }
                    None => {
                        ui.weak("unresolved");
                    }
                }
            });
        }
        ui.add_space(8.0);

        ui.heading("radius tokens");
        for row in RADII.chunks(8) {
            ui.horizontal_wrapped(|ui| {
                for t in row {
                    let style = resolve1(input, "r", t);
                    let px = style
                        .paint
                        .radius
                        .top
                        .and_then(|d| dim_px(d, input, 30.0))
                        .unwrap_or(0.0);
                    ui.vertical(|ui| {
                        let (rect, _) =
                            ui.allocate_exact_size(Vec2::new(44.0, 30.0), egui::Sense::hover());
                        ui.painter().rect_filled(
                            rect,
                            px.min(15.0),
                            Color32::from_rgb(120, 144, 200),
                        );
                        ui.monospace(*t);
                        // `r: "0"` emits no border-radius declaration at all —
                        // the browser keeps its default 0. That is faithful,
                        // not a gap.
                        let detail = if *t == "0" {
                            "no decl".to_string()
                        } else {
                            match style.paint.radius.top {
                                Some(d) => format!("{d:?}"),
                                None => "unresolved".to_string(),
                            }
                        };
                        ui.weak(detail);
                    });
                }
            });
        }
        ui.add_space(8.0);

        ui.heading("shadows");
        ui.horizontal_wrapped(|ui| {
            for t in SHADOWS {
                let style = resolve1(input, "shadow", t);
                ui.vertical(|ui| {
                    let (rect, _) =
                        ui.allocate_exact_size(Vec2::new(56.0, 36.0), egui::Sense::hover());
                    let painter = ui.painter();
                    if let Some(shadows) = &style.paint.shadows {
                        for s in shadows {
                            let dx =
                                s.dx.to_px(input.font_px, input.root_px, input.viewport)
                                    .unwrap_or(0.0);
                            let dy =
                                s.dy.to_px(input.font_px, input.root_px, input.viewport)
                                    .unwrap_or(0.0);
                            let spread = s
                                .spread
                                .and_then(|d| d.to_px(input.font_px, input.root_px, input.viewport))
                                .unwrap_or(0.0);
                            let col = s
                                .color
                                .map(color32)
                                .unwrap_or(Color32::from_black_alpha(40));
                            painter.rect_filled(
                                rect.translate(egui::vec2(dx, dy)).expand(spread.max(0.0)),
                                4.0,
                                col,
                            );
                        }
                    }
                    painter.rect_filled(
                        rect.shrink(6.0),
                        4.0,
                        ui.visuals().widgets.inactive.bg_fill,
                    );
                    ui.monospace(*t);
                });
            }
        });
        ui.add_space(8.0);

        ui.heading("type");
        ui.horizontal_wrapped(|ui| {
            for t in FONT_SIZES {
                let style = resolve1(input, "fontSize", t);
                match style.text.font_size.and_then(|d| dim_px(d, input, 30.0)) {
                    Some(px) => {
                        ui.label(
                            egui::RichText::new(format!("{t} "))
                                .size(px.clamp(8.0, 64.0))
                                .monospace(),
                        );
                    }
                    None => {
                        ui.weak(format!("{t}: unresolved"));
                    }
                }
            }
        });
        ui.horizontal_wrapped(|ui| {
            for t in FONT_WEIGHTS {
                let style = resolve1(input, "fontWeight", t);
                match style.text.font_weight {
                    Some(w) => {
                        ui.monospace(format!("{t}={w:.0}"));
                    }
                    None => {
                        ui.weak(format!("{t}: unresolved"));
                    }
                }
                ui.add_space(6.0);
            }
        });
        ui.horizontal_wrapped(|ui| {
            for t in LINE_HEIGHTS {
                let style = resolve1(input, "lineHeight", t);
                match style.text.line_height {
                    Some(lh) => {
                        ui.monospace(format!("{t}={lh:?}"));
                    }
                    None => {
                        ui.weak(format!("{t}: unresolved"));
                    }
                }
                ui.add_space(6.0);
            }
        });
        ui.horizontal_wrapped(|ui| {
            for t in LETTER_SPACINGS {
                let style = resolve1(input, "letterSpacing", t);
                match style.text.letter_spacing {
                    Some(d) => {
                        ui.monospace(format!("{t}={d:?}"));
                    }
                    None => {
                        ui.weak(format!("{t}: unresolved"));
                    }
                }
                ui.add_space(6.0);
            }
        });
        ui.add_space(8.0);

        ui.heading("motion & layers");
        ui.horizontal_wrapped(|ui| {
            for t in TRANSITION_TOKENS {
                let style = resolve1(input, "transition", &format!("opacity {t} ease-out"));
                match style.transitions.first() {
                    Some(tr) => {
                        ui.monospace(format!(
                            "{t}: {}ms {:?}",
                            tr.duration_ms.unwrap_or(f32::NAN),
                            tr.easing
                        ));
                    }
                    None => {
                        ui.weak(format!("{t}: unresolved"));
                    }
                }
                ui.add_space(8.0);
            }
        });
        ui.horizontal_wrapped(|ui| {
            for t in Z_LAYERS {
                let style = resolve1(input, "zIndex", t);
                match style.paint.z_index {
                    Some(we_style::ZIndex::Value(z)) => {
                        ui.monospace(format!("{t}={z}"));
                    }
                    Some(we_style::ZIndex::Auto) => {
                        ui.monospace(format!("{t}=auto"));
                    }
                    None => {
                        ui.weak(format!("{t}: unresolved"));
                    }
                }
                ui.add_space(8.0);
            }
        });
        ui.add_space(8.0);

        ui.heading("unsupported on this theme");
        let demo = we_style::resolve(
            &[
                (Arc::from("bg"), Value::Str(Arc::from("surface"))),
                (Arc::from("r"), Value::Str(Arc::from("card"))),
                (Arc::from("gap"), Value::Str(Arc::from("300"))),
            ]
            .into_iter()
            .collect::<Bag>(),
            input,
        );
        for u in &demo.unsupported {
            ui.weak(u.as_ref());
        }
        if demo.unsupported.is_empty() {
            ui.weak("none");
        }
    });
}

/// The widget gallery's schema — one Column of per-type samples, rendered
/// through [`crate::RendererApp`] like any real template.
#[cfg(not(target_arch = "wasm32"))]
pub const WIDGET_GALLERY_SCHEMA: &str = include_str!("../gallery/widgets.json");

/// `--gallery widgets`: a RendererApp over [`WIDGET_GALLERY_SCHEMA`] under
/// the picked theme — the same harness shape the snapshot tests drive.
#[cfg(not(target_arch = "wasm32"))]
pub struct WidgetsApp {
    set: ThemeSet,
    current: String,
    app: crate::RendererApp,
}

#[cfg(not(target_arch = "wasm32"))]
impl Default for WidgetsApp {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl WidgetsApp {
    pub fn new() -> Self {
        let set = load_theme_set();
        let current = set
            .get("dark")
            .or_else(|| set.iter().next())
            .map(|t| t.id.to_string())
            .unwrap_or_else(|| "dark".to_string());
        let schema: we_template::SchemaNode =
            serde_json::from_str(WIDGET_GALLERY_SCHEMA).expect("widget gallery schema parses");
        let mut app = crate::RendererApp::new(
            schema,
            "widget-gallery",
            Arc::new(we_template::StoreBag::new()),
            we_template::RouteState::new("/gallery"),
            we_widgets::Registry::with_builtins(),
        );
        let (theme, _) = set.theme(&current);
        app.theme = theme.clone();
        Self { set, current, app }
    }

    /// `theme` → a RendererApp over the gallery schema (tests take this path).
    pub fn app_for(set: &ThemeSet, theme: &str) -> crate::RendererApp {
        let schema: we_template::SchemaNode =
            serde_json::from_str(WIDGET_GALLERY_SCHEMA).expect("widget gallery schema parses");
        let mut app = crate::RendererApp::new(
            schema,
            "widget-gallery",
            Arc::new(we_template::StoreBag::new()),
            we_template::RouteState::new("/gallery"),
            we_widgets::Registry::with_builtins(),
        );
        let (theme, _) = set.theme(theme);
        app.theme = theme.clone();
        app
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl eframe::App for WidgetsApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        ui.horizontal(|ui| {
            ui.label("theme");
            let mut picked = None;
            for theme in self.set.iter() {
                if ui
                    .selectable_label(self.current == theme.id.as_ref(), theme.id.as_ref())
                    .clicked()
                {
                    picked = Some(theme.id.to_string());
                }
            }
            if let Some(id) = picked {
                self.current = id;
                let (theme, _) = self.set.theme(&self.current);
                self.app.theme = theme.clone();
            }
        });
        ui.separator();
        self.app.frame_body(ui);
    }
}

/// The running app: a debug strip with the theme picker over the gallery.
/// Switching swaps the `Arc<TokenTable>` — nothing else changes.
#[cfg(not(target_arch = "wasm32"))]
pub struct GalleryApp {
    set: ThemeSet,
    current: String,
}

#[cfg(not(target_arch = "wasm32"))]
impl Default for GalleryApp {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl GalleryApp {
    pub fn new() -> Self {
        let set = load_theme_set();
        let current = set
            .get("dark")
            .or_else(|| set.iter().next())
            .map(|t| t.id.to_string())
            .unwrap_or_else(|| "dark".to_string());
        Self { set, current }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl eframe::App for GalleryApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        ui.horizontal(|ui| {
            ui.label("theme");
            let mut picked = None;
            for theme in self.set.iter() {
                if ui
                    .selectable_label(self.current == theme.id.as_ref(), theme.id.as_ref())
                    .clicked()
                {
                    picked = Some(theme.id.to_string());
                }
            }
            if let Some(id) = picked {
                self.current = id;
            }
        });
        ui.separator();
        let (theme, fell_back) = self.set.theme(&self.current);
        if fell_back {
            ui.weak(format!("no table for {}; showing dark", self.current));
        }
        gallery_ui(ui, theme);
    }
}
