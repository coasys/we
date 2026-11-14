//! The environment a resolve or a handler evaluates against: node scope →
//! store bag → built-ins, one [`we_expr::Env`] over the chain.
//!
//! - [`StoreBag`] is the root-name table — `spaceStore`, `routeStore`, … —
//!   plus the functions expressions call. A [`StoreBag::from_snapshot`]
//!   builds it from a `--snapshot` JSON file (the offline stage's `StaticBag`);
//!   E2/E6 put the real sources behind the same `root`/`call` surface.
//! - [`RouteState`] is the hard-wired `routeStore`: `params`, `path`,
//!   `templateSegments`, `navigate`, `setParam`. we-screen replaces it; the
//!   [`crate::Host`] call `routeStore.*` keeps working.
//! - [`LocalNs`] is `local` — the `$localState`/`$queries` fields in scope,
//!   read lazily so a re-resolve picks up writes.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use indexmap::IndexMap;
use we_expr::{CallFn, Env, MapNamespace, Namespace, Value};

use crate::{LocalState, NodeId, Scope};

/// What a node declares on `local`: a writable `$localState` field, or a
/// read-only `$queries` answer (read-only like WE's query accessors).
#[derive(Debug, Clone)]
pub enum LocalDecl {
    /// `$localState` — the value lives in [`LocalState`], keyed by the
    /// declaring node's id.
    State,
    /// `$queries` — a static answer in E3a; E3b asks a `QuerySource`.
    Query(Value),
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
/// One reserved read: `local["$owner:<field>"]` answers the declaring node's
/// id as a string, for a `State` field. That is how a `$setLocal` finds the
/// node it must write — the field's owner is part of the declaration, and a
/// handler runs against the scope it was written in. [`Namespace::keys`]
/// never lists it; it is plumbing, not data.
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
}

impl Namespace for LocalNs {
    fn get(&self, key: &str) -> Value {
        if let Some(field) = key.strip_prefix("$owner:") {
            return match self.owner(field) {
                Some((node, LocalDecl::State)) => node.as_str().into(),
                _ => Value::Undefined,
            };
        }
        match self.owner(key) {
            Some((node, LocalDecl::State)) => self.state.get(node, key),
            Some((_, LocalDecl::Query(value))) => value.clone(),
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
/// table [`Env::call`] reads, and the two E3a stand-ins —
/// `$queries` answers and canned `$invoke` replies — that the snapshot file
/// carries. Everything mutable is behind locks and bumps [`StoreBag::version`]
/// so a write moves the data revision a frame watches.
///
/// E2/E6 build the real bag — screen state, model reads, flows — behind this
/// same `root`/`call` surface; nothing above it changes.
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

    /// The data revision — one of the frame's three counters.
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

    /// The static answer a `$queries` field reads in E3a — `queries.<name>`
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
    /// `$invoke` target to the `Done` value it replies. `routeStore` is not
    /// read from the file — [`RouteState`] provides it.
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

/// `routeStore` — the one store a walking skeleton cannot do without. It is
/// hard-wired here on purpose: `navigate`/`setParam` mutate it through the
/// [`crate::Host`], `params`/`path`/`templateSegments` read it through the
/// namespace, and [`RouteState::version`] is the screen revision a frame
/// watches. we-screen (E2) replaces this type; the `routeStore.*` names
/// handlers invoke stay.
#[derive(Debug, Clone, Default)]
pub struct RouteState {
    inner: Arc<RwLock<RouteInner>>,
}

#[derive(Debug, Default)]
struct RouteInner {
    /// `/space/demo` — the path half of the href, no query.
    path: String,
    params: IndexMap<Arc<str>, Value>,
    /// Where `navigate` has been — the back stack E2 owns for real.
    history: Vec<String>,
    version: u64,
}

impl RouteState {
    /// Parse an href — `/space/demo?view=canvas&dna=all`. Bare strings are
    /// numbers/booleans stay strings (the URL holds text only).
    pub fn new(href: &str) -> Self {
        let state = RouteState::default();
        state.navigate(href);
        {
            let Ok(mut inner) = state.inner.write() else {
                return state;
            };
            inner.history.clear();
            inner.version = 0;
        }
        state
    }

    pub fn version(&self) -> u64 {
        self.inner.read().map(|i| i.version).unwrap_or(0)
    }

    pub fn path(&self) -> String {
        self.inner
            .read()
            .map(|i| i.path.clone())
            .unwrap_or_default()
    }

    /// A param's value — `routeStore.params.<name>`. Absent → `Undefined`.
    pub fn param(&self, name: &str) -> Value {
        self.inner
            .read()
            .ok()
            .and_then(|i| i.params.get(name).cloned())
            .unwrap_or(Value::Undefined)
    }

    /// `routeStore.params` as an object — what an expression reads.
    pub fn params_obj(&self) -> Value {
        let params: IndexMap<Arc<str>, Value> = self
            .inner
            .read()
            .map(|i| i.params.clone())
            .unwrap_or_default();
        Value::Obj(Arc::new(params))
    }

    /// Path segments after the leading `/`, minus the two segments the route
    /// owns (`/space/<id>/…` → the view path). `routeStore.templateSegments`.
    pub fn template_segments(&self) -> Value {
        let path = self.path();
        let segments: Vec<Value> = path
            .trim_matches('/')
            .split('/')
            .skip(2)
            .filter(|s| !s.is_empty())
            .map(Value::from)
            .collect();
        Value::List(Arc::new(segments))
    }

    /// `routeStore.navigate(href)` — replace the route, push history, move the
    /// version. An href that is not a string does nothing (a template handed
    /// us `Undefined`).
    pub fn navigate(&self, href: &str) {
        if let Ok(mut inner) = self.inner.write() {
            let (path, query) = href.split_once('?').unwrap_or((href, ""));
            inner.params.clear();
            for pair in query.split('&').filter(|p| !p.is_empty()) {
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                inner.params.insert(k.into(), Value::from(v));
            }
            inner.path = path.to_string();
            inner.history.push(href.to_string());
            inner.version += 1;
        }
    }

    /// `routeStore.setParam(name, value)` — `null`/`undefined` drops the param,
    /// anything else stores its text (`to_text`, as the URL is text).
    pub fn set_param(&self, name: &str, value: &Value) {
        if let Ok(mut inner) = self.inner.write() {
            match value {
                Value::Null | Value::Undefined => {
                    inner.params.swap_remove(name);
                }
                other => {
                    inner.params.insert(name.into(), other.to_text().into());
                }
            }
            inner.version += 1;
        }
    }

    /// Where `navigate` has been, first to last.
    pub fn history(&self) -> Vec<String> {
        self.inner
            .read()
            .map(|i| i.history.clone())
            .unwrap_or_default()
    }

    /// The store object expressions read.
    pub fn namespace(&self) -> RouteNs {
        RouteNs(self.clone())
    }
}

/// `routeStore` as a namespace — reads only; writes go through the
/// [`crate::Host`] (`routeStore.navigate`, `routeStore.setParam`).
#[derive(Debug)]
pub struct RouteNs(RouteState);

impl Namespace for RouteNs {
    fn get(&self, key: &str) -> Value {
        match key {
            "params" => self.0.params_obj(),
            "path" => self.0.path().into(),
            "templateSegments" => self.0.template_segments(),
            "navigate" | "setParam" | "goBack" | "goForward" | "setUrlParam" => {
                Value::Callable(we_expr::CallableRef::named(key))
            }
            _ => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        vec![
            "params".into(),
            "path".into(),
            "templateSegments".into(),
            "navigate".into(),
            "setParam".into(),
            "goBack".into(),
            "goForward".into(),
            "setUrlParam".into(),
        ]
    }
}
