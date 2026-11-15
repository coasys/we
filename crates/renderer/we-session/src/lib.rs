//! `we-session`: the app without pixels.
//!
//! A [`Session`] owns what every frontend needs equally: the [`Runtime`]
//! (schema → resolved tree), the injected [`Host`] (the domain actions a
//! template asks for), and the [`ScreenState`] (route, chrome, screen ops).
//! No egui, no tokio — a TUI drives the same session a window does.
//!
//! The host is given, never built here: [`Session::new`] takes any
//! `Box<dyn Host>`, and [`Session::offline`] boxes the snapshot-answering
//! [`StaticHost`] for the offline app and tests.
//!
//! One call = one resolve tick: [`Session::resolve`] runs [`Session::poll`]
//! first (every arrival's lifecycle, every queued screen op), re-runs the
//! resolve iff a revision moved, and repeats until stable — the loop a
//! frame used to spell out. `poll` is the honest answer to "is there
//! work": the [`Tick`] it returns says whether a resolve now would
//! produce a different tree and counts what arrived. A [`Waker`] the
//! frontend installs is called once per arrival batch — on whatever
//! thread produced it — so a sleeping frontend knows to call `poll`;
//! a quiet `Tick` means the last tree is still right.
//! [`Session::dispatch`] runs a widget's handler event.
#![forbid(unsafe_code)]

use std::sync::Arc;

use we_expr::{HandleTable, Value};
use we_screen::ScreenState;
use we_template::{
    Host, LocalState, NodeId, ResolvedNode, RootSpec, Runtime, StaticHost, Stats, StoreBag, Waker,
};

/// What [`Session::poll`] answered — whether a `resolve` now would
/// produce a different tree (`dirty`), and how much arrived to be worth
/// noting. `Tick::default()` is a quiet tick: nothing moved, nothing
/// landed — the last tree is still right and nothing was woken.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Tick {
    /// A resolve now would produce a different tree — a revision
    /// (screen, data, local, pool) moved past what the last resolve
    /// recorded — or the last resolve ran out of passes and left work
    /// over. `resolve` then `poll` again: the second tick is quiet.
    pub dirty: bool,
    /// Query events the drain applied — a source's between-frames
    /// deliveries (E3c-4); events a frame's own `commit → drain` consumed
    /// inside a resolve are not counted here.
    pub query_events: usize,
    /// Pending calls settled this drain — lifecycle ran, ignored and
    /// dropped alike.
    pub completions: usize,
    /// Binding-source invalidations drained — wake hints only; the data
    /// revision, not this count, drives `dirty`.
    pub binding_changes: usize,
    /// Screen ops a resolve queued (route redirects) applied this drain.
    pub screen_ops: usize,
    /// Surface reports the drain applied — the frontend's content-box
    /// measures landing between frames (E3c-13). A stale generation's is
    /// counted too: it drained, it just changed nothing.
    pub surfaces: usize,
}

/// Runtime + host + screen — everything a frontend reuses to render a
/// resolved tree.
pub struct Session {
    pub runtime: Runtime,
    /// The injected host. Public for E3c-1 (tests and the offline harnesses
    /// swap it); prefer [`Session::host`]/[`Session::host_as`].
    pub host: Box<dyn Host>,
    /// The address and chrome — `routeStore`/`shellStore` reads answer from
    /// here; screen ops land here.
    pub screen: ScreenState,
}

impl Session {
    /// `spec` against `bag`/`screen`, running domain actions on `host`. Wire
    /// the `$`-type gate with [`Session::with_dollar_types`] — each frontend
    /// answers "is this ty a widget" from its own registry.
    pub fn new(
        spec: RootSpec,
        bag: Arc<StoreBag>,
        screen: ScreenState,
        host: Box<dyn Host>,
    ) -> Self {
        Self::new_in(spec, bag, screen, host, HandleTable::new())
    }

    /// [`Session::new`] inside the host's handle table (`Runtime::from_spec_in`):
    /// a `MountCx::with_space` the host built from a handle it minted in
    /// `handles` resolves inside the session, where a fresh private table
    /// could never answer for it.
    pub fn new_in(
        spec: RootSpec,
        bag: Arc<StoreBag>,
        screen: ScreenState,
        host: Box<dyn Host>,
        handles: HandleTable,
    ) -> Self {
        let runtime = Runtime::from_spec_in(spec, bag, LocalState::new(), handles);
        Self {
            runtime,
            host,
            screen,
        }
    }

    /// [`Session::new`] with the offline host: the snapshot's `invokes`
    /// table answers every `$invoke`.
    pub fn offline(spec: RootSpec, bag: Arc<StoreBag>, screen: ScreenState) -> Self {
        let host = Box::new(StaticHost::new(bag.clone()));
        Self::new(spec, bag, screen, host)
    }

    /// `$`-types the frontend knows (`$lane`) resolve as components — the
    /// resolver asks before it stamps a `$todo:` placeholder.
    pub fn with_dollar_types(self, f: impl Fn(&str) -> bool + 'static) -> Self {
        let Self {
            runtime,
            host,
            screen,
        } = self;
        Self {
            runtime: runtime.with_dollar_types(f),
            host,
            screen,
        }
    }

    /// The frontend's "call `poll`" hook — egui's `ctx.request_repaint()`,
    /// a TUI event-channel send, a test's counter. Called once per
    /// arrival batch, on whatever thread produced it; the last frame's
    /// leftover work calls it too.
    pub fn set_waker(&mut self, waker: Waker) {
        self.runtime.inbox().set_waker(waker);
    }

    /// The resolved tree, re-resolving while a resolve queued screen ops.
    /// Arrivals run their lifecycle first (`poll`), so a callback's local
    /// write is in this tree. A redirect bumps the screen version, so the
    /// next frame resolves the tree it landed on; a few rounds in case a
    /// redirect lands on another — ops still queued then are the next
    /// poll's, and its `dirty` says so.
    pub fn resolve(&mut self) -> Arc<ResolvedNode> {
        self.poll();
        let mut resolved = self.runtime.frame(self.host.as_mut(), &self.screen).clone();
        for _ in 0..8 {
            let ops = self.runtime.take_ops();
            if ops.is_empty() {
                break;
            }
            for op in ops {
                self.screen.apply(op);
            }
            resolved = self.runtime.frame(self.host.as_mut(), &self.screen).clone();
        }
        resolved
    }

    /// Drain everything that arrived — completions run their lifecycle in
    /// arrival order, queued screen ops apply — and answer honestly: a
    /// [`Tick`] whose `dirty` says whether a `resolve` now would produce
    /// a different tree, plus what landed. Calling it with nothing
    /// pending is cheap and quiet — a quiet tick never woke anyone.
    pub fn poll(&mut self) -> Tick {
        let (completions, query_events, binding_changes, surfaces) = self
            .runtime
            .drain_inbox(self.host.as_mut(), &mut self.screen);
        let ops = self.runtime.take_ops();
        let screen_ops = ops.len();
        for op in ops {
            self.screen.apply(op);
        }
        Tick {
            dirty: self.runtime.dirty(&self.screen),
            query_events,
            completions,
            binding_changes,
            screen_ops,
            surfaces,
        }
    }

    /// A surface's content-box width in px, measured by this frontend —
    /// one of the tags a resolved node carries in `surfaces`. The report
    /// rides the same inbox every between-frames producer does: it wakes
    /// the session's waker and lands on `poll`'s drain, where a stale
    /// generation is spent instead of applied (E3c-13).
    pub fn report_surface(&mut self, tag: &we_template::SurfaceTag, width: f32) {
        self.runtime.report_surface(tag, width);
    }

    /// The headless frontend's report: every host surface in `root` gets
    /// `width` — dump/CLI do no layout, so the mount boundary is the
    /// `--viewport` answer and nested `$surface` boxes keep
    /// `createSurface`'s initial. Walks the tree once; reports through
    /// the inbox like a measured one.
    pub fn report_host_surfaces(&mut self, root: &ResolvedNode, width: f32) {
        fn collect(node: &ResolvedNode, out: &mut Vec<we_template::SurfaceTag>) {
            out.extend(
                node.surfaces
                    .iter()
                    .filter(|t| matches!(t.key, we_template::SurfaceKey::Host(_)))
                    .cloned(),
            );
            for child in &node.children {
                if let we_template::ResolvedChild::Node(n) = child {
                    collect(n, out);
                }
            }
        }
        let mut tags = Vec::new();
        collect(root, &mut tags);
        for tag in &tags {
            self.runtime.report_surface(tag, width);
        }
    }

    /// Run `handler` on `node` with `event` — what a widget emits.
    pub fn dispatch(&mut self, node: &NodeId, handler: &str, event: Value) {
        self.runtime
            .dispatch(self.host.as_mut(), &mut self.screen, node, handler, event);
    }

    /// The host — a debug overlay reads it.
    pub fn host(&self) -> &dyn Host {
        self.host.as_ref()
    }

    pub fn host_mut(&mut self) -> &mut dyn Host {
        self.host.as_mut()
    }

    /// The host as its concrete type, when it is one — the offline
    /// [`StaticHost`]'s dropped-call log.
    pub fn host_as<T: Host>(&self) -> Option<&T> {
        let any: &dyn std::any::Any = self.host.as_ref();
        any.downcast_ref()
    }

    pub fn host_mut_as<T: Host>(&mut self) -> Option<&mut T> {
        let any: &mut dyn std::any::Any = self.host.as_mut();
        any.downcast_mut()
    }

    /// The resolve/paint counters — a frontend's debug overlay reads these.
    pub fn stats(&self) -> &Stats {
        self.runtime.stats()
    }
}
