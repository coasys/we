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
//! One call = one resolve tick: [`Session::resolve`] first runs the
//! lifecycle of every pending call the host settled since the last tick,
//! then re-runs the resolve iff a revision moved, applies the screen ops a
//! route queued, and resolves again until stable — the loop a frame used to
//! spell out. [`Session::poll`] drains completions and ops queued between
//! resolves; a frontend calls it and re-resolves when it answers anything.
//! [`Session::dispatch`] runs a widget's handler event.
#![forbid(unsafe_code)]

use std::sync::Arc;

use we_expr::Value;
use we_screen::ScreenState;
use we_template::{
    Host, LocalState, NodeId, ResolvedNode, RootSpec, Runtime, StaticHost, Stats, StoreBag,
};

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
        let runtime = Runtime::from_spec(spec, bag, LocalState::new());
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

    /// The resolved tree, re-resolving while a resolve queued screen ops.
    /// Completions the host delivered run their lifecycle first, so a
    /// callback's local write is in this tree. A redirect bumps the screen
    /// version, so the next frame resolves the tree it landed on; a few
    /// rounds in case a redirect lands on another.
    pub fn resolve(&mut self) -> Arc<ResolvedNode> {
        self.runtime
            .drain_completions(self.host.as_mut(), &mut self.screen);
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

    /// Completions and ops queued between resolves — runs the one, drains
    /// the other into the screen, and answers how many arrived (0 = nothing
    /// changed, no re-resolve needed).
    pub fn poll(&mut self) -> usize {
        let completions = self
            .runtime
            .drain_completions(self.host.as_mut(), &mut self.screen);
        let ops = self.runtime.take_ops();
        let n = ops.len();
        for op in ops {
            self.screen.apply(op);
        }
        completions + n
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
