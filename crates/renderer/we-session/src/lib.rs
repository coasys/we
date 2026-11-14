//! `we-session`: the app without pixels.
//!
//! A [`Session`] owns what every frontend needs equally: the [`Runtime`]
//! (schema → resolved tree), the [`StaticHost`] (store bag + locals the
//! queries read), and the [`ScreenState`] (route, chrome, screen ops). No
//! egui, no tokio — a TUI drives the same session a window does.
//!
//! One call = one resolve tick: [`Session::resolve`] re-runs the resolve iff
//! a revision moved, applies the screen ops a route queued, and resolves
//! again until stable — the loop a frame used to spell out. [`Session::poll`]
//! drains ops queued between resolves (data landing async); a frontend calls
//! it and re-resolves when it answers anything. [`Session::dispatch`] runs a
//! widget's handler event.
#![forbid(unsafe_code)]

use std::sync::Arc;

use we_expr::Value;
use we_screen::ScreenState;
use we_template::{
    LocalState, NodeId, ResolvedNode, Runtime, SchemaNode, StaticHost, Stats, StoreBag,
};

/// Runtime + host + screen — everything a frontend reuses to render a
/// resolved tree.
pub struct Session {
    pub runtime: Runtime,
    pub host: StaticHost,
    /// The address and chrome — `routeStore`/`shellStore` reads answer from
    /// here; screen ops land here.
    pub screen: ScreenState,
}

impl Session {
    /// `schema` under `template_id`, against `bag`/`screen`. Wire the
    /// `$`-type gate with [`Session::with_dollar_types`] — each frontend
    /// answers "is this ty a widget" from its own registry.
    pub fn new(
        schema: SchemaNode,
        template_id: impl Into<Arc<str>>,
        bag: Arc<StoreBag>,
        screen: ScreenState,
    ) -> Self {
        let locals = LocalState::new();
        let runtime = Runtime::new(schema, template_id, bag.clone(), locals.clone());
        let host = StaticHost::new(bag, locals);
        Self {
            runtime,
            host,
            screen,
        }
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
    /// A redirect bumps the screen version, so the next frame resolves the
    /// tree it landed on; a few rounds in case a redirect lands on another.
    pub fn resolve(&mut self) -> Arc<ResolvedNode> {
        let mut resolved = self.runtime.frame(&mut self.host, &self.screen).clone();
        for _ in 0..8 {
            let ops = self.runtime.take_ops();
            if ops.is_empty() {
                break;
            }
            for op in ops {
                self.screen.apply(op);
            }
            resolved = self.runtime.frame(&mut self.host, &self.screen).clone();
        }
        resolved
    }

    /// Ops queued between resolves — drains them into the screen and
    /// answers how many landed (0 = nothing changed, no re-resolve needed).
    pub fn poll(&mut self) -> usize {
        let ops = self.runtime.take_ops();
        let n = ops.len();
        for op in ops {
            self.screen.apply(op);
        }
        n
    }

    /// Run `handler` on `node` with `event` — what a widget emits.
    pub fn dispatch(&mut self, node: &NodeId, handler: &str, event: Value) {
        self.runtime
            .dispatch(&mut self.host, &mut self.screen, node, handler, event);
    }

    /// The resolve/paint counters — a frontend's debug overlay reads these.
    pub fn stats(&self) -> &Stats {
        self.runtime.stats()
    }
}
