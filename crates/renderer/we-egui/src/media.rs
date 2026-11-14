//! Media widgets: `we-icon`, `we-image`, `we-avatar`, `AvatarStack`,
//! `we-animated-icon` — plus `data:`-URI decoding into `ImageSource::Bytes`.
use std::sync::Arc;

use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{view_of, FONT_PX, ROOT_PX};
use crate::props;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

mod icon_names;

/// `phosphor_glyph` for sibling modules (alert's tone icons, tree carets).
pub(crate) use icon_names::phosphor_glyph as phosphor;

/// Install the fonts and loaders the media widgets need: the three Phosphor
/// variants (`regular` also rides along as a proportional-text fallback)
/// and egui_extras' image loader set (http/https/file/bytes, gif included).
/// Idempotent — `frame_body` calls it every frame; only the first installs.
/// `data:` URIs are decoded by `image_source` straight into
/// `ImageSource::Bytes`, no custom loader needed.
pub fn install(ctx: &egui::Context) {
    const INSTALLED: &str = "we-egui::media-installed";
    if ctx.data_mut(|d| d.get_temp::<bool>(egui::Id::unique(INSTALLED))) == Some(true) {
        return;
    }
    let mut fonts = egui::FontDefinitions::default();
    egui_phosphor::add_to_fonts(&mut fonts, egui_phosphor::Variant::Regular);
    egui_phosphor::add_font_bytes_as_family(
        &mut fonts,
        "phosphor-bold",
        egui_phosphor::Variant::Bold.font_bytes(),
    );
    egui_phosphor::add_font_bytes_as_family(
        &mut fonts,
        "phosphor-fill",
        egui_phosphor::Variant::Fill.font_bytes(),
    );
    ctx.set_fonts(fonts);
    egui_extras::install_image_loaders(ctx);
    ctx.data_mut(|d| d.insert_temp(egui::Id::unique(INSTALLED), true));
}

/// A node's `src` → the source egui loads. `data:*;base64,…` decodes inline
/// into `Bytes` (egui_extras' loaders don't cover `data:`); everything else
/// rides the `Uri` path.
fn image_source(uri: &str) -> egui::ImageSource<'static> {
    if let Some((meta, payload)) = uri.strip_prefix("data:").and_then(|r| r.split_once(',')) {
        use base64::Engine as _;
        let bytes = if meta.contains(";base64") {
            base64::engine::general_purpose::STANDARD
                .decode(payload.trim())
                .unwrap_or_default()
        } else {
            unescape(payload).into_bytes()
        };
        if !bytes.is_empty() {
            return egui::ImageSource::Bytes {
                uri: uri.to_string().into(),
                bytes: bytes.into(),
            };
        }
    }
    egui::ImageSource::Uri(uri.to_string().into())
}

/// `%XX` unescape for non-base64 data URIs (svg payloads ride them).
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let h = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
            if let (Some(hi), Some(lo)) = (h(b[i + 1]), h(b[i + 2])) {
                out.push((hi * 16 + lo) as char);
                i += 3;
                continue;
            }
        }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

// ── we-icon ──────────────────────────────────────────────────────────────

/// `we-icon` — one Phosphor glyph. `name` (kebab-case) → codepoint; `size` /
/// `weight` / `color` pick font size, variant and colour. Unknown names draw
/// a `?` slot — the red unknown box is only for unknown *types*.
#[derive(Debug, Default)]
pub struct Icon;

impl Icon {
    fn size_px(node: &ResolvedNode, style: &Style, viewport: we_style::Size) -> f32 {
        if let Some(v) = node.props.get("size") {
            if let Some(d) = props::dim_of(v) {
                if let Some(px) = d.to_px(FONT_PX, ROOT_PX, viewport) {
                    return px;
                }
            }
            match v {
                Value::Num(n) => return *n as f32,
                Value::Str(s) => {
                    if let Ok(n) = s.parse::<f64>() {
                        return n as f32;
                    }
                }
                _ => {}
            }
        }
        style
            .text
            .font_size
            .and_then(|d| d.to_px(FONT_PX, ROOT_PX, viewport))
            .unwrap_or(16.0)
    }

    fn family(node: &ResolvedNode) -> egui::FontFamily {
        match props::prop_str(node, "weight") {
            Some("bold") => egui::FontFamily::Name("phosphor-bold".into()),
            Some("fill") => egui::FontFamily::Name("phosphor-fill".into()),
            _ => egui::FontFamily::Proportional, // regular is a text fallback
        }
    }
}

impl Widget for Icon {
    fn type_name(&self) -> &'static str {
        "we-icon"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, _avail: Size) -> Size {
        let s = Self::size_px(node, style, view_of(cx.ctx).viewport);
        Size::new(s, s)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        let size = Self::size_px(node, style, view.viewport);
        let name = props::prop_str(node, "name").unwrap_or("");
        let color = props::prop_str(node, "color")
            .and_then(we_style::eval_color)
            .map(props::color32)
            .unwrap_or_else(|| props::text_color(style, cx.ui.ctx()));
        cx.ui.painter().text(
            props::content_rect(rect, style, FONT_PX, ROOT_PX, view, cx.cb_w).center(),
            egui::Align2::CENTER_CENTER,
            icon_names::phosphor_glyph(name).unwrap_or("?"),
            egui::FontId::new(size, Self::family(node)),
            color,
        );
        cx.label(rect, &format!("icon {name}"));
    }
}

// ── we-image ─────────────────────────────────────────────────────────────

/// `we-image` — `src` + `fit`/`objectFit`, `r` rounding, `alt` (the
/// AccessKit label). http(s)/file/bytes/`data:` through egui's loaders.
#[derive(Debug, Default)]
pub struct Image;

impl Image {
    /// Which fit the node asks for — `fit` prop first, then `objectFit`.
    fn fit_mode(node: &ResolvedNode) -> &str {
        props::prop_str(node, "fit")
            .or_else(|| props::prop_str(node, "objectFit"))
            .unwrap_or("cover")
    }
}

impl Widget for Image {
    fn type_name(&self) -> &'static str {
        "we-image"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        let view = view_of(cx.ctx);
        let w = props::dim_prop(node, "width")
            .or(style.layout.width)
            .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
            .unwrap_or(avail.x.min(64.0));
        let h = props::dim_prop(node, "height")
            .or(style.layout.height)
            .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
            .unwrap_or(w);
        Size::new(w, h)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        let src = props::prop_text(node, "src").unwrap_or("");
        let alt = props::prop_text(node, "alt").unwrap_or(src);
        let r = props::radius_px(&style.paint.radius, rect, FONT_PX, ROOT_PX, view.viewport);
        // The image is the element's content — it paints inside the padding.
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view, cx.cb_w);
        if src.is_empty() {
            // A broken img: bordered slot + alt text, as the browser draws.
            cx.ui.painter().rect_stroke(
                content,
                r,
                egui::Stroke::new(1.0, cx.ui.visuals().weak_text_color()),
                egui::StrokeKind::Inside,
            );
            cx.label(rect, alt);
            return;
        }
        let mut img = egui::Image::new(image_source(src)).alt_text(alt);
        img = match Self::fit_mode(node) {
            // `cover` rides fit_to_exact_size + the slot's clip (egui has no
            // uv-crop on an unloaded image) — noted as the E5a approximation.
            "cover" | "fill" => img.fit_to_exact_size(content.size()),
            "none" | "scale-down" => img.fit_to_original_size(1.0).max_size(content.size()),
            _ => img
                .fit_to_exact_size(content.size())
                .maintain_aspect_ratio(true), // contain
        };
        // `corner_radius` does `r`'s clip for us — a clipped child ui painted
        // nothing anyway (`UiBuilder::invisible` fades the painter out).
        img = img.corner_radius(egui::CornerRadius::same(r.round() as u8));
        img.paint_at(cx.ui, content);
        cx.label(rect, alt);
    }
}

// ── we-avatar ────────────────────────────────────────────────────────────

/// `we-avatar` — an image or initials in a rounded slot. `initials` shows
/// when `url` is empty; `ring`/`ringWidth` paint an accent ring.
#[derive(Debug, Default)]
pub struct Avatar;

impl Avatar {
    pub(crate) fn size_px(node: &ResolvedNode) -> f32 {
        props::prop_num(node, "size").unwrap_or(40.0) as f32
    }

    pub(crate) fn initials(node: &ResolvedNode) -> String {
        if let Some(s) = props::prop_str(node, "initials") {
            return s.chars().take(3).collect();
        }
        let name = props::prop_text(node, "name")
            .or_else(|| props::prop_text(node, "label"))
            .unwrap_or("");
        let parts: Vec<&str> = name.split_whitespace().collect();
        let s: String = match parts.as_slice() {
            [] => "?".to_string(),
            [one] => one.chars().take(2).collect(),
            many => format!(
                "{}{}",
                many.first().unwrap().chars().next().unwrap_or('?'),
                many.last().unwrap().chars().next().unwrap_or('?')
            ),
        };
        s.to_uppercase()
    }

    /// Paint one avatar slot — shared with AvatarStack.
    pub(crate) fn paint_one(
        ui: &mut egui::Ui,
        _node: &ResolvedNode,
        style: &Style,
        rect: Rect,
        url: Option<&str>,
        label: &str,
        ring: Option<f32>,
    ) {
        let view = view_of(ui.ctx());
        let r = props::radius_px(&style.paint.radius, rect, FONT_PX, ROOT_PX, view.viewport);
        let bg = style
            .paint
            .bg
            .map(props::color32)
            .unwrap_or_else(|| ui.visuals().widgets.noninteractive.bg_fill);
        let p = ui.painter().with_clip_rect(rect);
        p.rect_filled(rect, r, bg);
        match url.filter(|u| !u.is_empty()) {
            Some(u) => {
                egui::Image::new(image_source(u))
                    .fit_to_exact_size(rect.size())
                    .corner_radius(egui::CornerRadius::same(r.round() as u8))
                    .show_loading_spinner(false)
                    .paint_at(ui, rect);
            }
            None => {
                let fs = (rect.height() * 0.38).clamp(8.0, 24.0);
                p.text(
                    rect.center(),
                    egui::Align2::CENTER_CENTER,
                    label,
                    egui::FontId::new(fs, egui::FontFamily::Proportional),
                    props::text_color(style, ui.ctx()),
                );
            }
        }
        if let Some(ring_w) = ring.filter(|w| *w > 0.0) {
            p.rect_stroke(
                rect.shrink(ring_w * 0.5),
                r,
                egui::Stroke::new(ring_w, props::accent_color(style, ui.ctx())),
                egui::StrokeKind::Inside,
            );
        }
    }
}

impl Widget for Avatar {
    fn type_name(&self) -> &'static str {
        "we-avatar"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _a: Size) -> Size {
        let s = Self::size_px(node);
        Size::new(s, s)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let ring = if props::prop_bool(node, "ring") {
            Some(props::prop_num(node, "ringWidth").unwrap_or(2.0) as f32)
        } else {
            props::prop_num(node, "ringWidth").map(|w| w as f32)
        };
        Self::paint_one(
            cx.ui,
            node,
            style,
            // The avatar is the element's content — inside the padding.
            props::content_rect(rect, style, FONT_PX, ROOT_PX, view_of(cx.ui.ctx()), cx.cb_w),
            props::prop_text(node, "url"),
            &Self::initials(node),
            ring,
        );
        cx.label(rect, &Self::initials(node));
    }
}

// ── AvatarStack ──────────────────────────────────────────────────────────

/// `AvatarStack` — dedup'd avatars overlapping in a row, a `+N` counter past
/// `max`. `size`/`overlap`/`ringWidth`/`edge` shape it; a click emits
/// `onClick` with `{id}`.
#[derive(Debug, Default)]
pub struct AvatarStack;

/// One entry's (id, label, url) from the `avatars` list.
fn stack_entry(v: &Value, ix: usize) -> (String, String, Option<String>) {
    if let Value::Obj(o) = v {
        let id = o
            .get("id")
            .map(|v| v.js_string())
            .unwrap_or_else(|| format!("avatar-{ix}"));
        let label = o
            .get("label")
            .or_else(|| o.get("name"))
            .map(|v| v.js_string())
            .unwrap_or_else(|| id.clone());
        let url = o
            .get("url")
            .or_else(|| o.get("src"))
            .map(|v| v.js_string())
            .filter(|s| !s.is_empty());
        (id, label, url)
    } else {
        (v.js_string(), v.js_string(), None)
    }
}

impl AvatarStack {
    /// Dedup'd entries, in order.
    fn entries(node: &ResolvedNode) -> Vec<(String, String, Option<String>)> {
        let mut seen = std::collections::BTreeSet::new();
        let mut out = Vec::new();
        if let Some(list) = props::prop_list(node, "avatars") {
            for (i, v) in list.iter().enumerate() {
                let e = stack_entry(v, i);
                if seen.insert(e.0.clone()) {
                    out.push(e);
                }
            }
        }
        out
    }
}

impl Widget for AvatarStack {
    fn type_name(&self) -> &'static str {
        "AvatarStack"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _a: Size) -> Size {
        let size = props::prop_num(node, "size").unwrap_or(32.0) as f32;
        let max = props::prop_num(node, "max").unwrap_or(5.0) as usize;
        let overlap = props::prop_num(node, "overlap").unwrap_or(0.35) as f32;
        let n = Self::entries(node).len();
        let slots = n.min(max) + usize::from(n > max);
        let w = if slots == 0 {
            size
        } else {
            size + (slots - 1) as f32 * size * (1.0 - overlap)
        };
        Size::new(w, size)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let content =
            props::content_rect(rect, style, FONT_PX, ROOT_PX, view_of(cx.ui.ctx()), cx.cb_w);
        let size = content.height();
        let max = props::prop_num(node, "max").unwrap_or(5.0) as usize;
        let overlap = props::prop_num(node, "overlap").unwrap_or(0.35) as f32;
        let ring = props::prop_num(node, "ringWidth").unwrap_or(2.0) as f32;
        let step = size * (1.0 - overlap);
        let entries = Self::entries(node);
        let extra = entries.len().saturating_sub(max);
        let slots = entries.len().min(max) + usize::from(extra > 0);
        let end_edge = props::prop_str(node, "edge") == Some("end");
        // Slots run from `content.min.x`; `edge="end"` packs them at the right.
        let x0 = if end_edge {
            content.max.x - size - (slots.saturating_sub(1)) as f32 * step
        } else {
            content.min.x
        };
        // The slot glyph is the label's initials — the full name stays the
        // AccessKit label and the click payload.
        let initials_of = |label: &str| -> String {
            label
                .split_whitespace()
                .filter_map(|w| w.chars().next())
                .take(2)
                .collect::<String>()
                .to_uppercase()
        };
        for (i, (id, label, url)) in entries.iter().take(max).enumerate() {
            let slot = Rect::from_min_size(
                egui::pos2(x0 + i as f32 * step, content.min.y),
                egui::vec2(size, size),
            );
            let resp = cx.ui.interact(
                slot,
                cx.ui
                    .scope_id()
                    .with(("we-avatar-stack", node.id.as_str(), i)),
                egui::Sense::click(),
            );
            resp.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::Button, true, label.to_string())
            });
            if resp.clicked() {
                let mut m = indexmap::IndexMap::new();
                m.insert(Arc::from("id"), Value::Str(Arc::from(id.as_str())));
                cx.emit(&node.id, "onClick", props::detail_obj(m));
            }
            Avatar::paint_one(
                cx.ui,
                node,
                style,
                slot,
                url.as_deref(),
                &initials_of(label),
                Some(ring),
            );
        }
        if extra > 0 {
            let x = x0 + entries.len().min(max) as f32 * step;
            let slot = Rect::from_min_size(egui::pos2(x, content.min.y), egui::vec2(size, size));
            let p = cx.ui.painter();
            p.circle_filled(
                slot.center(),
                size / 2.0,
                cx.ui.visuals().widgets.noninteractive.bg_fill,
            );
            p.circle_stroke(
                slot.center(),
                (size / 2.0 - ring * 0.5).max(0.0),
                egui::Stroke::new(ring, props::accent_color(style, cx.ui.ctx())),
            );
            p.text(
                slot.center(),
                egui::Align2::CENTER_CENTER,
                format!("+{extra}"),
                egui::FontId::new(size * 0.32, egui::FontFamily::Proportional),
                props::text_color(style, cx.ui.ctx()),
            );
            cx.label(slot, &format!("{extra} more"));
        }
        cx.label(rect, &format!("{} avatars", entries.len()));
    }
}

// ── we-animated-icon ─────────────────────────────────────────────────────

/// `we-animated-icon` — the bundle's animated state marker. `src` rides the
/// image loaders (a gif animates itself); a `name` draws a pulsing Phosphor
/// glyph on the frame clock.
#[derive(Debug, Default)]
pub struct AnimatedIcon;

impl Widget for AnimatedIcon {
    fn type_name(&self) -> &'static str {
        "we-animated-icon"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _a: Size) -> Size {
        let s = props::prop_num(node, "size").unwrap_or(20.0) as f32;
        Size::new(s, s)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let content =
            props::content_rect(rect, style, FONT_PX, ROOT_PX, view_of(cx.ui.ctx()), cx.cb_w);
        let size = content.height().min(content.width());
        let src = props::prop_text(node, "src").unwrap_or("");
        let name = props::prop_str(node, "name").unwrap_or("");
        if !src.is_empty() {
            egui::Image::new(image_source(src))
                .fit_to_exact_size(egui::vec2(size, size))
                .show_loading_spinner(false)
                .paint_at(
                    cx.ui,
                    egui::Rect::from_center_size(content.center(), egui::vec2(size, size)),
                );
        } else {
            // Pulse alpha at ~1.4Hz on the frame clock.
            let t = cx.now * std::f64::consts::TAU * 1.4;
            let alpha = (0.6 + 0.4 * (t.sin() as f32 * 0.5 + 0.5)).clamp(0.0, 1.0);
            let color = props::text_color(style, cx.ui.ctx()).gamma_multiply(alpha);
            cx.ui.painter().text(
                content.center(),
                egui::Align2::CENTER_CENTER,
                icon_names::phosphor_glyph(if name.is_empty() {
                    "circle-notch"
                } else {
                    name
                })
                .unwrap_or("◌"),
                egui::FontId::new(size * 0.85, Icon::family(node)),
                color,
            );
            cx.ui.ctx().request_repaint();
        }
        cx.label(
            rect,
            &format!(
                "animated icon {}",
                if name.is_empty() { "loading" } else { name }
            ),
        );
    }
}
