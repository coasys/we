//! [`LocalState`]: the `$localState` fields of every mounted node, keyed by
//! [`NodeId`]. One store belongs to one [`crate::Runtime`]; the [`Host`] the
//! app runs handlers against shares it — a `$setLocal` write lands here, the
//! version moves, and the next [`Runtime::frame`](crate::Runtime) re-resolves.
//!
//! Mirrors WE's per-node `createSignal` per field
//! (`SchemaRenderer.tsx` `$localState`): a field lives while its node is in
//! the resolved tree and dies with it ([`LocalState::retain`]), and a write
//! that changes nothing — `===` — does not count as a change.
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use we_expr::Value;

use crate::NodeId;

/// The `$localState` bag, keyed `(node, field)`. Cheap to clone: everything
/// inside is shared, so the [`crate::Runtime`], the [`crate::Host`] and the
/// `local` namespaces built during resolve all see the same fields.
#[derive(Debug, Default, Clone)]
pub struct LocalState {
    inner: Arc<RwLock<Inner>>,
}

#[derive(Debug, Default)]
struct Inner {
    fields: HashMap<(NodeId, Arc<str>), Value>,
    /// Bumped by [`LocalState::set`] when a write changes a field — one of the
    /// three counters that decide whether the next frame re-resolves.
    version: u64,
}

impl LocalState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The local revision — one of the frame's three counters.
    pub fn version(&self) -> u64 {
        self.inner.read().map(|i| i.version).unwrap_or(0)
    }

    /// `node`'s `field`, or `Undefined` — an unset field reads as unset, not as
    /// an error, whatever declared it.
    pub fn get(&self, node: &NodeId, field: &str) -> Value {
        self.inner
            .read()
            .ok()
            .and_then(|i| i.fields.get(&(node.clone(), field.into())).cloned())
            .unwrap_or(Value::Undefined)
    }

    /// Whether the field was seeded or written — not whether it is defined.
    pub fn contains(&self, node: &NodeId, field: &str) -> bool {
        self.inner
            .read()
            .map(|i| i.fields.contains_key(&(node.clone(), field.into())))
            .unwrap_or(false)
    }

    /// Seed a field's `initial` at resolve time, once. A seed is not a write:
    /// it does not move the version (the resolve it happens inside already
    /// did), and it never overwrites a field that exists — a re-resolve of an
    /// unchanged tree keeps the values it had.
    pub fn seed(&self, node: &NodeId, field: &str, value: Value) {
        if let Ok(mut inner) = self.inner.write() {
            inner
                .fields
                .entry((node.clone(), field.into()))
                .or_insert(value);
        }
    }

    /// A handler's write (`$setLocal` and friends). The version moves only when
    /// the value changed — `createSignal`'s `===` check in WE: setting the same
    /// value does not re-render.
    pub fn set(&self, node: &NodeId, field: &str, value: Value) {
        if let Ok(mut inner) = self.inner.write() {
            let key = (node.clone(), field.into());
            let changed = match inner.fields.get(&key) {
                Some(old) => !old.strict_eq(&value),
                None => true,
            };
            if changed {
                inner.fields.insert(key, value);
                inner.version += 1;
            }
        }
    }

    /// Drop the fields of every node not in `live` — a node that leaves the
    /// resolved tree takes its state with it (an unmount in WE).
    pub fn retain(&self, live: &HashSet<NodeId>) {
        if let Ok(mut inner) = self.inner.write() {
            inner.fields.retain(|(node, _), _| live.contains(node));
        }
    }
}
