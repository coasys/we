//! `we-color-picker` — a swatch button plus a hex field in a popup. `value`
//! is `#rrggbb`; picking a swatch or committing the field emits `onChange`
//! `{detail: "#rrggbb"}`. The `swatches` prop overrides the default ramp.
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct ColorPicker;

/// The token-flavoured default palette (matches the TS primitive's set).
const SWATCHES: &[&str] = &[
    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
    "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
    "#f43f5e", "#64748b",
];

fn parse_hex(s: &str) -> Option<egui::Color32> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some(egui::Color32::from_rgb(r, g, b))
}

fn normalize(s: &str) -> String {
    let s = s.trim();
    if s.starts_with('#') {
        s.to_string()
    } else {
        format!("#{s}")
    }
}

fn swatches(node: &ResolvedNode) -> Vec<String> {
    match props::prop(node, "swatches") {
        Value::List(l) => l
            .iter()
            .filter_map(|v| match v {
                Value::Str(s) => Some(s.to_string()),
                _ => None,
            })
            .collect(),
        _ => SWATCHES.iter().map(|s| s.to_string()).collect(),
    }
}

impl Widget for ColorPicker {
    fn type_name(&self) -> &'static str {
        "we-color-picker"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        Size::new(avail.x.min(120.0), props::control_height(node))
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let value = normalize(&props::prop_str(node, "value").unwrap_or_default());
        let label = access_label(cx, node);
        let visuals = cx.ui.visuals().clone();

        let response = cx.interact_label(rect, &label, egui::Role::Button, &node.id, "color");
        cx.ui
            .painter()
            .rect_filled(rect, 4.0, visuals.widgets.inactive.bg_fill);
        if let Some(c) = parse_hex(&value) {
            cx.ui.painter().rect_filled(
                Rect::from_center_size(
                    egui::pos2(rect.min.x + 14.0, rect.center().y),
                    egui::vec2(16.0, 16.0),
                ),
                4.0,
                c,
            );
        }
        cx.ui.painter().text(
            egui::pos2(rect.min.x + 36.0, rect.center().y),
            egui::Align2::LEFT_CENTER,
            &value,
            egui::FontId::default(),
            visuals.text_color(),
        );
        if disabled(node) {
            return;
        }

        let mut hex = cx.edit.draft(&node.id).unwrap_or_else(|| value.clone());
        egui::Popup::menu(&response).show(|ui| {
            ui.set_min_width(196.0);
            // Swatch grid.
            let size = egui::vec2(22.0, 22.0);
            for chunk in swatches(node).chunks(7) {
                ui.horizontal(|ui| {
                    for s in chunk {
                        let (r, resp) = ui.allocate_exact_size(size, egui::Sense::click());
                        let c = parse_hex(s).unwrap_or(egui::Color32::GRAY);
                        ui.painter().rect_filled(r, 4.0, c);
                        if s == &value {
                            ui.painter().rect_stroke(
                                r,
                                4.0,
                                visuals.widgets.active.fg_stroke,
                                egui::StrokeKind::Middle,
                            );
                        }
                        if resp.clicked() {
                            cx.emit(&node.id, "onChange", events::detail_str(&normalize(s)));
                        }
                    }
                });
            }
            // Free hex input — commit on Enter/blur.
            let resp = ui.text_edit_singleline(&mut hex);
            if resp.changed() {
                cx.edit
                    .set_draft(&node.id, &hex, props::prop(node, "value"));
            }
            let enter = resp.has_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
            if (resp.lost_focus() || enter) && parse_hex(&hex).is_some() && normalize(&hex) != value
            {
                cx.edit.clear_draft(&node.id);
                cx.emit(&node.id, "onChange", events::detail_str(&normalize(&hex)));
            }
        });
    }
}
