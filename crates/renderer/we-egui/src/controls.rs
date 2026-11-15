//! `we-button` — the one control in the E5a batch. Inputs/menus are E5b.
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::view_of;
use crate::props;
use crate::{
    Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, TextChildren, Widget,
    WidgetKind,
};

/// `we-button` — variant + size come through `Style`; `disabled`, `loading`,
/// `square`, `href`, `expanded`, `text` are widget props. Children (icon +
/// text nodes) flow inside its row layout. Clicks emit `onClick` with
/// `{detail:{}}`; a `href` with no handler opens the URL. `label` is the
/// accessible name — an aria-label on the web component, never its text.
#[derive(Debug, Default)]
pub struct Button;

impl Button {
    /// What the button shows: `text`, else the default slot's words. The web
    /// component's `label` names it for a screen reader only.
    fn visible_text(node: &ResolvedNode) -> String {
        props::prop_text(node, "text")
            .map(str::to_string)
            .unwrap_or_else(|| props::children_text(node))
    }

    /// The content box's intrinsic size: the label galley, plus the spinner
    /// and its gap while `loading` (a square button has no room for the
    /// label — the spinner *is* the content there, same as button.ts).
    fn measure_label(node: &ResolvedNode, style: &Style, ctx: &egui::Context, avail: f32) -> Size {
        let text = Self::visible_text(node);
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
    /// `this.text ? <span> : <slot>`: a `text` prop replaces every child
    /// (the icon too); text-only children are the painted label; element
    /// children flow in the button's own row.
    fn text_children(&self, node: &ResolvedNode) -> TextChildren {
        if props::prop_text(node, "text").is_some() {
            TextChildren::Suppressed
        } else if props::has_node_children(node) {
            TextChildren::Leaves
        } else {
            TextChildren::Owned
        }
    }
    /// button.ts: the default slot flows inside `display:flex;
    /// align-items:center; gap:var(--we-button-size-gap)` — icon + label
    /// side by side, centered. `--we-button-size-gap` is `xs→space-100`,
    /// `sm→space-200`, `md/lg/xl→space-300` (4/8/12px).
    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec> {
        // `text` suppresses the slot, and text-only children are the
        // painted label — only `Leaves` children need the content row.
        let parts = if matches!(self.text_children(node), TextChildren::Leaves) {
            let gap = match props::prop_str(node, "size") {
                Some("xs") => 4.0,
                Some("sm") => 8.0,
                _ => 12.0,
            };
            // The row fills the button and justifies by the button's `ax`:
            // on the web the slot is `display: contents`, so a `width: 100%`
            // card resolves against `[part=base]`, the button's own box.
            vec![PartSpec::group("content", Pick::Default, Direction::Row)
                .aligned(we_style::ItemAlign::Center)
                .justified(we_style::ItemAlign::Auto)
                .growing(1.0)
                .gapped(gap)]
        } else {
            vec![]
        };
        // `[part=base]` is a row: `ax` justifies along it, `ay` centres
        // across it.
        Some(PartsSpec {
            direction: Direction::Row,
            parts,
        })
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // `Leaves` implies element children — a container, not a leaf.
        if matches!(self.text_children(node), TextChildren::Leaves) {
            return Size::ZERO;
        }
        Self::measure_label(node, style, cx.ctx, avail.x)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        let loading = props::prop_bool(node, "loading");
        let square = props::prop_bool(node, "square");
        let disabled = props::prop_bool(node, "disabled") || loading;
        let label = Self::visible_text(node);
        let a11y = props::prop_text(node, "label")
            .map(str::to_string)
            .unwrap_or_else(|| label.clone());
        let response = cx.interact_label(
            rect,
            &a11y,
            egui::Role::Button,
            &node.id,
            "base",
            !disabled,
            None,
        );
        // NOTE: `expanded` has no egui 0.37 WidgetInfo field — the disclosure
        // state reaches tests through the caret/children instead.
        let eff = cx.state_style(style, &response, disabled);
        props::paint_box(
            cx.ui.painter(),
            rect,
            &eff,
            props::text_color(&eff, cx.ui.ctx()),
            view,
        );
        // Owned/suppressed buttons paint their label centered; `Leaves`
        // children are painted by the walk inside the button's own row
        // layout. Truncation answers at the content box — the padding is
        // not label room.
        let leaves = matches!(self.text_children(node), TextChildren::Leaves);
        // `loading && square` shows the spinner alone — the square has no
        // room for a label beside it.
        let show_label = !(leaves || label.is_empty() || loading && square);
        let spin_w = if loading {
            SPINNER + if show_label { SPINNER_GAP } else { 0.0 }
        } else {
            0.0
        };
        // The label and spinner live in the content box — inside the
        // padding the measure left outside them (and any painted border).
        let content = props::content_rect(rect, &eff, view, cx.cb_w);
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
