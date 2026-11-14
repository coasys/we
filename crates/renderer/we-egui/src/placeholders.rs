//! Labelled placeholders for types E5a does not paint for real — so nothing
//! on `/` shows the red unknown box. Each registration names the stage that
//! replaces it; the route test greps the known-types list, so deleting a
//! registration turns a route red exactly like removing a widget.
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{view_of, FONT_PX, ROOT_PX};
use crate::props;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

/// A bordered box with the type name + its main prop — the honest "not yet"
/// marker. The stroke is the muted border color, never the unknown red.
pub struct Placeholder {
    ty: &'static str,
    /// What replaces this placeholder (for the box's second line).
    owner: &'static str,
}

impl Placeholder {
    pub const fn new(ty: &'static str, owner: &'static str) -> Self {
        Self { ty, owner }
    }
}

impl Widget for Placeholder {
    fn type_name(&self) -> &'static str {
        self.ty
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    fn measure(&self, _cx: &MeasureCx, _n: &ResolvedNode, _s: &Style, a: Size) -> Size {
        Size::new(a.x.min(320.0), 64.0)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let view = view_of(cx.ui.ctx());
        crate::containers::paint_container(cx, node, style, rect);
        cx.ui.painter().rect_stroke(
            rect,
            props::radius_px(&style.paint.radius, rect, FONT_PX, ROOT_PX, view.viewport),
            egui::Stroke::new(1.0, cx.ui.visuals().weak_text_color()),
            egui::StrokeKind::Inside,
        );
        let detail = props::text_of(node);
        let detail = if detail.is_empty() {
            self.owner
        } else {
            &detail
        };
        cx.ui.painter().text(
            props::content_rect(rect, style, FONT_PX, ROOT_PX, view).center(),
            egui::Align2::CENTER_CENTER,
            format!("{ty} · {detail}", ty = self.ty),
            egui::FontId::proportional(11.0),
            cx.ui.visuals().weak_text_color(),
        );
        cx.label(rect, self.ty);
    }
}

/// `we-video` — a placeholder that paints its `poster` image when it has
/// one (the shell shows that until the video stage lands).
pub struct Video;

impl Widget for Video {
    fn type_name(&self) -> &'static str {
        "we-video"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, _cx: &MeasureCx, _n: &ResolvedNode, _s: &Style, a: Size) -> Size {
        Size::new(a.x.min(320.0), a.x.min(320.0) * 9.0 / 16.0)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        crate::containers::paint_container(cx, node, style, rect);
        let content = props::content_rect(rect, style, FONT_PX, ROOT_PX, view_of(cx.ui.ctx()));
        if let Some(poster) = props::prop_text(node, "poster").filter(|p| !p.is_empty()) {
            egui::Image::new(egui::ImageSource::Uri(poster.to_string().into()))
                .fit_to_exact_size(content.size())
                .paint_at(cx.ui, content);
        } else {
            let p = cx.ui.painter();
            p.rect_filled(content, 2.0, egui::Color32::BLACK.gamma_multiply(0.85));
            p.text(
                content.center(),
                egui::Align2::CENTER_CENTER,
                crate::media::phosphor("play").unwrap_or(">"),
                egui::FontId::new(content.height() * 0.2, egui::FontFamily::Proportional),
                egui::Color32::WHITE,
            );
        }
        cx.label(rect, "we-video");
    }
}

/// The E5a placeholder registrations — each names the stage that replaces it.
/// The E5b types (`we-input` etc.) are NOT here; that branch registers them.
pub fn register(reg: &mut crate::Registry) {
    reg.register(Placeholder::new("GraphView", "stage 4"));
    reg.register(Placeholder::new("BlockComposer", "E8"));
    reg.register(Placeholder::new("EditableImage", "E8"));
    reg.register(Placeholder::new("we-location-picker", "E8"));
    reg.register(Placeholder::new("we-file-upload", "E8"));
    reg.register(Video);
    reg.register(Placeholder::new("AgentChat", "stage 5"));
    reg.register(Placeholder::new("AgentChatSheet", "stage 5"));
}
