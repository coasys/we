//! `we-egui`: the [`Widget`] contract, the [`Registry`], layout and paint.
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

mod clock;
mod containers;
mod controls;
pub mod defaults;
mod dnd;
mod edit_state;
pub mod event;
mod feedback;
mod fonts;
mod gradient;
mod inputs;
mod layout;
mod media;
mod overlays;
mod paint;
mod pickers;
mod pixel_grid;
mod placeholders;
pub mod props;
mod registry;
mod text;
mod tree;
mod unknown;

use std::sync::Arc;

use we_expr::Value;
use we_style::Style;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

pub use clock::{now_secs, pin_now};
pub use containers::{Card, Column, Div, Grid, Lane, Row};
pub use controls::Button;
pub use defaults::StyleCx;
pub use dnd::Sortable;
pub use edit_state::EditState;
pub use event as events;
pub use feedback::{Alert, Badge, Divider, Skeleton, Tag, Tooltip};
pub use inputs::{FormField, Input, NumberInput, Select, Slider, Switch, Textarea};
pub use layout::{layout, layout_shrink, Layout, Parts, TextSpan};
pub use media::{install as install_media, AnimatedIcon, Avatar, AvatarStack, Icon, Image};
pub use overlays::{DropdownMenu, Modal, Popover};
pub use paint::paint;
pub use pickers::{ColorPicker, DatePicker, IconPicker};
pub use registry::Registry;
pub use text::{
    format_date, format_relative, parse_date, text_job, Link, Text, Timestamp, Typewriter,
};
pub use tree::{Tree, TreeItem};
pub use unknown::UnknownWidget;
pub use we_layout::{Direction, PartSpec, PartsSpec, Pick, TextChildren, TreeCfg};

/// `style_of` for callers (the gallery's swatches, tests).
pub use defaults::style_of;

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
/// - `hits` — the frame's interactive-hit log: which click-sensing rects
///   activated and which were dead surface. An overlay reads it to learn
///   that the DOM equivalent of "the trigger element got a click"
///   happened — a keyboard fake-click on a child button included.
pub struct PaintCx<'a> {
    pub ui: &'a mut egui::Ui,
    pub parts: &'a Parts,
    pub edit: &'a mut EditState,
    pub now: f64,
    /// The containing-block width the node's percent paddings/margins (and
    /// percent terms inside `calc()`) resolve against — the value
    /// [`crate::layout::Layout::bases`] recorded for the node, which is
    /// the same base layout used. `None` when layout found the base
    /// content-driven (the CSS cyclic fallback → `0`) or for a
    /// hand-built context in tests.
    pub cb_w: Option<f32>,
    pub(crate) ancestors: &'a [NodeId],
    pub(crate) events: &'a mut Vec<WidgetEvent>,
    pub(crate) hits: &'a mut HitLog,
    pub(crate) clicks: &'a mut ClickLog,
    /// The `clip-path` the widget actually painted with, once it resolved
    /// its interactive state ([`PaintCx::state_style`]) — `None` when it
    /// reported none, and the walk clips with the resting style. The walk
    /// cuts the subtree's output after it paints, so it must use the same
    /// state (cyberpunk's `:hover { clip-path: none }`).
    pub(crate) state_clip: Option<Option<we_style::ClipPath>>,
}

/// The click-sensing rects the frame has reported so far: `activated` —
/// a response that reported `clicked()` (pointer, keyboard fake-click or
/// a11y activation, all layer/enabled-correct by egui), with its widget
/// id so a popup can name the control that invoked it; `dead` — a rect a
/// disabled control still occupies, which swallows the DOM click rather
/// than letting it reach whatever is beneath.
#[derive(Debug, Default)]
pub struct HitLog {
    pub activated: Vec<(Rect, egui::Id)>,
    pub dead: Vec<Rect>,
    /// Painted rects of widgets that took keyboard focus this frame — the
    /// enclosing scroller reads them to bring a Tab-visited control into
    /// view, the job egui's `ScrollArea` does through `scroll_to_me`.
    pub gained: Vec<Rect>,
    /// Every focusable's (rect, egui id) — `interact_label` regions and
    /// the TextEdit fields. A popup's close finds its trigger's id to
    /// return focus (the DOM's `trigger.focus()` on dismiss); a tooltip
    /// reads "a control inside the trigger holds focus" from it.
    pub interact: Vec<(Rect, egui::Id)>,
}

/// The frame's click propagation. Each `paths` entry is a click's DOM
/// target chain (root → target): a container records it when a
/// primary-button release lands in its box, a widget when it emits its
/// own `onClick` or reports any click-sensing activation (a switch, a
/// stepper — the DOM click happens whatever the widget emits). `at_target` marks the nodes that already fired —
/// the post-children pass emits `onClick` for the remaining path
/// members, so handlers run child-first like a real DOM bubble.
#[derive(Debug, Default)]
pub struct ClickLog {
    pub paths: Vec<Vec<NodeId>>,
    pub at_target: std::collections::HashSet<NodeId>,
    /// Ancestors whose bubbled `onClick` already ran this frame — the
    /// post-overlay pass skips them (an overlay's click reaches page
    /// ancestors only after the page walk unwound).
    pub fired: std::collections::HashSet<NodeId>,
}

impl<'a> PaintCx<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        ui: &'a mut egui::Ui,
        events: &'a mut Vec<WidgetEvent>,
        parts: &'a Parts,
        edit: &'a mut EditState,
        now: f64,
        ancestors: &'a [NodeId],
        hits: &'a mut HitLog,
        clicks: &'a mut ClickLog,
    ) -> Self {
        Self {
            ui,
            parts,
            edit,
            now,
            cb_w: None,
            ancestors,
            events,
            hits,
            clicks,
            state_clip: None,
        }
    }

    /// The style for the response's state ([`crate::props::state_style`]),
    /// recording its `clip-path` for the walk's clip pass — every widget
    /// that paints a state-dependent chrome resolves it through here.
    pub(crate) fn state_style<'s>(
        &mut self,
        style: &'s we_style::Style,
        response: &egui::Response,
        disabled: bool,
    ) -> std::borrow::Cow<'s, we_style::Style> {
        let eff = crate::props::state_style(style, response, disabled);
        self.report_state(&eff);
        eff
    }

    /// Record the state-resolved style a widget painted with (for a widget
    /// that resolves its state without a [`egui::Response`] — the input's
    /// `:focus-within`).
    pub(crate) fn report_state(&mut self, eff: &we_style::Style) {
        self.state_clip = Some(eff.paint.clip.clone());
    }

    /// Report user input on `node`'s handler — `cx.emit(&node.id, "onClick",
    /// event_value)`. The frame runs the handler on the host.
    pub fn emit(&mut self, node: &NodeId, handler: &str, value: Value) {
        if handler == "onClick" {
            // A widget activation is a DOM click: the node's handler is
            // the at-target phase, and the path records it so the
            // ancestor chain bubbles after it.
            self.clicks.at_target.insert(node.clone());
            self.clicks.paths.push(
                self.ancestors
                    .iter()
                    .cloned()
                    .chain(std::iter::once(node.clone()))
                    .collect(),
            );
        }
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
    /// AccessKit node gets `role`, `enabled` and `text`, so `get_by_label`
    /// finds it; `selected` reports a checkbox/switch's toggled state.
    /// A disabled region senses hover only: it still shows its state,
    /// can't report `clicked()`, and logs itself as dead surface so a
    /// pointer click on it can't activate an overlay's trigger beneath.
    #[allow(clippy::too_many_arguments)]
    pub fn interact_label(
        &mut self,
        rect: Rect,
        text: &str,
        role: egui::Role,
        node: &NodeId,
        part: &str,
        enabled: bool,
        selected: Option<bool>,
    ) -> egui::Response {
        let id = self.ui.scope_id().with(("we-click", node.as_str(), part));
        let sense = if enabled {
            egui::Sense::click()
        } else {
            egui::Sense::hover()
        };
        let response = self.ui.interact(rect, id, sense);
        response.widget_info(|| match selected {
            Some(sel) => egui::WidgetInfo::selected(role, enabled, sel, text.to_string()),
            None => egui::WidgetInfo::labeled(role, enabled, text.to_string()),
        });
        self.hits.interact.push((rect, response.id));
        if !enabled {
            self.hits.dead.push(rect);
        } else if response.clicked() {
            self.hits.activated.push((rect, response.id));
            // An accepted activation — pointer, keyboard fake-click or
            // a11y — is a DOM click on this element whatever handler the
            // widget emits for it, so the ancestor chain hears it.
            self.clicks.paths.push(
                self.ancestors
                    .iter()
                    .cloned()
                    .chain(std::iter::once(node.clone()))
                    .collect(),
            );
        }
        if response.gained_focus() {
            self.hits.gained.push(rect);
        }
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
/// use we_egui::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};
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
    /// What the widget does with the node's text children — the default
    /// leaves them as spans laid out beside element children. `Owned` makes
    /// them the widget's own galley (`we-text`'s `text ?? <slot>` content);
    /// `Suppressed` drops every child (a `text` prop replaces the slot).
    fn text_children(&self, _node: &ResolvedNode) -> TextChildren {
        TextChildren::Leaves
    }
    /// Children the widget itself renders — a component's generated
    /// content (the DropdownMenu's fallback `we-button` trigger when the
    /// authored node is childless). They lay out and paint exactly like
    /// authored children: part picks see them, they get ids and rects,
    /// and the paint walk recurses into them.
    fn synthesized_children(&self, _node: &ResolvedNode) -> Vec<ResolvedChild> {
        Vec::new()
    }
    /// `true` when an activation inside the `trigger` part toggles open —
    /// the DOM "click on the trigger" of a popover/menu. A click-sensing
    /// descendant reporting `clicked()` counts (pointer, keyboard
    /// fake-click, a11y activation); so does a pointer click in the anchor
    /// that no disabled surface swallowed. `we-tooltip` opts out — its
    /// trigger opens on hover, not click.
    fn trigger_toggles(&self) -> bool {
        false
    }
    /// `we-tooltip` only: pointer hover or keyboard focus inside the
    /// `trigger` part drives `open` — the element's `mouseover`/`focusin`
    /// → show, `mouseout`/`focusout` → hide (tooltip.ts), gated on
    /// `_hasSomethingToSay`, which the node answers here. The walk applies
    /// it post-children, when the subtree's focus state exists, and copies
    /// [`Self::trigger_text`]'s answer onto the controls inside.
    fn focus_opens(&self, _node: &ResolvedNode) -> bool {
        false
    }
    /// The text a `focus_opens` trigger's controls carry as their
    /// AccessKit description — `_describeTrigger`'s `aria-description`
    /// (the text, not an id reference, which cannot cross the shadow
    /// boundary). The walk writes it each frame; empty clears.
    fn trigger_text(&self, _node: &ResolvedNode) -> String {
        String::new()
    }
}
