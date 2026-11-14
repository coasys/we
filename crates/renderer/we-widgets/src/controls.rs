//! `we-button` — the one control in the E5a batch. Inputs/menus are E5b.
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{view_of, FONT_PX, ROOT_PX};
use crate::props;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

/// `we-button` — variant + size come through `Style`; `disabled`, `loading`,
/// `square`, `href`, `expanded`, `label` are widget props. Children (icon +
/// text nodes) flow inside its row layout. Clicks emit `onClick` with
/// `{detail:{}}`; a `href` with no handler opens the URL.
#[derive(Debug, Default)]
pub struct Button;

impl Button {
    /// `square` collapses to the size-token square — layout already applied
    /// the size through `width`/`height`, so measure just answers it.
    fn measure_label(node: &ResolvedNode, style: &Style, ctx: &egui::Context, avail: f32) -> Size {
        let text = props::prop_text(node, "text")
            .map(str::to_string)
            .unwrap_or_else(|| props::text_of(node));
        let g = crate::text::text_job(&text, style, ctx, avail.max(1.0), true, None);
        g.size()
    }
}

impl Widget for Button {
    fn type_name(&self) -> &'static str {
        "we-button"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // Only the text child participates — a child node flows itself.
        let has_node_children = node
            .children
            .iter()
            .any(|c| matches!(c, we_template::ResolvedChild::Node(_)));
        if has_node_children {
            return Size::ZERO;
        }
        Self::measure_label(node, style, cx.ctx, avail.x)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        let disabled = props::prop_bool(node, "disabled") || props::prop_bool(node, "loading");
        let label = props::prop_text(node, "label")
            .or_else(|| props::prop_text(node, "text"))
            .map(str::to_string)
            .unwrap_or_else(|| props::text_of(node));
        let response = cx.interact_label(rect, &label, egui::Role::Button, &node.id, "base");
        // NOTE: `expanded` has no egui 0.37 WidgetInfo field — the disclosure
        // state reaches tests through the caret/children instead.
        let eff = props::state_style(style, &response, disabled);
        props::paint_box(
            cx.ui.painter(),
            rect,
            &eff,
            props::text_color(&eff, cx.ui.ctx()),
            FONT_PX,
            ROOT_PX,
            view.viewport,
        );
        // Prop-text buttons paint their label centered; node children are
        // painted by the walk inside the button's own row layout.
        let has_node_children = node
            .children
            .iter()
            .any(|c| matches!(c, we_template::ResolvedChild::Node(_)));
        if !has_node_children && !label.is_empty() {
            let g =
                crate::text::text_job(&label, &eff, cx.ui.ctx(), rect.width().max(1.0), true, None);
            cx.ui.painter().galley(
                egui::pos2(
                    rect.center().x - g.size().x / 2.0,
                    rect.center().y - g.size().y / 2.0,
                ),
                g,
                props::text_color(&eff, cx.ui.ctx()),
            );
        }
        // `loading` covers the content with a spinner — the primitive dims
        // the button and swaps the icon.
        if props::prop_bool(node, "loading") {
            let t = (cx.now * std::f64::consts::TAU * 1.6) as f32;
            let r = rect.height().min(rect.width()) * 0.32;
            let c = rect.center();
            let mut pts = Vec::with_capacity(13);
            for i in 0..12 {
                let a = t + i as f32 * (std::f32::consts::TAU / 12.0);
                pts.push(egui::pos2(c.x + a.cos() * r, c.y + a.sin() * r));
            }
            for (i, w) in pts.windows(2).enumerate() {
                let alpha = 0.15 + 0.85 * (i as f32 / 12.0);
                cx.ui.painter().line_segment(
                    [w[0], w[1]],
                    egui::Stroke::new(
                        1.6,
                        props::text_color(&eff, cx.ui.ctx()).gamma_multiply(alpha),
                    ),
                );
            }
            cx.ui.ctx().request_repaint();
        }
        if response.hovered() && !disabled {
            cx.ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        if response.clicked() && !disabled {
            let href = props::prop_text(node, "href").unwrap_or("");
            cx.emit(&node.id, "onClick", props::detail([]));
            if (href.starts_with("http://") || href.starts_with("https://"))
                && !node.handlers.contains_key("onClick")
            {
                cx.ui.ctx().open_url(egui::OpenUrl::new_tab(href));
            }
        }
    }
}
