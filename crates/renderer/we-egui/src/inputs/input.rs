//! `we-input` — a single-line controlled input. `value` is the shown text;
//! a keystroke emits `onInput` `{detail: text}`, blur-or-Enter commits
//! `onChange`, and every key reports `onKeyDown` `{detail:{key,code,
//! isComposing}}` — the envelope the bundle's handlers read.
use egui::TextEdit;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{
    access_label, consume_readonly_edits, disabled, focused_last_frame, readonly, reconcile_draft,
    remember_focus, shown_text,
};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct Input;

impl Input {
    fn line_height(cx: &MeasureCx) -> f32 {
        cx.ctx.fonts_mut(|f| f.row_height(&egui::FontId::default()))
    }
}

impl Widget for Input {
    fn type_name(&self) -> &'static str {
        "we-input"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        let h = props::control_height(node).max(Self::line_height(cx) + 10.0);
        Size::new(avail.x.min(220.0), h)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        // The DOM `change` event carries the field's text at commit time —
        // the draft, not the prop it is about to be replaced by.
        let committed = cx.edit.draft(&node.id);
        reconcile_draft(cx.edit, node);
        let mut text = shown_text(cx.edit, node);
        let disabled = disabled(node);
        // input.ts:352 `?readonly` — focus and selection stay, edits are
        // consumed before the TextEdit gets them.
        if readonly(node) && focused_last_frame(cx, node) {
            consume_readonly_edits(cx, false);
        }
        let is_password =
            matches!(props::prop(node, "type"), we_expr::Value::Str(s) if s.as_ref() == "password");

        let widget = TextEdit::singleline(&mut text)
            .id_salt(node.id.as_str())
            .desired_width(rect.width())
            // Centre the text block in the field — the theme's atom
            // alignment is LEFT_TOP, which parks the text high inside a
            // `control_height` rect.
            .min_size(rect.size())
            .align(egui::Align2::LEFT_CENTER)
            .password(is_password)
            .interactive(!disabled);
        let widget = match props::prop_string(node, "placeholder") {
            Some(p) => widget.hint_text(p),
            None => widget,
        };
        let response = cx.ui.put(rect, widget);
        remember_focus(cx, node, &response);
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

        // Keys, only while focused — `key` is the egui name ("Enter",
        // "A", "Escape"), which is what the bundle compares against. The
        // frame Enter *surrenders* focus counts too (`lost_focus`), or the
        // submit keystroke would never reach `onKeyDown`.
        let mut ime_enter = false;
        if response.has_focus() || response.lost_focus() {
            // `isComposing` rides along: an Enter still inside the IME's
            // composition is the candidate's, not a submit. egui reports
            // it the way the DOM does — the `Ime` events around the key
            // say whether the field was composing when it arrived, so the
            // events are walked in order and the flag lands per keydown.
            let was_composing = cx.edit.field(&node.id, "ime").truthy();
            let (keys, composing) = cx.ui.input(|i| {
                let mut composing = was_composing;
                let mut keys = Vec::new();
                for e in &i.events {
                    match e {
                        egui::Event::Ime(egui::ImeEvent::Preedit { text, .. }) => {
                            composing = !text.is_empty();
                        }
                        egui::Event::Ime(egui::ImeEvent::Commit(_)) => {
                            composing = false;
                        }
                        egui::Event::Key {
                            key,
                            physical_key,
                            pressed: true,
                            ..
                        } => keys.push((
                            format!("{key:?}"),
                            format!("{:?}", physical_key.unwrap_or(*key)),
                            composing,
                        )),
                        _ => {}
                    }
                }
                (keys, composing)
            });
            if composing != was_composing {
                cx.edit
                    .set_field(&node.id, "ime", we_expr::Value::Bool(composing));
            }
            let enter = keys
                .iter()
                .any(|(k, _, composing)| k == "Enter" && !composing);
            // A composing Enter commits the candidate, not the field — and
            // the focus the TextEdit surrenders to it is the IME's, not
            // the user's blur, so the lost-focus commit below must not
            // run for it either.
            ime_enter = keys
                .iter()
                .any(|(k, _, composing)| k == "Enter" && *composing);
            if ime_enter {
                // The DOM input keeps focus through the composition — take
                // back the focus egui's TextEdit surrenders on Enter, or
                // the arriving `Commit` lands on a blurred field.
                response.request_focus();
            }
            for (key, code, composing) in keys {
                cx.emit(
                    &node.id,
                    "onKeyDown",
                    events::key_down(&key, &code, composing),
                );
            }
            let dirty = cx.edit.field(&node.id, "dirty").truthy();
            if enter && dirty {
                cx.edit
                    .set_field(&node.id, "dirty", we_expr::Value::Bool(false));
                cx.emit(
                    &node.id,
                    "onChange",
                    events::detail_str(committed.as_deref().unwrap_or(&text)),
                );
            }
        }
        if response.lost_focus() && !ime_enter && cx.edit.field(&node.id, "dirty").truthy() {
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
