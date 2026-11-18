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

use crate::bindings::{BagBindings, BindingSource, Invalidator};
use crate::gate::{Declared, Gate};
use crate::handlers::{self, HandlerCx, PendingMap};
use crate::host::{CallBook, Completer};
use crate::inbox::{Arrival, Inbox};
use crate::query::{QueryEvent, QueryHub, QueryRequest, QuerySink, QuerySource, SubTicket};
use crate::resolve::{self, NoParts, PartSource};
use crate::resolved::{HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope};
use crate::scope::{RootLayer, Roots};
use crate::screen_view::{self, ScreenView};
use crate::surface::{SurfaceKey, SurfaceTable, SurfaceTag};
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
    /// Live surface entries — the last frame's claim set (E3c-13).
    pub surfaces: usize,
    /// Surface reports dropped — a dead key or a stale generation.
    pub surfaces_dropped: u64,
}

/// A custom readiness probe — `None` asks the binding source.
type ReadyFn = Box<dyn Fn(&StoreBag) -> bool>;

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
        /// The panels/dialogs the tree's `meta` would have declared —
        /// `[]` for an explicit mount unless the caller stamps it.
        declared: crate::gate::Declared,
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
            declared: crate::gate::Declared::default(),
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
    /// Per-frame `$localState` stores — a `$part`/panel/slot frame swaps
    /// its own in, keyed by its mount-root id (4.6.3).
    frame_locals: HashMap<Arc<str>, LocalState>,
    /// `$`-types that are real components — the app seeds it from the widget
    /// registry; the default treats every `$`-type as an unknown op.
    dollar_type: Arc<dyn Fn(&str) -> bool>,
    /// The subscription hub — query sites claim each pass; `commit` opens
    /// and closes at the source.
    hub: QueryHub,
    /// The surface table (E3c-13) — mount roots and `$surface` nodes claim
    /// each pass; a frame's commit prunes the rest, and frontend reports
    /// land through the inbox on the generation they quote.
    surfaces: SurfaceTable,
    /// The host tags of the mounts whose boundary is the slot the frontend
    /// paints the session into — the last frame's, in mount order. A
    /// mount framed by the content viewport carries its host tag on that
    /// synthetic wrapper instead; no host tag sits on a template node.
    host_surfaces: Vec<SurfaceTag>,
    /// The last pass's `$if` conditions ([`Runtime::conditions`]).
    conditions: HashMap<NodeId, bool>,
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
    /// The table every mount's handles (and `DatasetHandle`s) come from —
    /// the host's way back for a minted handle.
    handles: HandleTable,
    /// Ops a resolve queued (route redirects) — `take_ops` hands them out.
    ops: Vec<ScreenOp>,
    /// A host override for readiness — boot screens read it. `None` asks
    /// the binding source (the trait's `ready`); core reads no store for
    /// it (Lal F3: the `sessionStore` read lives in `we-legacy`).
    ready: Option<ReadyFn>,
    /// Who answers root names — [`BagBindings`] until the session installs
    /// its own (E3c-8a). Every resolve/dispatch read goes through it behind
    /// [`Self::gate`].
    bindings: Arc<dyn BindingSource>,
    /// The single read choke point — mints the permits, logs the denials.
    gate: Arc<Gate>,
    /// The compat names `bindings` serves member-filtered (its
    /// `compat_roots`), cached so `root_domain` needn't ask the source.
    compat: Arc<[Arc<str>]>,
    cache: ParseCache,
    resolved: Option<Arc<ResolvedNode>>,
    /// Origins stamped by the last resolve, republished on a cache hit.
    chat_origins: HashMap<NodeId, crate::chat_permit::ChatOrigin>,
    /// (screen, data, local, pool, surfaces) the last resolve recorded —
    /// the data entry as read *before* its first pass, so a write mid-resolve
    /// leaves the source ahead and the next `poll` dirty.
    last: Option<(u64, u64, u64, u64, u64)>,
    /// The live `screen` root — bound once into the mount's [`RootLayer`]
    /// at construction; `apply_screen`/`frame` refresh its snapshot,
    /// never rebind it.
    view: ScreenView,
    /// This mount's own root bindings (`screen`, the legacy faces),
    /// layered over `bag` — a second session on the same bag keeps its
    /// own instead of overwriting this one's. `Arc`: the default
    /// [`BagBindings`] source reads through it.
    layer: Arc<RootLayer>,
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
        let layer = Arc::new(RootLayer::new(&bag));
        layer.bind("screen", Value::namespace(view.clone()));
        // No installed source: the snapshot's `queries` table answers.
        let source: Arc<dyn QuerySource> = Arc::new(SnapshotQueries::new(bag.clone()));
        // The default binding source — bag + this session's layer, FAIL
        // CLOSED (Lal F3): it serves `screen` and the names core
        // classifies, and refuses every unclassified bag root until a
        // session installs a classified source (`we-legacy`'s
        // `LegacyBindings`) or the embedder explicitly opts into
        // `trust_unclassified_bag` (public; tests and snapshot tools do).
        // Its subscribe is the `set_invalidator` above, same dedup target.
        let bindings: Arc<dyn BindingSource> =
            Arc::new(BagBindings::new(bag.clone(), layer.clone()));
        Self {
            spec,
            bag,
            locals,
            dollar_type: Arc::new(|_| false),
            hub: QueryHub::new(inbox.clone(), handles.clone()),
            surfaces: SurfaceTable::default(),
            host_surfaces: Vec::new(),
            conditions: HashMap::new(),
            source,
            parts: Arc::new(NoParts),
            pending: HashMap::new(),
            orphans: Orphans::default(),
            calls: CallBook::new(inbox.clone()),
            inbox,
            ops: Vec::new(),
            ready: None,
            bindings,
            gate: Arc::new(Gate::new(handles.clone())),
            compat: Arc::from([]),
            handles,
            frame_locals: HashMap::new(),
            cache: ParseCache::new(),
            resolved: None,
            chat_origins: HashMap::new(),
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

    /// Override how readiness is decided (asks the binding source by
    /// default — `BagBindings` always answers ready; `LegacyBindings`
    /// reads the bag's `sessionStore`);
    /// `Runtime::new`'s trees never boot-gate anyway.
    pub fn with_ready(mut self, ready: impl Fn(&StoreBag) -> bool + 'static) -> Self {
        self.ready = Some(Box::new(ready));
        self
    }

    /// Opt into [`BagBindings::trusted_unclassified`]: every bag root is
    /// served to every tier as a plain `Space` root, unfiltered. A public,
    /// explicit opt-in — the caller vouches for every root in the bag (a
    /// bag it built, as tests and offline snapshot tools do). A host with
    /// real session stores installs a classified source
    /// ([`Self::set_bindings`]) instead.
    pub fn trust_unclassified_bag(mut self) -> Self {
        let trusted = BagBindings::trusted_unclassified(self.bag.clone(), self.layer.clone());
        self.set_bindings(Arc::new(trusted));
        self
    }

    /// Install the session's binding source (E3c-8a): every gated root
    /// read answers from it, its `compat_roots` widen `root_domain`, and
    /// it is handed this session's invalidator — the same dedup target as
    /// the construction-time bag subscription, so a re-install does not
    /// double the arrivals.
    pub fn set_bindings(&mut self, bindings: Arc<dyn BindingSource>) {
        bindings.subscribe(Invalidator::new(&self.inbox));
        self.compat = bindings.compat_roots().into();
        self.bindings = bindings;
        // A different source answers differently: the cached tree is stale.
        self.last = None;
    }

    /// How many nested frames (parts) hold a `$localState` store — tests
    /// read this to see unmounted parts pruned (Lal F9).
    pub fn frame_local_count(&self) -> usize {
        self.frame_locals.len()
    }

    /// The gate this runtime resolves behind — tests read its denials.
    pub fn gate(&self) -> &Arc<Gate> {
        &self.gate
    }

    /// The binding source answering root names.
    pub fn bindings(&self) -> &Arc<dyn BindingSource> {
        &self.bindings
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
    pub fn layer(&self) -> &Arc<RootLayer> {
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

    /// Would `frame` re-resolve: the `(screen, data, local, hub, surfaces)`
    /// tuple is not what the last resolve recorded. An exhausted pass budget
    /// is covered too — `frame` bumps the hub revision past what `last`
    /// recorded, so the mismatch reports itself here. `Session::poll`
    /// reports this as `Tick::dirty` — "a `resolve` now would produce a
    /// different tree" — and a quiet answer means the last tree is still
    /// right.
    pub fn dirty(&self, screen: &ScreenState) -> bool {
        self.last
            != Some((
                screen.version,
                self.bindings.revision(),
                self.local_version(),
                self.hub.revision(),
                self.surfaces.revision(),
            ))
    }

    /// The local-state input of the dirty tuple: the mount's store plus
    /// every mounted part's (4.6.3). One function for `dirty`, `frame`'s
    /// comparison and what `last` records (Lal F9). Between resolves each
    /// term only grows (writes bump; stores are added and pruned only
    /// inside a resolve), so an equal sum means nothing moved.
    fn local_version(&self) -> u64 {
        self.locals.version()
            + self
                .frame_locals
                .values()
                .map(LocalState::version)
                .sum::<u64>()
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
            declared: spec
                .app
                .as_ref()
                .map(|t| Declared::from_meta(&t.meta))
                .unwrap_or_default(),
            template: None,
        };
        match spec {
            RootSpec::Single { node, cx, declared } => {
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
                    declared: declared.clone(),
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
                            declared: Declared::default(),
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
                                declared: Declared::from_meta(&page.meta),
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
                                declared: Declared::from_meta(&template.meta),
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

    /// Origins the last resolve stamped. A cache hit keeps them.
    pub fn chat_origins(&self) -> &HashMap<NodeId, crate::chat_permit::ChatOrigin> {
        &self.chat_origins
    }

    /// One desktop frame at `href`. The same [`Self::frame`] the window runs.
    pub fn frame_at(&mut self, href: &str) -> Arc<ResolvedNode> {
        let screen = we_screen::ScreenState::desktop(we_screen::ScreenSchema::default(), href);
        let mut host = StaticHost::new(self.bag.clone());
        self.frame(&mut host, &screen).clone()
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
            self.bindings.revision(),
            self.local_version(),
            self.hub.revision(),
            self.surfaces.revision(),
        );
        if self.resolved.is_none() || self.last != Some(current) {
            let started = Instant::now();
            let ready = self
                .ready
                .as_ref()
                .map(|f| f(&self.bag))
                .unwrap_or_else(|| self.bindings.ready());
            let mounts = Self::mounts_for(&self.spec, &self.handles, screen, ready);
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
            // Each mount's host tag, and whether it is the app chrome's —
            // decides below which boundary reports it.
            let mut host_tags: Vec<(SurfaceTag, bool)> = Vec::new();
            // The nested frames (part mounts) the last pass resolved —
            // a part's locals outlive a pass only while it is mounted.
            let mut round_frames: HashSet<Arc<str>> = HashSet::new();
            let mut round_conditions: HashMap<NodeId, bool> = HashMap::new();
            for _ in 0..8 {
                // The last pass's stamps are the live set. A node that
                // left on a later pass must not keep an origin.
                crate::chat_permit::clear_chat_origins();
                // Claims a panicked pass recorded are dropped — a site
                // that does not claim again does not keep a stale claim.
                self.hub.begin_pass();
                self.surfaces.begin_pass();
                let mut round_live = HashSet::new();
                let mut round_parents = HashMap::new();
                round_conditions.clear();
                round_frames.clear();
                warnings.clear();
                children.clear();
                chrome_children = 0;
                host_tags.clear();
                for mount in &mounts {
                    // The mount's boundary — claimed again inside the
                    // resolve, which answers this same generation.
                    host_tags.push((
                        self.surfaces
                            .claim(SurfaceKey::Host(mount.cx.mount.clone())),
                        mount.cx.mount.as_str() == "app",
                    ));
                    let (routes, panels, record_views) = match mount.template {
                        Some(t) => (
                            t.node.routes.as_deref(),
                            t.meta.get("panels"),
                            t.meta.get("recordViews").and_then(|v| v.as_object()),
                        ),
                        None => (None, None, None),
                    };
                    let mut route_tail = Vec::new();
                    // The frame stack (4.6.3): frame 0 is the mount; a
                    // `$part`/panel/slot body pushes and pops.
                    let mut frames = vec![crate::gate::Frame {
                        auth: mount.cx.clone(),
                        declared: mount.declared.clone(),
                    }];
                    let mut cx = ResolveCx {
                        bag: Roots::new(self.layer.as_ref(), self.bag.as_ref()).gated(
                            self.bindings.as_ref(),
                            &self.gate,
                            &self.compat,
                            mount.cx.clone(),
                            mount.declared.clone(),
                        ),
                        host,
                        locals: self.locals.clone(),
                        frame_locals: &mut self.frame_locals,
                        frames: &mut frames,
                        cache: &mut self.cache,
                        screen,
                        hub: &mut self.hub,
                        surfaces: &mut self.surfaces,
                        mount: &mount.cx,
                        declared: &mount.declared,
                        handles: &self.handles,
                        parts: self.parts.as_ref(),
                        routes,
                        panels,
                        record_views,
                        ops: &mut ops,
                        live: &mut round_live,
                        conditions: &mut round_conditions,
                        mounted_frames: &mut round_frames,
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
            // The last pass's surface claims are the live set — a key whose
            // node left the tree drops here, taking any measure it held
            // (a stale-generation report already fails at apply, the way a
            // closed ticket's event does). Pruning moves no revision.
            self.surfaces.commit();
            self.stats.surfaces = self.surfaces.len();
            self.stats.surfaces_dropped = self.surfaces.dropped;
            self.ops.extend(ops);
            self.stats.parse_errors = warnings
                .iter()
                .filter(|w| w.starts_with("expression "))
                .count();
            self.stats.warnings = warnings;
            self.locals.retain(&live);
            // Part locals (F9): a part no longer mounted drops its store,
            // and a mounted part's store drops fields of vanished nodes.
            self.frame_locals
                .retain(|mount, _| round_frames.contains(mount));
            for locals in self.frame_locals.values() {
                locals.retain(&live);
            }
            self.parents = parents;
            self.live = live;
            self.conditions = round_conditions;
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
            // The mounts that viewport frames measure its box (a synthetic
            // node sized off `meta.frame` and the viewport, never off the
            // template); every other mount's boundary is the slot.
            self.host_surfaces.clear();
            let mut framed = smallvec::SmallVec::new();
            let frames = matches!(self.spec, RootSpec::App(_)) && chrome_children > 0;
            for (tag, chrome) in host_tags {
                if frames && !chrome {
                    framed.push(tag);
                } else {
                    self.host_surfaces.push(tag);
                }
            }
            if let RootSpec::App(spec) = &self.spec {
                if chrome_children > 0 {
                    let content = children.split_off(chrome_children);
                    let mut frame = content_viewport(spec.app.as_ref(), content);
                    frame.surfaces = framed;
                    children.push(ResolvedChild::Node(Box::new(frame)));
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
                    surfaces: smallvec::SmallVec::new(),
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
                // already reflected in this tree. The SAME aggregate
                // `dirty` compares (Lal F9): the mount's locals plus every
                // part's, after the unmounted parts were pruned.
                self.local_version(),
                self.hub.revision(),
                self.surfaces.revision(),
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
            self.chat_origins = crate::chat_permit::take_chat_origins();
        }
        crate::chat_permit::publish_chat_origins(&self.chat_origins);
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
            if let Some(HandlerRef {
                tokens,
                scope,
                frame,
            }) = target.handlers.get(name)
            {
                let tokens = tokens.clone();
                let scope = scope.clone();
                // The frame the handler was resolved in is its authority —
                // never a mount recomputed from the tree (4.6.3: a panel
                // body's handler must not inherit an outer frame).
                let frame = frame.clone();
                let mut cx = HandlerCx {
                    host,
                    bag: Roots::new(self.layer.as_ref(), self.bag.as_ref()).gated(
                        self.bindings.as_ref(),
                        &self.gate,
                        &self.compat,
                        frame.auth.clone(),
                        frame.declared.clone(),
                    ),
                    locals: self
                        .frame_locals
                        .get(frame.auth.mount.0.as_ref())
                        .unwrap_or(&self.locals),
                    cache: &mut self.cache,
                    screen,
                    view: &self.view,
                    pending: &mut self.pending,
                    calls: &mut self.calls,
                    node: &id,
                    mount: &frame.auth,
                    declared: &frame.declared,
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
    /// [`Self::dirty`] re-reads it; a `Surface` report applies against the
    /// generation it quotes — a live generation's record moving is the
    /// dirty input, a stale one just counts `surfaces_dropped`. Answers
    /// `(completions, query events, binding invalidations, surface
    /// reports)` for `Tick`.
    pub fn drain_inbox(
        &mut self,
        host: &mut dyn Host,
        screen: &mut ScreenState,
    ) -> (usize, usize, usize, usize) {
        let mut completions = 0usize;
        let mut queries = 0usize;
        let mut bindings = 0usize;
        let mut surfaces = 0usize;
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
                Arrival::Surface { tag, width } => {
                    surfaces += 1;
                    if !self.surfaces.report(&tag, width) {
                        self.stats.surfaces_dropped = self.surfaces.dropped;
                    }
                }
            }
        }
        (completions, queries, bindings, surfaces)
    }

    /// A frontend's content-box measure for `tag` — pushed to the inbox,
    /// so it wakes the frontend's hook exactly like a completion or a
    /// query delivery would. The drain applies it if `tag`'s generation
    /// is still live; `Session::report_surface` forwards here.
    pub fn report_surface(&mut self, tag: &SurfaceTag, width: f32) {
        self.inbox.push(Arrival::Surface {
            tag: tag.clone(),
            width,
        });
    }

    /// A live surface's `{width, tier}` — `None` when `key` is dead
    /// (unmounted or never claimed).
    pub fn surface_measure(&self, key: &SurfaceKey) -> Option<(f32, we_metrics::SizeTier)> {
        self.surfaces.measure(key)
    }

    /// The host surfaces whose boundary is the slot the frontend gives the
    /// session's root — the egui slot rect, the TUI pane, `--viewport` in
    /// dump and the CLI. The frontend reports the slot's width against
    /// each (E3c-13; `createSurface.ts:29` — the host's surfaces are the
    /// elements a tree is mounted in, outside the template). Measured
    /// there, a root sized off `surface.width` cannot feed its own width
    /// back. Empty before the first frame.
    /// Each `$if` with a transition in the last resolved tree, by the
    /// `$if`'s own id: whether its condition held. The painter compares it
    /// with the tree before — a `$if` there false and here true fades its
    /// `then` branch in; one not there before starts as it is.
    pub fn conditions(&self) -> &HashMap<NodeId, bool> {
        &self.conditions
    }

    pub fn host_surfaces(&self) -> &[SurfaceTag] {
        &self.host_surfaces
    }

    /// The surface table's revision — the [`Self::dirty`] input. Moves
    /// only when a live surface's record does; pruning is quiet.
    pub fn surface_revision(&self) -> u64 {
        self.surfaces.revision()
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
        // The frame the call STARTED under — not the mounts the current
        // tree resolves: a node that survived a navigation still runs
        // its callbacks under the space it began on.
        let mut cx = HandlerCx {
            host,
            bag: Roots::new(self.layer.as_ref(), self.bag.as_ref()).gated(
                self.bindings.as_ref(),
                &self.gate,
                &self.compat,
                pending.frame.auth.clone(),
                pending.frame.declared.clone(),
            ),
            locals: self
                .frame_locals
                .get(pending.frame.auth.mount.0.as_ref())
                .unwrap_or(&self.locals),
            cache: &mut self.cache,
            screen,
            view: &self.view,
            pending: &mut self.pending,
            calls: &mut self.calls,
            node: &pending.node,
            mount: &pending.frame.auth,
            declared: &pending.frame.declared,
            warnings: &mut self.stats.warnings,
        };
        // A host result landing in a space-tier callback carries no usable
        // handles: anything it contains crosses the boundary tainted
        // (4.6.5) — the callback can hold and compare it, never use it.
        // No payload carries another frame's authority (F4), and a host
        // result landing in a space-tier callback carries no usable handle
        // (4.6.5, F5) — judged by the frame the call was made in.
        let tier = pending.frame.auth.tier;
        let result = result
            .map(|v| crate::resolve::deliver(&v, tier))
            .map_err(|v| crate::resolve::deliver(&v, tier));
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

/// One mount — a node resolved under its [`MountCx`]'s id, with the
/// template context (`routes`/`panels`/`recordViews`) when the mount is
/// the space template itself, and the panels/dialogs its `meta` declared
/// (the frame's declared-id set, 4.6.3).
struct Mount<'a> {
    node: &'a SchemaNode,
    cx: MountCx,
    declared: Declared,
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
        surfaces: smallvec::SmallVec::new(),
        transition: None,
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
