//! [`Provenance`]: the debug marker — which `store.member` reads a route
//! actually drew from the recorded snapshot, which came from native Rust
//! implementations, and which calls were dropped with no answer.
//!
//! Wiring lives in [`crate::offline`]: every store root the snapshot plants is
//! wrapped in a [`RecordingNs`] that notes `store.member` whenever a read comes
//! back with data, and members the [`StoreMap`](crate::StoreMap) gives an
//! implementation to are intercepted by an [`OverlayNs`] before the snapshot
//! sees the read. `$invoke` targets with no reply and executor writes/flows
//! land in `dropped`.
//!
//! The report is data ([`ProvenanceReport`], `Serialize`) plus a plain text
//! table for the `offline-report` example; nothing here knows egui.
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fmt;
use std::sync::{Arc, RwLock};
use we_expr::{Namespace, Value};

/// Shared handle. Cheap to clone — every clone records into the same sets.
#[derive(Debug, Clone, Default)]
pub struct Provenance {
    inner: Arc<RwLock<Inner>>,
}

#[derive(Debug, Default)]
struct Inner {
    snapshot: BTreeSet<String>,
    natives: BTreeSet<String>,
    dropped: Vec<String>,
}

/// What a resolve pass drew from where. The sets are sorted for a stable diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProvenanceReport {
    /// `store.member` reads answered by snapshot data.
    pub snapshot_served: Vec<String>,
    /// Members served by natives — `store.member` for member natives and
    /// `name()` for host-function calls.
    pub native_served: Vec<String>,
    /// Count of dropped calls (`$invoke` with no reply, writes, flows, shape).
    pub dropped_calls: usize,
    /// The dropped call targets, in the order they were dropped.
    pub dropped: Vec<String>,
}

impl Provenance {
    pub fn new() -> Self {
        Self::default()
    }

    /// A snapshot store answered `store.member` with data.
    pub fn note_snapshot(&self, member: impl Into<String>) {
        self.inner
            .write()
            .expect("provenance")
            .snapshot
            .insert(member.into());
    }

    /// A native member or host function served the read.
    pub fn note_native(&self, member: impl Into<String>) {
        self.inner
            .write()
            .expect("provenance")
            .natives
            .insert(member.into());
    }

    /// A call went out with nothing answering it.
    pub fn note_dropped(&self, target: impl Into<String>) {
        self.inner
            .write()
            .expect("provenance")
            .dropped
            .push(target.into());
    }

    /// Fold dropped targets a host collected into the count, draining its list.
    pub fn absorb_dropped(&self, dropped: impl IntoIterator<Item = String>) {
        let mut inner = self.inner.write().expect("provenance");
        inner.dropped.extend(dropped);
    }

    /// Clear both sets and the dropped list — the reset between routes.
    pub fn reset(&self) {
        *self.inner.write().expect("provenance") = Inner::default();
    }

    /// Snapshot of the current state.
    pub fn report(&self) -> ProvenanceReport {
        let inner = self.inner.read().expect("provenance");
        ProvenanceReport {
            snapshot_served: inner.snapshot.iter().cloned().collect(),
            native_served: inner.natives.iter().cloned().collect(),
            dropped_calls: inner.dropped.len(),
            dropped: inner.dropped.clone(),
        }
    }

    /// The report as a plain text table — what `offline-report` prints.
    pub fn report_text(&self) -> String {
        self.report().to_string()
    }
}

impl fmt::Display for ProvenanceReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "served by snapshot ({}):", self.snapshot_served.len())?;
        for member in &self.snapshot_served {
            writeln!(f, "  {member}")?;
        }
        writeln!(f, "served by natives ({}):", self.native_served.len())?;
        for member in &self.native_served {
            writeln!(f, "  {member}")?;
        }
        writeln!(f, "dropped calls ({}):", self.dropped_calls)?;
        for target in &self.dropped {
            writeln!(f, "  {target}")?;
        }
        Ok(())
    }
}

/// The namespace [`crate::offline`] wraps a snapshot store root in: every
/// `get` asks the inner namespace and, when it answers with a real value
/// (not `Undefined`), records `store.member` as snapshot-served.
///
/// A read that comes back `Undefined` is not "served by the snapshot" — the
/// store was asked and had nothing — so it records nothing. `routeStore` and
/// `spaceStore` keep their wrapper under `we-legacy`'s adapter face: the screen
/// facts are intercepted before this namespace sees the read, everything else
/// still flows through and records.
#[derive(Debug)]
pub(crate) struct RecordingNs {
    store: Arc<str>,
    inner: Value,
    provenance: Provenance,
}

impl RecordingNs {
    pub(crate) fn wrap(store: &str, inner: Value, provenance: &Provenance) -> Value {
        Value::Namespace(Arc::new(Self {
            store: store.into(),
            inner,
            provenance: provenance.clone(),
        }))
    }
}

impl Namespace for RecordingNs {
    fn get(&self, key: &str) -> Value {
        let value = member_get(&self.inner, key);
        if !value.is_undefined() {
            self.provenance
                .note_snapshot(format!("{}.{}", self.store, key));
        }
        value
    }

    fn keys(&self) -> Vec<Arc<str>> {
        member_keys(&self.inner)
    }
}

/// What a member-native is made of: a registered Rust implementation over the
/// bag, or a template expression evaluated against it.
#[derive(Clone)]
pub(crate) enum MemberImpl {
    /// `fn(&StoreBag) -> Value` — e.g. `space.offeredInvolvementTypes`.
    Native(Arc<dyn Fn(&crate::StoreBag) -> Value + Send + Sync>),
    /// A `$`-expression evaluated with only the bag as env.
    Expr(Arc<we_expr::Expr>),
}

impl fmt::Debug for MemberImpl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MemberImpl::Native(_) => write!(f, "Native(..)"),
            MemberImpl::Expr(_) => write!(f, "Expr(..)"),
        }
    }
}

/// The overlay for a store that owns native members: `owned` members are
/// answered here (and recorded as native-served), everything else delegates to
/// the base root — the [`RecordingNs`] — which keeps recording snapshot reads.
#[derive(Debug)]
pub(crate) struct OverlayNs {
    store: Arc<str>,
    owned: IndexMap<Arc<str>, MemberImpl>,
    base: Value,
    bag: std::sync::Weak<crate::StoreBag>,
    provenance: Provenance,
}

impl OverlayNs {
    pub(crate) fn wrap(
        store: &str,
        owned: IndexMap<Arc<str>, MemberImpl>,
        base: Value,
        bag: &Arc<crate::StoreBag>,
        provenance: &Provenance,
    ) -> Value {
        Value::Namespace(Arc::new(Self {
            store: store.into(),
            owned,
            base,
            bag: Arc::downgrade(bag),
            provenance: provenance.clone(),
        }))
    }
}

impl Namespace for OverlayNs {
    fn get(&self, key: &str) -> Value {
        let Some(member) = self.owned.get(key) else {
            return member_get(&self.base, key);
        };
        self.provenance
            .note_native(format!("{}.{}", self.store, key));
        let Some(bag) = self.bag.upgrade() else {
            return Value::Undefined;
        };
        match member {
            MemberImpl::Native(f) => f(&bag),
            MemberImpl::Expr(expr) => we_expr::eval(expr.as_ref(), &BagEnv(&bag)),
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = member_keys(&self.base);
        for owned in self.owned.keys() {
            if !keys.contains(owned) {
                keys.push(owned.clone());
            }
        }
        keys
    }
}

/// The `me` root: `sessionStore.me` read through its recording namespace, so
/// `me.did` records `sessionStore.me` — the member that actually served it.
/// Installed only when the snapshot ships no `me` store of its own.
#[derive(Debug)]
pub(crate) struct MeNs {
    session: Value,
}

impl MeNs {
    pub(crate) fn wrap(session: Value) -> Value {
        Value::Namespace(Arc::new(Self { session }))
    }
}

impl Namespace for MeNs {
    fn get(&self, key: &str) -> Value {
        member_get(&member_get(&self.session, "me"), key)
    }
}

/// `env` for member expressions — the bag alone: roots resolve, unknown names
/// are `Undefined`, functions go through `StoreBag::call` (so member exprs can
/// reach the same host functions the template can).
struct BagEnv<'a>(&'a crate::StoreBag);

impl we_expr::Env for BagEnv<'_> {
    fn root(&self, name: &str) -> Option<Value> {
        self.0.root(name)
    }

    fn call(&self, name: &str, args: &[Value]) -> Value {
        self.0.call(name, args)
    }
}

/// Read `key` from a member container — a namespace via [`Namespace::get`], an
/// object via field access, anything else `Undefined`.
pub(crate) fn member_get(container: &Value, key: &str) -> Value {
    match container {
        Value::Namespace(ns) => ns.get(key),
        Value::Obj(map) => map.get(key).cloned().unwrap_or(Value::Undefined),
        _ => Value::Undefined,
    }
}

fn member_keys(container: &Value) -> Vec<Arc<str>> {
    match container {
        Value::Namespace(ns) => ns.keys(),
        Value::Obj(map) => map.keys().cloned().collect(),
        _ => vec![],
    }
}
