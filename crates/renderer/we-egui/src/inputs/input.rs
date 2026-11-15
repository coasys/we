//! `we-input` — a single-line controlled input. `value` is the shown text;
//! a keystroke emits `onInput` `{detail: text}`, blur-or-Enter commits
//! `onChange`, and every key reports `onKeyDown` `{detail:{key,code,
//! isComposing}}` — the envelope the bundle's handlers read.
use egui::TextEdit;
use we_layout::{Direction, PartSpec, PartsSpec, Pick};
use we_style::Style;
use we_template::{ResolvedChild, ResolvedNode};

use crate::inputs::{
    access_label, disabled, readonly, reconcile_draft, remember_focus, shown_text,
};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct Input;

impl Input {
    /// The field's font: egui's body size in the theme's family — the
    /// web input is `font: inherit`, so a themed face reaches the text.
    /// The field's text: the control face at the resolved `font-size`
    /// (input.ts's size tier, or an authored size — `font: inherit` on the
    /// native input), egui's control size where none resolves.
    fn font(style: &Style, ctx: &egui::Context) -> egui::FontId {
        let font = props::control_font(style, ctx);
        let view = crate::defaults::view_of(ctx);
        let size = style
            .text
            .font_size
            .and_then(|d| d.to_px(&view.metrics, view.viewport))
            .unwrap_or(font.size);
        egui::FontId::new(size, font.family)
    }

    fn has_slot(node: &ResolvedNode, slot: &str) -> bool {
        node.children.iter().any(|c| match c {
            ResolvedChild::Node(n) => n.slot.as_deref() == Some(slot),
            _ => false,
        })
    }

    fn line_height(cx: &MeasureCx, style: &Style) -> f32 {
        let font = Self::font(style, cx.ctx);
        cx.ctx.fonts_mut(|f| f.row_height(&font))
    }
}

impl Widget for Input {
    fn type_name(&self) -> &'static str {
        "we-input"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    /// `[part='base']` is a row: the `start` slot, the text (`flex: 1`),
    /// the `end` slot — so a slotted icon sits at the field's padding and
    /// the text starts after it. Without slotted children the field stays a
    /// leaf and measures itself.
    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec> {
        let (start, end) = (Self::has_slot(node, "start"), Self::has_slot(node, "end"));
        if !start && !end {
            return None;
        }
        let mut parts = Vec::new();
        if start {
            parts.push(
                PartSpec::group("start", Pick::Named("start".into()), Direction::Row)
                    .aligned(we_style::ItemAlign::Center),
            );
        }
        parts.push(PartSpec::fixed("text", 0.0, 0.0).growing(1.0));
        if end {
            parts.push(
                PartSpec::group("end", Pick::Named("end".into()), Direction::Row)
                    .aligned(we_style::ItemAlign::Center),
            );
        }
        Some(PartsSpec {
            direction: Direction::Row,
            parts,
        })
    }

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        let h = props::control_height(node).max(Self::line_height(cx, style) + 10.0);
        Size::new(avail.x.min(220.0), h)
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
        // input.ts:352 `?readonly` — the DOM attribute blocks edits
        // intrinsically, whenever focus arrived, while focus, selection
        // and copy stay live. An immutable `&str` buffer is that
        // attribute: every insert/delete is a no-op inside the TextEdit,
        // so a keystroke in the first-focus frame (before any remembered
        // focus id existed) cannot land either.
        let is_readonly = readonly(node);
        let mut readonly_text;
        let buffer: &mut dyn egui::TextBuffer = if is_readonly {
            readonly_text = text.as_str();
            &mut readonly_text
        } else {
            &mut text
        };
        let is_password =
            matches!(props::prop(node, "type"), we_expr::Value::Str(s) if s.as_ref() == "password");

        // The TextEdit's persistent id, fixed on the widget below — the
        // chrome paints before `put`, so its state is read directly: the
        // pointer over the field (`:hover`), focus through the id
        // (`:focus-within` styles: cyberpunk's accent border), composed
        // as the DOM composes them; a disabled field takes only its
        // disabled state.
        let wid = cx.ui.make_persistent_id((node.id.as_str(), "we-input"));
        let chrome_style = if disabled {
            match &style.disabled {
                Some(p) => props::patched(style, p),
                None => std::borrow::Cow::Borrowed(style),
            }
        } else {
            let hover = cx
                .ui
                .rect_contains_pointer(rect)
                .then_some(style.hover.as_deref())
                .flatten();
            let focus = cx
                .ui
                .ctx()
                .memory(|m| m.has_focus(wid))
                .then_some(style.focus.as_deref())
                .flatten();
            if hover.is_none() && focus.is_none() {
                std::borrow::Cow::Borrowed(style)
            } else {
                let mut out = style.pretier.as_deref().unwrap_or(style).clone();
                for p in [hover, focus].into_iter().flatten() {
                    out.apply(p);
                }
                std::borrow::Cow::Owned(out)
            }
        };
        cx.report_state(&chrome_style);
        let style: &Style = &chrome_style;

        // Chrome that comes from the resolved style — the theme's part
        // rule (retro's white bevelled well) or authored `styles` —
        // replaces egui's own TextEdit frame; an unstyled field keeps it.
        let view = crate::defaults::view_of(cx.ui.ctx());
        let chrome = style.paint.bg.is_some()
            || style.paint.shadows.as_ref().is_some_and(|s| !s.is_empty())
            || style.paint.clip.is_some()
            || style.paint.borders.as_slice().iter().any(|b| {
                b.as_ref().is_some_and(|s| {
                    !matches!(
                        s.kind,
                        we_style::BorderKind::None | we_style::BorderKind::Hidden
                    )
                })
            });
        if chrome {
            props::paint_box(
                cx.ui.painter(),
                rect,
                style,
                props::text_color(style, cx.ui.ctx()),
                view,
            );
        }

        let mut widget = TextEdit::singleline(buffer)
            .id(wid)
            .font(Self::font(style, cx.ui.ctx()))
            .desired_width(rect.width())
            // Centre the text block in the field — the theme's atom
            // alignment is LEFT_TOP, which parks the text high inside a
            // `control_height` rect.
            .min_size(rect.size())
            .align(egui::Align2::LEFT_CENTER)
            .password(is_password)
            .interactive(!disabled);
        if chrome {
            // The resolved padding/border insets — and the slots' room —
            // carry as the frame's inner margin, so the text starts at the
            // content box. (egui ignores `TextEdit::margin` once a frame is
            // given: the margin has to ride on the frame itself.)
            let mut inner = props::content_rect(rect, style, view, cx.cb_w);
            // The text takes what the slots leave (`[part='input']` is
            // `flex: 1` between them).
            if let Some(start) = cx.parts.get(&(node.id.clone(), "start")) {
                inner.min.x = inner.min.x.max(start.max.x);
            }
            if let Some(end) = cx.parts.get(&(node.id.clone(), "end")) {
                inner.max.x = inner.max.x.min(end.min.x);
            }
            let m = |v: f32| v.round().clamp(0.0, 127.0) as i8;
            widget = widget.frame(egui::Frame::NONE.inner_margin(egui::Margin {
                left: m(inner.min.x - rect.min.x),
                top: m(inner.min.y - rect.min.y),
                right: m(rect.max.x - inner.max.x),
                bottom: m(rect.max.y - inner.max.y),
            }));
        }
        let widget = match props::prop_string(node, "placeholder") {
            // egui lays a hint out in the style's default font, not the
            // edit's: the placeholder carries the field's own size.
            Some(p) => {
                widget.hint_text(egui::RichText::new(p).font(Self::font(style, cx.ui.ctx())))
            }
            None => widget,
        };
        let response = cx.ui.put(rect, widget);
        remember_focus(cx, node, &response);
        response.widget_info(|| {
            egui::WidgetInfo::labeled(egui::Role::TextInput, !disabled, access_label(cx, node))
        });

        // egui still reports `changed` for a mutation the immutable
        // buffer turned into a no-op — readonly takes no input event.
        if response.changed() && !is_readonly {
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
                cx.emit(&node.id, "onChange", events::detail_str(&text));
            }
        }
        if response.lost_focus() && !ime_enter && cx.edit.field(&node.id, "dirty").truthy() {
            cx.edit
                .set_field(&node.id, "dirty", we_expr::Value::Bool(false));
            cx.emit(&node.id, "onChange", events::detail_str(&text));
        }
    }
}
