//! `DropdownMenu` — a trigger plus a menu. `items` entries are
//! `{id, label, icon?, danger?, disabled?, type?}`; `type: "separator"`
//! divides groups. An item click emits `onSelect` `{id: item.id}` (the
//! payload the bundle's handlers read as `arg.id`) and the popup closes
//! itself — one item, one event.
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::props;
use crate::{
    events, Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, Widget,
    WidgetKind,
};

pub struct DropdownMenu;

impl Widget for DropdownMenu {
    fn type_name(&self) -> &'static str {
        "DropdownMenu"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Overlay
    }

    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        // The trigger child anchors; `items` float in the widget's popup.
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![PartSpec::group("trigger", Pick::Default, Direction::Column)],
        })
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::new(0.0, 0.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        let overlay = props::part(cx, node, "overlay");
        if overlay.is_none() {
            // In-flow call: a pointer click in the trigger toggles the open
            // flag (the trigger child wins egui's hit test, so we watch the
            // pointer rather than an interact region).
            let Some(anchor) = props::part(cx, node, "trigger") else {
                return;
            };
            let clicked = cx.ui.input(|i| i.pointer.any_click())
                && cx
                    .ui
                    .input(|i| i.pointer.interact_pos())
                    .is_some_and(|p| anchor.contains(p));
            if clicked {
                let open = cx.edit.is_open(&node.id);
                cx.edit.set_open(&node.id, !open);
            }
            return;
        }
        // Overlay pass: the item rows.
        let Value::List(items) = node.props.get("items").cloned().unwrap_or(Value::Undefined)
        else {
            return;
        };
        let visuals = cx.ui.visuals().clone();
        for item in items.iter() {
            let Value::Obj(map) = item else { continue };
            let ty = map.get("type").map(|v| v.js_string()).unwrap_or_default();
            if ty == "separator" || ty == "divider" {
                let r =
                    Rect::from_min_size(ui_cursor(cx.ui), egui::vec2(cx.ui.available_width(), 1.0));
                cx.ui
                    .painter()
                    .rect_filled(r, 0.0, visuals.window_stroke().color);
                cx.ui.advance_cursor_after_rect(r);
                continue;
            }
            let label = map.get("label").map(|v| v.js_string()).unwrap_or_default();
            let id = map
                .get("id")
                .cloned()
                .unwrap_or_else(|| Value::Str(label.clone().into()));
            let danger = map.get("danger").map(|v| v.truthy()).unwrap_or(false);
            let disabled = map.get("disabled").map(|v| v.truthy()).unwrap_or(false);
            let h = 24.0;
            let r = Rect::from_min_size(ui_cursor(cx.ui), egui::vec2(cx.ui.available_width(), h));
            let resp = cx.ui.interact(
                r,
                cx.ui
                    .scope_id()
                    .with((node.id.as_str(), "mi", label.as_str())),
                egui::Sense::click(),
            );
            resp.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::Button, true, label.as_str())
            });
            if resp.hovered() {
                cx.ui
                    .painter()
                    .rect_filled(r, 4.0, visuals.widgets.hovered.bg_fill);
            }
            cx.ui.painter().text(
                egui::pos2(r.min.x + 8.0, r.center().y),
                egui::Align2::LEFT_CENTER,
                &label,
                egui::FontId::default(),
                if danger {
                    visuals.error_fg_color
                } else if disabled {
                    visuals.weak_text_color()
                } else {
                    visuals.text_color()
                },
            );
            cx.ui.advance_cursor_after_rect(r);
            if resp.clicked() && !disabled {
                // The payload carries the item's own `id` — handlers read
                // `arg.id` — plus the rest of the entry object.
                let mut payload = (**map).clone();
                payload.insert("id".into(), id);
                cx.emit(
                    &node.id,
                    "onSelect",
                    events::item(Value::Obj(std::sync::Arc::new(payload))),
                );
                cx.edit.set_open(&node.id, false);
            }
        }
    }
}

fn ui_cursor(ui: &egui::Ui) -> egui::Pos2 {
    ui.cursor().min
}
