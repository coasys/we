//! `we-tui`: the WE renderer in the terminal.
//!
//! One [`TuiApp`] owns a [`we_session::Session`] and the frontend state —
//! focus, drafts, scroll. [`TuiApp::render_into`] resolves the tree, paints
//! it to a full-height virtual canvas ([`draw::paint_frame`]), blits the
//! scrolled window into the caller's buffer and draws the status line.
//! [`TuiApp::handle_key`] is the whole keyboard contract: Tab/arrows move
//! focus, Enter activates (handlers run through the session, so navigation
//! re-resolves the screen), typing edits a focused input, `q`/Ctrl-C quit.
#![forbid(unsafe_code)]
// Native only — see Cargo.toml; on wasm32 the library is empty.
#![cfg(not(target_arch = "wasm32"))]

pub mod draw;
pub mod icons;
pub mod load;
pub mod palette;

use std::collections::HashMap;
use std::sync::Arc;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use indexmap::IndexMap;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style as TStyle;
use we_expr::Value;
use we_session::Session;
use we_style::Theme;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use draw::{blit, paint_frame, FocusKind};
use palette::{tui_color, Palette};

/// A keypress's answer — the main loop quits on `Quit`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyResult {
    Continue,
    Quit,
}

/// `{detail: <payload>}` — the `CustomEvent` envelope every change/input
/// handler reads (`event.detail`), the same shape `we-egui::events` emits.
fn detail(payload: Value) -> Value {
    obj([("detail", payload)])
}

fn obj(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Obj(Arc::new(
        pairs
            .into_iter()
            .map(|(k, v)| (k.into(), v))
            .collect::<IndexMap<Arc<str>, Value>>(),
    ))
}

/// `{detail: {value}}` — the tree-item select payload egui's tree emits.
fn detail_value(value: Value) -> Value {
    detail(obj([("value", value)]))
}

/// `{detail: {open}}` — `onOpenChange`.
fn detail_open(open: bool) -> Value {
    detail(obj([("open", Value::Bool(open))]))
}

/// `{detail: {key, code, isComposing}}` — `we-input`'s `onKeyDown`.
fn key_down(key: &str, code: &str) -> Value {
    detail(obj([
        ("key", Value::Str(key.into())),
        ("code", Value::Str(code.into())),
        ("isComposing", Value::Bool(false)),
    ]))
}

/// The terminal frontend: a session plus what a frame needs to remember —
/// which node has focus, each input's draft, and how far the content is
/// scrolled.
pub struct TuiApp {
    /// Runtime + host + screen — the frontend-independent session.
    pub session: Session,
    /// The theme styles resolve against.
    pub theme: Theme,
    /// The theme's colour roles mapped to terminal colours.
    pub palette: Palette,
    /// Truecolour vs the nearest xterm-256 index.
    pub truecolor: bool,
    /// The focused node — `NodeId`s are stable across resolves, so focus
    /// survives a re-render.
    pub focus: Option<NodeId>,
    /// Focusables from the last painted frame, in paint order.
    pub focusables: Vec<draw::Focusable>,
    /// Per-input draft text — survives re-resolves so typing never loses
    /// a letter even if the template's `onInput` round-trips nothing.
    pub drafts: HashMap<NodeId, String>,
    /// The first visible canvas line.
    pub scroll: u16,
    /// The last frame's content height, for scroll clamping.
    content_height: u16,
    /// The last frame's content window height — PageUp/Down's step.
    view_height: u16,
}

impl TuiApp {
    pub fn new(session: Session, theme: Theme, truecolor: bool) -> Self {
        let palette = Palette::of(&theme);
        TuiApp {
            session,
            theme,
            palette,
            truecolor,
            focus: None,
            focusables: Vec::new(),
            drafts: HashMap::new(),
            scroll: 0,
            content_height: 0,
            view_height: 0,
        }
    }

    /// Paint one frame into `buf`'s `area`: content in `area.height - 1`
    /// rows, the status line on the last row.
    pub fn render_into(&mut self, buf: &mut Buffer, area: Rect) {
        let view_h = area.height.saturating_sub(1);
        if view_h == 0 || area.width == 0 {
            return;
        }
        let content = Rect {
            width: area.width,
            height: view_h,
            ..area
        };
        let root = self.session.resolve();
        // Base fill first — the window keeps the theme's bg where content
        // doesn't reach.
        if let Some(bg) = tui_color(self.palette.bg(&self.theme), self.truecolor) {
            buf.set_style(
                area,
                TStyle::default().bg(bg).fg(tui_color(
                    self.palette.fg(&self.theme),
                    self.truecolor,
                )
                .unwrap_or_default()),
            );
        }
        let frame = paint_frame(
            &root,
            (content.width, view_h),
            &self.theme,
            self.palette,
            self.truecolor,
            self.focus.clone(),
            &self.drafts,
        );
        self.content_height = frame.content_height;
        self.view_height = view_h;
        // A node that left the tree loses focus rather than pointing at a
        // stale id.
        if let Some(id) = &self.focus {
            if !frame.focusables.iter().any(|f| &f.id == id) {
                self.focus = None;
            }
        }
        // Scroll to the focused row.
        if let Some(f) = self
            .focus
            .as_ref()
            .and_then(|id| frame.focusables.iter().find(|f| &f.id == id))
        {
            if f.rect.y < self.scroll {
                self.scroll = f.rect.y;
            } else if f.rect.y + f.rect.height > self.scroll + view_h {
                self.scroll = f.rect.y + f.rect.height - view_h;
            }
        }
        let max_scroll = frame.content_height.saturating_sub(view_h);
        self.scroll = self.scroll.min(max_scroll);
        blit(&frame.canvas, buf, self.scroll, content);
        self.focusables = frame.focusables;
        self.paint_status(buf, area);
    }

    /// The bottom row: current route and the key hints, sunken like chrome.
    fn paint_status(&self, buf: &mut Buffer, area: Rect) {
        let y = area.y + area.height - 1;
        let route = self.session.screen.nav.href();
        let n = self.session.stats().nodes;
        let text =
            format!(" {route}  ·  {n} nodes   tab/↑↓ focus · enter activate · ←/→ fold · q quit ");
        let bg = self
            .palette
            .sunken
            .and_then(|c| tui_color(c, self.truecolor));
        let fg = self
            .palette
            .muted
            .unwrap_or_else(|| self.palette.fg(&self.theme));
        let fg = tui_color(fg, self.truecolor);
        let mut st = TStyle::default();
        if let Some(bg) = bg {
            st = st.bg(bg);
        }
        if let Some(fg) = fg {
            st = st.fg(fg);
        }
        for x in area.x..area.x + area.width {
            if let Some(c) = buf.cell_mut((x, y)) {
                c.set_symbol(" ");
                c.set_style(st);
            }
        }
        buf.set_stringn(area.x, y, text, area.width as usize, st);
    }

    /// The index of `self.focus` in `focusables` — `None` when unfocused
    /// or the node left the tree.
    fn focus_index(&self) -> Option<usize> {
        self.focus
            .as_ref()
            .and_then(|id| self.focusables.iter().position(|f| &f.id == id))
    }

    /// Focus `focusables[i]` — wraps.
    fn focus_at(&mut self, i: usize) {
        if self.focusables.is_empty() {
            self.focus = None;
            return;
        }
        let i = i % self.focusables.len();
        self.focus = Some(self.focusables[i].id.clone());
    }

    /// Focus the next/previous focusable — the shared body of Tab,
    /// Shift-Tab and the arrow keys.
    fn focus_step(&mut self, dir: i64) {
        match self.focus_index() {
            Some(i) => {
                let n = self.focusables.len() as i64;
                if n == 0 {
                    self.focus = None;
                } else {
                    let next = (i as i64 + dir).rem_euclid(n) as usize;
                    self.focus_at(next);
                }
            }
            None => {
                if !self.focusables.is_empty() {
                    let i = if dir >= 0 {
                        0
                    } else {
                        self.focusables.len() - 1
                    };
                    self.focus_at(i);
                }
            }
        }
    }

    /// Dispatch a widget event — the session runs the handler (bubbling
    /// to ancestors, so a tree item's `onSelect` reaches its `we-tree`).
    fn emit(&mut self, node: &NodeId, handler: &str, value: Value) {
        self.session.dispatch(node, handler, value);
    }

    /// The kind of the currently focused node, if it still is one.
    fn focused_kind(&self) -> Option<(NodeId, FocusKind)> {
        let id = self.focus.as_ref()?;
        let f = self.focusables.iter().find(|f| &f.id == id)?;
        Some((f.id.clone(), f.kind.clone()))
    }

    /// One keypress. The main loop feeds crossterm events here; tests feed
    /// synthetic ones.
    pub fn handle_key(&mut self, key: KeyEvent) -> KeyResult {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return KeyResult::Quit;
        }
        let focused = self.focused_kind();
        match key.code {
            KeyCode::Tab => self.focus_step(1),
            KeyCode::BackTab => self.focus_step(-1),
            KeyCode::Up => self.focus_step(-1),
            KeyCode::Down => self.focus_step(1),
            KeyCode::Esc => self.focus = None,
            KeyCode::PageUp => {
                self.scroll = self.scroll.saturating_sub(self.view_height.max(1));
            }
            KeyCode::PageDown => {
                self.scroll = self.scroll.saturating_add(self.view_height.max(1));
            }
            KeyCode::Home => self.scroll = 0,
            KeyCode::End => self.scroll = self.content_height,
            KeyCode::Left => self.activate_left(),
            KeyCode::Right => self.activate_right(),
            KeyCode::Enter => self.activate(),
            KeyCode::Char('q') if !matches!(focused, Some((_, FocusKind::Input))) => {
                return KeyResult::Quit
            }
            KeyCode::Char(c) => {
                if let Some((id, FocusKind::Input)) = focused {
                    let text = {
                        let d = self.draft_of(&id);
                        d.push(c);
                        d.clone()
                    };
                    self.emit(&id, "onInput", detail(Value::Str(text.into())));
                }
            }
            KeyCode::Backspace => {
                if let Some((id, FocusKind::Input)) = focused {
                    let text = {
                        let d = self.draft_of(&id);
                        d.pop();
                        d.clone()
                    };
                    self.emit(&id, "onInput", detail(Value::Str(text.into())));
                }
            }
            _ => {}
        }
        KeyResult::Continue
    }

    /// The input's draft, seeded from its `value` prop on first edit so
    /// typing appends to what the template put there.
    fn draft_of(&mut self, id: &NodeId) -> &mut String {
        if !self.drafts.contains_key(id) {
            let seed = self
                .node_at(id)
                .and_then(|n| prop_text(&n))
                .unwrap_or_default();
            self.drafts.insert(id.clone(), seed);
        }
        self.drafts.get_mut(id).expect("draft seeded")
    }

    /// A node's clone from the resolved tree — activation reads handlers
    /// and props off it. `None` when the node left the tree.
    fn node_at(&self, id: &NodeId) -> Option<ResolvedNode> {
        let root = self.session.runtime.resolved()?.clone();
        find_node(&root, id).cloned()
    }

    /// Enter on the focused node — each kind emits its handler payload.
    fn activate(&mut self) {
        let Some((id, kind)) = self.focused_kind() else {
            return;
        };
        match kind {
            FocusKind::Click => {
                // Prefer onClick; a node carrying only onSelect gets its
                // own event.
                let node = self.node_at(&id);
                if node
                    .as_ref()
                    .is_some_and(|n| n.handlers.contains_key("onSelect"))
                    && !node
                        .as_ref()
                        .is_some_and(|n| n.handlers.contains_key("onClick"))
                {
                    let value = node
                        .as_ref()
                        .map(|n| n.props.get("value").cloned().unwrap_or(Value::Null))
                        .unwrap_or(Value::Null);
                    self.emit(&id, "onSelect", detail_value(value));
                } else {
                    self.emit(&id, "onClick", obj([]));
                }
            }
            FocusKind::TreeItem { value } => {
                self.emit(&id, "onSelect", detail_value(value));
            }
            FocusKind::TreeFold { open } => {
                self.emit(&id, "onOpenChange", detail_open(!open));
            }
            FocusKind::Input => {
                self.emit(&id, "onKeyDown", key_down("Enter", "Enter"));
            }
            FocusKind::Switch { checked } => {
                self.emit(&id, "onChange", detail(Value::Bool(!checked)));
            }
            FocusKind::Select { options, current } => {
                if let Some(next) = cycle(&options, &current) {
                    self.emit(&id, "onChange", detail(next));
                } else {
                    self.emit(&id, "onClick", obj([]));
                }
            }
            FocusKind::Tab { tabs, key } => {
                self.emit(&id, "onTabSelect", detail_value(key.clone()));
                self.emit(&tabs, "onChange", detail_value(key));
            }
            FocusKind::Step { .. } => {}
        }
    }

    /// ← folds an open tree item / steps a slider down / moves a tab left.
    fn activate_left(&mut self) {
        if let Some((id, kind)) = self.focused_kind() {
            match kind {
                FocusKind::TreeItem { .. } => {
                    self.emit(&id, "onOpenChange", detail_open(false));
                }
                FocusKind::Step {
                    value,
                    min,
                    step,
                    handler,
                    ..
                } => {
                    let v = (value - step).max(min);
                    self.emit(&id, handler, detail(Value::Num(v)));
                }
                FocusKind::Tab { tabs, key } => self.tab_step(&tabs, &key, -1),
                _ => {}
            }
        }
    }

    /// → unfolds a closed tree item / steps a slider up / moves a tab right.
    fn activate_right(&mut self) {
        if let Some((id, kind)) = self.focused_kind() {
            match kind {
                FocusKind::TreeItem { .. } => {
                    self.emit(&id, "onOpenChange", detail_open(true));
                }
                FocusKind::Step {
                    value,
                    max,
                    step,
                    handler,
                    ..
                } => {
                    let v = (value + step).min(max);
                    self.emit(&id, handler, detail(Value::Num(v)));
                }
                FocusKind::Tab { tabs, key } => self.tab_step(&tabs, &key, 1),
                _ => {}
            }
        }
    }

    /// The primitive's roving strip: ←/→ selects the sibling tab and moves
    /// focus to it — `tab-select` on the tab, `change` on the strip.
    fn tab_step(&mut self, tabs: &NodeId, current: &Value, dir: i64) {
        let Some(strip) = self.node_at(tabs) else {
            return;
        };
        let keys: Vec<(NodeId, Value)> = strip
            .children
            .iter()
            .filter_map(|c| match c {
                ResolvedChild::Node(n) if n.ty.as_ref() == "we-tab" => Some((
                    n.id.clone(),
                    n.props.get("key").cloned().unwrap_or(Value::Null),
                )),
                _ => None,
            })
            .collect();
        if keys.is_empty() {
            return;
        }
        let at = keys
            .iter()
            .position(|(_, k)| k.strict_eq(current))
            .unwrap_or(0) as i64;
        let next = (at + dir).rem_euclid(keys.len() as i64) as usize;
        let (id, key) = keys[next].clone();
        self.emit(&id, "onTabSelect", detail_value(key.clone()));
        self.emit(tabs, "onChange", detail_value(key));
        self.focus = Some(id);
    }
}

/// The option after `current` — wraps to the front.
fn cycle(options: &[(Value, String)], current: &Value) -> Option<Value> {
    let idx = options.iter().position(|(v, _)| v.strict_eq(current));
    match idx {
        Some(i) => options.get((i + 1) % options.len()).map(|(v, _)| v.clone()),
        None => options.first().map(|(v, _)| v.clone()),
    }
}

/// Depth-first search for `id` in the resolved tree.
fn find_node<'n>(node: &'n ResolvedNode, id: &NodeId) -> Option<&'n ResolvedNode> {
    if &node.id == id {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_node(n, id),
        ResolvedChild::Text(_) => None,
    })
}

/// The node's `value`/`text` prop as the input draft seed.
fn prop_text(node: &ResolvedNode) -> Option<String> {
    match node.props.get("value").or_else(|| node.props.get("text")) {
        Some(Value::Str(s)) => Some(s.to_string()),
        Some(v) if !v.is_undefined() => Some(v.js_string()),
        _ => None,
    }
}

/// The buffer's text — a row per line, trailing whitespace trimmed. The
/// `--dump` output and the tests' oracle.
pub fn buffer_text(buf: &Buffer, area: Rect) -> String {
    let mut out = String::new();
    for y in area.y..area.y + area.height {
        let mut line = String::new();
        for x in area.x..area.x + area.width {
            if let Some(c) = buf.cell((x, y)) {
                line.push_str(c.symbol());
            }
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out
}
