//! The environment a resolve or a handler evaluates against: node scope →
//! store bag → built-ins, one [`we_expr::Env`] over the chain.
//!
//! - [`StoreBag`] is the root-name table — `spaceStore`, `routeStore`, … —
//!   plus the functions expressions call. A [`StoreBag::from_snapshot`]
//!   builds it from a `--snapshot` JSON file (the offline stage's `StaticBag`);
//!   E6 puts the real sources behind the same `root`/`call` surface.
//! - The `screen` root is a live [`crate::ScreenView`] the [`crate::Runtime`]
//!   binds once per mount; `we-legacy`'s adapter serves the old store names
//!   on top of it.
//! - [`LocalNs`] is `local` — the `$localState`/`$queries` fields in scope,
//!   read lazily so a re-resolve picks up writes.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock, Weak};

use indexmap::IndexMap;
use we_expr::{CallFn, Env, MapNamespace, MountCx, Namespace, Value};

use crate::bindings::{root_domain, BindingSource, DataRevision, Invalidator};
use crate::gate::{Declared, Gate};
use crate::query::{note_slot_read, QuerySlot, SlotRef};
use crate::{LocalState, NodeId, Scope};

/// What a `$localState` field declared, kept for the handler layer: the
/// field's type, its authored `persist`/`syncParam` spec, and the `initial`
/// it declared (the comparison a `syncParam` write clears against).
/// `we_screen::sync_param` resolves them into keys and param names.
#[derive(Debug, Clone)]
pub struct FieldMeta {
    /// The declared `type` (`string`, `boolean`, `array`, `function`, …).
    pub ty: Arc<str>,
    /// The authored `persist` name — the storage key is `we-local:<persist>`.
    pub persist: Option<Arc<str>>,
    /// The authored `syncParam` spec, raw (`"name"` or `{name, push}`).
    pub sync_param: serde_json::Value,
    /// The declared `initial`, as seeded — `local_param_text` clears a param
    /// whose value came back to this.
    pub declared_initial: Value,
    /// The authored `initial` JSON — the spec a reset re-evaluates, not the
    /// answer it produced (`meta.reset()` calls `resolveInitial(rawInitial)`
    /// in WE). `None` when the field declared no `initial`.
    pub raw_initial: Option<serde_json::Value>,
    /// The scope `initial` first evaluated in — the declaring node's parent
    /// scope. A reset re-evaluates [`FieldMeta::raw_initial`] here against
    /// the call-time bag and screen, where a param a `$setParam` moved reads
    /// its new value.
    pub initial_scope: Scope,
}

/// What a node declares on `local`: a writable `$localState` field, or a
/// read-only `$queries` cell slot filled as the query compiles.
#[derive(Debug, Clone)]
pub enum LocalDecl {
    /// `$localState` — the value lives in [`LocalState`], keyed by the
    /// declaring node's id.
    State(FieldMeta),
    /// `$queries` — rows from the cell the slot was bound to this pass
    /// (`[]` until the query compiles — the gated answer).
    Query(Arc<QuerySlot>),
    /// A `<name>Loaded` companion — `true` once the bound cell holds rows.
    QueryLoaded(Arc<QuerySlot>),
    /// A `<name>Error` companion — the failure the bound cell reported,
    /// `undefined` while it has none (E3c-5a; `onError`'s `err`, readable
    /// where TS only toasts it).
    QueryError(Arc<QuerySlot>),
    /// A static answer — the snapshot's `queries` table before pooling, and
    /// what a `QuerySource` that has no opinion falls back to.
    Static(Value),
}

/// One node's contribution to `local`: its declared fields, innermost
/// declaration searched first.
#[derive(Debug, Clone)]
pub struct LocalScope {
    pub node: NodeId,
    /// The node authored `$localState` at all — even `{}`. WE assigns
    /// `context.$localScopeFields` inside `if (node.$localState)`, so an
    /// explicit-empty block truncates the scope list to `[]` where an
    /// absent key inherits the enclosing scope's.
    pub declared_state: bool,
    pub fields: IndexMap<Arc<str>, LocalDecl>,
}

/// `local.<field>` — the declarations in scope, searched innermost first
/// (WE merges `context.$local` parent-over-child, so the same name wins).
///
/// Reserved reads (`Namespace::keys` never lists them — plumbing, not data):
///
/// - `local["$owner:<field>"]` — the declaring node's id, for a `State`
///   field. That is how a `$setLocal` finds the node it must write.
/// - `local["$decl:<field>"]` — the field's [`FieldMeta`] as an object
///   (`type`, `persistKey`, `syncName`, `syncPush`, `initial`) — what a
///   `$setLocal` mirror needs.
/// - `local["$fields"]` — the declaring scope's `State` field names, for
///   `$resetLocal`/`$touch "$all"`.
#[derive(Debug)]
pub struct LocalNs {
    state: LocalState,
    decls: Arc<Vec<LocalScope>>,
}

impl LocalNs {
    pub fn new(state: LocalState, decls: Arc<Vec<LocalScope>>) -> Self {
        Self { state, decls }
    }

    /// The innermost declaration of `field`, if any.
    pub fn owner(&self, field: &str) -> Option<(&NodeId, &LocalDecl)> {
        self.decls.iter().rev().find_map(|scope| {
            scope
                .fields
                .get_key_value(field)
                .map(|(_, d)| (&scope.node, d))
        })
    }

    /// `field`'s declaration record — the `Namespace::decl` answer, so the
    /// handler layer can read [`FieldMeta`] (the raw initial and its
    /// evaluation scope) where a `Value` cannot carry it.
    pub fn field_decl(&self, field: &str) -> Option<&LocalDecl> {
        self.owner(field).map(|(_, d)| d)
    }

    /// The `State` fields the innermost `$localState` block declared — the
    /// scope a `$resetLocal`/`$touch "$all"` acts on. The search walks back
    /// to the nearest scope whose node authored `$localState`: a
    /// `$queries`-only node inherits the enclosing list, an explicit-empty
    /// `$localState` truncates it to `[]` (WE assigns `scopeFields` inside
    /// `if (node.$localState)` — it does not merge).
    fn scope_fields(&self) -> Vec<Value> {
        self.decls
            .iter()
            .rev()
            .find(|inner| inner.declared_state)
            .map(|inner| {
                inner
                    .fields
                    .iter()
                    .filter(|(_, d)| matches!(d, LocalDecl::State(_)))
                    .map(|(name, _)| Value::Str(name.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }
}

impl Namespace for LocalNs {
    fn get(&self, key: &str) -> Value {
        if let Some(field) = key.strip_prefix("$owner:") {
            return match self.owner(field) {
                Some((node, LocalDecl::State(_))) => node.as_str().into(),
                _ => Value::Undefined,
            };
        }
        if let Some(field) = key.strip_prefix("$decl:") {
            return match self.owner(field) {
                Some((_, LocalDecl::State(meta))) => {
                    let mut o = IndexMap::new();
                    o.insert("type".into(), Value::Str(meta.ty.clone()));
                    o.insert(
                        "persist".into(),
                        meta.persist
                            .as_ref()
                            .map(|p| Value::Str(p.clone()))
                            .unwrap_or(Value::Null),
                    );
                    o.insert("syncParam".into(), Value::from_json(&meta.sync_param));
                    o.insert("initial".into(), meta.declared_initial.clone());
                    Value::Obj(Arc::new(o))
                }
                _ => Value::Undefined,
            };
        }
        if key == "$fields" {
            return Value::List(Arc::new(self.scope_fields()));
        }
        match self.owner(key) {
            Some((node, LocalDecl::State(_))) => self.state.get(node, key),
            Some((node, LocalDecl::Query(slot))) => {
                note_slot_read(&SlotRef::new(node.clone(), key.into(), slot.clone()));
                Value::List(slot.view().rows)
            }
            Some((node, LocalDecl::QueryLoaded(slot))) => {
                // The declaration key is `<q>Loaded` (see `resolve`); the
                // slot it reads is `<q>`'s.
                let name = key.strip_suffix("Loaded").unwrap_or(key);
                note_slot_read(&SlotRef::new(node.clone(), name.into(), slot.clone()));
                Value::Bool(slot.view().loaded)
            }
            Some((node, LocalDecl::QueryError(slot))) => {
                // `<q>Error` reads `<q>`'s slot like `<q>Loaded` does —
                // the recorded failure, `undefined` until one lands.
                let name = key.strip_suffix("Error").unwrap_or(key);
                note_slot_read(&SlotRef::new(node.clone(), name.into(), slot.clone()));
                slot.view().error.unwrap_or(Value::Undefined)
            }
            Some((_, LocalDecl::Static(value))) => value.clone(),
            None => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        self.decls
            .iter()
            .flat_map(|scope| scope.fields.keys().cloned())
            .collect()
    }

    fn decl(&self, field: &str) -> Option<&dyn std::any::Any> {
        self.field_decl(field).map(|d| d as &dyn std::any::Any)
    }
}

/// `===`, relaxed once for the port's own rebuilds: two containers holding
/// the same content count as one identity. This is the producer side of
/// `deps_moved`'s strict compare — a member a TS memo stands for emits
/// only when its answer differs, not when a rebuild allocated it again —
/// so equal content inherits the predecessor's allocation rather than
/// pretending the memo fired. A namespace's content is what it
/// enumerates: the conduit maps (`screen.params`,
/// `screen.panels`) are a fresh `MapNamespace` per read but equal
/// while the screen holds — interning needs the same relaxation for
/// them, or a held conduit read (the initial's value, or one an index
/// expression's own reads interleave under) moves every pass.
///
/// It is NOT general namespace equality. `to_json` compares what a
/// namespace enumerates, not what it can answer: two live namespaces can
/// list the same keys and same-named accessors yet return different
/// effective values (a callable serializes as its name; a non-enumerable
/// namespace encodes one opaque marker), and equal enumeration says
/// nothing about `raw()`, hidden keys or future answers. The only
/// namespaces this compares are the immutable snapshots the `ScreenView`
/// canon and `memo_value` intern — `params`/`panels`/`spacePath` maps and
/// the `$surface`/`$nav` boxes — bounded, acyclic content. Do not extend
/// it to arbitrary live stores without a real snapshot contract.
/// `pub` for `we-legacy`'s adapter — its `Canon` interns by the same
/// comparison.
pub fn content_eq(a: &Value, b: &Value) -> bool {
    a.strict_eq(b)
        || (matches!(a, Value::Obj(_) | Value::List(_) | Value::Namespace(_))
            && matches!(b, Value::Obj(_) | Value::List(_) | Value::Namespace(_))
            && a.to_json() == b.to_json())
}

/// The [`Env`] a resolve evaluates against: the node's [`Scope`] bindings
/// first (innermost last), then the root table — session layer, then the
/// shared bag; functions from the bag alone.
pub struct ScopeEnv<'a> {
    pub scope: &'a Scope,
    pub bag: Roots<'a>,
}

impl Env for ScopeEnv<'_> {
    fn root(&self, name: &str) -> Option<Value> {
        match self.scope.get(name) {
            Some(value) => {
                // A binding derived from a query slot reads through it.
                for slot in self.scope.slots_of(name) {
                    note_slot_read(slot);
                }
                Some(value.clone())
            }
            None => self.bag.root(name),
        }
    }

    fn call(&self, name: &str, args: &[Value]) -> Value {
        self.bag.call(name, args)
    }
}

/// A mount's own root bindings, layered over the shared [`StoreBag`]
/// (E3c-6, shared-bag fix): the `screen` view a runtime binds at
/// construction and the legacy faces `we-legacy` installs are per-session
/// answers — two sessions sharing one bag keep their own, where a shared
/// slot made the last install win for every session on it. [`Roots::root`]
/// reads the layer first, then the bag.
pub struct RootLayer {
    /// The shared bag this layer sits over — `Weak`: a mount's own table
    /// must never keep the bag alive, and the faces' weak backref comes
    /// from here (a face binding an `Arc` of its own would leak the bag
    /// the way the in-bag adapter did).
    bag: Weak<StoreBag>,
    /// `name` → this mount's own binding — `screen`, the legacy faces.
    roots: RwLock<IndexMap<Arc<str>, Value>>,
}

impl std::fmt::Debug for RootLayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RootLayer")
            .field("roots", &self.roots)
            .finish_non_exhaustive()
    }
}

impl RootLayer {
    /// A layer over `bag` — one per mount, built at construction.
    pub fn new(bag: &Arc<StoreBag>) -> Self {
        Self {
            bag: Arc::downgrade(bag),
            roots: RwLock::new(IndexMap::new()),
        }
    }

    /// `name`'s binding in the layer — `None` defers to the bag.
    pub fn get(&self, name: &str) -> Option<Value> {
        self.roots.read().ok()?.get(name).cloned()
    }

    /// Bind `name` in the layer — a construction-time write: the `screen`
    /// view and the legacy faces are installed here, so they are the
    /// session's own from the start. No revision moves — the mount holds
    /// this layer exclusively, and it is not a data arrival.
    pub fn bind(&self, name: &str, value: Value) {
        if let Ok(mut roots) = self.roots.write() {
            roots.insert(name.into(), value);
        }
    }

    /// The shared bag under the layer — the weak backref a face reads
    /// `root_base` through.
    pub fn bag(&self) -> &Weak<StoreBag> {
        &self.bag
    }
}

/// The authority a [`Roots`] view gates reads by (E3c-8a): the session's
/// [`BindingSource`] and [`Gate`] plus the frame's authority and declared
/// panels/dialogs. `auth`/`declared` are OWNED — a nested frame swaps them
/// in place (`for_auth`) without re-borrowing the session's long-lived
/// parts; every template-facing `Roots` carries one, and a `Roots` without
/// it is core plumbing that never reaches a template read.
#[derive(Debug, Clone)]
pub struct GateRead<'a> {
    /// Who answers the root name.
    pub source: &'a dyn BindingSource,
    /// The single choke point.
    pub gate: &'a Arc<Gate>,
    /// The compat names `source` serves (its `compat_roots`).
    pub compat: &'a [Arc<str>],
    /// The frame's authority — the asking mount.
    pub auth: MountCx,
    /// The frame's declared panel/dialog ids.
    pub declared: Declared,
}

/// One mount's view of the root table: the session's own bindings
/// (`screen`, the legacy faces) first, the shared bag underneath. `root`
/// is the only layered answer — `call` and every other bag answer is the
/// bag's own. Two sessions on one bag read different `Roots`, so a
/// session's screen and faces are never another session's.
///
/// With `gate` set, `root` is the E3c-8a boundary: the gate classifies the
/// name, the source answers it, and the answer wears the member filter
/// before a template sees it.
#[derive(Debug, Clone)]
pub struct Roots<'a> {
    /// The mount's own bindings — `None` for a bare-bag `Roots`.
    pub layer: Option<&'a RootLayer>,
    /// The shared bag — data roots and functions.
    pub bag: &'a StoreBag,
    /// The gate context — `Some` on every resolve/dispatch read path.
    pub gate: Option<GateRead<'a>>,
}

impl<'a> Roots<'a> {
    /// `layer` over `bag` — what a runtime's resolve and dispatch read.
    pub fn new(layer: &'a RootLayer, bag: &'a StoreBag) -> Self {
        Self {
            layer: Some(layer),
            bag,
            gate: None,
        }
    }

    /// A bare bag — a caller with no mount layer reads the bag's own roots.
    pub fn unlayered(bag: &'a StoreBag) -> Self {
        Self {
            layer: None,
            bag,
            gate: None,
        }
    }

    /// This view gated by `auth`/`declared` — the read boundary every
    /// template-facing evaluation sits behind.
    pub fn gated(
        self,
        source: &'a dyn BindingSource,
        gate: &'a Arc<Gate>,
        compat: &'a [Arc<str>],
        auth: MountCx,
        declared: Declared,
    ) -> Self {
        Self {
            gate: Some(GateRead {
                source,
                gate,
                compat,
                auth,
                declared,
            }),
            ..self
        }
    }

    /// The same view under a nested frame's authority — the resolver's
    /// frame push: the source and gate stay, the authority and its
    /// declared ids become the frame's own. Owned, so the swap needs no
    /// shorter borrow than the session's own.
    pub fn for_auth(&self, auth: MountCx, declared: Declared) -> Roots<'a> {
        Roots {
            layer: self.layer,
            bag: self.bag,
            gate: self.gate.as_ref().map(|g| GateRead {
                source: g.source,
                gate: g.gate,
                compat: g.compat,
                auth,
                declared,
            }),
        }
    }

    /// `name`'s binding — through the gate when this view carries one:
    /// core's [`root_domain`] classifies first (deny before the source is
    /// asked), then the source answers and its answer wears the member
    /// filter. Ungated: the mount's own bindings, then the bag.
    pub fn root(&self, name: &str) -> Option<Value> {
        let Some(g) = &self.gate else {
            return self
                .layer
                .and_then(|layer| layer.get(name))
                .or_else(|| self.bag.root(name));
        };
        let classified = root_domain(name, g.compat);
        if let Some(domain) = classified {
            if !g.gate.root(&g.auth, name, domain).allowed() {
                return None;
            }
        }
        let Some(bound) = g.source.root(name, &g.auth) else {
            // Nothing by that name. An unclassified one still has a
            // verdict — counted, so a probe leaves its diagnostic.
            if classified.is_none() {
                g.gate.root_unknown(&g.auth, name);
            }
            return None;
        };
        let Some(domain) = classified.or(bound.domain) else {
            // Served, but neither core nor the source classifies it:
            // refused and counted (Lal F3 — never labelled Space).
            g.gate.root_unknown(&g.auth, name);
            return None;
        };
        if classified.is_none() && !g.gate.root(&g.auth, name, domain).allowed() {
            return None;
        }
        g.gate.serve(name, domain, bound, &g.auth, &g.declared)
    }

    /// The profile `$agent` binds — the source's answer under this view's
    /// authority (`None` for ungated plumbing roots, which never resolve).
    pub fn profile(&self, did: &str) -> Option<Value> {
        self.gate
            .as_ref()
            .and_then(|g| g.source.profile(did, &g.auth))
    }

    /// `Env::call` — functions belong to the shared bag alone.
    ///
    /// **Not gated (Lal F4): a host function must be pure.** The call
    /// carries no authority — the function sees its arguments (values the
    /// calling frame was already allowed to read) and nothing else, and its
    /// answer is handed back as is. A registrant that reads a store, the
    /// session or any other host state inside the function, or returns a
    /// namespace or accessor over such state, walks round the read
    /// boundary; register a root (through the `BindingSource`) instead.
    /// The bundled natives (`we-data`'s nine) are pure argument
    /// computations.
    pub fn call(&self, name: &str, args: &[Value]) -> Value {
        self.bag.call(name, args)
    }
}

impl<'a> From<&'a StoreBag> for Roots<'a> {
    fn from(bag: &'a StoreBag) -> Self {
        Self::unlayered(bag)
    }
}

/// The store bag: root names → namespaces (or plain values), the function
/// table [`Env::call`] reads, and the snapshot's static answers —
/// `$queries` rows and canned `$invoke` replies. Everything mutable is
/// behind locks and bumps [`StoreBag::version`] so a write moves the data
/// revision a frame watches — and a `set_root` write goes further: it
/// calls every [`Invalidator`] a session subscribed, so a sleeping
/// frontend hears the revision move.
///
/// E6 builds the real bag — model reads, flows — behind this same
/// `root`/`call` surface; nothing above it changes.
#[derive(Default)]
pub struct StoreBag {
    roots: RwLock<IndexMap<Arc<str>, Value>>,
    functions: RwLock<HashMap<Arc<str>, CallFn>>,
    queries: RwLock<IndexMap<Arc<str>, Value>>,
    invokes: RwLock<HashMap<String, Value>>,
    /// The sessions listening for `set_root` — one [`Invalidator`] each,
    /// so several sessions can share a bag and each hears every write.
    invalidators: Mutex<Vec<Invalidator>>,
    version: AtomicU64,
}

impl std::fmt::Debug for StoreBag {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoreBag")
            .field("roots", &self.roots)
            .field("queries", &self.queries)
            .field("invokes", &self.invokes)
            .finish_non_exhaustive()
    }
}

impl StoreBag {
    pub fn new() -> Self {
        Self::default()
    }

    /// A root name's binding — `spaceStore`, `routeStore`, … — the store
    /// root a `set_root` wrote. Session-owned bindings (`screen`, the
    /// legacy faces) live in the mount's [`RootLayer`], never here.
    pub fn root(&self, name: &str) -> Option<Value> {
        self.roots.read().ok()?.get(name).cloned()
    }

    /// The store root under a face's overlay — what `set_root` writes.
    /// A screen face reads its base through here, at read time; for a
    /// name with no face this is the same answer [`StoreBag::root`] gives.
    pub fn root_base(&self, name: &str) -> Option<Value> {
        self.roots.read().ok()?.get(name).cloned()
    }

    /// A function call — built-ins in E1, natives in E6. Unknown → `Undefined`.
    pub fn call(&self, name: &str, args: &[Value]) -> Value {
        self.functions
            .read()
            .ok()
            .and_then(|f| f.get(name).cloned())
            .map(|f| f(args))
            .unwrap_or(Value::Undefined)
    }

    /// The data revision — one of the frame's counters.
    pub fn version(&self) -> u64 {
        self.version.load(Ordering::Relaxed)
    }

    /// Subscribe to `set_root` writes — the [`DataRevision::subscribe`] a
    /// session installs one [`Invalidator`] at a time through. Several
    /// sessions may share a bag: each hears every write, and a handle
    /// whose session's inbox died is pruned as it is noticed. A second
    /// subscription from the same inbox *replaces* the first — the
    /// session's own re-install must not double the arrivals.
    pub fn set_invalidator(&self, invalidator: Invalidator) {
        if let Ok(mut subs) = self.invalidators.lock() {
            subs.retain(|i| i.alive() && !i.same_inbox(&invalidator));
            subs.push(invalidator);
        }
    }

    /// Bind a root name (a store namespace, or a plain value) — a real
    /// replacement: whatever the name held is dropped. Called AFTER the
    /// version bump — a reader that wakes now already sees the moved
    /// revision.
    pub fn set_root(&self, name: &str, value: Value) {
        self.bind_root(name, value);
        self.invalidate_subscribers();
    }

    /// The data revision moved — tell every live subscriber. Only
    /// `set_root` reaches here.
    ///
    /// The lock is released before any `invalidate` runs: the invalidator
    /// ends in the session's waker — arbitrary frontend code — and a
    /// callback that re-enters the bag (a `set_root` of its own, a new
    /// subscription) would deadlock on a held mutex, while a panicking
    /// one would poison it for every later write. So the live handles
    /// are pruned and cloned under the lock, then notified outside it.
    fn invalidate_subscribers(&self) {
        let live: Vec<Invalidator> = {
            let Ok(mut subs) = self.invalidators.lock() else {
                return;
            };
            subs.retain(|i| i.alive());
            subs.iter().cloned().collect()
        };
        for i in &live {
            i.invalidate();
        }
    }

    /// Write a root, bumping the data revision — `set_root`'s write half,
    /// without the invalidation.
    pub(crate) fn bind_root(&self, name: &str, value: Value) {
        if let Ok(mut roots) = self.roots.write() {
            roots.insert(name.into(), value);
        }
        self.version.fetch_add(1, Ordering::Relaxed);
    }

    /// Register a function (`Env::call` reaches it).
    ///
    /// Purity contract — **the read boundary does not see inside a
    /// function** (Lal F4): every frame, Space included, may call it, with
    /// no authority attached. It must compute its answer from its
    /// arguments alone and return plain data — never read a store or host
    /// state, never return a namespace or accessor over one. See
    /// [`Roots::call`].
    ///
    /// Reactivity contract — **output-content tracking**: a tracked
    /// `{"$": …}` initial that calls this function records the call's
    /// settled answer under `$call:<name>` and compares it by *content*
    /// between passes. The port cannot see which reactive inputs the
    /// function read while it ran, so "the inputs moved" means "the answer
    /// changed". A registrant whose answer depends on inputs it does not
    /// reflect in the result diverges from TS: the Solid memo re-runs when
    /// an internal signal fires even if the answer's content is identical,
    /// while here the edit stands. Keep answers a pure function of the
    /// inputs a caller would expect tracked.
    pub fn set_function(&self, name: &str, f: CallFn) {
        if let Ok(mut functions) = self.functions.write() {
            functions.insert(name.into(), f);
        }
    }

    /// A static answer a `$queries` field may fall back to — `queries.<name>`
    /// in the snapshot. `Undefined` when the snapshot does not name it.
    pub fn query(&self, name: &str) -> Value {
        self.queries
            .read()
            .ok()
            .and_then(|q| q.get(name).cloned())
            .unwrap_or(Value::Undefined)
    }

    /// A canned `$invoke` reply from the snapshot's `invokes` table.
    pub fn invoke_reply(&self, target: &str) -> Option<Value> {
        self.invokes.read().ok()?.get(target).cloned()
    }

    /// The snapshot shape:
    ///
    /// ```json
    /// { "stores":  { "spaceStore": { "root": "demo", "members": […] },
    ///                "modules":    { "call": { "liveCalls": [] } } },
    ///   "queries": { "calls": […], "signalTypes": […] },
    ///   "invokes": { "spaceStore.create": { "ok": true } } }
    /// ```
    ///
    /// Each store is an object of members → a [`MapNamespace`]; each entry of
    /// `queries` is the rows `local.<name>` answers; `invokes` maps a
    /// `$invoke` target to the `Done` value it replies. `routeStore`,
    /// `shellStore` and `themeStore` are not read from the file — the
    /// `we-legacy` adapter serves them from the live `screen` view.
    pub fn from_snapshot(json: &serde_json::Value) -> Result<StoreBag, String> {
        let bag = StoreBag::new();
        let Some(obj) = json.as_object() else {
            return Err("snapshot must be a JSON object".to_string());
        };
        if let Some(stores) = obj.get("stores").and_then(|s| s.as_object()) {
            let mut roots = bag
                .roots
                .write()
                .map_err(|_| "snapshot store table poisoned".to_string())?;
            for (name, members) in stores {
                let map: IndexMap<Arc<str>, Value> = members
                    .as_object()
                    .ok_or_else(|| format!("snapshot store {name:?} must be an object"))?
                    .iter()
                    .map(|(k, v)| (k.as_str().into(), Value::from_json(v)))
                    .collect();
                roots.insert(name.as_str().into(), Value::from(MapNamespace::new(map)));
            }
        }
        if let Some(queries) = obj.get("queries").and_then(|q| q.as_object()) {
            let mut table = bag
                .queries
                .write()
                .map_err(|_| "snapshot query table poisoned".to_string())?;
            for (name, rows) in queries {
                table.insert(name.as_str().into(), Value::from_json(rows));
            }
        }
        if let Some(invokes) = obj.get("invokes").and_then(|i| i.as_object()) {
            let mut table = bag
                .invokes
                .write()
                .map_err(|_| "snapshot invoke table poisoned".to_string())?;
            for (target, reply) in invokes {
                table.insert(target.clone(), Value::from_json(reply));
            }
        }
        Ok(bag)
    }
}

/// The bag as a `DataRevision` source — `version` is the counter,
/// `set_invalidator` the hook. `BindingSource` (E3c-8a) makes the trait a
/// supertrait; this is the offline path's and the E3c-2 in-scope
/// implementor.
impl DataRevision for StoreBag {
    fn revision(&self) -> u64 {
        self.version()
    }

    fn subscribe(&self, invalidator: Invalidator) {
        self.set_invalidator(invalidator);
    }
}
