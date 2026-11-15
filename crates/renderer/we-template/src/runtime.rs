//! [`Runtime`]: the resolved tree's owner — revision counters, the cached
//! tree, the query hub, pending calls and the ops a resolve queued.
//!
//! `frame` re-resolves only when a counter moved — screen (`ScreenState`
//! version), data (the [`StoreBag`] revision), local ([`LocalState`]), hub
//! ([`QueryHub`] revision). A frame with no change hands back the tree it
//! had. `dispatch` turns a widget event into handler tokens run against the
//! [`Host`] and the [`ScreenState`]; `drain_inbox` takes what landed in the
//! session's [`Inbox`] — [`crate::Completer`] deliveries, binding
//! invalidations, query events — and `complete` settles each pending
//! `$invoke`.
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};

use indexmap::IndexMap;
use we_expr::{
    BundleSlot, HandleTable, MountCx, MountId, ParseCache, Provenance, SpaceHandle, Tier, Value,
};
use we_screen::{Changed, Route, ScreenOp, ScreenState};

use crate::bindings::Invalidator;
use crate::handlers::{self, HandlerCx, PendingMap};
use crate::host::{CallBook, Completer};
use crate::inbox::{Arrival, Inbox};
use crate::query::{QueryEvent, QueryHub, QueryRequest, QuerySink, QuerySource, SubTicket};
use crate::resolve::{self, NoParts, PartSource};
use crate::resolved::{HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope};
use crate::scope::{RootLayer, Roots};
use crate::screen_view::{self, ScreenView};
use crate::{BundleTemplate, CallId, Host, Invoked, LocalState, ResolveCx, SchemaNode, StoreBag};

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

/// How many dead calls the runtime remembers at once (the `orphaned`
/// P3): a host may hold a [`Completer`] and never settle it, so the set
/// is bounded — past the cap the oldest entry is evicted and its late
/// completion counts as ignored rather than dropped. The memory is sized
/// by the cap, not by calls ever made.
pub const ORPHANED_CAP: usize = 1024;

/// The orphaned call ids, oldest call first. `set` answers membership
/// for `complete`; `order` caps it — `pending.retain` discovers a frame's
/// dead calls in map order, not age order, so insertion sorts: ids mint
/// upward, and the front is always the oldest call whichever pass found
/// it.
#[derive(Default)]
struct Orphans {
    order: VecDeque<CallId>,
    set: HashSet<CallId>,
}

impl Orphans {
    fn insert(&mut self, call: CallId) {
        if self.set.insert(call) {
            let at = self
                .order
                .iter()
                .position(|c| *c > call)
                .unwrap_or(self.order.len());
            self.order.insert(at, call);
            while self.order.len() > ORPHANED_CAP {
                let evicted = self.order.pop_front().unwrap();
                self.set.remove(&evicted);
            }
        }
    }

    /// `true` when `call` was held — and is now released — as an orphan.
    fn remove(&mut self, call: &CallId) -> bool {
        if self.set.remove(call) {
            self.order.retain(|c| c != call);
            true
        } else {
            false
        }
    }
}

/// What the runtime resolves at the top: one template (tests, the panel
/// harness), or a bundle's app — chrome + space template + pages + boot.
pub enum RootSpec {
    /// A single node tree — `Runtime::new`.
    Single {
        /// The node.
        node: Box<SchemaNode>,
        /// Who the tree is mounted as — `Explicit` and [`Tier::Space`]
        /// unless the caller stamps otherwise (E3c-7).
        cx: MountCx,
    },
    /// A bundle: the app chrome, the space template's route table +
    /// `meta.panels` + `meta.recordViews`, the pages, the boot screen.
    App(Box<AppSpec>),
}

impl RootSpec {
    /// A single tree mounted `Explicit` — tests and the offline harness.
    /// Space tier, no space: the caller declares nothing, so core grants
    /// nothing (`meta.role` is never consulted for it).
    pub fn single(node: SchemaNode, mount: impl Into<MountId>) -> Self {
        Self::Single {
            node: Box::new(node),
            cx: MountCx::explicit(mount),
        }
    }
}

/// A bundle's renderable pieces.
pub struct AppSpec {
    /// The bundle's own name — `Provenance::Bundle { bundle, .. }` stamps
    /// it onto every mount the spec makes.
    pub bundle: Arc<str>,
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
    /// The subscription hub — query sites claim each pass; `commit` opens
    /// and closes at the source.
    hub: QueryHub,
    /// `QuerySource` — E6/E7 answer real subscriptions; the default is the
    /// snapshot's `queries` table, answering named requests by `name_hint`.
    source: Arc<dyn QuerySource>,
    /// `$part` content.
    parts: Arc<dyn PartSource>,
    pending: PendingMap,
    /// Pending calls whose node left the tree in some frame. Unmount
    /// invalidates them for good — a later remount under the same id is a
    /// different incarnation — and their completion counts as dropped.
    /// Bounded at [`ORPHANED_CAP`]: a host that drops its completers
    /// cannot grow this forever.
    orphans: Orphans,
    /// Call ids core mints — the completers hold `inbox`.
    calls: CallBook,
    /// Every between-frames arrival: completions, binding invalidations.
    /// `Session::poll` drains it; the waker on it is the frontend's.
    inbox: Arc<Inbox>,
    /// The mount contexts the last frame resolved — a node's origin.
    mount_cxs: Vec<MountCx>,
    /// The table every mount's handles (and `DatasetHandle`s) come from —
    /// the host's way back for a minted handle.
    handles: HandleTable,
    /// Ops a resolve queued (route redirects) — `take_ops` hands them out.
    ops: Vec<ScreenOp>,
    /// Whether `sessionStore` says the app is ready — boot screens read it.
    ready: Box<dyn Fn(&StoreBag) -> bool>,
    cache: ParseCache,
    resolved: Option<Arc<ResolvedNode>>,
    /// (screen, data, local, pool) the last resolve recorded — the data
    /// entry as read *before* its first pass, so a write mid-resolve
    /// leaves the source ahead and the next `poll` dirty.
    last: Option<(u64, u64, u64, u64)>,
    /// The live `screen` root — bound once into the mount's [`RootLayer`]
    /// at construction; `apply_screen`/`frame` refresh its snapshot,
    /// never rebind it.
    view: ScreenView,
    /// This mount's own root bindings (`screen`, the legacy faces),
    /// layered over `bag` — a second session on the same bag keeps its
    /// own instead of overwriting this one's.
    layer: RootLayer,
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
            RootSpec::single(template, MountId(template_id.into())),
            bag,
            locals,
        )
    }

    /// Either root — what a session is built from. The runtime's table is
    /// fresh: a `MountCx::with_space` handle a host minted beforehand can
    /// never resolve in it — see [`Self::from_spec_in`].
    pub fn from_spec(spec: RootSpec, bag: Arc<StoreBag>, locals: LocalState) -> Self {
        Self::from_spec_in(spec, bag, locals, HandleTable::new())
    }

    /// `from_spec` inside the host's handle table: one table is one
    /// authority domain — a `clone`d table is the same one (shared epoch,
    /// shared slots), a `HandleTable::new` is a different one whose
    /// handles `key` refuses. A host that knows which space an explicit
    /// mount is about mints the handle in its own table and hands the
    /// table in, so the `MountCx::with_space` it built resolves here.
    ///
    /// It is this direction — never the reverse — because a `MountCx` is
    /// a constructor argument: it cannot wait for the runtime's table to
    /// exist, and the host mints before the session does. Forgery is
    /// unchanged: sharing is `Clone`, and a template still cannot build
    /// a `HandleRef` or a table this table answers for.
    pub fn from_spec_in(
        spec: RootSpec,
        bag: Arc<StoreBag>,
        locals: LocalState,
        handles: HandleTable,
    ) -> Self {
        let inbox = Arc::new(Inbox::new());
        // The session's binding subscription: `set_root` writes push an
        // arrival here and call its waker — a data change reaches a
        // sleeping frontend. Each session gets its own handle on the bag.
        bag.set_invalidator(Invalidator::new(&inbox));
        // The one live `screen` root, bound once into THIS mount's layer
        // — `apply_screen` refreshes the view's snapshot on every change,
        // never rebinds, never stacks a wrapper (E3c-6). The `we-legacy`
        // adapter serves the old store names beside it, in the same
        // layer. A construction-time bind is no data arrival — no
        // revision moves and no session wakes for it.
        let view = ScreenView::new();
        let layer = RootLayer::new(&bag);
        layer.bind("screen", Value::namespace(view.clone()));
        // No installed source: the snapshot's `queries` table answers.
        let source: Arc<dyn QuerySource> = Arc::new(SnapshotQueries::new(bag.clone()));
        Self {
            spec,
            bag,
            locals,
            dollar_type: Arc::new(|_| false),
            hub: QueryHub::new(inbox.clone(), handles.clone()),
            source,
            parts: Arc::new(NoParts),
            pending: HashMap::new(),
            orphans: Orphans::default(),
            calls: CallBook::new(inbox.clone()),
            inbox,
            mount_cxs: Vec::new(),
            handles,
            ops: Vec::new(),
            ready: Box::new(default_ready),
            cache: ParseCache::new(),
            resolved: None,
            last: None,
            view,
            layer,
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

    /// Install the query source (E6/E7) and the part source (E9). `None`
    /// keeps the default — the snapshot's `queries` table. A real swap
    /// invalidates the cached frame: the held keys only reach the new
    /// source through a resolve → commit.
    pub fn with_sources(
        mut self,
        source: Option<Arc<dyn QuerySource>>,
        parts: Arc<dyn PartSource>,
    ) -> Self {
        if let Some(source) = source {
            if !Arc::ptr_eq(&self.source, &source) {
                self.source = source;
                self.last = None;
            }
        }
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

    /// The store bag this runtime resolves against — the session's
    /// `from_parts` hands it to `we-legacy`'s adapter install.
    pub fn bag(&self) -> &Arc<StoreBag> {
        &self.bag
    }

    /// This mount's root view — its own bindings (`screen`, the legacy
    /// faces) layered over the shared bag. Resolve and dispatch read
    /// roots through here, so a second session on the same bag reads its
    /// own `screen`, not this one's.
    pub fn roots(&self) -> Roots<'_> {
        Roots::new(&self.layer, self.bag.as_ref())
    }

    /// The mount's own binding layer — `we-legacy`'s adapter installs the
    /// legacy faces here, where they are this session's own.
    pub fn layer(&self) -> &RootLayer {
        &self.layer
    }

    /// The live `screen` root this runtime bound — the snapshot member
    /// reads resolve through, refreshed by [`Self::apply_screen`] and
    /// [`Self::frame`]. One per mount; never rebound.
    pub fn view(&self) -> &ScreenView {
        &self.view
    }

    /// `op` through the one write path: applied to `screen`, the view's
    /// snapshot refreshes on a real change so the next `screen.*` (or
    /// legacy-adapter) read sees it.
    pub fn apply_screen(&self, screen: &mut ScreenState, op: ScreenOp) -> Changed {
        screen_view::apply_screen(screen, &self.view, op)
    }

    /// The query hub — tests count held keys and open tickets through it.
    pub fn hub(&self) -> &QueryHub {
        &self.hub
    }

    /// Mutably — a test delivers on a cell's ticket the way a live source
    /// would.
    pub fn hub_mut(&mut self) -> &mut QueryHub {
        &mut self.hub
    }

    /// The session's handle table — every [`crate::SpaceHandle`] and
    /// dataset handle the mounts stamp comes from it. The host's way
    /// back: `handles.key(&h)` is the host identifier a handle names.
    pub fn handles(&self) -> &HandleTable {
        &self.handles
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

    /// The session's arrival queue — `Session::poll` drains it;
    /// `Session::set_waker` installs the frontend's hook on it.
    pub fn inbox(&self) -> &Arc<Inbox> {
        &self.inbox
    }

    /// Would `frame` re-resolve: the `(screen, data, local, hub)` tuple
    /// is not what the last resolve recorded. An exhausted pass budget
    /// is covered too — `frame` bumps the hub revision past what `last`
    /// recorded, so the mismatch reports itself here. `Session::poll`
    /// reports this as `Tick::dirty` — "a `resolve` now would produce a
    /// different tree" — and a quiet answer means the last tree is still
    /// right.
    pub fn dirty(&self, screen: &ScreenState) -> bool {
        self.last
            != Some((
                screen.version,
                self.bag.version(),
                self.locals.version(),
                self.hub.revision(),
            ))
    }

    /// `meta.role` lowers a mount's stamped tier — a space-tier role
    /// (`shell`/`view`) drops an app slot to Space. It never raises: an
    /// app-tier claim on a space slot stamps Space all the same — the
    /// acceptance check refuses such a schema outright (`judgeBundle`
    /// judges bundle templates at `SPACE_TIER` whatever `meta` says), so
    /// core's stamp is the floor, never the claim (4.4).
    fn slot_tier(slot: Tier, role: Option<&str>) -> Tier {
        match role {
            Some("shell" | "view") => slot.min(Tier::Space),
            _ => slot,
        }
    }

    /// A bundle mount's identity: the slot fixes the mount id, the tier
    /// ceiling and the provenance; `meta.role` may only lower the tier.
    /// The open space stamps from the route, not the schema.
    fn bundle_cx(
        mount: impl Into<MountId>,
        slot: Tier,
        role: Option<&str>,
        provenance_slot: BundleSlot,
        spec: &AppSpec,
        space: &Option<SpaceHandle>,
    ) -> MountCx {
        MountCx {
            mount: mount.into(),
            tier: Self::slot_tier(slot, role),
            space: space.clone(),
            provenance: Provenance::Bundle {
                bundle: spec.bundle.clone(),
                slot: provenance_slot,
            },
        }
    }

    /// The mounts the frame resolves for this route — a free function on
    /// `&self.spec` so the frame can hold the choice while mutably borrowing
    /// the rest of the runtime. The chrome (`app`) mounts on every ready
    /// route — the rail never leaves; the content mount beside it is the
    /// space template for `Route::Space`, the bundle page for `Route::Page`,
    /// nothing for the landing.
    fn mounts_for<'a>(
        spec: &'a RootSpec,
        handles: &HandleTable,
        screen: &ScreenState,
        ready: bool,
    ) -> Vec<Mount<'a>> {
        // The open space as the route names it — every mount's `cx.space`
        // while a space is open; the landing and pages have none.
        let open_space = match screen.nav.route() {
            Route::Space { space_id, .. } => Some(handles.mint_space(&space_id)),
            _ => None,
        };
        fn meta_role(meta: Option<&serde_json::Value>) -> Option<&str> {
            meta?.get("role")?.as_str()
        }
        let chrome = |spec: &'a AppSpec, space: &Option<SpaceHandle>| Mount {
            node: spec
                .app
                .as_ref()
                .map(|t| &t.node)
                .unwrap_or_else(|| empty_node()),
            cx: Self::bundle_cx(
                "app",
                Tier::App,
                meta_role(spec.app.as_ref().map(|t| &t.meta)),
                BundleSlot::App,
                spec,
                space,
            ),
            template: None,
        };
        match spec {
            RootSpec::Single { node, cx } => {
                // The caller's mount as declared — `Explicit`, Space when
                // unstated. A space route fills an unstated `cx.space`:
                // the mount is about the space the route names.
                let mut cx = cx.clone();
                if cx.space.is_none() {
                    cx.space = open_space;
                }
                vec![Mount {
                    node: node.as_ref(),
                    cx,
                    template: None,
                }]
            }
            RootSpec::App(spec) => {
                if !ready {
                    if let Some(boot) = &spec.boot {
                        return vec![Mount {
                            node: boot,
                            cx: Self::bundle_cx(
                                "boot",
                                Tier::App,
                                meta_role(boot.extra.get("meta")),
                                BundleSlot::Boot,
                                spec,
                                &open_space,
                            ),
                            template: None,
                        }];
                    }
                }
                match screen.nav.route() {
                    Route::Page { id } => {
                        let mut mounts = vec![chrome(spec, &open_space)];
                        if let Some(page) = spec.pages.iter().find(|p| p.id == id) {
                            mounts.push(Mount {
                                node: &page.node,
                                cx: Self::bundle_cx(
                                    format!("page:{id}"),
                                    Tier::App,
                                    meta_role(Some(&page.meta)),
                                    BundleSlot::Page(page.id.as_str().into()),
                                    spec,
                                    &open_space,
                                ),
                                template: None,
                            });
                        }
                        mounts
                    }
                    Route::Space { .. } | Route::Other => {
                        let mut mounts = vec![chrome(spec, &open_space)];
                        if let Some(template) = &spec.template {
                            mounts.push(Mount {
                                node: &template.node,
                                cx: Self::bundle_cx(
                                    "space",
                                    Tier::Space,
                                    meta_role(Some(&template.meta)),
                                    BundleSlot::Template(template.id.as_str().into()),
                                    spec,
                                    &open_space,
                                ),
                                template: Some(template),
                            });
                        }
                        mounts
                    }
                    Route::Landing => vec![chrome(spec, &open_space)],
                }
            }
        }
    }

    /// Run a frame: re-resolve iff a revision moved, then answer the cached
    /// tree. Syncs the `screen` view's snapshot when `screen.version`
    /// moved, resolves, then runs `commit → drain` on the hub — claims open at the
    /// source and the answers a synchronous source pushed land in the same
    /// pass.
    pub fn frame(&mut self, host: &mut dyn Host, screen: &ScreenState) -> &Arc<ResolvedNode> {
        if self.view.version() != screen.version {
            self.view.refresh(screen);
        }
        // Query events pushed since the last drain — a live source's
        // between-frames answer — are applied before the counters compare,
        // so the revision they moved is seen.
        self.hub.drain();
        let current = (
            screen.version,
            self.bag.version(),
            self.locals.version(),
            self.hub.revision(),
        );
        if self.resolved.is_none() || self.last != Some(current) {
            let started = Instant::now();
            let ready = (self.ready)(&self.bag);
            let mounts = Self::mounts_for(&self.spec, &self.handles, screen, ready);
            self.mount_cxs = mounts.iter().map(|m| m.cx.clone()).collect();
            // Resolve → commit the pass's claims → drain the deliveries:
            // a query's rows land after the pass that claimed it (the same
            // resolve that asks `local.<name>` reads `[]`). Loop until a
            // drain moves nothing — bounded, in case rows beget queries.
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
                // Claims a panicked pass recorded are dropped — a site
                // that does not claim again does not keep a stale claim.
                self.hub.begin_pass();
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
                        bag: Roots::new(&self.layer, self.bag.as_ref()),
                        host,
                        locals: &self.locals,
                        cache: &mut self.cache,
                        screen,
                        hub: &mut self.hub,
                        mount: &mount.cx,
                        handles: &self.handles,
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
                        &mount.cx,
                        &Scope::default(),
                        &mut cx,
                    ));
                    if mount.cx.mount.as_str() == "app" {
                        chrome_children = children.len() - before;
                    }
                }
                live = round_live;
                parents = round_parents;
                // `commit → drain`: the pass's claims diff against the held
                // set — releases close, new keys open at the source — then
                // whatever the deliveries queued lands on the cells. A
                // synchronous source answers inside `open`, so its rows
                // are visible to the very next pass. The quiet window keeps
                // those pushes from waking — they are this frame's own
                // products; anything left queued after it gets one wake.
                // The guard ends the window even if this pass unwinds.
                kept_filling = {
                    let _window = self.inbox.sync_queries();
                    // A commit that reset or reopened cells invalidated
                    // answers the pass just resolved with — that is as
                    // much "work landed" as a delivered event: re-resolve
                    // so the cells show `Loading` until the new source
                    // answers (Lal N1).
                    let reset = self.hub.commit(self.source.clone());
                    self.hub.drain() || reset
                };
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
            let orphans = &mut self.orphans;
            self.pending.retain(|call, p| {
                let keep = live.contains(&p.node);
                if !keep {
                    orphans.insert(*call);
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
                // The data revision read BEFORE the passes — a root write
                // inside the resolve (a host function it called, another
                // thread's `set_root`) leaves the source ahead of it, so
                // the next poll is dirty even if the invalidation arrival
                // already drained.
                current.1,
                // Locals and hub at the END: their writes here were the
                // resolve's own products — seeds, follows, cell fills —
                // already reflected in this tree.
                self.locals.version(),
                self.hub.revision(),
            ));
            // Every pass moved a cell — a deeper dependency chain may
            // still be climbing. Bump the hub past what `last` recorded
            // so `dirty` and the next frame see the leftover work instead
            // of caching this partial tree, and wake: the tree on screen
            // is partial, so a sleeping frontend must come back.
            if kept_filling {
                self.hub.bump();
                self.inbox.wake();
            }
        }
        self.resolved.as_ref().unwrap()
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
        // A home lane's handle writes the width it was dragged to into
        // shell state, as `PanelLane` calls `shellStore.setLaneWidth` —
        // the host's own wiring, not a handler in the tree, unless the
        // template authored an `onResize` of its own.
        if name == "onResize" {
            if let Some(lane) = find_node(&root, node)
                .filter(|n| n.ty.as_ref() == "$lane" && !n.handlers.contains_key("onResize"))
            {
                let width = match &event {
                    Value::Obj(o) => match o.get("detail") {
                        Some(Value::Obj(d)) => match d.get("width") {
                            Some(Value::Num(w)) => *w,
                            _ => f64::NAN,
                        },
                        _ => f64::NAN,
                    },
                    _ => f64::NAN,
                };
                let op = ScreenOp::SetLaneWidth {
                    lane: lane
                        .props
                        .get("lane")
                        .map(|v| v.js_string())
                        .unwrap_or_default(),
                    width,
                };
                self.apply_screen(screen, op);
                return;
            }
        }
        let mut at = Some(node.clone());
        while let Some(id) = at {
            let Some(target) = find_node(&root, &id) else {
                break;
            };
            if let Some(HandlerRef { tokens, scope }) = target.handlers.get(name) {
                let tokens = tokens.clone();
                let scope = scope.clone();
                let mount = mount_of(&self.mount_cxs, &id);
                let mut cx = HandlerCx {
                    host,
                    bag: Roots::new(&self.layer, self.bag.as_ref()),
                    locals: &self.locals,
                    cache: &mut self.cache,
                    screen,
                    view: &self.view,
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

    /// Everything the inbox took since the last drain, in arrival order:
    /// `complete` settles each delivered call (its lifecycle runs here);
    /// a `Query` event lands on its ticket's cell — `Tick::query_events`
    /// counts the ones a cell visibly changed for; a `Bindings` arrival
    /// only counts — the source's revision is the truth and
    /// [`Self::dirty`] re-reads it. Answers `(completions, query events,
    /// binding invalidations)` for `Tick`.
    pub fn drain_inbox(
        &mut self,
        host: &mut dyn Host,
        screen: &mut ScreenState,
    ) -> (usize, usize, usize) {
        let mut completions = 0usize;
        let mut queries = 0usize;
        let mut bindings = 0usize;
        for arrival in self.inbox.drain() {
            match arrival {
                Arrival::Completion { call, result } => {
                    completions += 1;
                    self.complete(host, screen, call, result);
                }
                Arrival::Query { ticket, event } => {
                    queries += self.hub.deliver(ticket, event) as usize;
                }
                Arrival::Bindings => bindings += 1,
            }
        }
        (completions, queries, bindings)
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
            if self.orphans.remove(&call_id) {
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
        // The mount the call STARTED under — not `mount_of` on the
        // current mounts: a node that survived a navigation still runs
        // its callbacks under the space it began on.
        let mut cx = HandlerCx {
            host,
            bag: Roots::new(&self.layer, self.bag.as_ref()),
            locals: &self.locals,
            cache: &mut self.cache,
            screen,
            view: &self.view,
            pending: &mut self.pending,
            calls: &mut self.calls,
            node: &pending.node,
            mount: &pending.mount,
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
/// names itself — and mounts as `Explicit`/Space, the untrusted default.
fn mount_of(mounts: &[MountCx], node: &NodeId) -> MountCx {
    let id = node.as_str();
    mounts
        .iter()
        .filter(|cx| {
            id.strip_prefix(cx.mount.as_str())
                .is_some_and(|rest| rest.starts_with(':'))
        })
        .max_by_key(|cx| cx.mount.as_str().len())
        .cloned()
        .unwrap_or_else(|| MountCx::explicit(id))
}

/// One mount — a node resolved under its [`MountCx`]'s id, with the
/// template context (`routes`/`panels`/`recordViews`) when the mount is
/// the space template itself.
struct Mount<'a> {
    node: &'a SchemaNode,
    cx: MountCx,
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

/// The source a `Runtime` carries when the host installed none: the
/// snapshot's `queries` table, answering a request by the `$queries`
/// field name that compiled it (`name_hint`). `open` answers inside the
/// call — the frame's `commit → drain` settles it in the same pass — and
/// `close` is a no-op: a name-keyed table has nothing to dispose.
struct SnapshotQueries {
    bag: Arc<StoreBag>,
}

impl SnapshotQueries {
    fn new(bag: Arc<StoreBag>) -> Self {
        Self { bag }
    }
}

impl QuerySource for SnapshotQueries {
    fn open(
        &self,
        _ticket: SubTicket,
        request: &QueryRequest,
        _handles: &HandleTable,
        sink: QuerySink,
    ) {
        let Some(name) = request.name_hint.as_deref() else {
            return;
        };
        match self.bag.query(name) {
            Value::List(rows) => sink.deliver(QueryEvent::Rows(rows)),
            Value::Undefined => {}
            other => sink.deliver(QueryEvent::Rows(Arc::new(vec![other]))),
        }
    }

    fn close(&self, _ticket: SubTicket) {}
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
