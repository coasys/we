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
use std::sync::{Arc, RwLock, Weak};

use indexmap::IndexMap;
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
    /// Fields `$touch` has marked — validation reads ("field was edited").
    /// Cleared when the owning node leaves the tree.
    touched: HashSet<(NodeId, Arc<str>)>,
    /// The last-evaluated `initial` of each token-object-initial field —
    /// the tracking effect's previous reading. Fields whose `initial` is a
    /// literal never get an entry, so a static seed never resets.
    initials: HashMap<(NodeId, Arc<str>), Value>,
    /// `$each` node → its container rows' reference identities — held so a
    /// row's key is the live allocation, never a reusable address.
    each_refs: HashMap<NodeId, RefIds>,
    /// Bumped by [`LocalState::set`] when a write changes a field — one of the
    /// three counters that decide whether the next frame re-resolves.
    version: u64,
}

/// Per-`$each` reference memory: the sequence number each row allocation
/// was first seen at. The map's key is the row's data address; the stored
/// [`Weak`] answers whether that address still means the same allocation —
/// a freed address can never hand a different row the old row's number
/// (Solid's reference identity, kept across resolves).
#[derive(Debug, Default)]
struct RefIds {
    next: usize,
    objs: HashMap<usize, (usize, Weak<IndexMap<Arc<str>, Value>>)>,
    lists: HashMap<usize, (usize, Weak<Vec<Value>>)>,
}

impl RefIds {
    /// The allocation's sequence — fresh when the address is unknown, and
    /// also fresh when its previous occupant died: the new allocation at
    /// that address is a different row, not the old one back again.
    fn of<T>(next: &mut usize, map: &mut HashMap<usize, (usize, Weak<T>)>, arc: &Arc<T>) -> usize {
        let ptr = Arc::as_ptr(arc) as usize;
        if let Some((seq, weak)) = map.get(&ptr) {
            if weak.upgrade().is_some() {
                return *seq;
            }
        }
        let seq = *next;
        *next += 1;
        map.insert(ptr, (seq, Arc::downgrade(arc)));
        seq
    }

    /// Drop entries whose allocation is gone — dead memory, not identity.
    fn prune(&mut self) {
        self.objs.retain(|_, (_, w)| w.upgrade().is_some());
        self.lists.retain(|_, (_, w)| w.upgrade().is_some());
    }
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

    /// The tracking effect WE runs for a token-object `initial`: when the
    /// evaluated source moves between passes — the first read included —
    /// the field takes the new value and `touched` clears. Called at
    /// resolve with this pass's evaluated initial; literal initials never
    /// enter, so a static seed keeps whatever the field holds.
    pub fn follow_initial(&self, node: &NodeId, field: &str, evaluated: Value) {
        if let Ok(mut inner) = self.inner.write() {
            let key = (node.clone(), field.into());
            if inner
                .initials
                .get(&key)
                .is_some_and(|prev| prev.strict_eq(&evaluated))
            {
                return;
            }
            inner.initials.insert(key.clone(), evaluated.clone());
            let changed = match inner.fields.get(&key) {
                Some(old) => !old.strict_eq(&evaluated),
                None => true,
            };
            if changed {
                inner.fields.insert(key.clone(), evaluated);
                inner.version += 1;
            }
            if inner.touched.remove(&key) {
                inner.version += 1;
            }
        }
    }

    /// The `$each` at `node`: the identity sequence this container row's
    /// allocation holds — stable while the allocation is, and never
    /// inherited by a different allocation that later reuses the address.
    pub fn row_ref(&self, node: &NodeId, item: &Value) -> usize {
        let Ok(mut inner) = self.inner.write() else {
            return 0;
        };
        let refs = inner.each_refs.entry(node.clone()).or_default();
        match item {
            Value::Obj(o) => RefIds::of(&mut refs.next, &mut refs.objs, o),
            Value::List(l) => RefIds::of(&mut refs.next, &mut refs.lists, l),
            _ => 0,
        }
    }

    /// `$touch` — mark the field edited (WE: `setTouched` for validation).
    /// Bumps the version; a touched state can flip a guard.
    pub fn touch(&self, node: &NodeId, field: &str) {
        if let Ok(mut inner) = self.inner.write() {
            if inner.touched.insert((node.clone(), field.into())) {
                inner.version += 1;
            }
        }
    }

    /// Clear the touch — `$resetLocal`'s `meta.reset()` clears it with the
    /// value.
    pub fn untouch(&self, node: &NodeId, field: &str) {
        if let Ok(mut inner) = self.inner.write() {
            if inner.touched.remove(&(node.clone(), field.into())) {
                inner.version += 1;
            }
        }
    }

    /// Whether `$touch` has marked the field this mount.
    pub fn is_touched(&self, node: &NodeId, field: &str) -> bool {
        self.inner
            .read()
            .map(|i| i.touched.contains(&(node.clone(), field.into())))
            .unwrap_or(false)
    }

    /// Drop the fields of every node not in `live` — a node that leaves the
    /// resolved tree takes its state with it (an unmount in WE).
    pub fn retain(&self, live: &HashSet<NodeId>) {
        if let Ok(mut inner) = self.inner.write() {
            inner.fields.retain(|(node, _), _| live.contains(node));
            inner.touched.retain(|(node, _)| live.contains(node));
            inner.initials.retain(|(node, _), _| live.contains(node));
            inner.each_refs.retain(|node, _| live.contains(node));
            for refs in inner.each_refs.values_mut() {
                refs.prune();
            }
        }
    }
}
