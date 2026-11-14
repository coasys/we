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

/// The display text: `text`, then `label`, then `value`, then concatenated
/// text children — what the primitives render in that order.
pub(crate) fn text_of(node: &ResolvedNode) -> String {
    for key in ["text", "label", "value"] {
        if let Some(s) = prop_text(node, key) {
            return s.to_string();
        }
    }
    node.children
        .iter()
        .filter_map(|c| match c {
            we_template::ResolvedChild::Text(t) => Some(t.as_ref()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
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

/// `Style::with_state` for the response's state — disabled beats active
/// beats hover, the CSS order.
pub(crate) fn state_style<'a>(
    style: &'a Style,
    response: &egui::Response,
    disabled: bool,
) -> std::borrow::Cow<'a, Style> {
    if disabled {
        return match &style.disabled {
            Some(p) => patched(style, p),
            None => std::borrow::Cow::Borrowed(style),
        };
    }
    if response.is_pointer_button_down_on() {
        if let Some(p) = &style.active {
            return patched(style, p);
        }
    }
    if response.hovered() {
        if let Some(p) = &style.hover {
            return patched(style, p);
        }
    }
    std::borrow::Cow::Borrowed(style)
}

/// The pre-tier style with a state patch applied — `Style::with_state`
/// without the Option dance.
fn patched<'a>(style: &'a Style, patch: &StylePatch) -> std::borrow::Cow<'a, Style> {
    let mut out = style.pretier.as_deref().unwrap_or(style).clone();
    out.apply(patch);
    std::borrow::Cow::Owned(out)
}

/// An inset edge (`padding`/`border` width) in px — `Percent` (and the
/// percent term of a `calc()`) resolves against `base`, the containing
/// block's content width — CSS puts every edge's percentage on the CB
/// *width*. `base` is `None` when layout found it content-driven (the
/// CSS cyclic fallback — the term resolves to `0`). `ch`/`ex`/`lh` take
/// `layout::dim_px`'s font-metric approximations so paint agrees with
/// the space taffy offered measure — the shared `Dimension::resolve`
/// policy.
fn inset_px(
    d: &Option<Dimension>,
    font_px: f32,
    root_px: f32,
    view: crate::defaults::ViewportCx,
    base: Option<f32>,
) -> f32 {
    match d.as_ref() {
        Some(d) => d
            .resolve(base, font_px, root_px, view.viewport)
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
    font_px: f32,
    root_px: f32,
    view: crate::defaults::ViewportCx,
    base: Option<f32>,
) -> egui::Rect {
    let pad = &style.layout.padding;
    let bor = &style.paint.borders;
    let p = |d: &Option<Dimension>| inset_px(d, font_px, root_px, view, base);
    let bw = |s: &Option<we_style::BorderSide>| border_side_px(s, font_px, root_px, view.viewport);
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
    font_px: f32,
    root_px: f32,
    viewport: Size,
) {
    let opacity = style.paint.opacity.unwrap_or(1.0).clamp(0.0, 1.0);
    let fade = |c: egui::Color32| c.gamma_multiply(opacity);
    let radius = radius_px(&style.paint.radius, rect, font_px, root_px, viewport);

    // Shadows under the box: egui has shadows only as widgets; paint a soft
    // offset rect per layer (inset shadows are skipped — noted in NOTES).
    if let Some(shadows) = &style.paint.shadows {
        for s in shadows {
            if s.inset {
                continue;
            }
            let dx = s.dx.to_px(font_px, root_px, viewport).unwrap_or(0.0);
            let dy = s.dy.to_px(font_px, root_px, viewport).unwrap_or(0.0);
            let spread = s
                .spread
                .and_then(|d| d.to_px(font_px, root_px, viewport))
                .unwrap_or(0.0);
            let blur = s
                .blur
                .and_then(|d| d.to_px(font_px, root_px, viewport))
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
            .and_then(|d| d.to_px(font_px, root_px, viewport))
            .unwrap_or(3.0); // CSS `medium`
        if width <= 0.0 {
            continue;
        }
        let color = side.color.map(color32).unwrap_or(current_color);
        let (a, b) = match edge {
            egui::Align2::CENTER_TOP => (rect.left_top(), rect.right_top()),
            egui::Align2::RIGHT_CENTER => (rect.right_top(), rect.right_bottom()),
            egui::Align2::CENTER_BOTTOM => (rect.right_bottom(), rect.left_bottom()),
            _ => (rect.left_bottom(), rect.left_top()),
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

/// A `FontId` for the style's text props — family resolves to Proportional
/// or Monospace; the WE stacks name fonts egui does not ship, so a stack
/// containing "mono" maps to `Monospace`, everything else `Proportional`.
pub(crate) fn font_id(style: &Style, font_px: f32, root_px: f32, viewport: Size) -> egui::FontId {
    let size = style
        .text
        .font_size
        .and_then(|d| d.to_px(font_px, root_px, viewport))
        .unwrap_or(font_px);
    let family = match style.text.font_family.as_deref() {
        Some(f) if f.contains("mono") || f.contains("Mono") => egui::FontFamily::Monospace,
        _ => egui::FontFamily::Proportional,
    };
    egui::FontId::new(size, family)
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

/// The accent colour: style's `bg` when a solid variant set it, else the
/// tone's `solid` var, else `bg` — used for rings, badges and counts.
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
