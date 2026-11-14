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
    /// The last reading of each token-object-initial field's `initial`:
    /// the evaluated value plus the `(name → value)` reads the evaluation
    /// made. Fields whose `initial` is a literal never get an entry, so a
    /// static seed never resets.
    initials: HashMap<(NodeId, Arc<str>), (Value, TrackedDeps)>,
    /// `$each` node → its container rows' reference identities — held so a
    /// row's key is the live allocation, never a reusable address.
    each_refs: HashMap<NodeId, RefIds>,
    /// Bumped by [`LocalState::set`] when a write changes a field — one of the
    /// three counters that decide whether the next frame re-resolves.
    version: u64,
}

/// The `(name → value)` reads one tracked evaluation made — a `{"$": …}`
/// initial's dependency list, the way a memo's reads are its deps.
pub(crate) type TrackedDeps = Vec<(Arc<str>, Value)>;

/// The per-`$each` memory one row kind holds: data address → the
/// allocation sequence the row there owns, kept honest by the [`Weak`].
type RefSeq<T> = HashMap<usize, (usize, Weak<T>)>;

/// Per-`$each` reference memory: the sequence number each row allocation
/// was first seen at. The map's key is the row's data address; the stored
/// [`Weak`] answers whether that address still means the same allocation —
/// a freed address can never hand a different row the old row's number
/// (Solid's reference identity, kept across resolves).
#[derive(Debug, Default)]
struct RefIds {
    next: usize,
    objs: RefSeq<IndexMap<Arc<str>, Value>>,
    lists: RefSeq<Vec<Value>>,
}

impl RefIds {
    /// The allocation's sequence — fresh when the address is unknown, and
    /// also fresh when its previous occupant died: the new allocation at
    /// that address is a different row, not the old one back again.
    fn of<T>(next: &mut usize, map: &mut RefSeq<T>, arc: &Arc<T>) -> usize {
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

/// Whether this pass's tracked reads differ from the previous pass's —
/// same names in the same order, each equal to the value it recorded. The
/// comparison is JavaScript-strict, identity and all: a fresh container
/// holding identical content IS a moved dependency — the store key fired —
/// so an equal-content replacement still resets. What must not move are
/// the reads the port rebuilds itself (`routeStore.segments`, a pending
/// query's `[]`, the surface box); the producers keep those identities
/// stable so this comparison can stay honest.
fn deps_moved(prev: &TrackedDeps, next: &TrackedDeps) -> bool {
    prev.len() != next.len()
        || prev
            .iter()
            .zip(next)
            .any(|((n1, v1), (n2, v2))| n1 != n2 || !dep_eq(n1, v1, v2))
}

/// The recorded value's equality. A `$call:` entry is an opaque host
/// computation's settled answer — the port cannot see which reactive
/// inputs the call read, so the honest proxy for "its inputs moved" is
/// whether its answer changed CONTENT: a pure function that allocates a
/// fresh container per call is unmoved while the answer holds (TS sees
/// the internal signals, which never fired). Every other read is strict
/// `===`.
fn dep_eq(name: &str, a: &Value, b: &Value) -> bool {
    if name.starts_with("$call:") {
        crate::scope::content_eq(a, b)
    } else {
        a.strict_eq(b)
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

    /// The tracking effect WE runs for a token-object `initial` — as two
    /// questions, like Solid's memo + effect (SchemaRenderer's initial
    /// effect):
    ///
    /// 1. Did the memo's *inputs* move? `deps` is the `(name → value)`
    ///    multiset this pass's evaluation read; an unchanged multiset
    ///    means the memo did not re-evaluate at all — nothing to do,
    ///    whatever the evaluated value happens to be. That is what lets a
    ///    constant `{"$":"[]"}` initial keep the user's edit: a fresh `[]`
    ///    every pass, but no reads to have changed.
    /// 2. Did the memo *emit*? Only when a dep moved is the new value
    ///    compared — JavaScript `===` — so a re-evaluation producing the
    ///    same value leaves the field and `touched` alone.
    ///
    /// The first read always emits (the effect runs at mount).
    pub fn follow_initial(&self, node: &NodeId, field: &str, evaluated: Value, deps: &TrackedDeps) {
        if let Ok(mut inner) = self.inner.write() {
            let key = (node.clone(), field.into());
            if let Some((prev_value, prev_deps)) = inner.initials.get(&key) {
                if !deps_moved(prev_deps, deps) {
                    return;
                }
                if prev_value.strict_eq(&evaluated) {
                    // Re-evaluated to the identical value — no emit; keep
                    // the field and refresh the recorded reads.
                    inner.initials.insert(key, (evaluated, deps.to_vec()));
                    return;
                }
            }
            // The memo emitted: the field takes the initial and `touched`
            // clears (the effect's `set(next); setTouched(false)`).
            inner
                .initials
                .insert(key.clone(), (evaluated.clone(), deps.to_vec()));
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
        // A namespace can stand in for the object it wraps (`raw()`); the
        // key is the row behind it, not the namespace box.
        let item = match item {
            Value::Namespace(ns) => ns.raw().unwrap_or_else(|| item.clone()),
            _ => item.clone(),
        };
        match &item {
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
