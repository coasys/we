//! `we-input` — a single-line controlled input. `value` is the shown text;
//! a keystroke emits `onInput` `{detail: text}`, blur-or-Enter commits
//! `onChange`, and every key reports `onKeyDown` `{detail:{key,code,
//! isComposing}}` — the envelope the bundle's handlers read.
use egui::TextEdit;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled, reconcile_draft, shown_text};
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

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        // The DOM `change` event carries the field's text at commit time —
        // the draft, not the prop it is about to be replaced by.
        let committed = cx.edit.draft(&node.id);
        reconcile_draft(cx.edit, node);
        let mut text = shown_text(cx.edit, node);
        let disabled = disabled(node);
        let is_password =
            matches!(props::prop(node, "type"), we_expr::Value::Str(s) if s.as_ref() == "password");

        // Chrome that comes from the resolved style — the theme's part
        // rule (retro's white bevelled well) or authored `styles` —
        // replaces egui's own TextEdit frame; an unstyled field keeps it.
        let view = crate::defaults::view_of(cx.ui.ctx());
        let chrome = style.paint.bg.is_some()
            || style.paint.shadows.as_ref().is_some_and(|s| !s.is_empty())
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

        let mut widget = TextEdit::singleline(&mut text)
            .id_salt(node.id.as_str())
            .desired_width(rect.width())
            // Centre the text block in the field — the theme's atom
            // alignment is LEFT_TOP, which parks the text high inside a
            // `control_height` rect.
            .min_size(rect.size())
            .align(egui::Align2::LEFT_CENTER)
            .password(is_password)
            .interactive(!disabled);
        if chrome {
            widget = widget.frame(egui::Frame::NONE);
            // The resolved padding/border insets carry as the TextEdit's
            // margin, so the text still starts at the content box.
            let inner = props::content_rect(rect, style, view, cx.cb_w);
            widget = widget.margin(egui::Margin {
                left: (inner.min.x - rect.min.x) as i8,
                top: (inner.min.y - rect.min.y) as i8,
                right: (rect.max.x - inner.max.x) as i8,
                bottom: (rect.max.y - inner.max.y) as i8,
            });
        }
        let widget = match props::prop_string(node, "placeholder") {
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

        // Keys, only while focused — `key` is the egui name ("Enter",
        // "A", "Escape"), which is what the bundle compares against. The
        // frame Enter *surrenders* focus counts too (`lost_focus`), or the
        // submit keystroke would never reach `onKeyDown`.
        if response.has_focus() || response.lost_focus() {
            let keys: Vec<(String, String)> = cx.ui.input(|i| {
                i.events
                    .iter()
                    .filter_map(|e| match e {
                        egui::Event::Key {
                            key,
                            physical_key,
                            pressed: true,
                            ..
                        } => Some((
                            format!("{key:?}"),
                            format!("{:?}", physical_key.unwrap_or(*key)),
                        )),
                        _ => None,
                    })
                    .collect()
            });
            let enter = keys.iter().any(|(k, _)| k == "Enter");
            for (key, code) in keys {
                cx.emit(&node.id, "onKeyDown", events::key_down(&key, &code, false));
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
