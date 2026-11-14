//! [`Runtime`]: one template + the three revision counters + the cached
//! resolved tree — the per-frame data flow of §4.
//!
//! `frame` re-resolves only when a counter moved — screen (the `routeStore`
//! version the caller hands in), data (the [`StoreBag`] version), local
//! ([`LocalState`]). A frame with no change hands back the tree it had.
//! `dispatch` turns a widget event into handler tokens run against the
//! [`Host`].
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use indexmap::IndexMap;
use we_expr::{ParseCache, Value};

use crate::handlers::{self, HandlerCx};
use crate::resolved::{HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope};
use crate::{resolve, Host, Invoked, LocalState, ResolveCx, RouteState, SchemaNode, StoreBag};

/// Numbers the debug overlay reads — how much work the pipeline did.
#[derive(Debug, Default, Clone)]
pub struct Stats {
    /// Resolves run so far. A frame without input must not move this.
    pub resolves: u64,
    /// Wall time of the last resolve.
    pub last_resolve: Duration,
    /// Nodes in the current resolved tree.
    pub nodes: usize,
    /// Expression sources that failed to parse this resolve (E1's grammar
    /// covers them later — they read `Undefined` until then).
    pub parse_errors: usize,
    /// Dispatch-time and resolve-time complaints, deduplicated.
    pub warnings: Vec<Arc<str>>,
}

/// The runtime: template in, resolved tree out, events back to handlers.
pub struct Runtime {
    template: SchemaNode,
    template_id: Arc<str>,
    bag: Arc<StoreBag>,
    locals: LocalState,
    /// The screen revision — a routeStore write moves it.
    screen_rev: Box<dyn Fn() -> u64>,
    cache: ParseCache,
    resolved: Option<Arc<ResolvedNode>>,
    /// (screen, data, local) at the end of the last resolve.
    last: Option<(u64, u64, u64)>,
    parents: HashMap<NodeId, NodeId>,
    stats: Stats,
}

impl Runtime {
    /// `template` resolved under `template_id`'s namespace, against `bag`,
    /// with `locals` holding `$localState`; `screen_rev` answers the route
    /// version (the app's route state — [`RouteState::version`]).
    pub fn new(
        template: SchemaNode,
        template_id: impl Into<Arc<str>>,
        bag: Arc<StoreBag>,
        locals: LocalState,
        screen_rev: impl Fn() -> u64 + 'static,
    ) -> Self {
        Self {
            template,
            template_id: template_id.into(),
            bag,
            locals,
            screen_rev: Box::new(screen_rev),
            cache: ParseCache::new(),
            resolved: None,
            last: None,
            parents: HashMap::new(),
            stats: Stats::default(),
        }
    }

    /// The shared local store — the app's host writes through the same one.
    pub fn locals(&self) -> &LocalState {
        &self.locals
    }

    pub fn stats(&self) -> &Stats {
        &self.stats
    }

    /// The current resolved tree, if a frame has run.
    pub fn resolved(&self) -> Option<&Arc<ResolvedNode>> {
        self.resolved.as_ref()
    }

    /// Run a frame: re-resolve iff a revision moved, then answer the cached
    /// tree. Seeded initials move the local counter *inside* the resolve, so
    /// the counters it records are read again after it.
    pub fn frame(&mut self, host: &mut dyn Host) -> &Arc<ResolvedNode> {
        let current = (
            (self.screen_rev)(),
            self.bag.version(),
            self.locals.version(),
        );
        if self.resolved.is_none() || self.last != Some(current) {
            let started = Instant::now();
            let mut live = HashSet::new();
            let mut parents = HashMap::new();
            let mut warnings = std::mem::take(&mut self.stats.warnings);
            warnings.clear();
            let children = {
                let mut cx = ResolveCx {
                    bag: &self.bag,
                    host,
                    locals: &self.locals,
                    cache: &mut self.cache,
                    template_id: &self.template_id,
                    live: &mut live,
                    parents: &mut parents,
                    warnings: &mut warnings,
                };
                resolve(&self.template, &Scope::default(), &mut cx)
            };
            self.stats.parse_errors = warnings
                .iter()
                .filter(|w| w.starts_with("expression "))
                .count();
            self.stats.warnings = warnings;
            self.locals.retain(&live);
            self.parents = parents;

            // A fragment or an op can answer several children — the tree the
            // frame paints always has one root, so wrap them.
            let root = match children.as_slice() {
                [ResolvedChild::Node(node)] => (**node).clone(),
                _ => ResolvedNode {
                    id: NodeId::new(format!("{}:", self.template_id)),
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
                (self.screen_rev)(),
                self.bag.version(),
                self.locals.version(),
            ));
        }
        self.resolved.as_ref().unwrap()
    }

    /// `node`'s handler `name` fired with `event` — or an ancestor's, the way
    /// a DOM event bubbles (`tree-item-select` reaches the `we-tree` above).
    /// The handler's captured scope is its own; `event` binds on top.
    pub fn dispatch(&mut self, host: &mut dyn Host, node: &NodeId, name: &str, event: Value) {
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
                    warnings: &mut self.stats.warnings,
                };
                handlers::run(&tokens, &scope, event, &mut cx);
                return;
            }
            at = self.parents.get(&id).cloned();
        }
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

/// The node under `id`, by walk — the resolved tree is small, and dispatch is
/// per event, not per frame.
fn find_node<'a>(node: &'a ResolvedNode, id: &NodeId) -> Option<&'a ResolvedNode> {
    if &node.id == id {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_node(n, id),
        ResolvedChild::Text(_) => None,
    })
}

/// The host the offline app and tests run handlers against: `routeStore.*`
/// calls land on a real [`RouteState`], `$setLocal`/`get_local` on the shared
/// [`LocalState`], anything else answers the snapshot's `invokes` table or
/// `Undefined` — the "not wired yet" no-op of the fallback rule.
pub struct StaticHost {
    pub route: RouteState,
    pub bag: Arc<StoreBag>,
    pub locals: LocalState,
    /// Targets invoked that nothing answered — the debug overlay's "calls
    /// dropped" counter.
    pub dropped: Vec<String>,
}

impl StaticHost {
    /// Binds `routeStore` into the bag so expressions read it — the one store
    /// the skeleton owns itself.
    pub fn new(route: RouteState, bag: Arc<StoreBag>, locals: LocalState) -> Self {
        bag.set_root("routeStore", Value::namespace(route.namespace()));
        Self {
            route,
            bag,
            locals,
            dropped: Vec::new(),
        }
    }
}

impl Host for StaticHost {
    fn invoke(&mut self, target: &str, args: Vec<Value>) -> Invoked {
        match target {
            "routeStore.navigate" => {
                let href = args.first().map(|v| v.js_string()).unwrap_or_default();
                if !href.is_empty() {
                    self.route.navigate(&href);
                }
                Invoked::Done(Ok(Value::Null))
            }
            "routeStore.setParam" | "routeStore.setUrlParam" => {
                let name = args.first().map(|v| v.js_string()).unwrap_or_default();
                self.route
                    .set_param(&name, args.get(1).unwrap_or(&Value::Null));
                Invoked::Done(Ok(Value::Null))
            }
            _ => {
                if let Some(reply) = self.bag.invoke_reply(target) {
                    Invoked::Done(Ok(reply))
                } else {
                    self.dropped.push(target.to_string());
                    Invoked::Done(Ok(Value::Undefined))
                }
            }
        }
    }

    fn set_local(&mut self, node: &NodeId, field: &str, value: Value) {
        self.locals.set(node, field, value);
    }

    fn get_local(&self, node: &NodeId, field: &str) -> Value {
        self.locals.get(node, field)
    }
}
