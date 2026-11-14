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
use std::sync::{Arc, RwLock};

use indexmap::IndexMap;
use we_expr::{CallFn, Env, MapNamespace, Namespace, Value};
use we_screen::ScreenState;

use crate::query::QueryCell;
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
}

/// What a node declares on `local`: a writable `$localState` field, a
/// read-only `$queries` cell, or a gated query's empty answer.
#[derive(Debug, Clone)]
pub enum LocalDecl {
    /// `$localState` — the value lives in [`LocalState`], keyed by the
    /// declaring node's id.
    State(FieldMeta),
    /// `$queries` — rows from the pool cell this entry compiled to.
    Query(Arc<QueryCell>),
    /// A `<name>Loaded` companion — `true` once the cell holds rows.
    QueryLoaded(Arc<QueryCell>),
    /// A query that did not compile this frame (`when` false, entity or a
    /// bound unresolved): rows read `[]`, `Loaded` reads `false`.
    Gated {
        /// `true` for the `<name>Loaded` companion of a gated query.
        loaded: bool,
    },
    /// A static answer — the snapshot's `queries` table before pooling, and
    /// what a `QuerySource` that has no opinion falls back to.
    Static(Value),
}

/// One node's contribution to `local`: its declared fields, innermost
/// declaration searched first.
#[derive(Debug, Clone)]
pub struct LocalScope {
    pub node: NodeId,
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

    /// The `State` fields the innermost `$localState` declared — the scope a
    /// `$resetLocal`/`$touch "$all"` acts on.
    fn scope_fields(&self) -> Vec<Value> {
        let Some(inner) = self.decls.last() else {
            return Vec::new();
        };
        inner
            .fields
            .iter()
            .filter(|(_, d)| matches!(d, LocalDecl::State(_)))
            .map(|(name, _)| Value::Str(name.clone()))
            .collect()
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
            Some((_, LocalDecl::Query(cell))) => match cell.state() {
                crate::query::QueryState::Rows(rows) => Value::List(rows),
                crate::query::QueryState::Loading => Value::List(Arc::new(Vec::new())),
            },
            Some((_, LocalDecl::QueryLoaded(cell))) => {
                Value::Bool(matches!(cell.state(), crate::query::QueryState::Rows(_)))
            }
            Some((_, LocalDecl::Gated { loaded })) => {
                if *loaded {
                    Value::Bool(false)
                } else {
                    Value::List(Arc::new(Vec::new()))
                }
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
}

/// The [`Env`] a resolve evaluates against: the node's [`Scope`] bindings
/// first (innermost last), then the store bag; functions from the bag alone.
pub struct ScopeEnv<'a> {
    pub scope: &'a Scope,
    pub bag: &'a StoreBag,
}

impl Env for ScopeEnv<'_> {
    fn root(&self, name: &str) -> Option<Value> {
        self.scope
            .get(name)
            .cloned()
            .or_else(|| self.bag.root(name))
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

    /// Bind a root name (a store namespace, or a plain value).
    pub fn set_root(&self, name: &str, value: Value) {
        if let Ok(mut roots) = self.roots.write() {
            roots.insert(name.into(), value);
        }
        self.version.fetch_add(1, Ordering::Relaxed);
    }

    /// Register a function (`Env::call` reaches it).
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
}

impl Namespace for MergedNs {
    fn get(&self, key: &str) -> Value {
        let over = match &self.overlay {
            Value::Namespace(ns) => ns.get(key),
            _ => Value::Undefined,
        };
        if self.owned.contains(&key) || !matches!(over, Value::Undefined) {
            return over;
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
}

impl Namespace for SpaceStoreNs {
    fn get(&self, key: &str) -> Value {
        if key == "spacePath" {
            return self.space_path.clone();
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
    let route_base = bag.root("routeStore").unwrap_or(Value::Undefined);
    bag.set_root(
        "routeStore",
        Value::namespace(MergedNs {
            overlay: sb.get("nav"),
            base: route_base,
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
    let shell_base = bag.root("shellStore").unwrap_or(Value::Undefined);
    bag.set_root(
        "shellStore",
        Value::namespace(MergedNs {
            overlay: sb.get("shell"),
            base: shell_base,
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
    let theme_base = bag.root("themeStore").unwrap_or(Value::Undefined);
    bag.set_root(
        "themeStore",
        Value::namespace(MergedNs {
            overlay: sb.get("theme"),
            base: theme_base,
            // `themeFork` is always the screen's call (`null` = no fork);
            // an unset `currentThemeId` reads Undefined and defers to the
            // store's answer.
            owned: &["themeFork"],
        }),
    );
    let base = bag.root("spaceStore").unwrap_or(Value::Undefined);
    let space_path = sb.get("nav").read_key("spacePath");
    bag.set_root(
        "spaceStore",
        Value::namespace(SpaceStoreNs { base, space_path }),
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
