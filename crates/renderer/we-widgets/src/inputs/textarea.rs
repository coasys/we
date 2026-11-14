//! `we-textarea` — the multiline `we-input`. Same payload contract
//! (`onInput`/`onChange` carry `{detail: text}`); `rows` sets the minimum
//! height and the edit grows with its content.
use egui::TextEdit;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled, reconcile_draft, shown_text};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct Textarea;

impl Widget for Textarea {
    fn type_name(&self) -> &'static str {
        "we-textarea"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        let rows = props::prop_num(node, "rows").unwrap_or(3.0).max(1.0) as f32;
        let line = cx.ctx.fonts_mut(|f| f.row_height(&egui::FontId::default()));
        Size::new(avail.x.min(320.0), rows * line + 12.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let committed = cx.edit.draft(&node.id);
        reconcile_draft(cx.edit, node);
        let mut text = shown_text(cx.edit, node);
        let disabled = disabled(node);

        let widget = TextEdit::multiline(&mut text)
            .id_salt(node.id.as_str())
            .desired_width(rect.width())
            .desired_rows(1)
            .interactive(!disabled);
        let widget = match props::prop_str(node, "placeholder") {
            Some(p) => widget.hint_text(p),
            None => widget,
        };
        let response = cx.ui.put(rect, widget);
        response.widget_info(|| {
            egui::WidgetInfo::labeled(egui::Role::TextInput, true, access_label(cx, node))
        });

        if response.changed() {
            cx.edit
                .set_draft(&node.id, &text, props::prop(node, "value"));
            cx.emit(&node.id, "onInput", events::detail_str(&text));
            cx.edit
                .set_field(&node.id, "dirty", we_expr::Value::Bool(true));
        }
        // Ctrl+Enter submits, the way the TS textarea's `submit` event does.
        let submit = response.has_focus()
            && cx.ui.input(|i| {
                i.key_pressed(egui::Key::Enter)
                    && i.modifiers.matches_logically(egui::Modifiers::CTRL)
            });
        if submit {
            cx.emit(&node.id, "onSubmit", events::detail_str(&text));
        }
        if response.lost_focus() && cx.edit.field(&node.id, "dirty").truthy() {
            cx.edit
                .set_field(&node.id, "dirty", we_expr::Value::Bool(false));
            cx.emit(
                &node.id,
                "onChange",
                events::detail_str(committed.as_deref().unwrap_or(&text)),
            );
        }
    }
}
