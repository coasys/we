//! `we-slider` — a numeric range. `value`/`min`/`max`/`step` come from the
//! props; dragging emits `onInput` `{detail: number}` per move and
//! `onChange` on release — the input/change split the TS element makes.
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct Slider;

impl Widget for Slider {
    fn type_name(&self) -> &'static str {
        "we-slider"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        Size::new(avail.x.min(200.0), props::control_height(node).max(20.0))
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let min = props::prop_num(node, "min").unwrap_or(0.0);
        let max = props::prop_num(node, "max").unwrap_or(100.0);
        let step = props::prop_num(node, "step").unwrap_or(1.0);
        let mut value = props::prop_num(node, "value").unwrap_or(min);

        let show_value = props::prop_flag(node, "showValue").unwrap_or(false);
        let mut slider = egui::Slider::new(&mut value, min..=max)
            .step_by(step.abs().max(f64::EPSILON))
            .show_value(show_value);
        if !show_value {
            slider = slider.text("");
        }
        let response = cx
            .ui
            .add_enabled_ui(!disabled(node), |ui| ui.put(rect, slider));
        response.inner.widget_info(|| {
            egui::WidgetInfo::labeled(egui::Role::Slider, true, access_label(cx, node))
        });
        if response.inner.changed() {
            cx.emit(&node.id, "onInput", events::detail_num(value));
        }
        if response.inner.drag_stopped() {
            cx.emit(&node.id, "onChange", events::detail_num(value));
        }
    }
}
