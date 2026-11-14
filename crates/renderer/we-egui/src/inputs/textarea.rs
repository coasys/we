//! `we-textarea` — the multiline `we-input`. Same payload contract
//! (`onInput`/`onChange` carry `{detail: text}`); `rows` sets the minimum
//! height and the edit grows with its content.
use egui::TextEdit;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{
    access_label, consume_readonly_edits, disabled, focused_last_frame, readonly, reconcile_draft,
    remember_focus, shown_text,
};
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

        // textarea.ts:315–319 — `submitOnEnter` opts in: an unshifted,
        // noncomposing Enter preventDefaults the newline and submits the
        // text when it isn't blank. The Enter has to be consumed before
        // the TextEdit sees it; focus is knowable ahead of time through
        // the widget id the previous frame stored (egui composes it from
        // the ui scope, so asking is more reliable than predicting).
        let submit_on_enter = props::prop_bool(node, "submitOnEnter");
        let focused = focused_last_frame(cx, node);
        // textarea.ts:413 `?readonly` — same contract as we-input: focus
        // stays, edits are consumed before the TextEdit gets them.
        if readonly(node) && focused {
            consume_readonly_edits(cx, true);
        }
        let mut composing = cx.edit.field(&node.id, "ime").truthy();
        let mut plain_enter = false;
        if focused {
            cx.ui.input(|i| {
                for e in &i.events {
                    match e {
                        egui::Event::Ime(egui::ImeEvent::Preedit { text, .. }) => {
                            composing = !text.is_empty();
                        }
                        egui::Event::Ime(egui::ImeEvent::Commit(_)) => {
                            composing = false;
                        }
                        egui::Event::Key {
                            key: egui::Key::Enter,
                            pressed: true,
                            modifiers,
                            ..
                        } if *modifiers == egui::Modifiers::NONE && !composing => {
                            plain_enter = true;
                        }
                        _ => {}
                    }
                }
            });
            if composing != cx.edit.field(&node.id, "ime").truthy() {
                cx.edit
                    .set_field(&node.id, "ime", we_expr::Value::Bool(composing));
            }
        }
        if submit_on_enter && focused && plain_enter {
            cx.ui.input_mut(|i| {
                i.consume_key(egui::Modifiers::NONE, egui::Key::Enter);
            });
        }

        let widget = TextEdit::multiline(&mut text)
            .id_salt(node.id.as_str())
            .desired_width(rect.width())
            .desired_rows(1)
            .interactive(!disabled);
        let widget = match props::prop_string(node, "placeholder") {
            Some(p) => widget.hint_text(p),
            None => widget,
        };
        let response = cx.ui.put(rect, widget);
        remember_focus(cx, node, &response);
        response.widget_info(|| {
            egui::WidgetInfo::labeled(egui::Role::TextInput, !disabled, access_label(cx, node))
        });

        if response.changed() {
            cx.edit
                .set_draft(&node.id, &text, props::prop(node, "value"));
            cx.emit(&node.id, "onInput", events::detail_str(&text));
            cx.edit
                .set_field(&node.id, "dirty", we_expr::Value::Bool(true));
        }
        if submit_on_enter && plain_enter && !text.trim().is_empty() {
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
