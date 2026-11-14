//! `we-catalog`: the widget types as data.
//!
//! Every registered widget has a [`CatalogEntry`]: its `ty`, a display name,
//! the prop names it reads, the event names it can fire, and a semantic
//! [`Role`]. The role gives every frontend that cannot paint a widget a
//! defined text rendering — a TUI shows the same words a screen reader
//! hears. `text_fallback(node)` answers them: rich text falls back to its
//! plain text with marks flattened, a graph to an outline of its nodes and
//! edges, video to a link, the colour picker to the token list it shows.
//!
//! The coverage test lives in the egui crate — every registered type must
//! have an entry here.
#![forbid(unsafe_code)]

use we_expr::Value;
use we_template::{ResolvedChild, ResolvedNode};

/// What a node is to a frontend that renders semantics, not pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Something you press — button, link.
    Action,
    /// Display text — labels, timestamps.
    Text,
    /// Text the user edits — inputs, textareas, number inputs.
    Input,
    /// A choice from a fixed set — select, switch, slider, pickers.
    Select,
    /// A repeating sequence of children — sortable, lane.
    List,
    /// A nested outline — tree and items.
    Tree,
    /// Content that floats over the tree — modal, popover, menu, tooltip.
    Overlay,
    /// A binary asset — image, icon, avatar, video.
    Media,
    /// Marked-up text — rich text keeps its content, marks flatten.
    RichText,
    /// A node/edge diagram — outlines nodes and edges.
    Graph,
}

/// One widget type's static description.
pub struct CatalogEntry {
    /// The `ty` string the resolved tree names.
    pub ty: &'static str,
    /// A display name for pickers and docs.
    pub name: &'static str,
    /// The semantic role — drives the default text fallback.
    pub role: Role,
    /// The prop names the widget reads (informational, not exhaustive DS
    /// props — those are style's).
    pub props: &'static [&'static str],
    /// The event names the widget can fire (`onClick`, `onChange`, …).
    pub events: &'static [&'static str],
}

/// The catalog — one entry per type the frontends may meet.
pub static CATALOG: &[CatalogEntry] = &[
    // ---- layout / containers (List role: they enumerate children)
    e(
        "Row",
        "Row",
        Role::List,
        &["direction", "gap", "ax", "ay", "wrap"],
        &["onClick", "onMouseEnter", "onMouseLeave"],
    ),
    e(
        "Column",
        "Column",
        Role::List,
        &["gap", "ax", "ay"],
        &["onClick", "onMouseEnter", "onMouseLeave"],
    ),
    e(
        "Grid",
        "Grid",
        Role::List,
        &["template", "columns", "minChildWidth", "gap"],
        &[],
    ),
    e(
        "Card",
        "Card",
        Role::List,
        &["title", "padding"],
        &["onClick"],
    ),
    e("div", "Div", Role::List, &["data-we-id", "style"], &[]),
    e("$lane", "Lane", Role::List, &["orientation"], &[]),
    // ---- text
    e(
        "we-text",
        "Text",
        Role::RichText,
        &["text", "tag", "variant", "lines", "truncate", "uppercase"],
        &[],
    ),
    e(
        "we-link",
        "Link",
        Role::Action,
        &["label", "href", "target", "direction"],
        &["onClick"],
    ),
    e(
        "we-timestamp",
        "Timestamp",
        Role::Text,
        &["value", "format"],
        &[],
    ),
    e(
        "we-typewriter",
        "Typewriter",
        Role::Text,
        &["text", "speed"],
        &[],
    ),
    // ---- media
    e(
        "we-icon",
        "Icon",
        Role::Media,
        &["name", "size", "weight", "color"],
        &[],
    ),
    e(
        "we-image",
        "Image",
        Role::Media,
        &["src", "alt", "fit", "aspectRatio"],
        &[],
    ),
    e(
        "we-avatar",
        "Avatar",
        Role::Media,
        &["hash", "image", "initials", "icon", "size"],
        &[],
    ),
    e(
        "AvatarStack",
        "Avatar stack",
        Role::Media,
        &["avatars", "size", "max"],
        &[],
    ),
    e(
        "we-animated-icon",
        "Animated icon",
        Role::Media,
        &["name", "size"],
        &[],
    ),
    // ---- action & feedback
    e(
        "we-button",
        "Button",
        Role::Action,
        &[
            "label", "variant", "tone", "size", "loading", "disabled", "square",
        ],
        &["onClick", "onMouseEnter", "onMouseLeave"],
    ),
    e(
        "we-tooltip",
        "Tooltip",
        Role::Overlay,
        &["content", "placement"],
        &[],
    ),
    e(
        "we-badge",
        "Badge",
        Role::Text,
        &["variant", "tone", "size"],
        &[],
    ),
    e(
        "we-tag",
        "Tag",
        Role::Text,
        &["tone", "variant", "size"],
        &[],
    ),
    e(
        "we-alert",
        "Alert",
        Role::Text,
        &["tone", "title", "variant"],
        &[],
    ),
    e(
        "we-skeleton",
        "Skeleton",
        Role::Text,
        &["width", "height"],
        &[],
    ),
    e(
        "we-divider",
        "Divider",
        Role::Text,
        &["orientation", "thickness", "color"],
        &[],
    ),
    // ---- tree
    e(
        "we-tree",
        "Tree",
        Role::Tree,
        &["caret", "lead", "selected"],
        &[],
    ),
    e(
        "we-tree-item",
        "Tree item",
        Role::Tree,
        &["value", "label", "open", "expandable"],
        &["onOpenChange"],
    ),
    // ---- inputs
    e(
        "we-input",
        "Input",
        Role::Input,
        &["value", "placeholder", "type", "size", "label", "autofocus"],
        &["onInput", "onChange", "onKeyDown"],
    ),
    e(
        "we-textarea",
        "Textarea",
        Role::Input,
        &["value", "placeholder", "rows", "size", "label"],
        &["onInput", "onChange"],
    ),
    e(
        "we-select",
        "Select",
        Role::Select,
        &[
            "options",
            "value",
            "placeholder",
            "searchable",
            "fit",
            "size",
        ],
        &["onChange"],
    ),
    e(
        "we-switch",
        "Switch",
        Role::Select,
        &["checked", "label", "size", "disabled"],
        &["onChange"],
    ),
    e(
        "we-slider",
        "Slider",
        Role::Select,
        &["value", "min", "max", "step", "label"],
        &["onChange"],
    ),
    e(
        "we-number-input",
        "Number input",
        Role::Input,
        &["value", "min", "max", "step", "placeholder", "size"],
        &["onChange"],
    ),
    e(
        "we-form-field",
        "Form field",
        Role::Input,
        &["label", "description", "required", "size"],
        &[],
    ),
    // ---- overlays
    e(
        "we-modal",
        "Modal",
        Role::Overlay,
        &["open", "size", "title", "close"],
        &["onClose"],
    ),
    e(
        "we-popover",
        "Popover",
        Role::Overlay,
        &["open", "placement"],
        &["onClose"],
    ),
    e(
        "DropdownMenu",
        "Dropdown menu",
        Role::Overlay,
        &["open", "items"],
        &["onSelect", "onClose"],
    ),
    // ---- pickers
    e(
        "we-date-picker",
        "Date picker",
        Role::Select,
        &["value", "min", "max"],
        &["onChange"],
    ),
    e(
        "we-color-picker",
        "Colour picker",
        Role::Select,
        &["value", "tokens"],
        &["onChange"],
    ),
    e(
        "we-icon-picker",
        "Icon picker",
        Role::Select,
        &["value", "icons"],
        &["onChange"],
    ),
    // ---- drag & drop
    e(
        "we-sortable",
        "Sortable",
        Role::List,
        &["items", "direction"],
        &["onReorder"],
    ),
    // ---- placeholders (registered until their stage lands)
    e(
        "GraphView",
        "Graph view",
        Role::Graph,
        &["nodes", "edges"],
        &[],
    ),
    e(
        "BlockComposer",
        "Block composer",
        Role::RichText,
        &["editorState"],
        &[],
    ),
    e(
        "EditableImage",
        "Editable image",
        Role::Media,
        &["src", "alt"],
        &[],
    ),
    e(
        "we-location-picker",
        "Location picker",
        Role::Select,
        &["value"],
        &["onChange"],
    ),
    e(
        "we-file-upload",
        "File upload",
        Role::Input,
        &["accept", "multiple"],
        &["onChange"],
    ),
    e("we-video", "Video", Role::Media, &["src", "alt"], &[]),
    e("AgentChat", "Agent chat", Role::List, &[], &[]),
    e(
        "AgentChatSheet",
        "Agent chat sheet",
        Role::Overlay,
        &[],
        &[],
    ),
];

/// Build an entry (keeps the table rows one-liners).
const fn e(
    ty: &'static str,
    name: &'static str,
    role: Role,
    props: &'static [&'static str],
    events: &'static [&'static str],
) -> CatalogEntry {
    CatalogEntry {
        ty,
        name,
        role,
        props,
        events,
    }
}

/// The entry for `ty`, if the catalog knows it.
pub fn entry(ty: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|e| e.ty == ty)
}

/// The state a control reports — the part a plain string loses (`true` vs
/// `"true"`, `7` vs `"7"`). `text_fallback` renders it; a semantic frontend
/// (a TUI, an accessibility tree) may render it differently.
#[derive(Debug, Clone, PartialEq)]
pub enum ControlState {
    /// A two-state control — a switch's `checked`, a disclosure's `open`.
    /// Renders `on`/`off`.
    Flag(bool),
    /// A numeric value — a slider's, a number input's.
    Number(f64),
    /// A text value — an input's content, a select's *shown* option label,
    /// a picker's `value`.
    Text(String),
}

impl ControlState {
    /// As `text_fallback` prints it — JS number text for [`ControlState::Number`]
    /// ("7", not "7.0"), `on`/`off` for a flag, the text itself otherwise.
    pub fn render(&self) -> String {
        match self {
            ControlState::Flag(on) => if *on { "on" } else { "off" }.to_string(),
            ControlState::Number(n) => Value::Num(*n).js_string(),
            ControlState::Text(s) => s.clone(),
        }
    }
}

/// What a node announces to a frontend that renders semantics, not pixels.
///
/// [`Role`] is the coarse category; this is the per-node read: the control's
/// accessible [`Semantics::name`], its typed [`Semantics::state`], and the
/// readable [`Semantics::content`] held *inside props* — a block document, a
/// graph's nodes and edges, the colour tokens, a menu's item labels — the
/// part walking `children` cannot reach. Child traversal is the frontend's
/// own job: `describe` never enumerates `node.children`, so a container's
/// announcement is its name alone.
#[derive(Debug, Clone, Default)]
pub struct Semantics {
    /// What the widget is called — `label`, a media `alt`/`name`, a card or
    /// modal `title`, a lane's id.
    pub name: Option<String>,
    /// The control's current state, when it has one — `checked`, a numeric
    /// `value`, the option a select shows.
    pub state: Option<ControlState>,
    /// Readable lines held in props — document text, a graph outline, item
    /// labels, media's link.
    pub content: Vec<String>,
}

impl Semantics {
    /// The flat-string rendering: `name: state` (either side optional), then
    /// each content line. [`text_fallback`] answers this.
    pub fn render(&self) -> String {
        let mut out = match (&self.name, &self.state) {
            (Some(name), Some(state)) => format!("{name}: {}", state.render()),
            (None, Some(state)) => state.render(),
            (Some(name), None) => name.clone(),
            (None, None) => String::new(),
        };
        for line in &self.content {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(line);
        }
        out
    }
}

/// The catalog's semantic read of `node` — its entry's widget-specific
/// extraction, or the generic prop read for a type the catalog does not
/// know (its `ty` marker plus whatever `text`/`label`/`value` it carries).
pub fn describe(node: &ResolvedNode) -> Semantics {
    let Some(entry) = entry(node.ty.as_ref()) else {
        return describe_unknown(node);
    };
    match entry.ty {
        "we-switch" => {
            // `checked` (falling back to `value`) — the same read the egui
            // widget paints and `aria-checked` announces.
            let on = prop_flag(node, "checked")
                .or_else(|| prop_flag(node, "value"))
                .unwrap_or_else(|| prop(node, "checked").truthy());
            Semantics {
                name: prop_string(node, "label"),
                state: Some(ControlState::Flag(on)),
                content: vec![],
            }
        }
        "we-slider" => {
            // egui: `value` defaults to `min` (which defaults to 0).
            let min = prop_num(node, "min").unwrap_or(0.0);
            Semantics {
                name: prop_string(node, "label"),
                state: Some(ControlState::Number(prop_num(node, "value").unwrap_or(min))),
                content: vec![],
            }
        }
        "we-number-input" => Semantics {
            name: prop_string(node, "label"),
            state: match prop(node, "value") {
                Value::Num(n) => Some(ControlState::Number(*n)),
                v if !matches!(v, Value::Undefined | Value::Null) => {
                    Some(ControlState::Text(v.js_string()))
                }
                _ => None,
            },
            content: vec![],
        },
        "we-select" => Semantics {
            name: prop_string(node, "label"),
            // The option's *label*, never the stored id — the same
            // `options.find(value)?.label` the widget paints.
            state: select_shown(node).map(ControlState::Text),
            content: vec![],
        },
        "we-color-picker" => {
            let tokens = match prop(node, "tokens") {
                Value::List(l) => l
                    .iter()
                    .map(|t| t.js_string())
                    .collect::<Vec<_>>()
                    .join(", "),
                _ => text_of(node),
            };
            Semantics {
                name: prop_string(node, "label"),
                state: value_text(node),
                content: vec![format!("colours: {tokens}")],
            }
        }
        "we-video" => {
            let src = prop_str(node, "src").unwrap_or("");
            Semantics {
                name: None,
                state: None,
                content: vec![format!(
                    "video: {}",
                    if src.is_empty() { "link" } else { src }
                )],
            }
        }
        "GraphView" => Semantics {
            name: None,
            state: None,
            content: graph_lines(node),
        },
        "BlockComposer" => Semantics {
            name: None,
            state: None,
            content: block_lines(node),
        },
        "DropdownMenu" => Semantics {
            name: prop_string(node, "label"),
            state: open_state(node),
            content: prop_list(node, "items")
                .map(|items| items.iter().map(item_label).collect())
                .unwrap_or_default(),
        },
        "$lane" => Semantics {
            // `resolve_panels` writes `lane` (its id) and `collapsed`.
            name: prop_string(node, "lane").or_else(|| prop_string(node, "label")),
            state: match prop_flag(node, "collapsed") {
                Some(true) => Some(ControlState::Text("collapsed".to_string())),
                _ => None,
            },
            content: vec![],
        },
        _ => role_semantics(entry.role, node),
    }
}

/// The fallback's own answer — `describe(node).render()`.
pub fn text_fallback(node: &ResolvedNode) -> String {
    describe(node).render()
}

/// The role default for `ty`s with no widget-specific extraction.
fn role_semantics(role: Role, node: &ResolvedNode) -> Semantics {
    match role {
        Role::Action => {
            let href = prop_str(node, "href");
            Semantics {
                name: prop_string(node, "label").or_else(|| non_empty(text_of(node))),
                state: None,
                content: href.map(|h| format!("→ {h}")).into_iter().collect(),
            }
        }
        Role::Text | Role::RichText => {
            let title = prop_string(node, "title");
            let text = text_of(node);
            Semantics {
                name: title,
                state: None,
                content: non_empty(text).into_iter().collect(),
            }
        }
        Role::Media => Semantics {
            name: Some(
                prop_str(node, "alt")
                    .or_else(|| prop_str(node, "name"))
                    .or_else(|| prop_str(node, "initials"))
                    .or_else(|| prop_str(node, "icon"))
                    .or_else(|| prop_str(node, "src"))
                    .unwrap_or(node.ty.as_ref())
                    .to_string(),
            ),
            state: None,
            content: vec![],
        },
        Role::Input => input_semantics(node),
        Role::Select => Semantics {
            name: prop_string(node, "label"),
            state: value_text(node),
            content: vec![],
        },
        Role::Overlay => Semantics {
            name: prop_string(node, "title")
                .or_else(|| prop_string(node, "label"))
                .or_else(|| prop_string(node, "content")),
            state: open_state(node),
            content: vec![],
        },
        Role::List => Semantics {
            name: prop_string(node, "title")
                .or_else(|| prop_string(node, "label"))
                .or_else(|| prop_string(node, "lane")),
            state: None,
            content: vec![],
        },
        Role::Tree => Semantics {
            name: prop_string(node, "label").or_else(|| prop_string(node, "value")),
            state: match prop_flag(node, "open") {
                Some(true) => Some(ControlState::Text("expanded".to_string())),
                Some(false) => Some(ControlState::Text("collapsed".to_string())),
                None => None,
            },
            content: vec![],
        },
        Role::Graph => Semantics {
            name: None,
            state: None,
            content: graph_lines(node),
        },
    }
}

/// `we-input`/`we-textarea`/`we-form-field`/`we-file-upload`: a `label`
/// names the control; the shown `value` is its state. With neither, the
/// `placeholder` is the only visible hint — it names the field, the way
/// `access_label` in the egui frontend falls back to it.
fn input_semantics(node: &ResolvedNode) -> Semantics {
    if node.ty.as_ref() == "we-form-field" {
        return Semantics {
            name: prop_string(node, "label"),
            state: match prop(node, "required") {
                v if v.truthy() => Some(ControlState::Text("required".to_string())),
                _ => None,
            },
            content: prop_string(node, "description").into_iter().collect(),
        };
    }
    let value = match prop(node, "value") {
        Value::Str(s) if s.is_empty() => None,
        v if !matches!(v, Value::Undefined | Value::Null) => Some(v.js_string()),
        _ => None,
    };
    Semantics {
        name: prop_string(node, "label").or_else(|| {
            if value.is_none() {
                prop_string(node, "placeholder").or_else(|| prop_string(node, "accept"))
            } else {
                None
            }
        }),
        state: value.map(ControlState::Text),
        content: vec![],
    }
}

/// `we-select`: the option label the control shows — `value` matched
/// against `options` (`{value, label?}`, label defaulting to the value's
/// text), then `placeholder` when nothing is chosen — the paint's `shown`.
fn select_shown(node: &ResolvedNode) -> Option<String> {
    let value = prop(node, "value");
    if let Some(items) = prop_list(node, "options") {
        for item in items {
            let (v, l) = match item {
                Value::Obj(map) => (
                    map.get("value").cloned().unwrap_or(Value::Undefined),
                    map.get("label").map(|l| l.js_string()),
                ),
                other => (other.clone(), None),
            };
            if v.strict_eq(value) {
                return Some(l.unwrap_or_else(|| v.js_string()));
            }
        }
    }
    // No match and no placeholder: the control paints nothing
    // (select.ts `_displayValue` is '', egui `shown` defaults) — a stale
    // stored id is not announced.
    prop_string(node, "placeholder")
}

/// A picker/select `value` prop as text state — `None` for unset.
fn value_text(node: &ResolvedNode) -> Option<ControlState> {
    match prop(node, "value") {
        v if !matches!(v, Value::Undefined | Value::Null) => {
            Some(ControlState::Text(v.js_string()))
        }
        _ => None,
    }
}

/// `open` as a two-word state — a modal/popover/menu that is painted open
/// or closed.
fn open_state(node: &ResolvedNode) -> Option<ControlState> {
    prop_flag(node, "open")
        .map(|open| ControlState::Text(if open { "open" } else { "closed" }.to_string()))
}

/// The generic read for a `ty` the catalog does not know — whatever
/// `text`/`label`/`title`/`alt`/`name`/`value` it carries, else its text
/// children. Its type marker still shows (the caller prints `ty`).
fn describe_unknown(node: &ResolvedNode) -> Semantics {
    let name = ["text", "label", "title", "alt", "name"]
        .iter()
        .find_map(|k| prop_string(node, k))
        .or_else(|| match prop(node, "value") {
            v if !matches!(v, Value::Undefined | Value::Null) => Some(v.js_string()),
            _ => non_empty(text_of(node)),
        });
    Semantics {
        name,
        state: None,
        content: vec![],
    }
}

/// `props[key]` or `Undefined`.
fn prop<'a>(node: &'a ResolvedNode, key: &str) -> &'a Value {
    node.props.get(key).unwrap_or(&Value::Undefined)
}

/// `props[key]` as a string — `Str` only.
fn prop_str<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a str> {
    match prop(node, key) {
        Value::Str(s) => Some(s.as_ref()),
        _ => None,
    }
}

/// `props[key]` as a string — `Num`/`Bool` coerce like `prop_string` in the
/// egui frontend.
fn prop_string(node: &ResolvedNode, key: &str) -> Option<String> {
    match prop(node, key) {
        Value::Str(s) => Some(s.to_string()),
        Value::Num(_) | Value::Bool(_) => Some(prop(node, key).js_string()),
        _ => None,
    }
}

/// A boolean prop — `Bool` only; a string `"true"` does not coerce.
fn prop_flag(node: &ResolvedNode, key: &str) -> Option<bool> {
    match prop(node, key) {
        Value::Bool(b) => Some(*b),
        _ => None,
    }
}

/// A numeric prop — `Num`, or a `Str` that parses as a number.
fn prop_num(node: &ResolvedNode, key: &str) -> Option<f64> {
    match prop(node, key) {
        Value::Num(n) => Some(*n),
        Value::Str(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// `props[key]` as a list.
fn prop_list<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a [Value]> {
    match prop(node, key) {
        Value::List(l) => Some(l.as_slice()),
        _ => None,
    }
}

/// An option/menu item's shown label — `{label}` or the value's text.
fn item_label(item: &Value) -> String {
    match item {
        Value::Obj(map) => map
            .get("label")
            .or_else(|| map.get("value"))
            .or_else(|| map.get("id"))
            .map(|v| v.js_string())
            .unwrap_or_default(),
        other => other.js_string(),
    }
}

/// `""` → `None` — an empty string is no announcement.
fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// The display text: `text`, then `label`, then `value`, then concatenated
/// text children — the same order the widgets paint.
fn text_of(node: &ResolvedNode) -> String {
    for key in ["text", "label", "value"] {
        if let Some(s) = prop_str(node, key) {
            return s.to_string();
        }
    }
    node.children
        .iter()
        .filter_map(|c| match c {
            ResolvedChild::Text(t) => Some(t.as_ref()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

/// The `nodes`/`edges` lists a graph reads — the `GraphView` props, or a
/// literal `seeds` object (`{literal: true, nodes, edges}` — the fragment
/// shape the TS module authors).
fn graph_lists(node: &ResolvedNode) -> (Vec<Value>, Vec<Value>) {
    let from_props = |key: &str| prop_list(node, key).map(<[Value]>::to_vec);
    let from_seeds = |key: &str| -> Vec<Value> {
        let mut out = Vec::new();
        let mut take = |seed: &Value| {
            if let Value::Obj(o) = seed {
                if let Some(Value::List(l)) = o.get(key) {
                    out.extend(l.iter().cloned());
                }
            }
        };
        match prop(node, "seeds") {
            Value::List(seeds) => seeds.iter().for_each(&mut take),
            seed => take(seed),
        }
        out
    };
    (
        from_props("nodes").unwrap_or_else(|| from_seeds("nodes")),
        from_props("edges").unwrap_or_else(|| from_seeds("edges")),
    )
}

/// What a graph node is called — `label`, else `id`, else `type`
/// (`GraphNode`'s own order: expanders fill `label`, the renderer falls
/// back to `type`).
fn graph_node_label(node: &Value) -> String {
    if let Value::Obj(o) = node {
        for key in ["label", "id", "type"] {
            if let Some(v) = o.get(key) {
                let s = v.js_string();
                if !s.is_empty() {
                    return s;
                }
            }
        }
    }
    node.js_string()
}

/// A graph → an outline of its nodes and edges with their names and
/// endpoints — `3 nodes / Draft / …`, `2 edges / Draft → Review (next)`.
fn graph_lines(node: &ResolvedNode) -> Vec<String> {
    let (nodes, edges) = graph_lists(node);
    // Node ids → display labels, so an edge's endpoints read as names.
    let names: std::collections::HashMap<String, String> = nodes
        .iter()
        .filter_map(|n| match n {
            Value::Obj(o) => o.get("id").map(|id| (id.js_string(), graph_node_label(n))),
            _ => None,
        })
        .collect();

    let mut out = Vec::new();
    if !nodes.is_empty() {
        out.push(format!("{} nodes", nodes.len()));
        for n in &nodes {
            out.push(format!("  {}", graph_node_label(n)));
        }
    }
    if !edges.is_empty() {
        out.push(format!("{} edges", edges.len()));
        for e in &edges {
            out.push(format!("  {}", graph_edge_label(e, &names)));
        }
    }
    if out.is_empty() {
        out.extend(non_empty(text_of(node)));
    }
    out
}

/// One edge — `source → target` with endpoints resolved to node labels
/// when they name known nodes, plus ` (label-or-type)` when it carries one.
fn graph_edge_label(edge: &Value, names: &std::collections::HashMap<String, String>) -> String {
    let Value::Obj(o) = edge else {
        return edge.js_string();
    };
    let end = |key: &str| {
        o.get(key).map(|v| {
            let raw = v.js_string();
            names.get(&raw).cloned().unwrap_or(raw)
        })
    };
    match (end("source"), end("target")) {
        (Some(source), Some(target)) => {
            let suffix = o
                .get("label")
                .or_else(|| o.get("type"))
                .map(|v| format!(" ({})", v.js_string()))
                .unwrap_or_default();
            format!("{source} → {target}{suffix}")
        }
        _ => o
            .get("label")
            .or_else(|| o.get("id"))
            .map(|v| v.js_string())
            .unwrap_or_else(|| "[edge]".to_string()),
    }
}

/// A composition → its plain text, one line per block, marks dropped
/// (flattened — the "rich text keeps its plain text" contract). The prop
/// is the composer's real one, `editorState` — `blocks` stays as a compat
/// read — and the value is decoded the way `decodeEditorState` decodes:
/// a bare block array, a `{_type:"document", blocks:[…]}` wrapper, a
/// `data:…;base64,…` or raw JSON string, or a `{data_base64}` file.
fn block_lines(node: &ResolvedNode) -> Vec<String> {
    let mut out = Vec::new();
    let state = [prop(node, "editorState"), prop(node, "blocks")]
        .into_iter()
        .find(|v| !matches!(v, Value::Undefined));
    match state.and_then(content_blocks) {
        Some(blocks) => {
            for b in &blocks {
                block_line(b, 0, &mut out);
            }
        }
        None => out.extend(non_empty(text_of(node))),
    }
    out
}

/// Whatever a stored composition arrives as → its blocks —
/// `decodeEditorState`/`contentFromValue` (block-system shared/utils.ts).
/// Only the `{_type:"document"}` wrapper reads `blocks` — `children`
/// stays a compat read on that one shape, not on any object that happens
/// to carry a `children` list (a Lexical root tree decodes to null —
/// content.test.ts:176). A bare array must be `isContentBlockArray` —
/// every element an object carrying a string `_type`.
fn content_blocks(value: &Value) -> Option<Vec<Value>> {
    match value {
        Value::Obj(o) => {
            // `{data_base64, file_type}` — the unresolved file object.
            if let Some(Value::Str(b64)) = o.get("data_base64") {
                let bytes = b64_decode(b64)?;
                let s = String::from_utf8_lossy(&bytes);
                return json_value(&s).and_then(|v| content_blocks(&v));
            }
            let inner = if matches!(o.get("_type"), Some(Value::Str(t)) if t.as_ref() == "document")
            {
                o.get("blocks").or(o.get("children"))
            } else {
                None
            };
            match inner {
                Some(Value::List(blocks)) => Some(blocks.to_vec()),
                _ => None,
            }
        }
        Value::Str(s) => {
            // `data:…;base64,…` decodes; anything else goes to the JSON
            // parse raw — a bad parse is `null`, not a composition.
            let json = if s.starts_with("data:") && s.contains(";base64,") {
                let (_, b64) = s.split_once(";base64,")?;
                String::from_utf8_lossy(&b64_decode(b64)?).into_owned()
            } else {
                s.to_string()
            };
            json_value(&json).and_then(|v| content_blocks(&v))
        }
        Value::List(blocks) => blocks
            .iter()
            .all(|b| matches!(b, Value::Obj(o) if matches!(o.get("_type"), Some(Value::Str(_)))))
            .then(|| blocks.to_vec()),
        _ => None,
    }
}

/// A JSON string → a `Value` — `JSON.parse` inside `decodeEditorState`.
fn json_value(s: &str) -> Option<Value> {
    serde_json::from_str::<serde_json::Value>(s)
        .ok()
        .map(|v| Value::from_json(&v))
}

/// Base64 the way browser `atob` accepts it (utils.ts `decodeBase64Utf8`):
/// ASCII whitespace is ignored and padding may be omitted — the standard
/// alphabet only; the URL-safe one stays a decode error. The UTF-8 decode
/// at the call sites is lossy, matching `TextDecoder` (U+FFFD, not null).
fn b64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::{
        alphabet,
        engine::{
            general_purpose::{GeneralPurpose, GeneralPurposeConfig},
            DecodePaddingMode,
        },
        Engine as _,
    };
    const ENGINE: GeneralPurpose = GeneralPurpose::new(
        &alphabet::STANDARD,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
    );
    ENGINE
        .decode(
            s.chars()
                .filter(|c| !c.is_ascii_whitespace())
                .collect::<String>(),
        )
        .ok()
}

/// One block: a text block's `text` (or its span children's text joined),
/// a collection's `content` or a document's `blocks` one level deeper
/// (the canonical fields — `children` stays only as a compat read), a
/// custom block's type marker plus whatever caption/alt/name it carries.
fn block_line(block: &Value, depth: usize, out: &mut Vec<String>) {
    let indent = "  ".repeat(depth);
    let Value::Obj(o) = block else {
        if let Value::Str(s) = block {
            out.extend(non_empty(format!("{indent}{s}")));
        }
        return;
    };
    let ty = o.get("_type").and_then(|t| match t {
        Value::Str(s) => Some(s.as_ref()),
        _ => None,
    });
    let children = o.get("children");
    match ty {
        Some("collection") | Some("document") => {
            let nested = if ty == Some("collection") {
                o.get("content")
            } else {
                o.get("blocks")
            }
            .or(children);
            if let Some(Value::List(children)) = nested {
                for b in children.iter() {
                    block_line(b, depth + 1, out);
                }
            }
        }
        _ => {
            // `text` (the WE convenience field, standoff marks) or joined
            // span children (`_type:"span"`, `text`, `marks`).
            let text = o
                .get("text")
                .map(|t| t.js_string())
                .or_else(|| spans_text(children));
            match non_empty(text.unwrap_or_default()) {
                Some(text) => out.push(format!("{indent}{text}")),
                None => {
                    // A custom block — say what it is; carry its caption/
                    // alt/name when it has one.
                    let caption = ["alt", "caption", "name", "label", "title"]
                        .iter()
                        .find_map(|k| o.get(*k).map(|v| v.js_string()))
                        .filter(|s| !s.is_empty());
                    let caption = caption.map(|c| format!(" {c}")).unwrap_or_default();
                    out.push(format!("{indent}[{}]{caption}", ty.unwrap_or("block")));
                }
            }
        }
    }
}

/// The joined text of a text block's `children` — the spans' `text`s; a
/// child that is itself a block (nested content) reads as a block line.
fn spans_text(children: Option<&Value>) -> Option<String> {
    let Value::List(items) = children? else {
        return None;
    };
    if items.is_empty() {
        return None;
    }
    let mut text = String::new();
    for item in items.iter() {
        match item {
            Value::Obj(o) => {
                // A span carries `text`; anything else is a nested block's.
                text.push_str(&o.get("text").map(|t| t.js_string()).unwrap_or_default());
            }
            other => text.push_str(&other.to_text()),
        }
    }
    Some(text)
}
