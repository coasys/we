//! The box containers: `Row`, `Column`, `Grid`, `Card`, `div`, `$lane`.
//!
//! A container's own paint is its [`Style`] box — background, borders,
//! radius, shadows, opacity — plus its AccessKit label. Children paint on
//! top, walked by the frame.
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{view_of, FONT_PX, ROOT_PX};
use crate::props;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

/// The shared container paint: box chrome + label. `label`/`data-we-id`
/// name it when authored; the type name is the fallback.
pub(crate) fn paint_container(cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
    let view = view_of(cx.ui.ctx());
    props::paint_box(
        cx.ui.painter(),
        rect,
        style,
        props::text_color(style, cx.ui),
        FONT_PX,
        ROOT_PX,
        view.viewport,
    );
    let name = props::prop_text(node, "label")
        .or_else(|| props::prop_text(node, "data-we-id"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| node.ty.to_string());
    cx.label(rect, &name);
}

macro_rules! container {
    ($name:ident, $ty:literal) => {
        #[derive(Debug, Default)]
        pub struct $name;
        impl Widget for $name {
            fn type_name(&self) -> &'static str {
                $ty
            }
            fn kind(&self) -> WidgetKind {
                WidgetKind::Container
            }
            fn measure(
                &self,
                _cx: &MeasureCx,
                _node: &ResolvedNode,
                _style: &Style,
                _avail: Size,
            ) -> Size {
                Size::ZERO
            }
            fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
                paint_container(cx, node, style, rect);
            }
        }
    };
}

container!(Row, "Row");
container!(Column, "Column");
container!(Grid, "Grid");
container!(Card, "Card");
container!(Div, "div");

/// `$lane` — a resizable side lane. `collapsed` renders a thin strip;
/// `width` sets the lane width; a drag handle on the inner edge resizes it
/// and emits `onResize` with the new width.
#[derive(Debug, Default)]
pub struct Lane;

impl Widget for Lane {
    fn type_name(&self) -> &'static str {
        "$lane"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        let w = props::prop_num(node, "width").unwrap_or(240.0) as f32;
        Size::new(w, 0.0)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let collapsed = props::prop_bool(node, "collapsed");
        if collapsed {
            // A collapsed lane is a 4px strip the shell can still target.
            cx.ui.painter().rect_filled(
                egui::Rect::from_min_size(rect.min, egui::vec2(4.0, rect.height())),
                0.0,
                cx.ui.visuals().widgets.noninteractive.bg_fill,
            );
            cx.label(rect, "lane (collapsed)");
            return;
        }
        paint_container(cx, node, style, rect);
        cx.label(rect, "lane");
        // Drag handle on the right edge.
        let handle = egui::Rect::from_min_max(egui::pos2(rect.max.x - 4.0, rect.min.y), rect.max);
        let r = cx.ui.interact(
            handle,
            cx.ui.scope_id().with(("lane-resize", node.id.as_str())),
            egui::Sense::drag(),
        );
        if r.hovered() || r.dragged() {
            cx.ui
                .ctx()
                .set_cursor_icon(egui::CursorIcon::ResizeHorizontal);
        }
        if r.dragged() {
            let width = (rect.width() + r.drag_delta().x).clamp(120.0, 600.0);
            cx.emit(
                &node.id,
                "onResize",
                props::detail([("width", we_expr::Value::Num(width as f64))]),
            );
        }
    }
}
