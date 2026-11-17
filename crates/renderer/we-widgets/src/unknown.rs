//! [`UnknownWidget`]: the red box a type the registry does not know paints —
//! the same answer the TS renderer gives with `data-we-missing-component`.
use we_style::Style;
use we_template::ResolvedNode;

use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

/// The fallback widget: a red-outlined box with the type name. It must not
/// swallow children — children paint through it like a `Column`'s.
#[derive(Debug, Default)]
pub struct UnknownWidget;

impl Widget for UnknownWidget {
    fn type_name(&self) -> &'static str {
        "__unknown__"
    }

    fn kind(&self) -> WidgetKind {
        // A container: the unknown node's children still paint through it.
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        Size::new(avail.x.min(120.0), 24.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let name = node.ty.to_string();
        let painter = cx.ui.painter().clone();
        painter.rect_stroke(
            rect,
            0.0,
            egui::Stroke::new(2.0, egui::Color32::RED),
            egui::StrokeKind::Outside,
        );
        painter.text(
            rect.center(),
            egui::Align2::CENTER_CENTER,
            &name,
            egui::FontId::monospace(10.0),
            egui::Color32::RED,
        );
        cx.label(rect, &name);
    }
}
