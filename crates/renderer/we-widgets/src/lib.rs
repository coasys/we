//! `we-widgets`: the [`Widget`] contract, the [`Registry`], layout and paint.
//! The only crate that needs egui.
//!
//! A widget never touches a store: input it reports goes through
//! [`PaintCx::emit`], and the frame's events run as handlers on the host.
//! Every painted widget sets an AccessKit label so tests can find it; a `ty`
//! the registry does not know paints a red outlined box with the type name —
//! the same answer WE gives (`data-we-missing-component`).
//!
//! **Frozen at E3a** — E5a/E5b/E8 code against [`Widget`], [`MeasureCx`],
//! [`PaintCx`], [`PartsSpec`], [`EditState`]; do not change their shapes
//! without updating `_shared-architecture.md` §3.5.
#![forbid(unsafe_code)]

mod basic;
mod dnd;
mod edit_state;
pub mod event;
mod inputs;
mod layout;
mod overlays;
mod paint;
mod pickers;
pub mod props;
mod registry;
mod tree;
mod unknown;

use std::sync::Arc;

use we_expr::Value;
use we_style::Style;
use we_template::{NodeId, ResolvedNode};

pub use basic::{AnimatedIcon, Avatar, Badge, Button, Column, Icon, Row, Text, Timestamp, Tooltip};
pub use dnd::Sortable;
pub use edit_state::EditState;
pub use event as events;
pub use inputs::{FormField, Input, NumberInput, Select, Slider, Switch, Textarea};
pub use layout::{layout, style_of, Direction, Layout, PartSpec, Parts, PartsSpec, Pick, TextSpan};
pub use overlays::{DropdownMenu, Modal, Popover};
pub use paint::paint;
pub use pickers::{ColorPicker, DatePicker, IconPicker};
pub use registry::Registry;
pub use tree::{Tree, TreeItem};
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

/// What a widget may use while painting.
///
/// - `ui` — the egui painter + interaction.
/// - `parts` — the virtual rects layout computed from the widget's
///   [`Widget::parts_spec`] (the tree-item's caret, a card's header).
/// - `edit` — widget-owned editing state that survives frames (`we-input`'s
///   draft, an IME range).
/// - `now` — seconds; animations and transitions read it.
/// - `ancestors` — the node ids above this one in the resolved tree, root
///   first (a tree item asks how deep it is).
/// - `events` — the sink [`PaintCx::emit`] pushes to; the frame drains it.
pub struct PaintCx<'a> {
    pub ui: &'a mut egui::Ui,
    pub parts: &'a Parts,
    pub edit: &'a mut EditState,
    pub now: f64,
    pub(crate) ancestors: &'a [NodeId],
    pub(crate) events: &'a mut Vec<WidgetEvent>,
}

impl<'a> PaintCx<'a> {
    pub fn new(
        ui: &'a mut egui::Ui,
        events: &'a mut Vec<WidgetEvent>,
        parts: &'a Parts,
        edit: &'a mut EditState,
        now: f64,
        ancestors: &'a [NodeId],
    ) -> Self {
        Self {
            ui,
            parts,
            edit,
            now,
            ancestors,
            events,
        }
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

    /// The node ids above the one being painted, root first.
    pub fn ancestors(&self) -> &[NodeId] {
        self.ancestors
    }

    /// Set the AccessKit label tests query by — every painted widget calls
    /// this with its `label` or `text` prop (or its type, as the fallback
    /// does).
    pub fn label(&mut self, rect: Rect, text: &str) {
        let id = self.ui.scope_id().with(("we-label", text));
        self.ui
            .interact(rect, id, egui::Sense::hover())
            .widget_info(|| egui::WidgetInfo::labeled(egui::Role::Unknown, true, text.to_string()));
    }

    /// A clickable, labeled region — the tree-item row, a button. Returns the
    /// [`egui::Response`] so the caller decides what a click emits. The
    /// AccessKit node gets `role` and `text`, so `get_by_label` finds it.
    pub fn interact_label(
        &mut self,
        rect: Rect,
        text: &str,
        role: egui::Role,
        node: &NodeId,
        part: &str,
    ) -> egui::Response {
        let id = self.ui.scope_id().with(("we-click", node.as_str(), part));
        let response = self.ui.interact(rect, id, egui::Sense::click());
        response.widget_info(|| egui::WidgetInfo::labeled(role, true, text.to_string()));
        response
    }
}

/// What the node is to layout: it holds children, it is content, or it
/// floats.
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
///     fn paint(&self, _cx: &mut PaintCx, _node: &ResolvedNode, _style: &Style, _rect: Rect) {}
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
    /// Virtual chrome the node needs laid out — the tree-item's row / caret /
    /// children group. `None` (the default) → children inside `rect`.
    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        None
    }
}
