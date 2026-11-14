//! `we-sortable` — drag a child to reorder. Items are the node's children,
//! at their own layout rects (the walk's `"rect"` pseudo-part). A drag
//! moves the row under the pointer and, *on release*, emits `onReorder`
//! `{detail: [item ids in new order]}` — nothing fires mid-drag, matching
//! the TS element which only notifies when the item drops. Each child's id
//! is its `weId` prop when present, else its node id.
use we_style::Style;
use we_template::{NodeId, ResolvedNode};

use crate::events;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct Sortable;

/// Each child's stable item key.
fn item_ids(node: &ResolvedNode) -> Vec<String> {
    node.children
        .iter()
        .filter_map(|c| match c {
            we_template::ResolvedChild::Node(n) => Some(
                n.props
                    .get("weId")
                    .map(|v| v.js_string())
                    .unwrap_or_else(|| n.id.to_string()),
            ),
            we_template::ResolvedChild::Text(_) => None,
        })
        .collect()
}

/// Each child's layout rect, in tree order.
fn item_rects(node: &ResolvedNode, cx: &PaintCx) -> Vec<(NodeId, Rect)> {
    node.children
        .iter()
        .filter_map(|c| match c {
            we_template::ResolvedChild::Node(n) => cx
                .parts
                .get(&(n.id.clone(), "rect"))
                .copied()
                .map(|r| (n.id.clone(), r)),
            we_template::ResolvedChild::Text(_) => None,
        })
        .collect()
}

impl Widget for Sortable {
    fn type_name(&self) -> &'static str {
        "we-sortable"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        avail
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        let ids = item_ids(node);
        let rects = item_rects(node, cx);
        if rects.len() < 2 {
            return;
        }

        // The row under drag gets a ghost outline; on release we emit the
        // reorder once — never during the drag.
        let mut drop_order: Option<Vec<String>> = None;
        for (i, (_nid, r)) in rects.iter().enumerate() {
            let drag_id = cx.ui.scope_id().with((node.id.as_str(), "drag", i));
            let handle = Rect::from_min_size(r.min, egui::vec2(16.0, r.height()));
            let resp = cx.ui.interact(handle, drag_id, egui::Sense::drag());
            // A small grip hint.
            cx.ui.painter().text(
                handle.center(),
                egui::Align2::CENTER_CENTER,
                "⋮⋮",
                egui::FontId::proportional(10.0),
                cx.ui.visuals().weak_text_color(),
            );
            if resp.dragged() {
                cx.ui.painter().rect_stroke(
                    *r,
                    4.0,
                    cx.ui.visuals().widgets.active.fg_stroke,
                    egui::StrokeKind::Outside,
                );
            }
            if resp.drag_stopped() {
                if let Some(pos) = cx.ui.input(|i| i.pointer.interact_pos()) {
                    // The index the pointer sits in.
                    let target = rects
                        .iter()
                        .position(|(_, rr)| pos.y < rr.center().y)
                        .unwrap_or(rects.len() - 1);
                    if target != i {
                        let mut order = ids.clone();
                        let item = order.remove(i);
                        order.insert(target, item);
                        drop_order = Some(order);
                    }
                }
            }
        }
        if let Some(order) = drop_order {
            cx.emit(&node.id, "onReorder", events::detail_ids(order));
        }
    }
}
