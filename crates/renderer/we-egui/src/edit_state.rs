//! [`EditState`]: the one piece of widget-owned UI state that lives across
//! frames — which node is being edited, and each widget's scratch value (a
//! `we-input`'s draft, an internal `open` flag, an icon-picker's search
//! string). E5b fills it in; E3a froze the shape.
//!
//! Each node owns one [`Value::Obj`] of named fields — `text` for a draft,
//! `prop` for the prop the draft was seen against, `open` for an internal
//! popover/menu flag — so one node can hold several pieces at once.
use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_template::NodeId;

/// Widget-owned editing state, one per frame owner (app/test). Survives
/// re-resolution — keyed by [`NodeId`] like local state.
#[derive(Debug, Default)]
pub struct EditState {
    /// The node holding keyboard focus, if any.
    pub focused: Option<NodeId>,
    /// Per-widget scratch — a draft string, a selection range.
    pub data: HashMap<NodeId, Value>,
    /// The control that invoked each overlay — a close hands keyboard
    /// focus back to it, the DOM popover's "previously focused element"
    /// rule. Recorded at activation; a never-activated (controlled) open
    /// fills it from the trigger's own interactable.
    pub triggers: HashMap<NodeId, egui::Id>,
    /// What held keyboard focus when each painted modal opened, with the
    /// order it opened in — overlay-element.ts `captureFocus`/
    /// `releaseFocus`: the modal's disappearance hands focus back to it.
    pub modal_openers: HashMap<NodeId, (u64, Option<egui::Id>)>,
    /// The next modal-open sequence number.
    pub modal_seq: u64,
    /// The egui layer each popup last painted on — a programmatic close
    /// asks whether keyboard focus sits there (the DOM hide-popover steps
    /// only return focus that was inside the popover).
    pub popup_layers: HashMap<NodeId, egui::LayerId>,
}

impl EditState {
    /// `node`'s scratch value, or `Undefined`.
    pub fn get(&self, node: &NodeId) -> Value {
        self.data.get(node).cloned().unwrap_or(Value::Undefined)
    }

    /// Field `key` of `node`'s scratch object, or `Undefined`.
    pub fn field(&self, node: &NodeId, key: &str) -> Value {
        match self.data.get(node) {
            Some(Value::Obj(map)) => map.get(key).cloned().unwrap_or(Value::Undefined),
            _ => Value::Undefined,
        }
    }

    /// Write `key` into `node`'s scratch object, keeping the other fields.
    pub fn set_field(&mut self, node: &NodeId, key: &str, value: Value) {
        let entry = self
            .data
            .entry(node.clone())
            .or_insert_with(|| Value::Obj(Arc::new(IndexMap::new())));
        match entry {
            Value::Obj(map) => {
                let map = Arc::make_mut(map);
                map.insert(key.into(), value);
            }
            other => {
                let mut map = IndexMap::new();
                map.insert(key.into(), value);
                *other = Value::Obj(Arc::new(map));
            }
        }
    }

    /// The text a controlled input is drafting, if any.
    pub fn draft(&self, node: &NodeId) -> Option<String> {
        match self.field(node, "text") {
            Value::Str(s) => Some(s.to_string()),
            _ => None,
        }
    }

    /// Store `text` as `node`'s draft, remembering the `value` prop it was
    /// typed against — the next resolve compares, and a different prop wins.
    pub fn set_draft(&mut self, node: &NodeId, text: &str, seen_prop: &Value) {
        self.set_field(node, "text", Value::Str(text.into()));
        self.set_field(node, "prop", seen_prop.clone());
    }

    /// Drop `node`'s draft (`text` and the `prop` it was typed against).
    pub fn clear_draft(&mut self, node: &NodeId) {
        self.set_field(node, "text", Value::Undefined);
        self.set_field(node, "prop", Value::Undefined);
    }

    /// The prop the current draft was typed against, or `Undefined`.
    pub fn seen_prop(&self, node: &NodeId) -> Value {
        self.field(node, "prop")
    }

    /// An internally-open overlay flag (`we-popover`, `DropdownMenu`, the
    /// pickers) — used only when the node carries no `open` prop.
    pub fn is_open(&self, node: &NodeId) -> bool {
        self.field(node, "open").truthy()
    }

    /// Set the internal open flag.
    pub fn set_open(&mut self, node: &NodeId, open: bool) {
        self.set_field(node, "open", Value::Bool(open));
    }

    /// The one transition every popup close shares — menu selection,
    /// Escape, outside click alike: drop the internal open flag and
    /// return keyboard focus to the recorded invoker. (The trigger
    /// toggle is the exception: it keeps a plain `set_open`, focus
    /// never left it.)
    pub fn close_popup(&mut self, ctx: &egui::Context, node: &NodeId) {
        self.set_open(node, false);
        if let Some(id) = self.triggers.get(node) {
            ctx.memory_mut(|m| m.request_focus(*id));
        }
    }

    /// Drop every scratch field `node` held.
    pub fn clear(&mut self, node: &NodeId) {
        self.data.remove(node);
    }
}
