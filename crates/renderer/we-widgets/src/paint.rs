//! Paint: walk the resolved tree, hand each node its rect and a [`PaintCx`].
//! Containers recurse — a widget paints chrome and content, the frame paints
//! its children and the text spans.
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::{EditState, Layout, PaintCx, Registry, WidgetEvent};

/// Paint `root` at the rects in `layout`, into `ui`. Events a widget emits
/// land in `events`; the frame drains them into `Runtime::dispatch`.
#[allow(clippy::too_many_arguments)]
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
    let mut ancestors = Vec::new();
    paint_node(ui, registry, root, layout, events, edit, now, &mut ancestors);
}

fn paint_node(
    ui: &mut egui::Ui,
    registry: &Registry,
    node: &ResolvedNode,
    layout: &Layout,
    events: &mut Vec<WidgetEvent>,
    edit: &mut EditState,
    now: f64,
    ancestors: &mut Vec<NodeId>,
) {
    let Some(rect) = layout.rects.get(&node.id).copied() else {
        return;
    };
    let widget = registry.widget_for(&node.ty);
    ancestors.push(node.id.clone());
    {
        let mut cx = PaintCx {
            ui,
            events,
            parts: &layout.parts,
            edit,
            now,
            ancestors: &ancestors[..ancestors.len() - 1],
        };
        widget.paint(&mut cx, node, &crate::style_of(node), rect);
    }
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            paint_node(ui, registry, n, layout, events, edit, now, ancestors);
        }
    }
    ancestors.pop();
}
