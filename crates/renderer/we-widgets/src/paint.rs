//! Paint: walk the resolved tree, hand each node its rect and a [`PaintCx`].
//! Containers recurse — a widget paints chrome and content, the frame paints
//! its children and the text spans.
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

use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::{
    events, EditState, Layout, MeasureCx, PaintCx, Parts, Rect, Registry, WidgetEvent, WidgetKind,
};

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
    // The widget-visible parts map: the layout's part rects, plus every
    // node's own rect under `"rect"`.
    let mut parts = layout.parts.clone();
    for (id, rect) in &layout.rects {
        parts.insert((id.clone(), "rect"), *rect);
    }
    let mut w = Walk {
        ui,
        registry,
        layout,
        events,
        edit,
        now,
        ancestors: Vec::new(),
        parts,
        overlays: Vec::new(),
    };
    paint_node(&mut w, root);
    paint_overlays(&mut w);
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
    /// `layout.parts` merged with each node's own rect under `"rect"`.
    parts: Parts,
    /// `Overlay` nodes met in the walk, in tree order — painted after it.
    overlays: Vec<ResolvedNode>,
}

fn paint_node(w: &mut Walk<'_>, node: &ResolvedNode) {
    let Some(rect) = w.layout.rects.get(&node.id).copied() else {
        return;
    };
    let widget = w.registry.widget_for(&node.ty);
    if widget.kind() == WidgetKind::Overlay {
        w.overlays.push(node.clone());
    }
    w.ancestors.push(node.id.clone());
    {
        let mut cx = PaintCx {
            ui: w.ui,
            events: w.events,
            parts: &w.parts,
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

/// `true` when the overlay should paint: a controlled `open` prop wins, else
/// the widget's internal flag in [`EditState`].
fn overlay_open(w: &Walk<'_>, node: &ResolvedNode) -> bool {
    match node.props.get("open") {
        Some(v) if !v.is_undefined() => v.truthy(),
        _ => w.edit.is_open(&node.id),
    }
}

/// The resolved children that got no layout rect — they were not picked by
/// the widget's `parts_spec` and belong on the overlay layer.
fn floating_children(w: &Walk<'_>, node: &ResolvedNode) -> Vec<ResolvedChild> {
    node.children
        .iter()
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
fn modal_host(node: &ResolvedNode, width: f32, children: Vec<ResolvedChild>, mcx: &MeasureCx) -> ResolvedNode {
    let pad = crate::Modal::pad(node) as f64;
    let mut host = overlay_host(node, width, children);
    for key in ["pl", "pr", "pb"] {
        host.props.insert(key.into(), we_expr::Value::Num(pad));
    }
    let pt = pad + crate::Modal::title_strip(mcx, node).unwrap_or(0.0) as f64;
    host.props.insert("pt".into(), we_expr::Value::Num(pt));
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
        let node = w.overlays.remove(0);
        if !overlay_open(w, &node) {
            continue;
        }
        let ctx = w.ui.ctx().clone();
        let floating = floating_children(w, &node);
        // A "trigger" part makes this an anchored popup; without one the
        // node is a centred modal.
        match w.parts.get(&(node.id.clone(), "trigger")).copied() {
            Some(anchor) => anchored_overlay(w, &ctx, &node, anchor, floating),
            None => modal_overlay(w, &ctx, &node, floating),
        }
    }
}

/// `node`'s close-ish handler name (`close` or `onClose`), if it declared one.
fn close_handler(node: &ResolvedNode) -> Option<&'static str> {
    if node.handlers.contains_key("close") {
        Some("close")
    } else if node.handlers.contains_key("onClose") {
        Some("onClose")
    } else {
        None
    }
}

/// The inner painting an overlay does inside its egui layer: the widget's
/// second `paint` (marked by an `"overlay"` part rect), then the floating
/// children at the scratch layout's rects, then anything they deferred.
fn overlay_contents(
    w: &mut Walk<'_>,
    ui: &mut egui::Ui,
    node: &ResolvedNode,
    widget: &Arc<dyn crate::Widget>,
    scratch: &Layout,
    content_rect: Rect,
) {
    let mut parts = scratch.parts.clone();
    parts.insert((node.id.clone(), "overlay"), content_rect);
    let mut inner = Walk {
        ui,
        registry: w.registry,
        layout: scratch,
        events: w.events,
        edit: w.edit,
        now: w.now,
        ancestors: w.ancestors.clone(),
        parts,
        overlays: Vec::new(),
    };
    inner.ancestors.push(node.id.clone());
    {
        let ancestors = inner.ancestors[..inner.ancestors.len() - 1].to_vec();
        let mut cx = PaintCx {
            ui: inner.ui,
            events: inner.events,
            parts: &inner.parts,
            edit: inner.edit,
            now: inner.now,
            ancestors: &ancestors,
        };
        widget.paint(&mut cx, node, &crate::style_of(node), content_rect);
    }
    for span in &scratch.texts {
        inner.ui.painter().text(
            span.rect.min,
            egui::Align2::LEFT_TOP,
            span.text.as_ref(),
            egui::FontId::default(),
            inner.ui.visuals().text_color(),
        );
    }
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            paint_node(&mut inner, n);
        }
    }
    paint_overlays(&mut inner);
}

/// The `we-modal` path: `egui::Modal` draws the backdrop and centres the
/// content; its layer blocks input below (egui marks it `top_modal_layer`).
/// Escape or a backdrop click emits the node's `close`/`onClose`.
fn modal_overlay(
    w: &mut Walk<'_>,
    ctx: &egui::Context,
    node: &ResolvedNode,
    floating: Vec<ResolvedChild>,
) {
    let widget = w.registry.widget_for(&node.ty);
    let screen = ctx.content_rect();
    let width = modal_width(node, screen.width());
    let mcx = MeasureCx::new(ctx);
    let host = modal_host(node, width, floating, &mcx);
    let sub = crate::layout(&mcx, w.registry, &host, screen);
    // The dialog is sized by its content: `sub.size` is the padded host
    // column — width, plus `pt` (pad + title strip) + children + `pb`.
    // WE caps it at `maxHeight: calc(100dvh - 64px)`.
    let content_size = egui::vec2(
        width,
        sub.size.y.min(screen.height() - 64.0).max(64.0),
    );
    let content_rect = Rect::from_center_size(screen.center(), content_size);
    let origin = sub.rects.get(&host.id).map(|r| r.min).unwrap_or_default();
    let scratch = translate_layout(&sub, content_rect.min - origin);

    let resp =
        egui::Modal::new(w.ui.scope_id().with((node.id.as_str(), "modal"))).show(ctx, |ui| {
            ui.set_min_size(content_size);
            overlay_contents(w, ui, node, &widget, &scratch, content_rect);
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
) {
    let widget = w.registry.widget_for(&node.ty);
    let width = anchor.width().max(160.0);
    let host = overlay_host(node, width, floating);
    let mcx = MeasureCx::new(ctx);
    let sub = crate::layout(&mcx, w.registry, &host, anchor);
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
        overlay_contents(w, ui, node, &widget, &scratch, content_rect);
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
