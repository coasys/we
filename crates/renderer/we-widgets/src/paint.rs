//! Paint: walk the resolved tree, hand each node its rect and a [`PaintCx`].
//! Containers recurse — a widget paints chrome and content, the frame paints
//! its children and the text spans.
//!
//! Scroll containers (`layout.scroll`) translate their children by the
//! node's stored scroll offset and clip them on the scrolling axes;
//! `overflow: hidden|clip` nodes (`layout.clip`) clip without scrolling.
//! Offsets accumulate down the walk; every node gets the painter's clip set
//! to its own accumulated clip before painting.
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::defaults::StyleCx;
use crate::props;
use crate::{EditState, Layout, PaintCx, Parts, Registry, WidgetEvent};

/// Paint `root` at the rects in `layout`, into `ui`. Events a widget emits
/// land in `events`; the frame drains them into `Runtime::dispatch`.
#[allow(clippy::too_many_arguments)]
pub fn paint(
    ui: &mut egui::Ui,
    registry: &Registry,
    scx: &StyleCx,
    root: &ResolvedNode,
    layout: &Layout,
    events: &mut Vec<WidgetEvent>,
    edit: &mut EditState,
    now: f64,
) {
    let base_clip = ui.clip_rect();
    crate::defaults::store_view(ui.ctx(), scx);
    let mut w = Walk {
        ui,
        registry,
        scx,
        layout,
        events,
        edit,
        now,
        ancestors: Vec::new(),
        offset: egui::Vec2::ZERO,
        clip: None,
        base_clip,
        parts_buf: None,
    };
    paint_node(&mut w, root);
}

/// The walk's shared state — everything but the node being painted.
struct Walk<'a> {
    ui: &'a mut egui::Ui,
    registry: &'a Registry,
    scx: &'a StyleCx<'a>,
    layout: &'a Layout,
    events: &'a mut Vec<WidgetEvent>,
    edit: &'a mut EditState,
    now: f64,
    ancestors: Vec<NodeId>,
    /// Accumulated scroll translation applied to this subtree's rects.
    offset: egui::Vec2,
    /// The paint clip for this subtree (from `overflow` containers).
    clip: Option<egui::Rect>,
    /// The painter's clip before the walk — what "no clip" restores.
    base_clip: egui::Rect,
    /// The parts map translated by `offset`, built lazily inside scroll
    /// regions (`None` when offset is zero → use `layout.parts`).
    parts_buf: Option<Parts>,
}

/// `rect` clipped on the axes `axes` marks — the other axis unbounded.
fn axis_clip(rect: egui::Rect, axes: egui::Vec2) -> egui::Rect {
    egui::Rect::from_x_y_ranges(
        if axes.x > 0.0 {
            rect.x_range()
        } else {
            egui::Rangef::EVERYTHING
        },
        if axes.y > 0.0 {
            rect.y_range()
        } else {
            egui::Rangef::EVERYTHING
        },
    )
}

/// The node's stored scroll position (`_scroll` scratch).
fn scroll_pos(edit: &EditState, node: &NodeId) -> egui::Vec2 {
    match props::scratch(&edit.data, node, "_scroll") {
        Some(Value::Obj(o)) => {
            let f = |k: &str| match o.get(k) {
                Some(Value::Num(n)) => *n as f32,
                _ => 0.0,
            };
            egui::vec2(f("x"), f("y"))
        }
        _ => egui::Vec2::ZERO,
    }
}

fn write_scroll(edit: &mut EditState, node: &NodeId, pos: egui::Vec2) {
    let mut m = indexmap::IndexMap::new();
    m.insert(std::sync::Arc::from("x"), Value::Num(pos.x as f64));
    m.insert(std::sync::Arc::from("y"), Value::Num(pos.y as f64));
    props::scratch_set(
        &mut edit.data,
        node,
        "_scroll",
        Value::Obj(std::sync::Arc::new(m)),
    );
}

/// Advance the scroll offset from pointer input over `rect`, clamped to the
/// content's overflow (`content` is the union of children rects).
fn scroll_input(
    ui: &mut egui::Ui,
    edit: &mut EditState,
    node: &NodeId,
    rect: egui::Rect,
    axes: egui::Vec2,
    content: egui::Rect,
) -> egui::Vec2 {
    let mut pos = scroll_pos(edit, node);
    let max = egui::vec2(
        (content.width() - rect.width()).max(0.0),
        (content.height() - rect.height()).max(0.0),
    );
    if max.x <= 0.0 && max.y <= 0.0 {
        if pos != egui::Vec2::ZERO {
            write_scroll(edit, node, egui::Vec2::ZERO);
        }
        return egui::Vec2::ZERO;
    }
    let id = ui.scope_id().with(("we-scroll", node.as_str()));
    if ui.interact(rect, id, egui::Sense::hover()).hovered() {
        let delta = ui.input(|i| i.smooth_scroll_delta);
        pos += egui::vec2(delta.x * axes.x, delta.y * axes.y);
    }
    pos.x = pos.x.clamp(0.0, max.x);
    pos.y = pos.y.clamp(0.0, max.y);
    if pos != scroll_pos(edit, node) {
        write_scroll(edit, node, pos);
    }
    pos
}

/// The union of this node's children rects — its scroll content.
fn content_rect(layout: &Layout, node: &ResolvedNode) -> egui::Rect {
    let mut out: Option<egui::Rect> = None;
    let mut extend = |r: egui::Rect| match &mut out {
        Some(o) => *o = o.union(r),
        None => out = Some(r),
    };
    for child in &node.children {
        match child {
            ResolvedChild::Node(n) => {
                if let Some(r) = layout.rects.get(&n.id) {
                    extend(*r);
                }
            }
            ResolvedChild::Text(t) => {
                for span in &layout.texts {
                    if span.node == node.id && span.text.as_ref() == t.as_ref() {
                        extend(span.rect);
                    }
                }
            }
        }
    }
    for ((owner, _name), r) in &layout.parts {
        if owner == &node.id {
            extend(*r);
        }
    }
    out.unwrap_or_else(|| {
        layout
            .rects
            .get(&node.id)
            .copied()
            .unwrap_or(egui::Rect::NOTHING)
    })
}

/// Every part rect shifted by `delta` — the scrolled subtree's view.
fn translated_parts(parts: &Parts, delta: egui::Vec2) -> Parts {
    parts
        .iter()
        .map(|(k, r)| (k.clone(), r.translate(delta)))
        .collect()
}

/// Find a text child's span rect.
fn text_span(layout: &Layout, node: &NodeId, text: &str) -> Option<egui::Rect> {
    layout
        .texts
        .iter()
        .find(|s| s.node == *node && s.text.as_ref() == text)
        .map(|s| s.rect)
}

fn paint_node(w: &mut Walk<'_>, node: &ResolvedNode) {
    let Some(raw) = w.layout.rects.get(&node.id).copied() else {
        return;
    };
    let rect = raw.translate(-w.offset);
    if !rect.is_finite() {
        return;
    }
    let widget = w.registry.widget_for(&node.ty);
    w.ancestors.push(node.id.clone());

    // The node's own clip contribution (hidden/clip + any enclosing scroll)
    // applies to everything it paints, children included.
    let saved_clip = w.clip;
    if let Some(axes) = w.layout.clip.get(&node.id) {
        let r = axis_clip(rect, *axes);
        w.clip = Some(match w.clip {
            Some(c) => c.intersect(r),
            None => r,
        });
    }
    w.ui.set_clip_rect(w.clip.unwrap_or(w.base_clip));

    let style = crate::defaults::style_of(node, w.scx);
    let parts = w.parts_buf.as_ref().unwrap_or(&w.layout.parts);
    {
        let mut cx = PaintCx {
            ui: w.ui,
            events: w.events,
            parts,
            edit: w.edit,
            now: w.now,
            ancestors: &w.ancestors[..w.ancestors.len() - 1],
        };
        widget.paint(&mut cx, node, &style, rect);
    }

    // Scroll container: children translate by the stored offset and clip on
    // the scrolling axes.
    let saved_offset = w.offset;
    if let Some(axes) = w.layout.scroll.get(&node.id).copied() {
        let pos = scroll_input(
            w.ui,
            w.edit,
            &node.id,
            rect,
            axes,
            content_rect(w.layout, node),
        );
        w.offset += egui::vec2(pos.x * axes.x, pos.y * axes.y);
        let r = axis_clip(rect, axes);
        w.clip = Some(match w.clip {
            Some(c) => c.intersect(r),
            None => r,
        });
        w.parts_buf = Some(translated_parts(&w.layout.parts, -w.offset));
    }

    for child in &node.children {
        match child {
            ResolvedChild::Node(n) => paint_node(w, n),
            ResolvedChild::Text(t) => {
                if let Some(span) = text_span(w.layout, &node.id, t) {
                    let mut p = w.ui.painter().clone();
                    p.set_clip_rect(w.clip.unwrap_or(w.base_clip));
                    let font = props::font_id(
                        &style,
                        crate::defaults::FONT_PX,
                        crate::defaults::ROOT_PX,
                        w.scx.viewport,
                    );
                    p.text(
                        span.translate(-w.offset).min,
                        egui::Align2::LEFT_TOP,
                        t.as_ref(),
                        font,
                        props::text_color(&style, w.ui),
                    );
                }
            }
        }
    }

    w.offset = saved_offset;
    w.clip = saved_clip;
    if w.layout.scroll.contains_key(&node.id) {
        w.parts_buf = if saved_offset == egui::Vec2::ZERO {
            None
        } else {
            Some(translated_parts(&w.layout.parts, -saved_offset))
        };
    }
    w.ancestors.pop();
}
