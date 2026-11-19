//! Small feedback/display widgets: `we-tooltip`, `we-badge`, `we-tag`,
//! `we-alert`, `we-skeleton`, `we-divider`.

use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{view_of, ViewportCx};
use crate::props;
use crate::{
    Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, TextChildren, Widget,
    WidgetKind,
};

// ── we-tooltip ───────────────────────────────────────────────────────────

/// `we-tooltip` — the default slot is the trigger; `slot="content"` children
/// (or the `content` text prop) are the bubble, painted only on the overlay
/// layer while the tip is open. `open` is controlled; otherwise hover or
/// keyboard focus inside the trigger flips the internal flag — the walk
/// applies `mouseover`/`focusin` → show, `mouseout`/`focusout` → hide
/// post-children (tooltip.ts:234-249).
#[derive(Debug, Default)]
pub struct Tooltip;

impl Tooltip {
    /// `_hasSomethingToSay` — a `content` string or a `slot="content"` child.
    fn has_something_to_say(node: &ResolvedNode) -> bool {
        if props::prop_text(node, "content").is_some_and(|c| !c.is_empty()) {
            return true;
        }
        node.children.iter().any(|c| match c {
            we_template::ResolvedChild::Node(n) => n.slot.as_deref() == Some("content"),
            we_template::ResolvedChild::Text(_) => false,
        })
    }
}

/// `textContent` of the subtree — every descendant text child (the
/// trigger's words and a slotted bubble's alike), the way
/// `_describeTrigger` reads it.
fn subtree_text(node: &ResolvedNode) -> String {
    let mut s = String::new();
    for c in &node.children {
        match c {
            we_template::ResolvedChild::Text(t) => s.push_str(t),
            we_template::ResolvedChild::Node(n) => s.push_str(&subtree_text(n)),
        }
    }
    s
}

impl Widget for Tooltip {
    fn type_name(&self) -> &'static str {
        "we-tooltip"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Overlay
    }
    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        // `trigger` is the anchor; `slot="content"` children float.
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![PartSpec::group("trigger", Pick::Default, Direction::Column)],
        })
    }
    fn measure(&self, _cx: &MeasureCx, _n: &ResolvedNode, _s: &Style, _a: Size) -> Size {
        Size::ZERO
    }
    /// Hover or focus inside the trigger opens — gated on
    /// `_hasSomethingToSay`. The walk applies it post-children.
    fn focus_opens(&self, node: &ResolvedNode) -> bool {
        Self::has_something_to_say(node)
    }

    /// `_describeTrigger`: `content` first, the subtree's text after —
    /// what the slotted control carries as its accessible description.
    fn trigger_text(&self, node: &ResolvedNode) -> String {
        props::prop_text(node, "content")
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| subtree_text(node).trim().to_string())
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        // Overlay pass: the popup frame is drawn by `anchored_overlay`; the
        // `content` prop is the slot's fallback — paint it only when no
        // `slot="content"` child took over the bubble.
        if let Some(inner) = props::part(cx, node, "overlay") {
            let has_slot = node.children.iter().any(|c| match c {
                we_template::ResolvedChild::Node(n) => n.slot.as_deref() == Some("content"),
                we_template::ResolvedChild::Text(_) => false,
            });
            if !has_slot {
                if let Some(content) = props::prop_text(node, "content") {
                    cx.ui.painter().text(
                        inner.center(),
                        egui::Align2::CENTER_CENTER,
                        content,
                        egui::FontId::proportional(view_of(cx.ui.ctx()).metrics.font_px),
                        cx.ui.visuals().text_color(),
                    );
                }
            }
        }
        // In-flow pass paints nothing: the trigger is its slotted child,
        // and the hover/focus open rule runs post-children in the walk.
    }
}

// ── we-badge ─────────────────────────────────────────────────────────────

/// `we-badge` — a pill with `count`/text inside. Variant and size come
/// through `Style`; the pill reads `bg`/`color`/border from it.
#[derive(Debug, Default)]
pub struct Badge;

impl Badge {
    /// The pill's label — `count` (clamped at `max`) or text children.
    pub(crate) fn text(node: &ResolvedNode) -> String {
        if let Some(v) = node.props.get("count") {
            let max = props::prop_num(node, "max").unwrap_or(99.0);
            if let Value::Num(n) = v {
                if *n > max {
                    return format!("{max:.0}+");
                }
                return format!("{}", *n as i64);
            }
            return v.js_string();
        }
        props::text_of(node)
    }
}

impl Widget for Badge {
    fn type_name(&self) -> &'static str {
        "we-badge"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    /// Text-only children are the pill's galley (badge.ts renders `<slot>`);
    /// with element children the text runs stay spans.
    fn text_children(&self, node: &ResolvedNode) -> TextChildren {
        if props::has_node_children(node) {
            TextChildren::Leaves
        } else {
            TextChildren::Owned
        }
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // The content box is the galley — layout adds the padding outside it.
        crate::text::text_job(&Self::text(node), style, cx.ctx, avail.x, true, None).size()
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        crate::containers::paint_container(cx, node, style, rect);
        let content = props::content_rect(rect, style, view_of(cx.ui.ctx()), cx.cb_w);
        let text = Self::text(node);
        // The pill's galley is its own content — the absorbed child text or
        // prop-supplied text; under `Leaves` the span paints it instead.
        let own = !matches!(self.text_children(node), TextChildren::Leaves)
            || node.props.contains_key("count")
            || props::prop_text(node, "text").is_some()
            || props::prop_text(node, "label").is_some()
            || props::prop_text(node, "value").is_some();
        if !text.is_empty() && own {
            let g = crate::text::text_job(&text, style, cx.ui.ctx(), content.width(), true, None);
            // The galley centers in the pill's content box.
            let pos = content.center() - g.size() / 2.0;
            crate::text::paint_galley(cx.ui.painter(), pos, g, style);
        }
        cx.label(rect, &text);
    }
}

// ── we-tag ───────────────────────────────────────────────────────────────

/// `we-tag` — a soft pill; `dismissible` adds an `×` that emits `onDismiss`.
#[derive(Debug, Default)]
pub struct Tag;

impl Tag {
    fn text(node: &ResolvedNode) -> String {
        props::text_of(node)
    }
}

impl Widget for Tag {
    fn type_name(&self) -> &'static str {
        "we-tag"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    /// Children (the default slot, `text` in TS) lay out inside the row;
    /// `dismissible` adds its × as a fixed trailing part — the same shape
    /// the shadow DOM's `<slot>` + dismiss button take.
    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec> {
        // Text-only children are the galley `measure` sizes: a content
        // group of no nodes would measure zero and clip the label to "…".
        if node.children.is_empty() || !props::has_node_children(node) {
            return None;
        }
        let mut parts = vec![PartSpec::group("content", Pick::Default, Direction::Row)];
        if props::prop_bool(node, "dismissible") {
            parts.push(PartSpec::fixed("dismiss", 12.0, 12.0));
        }
        Some(PartsSpec {
            direction: Direction::Row,
            parts,
        })
    }
    /// Text-only children are the pill's galley (tag.ts renders `<slot>`);
    /// with element children the text runs stay spans.
    fn text_children(&self, node: &ResolvedNode) -> TextChildren {
        if props::has_node_children(node) {
            TextChildren::Leaves
        } else {
            TextChildren::Owned
        }
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        let mut s =
            crate::text::text_job(&Self::text(node), style, cx.ctx, avail.x, true, None).size();
        // The × sits beside the label inside the content box; the padding
        // itself lands outside (layout adds it).
        s.x += if props::prop_bool(node, "dismissible") {
            14.0
        } else {
            0.0
        };
        s
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        crate::containers::paint_container(cx, node, style, rect);
        let content = props::content_rect(rect, style, view_of(cx.ui.ctx()), cx.cb_w);
        let text = Self::text(node);
        // The tag's galley is its own content — the absorbed child text or
        // prop-supplied text; under `Leaves` the span paints it instead.
        let own = !matches!(self.text_children(node), TextChildren::Leaves)
            || props::prop_text(node, "text").is_some()
            || props::prop_text(node, "label").is_some()
            || props::prop_text(node, "value").is_some();
        let g = (own && !text.is_empty())
            .then(|| crate::text::text_job(&text, style, cx.ui.ctx(), content.width(), true, None));
        let dismissible = props::prop_bool(node, "dismissible");
        // Text + optional × centered as a pair inside the content box.
        let gw = g.as_ref().map(|g| g.size().x).unwrap_or(0.0);
        let left = content.center().x - (gw + if dismissible { 14.0 } else { 0.0 }) / 2.0;
        let gy = content.center().y - g.as_ref().map(|g| g.size().y).unwrap_or(0.0) / 2.0;
        if let Some(g) = g {
            crate::text::paint_galley(cx.ui.painter(), egui::pos2(left, gy), g, style);
        }
        if dismissible {
            let x_rect = props::part(cx, node, "dismiss").unwrap_or_else(|| {
                Rect::from_center_size(
                    egui::pos2(left + gw + 8.0 + 5.0, content.center().y),
                    egui::vec2(12.0, 12.0),
                )
            });
            let resp = cx.ui.interact(
                x_rect,
                cx.ui.scope_id().with(("we-tag-x", node.id.as_str())),
                egui::Sense::click(),
            );
            resp.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::Button, true, "dismiss".to_string())
            });
            let col = if resp.hovered() {
                props::text_color(style, cx.ui.ctx())
            } else {
                cx.ui.visuals().weak_text_color()
            };
            cx.ui.painter().text(
                x_rect.center(),
                egui::Align2::CENTER_CENTER,
                crate::media::phosphor("x").unwrap_or("x"),
                egui::FontId::new(10.0, egui::FontFamily::Proportional),
                col,
            );
            if resp.clicked() {
                cx.emit(&node.id, "onDismiss", props::detail([]));
            }
        }
        cx.label(rect, &text);
    }
}

// ── we-alert ─────────────────────────────────────────────────────────────

/// `we-alert` — a tone-colored banner: tone icon + title text + children,
/// `dismissible` draws an `×` emitting `onDismiss`. Warning/danger alerts
/// announce (AccessKit role `Alert`).
#[derive(Debug, Default)]
pub struct Alert;

/// The tone icon's slot — alert.ts renders `<we-icon size="20px">`.
const ICON_PX: f32 = 20.0;

impl Alert {
    fn icon_for(node: &ResolvedNode) -> &str {
        if let Some(i) = props::prop_str(node, "icon").filter(|i| !i.is_empty()) {
            return i;
        }
        // ALERT_TONE_ICONS — `x-circle` for danger, the rest per status.
        match props::prop_str(node, "tone").unwrap_or("accent") {
            "warning" => "warning",
            "danger" => "x-circle",
            "success" => "check-circle",
            _ => "info",
        }
    }

    /// The icon → text gap — the DS default's `gap` (space-300).
    fn gap(style: &Style, view: ViewportCx) -> f32 {
        style
            .layout
            .gap
            .and_then(|(_, col)| props::px(Some(&col), &view.metrics, view.viewport))
            .unwrap_or(8.0)
    }

    /// The icon's slot in the row — glyph + the gap before the text.
    fn icon_w(style: &Style, view: ViewportCx) -> f32 {
        ICON_PX + Self::gap(style, view)
    }
}

impl Widget for Alert {
    fn type_name(&self) -> &'static str {
        "we-alert"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    /// The shadow DOM's shape: icon, a `flex: 1` content slot, the dismiss
    /// button. Children lay out beside the icon instead of under it — a
    /// `text`-prop alert (the leaf case) keeps the measure/paint path below.
    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec> {
        if node.children.is_empty() {
            return None;
        }
        let mut parts = vec![
            PartSpec::fixed("icon", ICON_PX, ICON_PX),
            PartSpec::group("content", Pick::Default, Direction::Column).growing(1.0),
        ];
        if props::prop_bool(node, "dismissible") {
            parts.push(PartSpec::fixed("dismiss", 14.0, 14.0));
        }
        Some(PartsSpec {
            direction: Direction::Row,
            parts,
        })
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // Children lay out in the parts row — the leaf case is the
        // `text`-prop banner, whose content is the tone icon + wrapped text.
        if !node.children.is_empty() {
            return Size::ZERO;
        }
        let Some(text) = props::prop_text(node, "text") else {
            return Size::ZERO;
        };
        let view = view_of(cx.ctx);
        let icon_w = Self::icon_w(style, view);
        let g = crate::text::text_job(
            text,
            style,
            cx.ctx,
            (avail.x - icon_w).max(1.0),
            false,
            None,
        );
        Size::new(icon_w + g.size().x, g.size().y.max(ICON_PX))
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        crate::containers::paint_container(cx, node, style, rect);
        // The tone icon and the text sit inside the content box — the same
        // inset layout keeps outside the measured content — with the icon's
        // 6px floor; children flow in their `content` part instead.
        let content = props::content_rect(rect, style, view, cx.cb_w);
        let pad = (content.min.x - rect.min.x).max(6.0);
        let icon_rect = props::part(cx, node, "icon").unwrap_or_else(|| {
            Rect::from_min_size(
                egui::pos2(rect.min.x + pad, content.min.y),
                egui::vec2(ICON_PX, ICON_PX),
            )
        });
        // `soft` tints the icon like the text; `edge` paints it in the
        // tone's own colour (alert.ts's iconColor).
        let color = if props::prop_str(node, "variant") == Some("edge") {
            props::tone_color(style, "solid", props::text_color(style, cx.ui.ctx()))
        } else {
            props::text_color(style, cx.ui.ctx())
        };
        if let Some(glyph) = crate::media::phosphor(Self::icon_for(node)) {
            cx.ui.painter().text(
                icon_rect.center(),
                egui::Align2::CENTER_CENTER,
                glyph,
                egui::FontId::new(ICON_PX, egui::FontFamily::Proportional),
                color,
            );
        }
        // The `text` prop paints beside the icon — the leaf case, since any
        // child (the web component's slot) flows in the `content` part.
        if node.children.is_empty() {
            if let Some(text) = props::prop_text(node, "text") {
                let gap = icon_rect.max.x + Self::gap(style, view);
                let right = content.max.x
                    - if props::prop_bool(node, "dismissible") {
                        18.0
                    } else {
                        0.0
                    };
                let wrap_w = (right - gap).max(1.0);
                let g = crate::text::text_job(text, style, cx.ui.ctx(), wrap_w, false, None);
                crate::text::paint_galley(
                    cx.ui.painter(),
                    egui::pos2(gap, content.min.y),
                    g,
                    style,
                );
            }
        }
        // Dismiss × at the row's end — its own part when children flow, the
        // banner's top-right corner in the leaf case.
        if props::prop_bool(node, "dismissible") {
            let x = props::part(cx, node, "dismiss").unwrap_or_else(|| {
                Rect::from_center_size(
                    egui::pos2(rect.max.x - 10.0, rect.min.y + 10.0),
                    egui::vec2(14.0, 14.0),
                )
            });
            let resp = cx.ui.interact(
                x,
                cx.ui.scope_id().with(("we-alert-x", node.id.as_str())),
                egui::Sense::click(),
            );
            resp.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::Button, true, "dismiss".to_string())
            });
            cx.ui.painter().text(
                x.center(),
                egui::Align2::CENTER_CENTER,
                crate::media::phosphor("x").unwrap_or("x"),
                egui::FontId::new(10.0, egui::FontFamily::Proportional),
                props::text_color(style, cx.ui.ctx()),
            );
            if resp.clicked() {
                cx.emit(&node.id, "onDismiss", props::detail([]));
            }
        }
        let label = props::text_of(node);
        cx.label(rect, &format!("alert {label}"));
    }
}

// ── we-skeleton ──────────────────────────────────────────────────────────

/// `we-skeleton` — a shimmering placeholder bar/block. `variant` is
/// `line`/`circle`/`block`; `animation` toggles the pulse. The shimmer is a
/// travelling highlight on the frame clock, `respect-reduced-motion` the
/// bundle can't query — it always animates when asked.
#[derive(Debug, Default)]
pub struct Skeleton;

impl Widget for Skeleton {
    fn type_name(&self) -> &'static str {
        "we-skeleton"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, _avail: Size) -> Size {
        let view = view_of(cx.ctx);
        match props::prop_str(node, "variant").unwrap_or("line") {
            "circle" => {
                let s = props::dim_prop(node, "size")
                    .or(style.layout.height)
                    .or(style.layout.width)
                    .and_then(|d| d.to_px(&view.metrics, view.viewport))
                    .unwrap_or(40.0);
                Size::new(s, s)
            }
            "block" => Size::new(
                // 0 on the stretched axis — layout leaves it `auto` so the
                // parent's `align-items` stretches it (see `resolved_node`).
                0.0,
                props::dim_prop(node, "height")
                    .or(style.layout.height)
                    .and_then(|d| d.to_px(&view.metrics, view.viewport))
                    .unwrap_or(60.0),
            ),
            // A line stretches (the web component's default is a 100%×20px
            // bar) — 0 on the stretched axis like `block` above.
            _ => Size::new(
                0.0,
                props::dim_prop(node, "height")
                    .or(style.layout.height)
                    .and_then(|d| d.to_px(&view.metrics, view.viewport))
                    .unwrap_or(20.0),
            ),
        }
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        let variant = props::prop_str(node, "variant").unwrap_or("line");
        let r = match variant {
            "circle" => rect.height() / 2.0,
            "block" => props::radius_px(&style.paint.radius, rect, &view.metrics, view.viewport),
            _ => (rect.height() / 2.0).min(4.0),
        };
        let base = style
            .paint
            .bg
            .map(props::color32)
            .unwrap_or_else(|| cx.ui.visuals().widgets.noninteractive.bg_fill);
        cx.ui.painter().rect_filled(rect, r, base);
        let animated = !matches!(
            props::prop_str(node, "animation"),
            Some("none") | Some("false")
        );
        if animated {
            // A highlight band sweeping left→right every ~1.4s.
            let phase = (cx.now % 1.4) / 1.4;
            let w = rect.width();
            let cxr = rect.min.x + w * (phase as f32 * 1.6 - 0.3);
            let band = Rect::from_min_max(
                egui::pos2(cxr - w * 0.15, rect.min.y),
                egui::pos2(cxr + w * 0.15, rect.max.y),
            );
            let p = cx.ui.painter().with_clip_rect(rect);
            p.rect_filled(
                band.intersect(rect),
                r,
                egui::Color32::WHITE.gamma_multiply(0.10),
            );
            cx.ui.ctx().request_repaint();
        }
        cx.label(rect, "loading placeholder");
    }
}

// ── we-divider ───────────────────────────────────────────────────────────

/// `we-divider` — `orientation` × `variant` (solid/dashed/dotted) ×
/// `color`/`thickness`.
#[derive(Debug, Default)]
pub struct Divider;

impl Widget for Divider {
    fn type_name(&self) -> &'static str {
        "we-divider"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _s: &Style, avail: Size) -> Size {
        let view = view_of(cx.ctx);
        let t = props::dim_prop(node, "thickness")
            .and_then(|d| d.to_px(&view.metrics, view.viewport))
            .unwrap_or(1.0);
        let _ = avail;
        if props::prop_str(node, "orientation") == Some("vertical") {
            Size::new(t, 0.0)
        } else {
            Size::new(0.0, t)
        }
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        let color = props::prop_str(node, "color")
            .and_then(we_style::eval_color)
            .map(props::color32)
            .or_else(|| style.paint.border_color.map(props::color32))
            .or_else(|| {
                style
                    .paint
                    .borders
                    .top
                    .as_ref()
                    .and_then(|s| s.color)
                    .map(props::color32)
            })
            .unwrap_or_else(|| cx.ui.visuals().widgets.noninteractive.bg_stroke.color);
        let t = props::dim_prop(node, "thickness")
            .and_then(|d| d.to_px(&view.metrics, view.viewport))
            .unwrap_or(1.0);
        let vertical = props::prop_str(node, "orientation") == Some("vertical");
        // The line is the element's content — it sits inside the padding.
        let content = props::content_rect(rect, style, view, cx.cb_w);
        let (a, b) = if vertical {
            (
                egui::pos2(content.center().x, content.min.y),
                egui::pos2(content.center().x, content.max.y),
            )
        } else {
            (
                egui::pos2(content.min.x, content.center().y),
                egui::pos2(content.max.x, content.center().y),
            )
        };
        match props::prop_str(node, "variant").unwrap_or("solid") {
            "dashed" => dashed(cx.ui.painter(), a, b, t, color, 6.0, 4.0),
            "dotted" => dashed(cx.ui.painter(), a, b, t, color, t * 1.6, t * 1.6),
            _ => {
                cx.ui
                    .painter()
                    .line_segment([a, b], egui::Stroke::new(t, color));
            }
        }
        cx.label(rect, "divider");
    }
}

/// A dashed/dotted line as clipped segments.
fn dashed(
    p: &egui::Painter,
    a: egui::Pos2,
    b: egui::Pos2,
    t: f32,
    color: egui::Color32,
    on: f32,
    off: f32,
) {
    let dir = b - a;
    let len = dir.length();
    if len <= 0.0 {
        return;
    }
    let unit = dir / len;
    let mut d = 0.0;
    while d < len {
        let seg = (d + on).min(len);
        p.line_segment([a + unit * d, a + unit * seg], egui::Stroke::new(t, color));
        d += on + off;
    }
}
