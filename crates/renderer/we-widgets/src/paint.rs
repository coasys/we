//! Paint: walk the resolved tree, hand each node its rect and a [`PaintCx`].
//! Containers recurse — a widget paints chrome and content, the frame paints
//! its children and the text spans.
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::{EditState, Layout, PaintCx, Registry, WidgetEvent};

/// Paint `root` at the rects in `layout`, into `ui`. Events a widget emits
/// land in `events`; the frame drains them into `Runtime::dispatch`.
pub fn paint(
    ui: &mut egui::Ui,
    registry: &Registry,
    root: &ResolvedNode,
    layout: &Layout,
    events: &mut Vec<WidgetEvent>,
    edit: &mut EditState,
    now: f64,
) {
    // Text children first — they sit at their own rects and nothing clips
    // them in E3a.
    for span in &layout.texts {
        ui.painter().text(
            span.rect.min,
            egui::Align2::LEFT_TOP,
            span.text.as_ref(),
            egui::FontId::default(),
            ui.visuals().text_color(),
        );
    }
    let mut w = Walk {
        ui,
        registry,
        layout,
        events,
        edit,
        now,
        ancestors: Vec::new(),
    };
    paint_node(&mut w, root);
}

/// The walk's shared state — everything but the node being painted.
struct Walk<'a> {
    ui: &'a mut egui::Ui,
    registry: &'a Registry,
    layout: &'a Layout,
    events: &'a mut Vec<WidgetEvent>,
    edit: &'a mut EditState,
    now: f64,
    ancestors: Vec<NodeId>,
}

fn paint_node(w: &mut Walk<'_>, node: &ResolvedNode) {
    let Some(rect) = w.layout.rects.get(&node.id).copied() else {
        return;
    };
    let widget = w.registry.widget_for(&node.ty);
    w.ancestors.push(node.id.clone());
    {
        let mut cx = PaintCx {
            ui: w.ui,
            events: w.events,
            parts: &w.layout.parts,
            edit: w.edit,
            now: w.now,
            ancestors: &w.ancestors[..w.ancestors.len() - 1],
        };
        widget.paint(&mut cx, node, &crate::style_of(node), rect);
    }
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            paint_node(w, n);
        }
    }
    w.ancestors.pop();
}
