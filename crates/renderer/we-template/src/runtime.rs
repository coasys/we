//! [`Runtime`]: the resolved tree's owner — revision counters, the cached
//! tree, the query pool, pending calls and the ops a resolve queued.
//!
//! `frame` re-resolves only when a counter moved — screen (`ScreenState`
//! version), data (the [`StoreBag`] version), local ([`LocalState`]), pool
//! ([`QueryPool`] revision). A frame with no change hands back the tree it
//! had. `dispatch` turns a widget event into handler tokens run against the
//! [`Host`] and the [`ScreenState`]; `drain_completions` takes what the
//! host's [`crate::Completer`]s delivered and `complete` settles each
//! pending `$invoke`.
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use indexmap::IndexMap;
use we_expr::{ParseCache, Value};
use we_screen::{Route, ScreenOp, ScreenState};

use crate::handlers::{self, HandlerCx, PendingMap};
use crate::host::{CallBook, Completer, MountId};
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
    /// Pending calls settled — their lifecycle ran.
    pub completions: u64,
    /// Completions for a call that was unknown or already settled (a
    /// second `complete`, or one after the host answered `Done`).
    pub completions_ignored: u64,
    /// Completions whose node had left the tree — nothing ran.
    pub completions_dropped: u64,
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
    /// `bundle.app` — the chrome every route renders inside; its
    /// `meta.frame` declares the bands it occupies (the rest is the
    /// content viewport the mounted page fills).
    pub app: Option<BundleTemplate>,
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
    /// `$`-types that are real components — the app seeds it from the widget
    /// registry; the default treats every `$`-type as an unknown op.
    dollar_type: Arc<dyn Fn(&str) -> bool>,
    pool: QueryPool,
    /// `QuerySource` — E6/E7 answer real subscriptions; `None` here means
    /// the snapshot's `queries` table fills cells.
    source: Option<Arc<dyn crate::query::QuerySource>>,
    /// `$part` content.
    parts: Arc<dyn PartSource>,
    pending: PendingMap,
    /// Pending calls whose node left the tree in some frame. Unmount
    /// invalidates them for good — a later remount under the same id is a
    /// different incarnation — and their completion counts as dropped.
    orphaned: HashSet<CallId>,
    /// Call ids core mints, and the queue completions land in.
    calls: CallBook,
    /// The mount ids the last frame resolved — a node's origin mount.
    mount_ids: Vec<Arc<str>>,
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
    /// Scope objects interned by content across passes (`$surface`, `$nav`)
    /// — a same-content rebuild keeps its identity, like WE's stores do.
    value_memo: HashMap<Arc<str>, Value>,
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
        Self::from_spec(
            RootSpec::Single {
                node: Box::new(template),
                id: template_id.into(),
            },
            bag,
            locals,
        )
    }

    /// Either root — what a session is built from.
    pub fn from_spec(spec: RootSpec, bag: Arc<StoreBag>, locals: LocalState) -> Self {
        Self {
            spec,
            bag,
            locals,
            dollar_type: Arc::new(|_| false),
            pool: QueryPool::new(),
            source: None,
            parts: Arc::new(NoParts),
            pending: HashMap::new(),
            orphaned: HashSet::new(),
            calls: CallBook::default(),
            mount_ids: Vec::new(),
            ops: Vec::new(),
            ready: Box::new(default_ready),
            cache: ParseCache::new(),
            resolved: None,
            last: None,
            bound_screen: None,
            live: HashSet::new(),
            parents: HashMap::new(),
            node_memo: HashMap::new(),
            value_memo: HashMap::new(),
            stats: Stats::default(),
        }
    }

    /// `$`-types the resolve should treat as components — the app passes its
    /// registry's membership test so a `$lane` node reaches the Lane widget.
    pub fn with_dollar_types(mut self, f: impl Fn(&str) -> bool + 'static) -> Self {
        self.dollar_type = Arc::new(f);
        self
    }

    /// A bundle: chrome + template + pages + boot, one resolved tree.
    pub fn app(spec: AppSpec, bag: Arc<StoreBag>, locals: LocalState) -> Self {
        Self::from_spec(RootSpec::App(Box::new(spec)), bag, locals)
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
            node: spec
                .app
                .as_ref()
                .map(|t| &t.node)
                .unwrap_or_else(|| empty_node()),
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
            self.mount_ids = mounts.iter().map(|m| m.id.clone()).collect();
            // Resolve → fill new cells → resolve again: a query's rows land
            // after the pass that created its cell (the same resolve that
            // asks `local.<name>` reads `[]`). Loop until a pass fills
            // nothing — bounded, in case rows beget queries.
            let mut children = Vec::new();
            let mut live = HashSet::new();
            let mut parents = HashMap::new();
            let mut warnings = Vec::new();
            let mut ops = Vec::new();
            let mut kept_filling = false;
            // The leading resolved children that are the app chrome's —
            // everything after them is content for the viewport wrapper.
            let mut chrome_children = 0usize;
            for _ in 0..8 {
                let mut round_live = HashSet::new();
                let mut round_parents = HashMap::new();
                warnings.clear();
                children.clear();
                chrome_children = 0;
                for mount in &mounts {
                    let (routes, panels, record_views) = match mount.template {
                        Some(t) => (
                            t.node.routes.as_deref(),
                            t.meta.get("panels"),
                            t.meta.get("recordViews").and_then(|v| v.as_object()),
                        ),
                        None => (None, None, None),
                    };
                    let mut route_tail = Vec::new();
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
                        value_memo: &mut self.value_memo,
                        dollar_type: &*self.dollar_type,
                        route_tail: &mut route_tail,
                    };
                    let before = children.len();
                    children.extend(resolve::resolve(
                        mount.node,
                        &mount.id,
                        &Scope::default(),
                        &mut cx,
                    ));
                    if mount.id.as_ref() == "app" {
                        chrome_children = children.len() - before;
                    }
                }
                live = round_live;
                parents = round_parents;
                kept_filling = self.fill_queries();
                if !kept_filling {
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
            // A pending call belongs to the node incarnation that made it:
            // once its node is absent from a frame, the call is dead even if
            // the same id mounts again before the completion arrives.
            let live = &self.live;
            let orphaned = &mut self.orphaned;
            self.pending.retain(|call, p| {
                let keep = live.contains(&p.node);
                if !keep {
                    orphaned.insert(*call);
                }
                keep
            });

            // The app chrome's `meta.frame` declares the bands it
            // occupies; the space the frame leaves is the content
            // viewport — a fixed scroller the mounted page fills (the
            // web's appViewport element). A bare landing gets it too.
            if let RootSpec::App(spec) = &self.spec {
                if chrome_children > 0 {
                    let content = children.split_off(chrome_children);
                    children.push(ResolvedChild::Node(Box::new(content_viewport(
                        spec.app.as_ref(),
                        content,
                    ))));
                }
            }
            // A fragment, an op or the multi-mount root can answer several
            // children — the tree the frame paints always has one root, so
            // wrap them. The id names no mount: mount roots are `{id}:`,
            // resolved children `{id}:{path}` — `root` cannot collide.
            let root = match children.as_slice() {
                [ResolvedChild::Node(node)] => (**node).clone(),
                _ => ResolvedNode {
                    id: NodeId::new("root"),
                    ty: "Column".into(),
                    props: IndexMap::new(),
                    handlers: IndexMap::new(),
                    slot: None,
                    children,
                    transition: None,
                },
            };
            // Ids key layout, paint state and event dispatch: the app tree
            // the runtime assembles from several mounts plus its synthetic
            // `root`/`frame` wrappers must never repeat one.
            if matches!(self.spec, RootSpec::App(_)) {
                debug_assert!(
                    first_duplicate_id(&root).is_none(),
                    "duplicate node id {:?} in the resolved app tree",
                    first_duplicate_id(&root)
                );
            }
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
            // Every pass filled a cell — a deeper dependency chain may still
            // be climbing. Bump the pool past what `last` recorded so the
            // next frame re-resolves instead of caching this partial tree.
            if kept_filling {
                self.pool.bump();
            }
        }
        self.resolved.as_ref().unwrap()
    }

    /// Fill every Loading cell from the `QuerySource` or the snapshot's
    /// `queries` table — keyed by the cell's declared name. `true` when a
    /// cell moved, meaning a re-resolve may now see rows. `Loading →
    /// Loading` is not progress — a still-pending query must not dirty
    /// the revision or every frame re-resolves while it warms (R5); the
    /// pending cell waits for `Rows` or an external wake.
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
                if matches!(state, QueryState::Loading) {
                    continue;
                }
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
                let mount = mount_of(&self.mount_ids, &id);
                let mut cx = HandlerCx {
                    host,
                    bag: &self.bag,
                    locals: &self.locals,
                    cache: &mut self.cache,
                    screen,
                    pending: &mut self.pending,
                    calls: &mut self.calls,
                    node: &id,
                    mount: &mount,
                    warnings: &mut self.stats.warnings,
                };
                handlers::run(&tokens, &scope, event, &mut cx);
                return;
            }
            at = self.parents.get(&id).cloned();
        }
    }

    /// Run every completion the host's [`Completer`]s delivered since the
    /// last drain, in arrival order — `complete` for each. Answers how many
    /// arrived (settled, ignored or dropped alike).
    pub fn drain_completions(&mut self, host: &mut dyn Host, screen: &mut ScreenState) -> usize {
        let arrived = self.calls.drain();
        let n = arrived.len();
        for (call, result) in arrived {
            self.complete(host, screen, call, result);
        }
        n
    }

    /// Settle a pending `$invoke` (`Host::act` answered `Pending` for the
    /// call core minted as `call_id`):
    /// `Ok` runs `onSuccess` with `result` bound, `Err` runs `onError` with
    /// it, and `onFinally` runs after either — unless the node that asked
    /// has left the tree in any frame since the call, in which case nothing
    /// runs and nothing panics (the unmount killed the subscription the
    /// callbacks belong to; a same-id remount does not revive it).
    pub fn complete(
        &mut self,
        host: &mut dyn Host,
        screen: &mut ScreenState,
        call_id: CallId,
        result: Result<Value, Value>,
    ) {
        let Some(pending) = self.pending.remove(&call_id) else {
            if self.orphaned.remove(&call_id) {
                self.stats.completions_dropped += 1;
            } else {
                self.stats.completions_ignored += 1;
            }
            return;
        };
        if !self.live.contains(&pending.node) {
            self.stats.completions_dropped += 1;
            return;
        }
        self.stats.completions += 1;
        let mount = mount_of(&self.mount_ids, &pending.node);
        let mut cx = HandlerCx {
            host,
            bag: &self.bag,
            locals: &self.locals,
            cache: &mut self.cache,
            screen,
            pending: &mut self.pending,
            calls: &mut self.calls,
            node: &pending.node,
            mount: &mount,
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

/// The mount `node` was resolved under: the longest mount id its own id is
/// prefixed by (`{mount}:{path}`). A synthetic wrapper (`root`, `frame`)
/// names itself.
fn mount_of(mounts: &[Arc<str>], node: &NodeId) -> MountId {
    let id = node.as_str();
    mounts
        .iter()
        .filter(|m| {
            id.strip_prefix(m.as_ref())
                .is_some_and(|rest| rest.starts_with(':'))
        })
        .max_by_key(|m| m.len())
        .map(|m| MountId(m.clone()))
        .unwrap_or_else(|| MountId(id.into()))
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

/// The bands an app template that declares no `meta.frame` keeps — TS
/// `DEFAULT_APP_FRAME` in `app-shell/src/shared/dockGeometry.ts`: the
/// collapsed shell sidebar (`SIDEBAR_PX`) on the left and the module rail
/// (`CHROME_RAIL_PX`) on the right. `(left, top, right, bottom)`.
const DEFAULT_APP_FRAME: (f64, f64, f64, f64) = (80.0, 0.0, 56.0, 0.0);

/// `meta.frame`'s bands the chrome occupies → the box the content mounts
/// fill: a fixed-position scroller offset by the frame (the web's
/// appViewport). Children with `height: 100%` see a definite box through
/// it; `overflowY: auto` keeps page scroll inside it.
///
/// As TS `declareAppFrame`: a declared frame names every band it holds and
/// an edge it leaves out is 0; no frame at all (absent or `null`) keeps
/// [`DEFAULT_APP_FRAME`].
fn content_viewport(app: Option<&BundleTemplate>, children: Vec<ResolvedChild>) -> ResolvedNode {
    let declared = app
        .and_then(|t| t.meta.get("frame"))
        .filter(|f| !f.is_null());
    let (l, t, r, b) = match declared {
        Some(f) => {
            let edge = |key: &str| f.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);
            (edge("left"), edge("top"), edge("right"), edge("bottom"))
        }
        None => DEFAULT_APP_FRAME,
    };
    let px = |v: f64| Value::Str(format!("{v}px").into());
    let calc = |unit: &str, v: f64| Value::Str(format!("calc(100{unit} - {v}px)").into());
    ResolvedNode {
        id: NodeId::new("frame"),
        ty: "Column".into(),
        props: [
            ("position", Value::Str("fixed".into())),
            ("left", px(l)),
            ("top", px(t)),
            ("width", calc("vw", l + r)),
            ("height", calc("vh", t + b)),
            ("overflowY", Value::Str("auto".into())),
            ("bg", Value::Str("page".into())),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), v))
        .collect(),
        handlers: IndexMap::new(),
        slot: None,
        children,
        transition: None,
    }
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

/// The first node id the tree repeats, in walk order — `None` when every
/// id is unique.
fn first_duplicate_id(root: &ResolvedNode) -> Option<NodeId> {
    fn walk<'a>(
        n: &'a ResolvedNode,
        seen: &mut std::collections::HashSet<&'a NodeId>,
    ) -> Option<NodeId> {
        if !seen.insert(&n.id) {
            return Some(n.id.clone());
        }
        n.children.iter().find_map(|c| match c {
            ResolvedChild::Node(x) => walk(x, seen),
            ResolvedChild::Text(_) => None,
        })
    }
    walk(root, &mut std::collections::HashSet::new())
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
/// and local writes never reach it (core applies them); a legacy `$invoke`
/// answers the snapshot's `invokes` table — `{"$pending": true}` parks the
/// call's [`Completer`] in `parked` — or is dropped as `Undefined`, the
/// "not wired yet" no-op of the fallback rule.
pub struct StaticHost {
    pub bag: Arc<StoreBag>,
    /// Targets invoked that nothing answered — the debug overlay's "calls
    /// dropped" counter.
    pub dropped: Vec<String>,
    /// Pending calls, in the order they were asked — complete one to settle
    /// its `$invoke`.
    pub parked: Vec<Completer>,
    /// Whether unknown invokes answer `Pending` (tests flip it on).
    pub pending_unknowns: bool,
}

impl StaticHost {
    pub fn new(bag: Arc<StoreBag>) -> Self {
        Self {
            bag,
            dropped: Vec::new(),
            parked: Vec::new(),
            pending_unknowns: false,
        }
    }
}

impl Host for StaticHost {
    fn act(&mut self, request: crate::ActionRequest, done: Completer) -> Invoked {
        let crate::Action::Invoke { target, .. } = &request.action;
        if let Some(reply) = self.bag.invoke_reply(target) {
            if let Value::Obj(o) = &reply {
                if matches!(o.get("$pending"), Some(Value::Bool(true))) {
                    self.parked.push(done);
                    return Invoked::Pending;
                }
            }
            return Invoked::Done(Ok(reply));
        }
        if self.pending_unknowns {
            self.parked.push(done);
            return Invoked::Pending;
        }
        self.dropped.push(target.to_string());
        Invoked::Done(Ok(Value::Undefined))
    }
}

#[cfg(test)]
mod frame_tests {
    use super::*;

    fn app(meta: serde_json::Value) -> BundleTemplate {
        serde_json::from_value(serde_json::json!({ "id": "app", "meta": meta, "type": "Column" }))
            .expect("app template parses")
    }

    /// `(left, top, width, height)` of the content viewport, as authored.
    fn frame_props(app: Option<&BundleTemplate>) -> [String; 4] {
        let node = content_viewport(app, vec![]);
        ["left", "top", "width", "height"].map(|k| match node.props.get(k) {
            Some(Value::Str(s)) => s.to_string(),
            other => panic!("{k}: {other:?}"),
        })
    }

    /// TS `declareAppFrame(undefined)` keeps `DEFAULT_APP_FRAME`: the 80px
    /// sidebar on the left and the 56px chrome rail on the right.
    #[test]
    fn an_app_without_meta_frame_keeps_the_default_frame() {
        let a = app(serde_json::json!({ "name": "app", "role": "app" }));
        assert_eq!(
            frame_props(Some(&a)),
            ["80px", "0px", "calc(100vw - 136px)", "calc(100vh - 0px)"]
        );
    }

    /// A declared frame names every band it holds; one it leaves out is 0.
    #[test]
    fn a_partial_meta_frame_zeroes_its_missing_edges() {
        let a = app(serde_json::json!({ "frame": { "right": 40, "top": 12 } }));
        assert_eq!(
            frame_props(Some(&a)),
            ["0px", "12px", "calc(100vw - 40px)", "calc(100vh - 12px)"]
        );
    }

    /// Coasys declares `{ "left": 72 }` — unchanged by the default.
    #[test]
    fn the_coasys_frame_is_unchanged() {
        let a = app(serde_json::json!({ "frame": { "left": 72 } }));
        assert_eq!(
            frame_props(Some(&a)),
            ["72px", "0px", "calc(100vw - 72px)", "calc(100vh - 0px)"]
        );
    }
}
