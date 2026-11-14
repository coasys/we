//! `we-icon-picker` — a searchable grid of Phosphor icon names. Typing in
//! the search field filters the grid; a click emits `onChange`
//! `{detail: icon-name}` and closes the popup. The name list is a curated
//! slice of `@phosphor-icons/core`'s catalogue.
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct IconPicker;

/// A curated slice of the Phosphor catalogue — enough to search and pick.
const ICONS: &[&str] = &[
    "house",
    "magnifying-glass",
    "plus",
    "minus",
    "x",
    "check",
    "caret-down",
    "caret-up",
    "caret-left",
    "caret-right",
    "arrow-left",
    "arrow-right",
    "arrow-up",
    "arrow-down",
    "pencil-simple",
    "trash",
    "gear",
    "user",
    "users",
    "user-plus",
    "bell",
    "chat-circle",
    "chat",
    "paper-plane-tilt",
    "heart",
    "star",
    "bookmark-simple",
    "flag",
    "tag",
    "folder",
    "file",
    "image",
    "camera",
    "video-camera",
    "microphone",
    "speaker-high",
    "phone",
    "envelope-simple",
    "calendar",
    "clock",
    "timer",
    "hourglass",
    "map-pin",
    "globe",
    "compass",
    "rocket",
    "lightning",
    "sun",
    "moon",
    "cloud",
    "drop",
    "fire",
    "eye",
    "eye-slash",
    "lock",
    "lock-open",
    "key",
    "shield",
    "warning",
    "info",
    "question",
    "check-circle",
    "x-circle",
    "warning-circle",
    "link",
    "share",
    "export",
    "download",
    "upload",
    "code",
    "terminal",
    "database",
    "hard-drives",
    "wifi-high",
    "bluetooth",
    "battery-full",
    "power",
    "plug",
    "wifi-slash",
];

impl Widget for IconPicker {
    fn type_name(&self) -> &'static str {
        "we-icon-picker"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        Size::new(avail.x.min(160.0), props::control_height(node))
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let value = props::prop_string(node, "value").unwrap_or_default();
        let label = access_label(cx, node);
        let visuals = cx.ui.visuals().clone();

        let response = cx.interact_label(rect, &label, egui::Role::ComboBox, &node.id, "icon");
        cx.ui
            .painter()
            .rect_filled(rect, 4.0, visuals.widgets.inactive.bg_fill);
        cx.ui.painter().text(
            egui::pos2(rect.min.x + 8.0, rect.center().y),
            egui::Align2::LEFT_CENTER,
            if value.is_empty() {
                "Pick an icon"
            } else {
                value.as_str()
            },
            egui::FontId::default(),
            if value.is_empty() {
                visuals.weak_text_color()
            } else {
                visuals.text_color()
            },
        );
        cx.ui.painter().text(
            egui::pos2(rect.max.x - 8.0, rect.center().y),
            egui::Align2::RIGHT_CENTER,
            "v",
            egui::FontId::default(),
            visuals.weak_text_color(),
        );
        if disabled(node) {
            return;
        }

        let mut query = cx.edit.draft(&node.id).unwrap_or_default();
        egui::Popup::menu(&response).show(|ui| {
            ui.set_min_width(220.0);
            let search = ui.text_edit_singleline(&mut query);
            search.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::TextInput, true, "icon search")
            });
            if search.changed() {
                cx.edit
                    .set_draft(&node.id, &query, &Value::Str(query.clone().into()));
            }
            let q = query.to_lowercase();
            ui.add_space(4.0);
            let cell = egui::vec2(104.0, 22.0);
            let cols = 2;
            let shown: Vec<&str> = ICONS
                .iter()
                .filter(|i| q.is_empty() || i.contains(&q))
                .copied()
                .collect();
            for chunk in shown.chunks(cols) {
                ui.horizontal(|ui| {
                    for name in chunk {
                        let (r, resp) = ui.allocate_exact_size(cell, egui::Sense::click());
                        resp.widget_info(|| {
                            egui::WidgetInfo::labeled(egui::Role::Button, true, *name)
                        });
                        if resp.hovered() {
                            ui.painter()
                                .rect_filled(r, 4.0, visuals.widgets.hovered.bg_fill);
                        }
                        let sel = *name == value;
                        if sel {
                            ui.painter()
                                .rect_filled(r, 4.0, visuals.widgets.active.bg_fill);
                        }
                        ui.painter().text(
                            egui::pos2(r.min.x + 6.0, r.center().y),
                            egui::Align2::LEFT_CENTER,
                            *name,
                            egui::FontId::proportional(11.0),
                            visuals.text_color(),
                        );
                        if resp.clicked() {
                            cx.emit(&node.id, "onChange", events::detail_str(name));
                            cx.edit.clear_draft(&node.id);
                            ui.close();
                        }
                    }
                });
            }
            if shown.is_empty() {
                ui.weak("no icons match");
            }
        });
    }
}
