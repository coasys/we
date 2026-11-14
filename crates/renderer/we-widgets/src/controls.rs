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
    /// The content box's intrinsic size: the label galley, plus the spinner
    /// and its gap while `loading` (a square button has no room for the
    /// label — the spinner *is* the content there, same as button.ts).
    fn measure_label(node: &ResolvedNode, style: &Style, ctx: &egui::Context, avail: f32) -> Size {
        let text = props::prop_text(node, "label")
            .or_else(|| props::prop_text(node, "text"))
            .map(str::to_string)
            .unwrap_or_else(|| props::text_of(node));
        let loading = props::prop_bool(node, "loading");
        let square = props::prop_bool(node, "square");
        if loading && square {
            return Size::new(SPINNER + SPINNER, SPINNER + SPINNER);
        }
        let g = crate::text::text_job(&text, style, ctx, avail.max(1.0), true, None);
        let mut s = g.size();
        if loading {
            s.x += SPINNER + SPINNER_GAP;
        }
        s
    }
}

/// The loading spinner's box — the icon slot (`--we-context-icon-size` ≈ 16).
const SPINNER: f32 = 16.0;
/// Space between the spinner and the label it precedes (`gap` ≈ space-200).
const SPINNER_GAP: f32 = 8.0;

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
        let loading = props::prop_bool(node, "loading");
        let square = props::prop_bool(node, "square");
        let disabled = props::prop_bool(node, "disabled") || loading;
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
        // painted by the walk inside the button's own row layout. Truncation
        // answers at the content box — the padding is not label room.
        let has_node_children = node
            .children
            .iter()
            .any(|c| matches!(c, we_template::ResolvedChild::Node(_)));
        // `loading && square` shows the spinner alone — the square has no
        // room for a label beside it.
        let show_label = !(has_node_children || label.is_empty() || loading && square);
        let spin_w = if loading {
            SPINNER + if show_label { SPINNER_GAP } else { 0.0 }
        } else {
            0.0
        };
        // The label and spinner live in the content box — inside the
        // padding the measure left outside them (and any painted border).
        let content = props::content_rect(rect, &eff, FONT_PX, ROOT_PX, view);
        let content_w = content.width().max(1.0);
        let g = show_label
            .then(|| crate::text::text_job(&label, &eff, cx.ui.ctx(), content_w, true, None));
        let mut x =
            content.center().x - (spin_w + g.as_ref().map(|g| g.size().x).unwrap_or(0.0)) / 2.0;
        if loading {
            let t = (cx.now * std::f64::consts::TAU * 1.6) as f32;
            let r = SPINNER * 0.32;
            let c = egui::pos2(x + SPINNER / 2.0, content.center().y);
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
            x += spin_w;
        }
        if let Some(g) = g {
            cx.ui.painter().galley(
                egui::pos2(x, content.center().y - g.size().y / 2.0),
                g,
                props::text_color(&eff, cx.ui.ctx()),
            );
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
