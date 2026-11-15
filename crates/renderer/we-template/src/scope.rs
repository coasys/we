//! The environment a resolve or a handler evaluates against: node scope →
//! store bag → built-ins, one [`we_expr::Env`] over the chain.
//!
//! - [`StoreBag`] is the root-name table — `spaceStore`, `routeStore`, … —
//!   plus the functions expressions call. A [`StoreBag::from_snapshot`]
//!   builds it from a `--snapshot` JSON file (the offline stage's `StaticBag`);
//!   E6 puts the real sources behind the same `root`/`call` surface.
//! - [`bind_screen`] mounts `we-screen`'s [`ScreenBag`] into the table —
//!   `routeStore`, `shellStore`, `themeStore` as namespaces, and
//!   `spaceStore.spacePath` merged into the snapshot's `spaceStore`.
//! - [`LocalNs`] is `local` — the `$localState`/`$queries` fields in scope,
//!   read lazily so a re-resolve picks up writes.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use indexmap::IndexMap;
use we_expr::{CallFn, Env, MapNamespace, Namespace, Value};
use we_screen::ScreenState;

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
/// enumerates: the conduit maps (`routeStore.params`,
/// `shellStore.panels`) are a fresh `MapNamespace` per read but equal
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
/// namespaces this compares are the immutable snapshots Canon and
/// `memo_value` intern — `params`/`panels`/`spacePath` maps and the
/// `$surface`/`$nav` boxes — bounded, acyclic content. Do not extend it
/// to arbitrary live stores without a real snapshot contract.
pub(crate) fn content_eq(a: &Value, b: &Value) -> bool {
    a.strict_eq(b)
        || (matches!(a, Value::Obj(_) | Value::List(_) | Value::Namespace(_))
            && matches!(b, Value::Obj(_) | Value::List(_) | Value::Namespace(_))
            && a.to_json() == b.to_json())
}

/// `(store, member) → canonical allocation`, shared by every bind of the
/// same bag — the flat table [`Canon`] reads through.
type CanonMap = Arc<Mutex<HashMap<(Arc<str>, Arc<str>), Value>>>;

/// The member-read identity TS's screen accessors guarantee, as a flat
/// `(store, member) → canonical value` table on the bag. `segments`,
/// `templateSegments`, `collapsedLanes`, `themeFork` recompute from screen
/// state on every bind, and the `params`/`panels` conduit maps rebuild on
/// every READ — fresh allocations each `get` — but while their content
/// holds the SAME value must answer: `===` on a rebuilt-but-equal read
/// says "moved" where the memo it stands for never emitted, and a
/// rebuilt conduit recorded as a tracked initial's dep would reset it on
/// an unrelated pass. The canonical allocation survives rebinds without
/// any wrapper owning its predecessor: the nth bind carries no history,
/// and an unread member read after many binds asks its source once.
#[derive(Debug, Clone)]
pub(crate) struct Canon {
    store: Arc<str>,
    map: CanonMap,
}

impl Canon {
    /// `candidate`, interned: while the content holds, the canonical
    /// allocation answers (`createMemo`'s unchanged-value identity); a
    /// changed answer replaces it.
    fn get(&self, member: &str, candidate: Value) -> Value {
        let key = (self.store.clone(), member.into());
        let Ok(mut map) = self.map.lock() else {
            return candidate;
        };
        match map.get(&key) {
            Some(held) if content_eq(held, &candidate) => held.clone(),
            _ => {
                map.insert(key, candidate.clone());
                candidate
            }
        }
    }
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
/// revision a frame watches.
///
/// E6 builds the real bag — model reads, flows — behind this same
/// `root`/`call` surface; nothing above it changes.
#[derive(Default)]
pub struct StoreBag {
    roots: RwLock<IndexMap<Arc<str>, Value>>,
    /// The value each screen-mounted name held before the first
    /// `bind_screen` wrapped it — the stable layer under the overlay,
    /// so re-binds replace the overlay rather than stack it.
    screen_bases: RwLock<IndexMap<Arc<str>, Value>>,
    /// `(store, member) → canonical allocation` for the members a screen
    /// bind synthesizes — see [`Canon`]. Flat on the bag, so a rebound
    /// namespace holds no predecessor.
    canon: CanonMap,
    functions: RwLock<HashMap<Arc<str>, CallFn>>,
    queries: RwLock<IndexMap<Arc<str>, Value>>,
    invokes: RwLock<HashMap<String, Value>>,
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

    /// A root name's binding — `spaceStore`, `routeStore`, …
    pub fn root(&self, name: &str) -> Option<Value> {
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

    /// Bind a root name (a store namespace, or a plain value). A real
    /// replacement: the captured screen base goes with it, so the next
    /// `bind_screen` re-anchors its overlay on the new root.
    pub fn set_root(&self, name: &str, value: Value) {
        if let Ok(mut bases) = self.screen_bases.write() {
            bases.shift_remove(name);
        }
        self.bind_root(name, value);
    }

    /// Write a root without touching its captured screen base —
    /// `bind_screen`'s own write path, so the overlay it installs never
    /// becomes the layer the next one reads back.
    fn bind_root(&self, name: &str, value: Value) {
        if let Ok(mut roots) = self.roots.write() {
            roots.insert(name.into(), value);
        }
        self.version.fetch_add(1, Ordering::Relaxed);
    }

    /// The canonical-value table for one store's synthesized members —
    /// `bind_screen` hands one to each namespace it builds.
    fn canon(&self, store: &str) -> Canon {
        Canon {
            store: store.into(),
            map: self.canon.clone(),
        }
    }

    /// Whether `name` is a root `bind_screen` synthesized — it holds a
    /// captured screen base, and [`StoreBag::set_root`] drops that base
    /// when real data replaces the root. WE keeps one live store object
    /// per mount, so the rebuilt wrapper's identity is not an input; the
    /// reads through it (`routeStore.params.id`) are.
    pub(crate) fn is_screen_conduit(&self, name: &str) -> bool {
        self.screen_bases
            .read()
            .is_ok_and(|bases| bases.contains_key(name))
    }

    /// The layer a screen overlay wraps: the value captured before the
    /// first `bind_screen` for this name, or today's root if none was
    /// ever bound.
    fn screen_base(&self, name: &str) -> Value {
        if let Ok(mut bases) = self.screen_bases.write() {
            if let Some(v) = bases.get(name) {
                return v.clone();
            }
            let v = self.root(name).unwrap_or(Value::Undefined);
            bases.insert(name.into(), v.clone());
            return v;
        }
        self.root(name).unwrap_or(Value::Undefined)
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
    /// `shellStore` and `themeStore` are not read from the file —
    /// [`bind_screen`] provides them from `we-screen`'s state.
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

/// A namespace overlaid on whatever a store root already held — the screen's
/// accessor names (`shellStore.activeShellView`, `themeStore.currentThemeId`,
/// `spaceStore.spacePath`) on top, the store's own members underneath. A
/// plain value (not a namespace) answers by name only when it is the
/// overlay's to give.
#[derive(Debug)]
struct MergedNs {
    overlay: Value,
    base: Value,
    /// Reads the overlay owns even when its answer is `Undefined`/`null`.
    owned: &'static [&'static str],
    /// Canonical allocations for the overlay's answers — synthesized
    /// screen members only; forwarded data reads stay live.
    canon: Canon,
}

impl Namespace for MergedNs {
    fn get(&self, key: &str) -> Value {
        let over = match &self.overlay {
            Value::Namespace(ns) => ns.get(key),
            _ => Value::Undefined,
        };
        if self.owned.contains(&key) || !matches!(over, Value::Undefined) {
            return self.canon.get(key, over);
        }
        match &self.base {
            Value::Namespace(ns) => ns.get(key),
            _ => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = match &self.base {
            Value::Namespace(ns) => ns.keys(),
            _ => Vec::new(),
        };
        if let Value::Namespace(ns) = &self.overlay {
            for k in ns.keys() {
                if !keys.iter().any(|e| e == &k) {
                    keys.push(k);
                }
            }
        }
        keys
    }
}

/// `spaceStore` merged with `spacePath` — the snapshot's members underneath,
/// the screen's reading of where we are on top. `spacePath` is a screen fact
/// (`/space/<id>` inside a space, null out); a snapshot cannot carry it
/// because it changes with the route.
#[derive(Debug)]
struct SpaceStoreNs {
    base: Value,
    space_path: Value,
    /// Canonical allocation for `spacePath` — the screen fact; every other
    /// member is the base store's data and reads live.
    canon: Canon,
}

impl Namespace for SpaceStoreNs {
    fn get(&self, key: &str) -> Value {
        if key == "spacePath" {
            return self.canon.get(key, self.space_path.clone());
        }
        match &self.base {
            Value::Namespace(ns) => ns.get(key),
            _ => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        let mut keys = match &self.base {
            Value::Namespace(ns) => ns.keys(),
            _ => Vec::new(),
        };
        if !keys.iter().any(|k| k.as_ref() == "spacePath") {
            keys.push("spacePath".into());
        }
        keys
    }
}

/// Mount the screen's read surface into the bag: `routeStore` ← nav,
/// `shellStore` ← shell, `themeStore` ← theme (the names §4.4 gives a
/// template), and `spaceStore.spacePath` merged into whatever `spaceStore`
/// the bag already holds. Shell and theme are overlays — the screen's
/// accessors first, the store's own members underneath — a real
/// `themeStore` carries `builtInThemes` a screen never answers.
/// Called when `screen.version` moves — the bag version bumps once per
/// changed root.
pub fn bind_screen(bag: &StoreBag, screen: &ScreenState) {
    let sb = screen.bag();
    // One overlay over the captured base — a re-bind replaces the overlay,
    // it never wraps the last one. `Canon` hands each synthesized member a
    // stable identity while its content holds — flat on the bag, so the
    // new root carries no reference to the bind it replaced.
    bag.bind_root(
        "routeStore",
        Value::namespace(MergedNs {
            overlay: sb.get("nav"),
            base: bag.screen_base("routeStore"),
            canon: bag.canon("routeStore"),
            owned: &[
                "params",
                "templateSegments",
                "segments",
                "currentPath",
                "page",
                "href",
                "spacePath",
            ],
        }),
    );
    bag.bind_root(
        "shellStore",
        Value::namespace(MergedNs {
            overlay: sb.get("shell"),
            base: bag.screen_base("shellStore"),
            canon: bag.canon("shellStore"),
            owned: &[
                "activeShellView",
                "spaceSettingsOpen",
                "spaceSettingsTab",
                "collapsedLanes",
                "layoutDirty",
                "panelsHidden",
                "panelMaximised",
                "createSpaceOpen",
                "joinSpaceOpen",
                "panels",
            ],
        }),
    );
    bag.bind_root(
        "themeStore",
        Value::namespace(MergedNs {
            overlay: sb.get("theme"),
            base: bag.screen_base("themeStore"),
            canon: bag.canon("themeStore"),
            // `themeFork` is always the screen's call (`null` = no fork);
            // an unset `currentThemeId` reads Undefined and defers to the
            // store's answer.
            owned: &["themeFork"],
        }),
    );
    bag.bind_root(
        "spaceStore",
        Value::namespace(SpaceStoreNs {
            base: bag.screen_base("spaceStore"),
            space_path: sb.get("nav").read_key("spacePath"),
            canon: bag.canon("spaceStore"),
        }),
    );
}

/// Read one key off a `Value` that may be a namespace — for `spacePath`
/// above, which lives behind `nav`.
trait ReadKey {
    fn read_key(&self, key: &str) -> Value;
}

impl ReadKey for Value {
    fn read_key(&self, key: &str) -> Value {
        match self {
            Value::Namespace(ns) => ns.get(key),
            _ => Value::Undefined,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_screen::{ScreenOp, ScreenSchema, ScreenState};

    fn themed_screen(theme: Option<&str>) -> ScreenState {
        let mut screen = ScreenState::desktop(ScreenSchema::default(), "/");
        if let Some(t) = theme {
            screen.apply(ScreenOp::SetCurrentTheme {
                theme: t.to_string(),
            });
        }
        screen
    }

    fn read(root: &StoreBag, store: &str, key: &str) -> Value {
        match root.root(store) {
            Some(Value::Namespace(ns)) => ns.get(key),
            _ => Value::Undefined,
        }
    }

    #[test]
    fn rebinding_replaces_the_overlay_instead_of_stacking() {
        // B10: each bind wraps the captured base — never the previous
        // overlay. The semantic case: theme X bound, then a screen with no
        // theme — `currentThemeId` must fall back to the STORE's answer,
        // not the stale X overlay.
        let bag = StoreBag::from_snapshot(&serde_json::json!({
            "stores": { "themeStore": {
                "builtInThemes": ["a", "b"],
                "currentThemeId": "store-theme"
            } },
            "queries": {}, "invokes": {}
        }))
        .unwrap();

        bind_screen(&bag, &themed_screen(Some("screen-a")));
        assert!(read(&bag, "themeStore", "currentThemeId").strict_eq(&Value::from("screen-a")));

        // A screen that carries no theme: the store's answer shows again.
        bind_screen(&bag, &themed_screen(None));
        assert!(
            read(&bag, "themeStore", "currentThemeId").strict_eq(&Value::from("store-theme")),
            "an un-themed screen must reveal the base store's theme, not the last overlay: {:?}",
            read(&bag, "themeStore", "currentThemeId")
        );
        assert!(
            matches!(read(&bag, "themeStore", "builtInThemes"), Value::List(_)),
            "store members read through the single overlay"
        );

        // And re-mounting a theme works the same on the stable base.
        bind_screen(&bag, &themed_screen(Some("screen-b")));
        assert!(read(&bag, "themeStore", "currentThemeId").strict_eq(&Value::from("screen-b")));
    }
}
