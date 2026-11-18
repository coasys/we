//! Labelled placeholders for types E5a does not paint for real — so nothing
//! on `/` shows the red unknown box. Each registration names the stage that
//! replaces it; the route test greps the known-types list, so deleting a
//! registration turns a route red exactly like removing a widget.
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::view_of;
use crate::props;
use crate::{Direction, MeasureCx, PaintCx, PartsSpec, Rect, Size, Widget, WidgetKind};

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
            props::radius_px(&style.paint.radius, rect, &view.metrics, view.viewport),
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
            props::content_rect(rect, style, view, cx.cb_w).center(),
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
        let content = props::content_rect(rect, style, view_of(cx.ui.ctx()), cx.cb_w);
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

/// `AgentChatSheet` — a sheet host, like the web's: closed, the element
/// has no box and paints nothing; `open` floats its children on the
/// overlay layer. The placeholder card marks where stage 5's panel lands.
pub struct Sheet;

impl Widget for Sheet {
    fn type_name(&self) -> &'static str {
        "AgentChatSheet"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Overlay
    }
    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        // No parts — a sheet's children all float.
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![],
        })
    }
    fn measure(&self, _cx: &MeasureCx, _n: &ResolvedNode, _s: &Style, _a: Size) -> Size {
        // A sheet takes no room in the flow.
        Size::new(0.0, 0.0)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, _rect: Rect) {
        // Only the overlay pass hands us an "overlay" rect — the in-flow
        // call (rect is our zero-size slot) paints nothing.
        let Some(content) = props::part(cx, node, "overlay") else {
            return;
        };
        let view = view_of(cx.ui.ctx());
        cx.ui.painter().rect_stroke(
            content,
            props::radius_px(&style.paint.radius, content, &view.metrics, view.viewport),
            egui::Stroke::new(1.0, cx.ui.visuals().weak_text_color()),
            egui::StrokeKind::Inside,
        );
        cx.ui.painter().text(
            content.min + egui::vec2(12.0, 12.0),
            egui::Align2::LEFT_TOP,
            "AgentChatSheet · stage 5",
            egui::FontId::proportional(11.0),
            cx.ui.visuals().weak_text_color(),
        );
        cx.label(content, "AgentChatSheet");
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
    reg.register(Sheet);
}
