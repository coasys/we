//! `we-popover` — an anchored floating panel. The first child (the one the
//! `trigger` part picks) is the anchor; clicking it toggles the internal
//! open flag in [`EditState`], and the overlay pass anchors the rest of the
//! children under it. A click outside or Escape closes; an `open` prop
//! overrides the internal flag entirely.
use we_style::Style;
use we_template::{ResolvedChild, ResolvedNode};

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

    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec> {
        // popover.ts: `<slot name="trigger">` anchors — the bundle's popovers
        // all carry `slot="trigger"`/`slot="content"`. With no named
        // trigger, unslotted children anchor as before (the old API);
        // anything unpicked floats into the panel.
        let named = node
            .children
            .iter()
            .any(|c| matches!(c, ResolvedChild::Node(n) if n.slot.as_deref() == Some("trigger")));
        let pick = if named {
            Pick::Named("trigger".into())
        } else {
            Pick::Default
        };
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![PartSpec::group("trigger", pick, Direction::Column)],
        })
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        // The trigger child fills whatever we are given; the node itself
        // contributes nothing beyond it.
        Size::new(0.0, 0.0)
    }

    /// Activation in the `trigger` part toggles open — the walk applies
    /// it after the subtree paints (see `paint_node`): a click-sensing
    /// descendant's `clicked()` (pointer or keyboard fake-click) or a
    /// pointer hit on the anchor itself that no disabled control
    /// swallowed and no higher layer covered.
    fn trigger_toggles(&self) -> bool {
        true
    }

    fn paint(&self, _cx: &mut PaintCx, _node: &ResolvedNode, _style: &Style, _rect: Rect) {}
}
