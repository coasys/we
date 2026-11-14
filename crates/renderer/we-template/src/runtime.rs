//! [`Runtime`]: the resolved tree's owner — revision counters, the cached
//! tree, the query pool, pending calls and the ops a resolve queued.
//!
//! `frame` re-resolves only when a counter moved — screen (`ScreenState`
//! version), data (the [`StoreBag`] version), local ([`LocalState`]), pool
//! ([`QueryPool`] revision). A frame with no change hands back the tree it
//! had. `dispatch` turns a widget event into handler tokens run against the
//! [`Host`] and the [`ScreenState`]; `complete` settles a pending `$invoke`.
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use indexmap::IndexMap;
use we_expr::{ParseCache, Value};
use we_screen::{Route, ScreenOp, ScreenState};

use crate::handlers::{self, HandlerCx, PendingMap};
use crate::query::{QueryCell, QueryPool, QueryState};
use crate::resolve::{self, NoParts, PartSource};
use crate::resolved::{HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope};
use crate::{
    bind_screen, BundleTemplate, CallId, Host, Invoked, LocalState, ResolveCx, SchemaNode, StoreBag,
};

/// Numbers the debug overlay reads — how much work the pipeline did.
#[derive(Debug, Default, Clone)]
pub struct Stats {
    /// Resolves run so far. A frame without input must not move this.
    pub resolves: u64,
    /// Wall time of the last resolve.
    pub last_resolve: Duration,
    /// Nodes in the current resolved tree.
    pub nodes: usize,
    /// Expression sources that failed to parse this resolve.
    pub parse_errors: usize,
    /// Dispatch-time and resolve-time complaints, deduplicated.
    pub warnings: Vec<Arc<str>>,
}

/// What the runtime resolves at the top: one template (tests, the panel
/// harness), or a bundle's app — chrome + space template + pages + boot.
pub enum RootSpec {
    /// A single node tree — `Runtime::new`.
    Single {
        /// The node.
        node: Box<SchemaNode>,
        /// Its identity prefix (`tree`, `space`, …).
        id: Arc<str>,
    },
    /// A bundle: the app chrome, the space template's route table +
    /// `meta.panels` + `meta.recordViews`, the pages, the boot screen.
    App(Box<AppSpec>),
}

/// A bundle's renderable pieces.
pub struct AppSpec {
    /// `bundle.app` — the chrome every route renders inside.
    pub app: Option<SchemaNode>,
    /// The space template (`display.template` names it, else the first) —
    /// its `routes`, `meta.panels`, `meta.recordViews`.
    pub template: Option<BundleTemplate>,
    /// `bundle.pages`.
    pub pages: Vec<BundleTemplate>,
    /// `bundle.bootScreen`.
    pub boot: Option<SchemaNode>,
}

/// The runtime: schema in, resolved tree out, events back to handlers.
pub struct Runtime {
    spec: RootSpec,
    bag: Arc<StoreBag>,
    locals: LocalState,
    pool: QueryPool,
    /// `QuerySource` — E6/E7 answer real subscriptions; `None` here means
    /// the snapshot's `queries` table fills cells.
    source: Option<Arc<dyn crate::query::QuerySource>>,
    /// `$part` content.
    parts: Arc<dyn PartSource>,
    pending: PendingMap,
    /// Ops a resolve queued (route redirects) — `take_ops` hands them out.
    ops: Vec<ScreenOp>,
    /// Whether `sessionStore` says the app is ready — boot screens read it.
    ready: Box<dyn Fn(&StoreBag) -> bool>,
    cache: ParseCache,
    resolved: Option<Arc<ResolvedNode>>,
    /// (screen, data, local, pool) at the end of the last resolve.
    last: Option<(u64, u64, u64, u64)>,
    /// The screen version `bind_screen` last mounted into the bag.
    bound_screen: Option<u64>,
    live: HashSet<NodeId>,
    parents: HashMap<NodeId, NodeId>,
    /// Parsed embedded sub-schemas (`$if` branches, panel bodies, record
    /// views) — raw `Json` address → node, valid for the bundle's lifetime.
    node_memo: HashMap<usize, Arc<SchemaNode>>,
    stats: Stats,
}

impl Runtime {
    /// A single tree — the offline panel harness and unit tests.
    pub fn new(
        template: SchemaNode,
        template_id: impl Into<Arc<str>>,
        bag: Arc<StoreBag>,
        locals: LocalState,
    ) -> Self {
        Self {
            spec: RootSpec::Single {
                node: Box::new(template),
                id: template_id.into(),
            },
            bag,
            locals,
            pool: QueryPool::new(),
            source: None,
            parts: Arc::new(NoParts),
            pending: HashMap::new(),
            ops: Vec::new(),
            ready: Box::new(default_ready),
            cache: ParseCache::new(),
            resolved: None,
            last: None,
            bound_screen: None,
            live: HashSet::new(),
            parents: HashMap::new(),
            node_memo: HashMap::new(),
            stats: Stats::default(),
        }
    }

    /// A bundle: chrome + template + pages + boot, one resolved tree.
    pub fn app(spec: AppSpec, bag: Arc<StoreBag>, locals: LocalState) -> Self {
        Self {
            spec: RootSpec::App(Box::new(spec)),
            bag,
            locals,
            pool: QueryPool::new(),
            source: None,
            parts: Arc::new(NoParts),
            pending: HashMap::new(),
            ops: Vec::new(),
            ready: Box::new(default_ready),
            cache: ParseCache::new(),
            resolved: None,
            last: None,
            bound_screen: None,
            live: HashSet::new(),
            parents: HashMap::new(),
            node_memo: HashMap::new(),
            stats: Stats::default(),
        }
    }

    /// Install the query source (E6/E7) and the part source (E9).
    pub fn with_sources(
        mut self,
        source: Option<Arc<dyn crate::query::QuerySource>>,
        parts: Arc<dyn PartSource>,
    ) -> Self {
        self.source = source;
        self.parts = parts;
        self
    }

    /// Override how readiness is decided (the bag's `sessionStore` by
    /// default); `Runtime::new`'s trees never boot-gate anyway.
    pub fn with_ready(mut self, ready: impl Fn(&StoreBag) -> bool + 'static) -> Self {
        self.ready = Box::new(ready);
        self
    }

    /// The shared local store — the app's host writes through the same one.
    pub fn locals(&self) -> &LocalState {
        &self.locals
    }

    /// The query pool — tests count cells through it.
    pub fn pool(&self) -> &QueryPool {
        &self.pool
    }

    pub fn stats(&self) -> &Stats {
        &self.stats
    }

    /// The current resolved tree, if a frame has run.
    pub fn resolved(&self) -> Option<&Arc<ResolvedNode>> {
        self.resolved.as_ref()
    }

    /// The ops a resolve queued — route redirects. Apply them to the
    /// [`ScreenState`] (each application bumps the version → a re-resolve).
    pub fn take_ops(&mut self) -> Vec<ScreenOp> {
        std::mem::take(&mut self.ops)
    }

    /// The mounts the frame resolves for this route — a free function on
    /// `&self.spec` so the frame can hold the choice while mutably borrowing
    /// the rest of the runtime. The chrome (`app`) mounts on every ready
    /// route — the rail never leaves; the content mount beside it is the
    /// space template for `Route::Space`, the bundle page for `Route::Page`,
    /// nothing for the landing.
    fn mounts_for<'a>(spec: &'a RootSpec, screen: &ScreenState, ready: bool) -> Vec<Mount<'a>> {
        let chrome = |spec: &'a AppSpec| Mount {
            node: spec.app.as_ref().unwrap_or_else(|| empty_node()),
            id: "app".into(),
            template: None,
        };
        match spec {
            RootSpec::Single { node, id } => vec![Mount {
                node: node.as_ref(),
                id: id.clone(),
                template: None,
            }],
            RootSpec::App(spec) => {
                if !ready {
                    if let Some(boot) = &spec.boot {
                        return vec![Mount {
                            node: boot,
                            id: "boot".into(),
                            template: None,
                        }];
                    }
                }
                match screen.nav.route() {
                    Route::Page { id } => {
                        let mut mounts = vec![chrome(spec)];
                        if let Some(page) = spec.pages.iter().find(|p| p.id == id) {
                            mounts.push(Mount {
                                node: &page.node,
                                id: format!("page:{id}").into(),
                                template: None,
                            });
                        }
                        mounts
                    }
                    Route::Space { .. } | Route::Other => {
                        let mut mounts = vec![chrome(spec)];
                        if let Some(template) = &spec.template {
                            mounts.push(Mount {
                                node: &template.node,
                                id: "space".into(),
                                template: Some(template),
                            });
                        }
                        mounts
                    }
                    Route::Landing => vec![chrome(spec)],
                }
            }
        }
    }

    /// Run a frame: re-resolve iff a revision moved, then answer the cached
    /// tree. Mounts the screen's namespaces when `screen.version` moved,
    /// resolves, then fills query cells from the source or the snapshot.
    pub fn frame(&mut self, host: &mut dyn Host, screen: &ScreenState) -> &Arc<ResolvedNode> {
        if self.bound_screen != Some(screen.version) {
            bind_screen(&self.bag, screen);
            self.bound_screen = Some(screen.version);
        }
        let current = (
            screen.version,
            self.bag.version(),
            self.locals.version(),
            self.pool.revision(),
        );
        if self.resolved.is_none() || self.last != Some(current) {
            let started = Instant::now();
            let ready = (self.ready)(&self.bag);
            let mounts = Self::mounts_for(&self.spec, screen, ready);
            // Resolve → fill new cells → resolve again: a query's rows land
            // after the pass that created its cell (the same resolve that
            // asks `local.<name>` reads `[]`). Loop until a pass fills
            // nothing — bounded, in case rows beget queries.
            let mut children = Vec::new();
            let mut live = HashSet::new();
            let mut parents = HashMap::new();
            let mut warnings = Vec::new();
            let mut ops = Vec::new();
            for _ in 0..8 {
                let mut round_live = HashSet::new();
                let mut round_parents = HashMap::new();
                warnings.clear();
                children.clear();
                for mount in &mounts {
                    let (routes, panels, record_views) = match mount.template {
                        Some(t) => (
                            t.node.routes.as_deref(),
                            t.meta.get("panels"),
                            t.meta.get("recordViews").and_then(|v| v.as_object()),
                        ),
                        None => (None, None, None),
                    };
                    let mut cx = ResolveCx {
                        bag: self.bag.as_ref(),
                        host,
                        locals: &self.locals,
                        cache: &mut self.cache,
                        screen,
                        pool: &self.pool,
                        parts: self.parts.as_ref(),
                        routes,
                        panels,
                        record_views,
                        ops: &mut ops,
                        live: &mut round_live,
                        parents: &mut round_parents,
                        warnings: &mut warnings,
                        node_memo: &mut self.node_memo,
                    };
                    children.extend(resolve::resolve(
                        mount.node,
                        &mount.id,
                        &Scope::default(),
                        &mut cx,
                    ));
                }
                live = round_live;
                parents = round_parents;
                if !self.fill_queries() {
                    break;
                }
            }
            self.ops.extend(ops);
            self.stats.parse_errors = warnings
                .iter()
                .filter(|w| w.starts_with("expression "))
                .count();
            self.stats.warnings = warnings;
            self.locals.retain(&live);
            self.parents = parents;
            self.live = live;

            // A fragment, an op or the multi-mount root can answer several
            // children — the tree the frame paints always has one root, so
            // wrap them.
            let root = match children.as_slice() {
                [ResolvedChild::Node(node)] => (**node).clone(),
                _ => ResolvedNode {
                    id: NodeId::new(format!(
                        "{}:",
                        mounts.first().map(|m| m.id.as_ref()).unwrap_or("root")
                    )),
                    ty: "Column".into(),
                    props: IndexMap::new(),
                    handlers: IndexMap::new(),
                    slot: None,
                    children,
                    transition: None,
                },
            };
            self.stats.nodes = count_nodes(&root);
            self.stats.last_resolve = started.elapsed();
            self.stats.resolves += 1;
            self.resolved = Some(Arc::new(root));
            self.last = Some((
                screen.version,
                self.bag.version(),
                self.locals.version(),
                self.pool.revision(),
            ));
        }
        self.resolved.as_ref().unwrap()
    }

    /// Fill every Loading cell from the `QuerySource` or the snapshot's
    /// `queries` table — keyed by the cell's declared name. `true` when a
    /// cell moved, meaning a re-resolve may now see rows.
    fn fill_queries(&self) -> bool {
        let mut moved = false;
        for cell in self.pool.cells() {
            if !matches!(cell.state(), QueryState::Loading) {
                continue;
            }
            let state = match &self.source {
                Some(source) => Some(source.rows(&cell.key, &cell.ir)),
                None => snapshot_rows(&self.bag, cell.as_ref()),
            };
            if let Some(state) = state {
                cell.fill(state);
                moved = true;
            }
        }
        if moved {
            self.pool.bump();
        }
        moved
    }

    /// `node`'s handler `name` fired with `event` — or an ancestor's, the way
    /// a DOM event bubbles (`tree-item-select` reaches the `we-tree` above).
    /// The handler's captured scope is its own; `event` binds on top.
    /// `routeStore.*`/`shellStore.*`/`themeStore.*` targets apply to
    /// `screen`; the rest go to the host.
    pub fn dispatch(
        &mut self,
        host: &mut dyn Host,
        screen: &mut ScreenState,
        node: &NodeId,
        name: &str,
        event: Value,
    ) {
        let Some(root) = self.resolved.clone() else {
            return;
        };
        let mut at = Some(node.clone());
        while let Some(id) = at {
            let Some(target) = find_node(&root, &id) else {
                break;
            };
            if let Some(HandlerRef { tokens, scope }) = target.handlers.get(name) {
                let tokens = tokens.clone();
                let scope = scope.clone();
                let mut cx = HandlerCx {
                    host,
                    bag: &self.bag,
                    locals: &self.locals,
                    cache: &mut self.cache,
                    screen,
                    pending: &mut self.pending,
                    node: &id,
                    warnings: &mut self.stats.warnings,
                };
                handlers::run(&tokens, &scope, event, &mut cx);
                return;
            }
            at = self.parents.get(&id).cloned();
        }
    }

    /// Settle a pending `$invoke` (`Host::invoke` answered `Pending(id)`):
    /// `Ok` runs `onSuccess` with `result` bound, `Err` runs `onError` with
    /// it, and `onFinally` runs after either — unless the node that asked
    /// has left the tree, in which case nothing runs and nothing panics
    /// (the unmount killed the subscription the callbacks belong to).
    pub fn complete(
        &mut self,
        host: &mut dyn Host,
        screen: &mut ScreenState,
        call_id: CallId,
        result: Result<Value, Value>,
    ) {
        let Some(pending) = self.pending.remove(&call_id) else {
            return;
        };
        if !self.live.contains(&pending.node) {
            return;
        }
        let mut cx = HandlerCx {
            host,
            bag: &self.bag,
            locals: &self.locals,
            cache: &mut self.cache,
            screen,
            pending: &mut self.pending,
            node: &pending.node,
            warnings: &mut self.stats.warnings,
        };
        match &result {
            Ok(value) => {
                if let Some(on_success) = &pending.on_success {
                    handlers::run_lifecycle(
                        on_success,
                        &pending.scope,
                        Some(value.clone()),
                        &mut cx,
                    );
                }
            }
            Err(error) => {
                if let Some(on_error) = &pending.on_error {
                    handlers::run_lifecycle(on_error, &pending.scope, Some(error.clone()), &mut cx);
                }
            }
        }
        if let Some(on_finally) = &pending.on_finally {
            handlers::run_lifecycle(on_finally, &pending.scope, None, &mut cx);
        }
    }
}

/// One mount — a node resolved under an id prefix, with the template
/// context (`routes`/`panels`/`recordViews`) when the mount is the space
/// template itself.
struct Mount<'a> {
    node: &'a SchemaNode,
    id: Arc<str>,
    template: Option<&'a BundleTemplate>,
}

/// The empty schema `unwrap_or` needs when `app` is absent.
fn empty_node() -> &'static SchemaNode {
    static EMPTY: std::sync::OnceLock<SchemaNode> = std::sync::OnceLock::new();
    EMPTY.get_or_init(SchemaNode::default)
}

/// `sessionStore` readiness — `signInStep`/`bootState` reads `"ready"`; an
/// absent store is not ready (the bundle's own `$if` draws the boot in WE).
fn default_ready(bag: &StoreBag) -> bool {
    match bag.root("sessionStore") {
        Some(Value::Namespace(ns)) => {
            let step = ns.get("signInStep");
            let state = ns.get("bootState");
            matches!(&step, Value::Str(s) if s.as_ref() == "ready")
                || matches!(&state, Value::Str(s) if s.as_ref() == "ready")
        }
        _ => true,
    }
}

/// The snapshot's answer for a cell — `queries.<first-declared-name>` rows.
fn snapshot_rows(bag: &StoreBag, cell: &QueryCell) -> Option<QueryState> {
    let name = cell.first_name()?;
    match bag.query(&name) {
        Value::List(rows) => Some(QueryState::Rows(rows)),
        Value::Undefined => None,
        other => Some(QueryState::Rows(Arc::new(vec![other]))),
    }
}

/// Nodes in the tree, counting structure-op placeholders.
fn count_nodes(node: &ResolvedNode) -> usize {
    1 + node
        .children
        .iter()
        .map(|c| match c {
            ResolvedChild::Node(n) => count_nodes(n),
            ResolvedChild::Text(_) => 0,
        })
        .sum::<usize>()
}

/// The node under `id`, by walk — the resolved tree is small, and dispatch
/// is per event, not per frame.
fn find_node<'a>(node: &'a ResolvedNode, id: &NodeId) -> Option<&'a ResolvedNode> {
    if &node.id == id {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_node(n, id),
        ResolvedChild::Text(_) => None,
    })
}

/// The host the offline app and tests run handlers against: screen targets
/// land on `ScreenState` before this sees them; `$setLocal`/`get_local` on
/// the shared [`LocalState`]; anything else answers the snapshot's
/// `invokes` table, parks a `Pending` under an incrementing ticket, or
/// `Undefined` — the "not wired yet" no-op of the fallback rule.
pub struct StaticHost {
    pub bag: Arc<StoreBag>,
    pub locals: LocalState,
    /// Targets invoked that nothing answered — the debug overlay's "calls
    /// dropped" counter.
    pub dropped: Vec<String>,
    /// Invokes the snapshot marks async — `invokes.<target>` of
    /// `{"$pending": true}` parks a ticket; `Runtime::complete` settles it.
    pub next_call: u64,
    /// Whether unknown invokes answer `Pending` (tests flip it off).
    pub pending_unknowns: bool,
}

impl StaticHost {
    pub fn new(bag: Arc<StoreBag>, locals: LocalState) -> Self {
        Self {
            bag,
            locals,
            dropped: Vec::new(),
            next_call: 0,
            pending_unknowns: false,
        }
    }
}

impl Host for StaticHost {
    fn invoke(&mut self, target: &str, args: Vec<Value>) -> Invoked {
        if let Some(reply) = self.bag.invoke_reply(target) {
            if let Value::Obj(o) = &reply {
                if matches!(o.get("$pending"), Some(Value::Bool(true))) {
                    let id = CallId(self.next_call);
                    self.next_call += 1;
                    return Invoked::Pending(id);
                }
            }
            return Invoked::Done(Ok(reply));
        }
        if self.pending_unknowns {
            let id = CallId(self.next_call);
            self.next_call += 1;
            return Invoked::Pending(id);
        }
        let _ = args;
        self.dropped.push(target.to_string());
        Invoked::Done(Ok(Value::Undefined))
    }

    fn set_local(&mut self, node: &NodeId, field: &str, value: Value) {
        self.locals.set(node, field, value);
    }

    fn get_local(&self, node: &NodeId, field: &str) -> Value {
        self.locals.get(node, field)
    }
}
