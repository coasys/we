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
        &["blocks"],
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

/// The text a non-painting frontend shows for `node`.
///
/// Per-role defaults: `text`/`label`/`value` props first, then the node's
/// text children. The role-specific shapes the spec fixes: rich text keeps
/// its plain text (marks flatten), a graph outlines `nodes`/`edges`, video
/// degrades to a link, the colour picker lists its tokens, a tree indents
/// its items, a list joins children line-per-child, media names its
/// `alt`/`name`/`src`.
pub fn text_fallback(entry: &CatalogEntry, node: &ResolvedNode) -> String {
    match entry.ty {
        "we-color-picker" => {
            let tokens = match prop(node, "tokens") {
                Value::List(l) => l
                    .iter()
                    .map(|t| t.js_string())
                    .collect::<Vec<_>>()
                    .join(", "),
                _ => text_of(node),
            };
            format!("colours: {tokens}")
        }
        "we-video" => {
            let src = prop_str(node, "src").unwrap_or("");
            format!("video: {}", if src.is_empty() { "link" } else { src })
        }
        _ => role_fallback(entry.role, node),
    }
}

/// The default fallback for a role.
fn role_fallback(role: Role, node: &ResolvedNode) -> String {
    match role {
        Role::Graph => graph_outline(node),
        Role::Tree => tree_outline(node, 0),
        Role::List | Role::Overlay => {
            let mut out = Vec::new();
            for c in &node.children {
                let line = match c {
                    ResolvedChild::Text(t) => t.to_string(),
                    ResolvedChild::Node(n) => {
                        let e = entry(n.ty.as_ref());
                        match e {
                            Some(e) => text_fallback(e, n),
                            None => text_of(n),
                        }
                    }
                };
                if !line.is_empty() {
                    out.push(line);
                }
            }
            if out.is_empty() {
                text_of(node)
            } else {
                out.join("\n")
            }
        }
        Role::RichText | Role::Text | Role::Action => text_of(node),
        Role::Input | Role::Select => {
            let v = prop_str(node, "value").or_else(|| prop_str(node, "label"));
            v.map(|s| s.to_string()).unwrap_or_else(|| text_of(node))
        }
        Role::Media => prop_str(node, "alt")
            .or_else(|| prop_str(node, "name"))
            .or_else(|| prop_str(node, "src"))
            .unwrap_or(node.ty.as_ref())
            .to_string(),
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

/// A graph → an outline of its `nodes` and `edges` props.
fn graph_outline(node: &ResolvedNode) -> String {
    let mut out = Vec::new();
    if let Some(Value::List(nodes)) = node.props.get("nodes") {
        out.push(format!("{} nodes", nodes.len()));
        for n in nodes.iter() {
            out.push(format!("  {}", n.js_string()));
        }
    }
    if let Some(Value::List(edges)) = node.props.get("edges") {
        out.push(format!("{} edges", edges.len()));
        for e in edges.iter() {
            out.push(format!("  {}", e.js_string()));
        }
    }
    if out.is_empty() {
        text_of(node)
    } else {
        out.join("\n")
    }
}

/// A tree → an indented outline of its items (`value`/`label`, children
/// deeper).
fn tree_outline(node: &ResolvedNode, depth: usize) -> String {
    let indent = "  ".repeat(depth);
    let mut out = Vec::new();
    let label = text_of(node);
    if !label.is_empty() && depth > 0 {
        out.push(format!("{indent}{label}"));
    }
    for c in &node.children {
        if let ResolvedChild::Node(n) = c {
            out.push(tree_outline(n, depth + 1));
        }
    }
    out.into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
