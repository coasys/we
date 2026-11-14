//! Media widgets: `we-icon`, `we-image`, `we-avatar`, `AvatarStack`,
//! `we-animated-icon` — plus `data:`-URI decoding into `ImageSource::Bytes`.
use std::sync::Arc;

use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{tokens_of, view_of, ViewportCx, FONT_PX, ROOT_PX};
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
            props::content_rect(rect, style, FONT_PX, ROOT_PX, view).center(),
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
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view);
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

/// `we-avatar` — the TS primitive's four content branches in order:
/// `image` → derived `initials` → `hash` (a generated pattern — jdenticon in
/// the browser, a deterministic mirrored cell grid here) → `icon` (`user`).
/// `size` is the tier vocabulary (`--we-avatar-size-xxs` … `-xxl`) or a CSS
/// length; `ringColor`/`edgeColor`/`ringWidth` draw the inset bands
/// `avatarInnerRings` composes; `clickable` makes it a button.
#[derive(Debug, Default)]
pub struct Avatar;

/// The `avatarSize` tiers — `--we-avatar-size-{name}` in the token table,
/// with the recorded px fallbacks for a table that doesn't carry them.
const AVATAR_TIERS: &[(&str, f32)] = &[
    ("xxs", 16.0),
    ("xs", 24.0),
    ("sm", 32.0),
    ("md", 40.0),
    ("lg", 48.0),
    ("xl", 64.0),
    ("xxl", 80.0),
];

/// `AVATAR_TONE_ROLES`: the tone names `ringColor`/`edgeColor` remap through
/// `avatarToneColor`; `neutral` is `surface-inverse`.
fn tone_role(name: &str) -> Option<&'static str> {
    Some(match name {
        "success" => "success",
        "warning" => "warning",
        "danger" => "danger",
        "accent" => "accent",
        "neutral" => "surface-inverse",
        _ => return None,
    })
}

/// `ringColorOf`: a tone name reads as that tone's role colour; anything
/// else is a CSS colour — or, as a tolerated spelling, another role name
/// (`border-strong`), which the theme resolves the same way.
fn ring_color(ctx: &egui::Context, raw: &str) -> Option<egui::Color32> {
    if let Some(role) = tone_role(raw) {
        return props::role_color(ctx, role);
    }
    we_style::eval_color(raw)
        .map(props::color32)
        .or_else(|| props::role_color(ctx, raw))
}

/// The derived letters — `derivedInitials` in avatar.ts: first char of the
/// first word + first char of the last, uppercase; one word → one letter.
pub(crate) fn derive_initials(name: &str) -> String {
    let mut words = name.split_whitespace();
    let Some(first) = words.next() else {
        return String::new();
    };
    let mut chars = first.chars();
    let f = chars.next().unwrap_or_default();
    match words.last() {
        Some(last) => format!("{}{}", f, last.chars().next().unwrap_or_default()),
        None => f.to_string(),
    }
    .to_uppercase()
}

/// The face an avatar paints — image, letters, pattern or glyph.
pub(crate) enum Face<'a> {
    Image(&'a str),
    /// Letters + the `hash || initials` seed for the generated fill.
    Initials(String, &'a str),
    Hash(&'a str),
    Icon(&'a str),
}

/// `avatarInnerRings`, resolved: the edge band (outer, `edgeColor`) and the
/// ring band (just inside it, `ringColor`), both inset above the picture.
#[derive(Default)]
pub(crate) struct Rings {
    edge: Option<(egui::Color32, f32)>,
    ring: Option<(egui::Color32, f32)>,
}

impl Rings {
    fn resolve(
        ctx: &egui::Context,
        edge_raw: Option<&str>,
        ring_raw: Option<&str>,
        width_raw: Option<&str>,
        small: bool,
    ) -> Self {
        // `--we-avatar-{ring,edge}-width`: 2px, 1.5px on xxs/xs faces.
        let dflt = if small { 1.5 } else { 2.0 };
        let edge_w = dflt;
        let ring_w = width_raw
            .and_then(|w| we_style::eval_dimension(w))
            .and_then(|d| d.to_px(FONT_PX, ROOT_PX, we_style::Size::new(0.0, 0.0)))
            .unwrap_or(dflt);
        Self {
            edge: edge_raw
                .and_then(|c| ring_color(ctx, c))
                .map(|c| (c, edge_w)),
            ring: ring_raw
                .and_then(|c| ring_color(ctx, c))
                .map(|c| (c, ring_w)),
        }
    }

    /// The edge band paints first (the TS shadow list order), the ring sits
    /// inside it — a stroked rect shrunk by half its band width each.
    fn paint(&self, p: &egui::Painter, rect: Rect, radius: f32) {
        let r = egui::CornerRadius::same(radius.round() as u8);
        if let Some((c, w)) = self.edge {
            p.rect_stroke(
                rect.shrink(w * 0.5),
                r,
                egui::Stroke::new(w, c),
                egui::StrokeKind::Inside,
            );
        }
        if let Some((c, w)) = self.ring {
            let inset = self.edge.map(|(_, e)| e).unwrap_or(0.0) + w * 0.5;
            p.rect_stroke(
                rect.shrink(inset),
                r,
                egui::Stroke::new(w, c),
                egui::StrokeKind::Inside,
            );
        }
    }
}

/// The deterministic stand-in for `toSvg(hash)` (jdenticon): a 5×5
/// left-mirrored cell grid keyed by the hash's FNV-1a bits, in a seeded
/// saturated hue on the sunken disc. The contract it keeps — stable and
/// distinct per identity — is jdenticon's, the cell set is not.
fn paint_identicon(p: &egui::Painter, rect: Rect, hash: &str, ctx: &egui::Context) {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in hash.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    let side = rect.width() * 0.7; // svg { width: calc(size - 30%) }
    let top = rect.center() - egui::vec2(side * 0.5, side * 0.5);
    let cell = side / 5.0;
    let hue = (h % 12) as f32 * 30.0;
    let sat = tokens_of(ctx)
        .and_then(|t| {
            t.get("--we-color-saturation")
                .and_then(|v| t.substitute(v).parse::<f32>().ok())
        })
        .unwrap_or(97.0)
        / 100.0;
    let fg = we_style::eval_color(&format!("oklch(0.55 {} {hue})", sat * 0.18))
        .map(props::color32)
        .unwrap_or_else(|| ctx.global_style().visuals.text_color());
    for row in 0..5u64 {
        for col in 0..3u64 {
            if h >> (row * 3 + col + 9) & 1 == 0 {
                continue;
            }
            for c in [col, 4 - col] {
                let r = Rect::from_min_size(
                    top + egui::vec2(c as f32 * cell, row as f32 * cell),
                    egui::vec2(cell, cell),
                );
                p.rect_filled(r, 0.0, fg);
            }
        }
    }
}

impl Avatar {
    /// `size` — a tier name through `--we-avatar-size-{tier}`, a CSS length,
    /// or a bare number in px. Missing/unknown → `md`.
    pub(crate) fn size_px(node: &ResolvedNode, ctx: &egui::Context, view: ViewportCx) -> f32 {
        let tier = |name: &str| {
            AVATAR_TIERS
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, px)| {
                    props::token_px(
                        ctx,
                        &format!("--we-avatar-size-{name}"),
                        FONT_PX,
                        ROOT_PX,
                        view.viewport,
                    )
                    .unwrap_or(*px)
                })
        };
        match props::prop(node, "size") {
            Value::Str(s) => tier(s).unwrap_or_else(|| {
                props::dim_prop(node, "size")
                    .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
                    .unwrap_or_else(|| tier("md").unwrap_or(40.0))
            }),
            Value::Num(n) => *n as f32,
            _ => tier("md").unwrap_or(40.0),
        }
    }

    /// `image` is the picture prop; `url`/`src` are accepted spellings.
    pub(crate) fn image<'a>(node: &'a ResolvedNode) -> Option<&'a str> {
        props::prop_text(node, "image")
            .or_else(|| props::prop_text(node, "url"))
            .or_else(|| props::prop_text(node, "src"))
    }

    pub(crate) fn face<'a>(node: &'a ResolvedNode) -> Face<'a> {
        if let Some(u) = Self::image(node) {
            return Face::Image(u);
        }
        let initials = props::prop_text(node, "initials")
            .map(derive_initials)
            .unwrap_or_default();
        if !initials.is_empty() {
            // `seededFill(hash || initials)` — the seed is the stable id.
            let seed = props::prop_text(node, "hash")
                .or_else(|| props::prop_text(node, "initials"))
                .unwrap_or("");
            return Face::Initials(initials, seed);
        }
        if let Some(h) = props::prop_text(node, "hash") {
            return Face::Hash(h);
        }
        Face::Icon(props::prop_text(node, "icon").unwrap_or("user"))
    }

    /// Paint one avatar slot — shared with AvatarStack.
    pub(crate) fn paint_face(
        ui: &mut egui::Ui,
        style: &Style,
        rect: Rect,
        face: &Face,
        rings: &Rings,
    ) {
        let ctx = ui.ctx().clone();
        let view = view_of(&ctx);
        let r = props::radius_px(&style.paint.radius, rect, FONT_PX, ROOT_PX, view.viewport);
        let sunken = || {
            style
                .paint
                .bg
                .map(props::color32)
                .or_else(|| props::role_color(&ctx, "surface-sunken"))
                .unwrap_or_else(|| ui.visuals().widgets.noninteractive.bg_fill)
        };
        let p = ui.painter().with_clip_rect(rect);
        match face {
            // `has-image` drops the disc — a picture covers it entirely.
            Face::Image(u) => {
                egui::Image::new(image_source(u))
                    .fit_to_exact_size(rect.size())
                    .corner_radius(egui::CornerRadius::same(r.round() as u8))
                    .show_loading_spinner(false)
                    .paint_at(ui, rect);
            }
            Face::Initials(letters, seed) => {
                let (bg, fg) = props::seeded_fill(&ctx, seed)
                    .unwrap_or_else(|| (sunken(), props::text_color(style, &ctx)));
                p.rect_filled(rect, r, bg);
                // 0.4× the disc — 0.5× for a lone letter (the optical lift).
                let fs = rect.height()
                    * if letters.chars().count() == 1 {
                        0.5
                    } else {
                        0.4
                    };
                p.text(
                    rect.center(),
                    egui::Align2::CENTER_CENTER,
                    letters,
                    egui::FontId::new(fs, egui::FontFamily::Proportional),
                    fg,
                );
            }
            Face::Hash(h) => {
                p.rect_filled(rect, r, sunken());
                paint_identicon(&p, rect, h, &ctx);
            }
            Face::Icon(name) => {
                p.rect_filled(rect, r, sunken());
                p.text(
                    rect.center(),
                    egui::Align2::CENTER_CENTER,
                    icon_names::phosphor_glyph(name).unwrap_or("?"),
                    egui::FontId::new(rect.height() * 0.6, egui::FontFamily::Proportional),
                    props::text_color(style, &ctx),
                );
            }
        }
        rings.paint(&p, rect, r);
    }
}

impl Widget for Avatar {
    fn type_name(&self) -> &'static str {
        "we-avatar"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _a: Size) -> Size {
        let s = Self::size_px(node, cx.ctx, view_of(cx.ctx));
        Size::new(s, s)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let ctx = cx.ui.ctx().clone();
        let view = view_of(&ctx);
        let size = Self::size_px(node, &ctx, view);
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view);
        let width_raw = match props::prop(node, "ringWidth") {
            Value::Str(s) => Some(s.to_string()),
            Value::Num(n) => Some(n.to_string()),
            _ => None,
        };
        let rings = Rings::resolve(
            &ctx,
            props::prop_text(node, "edgeColor"),
            props::prop_text(node, "ringColor"),
            width_raw.as_deref(),
            size <= 24.0,
        );
        let face = Self::face(node);
        let label = match &face {
            Face::Initials(l, _) => l.to_string(),
            _ => props::prop_text(node, "label")
                .map(|s| s.to_string())
                .unwrap_or_else(|| "avatar".to_string()),
        };
        if props::prop_flag(node, "clickable") == Some(true) {
            let resp = cx.interact_label(
                content,
                &label,
                egui::Role::Button,
                &node.id,
                "avatar",
                true,
            );
            if resp.clicked() {
                cx.emit(&node.id, "onClick", props::detail([]));
            }
        } else {
            cx.label(rect, &label);
        }
        Self::paint_face(cx.ui, style, content, &face, &rings);
    }
}

// ── AvatarStack ──────────────────────────────────────────────────────────

/// `AvatarStack` — dedup'd avatars overlapping in a row, a `+N` counter past
/// `max`. Entries carry the same vocabulary `we-avatar` does (`image`,
/// `initials`, `hash`, `icon`); `size` takes the tier names too. `edgeColor`
/// paints the separation band the TS stack sets; a click emits `onClick`
/// with `{id}`.
#[derive(Debug, Default)]
pub struct AvatarStack;

/// One `avatars` entry — the id (or generated), the a11y label, and the
/// same content props `we-avatar` reads.
struct StackEntry {
    id: String,
    label: String,
    image: Option<String>,
    initials: Option<String>,
    hash: Option<String>,
    icon: Option<String>,
}

fn stack_entry(v: &Value, ix: usize) -> StackEntry {
    let get = |o: &indexmap::IndexMap<Arc<str>, Value>, keys: &[&str]| -> Option<String> {
        keys.iter()
            .find_map(|k| o.get(*k).map(|v| v.js_string()))
            .filter(|s| !s.is_empty())
    };
    if let Value::Obj(o) = v {
        let id = get(o, &["id"]).unwrap_or_else(|| format!("avatar-{ix}"));
        let label = get(o, &["label", "name", "initials"]).unwrap_or_else(|| id.clone());
        StackEntry {
            id,
            label,
            image: get(o, &["image", "url", "src"]),
            initials: get(o, &["initials", "name", "label"]),
            hash: get(o, &["hash"]),
            icon: get(o, &["icon"]),
        }
    } else {
        let s = v.js_string();
        StackEntry {
            id: s.clone(),
            label: s.clone(),
            image: None,
            initials: Some(s),
            hash: None,
            icon: None,
        }
    }
}

impl StackEntry {
    fn face(&self) -> Face<'_> {
        if let Some(u) = &self.image {
            return Face::Image(u);
        }
        let letters = self
            .initials
            .as_deref()
            .map(derive_initials)
            .unwrap_or_default();
        if !letters.is_empty() {
            return Face::Initials(
                letters,
                self.hash
                    .as_deref()
                    .or(self.initials.as_deref())
                    .unwrap_or(""),
            );
        }
        if let Some(h) = &self.hash {
            return Face::Hash(h);
        }
        Face::Icon(self.icon.as_deref().unwrap_or("user"))
    }
}

impl AvatarStack {
    /// Dedup'd entries, in order.
    fn entries(node: &ResolvedNode) -> Vec<StackEntry> {
        let mut seen = std::collections::BTreeSet::new();
        let mut out = Vec::new();
        if let Some(list) = props::prop_list(node, "avatars") {
            for (i, v) in list.iter().enumerate() {
                let e = stack_entry(v, i);
                if seen.insert(e.id.clone()) {
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
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _a: Size) -> Size {
        let size = Avatar::size_px(node, cx.ctx, view_of(cx.ctx));
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
        let ctx = cx.ui.ctx().clone();
        let view = view_of(&ctx);
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view);
        let size = content.height();
        let max = props::prop_num(node, "max").unwrap_or(5.0) as usize;
        let overlap = props::prop_num(node, "overlap").unwrap_or(0.35) as f32;
        let width_raw = match props::prop(node, "ringWidth") {
            Value::Str(s) => Some(s.to_string()),
            Value::Num(n) => Some(n.to_string()),
            _ => None,
        };
        // Every face wears the edge band — how overlapping faces stay apart —
        // defaulting to the surface behind (the stack's own job in TS); a
        // `ringColor` adds the inner band on top.
        let edge_raw = props::prop_text(node, "edgeColor").or(Some("surface"));
        let rings = Rings::resolve(
            &ctx,
            edge_raw,
            props::prop_text(node, "ringColor"),
            width_raw.as_deref(),
            size <= 24.0,
        );
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
        for (i, e) in entries.iter().take(max).enumerate() {
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
                egui::WidgetInfo::labeled(egui::Role::Button, true, e.label.clone())
            });
            if resp.clicked() {
                let mut m = indexmap::IndexMap::new();
                m.insert(Arc::from("id"), Value::Str(Arc::from(e.id.as_str())));
                cx.emit(&node.id, "onClick", props::detail_obj(m));
            }
            Avatar::paint_face(cx.ui, style, slot, &e.face(), &rings);
        }
        if extra > 0 {
            let x = x0 + entries.len().min(max) as f32 * step;
            let slot = Rect::from_min_size(egui::pos2(x, content.min.y), egui::vec2(size, size));
            let r = props::radius_px(&style.paint.radius, slot, FONT_PX, ROOT_PX, view.viewport);
            let p = cx.ui.painter().with_clip_rect(slot);
            p.rect_filled(
                slot,
                r,
                props::role_color(&ctx, "surface-sunken")
                    .unwrap_or_else(|| cx.ui.visuals().widgets.noninteractive.bg_fill),
            );
            rings.paint(&p, slot, r);
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
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view_of(cx.ui.ctx()));
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
