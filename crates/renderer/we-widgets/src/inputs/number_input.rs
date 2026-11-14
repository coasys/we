//! `we-number-input` — a text field with `min`/`max`/`step` and −/+
//! steppers. The draft can hold anything while typing (invalid text stays);
//! on blur the value parses, clamps to the bounds and emits `onChange`
//! `{detail: number}` — matching the TS element's `_emit` clamp, applied at
//! commit time rather than per keystroke.
use egui::TextEdit;
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled, reconcile_num, shown_num};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct NumberInput;

fn clamp(v: f64, min: f64, max: f64) -> f64 {
    v.clamp(min, max)
}

fn bounds(node: &ResolvedNode) -> (f64, f64, f64) {
    (
        props::prop_num(node, "min").unwrap_or(f64::NEG_INFINITY),
        props::prop_num(node, "max").unwrap_or(f64::INFINITY),
        props::prop_num(node, "step").unwrap_or(1.0),
    )
}

impl Widget for NumberInput {
    fn type_name(&self) -> &'static str {
        "we-number-input"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        Size::new(avail.x.min(140.0), props::control_height(node))
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let (min, max, step) = bounds(node);
        let disabled = disabled(node);
        reconcile_num(cx.edit, node);
        let mut text = shown_num(cx.edit, node);
        let label = access_label(cx, node);

        // [−] [ text ] [+] — the field takes the middle.
        let h = props::control_height(node);
        let btn = Size::new(28.0, rect.height());
        let minus = Rect::from_min_size(rect.min, btn);
        let plus = Rect::from_min_size(egui::pos2(rect.max.x - 28.0, rect.min.y), btn);
        let field = Rect::from_min_max(
            egui::pos2(minus.max.x + 2.0, rect.min.y),
            egui::pos2(plus.min.x - 2.0, rect.min.y + h.max(rect.height())),
        );

        let minus_r = cx.interact_label(minus, "decrement", egui::Role::Button, &node.id, "minus");
        let plus_r = cx.interact_label(plus, "increment", egui::Role::Button, &node.id, "plus");
        let visuals = cx.ui.visuals().clone();
        for (r, glyph) in [(minus, "-"), (plus, "+")] {
            cx.ui
                .painter()
                .rect_filled(r, 4.0, visuals.widgets.inactive.bg_fill);
            cx.ui.painter().text(
                r.center(),
                egui::Align2::CENTER_CENTER,
                glyph,
                egui::FontId::default(),
                visuals.text_color(),
            );
        }

        let response = cx.ui.put(
            field,
            TextEdit::singleline(&mut text)
                .id_salt(node.id.as_str())
                .desired_width(field.width())
                .interactive(!disabled),
        );
        response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, &label));
        if response.changed() {
            cx.edit
                .set_draft(&node.id, &text, props::prop(node, "value"));
            cx.edit.set_field(&node.id, "dirty", Value::Bool(true));
        }

        let commit = |text: &str, cx: &mut PaintCx| {
            let fallback = props::prop_num(node, "value").unwrap_or(0.0);
            let parsed = text.trim().parse::<f64>().unwrap_or(fallback);
            let v = clamp(parsed, min, max);
            cx.edit.clear_draft(&node.id);
            cx.edit.set_field(&node.id, "dirty", Value::Bool(false));
            cx.emit(&node.id, "onChange", events::detail_num(v));
        };
        if response.lost_focus() && cx.edit.field(&node.id, "dirty").truthy() {
            commit(&text, cx);
        }
        // Steppers respect the bounds.
        if !disabled {
            if minus_r.clicked() || plus_r.clicked() {
                let cur = text
                    .trim()
                    .parse::<f64>()
                    .unwrap_or_else(|_| props::prop_num(node, "value").unwrap_or(0.0));
                let next = clamp(cur + if minus_r.clicked() { -step } else { step }, min, max);
                cx.edit.set_field(&node.id, "dirty", Value::Bool(false));
                cx.emit(&node.id, "onChange", events::detail_num(next));
            }
        }
    }
}
