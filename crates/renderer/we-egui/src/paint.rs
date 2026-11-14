//! Paint: walk the resolved tree, hand each node its rect and a [`PaintCx`].
//! Containers recurse — a widget paints chrome and content, the frame paints
//! its children and the text spans.
//!
//! Scroll containers (`layout.scroll`) translate their children by the
//! node's stored scroll offset and clip them on the scrolling axes;
//! `overflow: hidden|clip` nodes (`layout.clip`) clip without scrolling.
//! Offsets accumulate down the walk; every node gets the painter's clip set
//! to its own accumulated clip before painting.
//!
//! [`WidgetKind::Overlay`] nodes defer: the widget and its in-flow children
//! paint in the walk, then — after the main tree — the open ones paint their
//! floating children again on a foreground layer: centered in an
//! [`egui::Modal`] (no `trigger` part — `we-modal`) or anchored to the
//! `trigger` part's rect in an [`egui::Popup`] (`we-popover`,
//! `DropdownMenu`). A child floats when it was not picked into the widget's
//! [`crate::PartsSpec`] and so got no layout rect.
//!
//! Two conventions the walk and the widgets share:
//! - `(node, "rect")` in the merged [`Parts`] map holds every laid-out node's
//!   own rect — a widget finds its children's rects through it (`we-sortable`'s
//!   item rows, a popover's anchor).
//! - `(node, "overlay")` appears only on the overlay pass — the widget's
//!   second `paint` call — marking that call as the one to draw floating
//!   chrome in (a menu's item rows).
use std::sync::Arc;

use we_expr::Value;
use we_style::Style;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::defaults::{effective, StyleCx};
use crate::props;
use crate::{
    events, EditState, Layout, MeasureCx, PaintCx, Parts, Rect, Registry, WidgetEvent, WidgetKind,
};

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
    // The widget-visible parts map: the layout's part rects, plus every
    // node's own rect under `"rect"`.
    let mut base_parts = layout.parts.clone();
    for (id, rect) in &layout.rects {
        base_parts.insert((id.clone(), "rect"), *rect);
    }
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
        base_parts,
        parts_buf: None,
        overlays: Vec::new(),
        inh: None,
        hits: crate::HitLog::default(),
    };
    paint_node(&mut w, root);
    paint_overlays(&mut w);
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
    /// `layout.parts` merged with each node's own rect under `"rect"` — the
    /// map `parts_buf` translates inside scroll regions.
    base_parts: Parts,
    /// The parts map translated by `offset`, built lazily inside scroll
    /// regions (`None` when offset is zero → use `base_parts`).
    parts_buf: Option<Parts>,
    /// `Overlay` nodes met in the walk, in tree order — painted after it.
    /// Each entry carries the node's *parent* style context (what `w.inh`
    /// held at encounter) so the deferred pass recomputes the same
    /// effective style.
    overlays: Vec<(ResolvedNode, Option<Style>)>,
    /// The parent's computed style — text fields inherit down the walk
    /// and `opacity` composes (`defaults::effective` merges them; the
    /// builder's measure pass applies the same rule).
    inh: Option<Style>,
    /// Interactive hit surface reported by widgets so far — an overlay
    /// trigger's activation is read from it after the subtree paints.
    hits: crate::HitLog,
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
/// content's overflow. egui's `smooth_scroll_delta` is *content* motion —
/// wheel-down is negative y, so the stored viewport offset grows by
/// `-delta` (`scroll_area.rs` applies the same `delta: -scroll_delta`
/// inversion). Axes the wheel actually moved get zeroed so no ancestor or
/// sibling re-spends the delta; an axis a deeper scroller can still take
/// chains to it untouched.
fn scroll_input(
    w: &mut Walk<'_>,
    node: &ResolvedNode,
    rect: egui::Rect,
    axes: egui::Vec2,
) -> egui::Vec2 {
    let mut pos = scroll_pos(w.edit, &node.id);
    let content = w
        .layout
        .scroll_content
        .get(&node.id)
        .copied()
        .unwrap_or(rect);
    let max = egui::vec2(
        (content.width() - rect.width()).max(0.0),
        (content.height() - rect.height()).max(0.0),
    );
    if max.x <= 0.0 && max.y <= 0.0 {
        if pos != egui::Vec2::ZERO {
            write_scroll(w.edit, &node.id, egui::Vec2::ZERO);
        }
        return egui::Vec2::ZERO;
    }
    // The pointer rides over the scrolled children, which win egui's
    // widget-level hover — ask the layer whether the point is in the box.
    if !w.ui.rect_contains_pointer(rect) {
        return pos;
    }
    let delta = w.ui.input(|i| i.smooth_scroll_delta);
    if delta == egui::Vec2::ZERO {
        return pos;
    }
    let mut used = egui::Vec2::ZERO;
    for d in 0..2 {
        if delta[d] == 0.0 || axes[d] == 0.0 {
            continue;
        }
        // A deeper scrollable under the pointer that can still take this
        // axis claims it — chain-to-parent, like egui's wheel physics.
        if deeper_can_scroll(w, node, d, delta[d]) {
            continue;
        }
        let next = (pos[d] - delta[d]).clamp(0.0, max[d]);
        if next != pos[d] {
            pos[d] = next;
            used[d] = 1.0;
        }
    }
    if used != egui::Vec2::ZERO {
        w.ui.input_mut(|i| {
            for d in 0..2 {
                if used[d] != 0.0 {
                    i.smooth_scroll_delta[d] = 0.0;
                }
            }
        });
        write_scroll(w.edit, &node.id, pos);
    }
    pos
}

/// `true` when a scrollable *descendant* of `node` under the pointer can
/// still move on `axis` in `delta`'s direction — it claims the axis and
/// `node` chains.
fn deeper_can_scroll(w: &Walk<'_>, node: &ResolvedNode, axis: usize, delta: f32) -> bool {
    let Some(p) = w.ui.input(|i| i.pointer.interact_pos()) else {
        return false;
    };
    // Only descendants can be deeper — ancestors share the pointer's rect.
    let mut deeper: std::collections::HashSet<&NodeId> = Default::default();
    let mut stack: Vec<&ResolvedNode> = Vec::new();
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            stack.push(n);
        }
    }
    while let Some(n) = stack.pop() {
        deeper.insert(&n.id);
        for child in &n.children {
            if let ResolvedChild::Node(c) = child {
                stack.push(c);
            }
        }
    }
    let pos = scroll_pos(w.edit, &node.id);
    for (cid, caxes) in &w.layout.scroll {
        if !deeper.contains(cid) || caxes[axis] == 0.0 {
            continue;
        }
        let Some(base) = w.layout.rects.get(cid) else {
            continue;
        };
        // Descendants live in `node`'s content space — painted rect is the
        // base rect minus the ancestors' offsets and `node`'s own.
        let eff = base.translate(-w.offset - pos);
        if !eff.contains(p) {
            continue;
        }
        let cpos = scroll_pos(w.edit, cid);
        let ccontent = w.layout.scroll_content.get(cid).copied().unwrap_or(*base);
        let cmax = egui::vec2(
            (ccontent.width() - eff.width()).max(0.0),
            (ccontent.height() - eff.height()).max(0.0),
        );
        let next = (cpos[axis] - delta).clamp(0.0, cmax[axis]);
        if next != cpos[axis] {
            return true;
        }
    }
    false
}

/// Bring a focus gain inside `node`'s scroll region into view — the
/// minimal nudge egui's `ScrollArea::end` applies to `scroll_to_me`
/// targets (scroll_area.rs:1214): above the viewport scrolls the content
/// down, below scrolls it up, and a target taller than the viewport wins
/// its top edge. Only a `gained` rect inside the content's painted extent
/// counts — a sibling scroller's field is not ours to move.
fn focus_into_view(w: &mut Walk<'_>, node: &ResolvedNode, rect: egui::Rect) {
    let axes = w
        .layout
        .scroll
        .get(&node.id)
        .copied()
        .unwrap_or(egui::Vec2::ZERO);
    let content = w
        .layout
        .scroll_content
        .get(&node.id)
        .copied()
        .unwrap_or(rect);
    let mut pos = scroll_pos(w.edit, &node.id);
    let shown = content.translate(-egui::vec2(pos.x * axes.x, pos.y * axes.y));
    for d in 0..2 {
        if axes[d] == 0.0 {
            continue;
        }
        let Some(target) = w
            .hits
            .gained
            .iter()
            .find(|r| r.min[d] >= shown.min[d] - 0.5 && r.max[d] <= shown.max[d] + 0.5)
        else {
            continue;
        };
        let (start, end) = (target.min[d], target.max[d]);
        let (clip_start, clip_end) = (rect.min[d], rect.max[d]);
        let delta = if start < clip_start && end < clip_end {
            -(clip_start - start).min(clip_end - end)
        } else if end > clip_end && start > clip_start {
            (end - clip_end).min(start - clip_start)
        } else {
            0.0
        };
        if delta != 0.0 {
            let max = (content.size()[d] - rect.size()[d]).max(0.0);
            pos[d] = (pos[d] + delta).clamp(0.0, max);
        }
    }
    if pos != scroll_pos(w.edit, &node.id) {
        write_scroll(w.edit, &node.id, pos);
    }
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
    if widget.kind() == WidgetKind::Overlay {
        w.overlays.push((node.clone(), w.inh.clone()));
    }
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

    let style = effective(w.inh.as_ref(), crate::defaults::style_of(node, w.scx));
    let parts = w.parts_buf.as_ref().unwrap_or(&w.base_parts);
    {
        let mut cx = PaintCx {
            ui: w.ui,
            events: w.events,
            parts,
            edit: w.edit,
            now: w.now,
            ancestors: &w.ancestors[..w.ancestors.len() - 1],
            hits: &mut w.hits,
        };
        widget.paint(&mut cx, node, &style, rect);
    }

    // Scroll container: children translate by the stored offset and clip on
    // the scrolling axes.
    let saved_offset = w.offset;
    if let Some(axes) = w.layout.scroll.get(&node.id).copied() {
        let pos = scroll_input(w, node, rect, axes);
        w.offset += egui::vec2(pos.x * axes.x, pos.y * axes.y);
        let r = axis_clip(rect, axes);
        w.clip = Some(match w.clip {
            Some(c) => c.intersect(r),
            None => r,
        });
        w.parts_buf = Some(translated_parts(&w.base_parts, -w.offset));
    }

    // Children paint under this node's computed style: inherited text
    // fields and the composed opacity flow down the recursion. Synthesized
    // children (the widget's generated content) join the authored ones —
    // the layout pass already gave them rects.
    let saved_inh = w.inh.replace(style.clone());
    let extra = widget.synthesized_children(node);
    for child in node.children.iter().chain(extra.iter()) {
        match child {
            ResolvedChild::Node(n) => paint_node(w, n),
            ResolvedChild::Text(t) => {
                if let Some(span) = text_span(w.layout, &node.id, t) {
                    let mut p = w.ui.painter().clone();
                    p.set_clip_rect(w.clip.unwrap_or(w.base_clip));
                    // The same galley layout measured: wrapped at the span's
                    // width, the owner's transform and `truncate`/`lines`
                    // clamps applied — never a raw overflow line.
                    let text =
                        props::transform_text(&style, t, props::prop_bool(node, "uppercase"));
                    let g = crate::text::text_job(
                        &text,
                        &style,
                        w.ui.ctx(),
                        span.width().max(1.0),
                        props::prop_bool(node, "truncate"),
                        props::prop_num(node, "lines").map(|n| n.max(1.0) as usize),
                    );
                    crate::text::paint_galley(&p, span.translate(-w.offset).min, g, &style);
                }
            }
        }
    }

    // Trigger activation for click-to-open overlays: a click-sensing
    // descendant reported `clicked()` inside the anchor (pointer, keyboard
    // fake-click or a11y activation — already layer- and enabled-correct
    // by egui), or a pointer click landed in the anchor on this layer and
    // no disabled surface swallowed it. Read here, after the subtree
    // painted, because the trigger child's response only exists now.
    if widget.kind() == WidgetKind::Overlay && widget.trigger_toggles() {
        let anchor = w
            .parts_buf
            .as_ref()
            .unwrap_or(&w.base_parts)
            .get(&(node.id.clone(), "trigger"))
            .copied();
        if let Some(anchor) = anchor {
            let pos = w.ui.input(|i| i.pointer.interact_pos());
            let dead_hit = pos.is_some_and(|p| w.hits.dead.iter().any(|r| r.contains(p)));
            let pointer_hit = w.ui.input(|i| i.pointer.any_click())
                && pos.is_some_and(|p| anchor.contains(p))
                && w.ui.ctx().rect_contains_pointer(w.ui.layer_id(), anchor)
                && !dead_hit;
            let activated = w.hits.activated.iter().any(|r| anchor.contains(r.center()));
            if activated || pointer_hit {
                let open = w.edit.is_open(&node.id);
                w.edit.set_open(&node.id, !open);
            }
        }
    }

    w.inh = saved_inh;
    w.offset = saved_offset;
    w.clip = saved_clip;
    if w.layout.scroll.contains_key(&node.id) {
        // Tab-into-view: a control that took focus inside this scroller
        // must be reachable — the minimal-offset nudge `ScrollArea` gives
        // a `scroll_to_me` target. Runs after the children painted so
        // this frame's focus gain is seen; innermost scroller wins the
        // nested case.
        focus_into_view(w, node, rect);
        w.parts_buf = if saved_offset == egui::Vec2::ZERO {
            None
        } else {
            Some(translated_parts(&w.base_parts, -saved_offset))
        };
    }
    w.ancestors.pop();
}

/// `true` when the overlay should paint: a controlled `open` prop wins, else
/// the widget's internal flag in [`EditState`].
fn overlay_open(w: &Walk<'_>, node: &ResolvedNode) -> bool {
    match node.props.get("open") {
        Some(v) if !v.is_undefined() => v.truthy(),
        _ => w.edit.is_open(&node.id),
    }
}

/// The resolved children that got no layout rect — they were not picked by
/// the widget's `parts_spec` and belong on the overlay layer. Synthesized
/// children are included: one the spec leaves unpicked floats like an
/// authored child would.
fn floating_children(w: &Walk<'_>, node: &ResolvedNode) -> Vec<ResolvedChild> {
    node.children
        .iter()
        .chain(
            w.registry
                .widget_for(&node.ty)
                .synthesized_children(node)
                .iter(),
        )
        .filter(|c| match c {
            ResolvedChild::Node(n) => !w.layout.rects.contains_key(&n.id),
            ResolvedChild::Text(_) => true,
        })
        .cloned()
        .collect()
}

/// A synthetic `Column` the floating children lay out in, so the overlay
/// pass can measure and position them with the real layout code.
fn overlay_host(node: &ResolvedNode, width: f32, children: Vec<ResolvedChild>) -> ResolvedNode {
    let mut props = indexmap::IndexMap::new();
    props.insert("width".into(), we_expr::Value::Num(width as f64));
    ResolvedNode {
        id: node.id.clone(),
        ty: "Column".into(),
        props,
        handlers: Default::default(),
        slot: None,
        children,
        transition: None,
    }
}

/// The modal's padding as host-column props (`pt` additionally reserves
/// the title strip), so `sub.size` lands as the full content box.
fn modal_host(
    node: &ResolvedNode,
    width: f32,
    children: Vec<ResolvedChild>,
    mcx: &MeasureCx,
) -> ResolvedNode {
    let pad = crate::Modal::pad(node);
    let mut host = overlay_host(node, width, children);
    // Padding props resolve through the space scale — a bare `Num` would
    // emit `var(--we-space-24)`, so px text is the authored-CSS spelling.
    for key in ["pl", "pr", "pb"] {
        host.props
            .insert(key.into(), we_expr::Value::Str(format!("{pad}px").into()));
    }
    let pt = pad + crate::Modal::title_strip(mcx, node).unwrap_or(0.0);
    host.props
        .insert("pt".into(), we_expr::Value::Str(format!("{pt}px").into()));
    host
}

/// `sub`, shifted so its origin sits at `min`.
fn translate_layout(sub: &Layout, delta: egui::Vec2) -> Layout {
    Layout {
        size: sub.size,
        rects: sub
            .rects
            .iter()
            .map(|(id, r)| (id.clone(), r.translate(delta)))
            .collect(),
        parts: sub
            .parts
            .iter()
            .map(|(k, r)| (k.clone(), r.translate(delta)))
            .collect(),
        texts: sub
            .texts
            .iter()
            .map(|t| crate::TextSpan {
                node: t.node.clone(),
                rect: t.rect.translate(delta),
                text: t.text.clone(),
            })
            .collect(),
        scroll: sub.scroll.clone(),
        scroll_content: sub
            .scroll_content
            .iter()
            .map(|(k, r)| (k.clone(), r.translate(delta)))
            .collect(),
        clip: sub.clip.clone(),
    }
}

/// `we-modal`'s width for its `size` prop (`sm`/`md`/`lg`/`fullscreen`) —
/// the WE layout-token measures, clamped to `100dvw - 2*GUTTER` the way
/// the element's `maxWidth` works out.
fn modal_width(node: &ResolvedNode, screen: f32) -> f32 {
    let w = match node.props.get("size") {
        Some(we_expr::Value::Str(s)) => match s.as_ref() {
            "sm" => 480.0,
            "lg" => 860.0,
            "xl" => 1080.0,
            "fullscreen" => screen,
            _ => 640.0,
        },
        _ => 640.0,
    };
    w.min((screen - crate::Modal::GUTTER * 2.0).max(0.0))
}

/// The `placement` prop → an egui popup alignment (`bottom` default).
fn rect_align(node: &ResolvedNode) -> egui::RectAlign {
    let Some(we_expr::Value::Str(s)) = node.props.get("placement") else {
        return egui::RectAlign::BOTTOM_START;
    };
    match s.as_ref() {
        "top" | "top-start" => egui::RectAlign::TOP_START,
        "top-end" => egui::RectAlign::TOP_END,
        "bottom-end" => egui::RectAlign::BOTTOM_END,
        "left" | "left-start" => egui::RectAlign::LEFT_START,
        "left-end" => egui::RectAlign::LEFT_END,
        "right" | "right-start" => egui::RectAlign::RIGHT_START,
        "right-end" => egui::RectAlign::RIGHT_END,
        "bottom" | "bottom-start" => egui::RectAlign::BOTTOM_START,
        _ => egui::RectAlign::BOTTOM_START,
    }
}

/// After the main walk: each open overlay paints its floating children on a
/// foreground layer, in tree order (later on top). Overlays nested inside an
/// overlay's children are pushed during its paint and run after it.
fn paint_overlays(w: &mut Walk<'_>) {
    while !w.overlays.is_empty() {
        let (node, parent_inh) = w.overlays.remove(0);
        if !overlay_open(w, &node) {
            continue;
        }
        let ctx = w.ui.ctx().clone();
        let floating = floating_children(w, &node);
        // A "trigger" part makes this an anchored popup; without one the
        // node is a centred modal.
        match w.base_parts.get(&(node.id.clone(), "trigger")).copied() {
            Some(anchor) => anchored_overlay(w, &ctx, &node, anchor, floating, parent_inh),
            None => modal_overlay(w, &ctx, &node, floating, parent_inh),
        }
    }
}

/// `node`'s close-ish handler name (`close` or `onClose`), if it declared one.
pub(crate) fn close_handler(node: &ResolvedNode) -> Option<&'static str> {
    if node.handlers.contains_key("close") {
        Some("close")
    } else if node.handlers.contains_key("onClose") {
        Some("onClose")
    } else {
        None
    }
}

/// The inner painting an overlay does inside its egui layer: the widget's
/// second `paint` (marked by an `"overlay"` part rect), then the host's
/// children at the scratch layout's rects, then anything they deferred.
/// `host` is the synthetic layout root — for the modal it reorders the
/// floating set into pinned runs and a scroller.
fn overlay_contents(
    w: &mut Walk<'_>,
    ui: &mut egui::Ui,
    node: &ResolvedNode,
    widget: &Arc<dyn crate::Widget>,
    host: &ResolvedNode,
    scratch: &Layout,
    content_rect: Rect,
    parent_inh: &Option<Style>,
) {
    // The overlay's floating children are DOM descendants of the node —
    // the synthetic host column must not break the cascade: the node's own
    // computed style (merged over the recorded parent context) is what
    // they inherit.
    let style = effective(parent_inh.as_ref(), crate::style_of(node, w.scx));
    let mut base_parts = scratch.parts.clone();
    for (id, rect) in &scratch.rects {
        base_parts.insert((id.clone(), "rect"), *rect);
    }
    base_parts.insert((node.id.clone(), "overlay"), content_rect);
    let clip = ui.clip_rect();
    let mut inner = Walk {
        ui,
        registry: w.registry,
        scx: w.scx,
        layout: scratch,
        events: w.events,
        edit: w.edit,
        now: w.now,
        ancestors: w.ancestors.clone(),
        offset: egui::Vec2::ZERO,
        clip: None,
        base_clip: clip,
        base_parts,
        parts_buf: None,
        overlays: Vec::new(),
        inh: Some(style.clone()),
        // The overlay layer is its own hit surface: activations inside a
        // popup serve nested triggers, never the page walk's.
        hits: crate::HitLog::default(),
    };
    inner.ancestors.push(node.id.clone());
    {
        let ancestors = inner.ancestors[..inner.ancestors.len() - 1].to_vec();
        let mut cx = PaintCx {
            ui: inner.ui,
            events: inner.events,
            parts: &inner.base_parts,
            edit: inner.edit,
            now: inner.now,
            ancestors: &ancestors,
            hits: &mut inner.hits,
        };
        widget.paint(&mut cx, node, &style, content_rect);
    }
    // Text spans the synthetic host column owns (direct text children of the
    // overlay's floating set) — child-node spans paint inside `paint_node`.
    // Modal text children slot like nodes do: the default run's spans carry
    // the scroller's id once it exists; this pass still paints the host's
    // own (picks the modal had no slot for).
    for span in &scratch.texts {
        if span.node != host.id {
            continue;
        }
        let text = props::transform_text(&style, &span.text, props::prop_bool(node, "uppercase"));
        let g = crate::text::text_job(
            &text,
            &style,
            inner.ui.ctx(),
            span.rect.width().max(1.0),
            props::prop_bool(node, "truncate"),
            props::prop_num(node, "lines").map(|n| n.max(1.0) as usize),
        );
        crate::text::paint_galley(inner.ui.painter(), span.rect.min, g, &style);
    }
    for child in &host.children {
        if let ResolvedChild::Node(n) = child {
            paint_node(&mut inner, n);
        }
    }
    paint_overlays(&mut inner);
}

/// A child a named slot pulls out of the scroll region — modal.ts puts
/// `header` above the scroller and `footer` below it; `close-button` and
/// `start-button` pin to the sheet's corners, absolute over everything.
fn modal_slot(c: &ResolvedChild) -> &str {
    match c {
        ResolvedChild::Node(n) => n.slot.as_deref().unwrap_or_default(),
        ResolvedChild::Text(_) => "",
    }
}

/// The `we-modal` path: `egui::Modal` draws the backdrop and centres the
/// content; its layer blocks input below (egui marks it `top_modal_layer`).
/// Escape or a backdrop click emits the node's `close`/`onClose`.
///
/// modal.ts:143–189: only the default slot scrolls. `header`/`footer`
/// slot children pin outside the scroller — the DOM puts them in base
/// before and after `[part=content]` — and the sheet caps at
/// `100dvh - 64px`, so the cap's room goes to a real `overflowY:auto`
/// column around the default children rather than clipping their tail.
fn modal_overlay(
    w: &mut Walk<'_>,
    ctx: &egui::Context,
    node: &ResolvedNode,
    floating: Vec<ResolvedChild>,
    parent_inh: Option<Style>,
) {
    let widget = w.registry.widget_for(&node.ty);
    let screen = ctx.content_rect();
    let width = modal_width(node, screen.width());
    let mcx = MeasureCx::new(ctx);
    let mut head: Vec<ResolvedChild> = Vec::new();
    let mut body: Vec<ResolvedChild> = Vec::new();
    let mut foot: Vec<ResolvedChild> = Vec::new();
    let mut corners: Vec<ResolvedChild> = Vec::new();
    let hide_close = props::prop_flag(node, "hideclosebutton").unwrap_or(false);
    for c in floating {
        match modal_slot(&c) {
            "header" => head.push(c),
            "footer" => foot.push(c),
            "close-button" if hide_close => {
                // `hideclosebutton` drops the whole close-button-wrapper —
                // a slotted child has no slot to land in and renders
                // nothing, same as the DOM.
            }
            "close-button" | "start-button" => {
                // The slot replaces the chrome control its corner owns —
                // `close-button` children paint where the default ×
                // would, so modal.rs skips drawing it.
                let side = if modal_slot(&c) == "close-button" {
                    ("~mcb", "right")
                } else {
                    ("~msb", "left")
                };
                corners.push(ResolvedChild::Node(Box::new(ResolvedNode {
                    id: format!("{}/{}", node.id.as_str(), side.0).into(),
                    ty: "Column".into(),
                    props: [
                        ("position", we_expr::Value::Str("absolute".into())),
                        ("top", we_expr::Value::Str("10px".into())),
                        (side.1, we_expr::Value::Str("10px".into())),
                    ]
                    .into_iter()
                    .map(|(k, v)| (k.into(), v))
                    .collect(),
                    handlers: Default::default(),
                    slot: None,
                    children: vec![c],
                    transition: None,
                })));
            }
            _ => body.push(c),
        }
    }
    let flow: Vec<ResolvedChild> = head
        .iter()
        .cloned()
        .chain(body.iter().cloned())
        .chain(foot.iter().cloned())
        .chain(corners.iter().cloned())
        .collect();
    let host = modal_host(node, width, flow, &mcx);
    // Not the page root — the host's `auto` height is the content's, so
    // `sub.size` stays the dialog's real box (a `100vh` floor here made the
    // dialog fill the viewport).
    let sub = crate::layout_shrink(&mcx, w.scx, w.registry, &host, screen);
    // The dialog is sized by its content: `sub.size` is the padded host
    // column — width, plus `pt` (pad + title strip) + children + `pb`.
    // WE caps it at `maxHeight: calc(100dvh - 64px)`.
    let cap = (screen.height() - 64.0).max(64.0);
    let (host, sub) = if sub.size.y > cap {
        // Overflow: the default-slot run becomes a real scroll container
        // (`~ms`) capped at whatever the cap leaves after everything else
        // — pads, gaps, the header and footer runs — is paid. The wheel
        // machinery in `paint_node` does the rest. The body's share of the
        // natural height is the union of its children's rects, min-to-max.
        let mut top = f32::INFINITY;
        let mut bot = f32::NEG_INFINITY;
        for c in &body {
            if let ResolvedChild::Node(n) = c {
                if let Some(r) = sub.rects.get(&n.id) {
                    top = top.min(r.min.y);
                    bot = bot.max(r.max.y);
                }
            }
        }
        let body_h = if bot > top { bot - top } else { 0.0 };
        let scroll_h = (cap - (sub.size.y - body_h)).max(48.0);
        let scroll = ResolvedNode {
            id: format!("{}/~ms", node.id.as_str()).into(),
            ty: "Column".into(),
            props: [
                ("height", we_expr::Value::Num(scroll_h as f64)),
                ("overflowY", we_expr::Value::Str("auto".into())),
            ]
            .into_iter()
            .map(|(k, v)| (k.into(), v))
            .collect(),
            handlers: Default::default(),
            slot: None,
            children: body,
            transition: None,
        };
        let flow2: Vec<ResolvedChild> = head
            .into_iter()
            .chain(std::iter::once(ResolvedChild::Node(Box::new(scroll))))
            .chain(foot)
            .chain(corners)
            .collect();
        let host2 = modal_host(node, width, flow2, &mcx);
        let sub2 = crate::layout_shrink(&mcx, w.scx, w.registry, &host2, screen);
        (host2, sub2)
    } else {
        (host, sub)
    };
    let content_size = egui::vec2(width, sub.size.y.min(cap));
    let content_rect = Rect::from_center_size(screen.center(), content_size);
    let origin = sub.rects.get(&host.id).map(|r| r.min).unwrap_or_default();
    let scratch = translate_layout(&sub, content_rect.min - origin);

    let resp =
        egui::Modal::new(w.ui.scope_id().with((node.id.as_str(), "modal"))).show(ctx, |ui| {
            ui.set_min_size(content_size);
            overlay_contents(
                w,
                ui,
                node,
                &widget,
                &host,
                &scratch,
                content_rect,
                &parent_inh,
            );
        });

    if resp.backdrop_response.clicked()
        || (resp.is_top_modal && ctx.input(|i| i.key_pressed(egui::Key::Escape)))
    {
        if let Some(name) = close_handler(node) {
            w.events.push(WidgetEvent {
                node: node.id.clone(),
                handler: name.into(),
                value: events::empty(),
            });
        }
    }
}

/// The anchored path (`we-popover`, `DropdownMenu`): an [`egui::Popup`]
/// under the trigger's rect. A click outside it or Escape flips the
/// internal flag in [`EditState`] — a controlled `open` prop overrides.
fn anchored_overlay(
    w: &mut Walk<'_>,
    ctx: &egui::Context,
    node: &ResolvedNode,
    anchor: Rect,
    floating: Vec<ResolvedChild>,
    parent_inh: Option<Style>,
) {
    let widget = w.registry.widget_for(&node.ty);
    let width = anchor.width().max(160.0);
    let host = overlay_host(node, width, floating);
    let mcx = MeasureCx::new(ctx);
    // Same floating-host rule as the modal: `auto` height is the content's,
    // not floored to the anchor's rect.
    let sub = crate::layout_shrink(&mcx, w.scx, w.registry, &host, anchor);
    let size = sub.size.max(egui::vec2(width, 4.0));

    let inner = egui::Popup::new(
        w.ui.scope_id().with((node.id.as_str(), "popup")),
        ctx.clone(),
        egui::PopupAnchor::ParentRect(anchor),
        w.ui.layer_id(),
    )
    .kind(egui::PopupKind::Popup)
    .align(rect_align(node))
    .open(true)
    .layout(egui::Layout::top_down(egui::Align::Min))
    .frame(egui::Frame::popup(w.ui.style()))
    .show(|ui| {
        ui.set_min_size(size);
        let content_rect = Rect::from_min_size(ui.min_rect().min, size);
        let origin = sub.rects.get(&host.id).map(|r| r.min).unwrap_or_default();
        let scratch = translate_layout(&sub, content_rect.min - origin);
        overlay_contents(
            w,
            ui,
            node,
            &widget,
            &host,
            &scratch,
            content_rect,
            &parent_inh,
        );
    });

    // Internal open state lives in EditState — the prop-less popovers and
    // menus close on an outside click or Escape (the click still reaches
    // what it landed on, like the TS document listener).
    let controlled = matches!(node.props.get("open"), Some(v) if !v.is_undefined());
    if !controlled {
        if let Some(resp) = inner {
            let pos = ctx.input(|i| i.pointer.interact_pos());
            let outside = ctx.input(|i| i.pointer.any_click())
                && pos.is_some_and(|p| !resp.response.rect.contains(p) && !anchor.contains(p));
            let escape = ctx.input(|i| i.key_pressed(egui::Key::Escape));
            if outside || escape {
                w.edit.set_open(&node.id, false);
            }
        }
    }
}
