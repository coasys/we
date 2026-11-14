//! `we-modal` — a controlled dialog. `open` comes from the props; the
//! frame's overlay pass centres its children on an `egui::Modal`, and
//! Escape or a backdrop click emits the node's `close`/`onClose` handler.
//! The widget itself only paints the title bar on the overlay pass.
use we_style::Style;
use we_template::ResolvedNode;

use crate::props;
use crate::{Direction, MeasureCx, PaintCx, PartsSpec, Rect, Size, Widget, WidgetKind};

pub struct Modal;

impl Modal {
    /// The room the dialog keeps to the viewport's edge — WE's `GUTTER`,
    /// `--we-space-500` (24px).
    pub(crate) const GUTTER: f32 = 24.0;

    /// The dialog's inner padding — WE's size-aware
    /// `--we-modal-size-padding`: `sm` gets space-700 (48), the bigger
    /// sheets space-800 (64).
    pub(crate) fn pad(node: &ResolvedNode) -> f32 {
        match props::prop_enum(node, "size", &["sm", "md", "lg", "xl", "fullscreen"])
            .unwrap_or("md")
        {
            "sm" => 48.0,
            _ => 64.0,
        }
    }

    /// The title row's font — one name so layout and paint agree on the
    /// strip's height.
    pub(crate) const TITLE_FONT: f32 = 16.0;

    /// Base's `gap: '500'` between the title row and the content — WE's
    /// default (space-500 = 24px).
    pub(crate) const TITLE_GAP: f32 = 24.0;

    /// The strip under a `title` prop — the row height plus [`Self::TITLE_GAP`].
    /// `None` when there's no title: like an empty `header` slot, it costs
    /// the layout nothing.
    pub(crate) fn title_strip(cx: &MeasureCx, node: &ResolvedNode) -> Option<f32> {
        props::prop_string(node, "title").filter(|t| !t.is_empty())?;
        let row = cx
            .ctx
            .fonts_mut(|f| f.row_height(&egui::FontId::proportional(Self::TITLE_FONT)));
        Some(row + Self::TITLE_GAP)
    }

    /// The chrome control the close-button-wrapper holds — ghost, sm,
    /// square, `x`, 10px in from the sheet's top-right. A `close-button`
    /// slot child replaces it (the wrapper then holds the authored
    /// control); `hideclosebutton` drops the wrapper outright. Clicking it
    /// is the same `close`/`onClose` the backdrop and Escape invoke.
    fn close_button(&self, cx: &mut PaintCx, node: &ResolvedNode, content: Rect) {
        if props::prop_flag(node, "hideclosebutton").unwrap_or(false) {
            return;
        }
        let slotted = node.children.iter().any(|c| {
            matches!(c, we_template::ResolvedChild::Node(n) if n.slot.as_deref() == Some("close-button"))
        });
        if slotted {
            return;
        }
        let side = 24.0;
        let r = Rect::from_min_size(
            egui::pos2(content.max.x - 10.0 - side, content.min.y + 10.0),
            egui::vec2(side, side),
        );
        let resp = cx.interact_label(
            r,
            "Close",
            egui::Role::Button,
            &node.id,
            "close",
            true,
            None,
        );
        if resp.hovered() {
            cx.ui
                .painter()
                .rect_filled(r, 4.0, cx.ui.visuals().widgets.hovered.bg_fill);
        }
        cx.ui.painter().text(
            r.center(),
            egui::Align2::CENTER_CENTER,
            crate::media::phosphor("x").unwrap_or("x"),
            egui::FontId::proportional(14.0),
            cx.ui.visuals().text_color(),
        );
        if resp.clicked() {
            if let Some(name) = crate::paint::close_handler(node) {
                cx.emit(&node.id, name, crate::events::empty());
            }
        }
    }
}

impl Widget for Modal {
    fn type_name(&self) -> &'static str {
        "we-modal"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Overlay
    }

    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        // No parts — a modal's children all float.
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![],
        })
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        // A modal takes no room in the flow.
        Size::new(0.0, 0.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        // Only the overlay pass gives us an "overlay" rect — the in-flow
        // call (rect is our zero-size slot) paints nothing.
        let Some(content) = props::part(cx, node, "overlay") else {
            return;
        };
        // The dialog answers to its title, like `aria-labelledby` on base.
        cx.label(
            content,
            &props::prop_string(node, "title").unwrap_or_else(|| "we-modal".to_string()),
        );
        if let Some(title) = props::prop_string(node, "title") {
            let pad = Self::pad(node);
            cx.ui.painter().text(
                content.min + egui::vec2(pad, pad),
                egui::Align2::LEFT_TOP,
                title,
                egui::FontId::proportional(Self::TITLE_FONT),
                cx.ui.visuals().text_color(),
            );
        }
        self.close_button(cx, node, content);
    }
}
