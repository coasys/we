//! `we-modal` — a controlled dialog. `open` comes from the props; the
//! frame's overlay pass centres its children on an `egui::Modal`, and
//! Escape or a backdrop click emits the node's `close`/`onClose` handler.
//! The widget itself only paints the title bar on the overlay pass.
use we_style::Style;
use we_template::ResolvedNode;

use crate::props;
use crate::{Direction, MeasureCx, PaintCx, PartsSpec, Rect, Size, Widget, WidgetKind};

pub struct Modal;

impl Widget for Modal {
    fn type_name(&self) -> &'static str {
        "we-modal"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Overlay
    }

    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        // No parts — a modal's children all float.
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![],
        })
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        // A modal takes no room in the flow.
        Size::new(0.0, 0.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        // Only the overlay pass gives us an "overlay" rect — the in-flow
        // call (rect is our zero-size slot) paints nothing.
        let Some(content) = props::part(cx, node, "overlay") else {
            return;
        };
        if let Some(title) = props::prop_str(node, "title") {
            cx.ui.painter().text(
                egui::pos2(content.min.x + 16.0, content.min.y + 16.0),
                egui::Align2::LEFT_TOP,
                title,
                egui::FontId::proportional(16.0),
                cx.ui.visuals().text_color(),
            );
        }
    }
}
