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

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        reconcile_draft(cx.edit, node);
        let mut text = shown_text(cx.edit, node);
        let disabled = disabled(node);
        let is_password =
            matches!(props::prop(node, "type"), we_expr::Value::Str(s) if s.as_ref() == "password");

        let widget = TextEdit::singleline(&mut text)
            .id_salt(node.id.as_str())
            .desired_width(rect.width())
            .password(is_password)
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

        // Keys, only while focused — `key` is the egui name ("Enter",
        // "A", "Escape"), which is what the bundle compares against.
        if response.has_focus() {
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
                cx.emit(&node.id, "onChange", events::detail_str(&text));
            }
        }
        if response.lost_focus() && cx.edit.field(&node.id, "dirty").truthy() {
            cx.edit
                .set_field(&node.id, "dirty", we_expr::Value::Bool(false));
            cx.emit(&node.id, "onChange", events::detail_str(&text));
        }
    }
}
