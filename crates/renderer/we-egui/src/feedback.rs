//! Small feedback/display widgets: `we-tooltip`, `we-badge`, `we-tag`,
//! `we-alert`, `we-skeleton`, `we-divider`.

use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{view_of, FONT_PX, ROOT_PX};
use crate::props;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

// ── we-tooltip ───────────────────────────────────────────────────────────

/// `we-tooltip` — a container whose *children* are the trigger; `content` +
/// `placement` describe the tip. Hovering the trigger's box shows the tip in
/// an egui tooltip window at the requested edge.
#[derive(Debug, Default)]
pub struct Tooltip;

impl Widget for Tooltip {
    fn type_name(&self) -> &'static str {
        "we-tooltip"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    fn measure(&self, _cx: &MeasureCx, _n: &ResolvedNode, _s: &Style, _a: Size) -> Size {
        Size::ZERO
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        crate::containers::paint_container(cx, node, style, rect);
        let content = props::prop_text(node, "content").unwrap_or("");
        if content.is_empty() {
            return;
        }
        let id = cx.ui.scope_id().with(("we-tooltip", node.id.as_str()));
        let resp = cx.ui.interact(rect, id, egui::Sense::hover());
        if !resp.hovered() {
            return;
        }
        // The tip grows away from the edge it anchors to (`placement`).
        let (pivot, at) = match props::prop_str(node, "placement").unwrap_or("top") {
            "bottom" => (
                egui::Align2::CENTER_TOP,
                rect.center_bottom() + egui::vec2(0.0, 6.0),
            ),
            "left" => (
                egui::Align2::RIGHT_CENTER,
                rect.left_center() + egui::vec2(-6.0, 0.0),
            ),
            "right" => (
                egui::Align2::LEFT_CENTER,
                rect.right_center() + egui::vec2(6.0, 0.0),
            ),
            _ => (
                egui::Align2::CENTER_BOTTOM,
                rect.center_top() + egui::vec2(0.0, -6.0),
            ),
        };
        egui::Area::new(egui::Id::unique(("we-tip", node.id.as_str())))
            .order(egui::Order::Foreground)
            .pivot(pivot)
            .fixed_pos(at)
            .show(cx.ui.ctx(), |ui| {
                egui::Frame::popup(ui.style()).show(ui, |ui| {
                    ui.label(content);
                });
            });
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
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // The content box is the galley — layout adds the padding outside it.
        crate::text::text_job(&Self::text(node), style, cx.ctx, avail.x, true, None).size()
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        crate::containers::paint_container(cx, node, style, rect);
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view_of(cx.ui.ctx()));
        let text = Self::text(node);
        let g = crate::text::text_job(&text, style, cx.ui.ctx(), content.width(), true, None);
        // The galley centers in the pill's content box.
        let pos = content.center() - g.size() / 2.0;
        cx.ui
            .painter()
            .add(egui::Shape::galley(pos, g, egui::Color32::PLACEHOLDER));
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
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view_of(cx.ui.ctx()));
        let text = Self::text(node);
        let g = crate::text::text_job(&text, style, cx.ui.ctx(), content.width(), true, None);
        let dismissible = props::prop_bool(node, "dismissible");
        // Text + optional × centered as a pair inside the content box.
        let left = content.center().x - (g.size().x + if dismissible { 14.0 } else { 0.0 }) / 2.0;
        let gy = content.center().y - g.size().y / 2.0;
        let gw = g.size().x;
        cx.ui.painter().add(egui::Shape::galley(
            egui::pos2(left, gy),
            g,
            egui::Color32::PLACEHOLDER,
        ));
        if dismissible {
            let x_rect = Rect::from_center_size(
                egui::pos2(left + gw + 8.0 + 5.0, content.center().y),
                egui::vec2(12.0, 12.0),
            );
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
    fn gap(style: &Style, viewport: we_style::Size) -> f32 {
        style
            .layout
            .gap
            .and_then(|(_, col)| props::px(Some(&col), FONT_PX, ROOT_PX, viewport))
            .unwrap_or(8.0)
    }

    /// The icon's slot in the row — glyph + the gap before the text.
    fn icon_w(style: &Style, viewport: we_style::Size) -> f32 {
        16.0 + Self::gap(style, viewport)
    }
}

impl Widget for Alert {
    fn type_name(&self) -> &'static str {
        "we-alert"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // Real node children flow themselves — the leaf case is the
        // `text`-prop banner, whose content is the tone icon + wrapped text.
        let has_children = node
            .children
            .iter()
            .any(|c| matches!(c, we_template::ResolvedChild::Node(_)));
        let Some(text) = props::prop_text(node, "text").filter(|_| !has_children) else {
            return Size::ZERO;
        };
        let view = view_of(cx.ctx);
        let icon_w = Self::icon_w(style, view.viewport);
        let g = crate::text::text_job(
            text,
            style,
            cx.ctx,
            (avail.x - icon_w).max(1.0),
            false,
            None,
        );
        Size::new(icon_w + g.size().x, g.size().y.max(16.0))
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        crate::containers::paint_container(cx, node, style, rect);
        // The tone icon and the text sit inside the content box — the same
        // inset layout keeps outside the measured content — with the icon's
        // 6px floor; children flow after it.
        let icon_size = 16.0;
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view);
        let pad = (content.min.x - rect.min.x).max(6.0);
        let icon_rect = Rect::from_min_size(
            egui::pos2(rect.min.x + pad, content.min.y),
            egui::vec2(icon_size, icon_size),
        );
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
                egui::FontId::new(icon_size, egui::FontFamily::Proportional),
                color,
            );
        }
        // The `text` prop paints beside the icon; real node children flow.
        let has_children = node
            .children
            .iter()
            .any(|c| matches!(c, we_template::ResolvedChild::Node(_)));
        if !has_children {
            if let Some(text) = props::prop_text(node, "text") {
                let gap = icon_rect.max.x + Self::gap(style, view.viewport);
                let right = content.max.x
                    - if props::prop_bool(node, "dismissible") {
                        18.0
                    } else {
                        0.0
                    };
                let wrap_w = (right - gap).max(1.0);
                let g = crate::text::text_job(text, style, cx.ui.ctx(), wrap_w, false, None);
                cx.ui.painter().galley(
                    egui::pos2(gap, content.min.y),
                    g,
                    props::text_color(style, cx.ui.ctx()),
                );
            }
        }
        // Dismiss × at top-right.
        if props::prop_bool(node, "dismissible") {
            let x = Rect::from_center_size(
                egui::pos2(rect.max.x - 10.0, rect.min.y + 10.0),
                egui::vec2(14.0, 14.0),
            );
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
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        let view = view_of(cx.ctx);
        match props::prop_str(node, "variant").unwrap_or("line") {
            "circle" => {
                let s = props::dim_prop(node, "size")
                    .or(style.layout.height)
                    .or(style.layout.width)
                    .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
                    .unwrap_or(40.0);
                Size::new(s, s)
            }
            "block" => Size::new(
                // 0 on the stretched axis — layout leaves it `auto` so the
                // parent's `align-items` stretches it (see `resolved_node`).
                0.0,
                props::dim_prop(node, "height")
                    .or(style.layout.height)
                    .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
                    .unwrap_or(60.0),
            ),
            _ => Size::new(
                avail.x.min(200.0),
                props::dim_prop(node, "height")
                    .or(style.layout.height)
                    .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
                    .unwrap_or(14.0),
            ),
        }
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        let variant = props::prop_str(node, "variant").unwrap_or("line");
        let r = match variant {
            "circle" => rect.height() / 2.0,
            "block" => props::radius_px(&style.paint.radius, rect, FONT_PX, ROOT_PX, view.viewport),
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
            .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
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
            .and_then(|d| d.to_px(FONT_PX, ROOT_PX, view.viewport))
            .unwrap_or(1.0);
        let vertical = props::prop_str(node, "orientation") == Some("vertical");
        // The line is the element's content — it sits inside the padding.
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view);
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
