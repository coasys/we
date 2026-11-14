//! `we-popover` — an anchored floating panel. The first child (the one the
//! `trigger` part picks) is the anchor; clicking it toggles the internal
//! open flag in [`EditState`], and the overlay pass anchors the rest of the
//! children under it. A click outside or Escape closes; an `open` prop
//! overrides the internal flag entirely.
use we_style::Style;
use we_template::ResolvedNode;

use crate::props;
use crate::{
    Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, Widget, WidgetKind,
};

pub struct Popover;

impl Widget for Popover {
    fn type_name(&self) -> &'static str {
        "we-popover"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Overlay
    }

    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        // `trigger` is the anchor child; everything else floats.
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![PartSpec::group("trigger", Pick::Default, Direction::Column)],
        })
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        // The trigger child fills whatever we are given; the node itself
        // contributes nothing beyond it.
        Size::new(0.0, 0.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        // Only the in-flow pass toggles open — the overlay pass is paint-only.
        if props::part(cx, node, "overlay").is_some() {
            return;
        }
        let Some(anchor) = props::part(cx, node, "trigger") else {
            return;
        };
        // The trigger child paints over us and wins egui's hit test, so
        // watch the pointer itself: a click landing in the anchor toggles.
        let clicked = cx.ui.input(|i| i.pointer.any_click())
            && cx
                .ui
                .input(|i| i.pointer.interact_pos())
                .is_some_and(|p| anchor.contains(p));
        if clicked {
            let open = cx.edit.is_open(&node.id);
            cx.edit.set_open(&node.id, !open);
        }
    }
}
