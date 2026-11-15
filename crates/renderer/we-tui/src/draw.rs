//! The resolved tree → terminal cells.
//!
//! A two-phase text layout: [`Painter::measure`] asks each node its cell
//! size, [`Painter::paint`] assigns every child a [`Rect`] inside its parent
//! and writes glyphs. One terminal cell stands in for [`CELL_PX`] px when a
//! `Dimension` (gap, padding, width) needs a cell count.
//!
//! The paint walk writes a *virtual* canvas the whole content's height —
//! the caller copies the visible window into the frame — and records the
//! focusable nodes it met (their rects and kinds) for the keyboard loop.
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color as TColor, Modifier, Style as TStyle};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};
use we_expr::Value;
use we_layout::defaults::{direction_of, style_of, StyleCx};
use we_layout::props::{prop, prop_bool, prop_num, prop_str};
use we_style::{BorderKind, Color as WColor, Dimension, Direction, ItemAlign, Theme};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::icons;
use crate::palette::{tui_color, Palette};

/// Pixels one terminal cell stands in for — `8px`: the space scale lands
/// `200`=1 cell, `300`=2, `400`=2, `500`=3.
pub const CELL_PX: f32 = 8.0;

/// The most lines a virtual canvas grows to — runaway content still dumps.
const MAX_LINES: u16 = 4000;

/// What a glyph wider than its whole line draws as — one cell, so the
/// wrap always progresses.
const TOO_WIDE: &str = "…";

/// A cell-size pair — what [`Painter::measure`] returns.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Dim {
    pub w: u16,
    pub h: u16,
}

impl Dim {
    fn new(w: u16, h: u16) -> Self {
        Dim { w, h }
    }
}

/// What a focused node does when Enter lands — and the payload pieces the
/// activation builds from. Collected during paint, in paint order.
#[derive(Debug, Clone)]
pub enum FocusKind {
    /// `onClick` with `{}` — buttons, links, clickable containers.
    Click,
    /// `onSelect` with `{detail: {value}}` — the event bubbles to the
    /// ancestor `we-tree` the way egui's tree-item click does.
    TreeItem { value: Value },
    /// `onOpenChange` with `{detail: {open}}` — fold/unfold a tree item.
    TreeFold { open: bool },
    /// A text field the keyboard types into (`we-input`, `we-textarea`):
    /// typing emits `onInput {detail: text}`, Enter or blur commits
    /// `onChange {detail: text}`.
    Input,
    /// `we-number-input`: typing edits a draft only; Enter or blur commits
    /// `onChange {detail: number}`, clamped to `min`/`max`, and text that
    /// is not a number is never committed.
    NumberInput { min: f64, max: f64 },
    /// `onChange` with `{detail: !checked}` — `we-switch`.
    Switch { checked: bool },
    /// `onChange` with `{detail: next}` — `we-select` cycles `options`.
    Select {
        options: Vec<(Value, String)>,
        current: Value,
    },
    /// `onChange`/`onInput` with `{detail: number}` — `we-slider` steps on
    /// ←/→.
    Step {
        value: f64,
        min: f64,
        max: f64,
        step: f64,
        handler: &'static str,
    },
    /// `tab-select` with `{detail: {value: key}}` — a `we-tab` inside the
    /// `we-tabs` id named here; the `change` event the primitive re-fires
    /// goes to the same payload.
    Tab { tabs: NodeId, key: Value },
}

/// A node the keyboard can reach, with the rect it painted into (virtual
/// canvas coords) and its activation shape.
#[derive(Debug, Clone)]
pub struct Focusable {
    pub id: NodeId,
    pub kind: FocusKind,
    pub rect: Rect,
}

/// Inherited context flowing down the paint walk — CSS-inherited text
/// colour and weight, the enclosing tree's `selected`, the enclosing
/// `we-tabs`' selection, and tree depth.
#[derive(Clone, Default)]
pub struct Env {
    fg: Option<WColor>,
    bold: bool,
    tree_sel: Option<Value>,
    tree_depth: u16,
    tabs_id: Option<NodeId>,
    tabs_sel: Option<Value>,
}

/// The style a node paints with, folded into the flat fields cell writes
/// need.
#[derive(Clone, Copy)]
struct Ink {
    fg: Option<WColor>,
    bg: Option<WColor>,
    bold: bool,
    underline: bool,
    dim: bool,
}

impl Ink {
    fn of(style: &we_style::Style, env: &Env) -> Ink {
        Ink {
            fg: style.text.color.or(env.fg),
            bg: style.paint.bg,
            bold: env.bold || style.text.font_weight.is_some_and(|w| w >= 600.0),
            underline: matches!(
                style.text.decoration,
                Some(we_style::TextDecoration::Underline)
            ),
            dim: false,
        }
    }

    fn style(&self, p: &Painter, base_fg: WColor) -> TStyle {
        let mut s = TStyle::default().fg(self
            .fg
            .and_then(|c| tui_color(c, p.truecolor))
            .unwrap_or_else(|| rc(base_fg, p.truecolor)));
        if let Some(bg) = self.bg.and_then(|c| tui_color(c, p.truecolor)) {
            s = s.bg(bg);
        }
        if self.bold {
            s = s.add_modifier(Modifier::BOLD);
        }
        if self.underline {
            s = s.add_modifier(Modifier::UNDERLINED);
        }
        if self.dim {
            s = s.add_modifier(Modifier::DIM);
        }
        s
    }
}

/// What a node is for layout — `ty` first, the catalog role for what's
/// left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tag {
    Container, // Column/Row/Card/div/$lane/Grid/we-sortable/AgentChat/…
    Card,
    Tooltip,
    Tree,
    TreeItem,
    Input,
    Select,
    Switch,
    Slider,
    NumberInput,
    Button,
    Link,
    Icon,
    Avatar,
    Divider,
    Skeleton,
    Alert,
    Badge,
    Chip,
    FormField,
    Modal,
    Popover,
    Menu,
    Tabs,
    Tab,
    Text,
    CatalogFallback, // media, graph, timestamp… the catalog's own words
    Unknown,
}

fn tag(node: &ResolvedNode) -> Tag {
    match node.ty.as_ref() {
        "Column" | "Row" | "div" | "Grid" | "$lane" | "we-sortable" | "AgentChat" => Tag::Container,
        "Card" => Tag::Card,
        "we-tooltip" => Tag::Tooltip,
        "we-tree" => Tag::Tree,
        "we-tree-item" => Tag::TreeItem,
        "we-input" | "we-textarea" => Tag::Input,
        "we-select" | "we-date-picker" | "we-color-picker" | "we-icon-picker"
        | "we-location-picker" => Tag::Select,
        "we-switch" => Tag::Switch,
        "we-slider" => Tag::Slider,
        "we-number-input" => Tag::NumberInput,
        "we-button" => Tag::Button,
        "we-link" => Tag::Link,
        "we-icon" | "we-animated-icon" => Tag::Icon,
        "we-avatar" | "AvatarStack" => Tag::Avatar,
        "we-divider" => Tag::Divider,
        "we-skeleton" => Tag::Skeleton,
        "we-alert" => Tag::Alert,
        "we-badge" => Tag::Badge,
        "we-tag" => Tag::Chip,
        "we-form-field" => Tag::FormField,
        "we-modal" => Tag::Modal,
        "we-popover" => Tag::Popover,
        "DropdownMenu" => Tag::Menu,
        "we-tabs" => Tag::Tabs,
        "we-tab" => Tag::Tab,
        "we-text" | "we-timestamp" | "we-typewriter" => Tag::Text,
        ty => match we_catalog::entry(ty) {
            Some(e) => match e.role {
                we_catalog::Role::List | we_catalog::Role::Overlay => Tag::Container,
                _ => Tag::CatalogFallback,
            },
            None => Tag::Unknown,
        },
    }
}

/// `display: none` — the node and its subtree leave layout and paint.
fn hidden(style: &we_style::Style) -> bool {
    matches!(style.layout.display, Some(we_style::Display::None))
}

/// A `we_style::Color` → `ratatui::style::Color`, `Reset` when transparent.
fn rc(c: WColor, truecolor: bool) -> TColor {
    tui_color(c, truecolor).unwrap_or(TColor::Reset)
}

/// The `Dimension` → cells on one axis. `avail` is the parent cells;
/// `viewport` the frame cells. `scx`'s unit metrics resolve the font
/// units (`em`/`rem`/`ch`/`ex`/`lh`) into the px a cell projects.
fn dim_cells(scx: &StyleCx, d: Option<&Dimension>, avail: u16, viewport: u16) -> Option<u16> {
    match d? {
        Dimension::Percent(p) => Some((avail as f32 * p).round().max(0.0) as u16),
        other => other
            .to_px(
                &scx.metrics,
                we_style::Size::new(viewport as f32 * CELL_PX, viewport as f32 * CELL_PX),
            )
            .map(|px| (px / CELL_PX).round().max(0.0) as u16),
    }
}

/// A `we-button` that wraps a layout (a card, a row of avatar + name)
/// and names no `label`/`text` — the `bare` press target the templates
/// use for a clickable card. It lays out its children instead of a
/// one-line label.
fn composite_button(node: &ResolvedNode) -> bool {
    node.ty.as_ref() == "we-button"
        && prop_str(node, "label").is_none_or(str::is_empty)
        && prop_str(node, "text").is_none_or(str::is_empty)
        && node.children.iter().any(
            |c| matches!(c, ResolvedChild::Node(n) if matches!(tag(n), Tag::Container | Tag::Card)),
        )
}

/// A `square` `ghost`/`bare` button — an icon with no chrome of its own,
/// drawn as just its glyph.
fn bare_icon_button(node: &ResolvedNode) -> bool {
    node.ty.as_ref() == "we-button"
        && prop_bool(node, "square")
        && matches!(prop_str(node, "variant"), Some("ghost" | "bare"))
}

/// `open` on a tree item — a plain truthy prop read.
fn tree_open(node: &ResolvedNode) -> bool {
    prop(node, "open").truthy()
}

/// Nested children or an explicit `expandable` — the caret's condition,
/// the same as egui's `TreeItem::expandable`.
fn tree_expandable(node: &ResolvedNode) -> bool {
    node.children
        .iter()
        .any(|c| matches!(c, ResolvedChild::Node(n) if n.slot.as_deref() == Some("children")))
        || prop_bool(node, "expandable")
}

/// Up-to-2-letter initials from a name — "Demo Space" → "DS".
fn initials_of(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|w| w.chars().next())
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

/// Cut `s` at `w` display cells.
fn truncate_str(s: &str, w: usize) -> String {
    let mut out = String::new();
    let mut acc = 0usize;
    for ch in s.chars() {
        let cw = UnicodeWidthChar::width(ch).unwrap_or(1);
        if acc + cw > w {
            break;
        }
        acc += cw;
        out.push(ch);
    }
    out
}

/// The painter: owns the buffer the frame draws on plus the context the
/// walk needs. `focusables` fills as nodes paint.
pub struct Painter<'a> {
    pub buf: &'a mut Buffer,
    pub scx: StyleCx<'a>,
    pub theme: &'a Theme,
    pub palette: Palette,
    pub truecolor: bool,
    /// The focused node — its rect gets a reversed-cell highlight.
    pub focus: Option<NodeId>,
    /// Focused input's draft text — the `value` prop is the fallback.
    pub drafts: &'a std::collections::HashMap<NodeId, String>,
    /// Nodes the keyboard can reach, in paint order.
    pub focusables: Vec<Focusable>,
}

impl<'a> Painter<'a> {
    pub fn new(
        buf: &'a mut Buffer,
        scx: StyleCx<'a>,
        theme: &'a Theme,
        palette: Palette,
        truecolor: bool,
        drafts: &'a std::collections::HashMap<NodeId, String>,
    ) -> Self {
        Painter {
            buf,
            scx,
            theme,
            palette,
            truecolor,
            focus: None,
            drafts,
            focusables: Vec::new(),
        }
    }

    fn default_fg(&self) -> WColor {
        self.palette.fg(self.theme)
    }

    /// `style_of` shorthand — every node resolves against the same context.
    fn style(&self, node: &ResolvedNode) -> we_style::Style {
        style_of(node, &self.scx)
    }

    /// Write `s` clipped to `area` at `(x, y)` — never wraps; callers wrap.
    fn put(&mut self, area: Rect, x: u16, y: u16, s: &str, style: TStyle) {
        if area.width == 0
            || area.height == 0
            || y >= area.y + area.height
            || x >= area.x + area.width
        {
            return;
        }
        let max_w = (area.x + area.width - x) as usize;
        self.buf.set_stringn(x, y, s, max_w, style);
    }

    /// Style-patch `rect` — bg fills without touching symbols.
    fn fill(&mut self, clip: Rect, rect: Rect, style: TStyle) {
        self.buf.set_style(rect.intersection(clip), style);
    }

    /// Record a focusable — `rect` is virtual canvas coords.
    fn mark_focus(&mut self, node: &ResolvedNode, kind: FocusKind, rect: Rect) {
        self.focusables.push(Focusable {
            id: node.id.clone(),
            kind,
            rect,
        });
    }

    /// A node is focusable: by type, or by carrying a click/select
    /// handler — a Card with `onClick` is WE's clickable card. `disabled`
    /// never focuses.
    fn focus_kind(&self, node: &ResolvedNode, env: &Env) -> Option<FocusKind> {
        if prop_bool(node, "disabled") {
            return None;
        }
        let has = |name: &str| node.handlers.contains_key(name);
        match tag(node) {
            Tag::Button | Tag::Link => Some(FocusKind::Click),
            Tag::Tab => env.tabs_id.clone().map(|tabs| FocusKind::Tab {
                tabs,
                key: prop(node, "key").clone(),
            }),
            Tag::TreeItem => Some(FocusKind::TreeItem {
                value: prop(node, "value").clone(),
            }),
            Tag::Input => Some(FocusKind::Input),
            Tag::NumberInput => Some(FocusKind::NumberInput {
                min: prop_num(node, "min").unwrap_or(f64::NEG_INFINITY),
                max: prop_num(node, "max").unwrap_or(f64::INFINITY),
            }),
            Tag::Switch => Some(FocusKind::Switch {
                checked: prop(node, "checked").truthy(),
            }),
            Tag::Select => {
                let options = match prop(node, "options") {
                    Value::List(l) => l
                        .iter()
                        .map(|o| match o {
                            Value::Obj(m) => {
                                let v = m
                                    .get("value")
                                    .cloned()
                                    .or_else(|| m.get("id").cloned())
                                    .unwrap_or(Value::Null);
                                let label = m
                                    .get("label")
                                    .or_else(|| m.get("name"))
                                    .map(|l| l.js_string())
                                    .unwrap_or_else(|| v.js_string());
                                (v, label)
                            }
                            other => (other.clone(), other.js_string()),
                        })
                        .collect(),
                    _ => Vec::new(),
                };
                Some(FocusKind::Select {
                    options,
                    current: prop(node, "value").clone(),
                })
            }
            Tag::Slider => Some(FocusKind::Step {
                value: prop_num(node, "value").unwrap_or(0.0),
                min: prop_num(node, "min").unwrap_or(0.0),
                max: prop_num(node, "max").unwrap_or(100.0),
                step: prop_num(node, "step").unwrap_or(1.0),
                handler: if has("onInput") {
                    "onInput"
                } else {
                    "onChange"
                },
            }),
            _ => {
                if has("onClick") || has("onSelect") {
                    Some(FocusKind::Click)
                } else {
                    None
                }
            }
        }
    }

    /// After the walk: reversed cells on the focused node's recorded rect —
    /// the terminal's standard cursor look, theme-independent.
    pub fn highlight_focus(&mut self, area: Rect) {
        let Some(focus) = &self.focus else { return };
        let Some(rect) = self
            .focusables
            .iter()
            .find(|f| &f.id == focus)
            .map(|f| f.rect)
        else {
            return;
        };
        self.buf.set_style(
            rect.intersection(area),
            TStyle::default().add_modifier(Modifier::REVERSED),
        );
    }

    // ── measure ─────────────────────────────────────────────────────────

    /// The node's desired cell size at `avail_w` width. `avail_h` is the
    /// parent's height for `%` heights (`0` = unknown).
    pub fn measure(&self, node: &ResolvedNode, avail_w: u16, avail_h: u16) -> Dim {
        let style = self.style(node);
        if hidden(&style) {
            return Dim::default();
        }
        // CSS: a `%` height against a parent whose height is auto is
        // auto. `avail_h == 0` is that unknown parent; children only see a
        // height when this box has a definite one.
        let pct_unknown =
            |d: Option<&Dimension>| matches!(d, Some(Dimension::Percent(_))) && avail_h == 0;
        let height = style
            .layout
            .height
            .as_ref()
            // A composite button is sized by what it wraps, not by the
            // control height a `we-button` defaults to.
            .filter(|d| !pct_unknown(Some(d)) && !composite_button(node));
        let (bw, bh) = self.box_extra(node, &style, avail_w, avail_h);
        let inner_w = avail_w.saturating_sub(bw);
        let inner_h = if height.is_some() {
            dim_cells(
                &self.scx,
                height,
                avail_h,
                (self.scx.viewport.height / CELL_PX) as u16,
            )
            .unwrap_or(0)
            .saturating_sub(bh)
        } else {
            0
        };
        let mut dim = match tag(node) {
            Tag::Container | Tag::Card | Tag::Tooltip => match direction_of(node) {
                Direction::Row => self.measure_row(node, inner_w, inner_h),
                Direction::Column => self.measure_column(node, inner_w, inner_h),
            },
            Tag::Unknown => {
                // One line for the `[type]` label, then the children.
                let mut d = self.measure_column(node, inner_w, inner_h);
                d.h += 1;
                d.w = d.w.max(node.ty.len() as u16 + 2);
                d
            }
            Tag::Tabs => self.measure_row(node, inner_w, inner_h),
            Tag::Tree => self.measure_column(node, inner_w, inner_h),
            Tag::TreeItem => self.measure_tree_item(node, inner_w, inner_h),
            Tag::FormField => {
                let mut d = self.measure_column(node, inner_w, inner_h);
                if prop_str(node, "label").is_some() {
                    d.h += 1;
                }
                d
            }
            Tag::Text | Tag::CatalogFallback | Tag::Link => {
                let text = self.node_text(node);
                self.measure_text(&text, inner_w, node)
            }
            Tag::Input => {
                let slots =
                    self.slot_children(node, "start").len() + self.slot_children(node, "end").len();
                let rows = if node.ty.as_ref() == "we-textarea" {
                    prop_num(node, "rows").unwrap_or(3.0) as u16
                } else {
                    1
                };
                Dim::new(inner_w.min(24) + slots as u16 * 2, rows)
            }
            Tag::Select => {
                let label = self.select_label(node);
                Dim::new((UnicodeWidthStr::width(label.as_str()) + 5) as u16, 1)
            }
            Tag::Switch => {
                let label = prop_str(node, "label").unwrap_or("");
                Dim::new(2 + UnicodeWidthStr::width(label) as u16 + 1, 1)
            }
            Tag::Slider => Dim::new(inner_w.min(20), 1),
            Tag::NumberInput => Dim::new(inner_w.min(10), 1),
            Tag::Button if composite_button(node) => match direction_of(node) {
                Direction::Row => self.measure_row(node, inner_w, inner_h),
                Direction::Column => self.measure_column(node, inner_w, inner_h),
            },
            Tag::Button if bare_icon_button(node) => {
                let label = self.button_label(node);
                Dim::new(UnicodeWidthStr::width(label.as_str()) as u16, 1)
            }
            Tag::Button => {
                let label = self.button_label(node);
                Dim::new(UnicodeWidthStr::width(label.as_str()) as u16 + 4, 1)
            }
            Tag::Tab => {
                let label = self.tab_label(node);
                Dim::new(UnicodeWidthStr::width(label.as_str()) as u16 + 4, 1)
            }
            Tag::Icon => {
                let name = prop_str(node, "name").unwrap_or("");
                let w = match icons::glyph(name) {
                    Some(g) => UnicodeWidthStr::width(g),
                    None => UnicodeWidthStr::width(name),
                };
                Dim::new(w.max(1) as u16, 1)
            }
            Tag::Avatar => Dim::new(4, 1),
            Tag::Badge | Tag::Chip => {
                let label = self.node_text(node);
                Dim::new(UnicodeWidthStr::width(label.as_str()) as u16 + 2, 1)
            }
            Tag::Divider => match prop_str(node, "orientation") {
                Some("vertical") => Dim::new(1, inner_h.max(1)),
                _ => Dim::new(inner_w, 1),
            },
            Tag::Skeleton => Dim::new(
                inner_w.min(24),
                dim_cells(
                    &self.scx,
                    style.layout.height.as_ref(),
                    inner_h,
                    (self.scx.viewport.height / CELL_PX) as u16,
                )
                .unwrap_or(1)
                .max(1),
            ),
            Tag::Alert => {
                let body = self.node_text(node);
                let title = prop_str(node, "title").unwrap_or("");
                let th = (!title.is_empty()) as u16;
                let bh = if body.is_empty() {
                    0
                } else {
                    self.measure_text(&body, inner_w.saturating_sub(2), node).h
                };
                Dim::new(inner_w, (th + bh).max(1))
            }
            Tag::Modal | Tag::Popover => {
                if !prop(node, "open").truthy() {
                    Dim::new(0, 0)
                } else {
                    let d = self.measure_column(node, inner_w.saturating_sub(2), inner_h);
                    Dim::new(inner_w, d.h + 2)
                }
            }
            Tag::Menu => {
                let n = match prop(node, "items") {
                    Value::List(l) => l.len(),
                    _ => 0,
                };
                Dim::new(inner_w.min(24), n as u16)
            }
        };
        // A glyph widget is the size of what it draws: an avatar's `(AB)`,
        // a chromeless icon button's glyph. Its CSS box (a 64px avatar, a
        // 40px square) would be eight and five blank cells beside a name
        // the row then has to cut.
        if tag(node) == Tag::Avatar || bare_icon_button(node) {
            return dim;
        }
        // Explicit width/height override the intrinsic size; min/max clamp.
        let vw = (self.scx.viewport.width / CELL_PX) as u16;
        let vh = (self.scx.viewport.height / CELL_PX) as u16;
        if let Some(w) = dim_cells(&self.scx, style.layout.width.as_ref(), avail_w, vw) {
            dim.w = w;
        }
        if let Some(h) = dim_cells(&self.scx, height, avail_h, vh) {
            dim.h = h;
        }
        dim.w = dim.w.saturating_add(bw).min(avail_w.max(1));
        dim.h = dim.h.saturating_add(bh).min(MAX_LINES);
        if let Some(mw) = dim_cells(&self.scx, style.layout.min_width.as_ref(), avail_w, vw) {
            dim.w = dim.w.max(mw);
        }
        if let Some(mw) = dim_cells(&self.scx, style.layout.max_width.as_ref(), avail_w, vw) {
            dim.w = dim.w.min(mw.max(1));
        }
        let min_height = style
            .layout
            .min_height
            .as_ref()
            .filter(|_| !composite_button(node));
        if let Some(mh) = dim_cells(&self.scx, min_height, avail_h, vh) {
            dim.h = dim.h.max(mh);
        }
        if let Some(mh) = dim_cells(&self.scx, style.layout.max_height.as_ref(), avail_h, vh) {
            dim.h = dim.h.min(mh.max(1));
        }
        dim
    }

    /// Cells borders + padding take — the box inset around content.
    fn box_extra(
        &self,
        node: &ResolvedNode,
        style: &we_style::Style,
        avail_w: u16,
        avail_h: u16,
    ) -> (u16, u16) {
        let (l, t, r, b) = self.box_inset(node, style, avail_w, avail_h);
        (l + r, t + b)
    }

    /// The box insets: (left, top, right, bottom) cells — a painted border
    /// side counts 1, a Card's own frame claims its side too, padding
    /// resolves through `dim_cells`.
    fn box_inset(
        &self,
        node: &ResolvedNode,
        style: &we_style::Style,
        avail_w: u16,
        avail_h: u16,
    ) -> (u16, u16, u16, u16) {
        let vw = (self.scx.viewport.width / CELL_PX) as u16;
        let vh = (self.scx.viewport.height / CELL_PX) as u16;
        let card = tag(node) == Tag::Card;
        let side = |s: &Option<we_style::BorderSide>| match s {
            Some(s) if !matches!(s.kind, BorderKind::None | BorderKind::Hidden) => 1,
            _ if card => 1,
            _ => 0,
        };
        (
            side(&style.paint.borders.left)
                + dim_cells(&self.scx, style.layout.padding.left.as_ref(), avail_w, vw)
                    .unwrap_or(0),
            side(&style.paint.borders.top)
                + dim_cells(&self.scx, style.layout.padding.top.as_ref(), avail_h, vh).unwrap_or(0),
            side(&style.paint.borders.right)
                + dim_cells(&self.scx, style.layout.padding.right.as_ref(), avail_w, vw)
                    .unwrap_or(0),
            side(&style.paint.borders.bottom)
                + dim_cells(&self.scx, style.layout.padding.bottom.as_ref(), avail_h, vh)
                    .unwrap_or(0),
        )
    }

    fn gap_cells(&self, style: &we_style::Style, dir: Direction) -> u16 {
        let (row_gap, col_gap) = match style.layout.gap {
            Some(g) => (Some(g.0), Some(g.1)),
            None => (None, None),
        };
        let d = match dir {
            Direction::Row => col_gap.or(row_gap),
            Direction::Column => row_gap.or(col_gap),
        };
        dim_cells(&self.scx, d.as_ref(), 100, 100).unwrap_or(0)
    }

    /// A column's intrinsic size: widest child + stacked heights + gaps.
    fn measure_column(&self, node: &ResolvedNode, avail_w: u16, avail_h: u16) -> Dim {
        let style = self.style(node);
        let gap = self.gap_cells(&style, Direction::Column);
        let mut w = 0u16;
        let mut h = 0u16;
        for (i, (dim, _)) in self
            .measure_children(node, avail_w, avail_h)
            .iter()
            .flatten()
            .enumerate()
        {
            w = w.max(dim.w);
            h = h
                .saturating_add(dim.h)
                .saturating_add(if i > 0 { gap } else { 0 });
        }
        Dim::new(w, h)
    }

    /// A row's intrinsic size: summed widths + tallest child + gaps.
    fn measure_row(&self, node: &ResolvedNode, avail_w: u16, avail_h: u16) -> Dim {
        let style = self.style(node);
        let gap = self.gap_cells(&style, Direction::Row);
        let mut w = 0u16;
        let mut h = 0u16;
        for (i, (dim, _)) in self
            .measure_children(node, avail_w, avail_h)
            .iter()
            .flatten()
            .enumerate()
        {
            w = w
                .saturating_add(dim.w)
                .saturating_add(if i > 0 { gap } else { 0 });
            h = h.max(dim.h);
        }
        Dim::new(w, h)
    }

    /// Each child's measured size + whether `flex` marks it as springy —
    /// `None` for a `display: none` child, which is not in the flow at all
    /// (no size, no gap).
    fn measure_children(
        &self,
        node: &ResolvedNode,
        avail_w: u16,
        avail_h: u16,
    ) -> Vec<Option<(Dim, bool)>> {
        node.children
            .iter()
            .map(|c| match c {
                ResolvedChild::Node(n) if hidden(&self.style(n)) => None,
                c => Some(self.measure_child(c, avail_w, avail_h)),
            })
            .collect()
    }

    /// One shown child's size and springiness.
    fn measure_child(&self, c: &ResolvedChild, avail_w: u16, avail_h: u16) -> (Dim, bool) {
        match c {
            ResolvedChild::Node(n) if self.out_of_flow(n).is_some() => (Dim::new(0, 0), false),
            // A collapsed `$lane` is a 4px strip in we-egui — under a
            // cell, so nothing here.
            ResolvedChild::Node(n) if n.ty.as_ref() == "$lane" && prop_bool(n, "collapsed") => {
                (Dim::new(0, 0), false)
            }
            ResolvedChild::Node(n) => {
                let flex = self.style(n).layout.flex.is_some_and(|f| f.grow > 0.0);
                (self.measure(n, avail_w, avail_h), flex)
            }
            ResolvedChild::Text(t) => {
                let w = UnicodeWidthStr::width(t.as_ref()) as u16;
                (Dim::new(w.min(avail_w), 1), false)
            }
        }
    }

    fn measure_tree_item(&self, node: &ResolvedNode, avail_w: u16, avail_h: u16) -> Dim {
        let mut h = 1u16;
        if tree_open(node) {
            for c in self.slot_children(node, "children") {
                if let ResolvedChild::Node(n) = c {
                    h = h.saturating_add(self.measure(n, avail_w, avail_h).h);
                }
            }
        }
        Dim::new(avail_w, h)
    }

    /// Children carrying `slot` — the resolved `slot` field marks them.
    fn slot_children<'n>(&self, node: &'n ResolvedNode, slot: &str) -> Vec<&'n ResolvedChild> {
        node.children
            .iter()
            .filter(|c| matches!(c, ResolvedChild::Node(n) if n.slot.as_deref() == Some(slot)))
            .collect()
    }

    /// Children *without* `slot` — the default slot.
    fn default_children<'n>(&self, node: &'n ResolvedNode) -> Vec<&'n ResolvedChild> {
        node.children
            .iter()
            .filter(|c| !matches!(c, ResolvedChild::Node(n) if n.slot.is_some()))
            .collect()
    }

    /// The display text of a node — the catalog's fallback: `text`/
    /// `label`/`value` then text children, per-role shapes for media and
    /// graphs.
    fn node_text(&self, node: &ResolvedNode) -> String {
        if node.ty.as_ref() == "we-timestamp" {
            if let Some(day) = prop_str(node, "value").and_then(iso_day) {
                return day.to_string();
            }
        }
        match we_catalog::entry(node.ty.as_ref()) {
            Some(_) => we_catalog::text_fallback(node),
            None => String::new(),
        }
    }

    /// Wrap `text` at `width` cells: greedy words, hard-split long words.
    /// `node`'s `truncate`/`lines` cap the result when `Some`.
    fn wrap(&self, text: &str, width: u16, node: Option<&ResolvedNode>) -> Vec<String> {
        let width = width.max(1) as usize;
        let mut lines: Vec<String> = Vec::new();
        for raw in text.split('\n') {
            if raw.is_empty() {
                lines.push(String::new());
                continue;
            }
            let mut line = String::new();
            let mut lw = 0usize;
            for word in raw.split(' ') {
                let ww = UnicodeWidthStr::width(word);
                let sep = if lw == 0 { 0 } else { 1 };
                if lw > 0 && lw + sep + ww > width {
                    lines.push(std::mem::take(&mut line));
                    lw = 0;
                }
                if lw == 0 && ww > width {
                    // A word longer than the line — hard-break by chars.
                    let mut rest = word;
                    while UnicodeWidthStr::width(rest) > width {
                        let (head, tail) = split_at_cells(rest, width);
                        if head.is_empty() {
                            // One glyph wider than the whole line (a CJK
                            // char or emoji at width 1): it can never fit,
                            // so it becomes a one-cell marker and the walk
                            // moves past it — every turn consumes a char.
                            let skip = rest.chars().next().map_or(rest.len(), char::len_utf8);
                            lines.push(TOO_WIDE.to_string());
                            rest = &rest[skip..];
                            continue;
                        }
                        lines.push(head.to_string());
                        rest = tail;
                    }
                    if !rest.is_empty() {
                        line.push_str(rest);
                        lw = UnicodeWidthStr::width(rest);
                    }
                    continue;
                }
                if !line.is_empty() {
                    line.push(' ');
                }
                line.push_str(word);
                lw += sep + ww;
            }
            lines.push(line);
        }
        if let Some(node) = node {
            if prop_bool(node, "truncate") {
                lines.truncate(1);
            }
            if let Some(max) = prop_num(node, "lines") {
                if max > 0.0 {
                    lines.truncate(max as usize);
                }
            }
        }
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    fn measure_text(&self, text: &str, avail_w: u16, node: &ResolvedNode) -> Dim {
        let w = (UnicodeWidthStr::width(text) as u16).min(avail_w).max(1);
        Dim::new(w, self.wrap(text, avail_w.max(1), Some(node)).len() as u16)
    }

    fn select_label(&self, node: &ResolvedNode) -> String {
        match prop(node, "value") {
            Value::Str(v) if !v.is_empty() => v.to_string(),
            Value::Undefined | Value::Null => prop_str(node, "placeholder")
                .unwrap_or("select")
                .to_string(),
            v => v.js_string(),
        }
    }

    // ── paint ───────────────────────────────────────────────────────────

    /// Paint `node` into `area` — the entry point of the recursive walk.
    pub fn paint(&mut self, node: &ResolvedNode, area: Rect, env: &Env) {
        // `display: none` — the node and its subtree are gone: nothing
        // painted, nothing focusable (we-layout drops them the same way).
        if hidden(&self.style(node)) {
            return;
        }
        if area.width == 0 || area.height == 0 {
            self.paint_out_of_flow(node, area, env);
            return;
        }
        let style = self.style(node);
        let ink = Ink::of(&style, env);
        let mut env = env.clone();
        if style.text.color.is_some() {
            env.fg = style.text.color;
        }
        if ink.bold {
            env.bold = true;
        }
        // The node's own bg covers its whole box; children paint over it.
        if let Some(bg) = ink.bg.and_then(|c| tui_color(c, self.truecolor)) {
            self.fill(
                area,
                area,
                TStyle::default().bg(bg).fg(rc(
                    ink.fg.unwrap_or_else(|| self.default_fg()),
                    self.truecolor,
                )),
            );
        }
        self.paint_borders(&style, area, ink.fg);
        let (l, t, r, b) = self.box_inset(node, &style, area.width, area.height);
        let inner = Rect {
            x: area.x.saturating_add(l),
            y: area.y.saturating_add(t),
            width: area.width.saturating_sub(l + r),
            height: area.height.saturating_sub(t + b),
        };
        if inner.width == 0 || inner.height == 0 {
            self.paint_out_of_flow(node, inner, &env);
            return;
        }

        // Focusable nodes register their visible row — the rect the cursor
        // highlight reverses.
        if let Some(kind) = self.focus_kind(node, &env) {
            let row = Rect {
                height: inner.height.min(1),
                ..inner
            };
            self.mark_focus(node, kind, row);
        }

        match tag(node) {
            Tag::Tooltip | Tag::Container => self.paint_children(node, inner, &env),
            Tag::Card => {
                self.paint_card_frame(node, &style, area);
                self.paint_children(node, inner, &env);
            }
            Tag::FormField => self.paint_form_field(node, inner, &env),
            Tag::Unknown => {
                let label = format!("[{}]", node.ty);
                let fg = self
                    .palette
                    .danger
                    .unwrap_or(WColor::new(1.0, 0.3, 0.3, 1.0));
                self.put(
                    inner,
                    inner.x,
                    inner.y,
                    &label,
                    TStyle::default().fg(rc(fg, self.truecolor)),
                );
                let rest = Rect {
                    y: inner.y + 1,
                    height: inner.height.saturating_sub(1),
                    ..inner
                };
                self.paint_children(node, rest, &env);
            }
            Tag::Tree => {
                let sel = prop(node, "selected");
                env.tree_sel = (!sel.is_undefined()).then(|| sel.clone());
                self.paint_children(node, inner, &env);
            }
            Tag::TreeItem => self.paint_tree_item(node, inner, &env),
            Tag::Text | Tag::Link | Tag::CatalogFallback => {
                let mut ink = ink;
                if tag(node) == Tag::Link {
                    ink.underline = true;
                    ink.fg = ink.fg.or(self.palette.accent_text);
                }
                let text = self.node_text(node);
                let up = matches!(
                    style.text.transform,
                    Some(we_style::TextTransform::Uppercase)
                ) || prop_bool(node, "uppercase");
                let text = if up { text.to_uppercase() } else { text };
                self.paint_text(&text, inner, &ink, node);
            }
            Tag::Input | Tag::NumberInput => self.paint_input(node, inner, &ink, &env),
            Tag::Select => self.paint_select(node, inner, &ink),
            Tag::Switch => self.paint_switch(node, inner, &ink),
            Tag::Slider => self.paint_slider(node, inner, &ink),
            Tag::Button if composite_button(node) => self.paint_children(node, inner, &env),
            Tag::Button => self.paint_button(node, inner, &ink),
            Tag::Icon => self.paint_icon(node, inner, &ink),
            Tag::Avatar => self.paint_avatar(node, inner, &ink),
            Tag::Badge | Tag::Chip => self.paint_badge(node, inner, &ink),
            Tag::Divider => self.paint_divider(node, inner, &ink),
            Tag::Skeleton => self.paint_skeleton(inner, &ink),
            Tag::Alert => self.paint_alert(node, inner, &ink),
            Tag::Modal | Tag::Popover => {
                if prop(node, "open").truthy() {
                    let title = prop_str(node, "title").unwrap_or(node.ty.as_ref());
                    self.paint_overlay_box(node, inner, &env, title);
                }
            }
            Tag::Menu => self.paint_menu(node, inner, &ink),
            Tag::Tabs => {
                let sel = prop(node, "selectedKey");
                env.tabs_id = Some(node.id.clone());
                env.tabs_sel = (!sel.is_undefined()).then(|| sel.clone());
                // A tab strip is one horizontal strip, whatever direction
                // its `direction` prop claims.
                let st = self.style(node);
                self.layout_row(node, inner, &st, &env);
            }
            Tag::Tab => self.paint_tab(node, inner, &ink, &env),
        }
    }

    /// A solid border on any side → a box-drawing frame (rounded corners
    /// when a radius resolved); `border_color` or the border role colours
    /// it.
    fn paint_borders(&mut self, style: &we_style::Style, area: Rect, fg: Option<WColor>) {
        let b = &style.paint.borders;
        let has = |s: &Option<we_style::BorderSide>| matches!(s, Some(s) if !matches!(s.kind, BorderKind::None | BorderKind::Hidden));
        let (top, right, bottom, left) = (has(&b.top), has(&b.right), has(&b.bottom), has(&b.left));
        if !(top || right || bottom || left) {
            return;
        }
        let color = style
            .paint
            .border_color
            .or_else(|| {
                [
                    b.top.as_ref(),
                    b.right.as_ref(),
                    b.bottom.as_ref(),
                    b.left.as_ref(),
                ]
                .into_iter()
                .flatten()
                .find_map(|s| s.color)
            })
            .or(self.palette.border)
            .or(fg);
        let st = TStyle::default().fg(rc(
            color.unwrap_or(WColor::new(0.5, 0.5, 0.5, 1.0)),
            self.truecolor,
        ));
        let rounded = style.paint.radius.as_slice().iter().any(|s| s.is_some());
        let (tl, tr, bl, br) = if rounded {
            ("╭", "╮", "╰", "╯")
        } else {
            ("┌", "┐", "└", "┘")
        };
        let x2 = area.x + area.width - 1;
        let y2 = area.y + area.height - 1;
        if top {
            for x in area.x..=x2 {
                self.put(area, x, area.y, "─", st);
            }
        }
        if bottom {
            for x in area.x..=x2 {
                self.put(area, x, y2, "─", st);
            }
        }
        if left {
            for y in area.y..=y2 {
                self.put(area, area.x, y, "│", st);
            }
        }
        if right {
            for y in area.y..=y2 {
                self.put(area, x2, y, "│", st);
            }
        }
        if top && left {
            self.put(area, area.x, area.y, tl, st);
        }
        if top && right {
            self.put(area, x2, area.y, tr, st);
        }
        if bottom && left {
            self.put(area, area.x, y2, bl, st);
        }
        if bottom && right {
            self.put(area, x2, y2, br, st);
        }
    }

    /// A card's own frame — rounded corners in the border role — on the
    /// sides the style's borders didn't already claim, plus `title` on the
    /// frame.
    fn paint_card_frame(&mut self, node: &ResolvedNode, style: &we_style::Style, area: Rect) {
        if area.width < 2 || area.height < 2 {
            return;
        }
        let b = &style.paint.borders;
        let has = |s: &Option<we_style::BorderSide>| matches!(s, Some(s) if !matches!(s.kind, BorderKind::None | BorderKind::Hidden));
        let (top, right, bottom, left) =
            (!has(&b.top), !has(&b.right), !has(&b.bottom), !has(&b.left));
        let fg = self
            .palette
            .border
            .unwrap_or(WColor::new(0.5, 0.5, 0.5, 1.0));
        let st = TStyle::default().fg(rc(fg, self.truecolor));
        let x2 = area.x + area.width - 1;
        let y2 = area.y + area.height - 1;
        if top {
            for x in area.x..=x2 {
                self.put(area, x, area.y, "─", st);
            }
        }
        if bottom {
            for x in area.x..=x2 {
                self.put(area, x, y2, "─", st);
            }
        }
        if left {
            for y in area.y..=y2 {
                self.put(area, area.x, y, "│", st);
            }
        }
        if right {
            for y in area.y..=y2 {
                self.put(area, x2, y, "│", st);
            }
        }
        if top && left {
            self.put(area, area.x, area.y, "╭", st);
        }
        if top && right {
            self.put(area, x2, area.y, "╮", st);
        }
        if bottom && left {
            self.put(area, area.x, y2, "╰", st);
        }
        if bottom && right {
            self.put(area, x2, y2, "╯", st);
        }
        if let Some(title) = prop_str(node, "title") {
            if !title.is_empty() && area.width > 4 {
                self.put(
                    area,
                    area.x + 2,
                    area.y,
                    &format!(" {title} "),
                    TStyle::default()
                        .fg(rc(self.default_fg(), self.truecolor))
                        .add_modifier(Modifier::BOLD),
                );
            }
        }
    }

    /// Children in the node's direction, filling `inner`.
    fn paint_children(&mut self, node: &ResolvedNode, inner: Rect, env: &Env) {
        let style = self.style(node);
        match direction_of(node) {
            Direction::Column => self.layout_column(node, inner, &style, env),
            Direction::Row => self.layout_row(node, inner, &style, env),
        }
        self.paint_out_of_flow(node, inner, env);
    }

    /// `position: fixed|absolute` children left the flow (they measured
    /// 0×0); paint them over it at their insets — the frame's viewport for
    /// `fixed`, `inner` for `absolute`. Also called when the parent's own
    /// box is empty: a fixed shell inside a zero-height wrapper still shows.
    fn paint_out_of_flow(&mut self, node: &ResolvedNode, inner: Rect, env: &Env) {
        let empty = inner.width == 0 || inner.height == 0;
        for c in &node.children {
            let ResolvedChild::Node(n) = c else { continue };
            if empty && self.out_of_flow(n).is_none() {
                // An in-flow child of an empty box is empty too — walk on
                // for the fixed boxes below it.
                self.paint(n, Rect::new(inner.x, inner.y, 0, 0), env);
                continue;
            }
            let Some(base) = self.out_of_flow(n).map(|fixed| {
                if fixed {
                    Rect::new(
                        0,
                        0,
                        (self.scx.viewport.width / CELL_PX) as u16,
                        (self.scx.viewport.height / CELL_PX) as u16,
                    )
                } else {
                    inner
                }
            }) else {
                continue;
            };
            let rect = self.placed_rect(n, base);
            self.paint(n, rect, env);
        }
    }

    /// `Some(true)` for a `position: fixed` node, `Some(false)` for
    /// `absolute`, `None` for one in flow.
    fn out_of_flow(&self, node: &ResolvedNode) -> Option<bool> {
        match self.style(node).layout.position {
            Some(we_style::Position::Fixed) => Some(true),
            Some(we_style::Position::Absolute) => Some(false),
            _ => None,
        }
    }

    /// An out-of-flow box inside `base`: its measured size at `base`'s
    /// size (an explicit `%` resolves against it), offset by `left`/`top`
    /// — or pinned by `right`/`bottom` when only those are given; both
    /// insets on an axis without a size stretch it between them.
    fn placed_rect(&self, node: &ResolvedNode, base: Rect) -> Rect {
        let style = self.style(node);
        let vw = (self.scx.viewport.width / CELL_PX) as u16;
        let vh = (self.scx.viewport.height / CELL_PX) as u16;
        let inset = &style.layout.inset;
        let l = dim_cells(&self.scx, inset.left.as_ref(), base.width, vw);
        let r = dim_cells(&self.scx, inset.right.as_ref(), base.width, vw);
        let t = dim_cells(&self.scx, inset.top.as_ref(), base.height, vh);
        let b = dim_cells(&self.scx, inset.bottom.as_ref(), base.height, vh);
        let dim = self.measure(node, base.width, base.height);
        let (x, w) = match (l, r, style.layout.width.is_some()) {
            (Some(l), Some(r), false) => (l, base.width.saturating_sub(l + r)),
            (Some(l), _, _) => (l, dim.w),
            (None, Some(r), _) => (base.width.saturating_sub(r + dim.w), dim.w),
            (None, None, _) => (0, dim.w),
        };
        let (y, h) = match (t, b, style.layout.height.is_some()) {
            (Some(t), Some(b), false) => (t, base.height.saturating_sub(t + b)),
            (Some(t), _, _) => (t, dim.h),
            (None, Some(b), _) => (base.height.saturating_sub(b + dim.h), dim.h),
            (None, None, _) => (0, dim.h),
        };
        let x = base.x.saturating_add(x);
        let y = base.y.saturating_add(y);
        let w = w.min((base.x + base.width).saturating_sub(x));
        Rect::new(x, y, w, h)
    }

    /// Vertical stack: children take their measured height, `flex` splits
    /// the leftover, `ax` justifies, `ay` aligns across.
    fn layout_column(
        &mut self,
        node: &ResolvedNode,
        inner: Rect,
        style: &we_style::Style,
        env: &Env,
    ) {
        let gap = self.gap_cells(style, Direction::Column);
        let all = self.measure_children(node, inner.width, inner.height);
        let dims: Vec<(Dim, bool)> = all.iter().flatten().copied().collect();
        let n = dims.len();
        // Only non-flex children count toward the fixed share — a flex
        // child's own intrinsic size is its minimum, not part of `fixed`.
        let fixed: u16 = dims
            .iter()
            .map(|(d, f)| if *f { 0 } else { d.h })
            .sum::<u16>()
            .saturating_add(gap.saturating_mul(n.saturating_sub(1) as u16));
        let leftover = inner.height.saturating_sub(fixed);
        let n_flex = dims.iter().filter(|(_, f)| *f).count() as u16;
        let justify = style.layout.justify.clone().unwrap_or(ItemAlign::Start);
        let align = style.layout.align.clone().unwrap_or(ItemAlign::Stretch);

        // Main-axis offsets — `space-between` widens the gaps, center/end
        // shift the whole block.
        let (mut y, extra_gap) = match justify {
            ItemAlign::SpaceBetween if n > 1 => (inner.y, leftover / (n as u16 - 1).max(1)),
            ItemAlign::Center => (inner.y + leftover / 2, 0),
            ItemAlign::End => (inner.y + leftover, 0),
            _ => (inner.y, 0),
        };

        // Shown children only, each with its measured entry.
        let shown = node
            .children
            .iter()
            .zip(&all)
            .filter_map(|(c, d)| d.map(|d| (c, d)));
        for (c, (dim, flex)) in shown {
            if y >= inner.y + inner.height {
                break;
            }
            if matches!(c, ResolvedChild::Node(n) if self.out_of_flow(n).is_some()) {
                continue;
            }
            let h = if flex {
                (leftover / n_flex.max(1)).max(dim.h.min(leftover))
            } else {
                dim.h
            }
            .min(inner.y + inner.height - y);
            let w = dim.w.min(inner.width);
            let x = match align {
                ItemAlign::Start | ItemAlign::Baseline => inner.x,
                ItemAlign::Center => inner.x + inner.width.saturating_sub(w) / 2,
                ItemAlign::End => inner.x + inner.width.saturating_sub(w),
                _ => inner.x,
            };
            let w = match align {
                ItemAlign::Stretch | ItemAlign::Auto => inner.width,
                _ => w,
            };
            let rect = Rect {
                x,
                y,
                width: w,
                height: h,
            };
            self.paint_child(c, rect, env, inner);
            y = y
                .saturating_add(h)
                .saturating_add(gap)
                .saturating_add(extra_gap);
        }
    }

    /// Horizontal stack: fixed children take measured width, `flex` splits
    /// the rest; `ax` justifies, `ay` aligns vertically.
    fn layout_row(&mut self, node: &ResolvedNode, inner: Rect, style: &we_style::Style, env: &Env) {
        let gap = self.gap_cells(style, Direction::Row);
        let all = self.measure_children(node, inner.width, inner.height);
        let dims: Vec<(Dim, bool)> = all.iter().flatten().copied().collect();
        let n = dims.len();
        let fixed: u16 = dims
            .iter()
            .map(|(d, f)| if *f { 0 } else { d.w })
            .sum::<u16>()
            .saturating_add(gap.saturating_mul(n.saturating_sub(1) as u16));
        let leftover = inner.width.saturating_sub(fixed);
        let n_flex = dims.iter().filter(|(_, f)| *f).count() as u16;
        let justify = style.layout.justify.clone().unwrap_or(ItemAlign::Start);
        let align = style.layout.align.clone().unwrap_or(ItemAlign::Center);

        let (mut x, extra_gap) = match justify {
            ItemAlign::SpaceBetween if n > 1 => (inner.x, leftover / (n as u16 - 1).max(1)),
            ItemAlign::Center => (inner.x + leftover / 2, 0),
            ItemAlign::End => (inner.x + leftover, 0),
            _ => (inner.x, 0),
        };

        // Shown children only, each with its measured entry.
        let shown = node
            .children
            .iter()
            .zip(&all)
            .filter_map(|(c, d)| d.map(|d| (c, d)));
        for (c, (dim, flex)) in shown {
            if x >= inner.x + inner.width {
                break;
            }
            if matches!(c, ResolvedChild::Node(n) if self.out_of_flow(n).is_some()) {
                continue;
            }
            let w = if flex {
                (leftover / n_flex.max(1)).max(dim.w.min(leftover))
            } else {
                dim.w
            }
            .min(inner.x + inner.width - x);
            let h0 = dim.h.min(inner.height);
            // Center is a row's own default — `ay: center` rows keep
            // single-line children on the row line.
            let (h, y) = match align {
                ItemAlign::Start | ItemAlign::Baseline => (h0, inner.y),
                ItemAlign::End => (h0, inner.y + inner.height.saturating_sub(h0)),
                ItemAlign::Stretch | ItemAlign::Auto => (inner.height, inner.y),
                _ => (h0, inner.y + inner.height.saturating_sub(h0) / 2),
            };
            let rect = Rect {
                x,
                y,
                width: w,
                height: h,
            };
            self.paint_child(c, rect, env, inner);
            x = x
                .saturating_add(w)
                .saturating_add(gap)
                .saturating_add(extra_gap);
        }
    }

    /// One child — a node or an inline text run.
    fn paint_child(&mut self, c: &ResolvedChild, rect: Rect, env: &Env, clip: Rect) {
        match c {
            ResolvedChild::Node(n) => self.paint(n, rect.intersection(clip), env),
            ResolvedChild::Text(t) => {
                let ink = Ink {
                    fg: env.fg,
                    bg: None,
                    bold: env.bold,
                    underline: false,
                    dim: false,
                };
                self.put(clip, rect.x, rect.y, t, ink.style(self, self.default_fg()));
            }
        }
    }

    /// Wrapped text lines at the ink's style, honouring `truncate` and
    /// text-align.
    fn paint_text(&mut self, text: &str, area: Rect, ink: &Ink, node: &ResolvedNode) {
        let style = self.style(node);
        let lines = self.wrap(text, area.width, Some(node));
        let full = self.wrap(text, area.width, None);
        let clipped = full.len() > lines.len()
            || (lines.len() == 1
                && UnicodeWidthStr::width(text) > area.width as usize
                && prop_bool(node, "truncate"));
        let st = ink.style(self, self.default_fg());
        for (i, line) in lines.iter().enumerate() {
            let y = area.y + i as u16;
            if y >= area.y + area.height {
                break;
            }
            let mut line = line.clone();
            if clipped && i + 1 == lines.len() {
                line = truncate_str(&line, (area.width as usize).saturating_sub(1));
                line.push('…');
            }
            let lw = UnicodeWidthStr::width(line.as_str()) as u16;
            let x = match style.text.align {
                Some(we_style::TextAlign::Center) => {
                    area.x + area.width.saturating_sub(lw.min(area.width)) / 2
                }
                Some(we_style::TextAlign::Right | we_style::TextAlign::End) => {
                    area.x + area.width.saturating_sub(lw.min(area.width))
                }
                _ => area.x,
            };
            self.put(area, x, y, &line, st);
        }
    }

    // ── widgets ─────────────────────────────────────────────────────────

    /// `▸/▾ caret · icon? · content · actions` on one line; open items
    /// paint their `slot="children"` items indented below.
    fn paint_tree_item(&mut self, node: &ResolvedNode, area: Rect, env: &Env) {
        let open = tree_open(node);
        let expandable = tree_expandable(node);
        let mut env = env.clone();
        env.tree_depth += 1;
        let depth = env.tree_depth - 1;

        let selected = env
            .tree_sel
            .as_ref()
            .is_some_and(|s| s.strict_eq(prop(node, "value")));
        let indent = depth * 2;
        let row = Rect {
            height: area.height.min(1),
            ..area
        };
        if selected {
            if let Some(bg) = self
                .palette
                .accent_soft
                .and_then(|c| tui_color(c, self.truecolor))
            {
                self.fill(area, row, TStyle::default().bg(bg));
            }
        }
        let x0 = area.x + indent.min(area.width.saturating_sub(2));
        let mut x = x0;
        let caret = if expandable {
            if open {
                "▾ "
            } else {
                "▸ "
            }
        } else {
            "  "
        };
        let caret_fg = self
            .palette
            .faint
            .or(self.palette.muted)
            .unwrap_or_else(|| self.default_fg());
        self.put(
            area,
            x,
            area.y,
            caret,
            TStyle::default().fg(rc(caret_fg, self.truecolor)),
        );
        x += 2;
        // icon-slot children inline after the caret.
        for c in self.slot_children(node, "icon") {
            if let ResolvedChild::Node(n) = c {
                let w = self.measure(n, area.width, 1).w.min(4);
                self.paint(
                    n,
                    Rect {
                        x,
                        y: area.y,
                        width: w,
                        height: 1,
                    },
                    &env,
                );
                x += w + 1;
            }
        }
        // The default slot — usually a single Row of icon+text+badge.
        let actions = self.slot_children(node, "actions");
        let actions_w: u16 = actions
            .iter()
            .map(|c| match c {
                ResolvedChild::Node(n) => self.measure(n, 24, 1).w + 1,
                ResolvedChild::Text(t) => UnicodeWidthStr::width(t.as_ref()) as u16 + 1,
            })
            .sum();
        let content_end = (area.x + area.width).saturating_sub(actions_w.min(area.width / 2));
        for c in self.default_children(node) {
            if x >= content_end {
                break;
            }
            match c {
                ResolvedChild::Node(n) => {
                    let d = self.measure(n, content_end.saturating_sub(x), 1);
                    self.paint(
                        n,
                        Rect {
                            x,
                            y: area.y,
                            width: content_end.saturating_sub(x),
                            height: 1,
                        },
                        &env,
                    );
                    x += d.w;
                }
                ResolvedChild::Text(t) => {
                    let st = TStyle::default()
                        .fg(rc(self.default_fg(), self.truecolor))
                        .add_modifier(if env.bold {
                            Modifier::BOLD
                        } else {
                            Modifier::empty()
                        });
                    self.put(area, x, area.y, t, st);
                    x += UnicodeWidthStr::width(t.as_ref()) as u16;
                }
            }
        }
        // actions slot hugs the right edge.
        let mut ax = content_end + 1;
        for c in actions {
            if let ResolvedChild::Node(n) = c {
                let w = self
                    .measure(n, (area.x + area.width).saturating_sub(ax), 1)
                    .w;
                self.paint(
                    n,
                    Rect {
                        x: ax,
                        y: area.y,
                        width: w,
                        height: 1,
                    },
                    &env,
                );
                ax += w + 1;
            }
        }
        // Nested items, one depth in.
        if open {
            let nested = Rect {
                y: area.y + 1,
                height: area.height.saturating_sub(1),
                ..area
            };
            let mut ny = nested.y;
            for c in self.slot_children(node, "children") {
                if ny >= nested.y + nested.height {
                    break;
                }
                if let ResolvedChild::Node(n) = c {
                    let d = self.measure(n, nested.width, nested.height);
                    self.paint(
                        n,
                        Rect {
                            y: ny,
                            height: d.h.min(nested.y + nested.height - ny),
                            ..nested
                        },
                        &env,
                    );
                    ny = ny.saturating_add(d.h);
                }
            }
        }
    }

    /// What a button's label measures and paints as — `square` icon
    /// buttons show their icon glyph, everything else the catalog's text.
    fn button_label(&self, node: &ResolvedNode) -> String {
        if prop_bool(node, "square") {
            let g = self
                .default_children(node)
                .iter()
                .find_map(|c| match c {
                    ResolvedChild::Node(n) => {
                        let name = prop_str(n, "name").unwrap_or("");
                        if name.is_empty() {
                            let t = self.node_text(n);
                            (!t.is_empty()).then_some(t)
                        } else {
                            Some(icons::glyph(name).unwrap_or(name).to_string())
                        }
                    }
                    ResolvedChild::Text(_) => None,
                })
                .unwrap_or_else(|| self.node_text(node));
            return if g.is_empty() { "?".to_string() } else { g };
        }
        let label = self.node_text(node);
        if label.is_empty() {
            "button".to_string()
        } else {
            label
        }
    }

    /// `[ label ]` — variant decides the look: solid fills, outline
    /// brackets, ghost/bare plain text. `square` icon buttons show their
    /// icon glyph.
    fn paint_button(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let label = self.button_label(node);
        if bare_icon_button(node) {
            let st = ink.style(self, self.default_fg());
            self.put(area, area.x, area.y, &label, st);
            return;
        }
        let variant = prop_str(node, "variant").unwrap_or("solid");
        let mut st = ink.style(self, self.default_fg());
        if prop_bool(node, "disabled") {
            st = st.add_modifier(Modifier::DIM);
        }
        let (l, r) = match variant {
            "ghost" | "bare" => (" ", " "),
            _ => ("[", "]"),
        };
        self.put(area, area.x, area.y, &format!("{l} {label} {r}"), st);
    }

    /// The icon's glyph — its `name` mapped, the catalog label when the
    /// map has no entry.
    fn paint_icon(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let name = prop_str(node, "name").unwrap_or("");
        let g = icons::glyph(name).unwrap_or(name);
        let fg = ink
            .fg
            .or(self.palette.faint)
            .or(self.palette.muted)
            .unwrap_or_else(|| self.default_fg());
        let mut ink = *ink;
        ink.fg = Some(fg);
        self.put(area, area.x, area.y, g, ink.style(self, self.default_fg()));
    }

    /// `(AB)` — initials from the `initials` prop (a name; the widget
    /// derives the letters), or the `icon` prop's glyph.
    fn paint_avatar(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let label = prop_str(node, "initials").map(initials_of).or_else(|| {
            prop_str(node, "icon").and_then(|i| icons::glyph(i).map(|g| g.to_string()))
        });
        let text = match label {
            Some(l) if !l.is_empty() => format!("({l})"),
            _ => "(?)".to_string(),
        };
        let mut ink = *ink;
        ink.bold = true;
        self.put(
            area,
            area.x,
            area.y,
            &text,
            ink.style(self, self.default_fg()),
        );
    }

    /// `[x]` chips — badge and tag share the shape, tone colours it.
    fn paint_badge(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let label = self.node_text(node);
        self.put(
            area,
            area.x,
            area.y,
            &format!("[{label}]"),
            ink.style(self, self.default_fg()),
        );
    }

    /// A tab's label — `label`, else inline text children (the catalog
    /// doesn't know `we-tab`, so `node_text` answers nothing).
    fn tab_label(&self, node: &ResolvedNode) -> String {
        if let Some(l) = prop_str(node, "label") {
            return l.to_string();
        }
        let mut label = self.node_text(node);
        for c in node.children.iter() {
            if let ResolvedChild::Text(t) = c {
                label.push_str(t);
            }
        }
        label
    }

    /// `[ label ]` when selected, `  label  ` otherwise — the strip's
    /// `selectedKey` decides, exactly like the primitive's `t.selected =
    /// t.key === selectedKey`.
    fn paint_tab(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink, env: &Env) {
        let key = prop(node, "key");
        let selected =
            prop_bool(node, "selected") || env.tabs_sel.as_ref().is_some_and(|s| s.strict_eq(key));
        let label = self.tab_label(node);
        let mut ink = *ink;
        if selected {
            ink.bold = true;
            ink.bg = ink.bg.or(self.palette.accent_soft);
        }
        let mut st = ink.style(self, self.default_fg());
        if prop_bool(node, "disabled") {
            st = st.add_modifier(Modifier::DIM);
        }
        if selected {
            let accent = rc(
                self.palette.accent.unwrap_or_else(|| self.default_fg()),
                self.truecolor,
            );
            self.put(area, area.x, area.y, "[", TStyle::default().fg(accent));
            let body = format!(" {label} ");
            self.put(area, area.x + 1, area.y, &body, st);
            self.put(
                area,
                area.x + 1 + UnicodeWidthStr::width(body.as_str()) as u16,
                area.y,
                "]",
                TStyle::default().fg(accent),
            );
        } else {
            self.put(area, area.x, area.y, &format!("  {label}  "), st);
        }
    }

    /// `icon [text▏]` — `start`/`end` slot children bracket the editable
    /// text; the draft wins over the `value` prop.
    fn paint_input(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink, env: &Env) {
        let mut x = area.x;
        for c in self.slot_children(node, "start") {
            if let ResolvedChild::Node(n) = c {
                let w = self.measure(n, area.width, 1).w.min(4);
                self.paint(
                    n,
                    Rect {
                        x,
                        y: area.y,
                        width: w,
                        height: 1,
                    },
                    env,
                );
                x += w + 1;
            }
        }
        // The draft, else the `value` prop as text — a number input's
        // value is a number; a missing or null value is an empty field.
        let value = match self.drafts.get(&node.id) {
            Some(d) => d.clone(),
            None => prop(node, "value").to_text().to_string(),
        };
        let value = value.as_str();
        let focused = self.focus.as_ref() == Some(&node.id);
        let mut st = ink.style(self, self.default_fg());
        if let Some(bg) = self
            .palette
            .field
            .or(self.palette.sunken)
            .and_then(|c| tui_color(c, self.truecolor))
        {
            st = st.bg(bg);
        }
        let bracket_fg = if focused {
            self.palette.accent
        } else {
            self.palette.border
        }
        .unwrap_or(WColor::new(0.5, 0.5, 0.5, 1.0));
        let bst = TStyle::default().fg(rc(bracket_fg, self.truecolor));
        let end_w: u16 = self
            .slot_children(node, "end")
            .iter()
            .map(|c| match c {
                ResolvedChild::Node(n) => self.measure(n, 4, 1).w + 1,
                _ => 0,
            })
            .sum();
        let w = (area.x + area.width)
            .saturating_sub(x)
            .saturating_sub(end_w);
        if w == 0 {
            return;
        }
        let field = Rect {
            x,
            y: area.y,
            width: w,
            height: 1,
        };
        // `[ text ▏]` — the caret sits inside the right bracket when focused.
        self.put(field, x, area.y, "[", bst);
        let inner = Rect {
            x: x + 1,
            width: w.saturating_sub(2),
            ..field
        };
        if value.is_empty() && !focused {
            let ph = prop_str(node, "placeholder").unwrap_or("");
            let mut pst = st;
            pst = pst.add_modifier(Modifier::DIM);
            self.put(inner, inner.x, inner.y, ph, pst);
        } else {
            let text = if focused {
                format!("{value}▏")
            } else {
                value.to_string()
            };
            self.put(inner, inner.x, inner.y, &text, st);
        }
        if w >= 2 {
            self.put(field, x + w - 1, area.y, "]", bst);
        }
        // `end` slot after the field.
        let mut ex = x + w;
        for c in self.slot_children(node, "end") {
            if let ResolvedChild::Node(n) = c {
                let nw = self
                    .measure(n, (area.x + area.width).saturating_sub(ex), 1)
                    .w;
                self.paint(
                    n,
                    Rect {
                        x: ex + 1,
                        y: area.y,
                        width: nw,
                        height: 1,
                    },
                    env,
                );
                ex += nw + 1;
            }
        }
    }

    fn paint_select(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let label = self.select_label(node);
        self.put(
            area,
            area.x,
            area.y,
            &format!("[ {label} ▾ ]"),
            ink.style(self, self.default_fg()),
        );
    }

    fn paint_switch(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let checked = prop(node, "checked").truthy();
        let mark = if checked { "☑" } else { "☐" };
        let label = prop_str(node, "label").unwrap_or("");
        let st = ink.style(self, self.default_fg());
        if label.is_empty() {
            self.put(area, area.x, area.y, mark, st);
        } else {
            self.put(area, area.x, area.y, &format!("{mark} {label}"), st);
        }
    }

    /// `[════╌──] 42` — a bar proportional to value inside min/max.
    fn paint_slider(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let (v, lo, hi) = (
            prop_num(node, "value").unwrap_or(0.0),
            prop_num(node, "min").unwrap_or(0.0),
            prop_num(node, "max").unwrap_or(100.0),
        );
        let bar_w: usize = 12;
        let frac = if hi > lo {
            ((v - lo) / (hi - lo)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let fill = (frac * bar_w as f64).round() as usize;
        let bar = format!(
            "[{}{}] {}",
            "═".repeat(fill.min(bar_w)),
            "─".repeat(bar_w.saturating_sub(fill)),
            v
        );
        let st = ink.style(self, self.default_fg());
        match prop_str(node, "label") {
            Some(l) => self.put(area, area.x, area.y, &format!("{l} {bar}"), st),
            None => self.put(area, area.x, area.y, &bar, st),
        }
    }

    /// `───…` or `│` — a divider fills its axis.
    fn paint_divider(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let color = ink
            .fg
            .or(self.palette.border)
            .unwrap_or(WColor::new(0.4, 0.4, 0.4, 1.0));
        let st = TStyle::default().fg(rc(color, self.truecolor));
        match prop_str(node, "orientation") {
            Some("vertical") => {
                for y in area.y..area.y + area.height {
                    self.put(area, area.x, y, "│", st);
                }
            }
            _ => {
                for x in area.x..area.x + area.width {
                    self.put(area, x, area.y, "─", st);
                }
            }
        }
    }

    fn paint_skeleton(&mut self, area: Rect, ink: &Ink) {
        let mut ink = *ink;
        ink.dim = true;
        let st = ink.style(self, self.default_fg());
        for y in area.y..area.y + area.height {
            for x in area.x..area.x + area.width {
                self.put(area, x, y, "░", st);
            }
        }
    }

    /// `▌ title` + wrapped body — the accent bar carries the tone.
    fn paint_alert(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let title = prop_str(node, "title").unwrap_or("");
        let bar_fg = ink
            .fg
            .or(self.palette.accent_text)
            .unwrap_or(WColor::new(0.5, 0.7, 0.9, 1.0));
        let bst = TStyle::default()
            .fg(rc(bar_fg, self.truecolor))
            .add_modifier(Modifier::BOLD);
        let mut y = area.y;
        if !title.is_empty() {
            self.put(area, area.x, y, "▌ ", bst);
            self.put(area, area.x + 2, y, title, bst);
            y += 1;
        }
        let body = self.node_text(node);
        if !body.is_empty() && body != title {
            let st = ink.style(self, self.default_fg());
            for line in self.wrap(&body, area.width.saturating_sub(2), None) {
                if y >= area.y + area.height {
                    break;
                }
                self.put(area, area.x + 2, y, &line, st);
                y += 1;
            }
        }
    }

    /// A bordered box with a title on its frame — the in-flow overlay
    /// (a terminal has no floating layer; open overlays render inline).
    fn paint_overlay_box(&mut self, node: &ResolvedNode, area: Rect, env: &Env, title: &str) {
        if area.width < 2 || area.height < 2 {
            return;
        }
        let fg = self
            .palette
            .border
            .unwrap_or(WColor::new(0.5, 0.5, 0.5, 1.0));
        let st = TStyle::default().fg(rc(fg, self.truecolor));
        let x2 = area.x + area.width - 1;
        let y2 = area.y + area.height - 1;
        for x in area.x..=x2 {
            self.put(area, x, area.y, "─", st);
            self.put(area, x, y2, "─", st);
        }
        for y in area.y..=y2 {
            self.put(area, area.x, y, "│", st);
            self.put(area, x2, y, "│", st);
        }
        self.put(area, area.x, area.y, "╭", st);
        self.put(area, x2, area.y, "╮", st);
        self.put(area, area.x, y2, "╰", st);
        self.put(area, x2, y2, "╯", st);
        if !title.is_empty() && area.width > 4 {
            self.put(
                area,
                area.x + 2,
                area.y,
                &format!(" {title} "),
                TStyle::default()
                    .fg(rc(self.default_fg(), self.truecolor))
                    .add_modifier(Modifier::BOLD),
            );
        }
        let inner = Rect {
            x: area.x + 1,
            y: area.y + 1,
            width: area.width - 2,
            height: area.height - 2,
        };
        self.paint_children(node, inner, env);
    }

    /// The menu's `items` — a line each.
    fn paint_menu(&mut self, node: &ResolvedNode, area: Rect, ink: &Ink) {
        let items = match prop(node, "items") {
            Value::List(l) => l.clone(),
            _ => return,
        };
        let st = ink.style(self, self.default_fg());
        for (y, item) in (area.y..area.y + area.height).zip(items.iter()) {
            let label = match item {
                Value::Obj(m) => m
                    .get("label")
                    .or_else(|| m.get("id"))
                    .map(|v| v.js_string())
                    .unwrap_or_default(),
                other => other.js_string(),
            };
            self.put(area, area.x, y, &format!("  {label}"), st);
        }
    }

    /// `label *` then the field children below — form-field chrome.
    fn paint_form_field(&mut self, node: &ResolvedNode, area: Rect, env: &Env) {
        let label = prop_str(node, "label").unwrap_or("");
        let mut y = area.y;
        if !label.is_empty() {
            let mut l = label.to_string();
            if prop_bool(node, "required") {
                l.push_str(" *");
            }
            let st = TStyle::default()
                .fg(rc(
                    self.palette.muted.unwrap_or_else(|| self.default_fg()),
                    self.truecolor,
                ))
                .add_modifier(Modifier::BOLD);
            self.put(area, area.x, y, &l, st);
            y += 1;
        }
        let rest = Rect {
            y,
            height: area.height.saturating_sub(y - area.y),
            ..area
        };
        self.paint_children(node, rest, env);
    }
}

/// The `YYYY-MM-DD` day of an ISO date-time — what a `we-timestamp` shows
/// here. The raw value is 24 cells, which starves the title beside it in
/// a sidebar row (a call's); the web's relative form ("1yr ago") needs a
/// clock and the date formatter we-egui keeps, a follow-up (NOTES).
fn iso_day(s: &str) -> Option<&str> {
    let b = s.as_bytes();
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    (b.len() >= 10 && digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10))
        .then(|| &s[..10])
}

/// Split `s` after the last char that fits `w` cells — `(head, rest)`.
fn split_at_cells(s: &str, w: usize) -> (&str, &str) {
    let mut acc = 0usize;
    let mut take = 0usize;
    for ch in s.chars() {
        let cw = UnicodeWidthChar::width(ch).unwrap_or(1);
        if acc + cw > w {
            break;
        }
        acc += cw;
        take += ch.len_utf8();
    }
    s.split_at(take)
}

/// The painted surface for one frame: the full-height canvas plus the
/// focusables the walk met.
pub struct Frame {
    /// Virtual-height buffer — the whole painted content.
    pub canvas: Buffer,
    /// Focusables in paint order (virtual coords).
    pub focusables: Vec<Focusable>,
    /// The content's full height in lines.
    pub content_height: u16,
}

/// Paint `root` into a fresh canvas `w` cells wide and full content
/// height. `scroll` decides which window the caller copies out.
/// `(w, view_h)` is the canvas width and the terminal's content rows.
pub fn paint_frame(
    root: &ResolvedNode,
    (w, view_h): (u16, u16),
    theme: &Theme,
    palette: Palette,
    truecolor: bool,
    focus: Option<NodeId>,
    drafts: &std::collections::HashMap<NodeId, String>,
) -> Frame {
    // The viewport is the terminal window: `100vh`, a fixed shell's
    // height, resolve to the rows on screen; taller content scrolls.
    let view_h = view_h.clamp(1, MAX_LINES);
    let empty_scope = indexmap::IndexMap::new();
    let scx = StyleCx {
        tokens: &theme.tokens,
        // The theme's component stylesheet applies, as in we-app.
        theme: theme.id.as_ref(),
        // The root's custom-property scope; we-tui resolves every node
        // against it (no per-node `scope` descent yet).
        scope: &empty_scope,
        viewport: we_style::Size::new(w as f32 * CELL_PX, view_h as f32 * CELL_PX),
        container_width: w as f32 * CELL_PX,
        // The terminal frontend projects the px layout onto cells; the
        // font units resolve against the default metrics (design 6.1).
        metrics: we_metrics::UnitMetrics::default(),
    };
    let mut probe_buf = Buffer::empty(Rect::new(0, 0, w.max(1), 1));
    let probe = Painter::new(&mut probe_buf, scx, theme, palette, truecolor, drafts);
    let height = probe.measure(root, w, view_h).h.clamp(view_h, MAX_LINES);
    let mut buf = Buffer::empty(Rect::new(0, 0, w.max(1), height));
    if let Some(bg) = tui_color(palette.bg(theme), truecolor) {
        buf.set_style(Rect::new(0, 0, w.max(1), height), TStyle::default().bg(bg));
    }
    let mut p = Painter::new(&mut buf, scx, theme, palette, truecolor, drafts);
    p.focus = focus;
    p.paint(
        root,
        Rect {
            x: 0,
            y: 0,
            width: w,
            height,
        },
        &Env::default(),
    );
    p.highlight_focus(Rect::new(0, 0, w, height));
    let focusables = std::mem::take(&mut p.focusables);
    drop(p);
    Frame {
        canvas: buf,
        focusables,
        content_height: height,
    }
}

/// Copy `canvas[scroll..scroll+height]` into `dst`'s `area` — the visible
/// window blit.
pub fn blit(canvas: &Buffer, dst: &mut Buffer, scroll: u16, area: Rect) {
    for y in 0..area.height {
        for x in 0..area.width {
            if let Some(c) = canvas.cell((x, y + scroll)) {
                if let Some(d) = dst.cell_mut((area.x + x, area.y + y)) {
                    *d = c.clone();
                }
            }
        }
    }
}
