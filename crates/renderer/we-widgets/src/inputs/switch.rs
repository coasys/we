//! `we-switch` — a boolean toggle. `checked` (falling back to `value`) is
//! the shown state; a click emits `onChange` `{detail: bool}` with the
//! *next* state, the way the TS element does.
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct Switch;

impl Widget for Switch {
    fn type_name(&self) -> &'static str {
        "we-switch"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::new(36.0, 20.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let on = props::prop_bool(node, "checked")
            .or_else(|| props::prop_bool(node, "value"))
            .unwrap_or_else(|| props::prop(node, "checked").truthy());
        let label = access_label(cx, node);

        let switch_rect = Rect::from_center_size(rect.left_center(), Size::new(36.0, 20.0));
        let response = cx.interact_label(
            switch_rect,
            &label,
            egui::Role::CheckBox,
            &node.id,
            "switch",
        );

        let visuals = cx.ui.visuals().clone();
        let fill = if disabled(node) {
            visuals.widgets.noninteractive.bg_fill
        } else if on {
            visuals.widgets.active.bg_fill
        } else {
            visuals.widgets.inactive.bg_fill
        };
        cx.ui.painter().rect_filled(switch_rect, 10.0, fill);
        let knob_center = egui::pos2(
            if on {
                switch_rect.max.x - 10.0
            } else {
                switch_rect.min.x + 10.0
            },
            switch_rect.center().y,
        );
        cx.ui
            .painter()
            .circle_filled(knob_center, 8.0, egui::Color32::WHITE);
        // The `labelOn`/`labelOff` text beside the pill.
        let text = if on {
            props::prop_str(node, "labelOn")
        } else {
            props::prop_str(node, "labelOff")
        };
        if let Some(t) = text {
            cx.ui.painter().text(
                egui::pos2(switch_rect.max.x + 8.0, switch_rect.center().y),
                egui::Align2::LEFT_CENTER,
                t,
                egui::FontId::default(),
                visuals.text_color(),
            );
        }
        if response.clicked() && !disabled(node) {
            cx.emit(&node.id, "onChange", events::detail_bool(!on));
        }
    }
}
