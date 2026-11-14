//! The resolver: [`SchemaNode`] + environment → [`ResolvedNode`] tree.
//!
//! [`resolve`] walks the authored tree once. Structure ops never reach the
//! output: `$if` leaves the branch it picked, `$each` its expanded rows,
//! `$animate`/`$if` attach their [`Transition`] to the branch they drew,
//! `$agent` binds a profile, `$part`/`$panels`/`$routes` resolve through the
//! host's tables, and an op this stage does not know leaves a
//! `ty = "$todo:<op>"` placeholder the paint side draws as a labelled box.
//!
//! Identity: a node's [`NodeId`] is `root:path` — the root is the template,
//! page, panel or part it resolved under, the path its child path plus the
//! `$each` row keys — so a re-resolve of an unchanged tree hands back the
//! same ids and [`LocalState`] keyed by them survives.
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::Value as Json;
use we_expr::{eval, Env, ParseCache, Value};
use we_screen::{local_persist_key, local_sync_spec, resolve_local_initial, ScreenOp, ScreenState};

use crate::handler::HandlerToken;
use crate::local::TrackedDeps;
use crate::node::{JsonMap, RouteNode, SchemaChild, SchemaNode};
use crate::query::{compile_query, QueryPool, QueryState};
use crate::resolved::{HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope, Transition};
use crate::scope::{FieldMeta, LocalDecl, LocalNs, LocalScope, ScopeEnv, StoreBag};
use crate::{Host, LocalState};

/// Where `$part` looks up module content. The app installs the module
/// registry here (E9 fills it); tests and the offline stage carry
/// [`NoParts`], which makes every `$part` a placeholder naming its id — the
/// same placeholder WE's `PartFrame` draws when a module is not here.
pub trait PartSource {
    /// The part's schema, if this build carries it.
    fn part(&self, id: &str) -> Option<Arc<SchemaNode>>;
}

/// The default: no parts at all.
pub struct NoParts;

impl PartSource for NoParts {
    fn part(&self, _id: &str) -> Option<Arc<SchemaNode>> {
        None
    }
}

/// What a resolve needs besides the node and the scope.
pub struct ResolveCx<'a> {
    pub bag: &'a StoreBag,
    pub host: &'a mut dyn Host,
    pub locals: &'a LocalState,
    pub cache: &'a mut ParseCache,
    pub screen: &'a ScreenState,
    pub pool: &'a QueryPool,
    /// `$part` lookups.
    pub parts: &'a dyn PartSource,
    /// The active template's route table, for `$routes`.
    pub routes: Option<&'a [RouteNode]>,
    /// The active template's `meta.panels`, for `$panels`.
    pub panels: Option<&'a serde_json::Value>,
    /// The active template's `meta.recordViews`, for the host record route.
    pub record_views: Option<&'a JsonMap>,
    /// Screen ops a resolve queues — a route's redirect. The runtime applies
    /// them after the pass (a resolve never mutates).
    pub ops: &'a mut Vec<ScreenOp>,
    /// Every node id this pass produced — `LocalState::retain` drops the rest.
    pub live: &'a mut HashSet<NodeId>,
    /// child → parent, for handler bubbling at dispatch time.
    pub parents: &'a mut HashMap<NodeId, NodeId>,
    /// Resolve-time complaints. Never fatal.
    pub warnings: &'a mut Vec<Arc<str>>,
    /// `$`-types that are real components (`$lane` is a widget, not a
    /// structure op) — the app answers from its widget registry. Everything
    /// else `$`-prefixed becomes a labelled `$todo:` placeholder.
    pub dollar_type: &'a dyn Fn(&str) -> bool,
    /// Parsed sub-schemas, keyed by the address of their raw `Json` —
    /// `$if` branches, panel bodies, and record views are embedded as raw
    /// props/meta and would otherwise re-deserialize on every pass. The
    /// bundle outlives the runtime, so its `Json` addresses are stable.
    pub node_memo: &'a mut HashMap<usize, Arc<SchemaNode>>,
    /// The matched chain tail a `$routes` outlet continues — pushed while a
    /// route step's body resolves (empty inside the leaf's body), popped
    /// after. `None` at the template's own `$routes` node.
    pub route_tail: &'a mut Vec<Vec<MatchedRoute<'a>>>,
    /// Scope values the resolver rebuilds each pass but that must keep one
    /// identity while their content holds — the `$surface` box and `$nav`
    /// are a store/context WE keeps alive across renders. Keyed by their
    /// scope slot (`$surface:<node>`, `$nav:<route>`); [`ResolveCx::memo_value`]
    /// interns by content.
    pub value_memo: &'a mut HashMap<Arc<str>, Value>,
}

impl ResolveCx<'_> {
    /// `candidate` interned to `slot`: while a rebuild's content holds, the
    /// SAME value answers — the scope object WE keeps alive across renders.
    /// Changed content swaps the allocation, the way a store write does.
    fn memo_value(&mut self, slot: Arc<str>, candidate: Value) -> Value {
        match self.value_memo.get(&slot) {
            Some(held) if crate::scope::content_eq(held, &candidate) => held.clone(),
            _ => {
                self.value_memo.insert(slot, candidate.clone());
                candidate
            }
        }
    }

    fn node_id(&self, root: &str, path: &str) -> NodeId {
        NodeId::new(format!("{root}:{path}"))
    }

    /// `json` as a `SchemaNode`, parsed once per runtime — `None` for
    /// anything that is not a node.
    fn memo_node(&mut self, json: &Json) -> Option<Arc<SchemaNode>> {
        let key = json as *const Json as usize;
        if let Some(node) = self.node_memo.get(&key) {
            return Some(node.clone());
        }
        let node = serde_json::from_value::<SchemaNode>(json.clone()).ok()?;
        let node = Arc::new(node);
        self.node_memo.insert(key, node.clone());
        Some(node)
    }
}

/// `true` for the prop names that carry handlers — `on` + an uppercase
/// letter, WE's rule (`isEventProp` in the Solid renderer).
pub(crate) fn is_event_prop(key: &str) -> bool {
    key.len() > 2 && key.starts_with("on") && key.as_bytes()[2].is_ascii_uppercase()
}

/// `true` for a prop *value* that is a handler token (or a list of them) —
/// callback props like `we-modal`'s `close`, which the Solid dispatcher
/// resolves to a callable in any prop position, not just behind `on*`.
/// Expressions (`{"$": …}`), queries and structural tokens produce
/// [`HandlerToken::Other`] and stay props.
fn is_callback_prop(json: &Json) -> bool {
    let tokens = handler_tokens(json);
    !tokens.is_empty() && tokens.iter().all(|t| !matches!(t, HandlerToken::Other(_)))
}

/// `true` for any object carrying a `$`-keyed token (`hasAnyToken` in the
/// dispatcher): an expression, a handler token, a query. Objects with none
/// are data and resolve recursively.
fn has_any_token(v: &Json) -> bool {
    v.as_object()
        .is_some_and(|o| o.keys().any(|k| k.starts_with('$')))
}

/// Evaluate one expression source. A parse error is not a failure — the prop
/// reads `Undefined` and the warning lists the source once.
pub(crate) fn eval_str(
    source: &str,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Value {
    match cache.parse(source) {
        Ok(expr) => eval(&expr, &ScopeEnv { scope, bag }),
        Err(err) => {
            let message: Arc<str> = format!("expression {source:?}: {err}").into();
            if !warnings.iter().any(|w| w == &message) {
                warnings.push(message);
            }
            Value::Undefined
        }
    }
}

/// `source` evaluated once with its reads recorded — the `(name, value)`
/// pairs the expression actually consumed, so a later pass can ask whether
/// its memo's inputs moved rather than whether this pass's value merely
/// differs. The evaluator's [`Env::read_observer`] reports every link of
/// every read chain as it happens — no value is wrapped, so what the field
/// stores, what a host call receives and what `===` compares are the same
/// allocations the bag answered. Every reported read is a dependency —
/// including the parents: `store.cfg` under `store.cfg.child` is a real
/// signal read (a `P1→P2` swap re-runs the expression and emits a fresh
/// container), and `follow_initial`'s `===` emit check — not the dep list —
/// is what suppresses the non-emission when the memo's own answer is the
/// shared child. The reads the port synthesizes are not inputs and are
/// excluded at the recorder, named: `LocalNs`'s `local.$*` plumbing and a bare
/// conduit-box root (`local`, `surface`, `$nav`, an `$agent` stub, and the
/// screen-store roots `bind_screen` rewraps on a screen move) — rebuilt
/// every pass where WE keeps one object alive per mount, so
/// recording the box would fake a moved input while the reads through it
/// (`local.src`, `surface.tier`) stay real. [`LocalState::follow_initial`]
/// is the consumer.
fn eval_str_tracked(
    source: &str,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> (Value, TrackedDeps) {
    match cache.parse(source) {
        Ok(expr) => {
            let reads = RefCell::new(TrackedDeps::default());
            let value = {
                // A bare root is a conduit when its innermost scope binding
                // is marked one, or — unshadowed by the scope — when it is
                // a root `bind_screen` rebuilt (`routeStore`, `shellStore`,
                // `themeStore`, `spaceStore`), rewrapped on every screen
                // version move.
                let is_conduit_root = |name: &str| match scope.get(name) {
                    Some(_) => scope.is_conduit(name),
                    None => bag.is_screen_conduit(name),
                };
                let observe = |path: &str, value: &Value| {
                    // `LocalNs`'s own members (`local.$fields`,
                    // `local.$decl:*`, `local.$owner:*`) are the port's
                    // plumbing — they rebuild on demand — and a bare
                    // conduit-box root is the same kind of read: recording
                    // either registers a dependency that moves every pass
                    // without meaning one. Only those: a real store's
                    // `$status` member is a signal like any other.
                    let plumbing = path.starts_with("local.$") && scope.is_conduit("local");
                    if !plumbing && (path.contains('.') || !is_conduit_root(path)) {
                        reads.borrow_mut().push((path.into(), value.clone()));
                    }
                };
                eval(
                    &expr,
                    &TrackEnv {
                        inner: ScopeEnv { scope, bag },
                        observe: &observe,
                    },
                )
            };
            (value, reads.into_inner())
        }
        Err(err) => {
            let message: Arc<str> = format!("expression {source:?}: {err}").into();
            if !warnings.iter().any(|w| w == &message) {
                warnings.push(message);
            }
            (Value::Undefined, Vec::new())
        }
    }
}

/// The [`Env`] one tracked initial evaluates against: `ScopeEnv` reads,
/// observed. The evaluator reports each read to `observe` — the deps, with
/// no wrapping — and each host call adds a `$call:` output-content entry:
/// an opaque call's inputs are whatever it read while it ran, invisible
/// here, so the settled ANSWER compared by content (`deps_moved` gives
/// `$call:` entries `content_eq`) is the contract — documented at
/// [`StoreBag::set_function`] for registrants.
struct TrackEnv<'a> {
    inner: ScopeEnv<'a>,
    observe: &'a dyn Fn(&str, &Value),
}

impl Env for TrackEnv<'_> {
    fn root(&self, name: &str) -> Option<Value> {
        self.inner.root(name)
    }

    fn call(&self, name: &str, args: &[Value]) -> Value {
        // Settle once and return that same value — an accessor answer runs
        // exactly once for the syntactic call, and what the `$call:` log
        // records is what the expression holds. (`call_function` does not
        // settle its env's answer; handing it the raw callable would invoke
        // the accessor a second time at the read and could log a different
        // answer.)
        let value = self.inner.call(name, args).settle();
        (self.observe)(&format!("$call:{name}"), &value);
        value
    }

    fn read_observer(&self) -> Option<&we_expr::ReadObserver<'_>> {
        Some(self.observe)
    }
}

/// Resolve one prop value: `{"$": …}` evaluates; every other token object is
/// not a value here (a handler token belongs behind `on*`, a query behind
/// `$queries`); arrays and plain objects resolve recursively; primitives are
/// data.
pub(crate) fn eval_json(
    json: &Json,
    scope: &Scope,
    bag: &StoreBag,
    cache: &mut ParseCache,
    warnings: &mut Vec<Arc<str>>,
) -> Value {
    match json {
        Json::Object(map) if has_any_token(json) => {
            if let Some(source) = map.get("$").and_then(|s| s.as_str()) {
                eval_str(source, scope, bag, cache, warnings)
            } else {
                // A handler token (`$invoke`, `$setLocal`, …) or `{$query:…}`
                // where a value was expected — neither is one.
                Value::Undefined
            }
        }
        Json::Object(map) => Value::Obj(Arc::new(
            map.iter()
                .map(|(k, v)| (k.as_str().into(), eval_json(v, scope, bag, cache, warnings)))
                .collect(),
        )),
        Json::Array(items) => Value::List(Arc::new(
            items
                .iter()
                .map(|v| eval_json(v, scope, bag, cache, warnings))
                .collect(),
        )),
        primitive => Value::from_json(primitive),
    }
}

/// A prop value with the inline `{"$query": descriptor}` form — the path
/// TS's prop loop and `$each.items` share (`hasToken($query)` →
/// `createQuerySignal`). The descriptor compiles into the pool like a
/// named query, and the prop reads the cell's rows — `[]` while Loading
/// or when the gate turns it off, the same answer `local.<name>` gives.
fn eval_prop(json: &Json, scope: &Scope, cx: &mut ResolveCx) -> Value {
    if let Json::Object(map) = json {
        if let Some(descriptor) = map.get("$query") {
            return match compile_query(descriptor, scope, cx.bag, cx.cache, cx.warnings) {
                Some(compiled) => match cx.pool.cell(compiled.key, compiled.ir).state() {
                    QueryState::Rows(rows) => Value::List(rows),
                    QueryState::Loading => Value::List(Arc::new(Vec::new())),
                },
                None => Value::List(Arc::new(Vec::new())),
            };
        }
    }
    eval_json(json, scope, cx.bag, cx.cache, cx.warnings)
}

/// The tokens of a handler prop — one object, or a list of them — kept raw;
/// they evaluate when the handler fires, with the event in scope.
pub(crate) fn handler_tokens(json: &Json) -> Vec<HandlerToken> {
    match json {
        Json::Array(items) => items.iter().cloned().map(HandlerToken::from_json).collect(),
        Json::Object(_) => vec![HandlerToken::from_json(json.clone())],
        _ => vec![],
    }
}

/// `props[key]` as a node — the `then`/`else` of a `$if`. `None` for anything
/// that is not an object (a missing branch is an empty one). Raw JSON sub-
/// schemas parse once per runtime via the caller's memo.
fn prop_node(props: Option<&JsonMap>, key: &str, cx: &mut ResolveCx) -> Option<Arc<SchemaNode>> {
    props.and_then(|p| p.get(key)).and_then(|v| cx.memo_node(v))
}

/// The name a child position takes in the path: an authored `key` names it
/// `#key`, else its `type`, else `""` — fragment children and `{"$": …}`
/// tokens included, so the sequence matches the authored one.
fn step_name(node: &SchemaNode) -> String {
    if let Some(key) = &node.key {
        format!("#{key}")
    } else {
        node.ty.clone().unwrap_or_default()
    }
}

/// The path step for the `nth` child named `name`: `#key` alone for the
/// first keyed child, `name` + index otherwise.
fn step(name: &str, nth: usize) -> String {
    if name.starts_with('#') && nth == 0 {
        name.to_string()
    } else {
        format!("{name}{nth}")
    }
}

/// The row keys an `$each` list gets — a typed identity, so two different
/// rows can never land on the same [`NodeId`]:
///
/// - every row a plain object with a distinct, typed `id` → the keyed
///   path (WE's `keyable` in keptRows.ts): `ks`/`kn` + the id — a
///   `Set<string | number>` distinguishes `1` from `"1"`, so the encoding
///   must too, and a keyed row can never alias a same-text item row.
/// - otherwise the item path (`<For>`'s mapArray): `i` + a type tag and
///   the value — a string carries its byte length ahead of its bytes, so
///   no value text can bleed into the `~n` occurrence suffix — while
///   containers take a reference sequence from [`LocalState::row_ref`],
///   keyed by the row's live allocation, never a reusable address.
fn each_keys(items: &[Value], id: &NodeId, cx: &ResolveCx) -> Vec<String> {
    let mut ids = Vec::with_capacity(items.len());
    let keyed = !items.is_empty() && {
        let mut seen = HashSet::with_capacity(items.len());
        items.iter().all(|item| {
            row_id(item).is_some_and(|key| {
                ids.push(key.clone());
                seen.insert(key)
            })
        })
    };
    if keyed {
        return ids;
    }
    let mut seen: HashMap<String, usize> = HashMap::with_capacity(items.len());
    items
        .iter()
        .map(|item| {
            let base = row_key(item, id, cx);
            let seen = seen.entry(base.clone()).or_insert(0);
            let key = if *seen == 0 {
                base
            } else {
                format!("{base}~{seen}")
            };
            *seen += 1;
            key
        })
        .collect()
}

/// An unkeyed row's item identity: the type tag, then the value — a
/// string's byte length ahead of it, so value text stays inside the field
/// it belongs to. Containers answer the allocation's sequence within this
/// `$each` (`r:5`-style, but weak-held).
fn row_key(item: &Value, id: &NodeId, cx: &ResolveCx) -> String {
    match item {
        Value::Str(s) => format!("is:{}:{}", s.len(), s),
        Value::Num(n) => format!("in:{}", Value::Num(*n).js_string()),
        Value::Bool(b) => format!("ib:{b}"),
        Value::Null => "inull".into(),
        Value::Undefined => "iundef".into(),
        Value::Obj(_) | Value::List(_) => format!("ir:{}", cx.locals.row_ref(id, item)),
        other => {
            let text = other.to_text();
            format!("ix:{}:{}", text.len(), text)
        }
    }
}

/// A row's keyed identity — `ks`/`kn` namespaces a string and a number id
/// apart, and `k…` apart from every `i…` item key.
fn row_id(item: &Value) -> Option<String> {
    let Value::Obj(o) = item else { return None };
    match o.get("id") {
        Some(Value::Str(s)) => Some(format!("ks:{}:{}", s.len(), s)),
        Some(Value::Num(n)) => Some(format!("kn:{}", Value::Num(*n).js_string())),
        _ => None,
    }
}

/// Attach the op's authored transition to each resolved child node, where
/// the node did not declare one of its own.
fn with_transition(
    children: Vec<ResolvedChild>,
    transition: Option<Transition>,
) -> Vec<ResolvedChild> {
    match transition {
        Some(t) => children
            .into_iter()
            .map(|child| match child {
                ResolvedChild::Node(mut node) => {
                    if node.transition.is_none() {
                        node.transition = Some(t.clone());
                    }
                    ResolvedChild::Node(node)
                }
                other => other,
            })
            .collect(),
        None => children,
    }
}

/// The profile a `$agent` binds: `profileStore.profiles` holds them — an
/// object keyed by DID, or a list of rows carrying `did`. `None` when no
/// profile resolves — the caller binds the `{did}` stub a template can
/// still name (`agent.did` reads it back).
fn agent_profile(bag: &StoreBag, did: &str) -> Option<Value> {
    let profiles = bag
        .root("profileStore")
        .and_then(|root| match &root {
            Value::Namespace(ns) => Some(ns.get("profiles")),
            _ => None,
        })
        .unwrap_or(Value::Undefined);
    match &profiles {
        Value::Obj(map) => map.get(did).cloned(),
        Value::List(rows) => rows
            .iter()
            .find(|row| {
                matches!(row, Value::Obj(o) if matches!(o.get("did"), Some(Value::Str(d)) if d.as_ref() == did))
            })
            .cloned(),
        _ => None,
    }
}

fn stub(did: &str) -> Value {
    let mut o = IndexMap::new();
    o.insert("did".into(), Value::Str(did.into()));
    Value::Obj(Arc::new(o))
}

/// One step of a matched route chain: the route plus the accumulated path
/// it matched under (`fullPath` in `buildRoutes`) — its node identity and
/// its `$nav.baseDepth` both come from it.
#[derive(Debug, Clone)]
pub struct MatchedRoute<'a> {
    pub route: &'a RouteNode,
    /// `prefix + pattern` — template-relative (`/settings/profile`).
    pub full: String,
}

/// A route table match: the chain of routes the segments satisfy,
/// outermost layout first.
///
/// Rules (`routeMatching.ts` + `buildRoutes`): `:` binds any one segment,
/// `*` is the catch-all (only consulted after everything else), a layout
/// route recurses into its own `routes` with the remainder — and still
/// renders when nothing is left to descend into — and a leaf needs the
/// segments spent.
enum RouteMatch<'a> {
    /// The matched chain — each step's `$routes` outlet holds the next.
    Chain(Vec<MatchedRoute<'a>>),
    /// A `*` or an explicit `redirect`: buildRoutes mounts the `Navigate`
    /// as the matched layouts' child, so they stay mounted around the
    /// (empty) outlet while it lands. `to` is the op's path; `matched` is
    /// the redirect route's own matched depth — the `from` the router
    /// resolves `./`/`../` against.
    Redirect {
        mounted: Vec<MatchedRoute<'a>>,
        to: String,
        matched: usize,
    },
}

fn match_routes<'a>(
    routes: &'a [RouteNode],
    segments: &[String],
    prefix: &str,
) -> Option<RouteMatch<'a>> {
    let mut wildcard: Option<&RouteNode> = None;
    for route in routes {
        let pattern = route.path.trim_matches('/');
        if pattern == "*" {
            wildcard = Some(route);
            continue;
        }
        let parts: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
        if parts.len() > segments.len() {
            continue;
        }
        let met = parts
            .iter()
            .zip(segments.iter())
            .all(|(p, s)| p.starts_with(':') || p == s);
        if !met {
            continue;
        }
        let full = if pattern.is_empty() {
            prefix.to_string()
        } else {
            format!("{prefix}/{pattern}")
        };
        let rest = &segments[parts.len()..];
        if let Some(redirect) = &route.redirect {
            // A redirect route compiles to a leaf `<Route>` — it fires
            // only when the pattern spent the segments; `routes` a
            // redirect also carries are dead (buildRoutes checks
            // `redirect` first), so leftovers mean this route does not
            // match and the table moves on.
            if !rest.is_empty() {
                continue;
            }
            return Some(RouteMatch::Redirect {
                mounted: Vec::new(),
                to: resolve_redirect(redirect, prefix),
                matched: segment_count(prefix) + parts.len(),
            });
        }
        if let Some(children) = route.node.routes.as_deref() {
            match match_routes(children, rest, &full) {
                Some(RouteMatch::Chain(mut tail)) => {
                    let mut chain = vec![MatchedRoute {
                        route,
                        full: full.clone(),
                    }];
                    chain.append(&mut tail);
                    return Some(RouteMatch::Chain(chain));
                }
                // A nested redirect fires inside this layout's outlet —
                // buildRoutes mounts the `Navigate` as its child, so the
                // layout stays mounted (its locals included) while it
                // lands. Only a `None` falls through to outer siblings.
                Some(RouteMatch::Redirect {
                    mounted,
                    to,
                    matched,
                }) => {
                    let mut chain = vec![MatchedRoute {
                        route,
                        full: full.clone(),
                    }];
                    chain.extend(mounted);
                    return Some(RouteMatch::Redirect {
                        mounted: chain,
                        to,
                        matched,
                    });
                }
                None => {}
            }
            if rest.is_empty() {
                // A layout route still renders with an empty outlet — the
                // router mounts the parent alone.
                return Some(RouteMatch::Chain(vec![MatchedRoute { route, full }]));
            }
            continue;
        }
        if rest.is_empty() {
            return Some(RouteMatch::Chain(vec![MatchedRoute { route, full }]));
        }
    }
    // No pattern matched: the catch-all, which here means its redirect.
    if let Some(route) = wildcard {
        if let Some(redirect) = &route.redirect {
            return Some(RouteMatch::Redirect {
                mounted: Vec::new(),
                to: resolve_redirect(redirect, prefix),
                // A `*` route's matched path is everything under `prefix`.
                matched: segment_count(prefix) + segments.len(),
            });
        }
        return Some(RouteMatch::Chain(vec![MatchedRoute {
            route,
            full: format!("{prefix}/*"),
        }]));
    }
    None
}

/// How many path segments a route path covers (its depth in the address).
fn segment_count(path: &str) -> usize {
    path.split('/').filter(|s| !s.is_empty()).count()
}

/// `redirect` as the `Navigate` op should see it (buildRoutes):
/// `./`/`../` go through for `resolve_path` to climb from the redirect
/// route's own matched depth — everything else, a leading `/` included,
/// composes over the parent's full path (`parentPath + route.redirect`),
/// so `/x` nested under `/app` means `/app/x`, not the root. The
/// composition is literal string concatenation, as written in TS — a
/// bare `x` produces `/appx`.
fn resolve_redirect(redirect: &str, prefix: &str) -> String {
    if redirect.starts_with("./") || redirect.starts_with("../") {
        redirect.to_string()
    } else {
        format!("{prefix}{redirect}")
    }
}

/// One authored child list → resolved children. `parent` is the resolved
/// node these children hang under; `root` is the identity prefix.
fn resolve_children(
    children: Option<&[SchemaChild]>,
    scope: &Scope,
    parent: &NodeId,
    root: &str,
    path: &str,
    decls: &Arc<Vec<LocalScope>>,
    cx: &mut ResolveCx,
) -> Vec<ResolvedChild> {
    let mut out = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    let Some(children) = children else { return out };
    for child in children {
        let SchemaChild::Node(node) = child else {
            if let SchemaChild::Text(text) = child {
                out.push(ResolvedChild::Text(text.as_str().into()));
            }
            continue;
        };
        let name = step_name(node);
        let nth = counts.entry(name.clone()).or_insert(0);
        let child_path = format!("{path}/{}", step(&name, *nth));
        *nth += 1;
        out.extend(resolve_node(
            node,
            scope,
            parent,
            root,
            &child_path,
            decls,
            cx,
        ));
    }
    out
}

/// Resolve `node` at `path` under `root`, in `scope`.
fn resolve_node(
    node: &SchemaNode,
    scope: &Scope,
    parent: &NodeId,
    root: &str,
    path: &str,
    decls: &Arc<Vec<LocalScope>>,
    cx: &mut ResolveCx,
) -> Vec<ResolvedChild> {
    // A `{"$": …}` child is an expression, not a node: evaluated text.
    if let Some(source) = node.expression_token() {
        let value = eval_str(source, scope, cx.bag, cx.cache, cx.warnings);
        return vec![ResolvedChild::Text(value.to_text())];
    }

    // Every declaring node — widget, structure op or fragment — establishes
    // its `local` scope and its fields' lifetime before the structure it
    // names is interpreted (`RenderSchema` declares first, then branches).
    // A node that flattens away still owns the fields it declared.
    let declares = node.local_state.is_some() || node.queries.is_some();
    let id = cx.node_id(root, path);
    let (node_scope, node_decls) = if declares {
        cx.live.insert(id.clone());
        cx.parents.insert(id.clone(), parent.clone());
        declare_locals(node, &id, scope, decls, cx)
    } else {
        (scope.clone(), Arc::clone(decls))
    };
    let scope = &node_scope;
    let decls = &node_decls;

    let props = node.props.as_ref();
    match node.ty.as_deref() {
        Some("$if") => {
            let cond = props
                .and_then(|p| p.get("condition"))
                .map(|c| eval_json(c, scope, cx.bag, cx.cache, cx.warnings))
                .unwrap_or(Value::Undefined);
            let branch = if cond.truthy() { "then" } else { "else" };
            match prop_node(props, branch, cx) {
                Some(branch_node) => {
                    let branch_path = format!("{path}/p:{branch}");
                    let children =
                        resolve_node(&branch_node, scope, parent, root, &branch_path, decls, cx);
                    with_transition(children, props.and_then(Transition::from_props))
                }
                None => vec![],
            }
        }
        Some("$each") => {
            let items = props
                .and_then(|p| p.get("items"))
                .map(|i| eval_prop(i, scope, cx))
                .unwrap_or(Value::Undefined);
            let Value::List(rows) = items else {
                // `$each` over a non-list draws nothing (the TS `<For>` over []).
                return vec![];
            };
            let Some(SchemaChild::Node(row_schema)) =
                node.children.as_ref().and_then(|c| c.first())
            else {
                return vec![];
            };
            let as_name = props
                .and_then(|p| p.get("as"))
                .and_then(|a| a.as_str())
                .unwrap_or("item");
            let row_step = step(&step_name(row_schema), 0);
            // The node mounts its own id — it holds the rows' reference
            // memory (`row_ref`) across resolves, so `retain` must keep it.
            cx.live.insert(id.clone());
            cx.parents.insert(id.clone(), parent.clone());
            let keys = each_keys(&rows, &id, cx);
            let mut out = Vec::with_capacity(rows.len());
            for (index, item) in rows.iter().enumerate() {
                let mut row_scope = scope.clone();
                row_scope.bind(as_name, item.clone());
                row_scope.bind("index", Value::from(index));
                row_scope.bind(
                    "prev",
                    if index > 0 {
                        rows[index - 1].clone()
                    } else {
                        Value::Undefined
                    },
                );
                let row_path = format!("{path}/{row_step}#{}", keys[index]);
                out.extend(resolve_node(
                    row_schema, &row_scope, parent, root, &row_path, decls, cx,
                ));
            }
            out
        }
        Some("$animate") => {
            // `$animate` never gates — AnimateRenderer mounts the child
            // either way and drives only visual state (opacity/transform/
            // reveal; a settled reveal draws `display:none`). `condition`'s
            // evaluated value goes to the painter as `open`; no transitions
            // at all is a transparent pass-through.
            let open = props
                .and_then(|p| p.get("condition"))
                .map(|c| eval_json(c, scope, cx.bag, cx.cache, cx.warnings).truthy());
            let children = resolve_children(
                node.children.as_deref(),
                scope,
                parent,
                root,
                &format!("{path}/p:then"),
                decls,
                cx,
            );
            let transition = props
                .and_then(Transition::from_props)
                .map(|t| Transition { open, ..t });
            with_transition(children, transition)
        }
        Some("$agent") => {
            let did = props
                .and_then(|p| p.get("did"))
                .map(|d| eval_json(d, scope, cx.bag, cx.cache, cx.warnings))
                .unwrap_or(Value::Undefined);
            // A did that has not resolved draws nothing (WE's `Show`).
            let Value::Str(did) = did else {
                return vec![];
            };
            if did.is_empty() {
                return vec![];
            }
            let as_name = props
                .and_then(|p| p.get("as"))
                .and_then(|a| a.as_str())
                .unwrap_or("agent");
            let mut row_scope = scope.clone();
            match agent_profile(cx.bag, &did) {
                // A real profile row is live data — its own dependency.
                Some(row) => row_scope.bind(as_name, row),
                // The stub is synthesized per read — a conduit like `local`.
                None => row_scope.bind_conduit(as_name, stub(&did)),
            }
            resolve_children(
                node.children.as_deref(),
                &row_scope,
                parent,
                root,
                path,
                decls,
                cx,
            )
        }
        Some("$part") => {
            let id = props
                .and_then(|p| p.get("id"))
                .and_then(|i| i.as_str())
                .unwrap_or_default();
            match cx.parts.part(id) {
                Some(part_node) => {
                    // The call site goes into the part root — two mounts of
                    // the same part (or one per `$each` row) must not share
                    // NodeIds, locals, or `parents` entries.
                    let site = format!("{root}:{path}");
                    resolve_node(
                        &part_node,
                        scope,
                        parent,
                        &format!("part:{id}@{site}"),
                        "",
                        decls,
                        cx,
                    )
                }
                // The module is not here: a `$part` placeholder carrying the
                // id — PartFrame's stand-in.
                None => {
                    let nid = cx.node_id(root, &format!("{path}/$part"));
                    cx.live.insert(nid.clone());
                    cx.parents.insert(nid.clone(), parent.clone());
                    let mut node_props = IndexMap::new();
                    node_props.insert("id".into(), Value::Str(id.into()));
                    vec![ResolvedChild::Node(Box::new(ResolvedNode {
                        id: nid,
                        ty: "$part".into(),
                        props: node_props,
                        handlers: IndexMap::new(),
                        slot: node.slot.as_deref().map(Into::into),
                        children: Vec::new(),
                        transition: None,
                    }))]
                }
            }
        }
        Some("$panels") => resolve_panels(node, scope, parent, root, path, decls, cx),
        Some("$routes") => resolve_routes(scope, parent, root, path, decls, cx),
        Some("$surface") => {
            // A measuring box that stays a real node — the frontend paints
            // it and reports the box through `ScreenOp::SetSurface`. `as`
            // names the context key (`surface` by default); the value is
            // `{width, tier}`, `createSurface`'s initial `{0, "base"}`
            // until the first measure lands. Nesting shadows: the
            // innermost surface's key wins (SurfaceRenderer).
            let id = cx.node_id(root, path);
            cx.live.insert(id.clone());
            cx.parents.insert(id.clone(), parent.clone());

            let as_key: Arc<str> = props
                .and_then(|p| p.get("as"))
                .and_then(|v| v.as_str())
                .unwrap_or("surface")
                .into();
            let measure =
                cx.screen
                    .surfaces
                    .get(id.as_str())
                    .cloned()
                    .unwrap_or(we_screen::SurfaceMeasure {
                        width: 0.0,
                        tier: "base".into(),
                    });
            let mut surface = IndexMap::new();
            surface.insert("width".into(), Value::Num(measure.width));
            surface.insert("tier".into(), Value::Str(measure.tier.into()));
            let mut surface_scope = node_scope.clone();
            // The same box across resolves until a measure lands — WE's
            // `createSurface` keeps one store alive, and a tracked initial
            // reading `surface` must not see a fresh identity every pass.
            surface_scope.bind_conduit(
                as_key.as_ref(),
                cx.memo_value(
                    format!("$surface:{id}").into(),
                    Value::Obj(Arc::new(surface)),
                ),
            );

            let mut resolved_props = IndexMap::new();
            let mut handlers = IndexMap::new();
            if let Some(props) = props {
                for (key, value) in props {
                    if key == "as" {
                        continue;
                    }
                    if is_event_prop(key) || is_callback_prop(value) {
                        handlers.insert(
                            key.as_str().into(),
                            HandlerRef {
                                tokens: handler_tokens(value),
                                scope: surface_scope.clone(),
                            },
                        );
                    } else {
                        resolved_props
                            .insert(key.as_str().into(), eval_prop(value, &node_scope, cx));
                    }
                }
            }

            let children = resolve_children(
                node.children.as_deref(),
                &surface_scope,
                &id,
                root,
                path,
                &node_decls,
                cx,
            );
            vec![ResolvedChild::Node(Box::new(ResolvedNode {
                id,
                ty: "$surface".into(),
                props: resolved_props,
                handlers,
                slot: node.slot.as_deref().map(Into::into),
                children,
                transition: props.and_then(Transition::from_props),
            }))]
        }
        Some(ty) if ty.starts_with('$') && !(cx.dollar_type)(ty) => {
            // An op this stage does not know: a labelled placeholder node, its
            // children still resolved so something paints. `$`-types the host
            // registered (a `$lane` widget) fall through to the node path.
            let id = cx.node_id(root, path);
            cx.live.insert(id.clone());
            cx.parents.insert(id.clone(), parent.clone());
            let children =
                resolve_children(node.children.as_deref(), scope, &id, root, path, decls, cx);
            vec![ResolvedChild::Node(Box::new(ResolvedNode {
                id,
                ty: format!("$todo:{ty}").into(),
                props: IndexMap::new(),
                handlers: IndexMap::new(),
                slot: node.slot.as_deref().map(Into::into),
                children,
                transition: None,
            }))]
        }
        Some(ty) => {
            let id = cx.node_id(root, path);
            cx.live.insert(id.clone());
            cx.parents.insert(id.clone(), parent.clone());

            let mut resolved_props = IndexMap::new();
            let mut handlers = IndexMap::new();
            if let Some(props) = props {
                for (key, value) in props {
                    if is_event_prop(key) || is_callback_prop(value) {
                        handlers.insert(
                            key.as_str().into(),
                            HandlerRef {
                                tokens: handler_tokens(value),
                                scope: node_scope.clone(),
                            },
                        );
                    } else {
                        resolved_props
                            .insert(key.as_str().into(), eval_prop(value, &node_scope, cx));
                    }
                }
            }

            let mut children = resolve_children(
                node.children.as_deref(),
                &node_scope,
                &id,
                root,
                path,
                &node_decls,
                cx,
            );
            // `slots: {name: node}` — resolve each into a child carrying the
            // slot name, so slot content paints where the widget puts it.
            if let Some(slots) = &node.slots {
                for (name, slot_node) in slots {
                    let slot_path = format!("{path}/s:{name}");
                    for child in resolve_node(
                        slot_node,
                        &node_scope,
                        &id,
                        root,
                        &slot_path,
                        &node_decls,
                        cx,
                    ) {
                        let mut child = child;
                        if let ResolvedChild::Node(n) = &mut child {
                            n.slot = Some(name.as_str().into());
                        }
                        children.push(child);
                    }
                }
            }

            vec![ResolvedChild::Node(Box::new(ResolvedNode {
                id,
                ty: ty.into(),
                props: resolved_props,
                handlers,
                slot: node.slot.as_deref().map(Into::into),
                children,
                transition: props.and_then(Transition::from_props),
            }))]
        }
        // A fragment — no `type`: its children splice in where it sat.
        None => resolve_children(
            node.children.as_deref(),
            scope,
            parent,
            root,
            path,
            decls,
            cx,
        ),
    }
}

/// A node's `$localState` + `$queries` declarations: seeds every field's
/// `initial` (URL > persisted > declared, the `resolveLocalInitial` order),
/// compiles each query, and answers `(scope, decls)` with `local` bound.
fn declare_locals(
    node: &SchemaNode,
    id: &NodeId,
    scope: &Scope,
    decls: &Arc<Vec<LocalScope>>,
    cx: &mut ResolveCx,
) -> (Scope, Arc<Vec<LocalScope>>) {
    let mut fields: IndexMap<Arc<str>, LocalDecl> = IndexMap::new();

    if let Some(local_state) = &node.local_state {
        for (field, spec) in local_state {
            let field: Arc<str> = field.as_str().into();
            let ty: Arc<str> = spec
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("string")
                .into();
            let (declared_initial, initial_deps) = match spec.get("initial") {
                Some(initial) if has_any_token(initial) => {
                    match initial.get("$").and_then(|s| s.as_str()) {
                        Some(source) => {
                            // An expression initial: evaluate with its reads
                            // recorded — `follow_initial` compares this pass's
                            // inputs, not just this pass's value.
                            let (value, deps) =
                                eval_str_tracked(source, scope, cx.bag, cx.cache, cx.warnings);
                            (value, Some(deps))
                        }
                        // `{$query: …}`/`{$invoke: …}` as an initial is not a
                        // value here — `Undefined`, with nothing to track.
                        None => (Value::Undefined, Some(Vec::new())),
                    }
                }
                Some(initial) => (
                    eval_json(initial, scope, cx.bag, cx.cache, cx.warnings),
                    None,
                ),
                None => (Value::Undefined, None),
            };
            let persist_key = local_persist_key(&ty, spec.get("persist").and_then(|p| p.as_str()));
            let sync_param = spec.get("syncParam").cloned().unwrap_or(Json::Null);
            let sync = local_sync_spec(&ty, &sync_param);
            let stored_raw = persist_key
                .as_deref()
                .and_then(|key| cx.screen.prefs.get(key))
                .map(|j| j.to_string());
            let url_raw = sync
                .as_ref()
                .and_then(|(name, _)| cx.screen.nav.param(name));
            let seeded = resolve_local_initial(
                &ty,
                spec.get("persist").and_then(|p| p.as_str()),
                &sync_param,
                &declared_initial,
                stored_raw.as_deref(),
                url_raw,
            );
            cx.locals.seed(id, &field, seeded);
            // A token-object `initial` keeps tracking its source: when the
            // memo's inputs move the field resets to it and `touched`
            // clears — the effect `RenderSchema` mounts next to the signal.
            if let Some(deps) = initial_deps {
                cx.locals
                    .follow_initial(id, &field, declared_initial.clone(), &deps);
            }
            fields.insert(
                field.clone(),
                LocalDecl::State(FieldMeta {
                    ty,
                    persist: spec.get("persist").and_then(|p| p.as_str()).map(Into::into),
                    sync_param: sync_param.clone(),
                    declared_initial,
                }),
            );
        }
    }

    // Forward-declare every query name before `local` binds — a sibling's
    // `local.board` must be a declared read whichever order the queries
    // compile in, exactly as WE's `forward` accessors look the real signal
    // up at read time (`[]`/`false` until it exists).
    let mut slots: IndexMap<Arc<str>, Arc<crate::query::QuerySlot>> = IndexMap::new();
    if let Some(queries) = &node.queries {
        for name in queries.keys() {
            let name: Arc<str> = name.as_str().into();
            let slot = Arc::new(crate::query::QuerySlot::default());
            slots.insert(name.clone(), slot.clone());
            fields.insert(name.clone(), LocalDecl::Query(slot.clone()));
            fields.insert(format!("{name}Loaded").into(), LocalDecl::QueryLoaded(slot));
        }
    }

    // `local` binds before queries compile — a descriptor reads this node's
    // own `$localState` fields and its siblings' slots through it. An
    // explicit-empty `$localState` pushes a field-less scope on purpose:
    // `local.$fields` truncates there (WE assigns `scopeFields` inside
    // `if (node.$localState)`), it does not inherit the enclosing list.
    let mut node_scope = scope.clone();
    let mut node_decls = decls.clone();
    if node.local_state.is_some() || !fields.is_empty() {
        let mut chain = (**decls).clone();
        chain.push(LocalScope {
            node: id.clone(),
            declared_state: node.local_state.is_some(),
            fields,
        });
        node_decls = Arc::new(chain);
        node_scope.bind_conduit(
            "local",
            Value::namespace(LocalNs::new(cx.locals.clone(), node_decls.clone())),
        );
    }

    // Compile each query against `node_scope`, filling its slot. A query
    // whose IR depends on a sibling's cell settles over repeats — and over
    // frames once the sibling's rows land — so the loop compiles until the
    // set of produced cells is stable. An acyclic graph needs at most one
    // round per level plus a quiet round to notice; anything still moving
    // past that is a cycle — keep the last state and warn, never spin.
    if let Some(queries) = &node.queries {
        let max_rounds = queries.len() + 1;
        let mut settled = false;
        for _round in 0..max_rounds {
            let mut changed = false;
            for (name, descriptor) in queries {
                let name: Arc<str> = name.as_str().into();
                let Some(slot) = slots.get(&name) else {
                    continue;
                };
                match compile_query(descriptor, &node_scope, cx.bag, cx.cache, cx.warnings) {
                    Some(compiled) => {
                        let cell = cx.pool.cell(compiled.key.clone(), compiled.ir.clone());
                        cell.note_name(name.clone());
                        if slot.cell().is_none_or(|old| !Arc::ptr_eq(&old, &cell)) {
                            slot.set(cell);
                            changed = true;
                        }
                    }
                    None => {
                        if slot.cell().is_some() {
                            slot.clear();
                            changed = true;
                        }
                    }
                }
            }
            if !changed {
                settled = true;
                break;
            }
        }
        if !settled {
            let message: Arc<str> = format!(
                "$queries at {} did not settle in {max_rounds} rounds — a dependency cycle",
                id.as_str()
            )
            .into();
            if !cx.warnings.iter().any(|w| w == &message) {
                cx.warnings.push(message);
            }
        }
    }
    (node_scope, node_decls)
}

/// `$panels` → a `$lane` node: the lane's own evaluated props plus the
/// resolved sections the placement puts here (open panels whose `home` is
/// this lane), folded per `ShellState`.
fn resolve_panels(
    node: &SchemaNode,
    scope: &Scope,
    parent: &NodeId,
    root: &str,
    path: &str,
    decls: &Arc<Vec<LocalScope>>,
    cx: &mut ResolveCx,
) -> Vec<ResolvedChild> {
    let props = node.props.as_ref();
    let lane = props
        .and_then(|p| p.get("lane"))
        .and_then(|l| l.as_str())
        .unwrap_or_default()
        .to_string();

    // Sections whose declaration's `home` is this lane, `open` by their
    // declaration or by the shell's override.
    let mut children = Vec::new();
    let mut section_count = 0usize;
    if let Some(panels) = cx.panels.and_then(|p| p.as_array()) {
        for decl in panels {
            let Some(map) = decl.as_object() else {
                continue;
            };
            if map.get("home").and_then(|h| h.as_str()) != Some(lane.as_str()) {
                continue;
            }
            let pid = map.get("id").and_then(|i| i.as_str()).unwrap_or_default();
            let open = cx
                .screen
                .shell
                .panels
                .get(pid)
                .map(|p| p.open)
                .unwrap_or_else(|| map.get("open").and_then(|o| o.as_bool()).unwrap_or(true));
            if !open {
                continue;
            }
            section_count += 1;
            let Some(panel_node) = map.get("node").and_then(|n| cx.memo_node(n)) else {
                continue;
            };
            let panel_root = format!("panel:{pid}");
            children.extend(resolve_node(
                &panel_node,
                scope,
                &cx.node_id(root, path),
                &panel_root,
                "",
                decls,
                cx,
            ));
        }
    }

    let collapsed = cx
        .screen
        .shell
        .lanes
        .get(&lane)
        .map(|l| l.collapsed)
        .unwrap_or(false)
        || (props
            .and_then(|p| p.get("foldEmpty"))
            .and_then(|f| f.as_bool())
            .unwrap_or(false)
            && section_count == 0);

    let id = cx.node_id(root, path);
    cx.live.insert(id.clone());
    cx.parents.insert(id.clone(), parent.clone());

    let mut resolved_props = IndexMap::new();
    let mut handlers = IndexMap::new();
    if let Some(props) = props {
        for (key, value) in props {
            if is_event_prop(key) {
                handlers.insert(
                    key.as_str().into(),
                    HandlerRef {
                        tokens: handler_tokens(value),
                        scope: scope.clone(),
                    },
                );
            } else {
                resolved_props.insert(
                    key.as_str().into(),
                    eval_json(value, scope, cx.bag, cx.cache, cx.warnings),
                );
            }
        }
    }
    resolved_props.insert("lane".into(), Value::Str(lane.as_str().into()));
    resolved_props.insert("collapsed".into(), Value::Bool(collapsed));
    if let Some(width) = cx.screen.shell.lanes.get(&lane).and_then(|l| l.width) {
        resolved_props.insert("laneWidth".into(), Value::from(width as f64));
    }

    vec![ResolvedChild::Node(Box::new(ResolvedNode {
        id,
        ty: "$lane".into(),
        props: resolved_props,
        handlers,
        slot: node.slot.as_deref().map(Into::into),
        children,
        transition: None,
    }))]
}

/// `$routes` → the route whose pattern `template_segments` satisfies,
/// resolved; a redirect queues a replace `Navigate` (the resolved tree the
/// redirect lands on arrives next frame). Outside a space the host's own
/// routes answer: `/record/:entity`.
fn resolve_routes(
    scope: &Scope,
    parent: &NodeId,
    root: &str,
    path: &str,
    decls: &Arc<Vec<LocalScope>>,
    cx: &mut ResolveCx,
) -> Vec<ResolvedChild> {
    // Inside a route body, `$routes` is the outlet the router injects —
    // the chain's tail continues here, at this node's own position
    // (`node.type === '$routes'` → `children ?? null`).
    if let Some(tail) = cx.route_tail.last() {
        let tail = tail.clone();
        return resolve_chain(&tail, scope, parent, root, path, decls, cx);
    }

    let segments = cx.screen.nav.template_segments();

    // The host's record route — `/record/:entity` — is mounted beside the
    // template's table, so `record/<Entity>` never reaches the catch-all.
    if segments.first().map(String::as_str) == Some("record") {
        return resolve_record(scope, parent, root, path, decls, cx);
    }

    let Some(routes) = cx.routes else {
        return vec![];
    };
    match match_routes(routes, segments, "") {
        Some(RouteMatch::Chain(chain)) => {
            resolve_chain(&chain, scope, parent, root, path, decls, cx)
        }
        Some(RouteMatch::Redirect {
            mounted,
            to,
            matched,
        }) => {
            // `*` and explicit redirects replace — the address was nobody's
            // page, so it earns no Back entry. A relative `to` climbs from
            // the redirect route's own matched depth — the `from` the
            // router's Navigate resolves it against (`route.resolvePath`).
            cx.ops.push(ScreenOp::Navigate {
                to,
                query: None,
                base_depth: Some(
                    we_screen::template_root_depth(&cx.screen.nav.current_path()) + matched,
                ),
                replace: true,
            });
            // The layouts the redirect matched under stay mounted — only
            // the outlet it fires in is empty this frame — so their locals
            // survive the landing (buildRoutes mounts `Navigate` as the
            // layout route's child, not instead of it).
            resolve_chain(&mounted, scope, parent, root, path, decls, cx)
        }
        None => vec![],
    }
}

/// One chain step: the route's node resolved with `$nav.baseDepth` bound —
/// the route's depth in the address is the base a relative
/// `routeStore.navigate` climbs from (`routeContext` in buildRoutes). Its
/// body resolves with the remaining tail on the stack, so a `{type:
/// "$routes"}` inside it holds the next level.
fn resolve_chain<'a>(
    chain: &[MatchedRoute<'a>],
    scope: &Scope,
    parent: &NodeId,
    root: &str,
    path: &str,
    decls: &Arc<Vec<LocalScope>>,
    cx: &mut ResolveCx<'a>,
) -> Vec<ResolvedChild> {
    let Some((head, tail)) = chain.split_first() else {
        return vec![];
    };
    let depth = we_screen::template_root_depth(&cx.screen.nav.current_path())
        + head.full.split('/').filter(|s| !s.is_empty()).count();
    let mut nav = IndexMap::new();
    nav.insert("baseDepth".into(), Value::Num(depth as f64));
    let mut step_scope = scope.clone();
    let route_path = format!("{path}/r:{}", head.full.trim_start_matches('/'));
    step_scope.bind_conduit(
        "$nav",
        cx.memo_value(
            format!("$nav:{route_path}").into(),
            Value::Obj(Arc::new(nav)),
        ),
    );
    cx.route_tail.push(tail.to_vec());
    let out = resolve_node(
        &head.route.node,
        &step_scope,
        parent,
        root,
        &route_path,
        decls,
        cx,
    );
    cx.route_tail.pop();
    out
}

/// The record route's body (`recordRouteBody`): each `meta.recordViews`
/// candidate in turn — kind-specific first — then the generic page.
fn resolve_record(
    scope: &Scope,
    parent: &NodeId,
    root: &str,
    path: &str,
    decls: &Arc<Vec<LocalScope>>,
    cx: &mut ResolveCx,
) -> Vec<ResolvedChild> {
    let segments = cx.screen.nav.template_segments();
    let entity = segments.get(1).cloned().unwrap_or_default();
    let kind = cx.screen.nav.param("kind").map(|k| k.to_string());

    // Candidates: `Entity:kind` before `Entity` (the view for a kind wins).
    let mut chosen: Option<Arc<SchemaNode>> = None;
    if let Some(views) = cx.record_views {
        if let Some(kind) = &kind {
            if let Some(node) = views
                .get(&format!("{entity}:{kind}"))
                .and_then(|v| record_view_node(v, cx))
            {
                chosen = Some(node);
            }
        }
        if chosen.is_none() {
            chosen = views.get(&entity).and_then(|v| record_view_node(v, cx));
        }
    }
    let record_path = format!("{path}/r:record/{entity}");
    match chosen {
        Some(node) => resolve_node(&node, scope, parent, root, &record_path, decls, cx),
        // The generic page — a host RecordPage stands here in WE; for the
        // offline stage a named placeholder carries the entity.
        None => {
            let nid = cx.node_id(root, &record_path);
            cx.live.insert(nid.clone());
            cx.parents.insert(nid.clone(), parent.clone());
            let mut node_props = IndexMap::new();
            node_props.insert("entity".into(), Value::Str(entity.as_str().into()));
            vec![ResolvedChild::Node(Box::new(ResolvedNode {
                id: nid,
                ty: "$record".into(),
                props: node_props,
                handlers: IndexMap::new(),
                slot: None,
                children: Vec::new(),
                transition: None,
            }))]
        }
    }
}

/// A `meta.recordViews` value — an inline node, or a view id this stage
/// cannot follow (module views are E9's).
fn record_view_node(value: &Json, cx: &mut ResolveCx) -> Option<Arc<SchemaNode>> {
    if value.is_string() {
        return None;
    }
    cx.memo_node(value)
}

/// The resolver's entry point: `node` under `root`'s identity namespace, in
/// `scope` (usually the empty root scope — the store bag supplies the rest).
pub fn resolve(
    node: &SchemaNode,
    root: &str,
    scope: &Scope,
    cx: &mut ResolveCx,
) -> Vec<ResolvedChild> {
    let decls: Arc<Vec<LocalScope>> = Arc::new(Vec::new());
    resolve_node(node, scope, &NodeId::new(""), root, "", &decls, cx)
}
