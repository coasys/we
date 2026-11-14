//! `we-form-field` — a label, description and error around one slotted
//! control. It paints the chrome and hands its `label` down to the child
//! through [`EditState`] so the control's AccessKit label carries it — the
//! wrapper itself is layout + accessibility only.
use we_style::Style;
use we_template::ResolvedNode;

use crate::props;
use crate::{
    Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, Widget, WidgetKind,
};

pub struct FormField;

/// A decorative full-width band `h` px tall (label / description / error).
fn band(name: &'static str, h: f32) -> PartSpec {
    PartSpec {
        name,
        pick: None,
        direction: Direction::Column,
        width: None,
        height: Some(h),
        min_height: 0.0,
        indent: 0.0,
        align: None,
        parts: vec![],
    }
}

impl Widget for FormField {
    fn type_name(&self) -> &'static str {
        "we-form-field"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec> {
        // Label/description/error bands exist only when their prop does,
        // so a bare field costs nothing.
        let mut parts = Vec::new();
        if props::prop_string(node, "label").is_some() {
            parts.push(band("label", 18.0));
        }
        if props::prop_string(node, "description").is_some()
            || props::prop_string(node, "hint").is_some()
        {
            parts.push(band("description", 14.0));
        }
        parts.push(PartSpec::group("control", Pick::Default, Direction::Column));
        if props::prop_string(node, "error").is_some() {
            parts.push(band("error", 14.0));
        }
        Some(PartsSpec {
            direction: Direction::Column,
            parts,
        })
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        Size::new(avail.x, avail.y.min(160.0))
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        let visuals = cx.ui.visuals().clone();
        if let Some(l) = props::prop_string(node, "label") {
            // Hand the label to the slotted control for AccessKit, and
            // paint the label row at the top of the field.
            cx.edit.set_field(
                &node.id,
                "aria_label",
                we_expr::Value::Str(l.clone().into()),
            );
            if let Some(lr) = props::part(cx, node, "label") {
                cx.ui.painter().text(
                    lr.min,
                    egui::Align2::LEFT_TOP,
                    l,
                    egui::FontId::default(),
                    visuals.text_color(),
                );
            }
        }
        if let Some(d) =
            props::prop_string(node, "description").or_else(|| props::prop_string(node, "hint"))
        {
            if let Some(dr) = props::part(cx, node, "description") {
                cx.ui.painter().text(
                    dr.min,
                    egui::Align2::LEFT_TOP,
                    d,
                    egui::FontId::proportional(11.0),
                    visuals.weak_text_color(),
                );
            }
        }
        if let Some(e) = props::prop_string(node, "error") {
            if let Some(er) = props::part(cx, node, "error") {
                cx.ui.painter().text(
                    er.min,
                    egui::Align2::LEFT_TOP,
                    e,
                    egui::FontId::proportional(11.0),
                    visuals.error_fg_color,
                );
            }
        }
    }
}
