//! `we-widgets`: the [`Widget`] contract, the [`Registry`], layout and paint.
//! The only crate that needs egui.
//!
//! A widget never touches a store: input it reports goes through
//! [`PaintCx::emit`], and the frame's events run as handlers on the host.
//! Every painted widget sets an AccessKit label so tests can find it; a `ty`
//! the registry does not know paints a red outlined box with the type name —
//! the same answer WE gives (`data-we-missing-component`).
#![forbid(unsafe_code)]

mod registry;
mod unknown;

use std::sync::Arc;

use we_expr::Value;
use we_style::Style;
use we_template::{NodeId, ResolvedNode};

pub use registry::Registry;
pub use unknown::UnknownWidget;

/// The room a widget may take during [`Widget::measure`].
pub type Size = egui::Vec2;
/// The box it is told to paint in.
pub type Rect = egui::Rect;

/// What a widget reports back to the frame: a handler fired on a node.
#[derive(Debug, Clone)]
pub struct WidgetEvent {
    pub node: NodeId,
    pub handler: Arc<str>,
    pub value: Value,
}

/// What a widget may read while measuring — text layout and scale.
pub struct MeasureCx<'a> {
    pub ctx: &'a egui::Context,
}

impl<'a> MeasureCx<'a> {
    pub fn new(ctx: &'a egui::Context) -> Self {
        Self { ctx }
    }
}

/// What a widget may use while painting: the egui painter, and the event sink
/// the frame drains afterwards.
pub struct PaintCx<'a> {
    pub ui: &'a mut egui::Ui,
    events: &'a mut Vec<WidgetEvent>,
}

impl<'a> PaintCx<'a> {
    pub fn new(ui: &'a mut egui::Ui, events: &'a mut Vec<WidgetEvent>) -> Self {
        Self { ui, events }
    }

    /// Report user input on `node`'s handler — `cx.emit(&node.id, "onClick",
    /// event_value)`. The frame runs the handler on the host.
    pub fn emit(&mut self, node: &NodeId, handler: &str, value: Value) {
        self.events.push(WidgetEvent {
            node: node.clone(),
            handler: handler.into(),
            value,
        });
    }

    /// Events emitted so far this frame.
    pub fn events(&self) -> &[WidgetEvent] {
        self.events
    }

    /// Set the AccessKit label tests query by — every painted widget calls this
    /// with its `label` or `text` prop (or its type, as the fallback does).
    pub fn label(&mut self, rect: Rect, text: &str) {
        let id = self.ui.scope_id().with(("we-label", text));
        self.ui
            .interact(rect, id, egui::Sense::hover())
            .widget_info(|| egui::WidgetInfo::labeled(egui::Role::Unknown, true, text.to_string()));
    }
}

/// What the node is to layout: it holds children, it is content, or it floats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WidgetKind {
    Container,
    Leaf,
    Overlay,
}

/// One widget type — `Row`, `we-button`, … — drawn from a [`ResolvedNode`].
///
/// ```
/// use we_widgets::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};
/// use we_template::ResolvedNode;
/// use we_style::Style;
///
/// struct Label;
/// impl Widget for Label {
///     fn type_name(&self) -> &'static str { "Label" }
///     fn kind(&self) -> WidgetKind { WidgetKind::Leaf }
///     fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
///         Size::new(avail.x.min(80.0), 20.0)
///     }
///     fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
///         cx.emit(&node.id, "onShown", we_expr::Value::Null);
///     }
/// }
/// ```
pub trait Widget: Send + Sync {
    /// The `ty` string the resolved tree names — what the registry keys on.
    fn type_name(&self) -> &'static str;
    /// `Container` | `Leaf` | `Overlay`.
    fn kind(&self) -> WidgetKind;
    /// The size a leaf wants in `avail` room. Containers layout instead.
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size;
    /// Draw the node inside `rect`.
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect);
}
