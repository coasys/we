//! `we-textarea` — the multiline `we-input`. Same payload contract
//! (`onInput`/`onChange` carry `{detail: text}`); `rows` sets the minimum
//! height and the edit grows with its content.
use egui::TextEdit;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{
    access_label, disabled, focused_last_frame, readonly, reconcile_draft, remember_focus,
    shown_text,
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

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        let rows = props::prop_num(node, "rows").unwrap_or(3.0).max(1.0) as f32;
        let font = props::editor_font(style, cx.ctx);
        let line = cx.ctx.fonts_mut(|f| f.row_height(&font));
        Size::new(avail.x.min(320.0), rows * line + 12.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        // The DOM `change` event carries the field's text at commit time
        // (input.ts:282–285 reads `e.target.value`): `text` after the
        // editor ran is exactly what the field displays this frame — a
        // same-frame keystroke, an external write, or the live rule's
        // revert included — so it is what onInput reported and what
        // onChange commits. No frame-start draft is ever committed.
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
        // textarea.ts:413 `?readonly` — same contract as we-input: the
        // immutable `&str` buffer is the DOM attribute (edits are no-ops
        // however focus arrived); focus, selection and copy stay live.
        let mut composing = cx.edit.field(&node.id, "ime").truthy();
        // textarea.ts:316 — Shift and an open composition are the only
        // exclusions: Ctrl/Cmd/Alt+Enter submit exactly like a plain
        // Enter. The matched modifiers ride along so the preventDefault
        // consumes the same keystroke it came from.
        let mut submit_mods = Vec::new();
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
                        } if !modifiers.shift && !composing => {
                            submit_mods.push(*modifiers);
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
        if submit_on_enter && focused && !submit_mods.is_empty() {
            cx.ui.input_mut(|i| {
                for mods in &submit_mods {
                    i.consume_key(*mods, egui::Key::Enter);
                }
            });
        }

        let is_readonly = readonly(node);
        let mut readonly_text;
        let buffer: &mut dyn egui::TextBuffer = if is_readonly {
            readonly_text = text.as_str();
            &mut readonly_text
        } else {
            &mut text
        };
        let widget = TextEdit::multiline(buffer)
            .id_salt(node.id.as_str())
            .desired_width(rect.width())
            .font(props::editor_font(style, cx.ui.ctx()))
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

        // Same spurious `changed` as we-input: a mutation the immutable
        // buffer no-opped must not emit.
        if response.changed() && !is_readonly {
            cx.edit
                .set_draft(&node.id, &text, props::prop(node, "value"));
            cx.emit(&node.id, "onInput", events::detail_str(&text));
            cx.edit
                .set_field(&node.id, "dirty", we_expr::Value::Bool(true));
        }
        if submit_on_enter && !submit_mods.is_empty() && !text.trim().is_empty() {
            for _ in &submit_mods {
                cx.emit(&node.id, "onSubmit", events::detail_str(&text));
            }
        }
        if response.lost_focus() && cx.edit.field(&node.id, "dirty").truthy() {
            cx.edit
                .set_field(&node.id, "dirty", we_expr::Value::Bool(false));
            cx.emit(&node.id, "onChange", events::detail_str(&text));
        }
    }
}
