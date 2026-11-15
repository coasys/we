//! Prop helpers + the paint toolbox every widget shares.
//!
//! Two layers:
//! - the `pub` safe reads E5b's input/overlay/picker widgets use — a prop of
//!   the wrong type falls back to the caller's default, never panics;
//! - the `pub(crate)` paint toolbox the E5a widgets share — the *look* comes
//!   from [`we_style::Style`] first, then the widget's own token defaults
//!   (in [`crate::defaults`]); no colour literals in widget code — egui
//!   `visuals()` is the last fallback and always noted.
use indexmap::IndexMap;
use we_expr::Value;
use we_style::{Color, Dimension, Edges, Size, Style, StylePatch};
use we_template::{NodeId, ResolvedNode};

use crate::{PaintCx, Rect};

pub(crate) use we_layout::props::{border_side_px, prop_bool, prop_str};
pub use we_layout::props::{prop, prop_num};

/// A string prop, owned; `Num`/`Bool` coerce through their JS text form the
/// way a DOM attribute would, anything else is `None`.
pub fn prop_string(node: &ResolvedNode, key: &str) -> Option<String> {
    match prop(node, key) {
        Value::Str(s) => Some(s.to_string()),
        Value::Num(_) | Value::Bool(_) => Some(prop(node, key).js_string()),
        _ => None,
    }
}

/// Non-empty `props[key]` as a string.
pub(crate) fn prop_text<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a str> {
    prop_str(node, key).filter(|s| !s.is_empty())
}

/// A boolean prop — `Bool` only; a string `"true"` does not coerce (wrong
/// type → default).
pub fn prop_flag(node: &ResolvedNode, key: &str) -> Option<bool> {
    match prop(node, key) {
        Value::Bool(b) => Some(*b),
        _ => None,
    }
}

/// `props[key]` present at all (not `Undefined`) — for "is `open`
/// controlled?" checks.
pub fn prop_present(node: &ResolvedNode, key: &str) -> bool {
    !prop(node, key).is_undefined()
}

/// `props[key]` restricted to a word list — unknown words are a wrong type.
pub fn prop_enum<'a>(node: &'a ResolvedNode, key: &str, allowed: &[&'a str]) -> Option<&'a str> {
    prop_str(node, key).filter(|s| allowed.contains(s))
}

/// `props[key]` as a list.
pub(crate) fn prop_list<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a Vec<Value>> {
    match prop(node, key) {
        Value::List(l) => Some(l.as_ref()),
        _ => None,
    }
}

/// Any element child (not text) — the "real children" check the
/// text-painting widgets share.
pub(crate) fn has_node_children(node: &ResolvedNode) -> bool {
    node.children
        .iter()
        .any(|c| matches!(c, we_template::ResolvedChild::Node(_)))
}

/// Just the text children, concatenated — the default slot's words on the
/// web component, which never sees the `label`/`value` props `text_of`
/// falls back to.
pub(crate) fn children_text(node: &ResolvedNode) -> String {
    node.children
        .iter()
        .filter_map(|c| match c {
            we_template::ResolvedChild::Text(t) => Some(t.as_ref()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

/// The display text: `text`, then `label`, then `value`, then concatenated
/// text children — what the primitives render in that order.
pub(crate) fn text_of(node: &ResolvedNode) -> String {
    for key in ["text", "label", "value"] {
        if let Some(s) = prop_text(node, key) {
            return s.to_string();
        }
    }
    children_text(node)
}

/// The AccessKit label: `label` prop, falling back to `alt`/`name`/type.
#[allow(dead_code)]
pub(crate) fn label_of(node: &ResolvedNode) -> String {
    for key in ["label", "alt", "name"] {
        if let Some(s) = prop_text(node, key) {
            return s.to_string();
        }
    }
    node.ty.to_string()
}

/// A part rect the layout gave `node` (`PaintCx::parts`), or `None`.
pub fn part(cx: &PaintCx, node: &ResolvedNode, name: &'static str) -> Option<Rect> {
    cx.parts.get(&(node.id.clone(), name)).copied()
}

/// The `size` DS prop → control height px (`--we-component-height-*`:
/// xs 24, sm 28, md 34, lg 44, xl 56 — the themes' recorded scale, rounded).
pub fn control_height(node: &ResolvedNode) -> f32 {
    match prop_enum(node, "size", &["xs", "sm", "md", "lg", "xl"]).unwrap_or("md") {
        "xs" => 24.0,
        "sm" => 28.0,
        "lg" => 44.0,
        "xl" => 56.0,
        _ => 34.0,
    }
}

/// `Style::with_state` for the response's state. Disabled stands alone;
/// otherwise `:hover` applies while the pointer is over the widget and
/// `:active` over it while pressed — a press is both in CSS, so an active
/// patch silent on a property keeps hover's value (cyberpunk's
/// `:hover { clip-path: none }` holds while held). `:focus` composes last.
pub(crate) fn state_style<'a>(
    style: &'a Style,
    response: &egui::Response,
    disabled: bool,
) -> std::borrow::Cow<'a, Style> {
    let mut out = if disabled {
        match &style.disabled {
            Some(p) => patched(style, p),
            None => std::borrow::Cow::Borrowed(style),
        }
    } else {
        let down = response.is_pointer_button_down_on();
        let hover = response
            .hovered()
            .then_some(style.hover.as_deref())
            .flatten();
        let active = down.then_some(style.active.as_deref()).flatten();
        match (hover, active) {
            (None, None) => std::borrow::Cow::Borrowed(style),
            (h, a) => {
                let mut out = style.pretier.as_deref().unwrap_or(style).clone();
                if let Some(h) = h {
                    out.apply(h);
                }
                if let Some(a) = a {
                    out.apply(a);
                }
                std::borrow::Cow::Owned(out)
            }
        }
    };
    // `:focus` composes with the resting state — the ring paints on top of
    // hover/active chrome. A disabled button never takes focus.
    if !disabled && response.has_focus() {
        if let Some(p) = &style.focus {
            out.to_mut().apply(p);
        }
    }
    out
}

/// The pre-tier style with a state patch applied — `Style::with_state`
/// without the Option dance.
pub(crate) fn patched<'a>(style: &'a Style, patch: &StylePatch) -> std::borrow::Cow<'a, Style> {
    let mut out = style.pretier.as_deref().unwrap_or(style).clone();
    out.apply(patch);
    std::borrow::Cow::Owned(out)
}

/// An inset edge (`padding`/`border` width) in px — `Percent` (and the
/// percent term of a `calc()`) resolves against `base`, the containing
/// block's content width — CSS puts every edge's percentage on the CB
/// *width*. `base` is `None` when layout found it content-driven: the
/// CSS cyclic fallback zeroes the *percent term* and keeps the rest —
/// the same `resolve(Some(0))` answer layout's `lp` gave taffy, not a
/// dropped value. `ch`/`ex`/`lh` take `layout::dim_px`'s font-metric
/// approximations so paint agrees with the space taffy offered measure —
/// the shared `Dimension::resolve` policy.
fn inset_px(d: &Option<Dimension>, view: crate::defaults::ViewportCx, base: Option<f32>) -> f32 {
    match d.as_ref() {
        Some(d) => d
            .resolve(
                Some(base.unwrap_or(0.0)),
                view.font_px,
                view.root_px,
                view.viewport,
            )
            .unwrap_or(0.0),
        None => 0.0,
    }
}

/// The content box: `rect` (the border box) shrunk by the resolved padding
/// and border widths — where CSS puts a node's content, and the same box
/// taffy offers `widget.measure` (it pre-subtracts this inset). Leaf
/// widgets paint their glyphs/images/icons inside it; `paint_box` chrome —
/// bg, borders, shadows — stays on `rect`. Interaction keeps `rect`.
/// `base` is the containing-block width [`Layout::bases`] recorded —
/// the same value layout resolved percent terms against.
pub(crate) fn content_rect(
    rect: egui::Rect,
    style: &Style,
    view: crate::defaults::ViewportCx,
    base: Option<f32>,
) -> egui::Rect {
    let pad = &style.layout.padding;
    let bor = &style.paint.borders;
    let p = |d: &Option<Dimension>| inset_px(d, view, base);
    let bw = |s: &Option<we_style::BorderSide>| {
        border_side_px(s, view.font_px, view.root_px, view.viewport)
    };
    let min = rect.min + egui::vec2(p(&pad.left) + bw(&bor.left), p(&pad.top) + bw(&bor.top));
    let max = rect.max
        - egui::vec2(
            p(&pad.right) + bw(&bor.right),
            p(&pad.bottom) + bw(&bor.bottom),
        );
    // Padding can exceed the box — the content box floors at zero-size.
    egui::Rect::from_min_max(min, egui::pos2(max.x.max(min.x), max.y.max(min.y)))
}

/// `we_style::Color` → `egui::Color32` (premultiplied, as egui wants).
pub(crate) fn color32(c: Color) -> egui::Color32 {
    let [r, g, b, a] = c.to_premultiplied();
    egui::Color32::from_rgba_premultiplied(
        (r * 255.0) as u8,
        (g * 255.0) as u8,
        (b * 255.0) as u8,
        (a * 255.0) as u8,
    )
}

/// A `Dimension` against font/root/viewport; `Auto`/`Percent` resolve in
/// layout, not here — callers take `None` as "not set".
pub(crate) fn px(d: Option<&Dimension>, font_px: f32, root_px: f32, viewport: Size) -> Option<f32> {
    d.and_then(|d| d.to_px(font_px, root_px, viewport))
}

/// The resolved border-radius in px — corners averaged into one `f32` (egui
/// has one corner radius); `Percent` reads against the box's short side.
pub(crate) fn radius_px(
    radius: &Edges<Option<Dimension>>,
    rect: egui::Rect,
    font_px: f32,
    root_px: f32,
    viewport: Size,
) -> f32 {
    let mut sum = 0.0;
    let mut n = 0;
    for side in radius.as_slice() {
        let Some(d) = side else { continue };
        // Corners read percent against the box's short side — the base
        // is known, so a calc sum resolves fully.
        let v = d
            .resolve(
                Some(rect.width().min(rect.height())),
                font_px,
                root_px,
                viewport,
            )
            .unwrap_or(0.0);
        sum += v;
        n += 1;
    }
    if n == 0 {
        0.0
    } else {
        sum / n as f32
    }
}

/// Paint the box's own chrome: opacity-multiplied bg fill, border sides,
/// corner radius, box shadows. Colors are all style-resolved; a `None`
/// colour paints nothing.
///
/// `current_color` is the box's text colour, for `border-color: currentColor`
/// (the CSS default a `None` side colour means).
pub(crate) fn paint_box(
    painter: &egui::Painter,
    rect: egui::Rect,
    style: &Style,
    current_color: egui::Color32,
    view: crate::defaults::ViewportCx,
) {
    let opacity = style.paint.opacity.unwrap_or(1.0).clamp(0.0, 1.0);
    let fade = |c: egui::Color32| c.gamma_multiply(opacity);
    let viewport = view.viewport;
    let radius = radius_px(
        &style.paint.radius,
        rect,
        view.font_px,
        view.root_px,
        viewport,
    );

    // `clip-path: polygon(…)` changes nothing here — the element paints
    // normally (radius, borders, shadows) and the paint walk clips the
    // whole subtree's output afterwards; see [`apply_clip`].

    // Shadows under the box: egui has shadows only as widgets; paint a soft
    // offset rect per layer (inset layers paint over the bg below).
    if let Some(shadows) = &style.paint.shadows {
        for s in shadows {
            if s.inset {
                continue;
            }
            let dx =
                s.dx.to_px(view.font_px, view.root_px, viewport)
                    .unwrap_or(0.0);
            let dy =
                s.dy.to_px(view.font_px, view.root_px, viewport)
                    .unwrap_or(0.0);
            let spread = s
                .spread
                .and_then(|d| d.to_px(view.font_px, view.root_px, viewport))
                .unwrap_or(0.0);
            let blur = s
                .blur
                .and_then(|d| d.to_px(view.font_px, view.root_px, viewport))
                .unwrap_or(0.0);
            let color = s.color.map(color32).unwrap_or(current_color);
            let r = rect.translate(egui::vec2(dx, dy)).expand(spread);
            // Blur ~ expanded rect at lower alpha (egui has no blur primitive).
            let layers = if blur > 0.0 { 3 } else { 1 };
            for i in (1..=layers).rev() {
                let grow = blur * i as f32 / layers as f32;
                let alpha = if blur > 0.0 {
                    1.0 - (i as f32 - 1.0) / layers as f32 * 0.5
                } else {
                    1.0
                };
                painter.rect_filled(
                    r.expand(grow),
                    radius + grow,
                    fade(color).gamma_multiply(alpha),
                );
            }
        }
    }

    if let Some(bg) = style.paint.bg {
        painter.rect_filled(rect, radius, fade(color32(bg)));
    }

    // Inset layers: over the background, under the borders (CSS painting
    // order), inside the PADDING box — an inner shadow starts at the
    // padding edge, so a border never covers its band. The layer's shape
    // is that box shrunk by its spread and shifted by its offset —
    // `inset 1px 1px` lights the top/left inner edges, `inset -1px -1px`
    // the bottom/right. Painted region = `padding \ shape`, the four
    // edge strips between them. Layers stack front-to-back like CSS
    // shadows (first declared on top), so they paint in reverse.
    let border_w = |side: &Option<we_style::BorderSide>| match side {
        Some(b)
            if !matches!(
                b.kind,
                we_style::BorderKind::None | we_style::BorderKind::Hidden
            ) =>
        {
            b.width
                .and_then(|d| d.to_px(view.font_px, view.root_px, viewport))
                .unwrap_or(3.0) // CSS `medium`, as the stroke below
                .max(0.0)
        }
        _ => 0.0,
    };
    let b = &style.paint.borders;
    let padding_box = egui::Rect::from_min_max(
        rect.min + egui::vec2(border_w(&b.left), border_w(&b.top)),
        rect.max - egui::vec2(border_w(&b.right), border_w(&b.bottom)),
    );
    if let Some(shadows) = &style.paint.shadows {
        for s in shadows.iter().rev() {
            if !s.inset {
                continue;
            }
            let dx =
                s.dx.to_px(view.font_px, view.root_px, viewport)
                    .unwrap_or(0.0);
            let dy =
                s.dy.to_px(view.font_px, view.root_px, viewport)
                    .unwrap_or(0.0);
            let spread = s
                .spread
                .and_then(|d| d.to_px(view.font_px, view.root_px, viewport))
                .unwrap_or(0.0);
            let blur = s
                .blur
                .and_then(|d| d.to_px(view.font_px, view.root_px, viewport))
                .unwrap_or(0.0);
            let color = s.color.map(color32).unwrap_or(current_color);
            if padding_box.width() <= 0.0 || padding_box.height() <= 0.0 {
                continue; // the borders fill the box — no padding edge
            }
            let shape = padding_box.expand(-spread).translate(egui::vec2(dx, dy));
            // Blur softens the band inward — the uncovered shape shrinks
            // in fading steps, matching the outer-shadow approximation.
            let layers = if blur > 0.0 { 3 } else { 1 };
            for i in 0..layers {
                // Deepest layer first, sharpest band last at full alpha.
                let grow = blur * (layers - 1 - i) as f32 / layers as f32;
                let alpha = if blur > 0.0 {
                    1.0 - (layers - 1 - i) as f32 / layers as f32 * 0.6
                } else {
                    1.0
                };
                paint_inset_layer(
                    painter,
                    padding_box,
                    shape.expand(-grow),
                    fade(color).gamma_multiply(alpha),
                );
            }
        }
    }

    for (edge, side) in [
        (egui::Align2::CENTER_TOP, &style.paint.borders.top),
        (egui::Align2::RIGHT_CENTER, &style.paint.borders.right),
        (egui::Align2::CENTER_BOTTOM, &style.paint.borders.bottom),
        (egui::Align2::LEFT_CENTER, &style.paint.borders.left),
    ] {
        let Some(side) = side else { continue };
        if matches!(
            side.kind,
            we_style::BorderKind::None | we_style::BorderKind::Hidden
        ) {
            continue;
        }
        let width = side
            .width
            .and_then(|d| d.to_px(view.font_px, view.root_px, viewport))
            .unwrap_or(3.0); // CSS `medium`
        if width <= 0.0 {
            continue;
        }
        let color = side.color.map(color32).unwrap_or(current_color);
        // CSS `border` paints inside the border box — the stroke runs
        // half its width in from the edge, not centered on it.
        let (a, b) = match edge {
            egui::Align2::CENTER_TOP => (
                rect.left_top() + egui::vec2(0.0, width * 0.5),
                rect.right_top() + egui::vec2(0.0, width * 0.5),
            ),
            egui::Align2::RIGHT_CENTER => (
                rect.right_top() + egui::vec2(-width * 0.5, 0.0),
                rect.right_bottom() + egui::vec2(-width * 0.5, 0.0),
            ),
            egui::Align2::CENTER_BOTTOM => (
                rect.right_bottom() + egui::vec2(0.0, -width * 0.5),
                rect.left_bottom() + egui::vec2(0.0, -width * 0.5),
            ),
            _ => (
                rect.left_bottom() + egui::vec2(width * 0.5, 0.0),
                rect.left_top() + egui::vec2(width * 0.5, 0.0),
            ),
        };
        match side.kind {
            we_style::BorderKind::Dashed | we_style::BorderKind::Dotted => {
                // A dashed/dotted line: segments along the edge (dots = tiny).
                let seg = if side.kind == we_style::BorderKind::Dashed {
                    (width * 3.0, width * 2.0)
                } else {
                    (width, width)
                };
                let len = a.distance(b);
                let dir = egui::vec2((b.x - a.x) / len, (b.y - a.y) / len);
                let mut t = 0.0;
                while t < len {
                    let e = (t + seg.0).min(len);
                    painter.line_segment(
                        [a + dir * t, a + dir * e],
                        egui::Stroke::new(width, fade(color)),
                    );
                    t += seg.0 + seg.1;
                }
            }
            _ => {
                painter.line_segment([a, b], egui::Stroke::new(width, fade(color)));
            }
        }
    }
}

/// Where one inset layer paints — `rect \ shape` as four edge strips
/// `[top, bottom, left, right]` (`None` where the shape reaches the box
/// edge), or the whole box when the shifted shape misses it. The
/// geometry, separate from the painter so tests can read it.
enum InsetStrips {
    Covers,
    Strips([Option<egui::Rect>; 4]),
}

/// A diagonal offset leaves an L (two adjoining strips); a spread-only
/// layer the full ring. Strips are square-cornered: a rounded box keeps
/// its corner fill from the bg, which the strips then partially cover —
/// close enough that the radius-0 faces this exists for read exactly.
fn inset_strips(rect: egui::Rect, shape: egui::Rect) -> InsetStrips {
    let inner = shape.intersect(rect);
    if inner.width() <= 0.0 || inner.height() <= 0.0 {
        return InsetStrips::Covers;
    }
    // Top/bottom run the full width; left/right fill the middle rows.
    let top = (inner.min.y > rect.min.y)
        .then(|| egui::Rect::from_min_max(rect.min, egui::pos2(rect.max.x, inner.min.y)));
    let bottom = (inner.max.y < rect.max.y)
        .then(|| egui::Rect::from_min_max(egui::pos2(rect.min.x, inner.max.y), rect.max));
    let left = (inner.min.x > rect.min.x).then(|| {
        egui::Rect::from_min_max(
            egui::pos2(rect.min.x, inner.min.y),
            egui::pos2(inner.min.x, inner.max.y),
        )
    });
    let right = (inner.max.x < rect.max.x).then(|| {
        egui::Rect::from_min_max(
            egui::pos2(inner.max.x, inner.min.y),
            egui::pos2(rect.max.x, inner.max.y),
        )
    });
    InsetStrips::Strips([top, bottom, left, right])
}

fn paint_inset_layer(
    painter: &egui::Painter,
    rect: egui::Rect,
    shape: egui::Rect,
    color: egui::Color32,
) {
    match inset_strips(rect, shape) {
        InsetStrips::Covers => {
            painter.rect_filled(rect, 0.0, color);
        }
        InsetStrips::Strips(strips) => {
            for strip in strips.into_iter().flatten() {
                painter.rect_filled(strip, 0.0, color);
            }
        }
    }
}

/// The resolved `clip-path: polygon(…)` points in widget space, or `None`
/// for `clip-path: none`/no clip. Per CSS the reference box is the
/// element's border box: x percentages resolve against its width, y
/// against its height (`calc(…)` mixes go through [`Dimension::resolve`]).
/// The result may be degenerate — under three distinct points or zero
/// area — which the caller reads as "clip everything", not "no clip".
#[cfg(test)]
fn clip_points(
    style: &Style,
    rect: egui::Rect,
    view: crate::defaults::ViewportCx,
) -> Option<Vec<egui::Pos2>> {
    clip_points_of(style.paint.clip.as_ref(), rect, view)
}

fn clip_points_of(
    clip: Option<&we_style::ClipPath>,
    rect: egui::Rect,
    view: crate::defaults::ViewportCx,
) -> Option<Vec<egui::Pos2>> {
    let Some(we_style::ClipPath::Polygon(points)) = clip else {
        return None;
    };
    let points: Vec<egui::Pos2> = points
        .iter()
        .map(|(x, y)| {
            egui::pos2(
                rect.min.x
                    + x.resolve(
                        Some(rect.width()),
                        view.font_px,
                        view.root_px,
                        view.viewport,
                    )
                    .unwrap_or(0.0),
                rect.min.y
                    + y.resolve(
                        Some(rect.height()),
                        view.font_px,
                        view.root_px,
                        view.viewport,
                    )
                    .unwrap_or(0.0),
            )
        })
        .collect();
    // Drop consecutive duplicates and a repeated closing corner —
    // declared polygons (cyberpunk's) repeat points.
    let mut deduped: Vec<egui::Pos2> = Vec::with_capacity(points.len());
    for p in points {
        if deduped.last().is_none_or(|last| last.distance(p) > 0.01) {
            deduped.push(p);
        }
    }
    if deduped.len() > 1 && deduped[0].distance(*deduped.last().unwrap()) <= 0.01 {
        deduped.pop();
    }
    Some(deduped)
}

/// What the node's `clip-path` does to its painted output.
pub(crate) enum ClipRegion {
    /// No `clip-path` — output passes through untouched.
    None,
    /// A degenerate polygon (under three distinct points, or zero area)
    /// removes the element's output entirely — it is not "no clip".
    All,
    /// Polygon points resolved against the border box.
    Polygon(Vec<egui::Pos2>),
}

/// The node's clip region under `style.paint.clip` — [`clip_points`]
/// resolves the polygon against `rect` (the border box); fewer than three
/// distinct points or a zero-area result clip everything.
pub(crate) fn clip_region(
    style: &Style,
    rect: egui::Rect,
    view: crate::defaults::ViewportCx,
) -> ClipRegion {
    clip_region_of(style.paint.clip.as_ref(), rect, view)
}

/// [`clip_region`] for a bare `clip-path` value — the state-resolved one a
/// widget reported painting with.
pub(crate) fn clip_region_of(
    clip: Option<&we_style::ClipPath>,
    rect: egui::Rect,
    view: crate::defaults::ViewportCx,
) -> ClipRegion {
    if !matches!(clip, Some(we_style::ClipPath::Polygon(_))) {
        return ClipRegion::None;
    }
    match clip_points_of(clip, rect, view) {
        Some(pts) if pts.len() >= 3 && signed_area(&pts).abs() > 0.5 => ClipRegion::Polygon(pts),
        _ => ClipRegion::All,
    }
}

/// The polygon's signed area (shoelace) — sign is the winding.
fn signed_area(pts: &[egui::Pos2]) -> f32 {
    let n = pts.len();
    (0..n)
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            a.x * b.y - b.x * a.y
        })
        .sum::<f32>()
        * 0.5
}

/// A vertex carried through clipping: position plus the attributes a
/// tessellated mesh interpolates across its faces.
#[derive(Clone, Copy)]
struct ClipVert {
    pos: egui::Pos2,
    uv: egui::Pos2,
    color: egui::Color32,
}

impl ClipVert {
    fn lerp(a: Self, b: Self, t: f32) -> Self {
        let t = t.clamp(0.0, 1.0);
        let c = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t).round() as u8;
        Self {
            pos: egui::pos2(
                a.pos.x + (b.pos.x - a.pos.x) * t,
                a.pos.y + (b.pos.y - a.pos.y) * t,
            ),
            uv: egui::pos2(
                a.uv.x + (b.uv.x - a.uv.x) * t,
                a.uv.y + (b.uv.y - a.uv.y) * t,
            ),
            // Mesh colours are premultiplied; lerping premultiplied
            // channels is the correct blend, and they stay premultiplied.
            color: egui::Color32::from_rgba_premultiplied(
                c(a.color.r(), b.color.r()),
                c(a.color.g(), b.color.g()),
                c(a.color.b(), b.color.b()),
                c(a.color.a(), b.color.a()),
            ),
        }
    }
}

/// An inward half-plane: `origin` + unit normal pointing inside.
type Plane = (egui::Pos2, egui::Vec2);

/// Sutherland–Hodgman: clip the vertex list to every half-plane. Vertices
/// beyond a small epsilon count as inside — rasterization, not geometry
/// proofs, is the oracle.
fn clip_planes(poly: &[ClipVert], planes: &[Plane]) -> Vec<ClipVert> {
    const EPS: f32 = 0.01;
    let mut out = poly.to_vec();
    for &(origin, n) in planes {
        if out.is_empty() {
            break;
        }
        let d = |p: egui::Pos2| (p - origin).dot(n);
        let mut next = Vec::with_capacity(out.len());
        for i in 0..out.len() {
            let a = out[i];
            let b = out[(i + 1) % out.len()];
            let (da, db) = (d(a.pos), d(b.pos));
            if da >= -EPS {
                next.push(a);
            }
            if (da >= -EPS) != (db >= -EPS) {
                next.push(ClipVert::lerp(a, b, da / (da - db)));
            }
        }
        out = next;
    }
    out
}

/// The ear's three inward half-planes — `sign` is the polygon's winding.
fn ear_planes(ear: &[egui::Pos2; 3], sign: f32) -> [Plane; 3] {
    let mut planes = [(egui::pos2(0.0, 0.0), egui::vec2(0.0, 0.0)); 3];
    for i in 0..3 {
        let (a, b) = (ear[i], ear[(i + 1) % 3]);
        let d = b - a;
        let n = if sign >= 0.0 {
            egui::vec2(-d.y, d.x)
        } else {
            egui::vec2(d.y, -d.x)
        };
        planes[i] = (a, n.normalized());
    }
    planes
}

/// Fan-triangulate a convex clip result into `out` (vertex + index lists).
fn emit_fan(poly: &[ClipVert], out: &mut egui::epaint::Mesh) {
    if poly.len() < 3 {
        return;
    }
    let base = out.vertices.len() as u32;
    out.vertices
        .extend(poly.iter().map(|v| egui::epaint::Vertex {
            pos: v.pos,
            uv: v.uv,
            color: v.color,
        }));
    for i in 1..poly.len() - 1 {
        out.indices
            .extend([base, base + i as u32, base + i as u32 + 1]);
    }
}

/// `mesh ∩ poly` as a new mesh — `ears` are the polygon's triangulation.
/// The border box only placed the polygon's points; it is no second crop
/// (an outer shadow or an overflowing child inside the polygon stays).
fn clip_mesh(mesh: &egui::epaint::Mesh, ears: &[[egui::Pos2; 3]], sign: f32) -> egui::epaint::Mesh {
    let mut out = egui::epaint::Mesh {
        texture_id: mesh.texture_id,
        ..Default::default()
    };
    for tri in mesh.indices.chunks_exact(3) {
        let t: Vec<ClipVert> = tri
            .iter()
            .map(|&i| {
                let v = mesh.vertices[i as usize];
                ClipVert {
                    pos: v.pos,
                    uv: v.uv,
                    color: v.color,
                }
            })
            .collect();
        for ear in ears {
            let piece = clip_planes(&t, &ear_planes(ear, sign));
            emit_fan(&piece, &mut out);
        }
    }
    out
}

/// Apply the node's [`ClipRegion`] to every shape the node's subtree
/// queued on `layer` from index `start` on — the paint walk calls this
/// after `paint_node` finishes the subtree. egui clips to rectangles
/// only, so the polygon is applied to geometry: each queued shape is
/// tessellated with the frame's own settings and every triangle is cut
/// against the polygon's ears, then written back in place (a `Shape::Vec`
/// keeps painting order when a shape becomes several meshes — e.g. chrome
/// on the atlas texture plus glyphs on the font texture). The cut is
/// `polygon ∩` the clip rect each shape already carries (its ancestors'
/// rectangular clips) — the border box only placed the polygon's points.
/// `PaintCallback` primitives cannot be cut and are currently DROPPED, even
/// when wholly inside the polygon (no built-in widget emits one; the
/// policy is an open follow-up).
pub(crate) fn apply_clip(
    ctx: &egui::Context,
    layer: egui::LayerId,
    start: usize,
    region: &ClipRegion,
) {
    let pts = match region {
        ClipRegion::None => return,
        ClipRegion::All => {
            ctx.graphics_mut(|g| {
                if let Some(list) = g.get_mut(layer) {
                    let end = list.next_idx().0;
                    for i in start..end {
                        list.mutate_shape(egui::layers::ShapeIdx(i), |cs| {
                            cs.shape = egui::Shape::Noop;
                        });
                    }
                }
            });
            return;
        }
        ClipRegion::Polygon(pts) => pts,
    };
    let ear_idx = triangulate(pts);
    if ear_idx.is_empty() {
        return;
    }
    let ears: Vec<[egui::Pos2; 3]> = ear_idx
        .chunks_exact(3)
        .map(|t| [pts[t[0] as usize], pts[t[1] as usize], pts[t[2] as usize]])
        .collect();
    let sign = if signed_area(pts) >= 0.0 { 1.0 } else { -1.0 };
    let ppp = ctx.pixels_per_point();
    let options = ctx.tessellation_options(|o| *o);
    let tex_size = ctx.fonts(|f| f.font_image_size());
    let mut tess = egui::epaint::Tessellator::new(ppp, options, tex_size, Vec::new());
    ctx.graphics_mut(|g| {
        let Some(list) = g.get_mut(layer) else {
            return;
        };
        let end = list.next_idx().0;
        for i in start..end {
            list.mutate_shape(egui::layers::ShapeIdx(i), |cs| {
                let taken = std::mem::replace(&mut cs.shape, egui::Shape::Noop);
                let transform = cs.transform_after_tessellation;
                let mut prims = Vec::new();
                tess.tessellate_clipped_shape(
                    egui::epaint::ClippedShape {
                        clip_rect: cs.clip_rect,
                        shape: taken,
                        transform_after_tessellation: transform,
                    },
                    &mut prims,
                );
                let mut shapes = Vec::new();
                for cp in prims {
                    if let egui::epaint::Primitive::Mesh(m) = cp.primitive {
                        let mut m = m;
                        if transform != egui::emath::TSTransform::IDENTITY {
                            for v in &mut m.vertices {
                                v.pos = transform.mul_pos(v.pos);
                            }
                        }
                        let m = clip_mesh(&m, &ears, sign);
                        if !m.indices.is_empty() {
                            shapes.push(egui::Shape::mesh(m));
                        }
                    }
                }
                cs.transform_after_tessellation = egui::emath::TSTransform::IDENTITY;
                cs.shape = match shapes.len() {
                    0 => egui::Shape::Noop,
                    1 => shapes.pop().unwrap(),
                    _ => egui::Shape::Vec(shapes),
                };
            });
        }
    });
}

/// Ear-clipping triangulation of a simple polygon — index triples into
/// `points` (consecutive-duplicate-free, as `clip_points` returns).
/// Orientation-agnostic: the signed area fixes the winding. A non-simple
/// input falls back to a fan so something still paints.
fn triangulate(pts: &[egui::Pos2]) -> Vec<u32> {
    let n = pts.len();
    if n < 3 {
        return Vec::new();
    }
    let area: f32 = (0..n)
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            a.x * b.y - b.x * a.y
        })
        .sum::<f32>()
        * 0.5;
    let sign = if area >= 0.0 { 1.0 } else { -1.0 };
    let cross = |a: egui::Pos2, b: egui::Pos2, c: egui::Pos2| {
        (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    };
    // A vertex blocks an ear when it lies inside the ear OR on its
    // boundary — notably on the a–c diagonal the ear would cut along
    // (`polygon(0 0, 100px 0, 100px 100px, 50px 50px, 0 100px)`: the notch
    // vertex sits on the first ear's diagonal; ignoring it fills the
    // notch). Signed distances with a small tolerance keep collinear cases
    // stable; a vertex at the same point as a, b or c (a polygon touching
    // itself) does not block, or no ear could ever be cut.
    let dist = |a: egui::Pos2, b: egui::Pos2, p: egui::Pos2| {
        cross(a, b, p) * sign / (b - a).length().max(1e-6)
    };
    let blocks = |p: egui::Pos2, a: egui::Pos2, b: egui::Pos2, c: egui::Pos2| {
        const EPS: f32 = 1e-3;
        let same = |q: egui::Pos2| p.distance(q) <= EPS;
        !(same(a) || same(b) || same(c))
            && dist(a, b, p) >= -EPS
            && dist(b, c, p) >= -EPS
            && dist(c, a, p) >= -EPS
    };
    let mut idx: Vec<u32> = (0..n as u32).collect();
    let mut out = Vec::with_capacity((n - 2) * 3);
    while idx.len() > 3 {
        let m = idx.len();
        let mut clipped = false;
        for i in 0..m {
            let (ia, ib, ic) = (idx[(i + m - 1) % m], idx[i], idx[(i + 1) % m]);
            let (a, b, c) = (pts[ia as usize], pts[ib as usize], pts[ic as usize]);
            if cross(a, b, c) * sign <= 0.0 {
                continue; // reflex or degenerate — not an ear
            }
            if idx
                .iter()
                .any(|&iv| iv != ia && iv != ib && iv != ic && blocks(pts[iv as usize], a, b, c))
            {
                continue;
            }
            out.extend([ia, ib, ic]);
            idx.remove(i);
            clipped = true;
            break;
        }
        if !clipped {
            // Not simple (self-intersecting/degenerate) — fan so something paints.
            for i in 1..idx.len() - 1 {
                out.extend([idx[0], idx[i], idx[i + 1]]);
            }
            return out;
        }
    }
    out.extend([idx[0], idx[1], idx[2]]);
    out
}

/// A `FontId` for the style's text props — the node's `font-family` stack
/// first (its first entry naming a registered WE family — `DM Sans`,
/// `Mozilla Text`, `Boldonse`, `VT323`, `Bricolage Grotesque` — resolves to
/// that family), else the theme's base `base_family`, else egui's generics.
/// `base_family` is what the web's `:root { font-family }` declares; nodes
/// without an explicit stack inherit it. `ctx` grounds `fonts::resolve`'s
/// installed-family check.
pub(crate) fn font_id(
    style: &Style,
    ctx: &egui::Context,
    base_family: Option<&str>,
    font_px: f32,
    root_px: f32,
    viewport: Size,
) -> egui::FontId {
    let size = style
        .text
        .font_size
        .and_then(|d| d.to_px(font_px, root_px, viewport))
        .unwrap_or(font_px);
    let family = style
        .text
        .font_family
        .as_deref()
        .or(base_family)
        .map(|stack| crate::fonts::resolve(ctx, stack, style.text.font_weight))
        .unwrap_or(egui::FontFamily::Proportional);
    egui::FontId::new(size, family)
}

/// The family a widget's own text is set in — the node's `font-family`
/// stack, else the theme's stashed base family (`font: inherit` on the web
/// controls), else egui's `Proportional`. For widgets that keep their own
/// type size (`we-input`'s field text, `we-form-field`'s label rows) and
/// only inherit the face.
pub(crate) fn text_family(style: &Style, ctx: &egui::Context) -> egui::FontFamily {
    let base = crate::defaults::base_family_of(ctx);
    style
        .text
        .font_family
        .as_deref()
        .or(base.as_deref())
        .map(|stack| crate::fonts::resolve(ctx, stack, style.text.font_weight))
        .unwrap_or(egui::FontFamily::Proportional)
}

/// A form control's own text face — egui's default control size in the
/// family [`text_family`] resolves (`font: inherit` on the web controls).
/// One place for every field, so a textarea, a select and a number input
/// measure and paint in the face the input does.
pub(crate) fn control_font(style: &Style, ctx: &egui::Context) -> egui::FontId {
    egui::FontId::new(egui::FontId::default().size, text_family(style, ctx))
}

/// [`control_font`] at egui's `Body` size — the size a bare `TextEdit`
/// paints at, which the textarea and the number editor always used. Only
/// the family changes; an unthemed field looks exactly as before.
pub(crate) fn editor_font(style: &Style, ctx: &egui::Context) -> egui::FontId {
    let size = ctx.global_style().text_styles[&egui::TextStyle::Body].size;
    egui::FontId::new(size, text_family(style, ctx))
}

/// Line height in px: `line-height` ratio × font size, a length directly, or
/// egui's natural row height for `normal`.
pub(crate) fn line_height_px(
    style: &Style,
    font: &egui::FontId,
    ctx: &egui::Context,
    font_px: f32,
    root_px: f32,
    viewport: Size,
) -> f32 {
    match &style.text.line_height {
        Some(we_style::LineHeight::Ratio(r)) => font.size * r,
        Some(we_style::LineHeight::Length(d)) => {
            d.to_px(font_px, root_px, viewport).unwrap_or(font.size)
        }
        _ => ctx.fonts_mut(|f| f.row_height(font)),
    }
}

/// `text-transform` + the widget `uppercase` prop applied to display text.
pub(crate) fn transform_text(style: &Style, text: &str, uppercase_prop: bool) -> String {
    match style.text.transform {
        Some(we_style::TextTransform::Uppercase) => text.to_uppercase(),
        Some(we_style::TextTransform::Lowercase) => text.to_lowercase(),
        Some(we_style::TextTransform::Capitalize) => {
            let mut out = String::with_capacity(text.len());
            for (i, w) in text.split(' ').enumerate() {
                if i > 0 {
                    out.push(' ');
                }
                let mut ch = w.chars();
                if let Some(c) = ch.next() {
                    out.extend(c.to_uppercase());
                }
                out.push_str(ch.as_str());
            }
            out
        }
        _ if uppercase_prop => text.to_uppercase(),
        _ => text.to_string(),
    }
}

/// The text colour: style's `color`, else the parent's (egui's text colour
/// is the inheritance stand-in — WE inherits `color` the same way).
pub(crate) fn text_color(style: &Style, ctx: &egui::Context) -> egui::Color32 {
    style
        .text
        .color
        .map(color32)
        .unwrap_or_else(|| ctx.global_style().visuals.text_color())
}

/// `style`'s composed `opacity` folded into a colour's alpha — the fold
/// `text_job` gives galleys, for the glyph/label sites that paint through
/// `painter().text` directly (`paint.rs` already composed the ancestor
/// product into `style.paint.opacity`, the CSS group rule).
pub(crate) fn faded(style: &Style, c: egui::Color32) -> egui::Color32 {
    c.gamma_multiply(style.paint.opacity.unwrap_or(1.0).clamp(0.0, 1.0))
}

/// A prop value as a `Dimension` — `we-*` prop syntax: `"12px"`, `"0.5"`, a
/// bare number. `None` = absent or not a length.
pub(crate) fn dim_of(v: &Value) -> Option<Dimension> {
    match v {
        Value::Num(n) => Some(Dimension::Px(*n as f32)),
        Value::Str(s) => we_style::eval_dimension(s),
        _ => None,
    }
}

/// `dim_of` on a named prop.
pub(crate) fn dim_prop(node: &ResolvedNode, key: &str) -> Option<Dimension> {
    node.props.get(key).and_then(dim_of)
}

/// A `--we-*` token's computed text as a colour — `tokens_of` holds the
/// frame's table (stashed by `store_view`). `var()`s inside the value are
/// substituted first, then `eval_color` parses the result.
pub(crate) fn token_color(ctx: &egui::Context, name: &str) -> Option<egui::Color32> {
    let tokens = crate::defaults::tokens_of(ctx)?;
    let raw = tokens.get(name)?;
    let resolved = tokens.substitute(raw);
    we_style::eval_color(&resolved).map(color32)
}

/// A `--we-role-{role}` colour — how a widget prop that names a role
/// (`ringColor: "border-strong"`) resolves against the frame's theme.
pub(crate) fn role_color(ctx: &egui::Context, role: &str) -> Option<egui::Color32> {
    token_color(ctx, &format!("--we-role-{role}"))
}

/// A `--we-*` token's value as px — `--we-avatar-size-md` → 40.
pub(crate) fn token_px(
    ctx: &egui::Context,
    name: &str,
    font_px: f32,
    root_px: f32,
    viewport: Size,
) -> Option<f32> {
    let tokens = crate::defaults::tokens_of(ctx)?;
    let raw = tokens.get(name)?;
    let resolved = tokens.substitute(raw);
    we_style::eval_dimension(&resolved).and_then(|d| d.to_px(font_px, root_px, viewport))
}

/// The port of `seededHue`/`seededFill` in `shared/seededColor.ts`: FNV-1a
/// over UTF-16 code units quantized to twelve hues, then the theme's own
/// 100/700 ramp steps at that hue — the pair `initialsFill` sets. `None`
/// without a token table (the ramp's lightness/saturation come from it).
pub(crate) fn seeded_fill(
    ctx: &egui::Context,
    seed: &str,
) -> Option<(egui::Color32, egui::Color32)> {
    let tokens = crate::defaults::tokens_of(ctx)?;
    let num = |name: &str, dflt: f32| -> f32 {
        tokens
            .get(name)
            .and_then(|v| tokens.substitute(v).parse::<f32>().ok())
            .unwrap_or(dflt)
    };
    let sat = num("--we-color-saturation", 97.0) / 100.0;
    // FNV-1a, `Math.imul` semantics — the same hash, twelve buckets.
    let mut h: u32 = 0x811c9dc5;
    for u in seed.encode_utf16() {
        h ^= u as u32;
        h = h.wrapping_mul(0x01000193);
    }
    let hue = (h % 12) as f32 * 30.0;
    let step = |lightness: f32| -> Option<egui::Color32> {
        let chroma = sat * 0.18 * 2.0 * lightness.min(1.0 - lightness).max(0.0);
        we_style::eval_color(&format!("oklch({lightness} {chroma} {hue})")).map(color32)
    };
    let bg = step(num("--we-color-lightness-100", 0.925))?;
    let fg = step(num("--we-color-lightness-700", 0.42))?;
    Some((bg, fg))
}

/// The accent colour: style's `bg` when a solid variant set it, else the
/// tone's `solid` var, else `bg` — used for rings, badges and counts.
#[allow(dead_code)]
pub(crate) fn accent_color(style: &Style, ctx: &egui::Context) -> egui::Color32 {
    tone_color(
        style,
        "solid",
        style
            .paint
            .bg
            .map(color32)
            .unwrap_or_else(|| ctx.global_style().visuals.text_color()),
    )
}

/// `{detail: <obj>}` built from an already-assembled detail map.
pub(crate) fn detail_obj(detail: IndexMap<std::sync::Arc<str>, Value>) -> Value {
    Value::Obj(std::sync::Arc::new(IndexMap::from([(
        std::sync::Arc::from("detail"),
        Value::Obj(std::sync::Arc::new(detail)),
    )])))
}

/// `tone` → a pair of style-prop names the token tables give every tone
/// (`text`/`soft`/`solid`/`border`) — `tone="danger"` reads `danger-*`.
/// Returns `None` for no tone.
#[allow(dead_code)]
pub(crate) fn tone_tokens(style: &Style) -> Option<&str> {
    style.tone.as_ref().map(|t| t.name.as_ref())
}

/// Look a `tone`-scoped colour up through the node's own resolved vars —
/// `Tone.vars` holds the re-pointed accent roles, already substituted to the
/// tone family (`--we-role-accent-soft` is `danger-soft` under `tone:
/// danger`). `kind` is `soft`/`solid`/`border`/`text` — the accent suffix,
/// `solid` naming the bare `--we-role-accent`.
pub(crate) fn tone_color(style: &Style, kind: &str, fallback: egui::Color32) -> egui::Color32 {
    let owned;
    let key = match kind {
        "solid" => "--we-role-accent",
        kind => {
            owned = format!("--we-role-accent-{kind}");
            owned.as_str()
        }
    };
    // The element's custom-property scope — its own `tone`'s re-pointings or
    // an ancestor's, inherited the way the DOM's `var(--we-role-accent)`
    // would see them.
    if let Some(v) = style.scope.get(key) {
        if let Some(c) = we_style::eval_color(v) {
            return color32(c);
        }
    }
    fallback
}

/// A widget-owned scratch slot inside `EditState.data[node]`'s object —
/// `"_x"`-prefixed keys are renderer-private (templates never write them).
pub(crate) fn scratch<'a>(
    data: &'a std::collections::HashMap<NodeId, Value>,
    node: &NodeId,
    key: &str,
) -> Option<&'a Value> {
    match data.get(node) {
        Some(Value::Obj(o)) => o.get(key),
        _ => None,
    }
}

/// Set `key` on `data[node]`'s scratch object (creating it).
pub(crate) fn scratch_set(
    data: &mut std::collections::HashMap<NodeId, Value>,
    node: &NodeId,
    key: &str,
    v: Value,
) {
    let mut map = match data.get(node) {
        Some(Value::Obj(o)) => (**o).clone(),
        _ => IndexMap::new(),
    };
    map.insert(std::sync::Arc::from(key), v);
    data.insert(node.clone(), Value::Obj(std::sync::Arc::new(map)));
}

/// `{detail: {…}}` — the CustomEvent payload shape WE handlers read.
pub(crate) fn detail(fields: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    let mut detail = IndexMap::new();
    for (k, v) in fields {
        detail.insert(std::sync::Arc::from(k), v);
    }
    Value::Obj(std::sync::Arc::new(IndexMap::from([(
        std::sync::Arc::from("detail"),
        Value::Obj(std::sync::Arc::new(detail)),
    )])))
}

/// A `we-*` node's `data-we-id` — forwarded onto the AccessKit node as part
/// of its label when present (tests + editors find nodes by it).
#[allow(dead_code)]
pub(crate) fn we_id(node: &ResolvedNode) -> Option<String> {
    prop_str(node, "data-we-id").map(|s| s.to_string())
}

/// Label + hover glue: set the AccessKit label `cx` style.
#[allow(dead_code)]
pub(crate) fn label(cx: &mut PaintCx, rect: egui::Rect, text: &str) {
    cx.label(rect, text);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The CSS cyclic-percentage fallback zeroes a `calc`'s *percent*
    /// term and keeps the rest — layout's `lp` resolves it against base
    /// `0`. `Layout::bases` reports a content-driven (indefinite) base
    /// as `None`; paint must apply the same fallback, not drop the
    /// whole value.
    #[test]
    fn content_rect_indefinite_base_keeps_calc_fixed_terms() {
        let edge = || {
            Some(Dimension::Calc(we_style::Calc {
                percent: 0.1,
                px: 16.0,
                ..Default::default()
            }))
        };
        let mut style = Style::default();
        style.layout.padding = Edges {
            top: edge(),
            right: edge(),
            bottom: edge(),
            left: edge(),
        };
        let r = content_rect(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0)),
            &style,
            crate::defaults::ViewportCx::default(),
            None, // a content-driven containing block — the cyclic rule
        );
        assert_eq!(
            r.min.x, 16.0,
            "cyclic calc padding keeps its 16px term (percent → 0), got {r:?}"
        );
        assert_eq!(r.width(), 200.0 - 32.0, "both sides inset 16px");
    }

    /// `inset dx dy` geometry: a `+1 +1` layer uncovers the top and left
    /// inner edges, a `-1 -1` the bottom and right — the L a diagonal
    /// offset leaves.
    #[test]
    fn inset_strips_offset_leaves_the_lit_edges() {
        let rect = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(80.0, 28.0));
        let InsetStrips::Strips([top, bottom, left, right]) =
            inset_strips(rect, rect.translate(egui::vec2(1.0, 1.0)))
        else {
            panic!("a +1/+1 shape still intersects the box");
        };
        assert_eq!(
            top,
            Some(egui::Rect::from_min_max(
                egui::pos2(0.0, 0.0),
                egui::pos2(80.0, 1.0)
            ))
        );
        assert_eq!(bottom, None);
        assert_eq!(
            left,
            Some(egui::Rect::from_min_max(
                egui::pos2(0.0, 1.0),
                egui::pos2(1.0, 28.0)
            ))
        );
        assert_eq!(right, None);
        let InsetStrips::Strips([top, bottom, left, right]) =
            inset_strips(rect, rect.translate(egui::vec2(-1.0, -1.0)))
        else {
            panic!("a -1/-1 shape still intersects the box");
        };
        assert_eq!(top, None);
        assert_eq!(
            bottom,
            Some(egui::Rect::from_min_max(
                egui::pos2(0.0, 27.0),
                egui::pos2(80.0, 28.0)
            ))
        );
        assert_eq!(left, None);
        assert_eq!(
            right,
            Some(egui::Rect::from_min_max(
                egui::pos2(79.0, 0.0),
                egui::pos2(80.0, 27.0)
            ))
        );
        // A shape that misses the box entirely covers it.
        assert!(matches!(
            inset_strips(rect, rect.translate(egui::vec2(500.0, 0.0))),
            InsetStrips::Covers
        ));
    }

    /// A node's style under a built-in theme — the stylesheet's rules
    /// applied, as the frame resolves it.
    fn themed_style(ty: &str, theme: &'static str) -> Style {
        let node = we_template::ResolvedNode {
            id: we_template::NodeId::from("n"),
            ty: std::sync::Arc::from(ty),
            props: Default::default(),
            handlers: Default::default(),
            slot: None,
            children: vec![],
            transition: None,
        };
        let mut scx = we_layout::defaults::StyleCx::empty();
        scx.theme = theme;
        we_layout::defaults::style_of(&node, &scx)
    }

    /// The theme's own four layers (retro's `we-button::part(base)`) resolve to
    /// the Win95 face: the light layers land on the top/left strips, the
    /// dark on bottom/right — and the `:active` list reverses the pairing.
    #[test]
    fn retro_bevel_layers_light_top_left_dark_bottom_right() {
        let rect = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(80.0, 28.0));
        let view = crate::defaults::ViewportCx::default();
        let button = themed_style("we-button", "retro");
        for s in button.paint.shadows.as_deref().unwrap() {
            let d = egui::vec2(
                s.dx.to_px(view.font_px, view.root_px, view.viewport)
                    .unwrap_or(0.0),
                s.dy.to_px(view.font_px, view.root_px, view.viewport)
                    .unwrap_or(0.0),
            );
            let InsetStrips::Strips([top, bottom, left, right]) =
                inset_strips(rect, rect.translate(d))
            else {
                panic!("every bevel layer leaves strips, got Covers for {s:?}");
            };
            // `grey` (128) is the dark pair's second edge — it goes with
            // the negative offsets below.
            let light = s.color.is_some_and(|c| color32(c).r() > 128);
            if light {
                assert!(top.is_some() && left.is_some(), "light layer {s:?}");
                assert!(bottom.is_none() && right.is_none(), "light layer {s:?}");
            } else {
                assert!(bottom.is_some() && right.is_some(), "dark layer {s:?}");
                assert!(top.is_none() && left.is_none(), "dark layer {s:?}");
            }
        }
        // The pressed swap: the same colours on opposite edges.
        let pressed = button.with_state(we_style::StateKind::Active);
        for s in pressed.paint.shadows.as_deref().unwrap() {
            let d = egui::vec2(
                s.dx.to_px(view.font_px, view.root_px, view.viewport)
                    .unwrap_or(0.0),
                s.dy.to_px(view.font_px, view.root_px, view.viewport)
                    .unwrap_or(0.0),
            );
            let InsetStrips::Strips([top, bottom, left, right]) =
                inset_strips(rect, rect.translate(d))
            else {
                panic!("every pressed layer leaves strips, got Covers for {s:?}");
            };
            let light = s.color.is_some_and(|c| color32(c).r() > 128);
            if light {
                assert!(bottom.is_some() && right.is_some(), "pressed light {s:?}");
            } else {
                assert!(top.is_some() && left.is_some(), "pressed dark {s:?}");
            }
        }
    }

    /// The cyberpunk button slab — `clip_points` resolves its `px`/`%`/
    /// `calc()` mix against the border box: `-15px 0%` overhangs left,
    /// `calc(100% + 15px)` right, the bottom edge cuts to `(20px, h)`.
    #[test]
    fn clip_points_resolves_the_button_slab() {
        let mut style = Style::default();
        style.paint.clip = themed_style("we-button", "cyberpunk").paint.clip;
        let rect = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(120.0, 36.0));
        let points = clip_points(&style, rect, crate::defaults::ViewportCx::default()).unwrap();
        let expect = [
            (-15.0, 0.0),
            (135.0, 0.0),
            (135.0, 36.0),
            (20.0, 36.0),
            (-15.0, 1.0),
        ];
        assert_eq!(points.len(), expect.len());
        for (p, (x, y)) in points.iter().zip(expect) {
            assert!(
                (p.x - x).abs() < 0.01 && (p.y - y).abs() < 0.01,
                "want ({x},{y}), got {p:?}"
            );
        }
        // `clip-path: none` (the hover swap) resolves to no points.
        let mut style = Style::default();
        style.paint.clip = Some(we_style::ClipPath::None);
        assert!(clip_points(&style, rect, crate::defaults::ViewportCx::default()).is_none());
    }

    /// `triangulate` ear-clips: the mesh covers exactly the polygon —
    /// the button slab's cut corner stays unpainted (the web's clip
    /// does the same), and the concave input notch isn't filled over
    /// the way epaint's convex fan would fill it.
    #[test]
    fn triangulate_covers_the_polygon_and_not_the_cut_corner() {
        let tri_area = |a: egui::Pos2, b: egui::Pos2, c: egui::Pos2| {
            ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)).abs() * 0.5
        };
        let in_tri = |p: egui::Pos2, a: egui::Pos2, b: egui::Pos2, c: egui::Pos2| {
            let whole = tri_area(a, b, c);
            let parts = tri_area(p, b, c) + tri_area(a, p, c) + tri_area(a, b, p);
            whole > 1e-6 && (whole - parts).abs() < 1e-3
        };
        let shoelace = |pts: &[egui::Pos2]| {
            (0..pts.len())
                .map(|i| {
                    let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
                    a.x * b.y - b.x * a.y
                })
                .sum::<f32>()
                .abs()
                * 0.5
        };

        // The button slab on a 120×36 box, resolved above.
        let slab = [
            egui::pos2(-15.0, 0.0),
            egui::pos2(135.0, 0.0),
            egui::pos2(135.0, 36.0),
            egui::pos2(20.0, 36.0),
            egui::pos2(-15.0, 1.0),
        ];
        let tris = triangulate(&slab);
        assert_eq!(tris.len(), (slab.len() - 2) * 3);
        let covered: f32 = tris
            .chunks(3)
            .map(|t| {
                tri_area(
                    slab[t[0] as usize],
                    slab[t[1] as usize],
                    slab[t[2] as usize],
                )
            })
            .sum();
        assert!(
            (covered - shoelace(&slab)).abs() < 0.01,
            "mesh covers the polygon: {covered} vs {}",
            shoelace(&slab)
        );
        // The cut corner — inside the element's border box but outside
        // the clip — is covered by no triangle: left unpainted.
        let cut = egui::pos2(10.0, 34.0);
        assert!(
            !tris.chunks(3).any(|t| in_tri(
                cut,
                slab[t[0] as usize],
                slab[t[1] as usize],
                slab[t[2] as usize]
            )),
            "the bottom-left cut corner must stay unpainted"
        );

        // The concave input notch — a convex fan would span the 60%/80%
        // dips; every ear-clipped triangle's centroid stays inside.
        let notch = [
            egui::pos2(0.0, 5.0),
            egui::pos2(5.0, 0.0),
            egui::pos2(115.0, 0.0),
            egui::pos2(120.0, 5.0),
            egui::pos2(200.0, 5.0),
            egui::pos2(200.0, 55.0),
            egui::pos2(195.0, 57.0),
            egui::pos2(157.0, 57.0),
            egui::pos2(155.0, 60.0),
            egui::pos2(0.0, 60.0),
        ];
        let tris = triangulate(&notch);
        assert_eq!(tris.len(), (notch.len() - 2) * 3);
        let covered: f32 = tris
            .chunks(3)
            .map(|t| {
                tri_area(
                    notch[t[0] as usize],
                    notch[t[1] as usize],
                    notch[t[2] as usize],
                )
            })
            .sum();
        assert!(
            (covered - shoelace(&notch)).abs() < 0.01,
            "mesh covers the concave polygon: {covered} vs {}",
            shoelace(&notch)
        );
        // A point in the top notch (x=150, y=3 — under the 60% dip on
        // the left of the notch, above it nothing paints past x≈120)
        // stays unpainted.
        let dip = egui::pos2(150.0, 2.0);
        assert!(
            !tris.chunks(3).any(|t| in_tri(
                dip,
                notch[t[0] as usize],
                notch[t[1] as usize],
                notch[t[2] as usize]
            )),
            "the top notch must stay unpainted"
        );
    }
}
