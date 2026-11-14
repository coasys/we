//! [`EditState`]: the one piece of widget-owned UI state that lives across
//! frames — which node is being edited, and each widget's scratch value (a
//! `we-input`'s draft text, an IME range). E5b's text widgets write here;
//! E3a only carries the field so the contract is stable.
use std::collections::HashMap;

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
}

impl EditState {
    /// `node`'s scratch value, or `Undefined`.
    pub fn get(&self, node: &NodeId) -> Value {
        self.data.get(node).cloned().unwrap_or(Value::Undefined)
    }
}
