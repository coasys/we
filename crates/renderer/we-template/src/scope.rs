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
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use indexmap::IndexMap;
use we_expr::{CallFn, Env, MapNamespace, Namespace, Value};

use crate::bindings::{DataRevision, Invalidator};
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
                match slot.state() {
                    crate::query::QueryState::Rows(rows) => Value::List(rows),
                    crate::query::QueryState::Loading => Value::List(empty_rows()),
                }
            }
            Some((node, LocalDecl::QueryLoaded(slot))) => {
                // The declaration key is `<q>Loaded` (see `resolve`); the
                // slot it reads is `<q>`'s.
                let name = key.strip_suffix("Loaded").unwrap_or(key);
                note_slot_read(&SlotRef::new(node.clone(), name.into(), slot.clone()));
                Value::Bool(matches!(slot.state(), crate::query::QueryState::Rows(_)))
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

/// One `[]` for every pending query. A Loading cell's rows are a stable
/// empty list — WE's `[]` initial keeps its allocation until rows land —
/// where a fresh `[]` per read would look like a dependency that always
/// moves to a tracked `initial`.
fn empty_rows() -> Arc<Vec<Value>> {
    static EMPTY: OnceLock<Arc<Vec<Value>>> = OnceLock::new();
    EMPTY.get_or_init(|| Arc::new(Vec::new())).clone()
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
/// first (innermost last), then the store bag; functions from the bag alone.
pub struct ScopeEnv<'a> {
    pub scope: &'a Scope,
    pub bag: &'a StoreBag,
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
    /// Adapter faces bound over root names — `we-legacy`'s screen adapter
    /// installs one per legacy store. `root` answers the face while
    /// `set_root` keeps writing the base the face reads through
    /// [`StoreBag::root_base`]: nothing is captured anywhere, so a
    /// `set_root` swap is the face's very next answer (5.1's live-base
    /// rule — the runtime-rebind residual cannot come back).
    adapters: RwLock<IndexMap<Arc<str>, Value>>,
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

    /// A root name's binding — `spaceStore`, `routeStore`, … — the
    /// adapter's face when one is installed, else the store root.
    pub fn root(&self, name: &str) -> Option<Value> {
        if let Ok(faces) = self.adapters.read() {
            if let Some(face) = faces.get(name) {
                return Some(face.clone());
            }
        }
        self.roots.read().ok()?.get(name).cloned()
    }

    /// The store root under an adapter's face — what `set_root` writes.
    /// A screen adapter reads its base through here, at read time; for a
    /// name with no adapter this is the same answer [`StoreBag::root`]
    /// gives.
    pub fn root_base(&self, name: &str) -> Option<Value> {
        self.roots.read().ok()?.get(name).cloned()
    }

    /// Install a face over a root name — `we-legacy`'s adapter binds the
    /// legacy screen stores once per session. `root(name)` answers `face`
    /// from here on; `set_root` writes keep landing in the base the face
    /// reads live. Bumps the data revision — the root's answer moved —
    /// but never invalidates: an install is construction, not a write a
    /// session should wake for.
    pub fn install_adapter(&self, name: &str, face: Value) {
        if let Ok(mut faces) = self.adapters.write() {
            faces.insert(name.into(), face);
        }
        self.version.fetch_add(1, Ordering::Relaxed);
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
    /// whose session's inbox died is pruned as it is noticed.
    pub fn set_invalidator(&self, invalidator: Invalidator) {
        if let Ok(mut subs) = self.invalidators.lock() {
            subs.retain(|i| i.alive());
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
    /// without the invalidation: the `screen` root's one-time bind and
    /// `install_adapter` reach here, since a binding installed at
    /// construction is not a data arrival a session should wake for.
    pub(crate) fn bind_root(&self, name: &str, value: Value) {
        if let Ok(mut roots) = self.roots.write() {
            roots.insert(name.into(), value);
        }
        self.version.fetch_add(1, Ordering::Relaxed);
    }

    /// Register a function (`Env::call` reaches it).
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
