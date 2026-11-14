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
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::Value as Json;
use we_expr::{eval, ParseCache, Value};
use we_screen::{local_persist_key, local_sync_spec, resolve_local_initial, ScreenOp, ScreenState};

use crate::handler::HandlerToken;
use crate::node::{JsonMap, RouteNode, SchemaChild, SchemaNode};
use crate::query::{compile_query, QueryPool};
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
    /// Parsed sub-schemas, keyed by the address of their raw `Json` —
    /// `$if` branches, panel bodies, and record views are embedded as raw
    /// props/meta and would otherwise re-deserialize on every pass. The
    /// bundle outlives the runtime, so its `Json` addresses are stable.
    pub node_memo: &'a mut HashMap<usize, Arc<SchemaNode>>,
}

impl ResolveCx<'_> {
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

/// The row keys an `$each` list gets: each row's `id` when every row is a
/// plain object with a distinct string/number `id` (WE's `keyable` in
/// keptRows.ts), else the row index — computed once for the whole list, not
/// per row (the all-rows check would make that O(n²)).
fn each_keys(items: &[Value]) -> Vec<String> {
    let mut ids = Vec::with_capacity(items.len());
    let keyed = !items.is_empty() && {
        let mut seen = HashSet::with_capacity(items.len());
        items.iter().all(|item| {
            row_id(item).is_some_and(|id| {
                ids.push(id.clone());
                seen.insert(id)
            })
        })
    };
    if keyed {
        ids
    } else {
        (0..items.len()).map(|i| i.to_string()).collect()
    }
}

fn row_id(item: &Value) -> Option<String> {
    let Value::Obj(o) = item else { return None };
    match o.get("id") {
        Some(Value::Str(s)) => Some(s.to_string()),
        Some(Value::Num(n)) => Some(Value::Num(*n).js_string()),
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
/// object keyed by DID, or a list of rows carrying `did`. Unknown → the
/// `{did}` stub a template can still name (`agent.did` reads it back).
fn agent_profile(bag: &StoreBag, did: &str) -> Value {
    let profiles = bag
        .root("profileStore")
        .and_then(|root| match &root {
            Value::Namespace(ns) => Some(ns.get("profiles")),
            _ => None,
        })
        .unwrap_or(Value::Undefined);
    match &profiles {
        Value::Obj(map) => match map.get(did) {
            Some(row) => row.clone(),
            None => stub(did),
        },
        Value::List(rows) => rows
            .iter()
            .find(|row| {
                matches!(row, Value::Obj(o) if matches!(o.get("did"), Some(Value::Str(d)) if d.as_ref() == did))
            })
            .cloned()
            .unwrap_or_else(|| stub(did)),
        _ => stub(did),
    }
}

fn stub(did: &str) -> Value {
    let mut o = IndexMap::new();
    o.insert("did".into(), Value::Str(did.into()));
    Value::Obj(Arc::new(o))
}

/// A route table match: the route whose pattern the segments satisfy.
///
/// Rules (`routeMatching.ts` + `buildRoutes`): `:` binds any one segment,
/// `*` is the catch-all (only consulted after everything else), a layout
/// route recurses into its own `routes` with the remainder, and a leaf
/// needs the segments spent.
enum RouteMatch<'a> {
    /// A route's node, matched — the accumulated path for the step.
    Node(&'a RouteNode, String),
    /// A `*` or an explicit `redirect` — queue a replace navigation.
    Redirect(String),
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
        let full = format!("{prefix}/{pattern}");
        let rest = &segments[parts.len()..];
        if let Some(redirect) = &route.redirect {
            return Some(RouteMatch::Redirect(resolve_redirect(redirect, prefix)));
        }
        if let Some(children) = route.node.routes.as_deref() {
            if let Some(found) = match_routes(children, rest, &full) {
                return Some(found);
            }
            // A layout route is a page only through one of its own.
            continue;
        }
        if rest.is_empty() {
            return Some(RouteMatch::Node(route, full));
        }
    }
    // No pattern matched: the catch-all, which here means its redirect.
    if let Some(route) = wildcard {
        if let Some(redirect) = &route.redirect {
            return Some(RouteMatch::Redirect(resolve_redirect(redirect, prefix)));
        }
        return Some(RouteMatch::Node(route, format!("{prefix}/*")));
    }
    None
}

/// `redirect` as the `Navigate` op should see it: relative targets
/// (`./`, `../`, bare names) pass through for the Navigator to resolve
/// against the route's base depth (buildRoutes' `parentPath + redirect`),
/// an absolute one goes as written.
fn resolve_redirect(redirect: &str, prefix: &str) -> String {
    if redirect.starts_with('/')
        || redirect.starts_with('.')
        || redirect.starts_with('?')
        || redirect.starts_with('#')
    {
        redirect.to_string()
    } else {
        format!("{prefix}/{redirect}")
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
                .map(|i| eval_json(i, scope, cx.bag, cx.cache, cx.warnings))
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
            let keys = each_keys(&rows);
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
            // Same shape `$if` resolves to, with the transitions attached:
            // the painter plays them; kept rows on exit are its business.
            let cond = props
                .and_then(|p| p.get("condition"))
                .map(|c| eval_json(c, scope, cx.bag, cx.cache, cx.warnings))
                .unwrap_or(Value::Undefined);
            if !cond.truthy() {
                return vec![];
            }
            let children = resolve_children(
                node.children.as_deref(),
                scope,
                parent,
                root,
                &format!("{path}/p:then"),
                decls,
                cx,
            );
            with_transition(children, props.and_then(Transition::from_props))
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
            row_scope.bind(as_name, agent_profile(cx.bag, &did));
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
                Some(part_node) => resolve_node(
                    &part_node,
                    scope,
                    parent,
                    &format!("part:{id}"),
                    "",
                    decls,
                    cx,
                ),
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
        Some(ty) if ty.starts_with('$') => {
            // An op this stage does not know: a labelled placeholder node, its
            // children still resolved so something paints.
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
            let (node_scope, node_decls) = declare_locals(node, &id, scope, decls, cx);

            let mut resolved_props = IndexMap::new();
            let mut handlers = IndexMap::new();
            if let Some(props) = props {
                for (key, value) in props {
                    if is_event_prop(key) {
                        handlers.insert(
                            key.as_str().into(),
                            HandlerRef {
                                tokens: handler_tokens(value),
                                scope: node_scope.clone(),
                            },
                        );
                    } else {
                        resolved_props.insert(
                            key.as_str().into(),
                            eval_json(value, &node_scope, cx.bag, cx.cache, cx.warnings),
                        );
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
            let declared_initial = match spec.get("initial") {
                Some(initial) => eval_json(initial, scope, cx.bag, cx.cache, cx.warnings),
                None => Value::Undefined,
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

    if let Some(queries) = &node.queries {
        for (name, descriptor) in queries {
            let name: Arc<str> = name.as_str().into();
            match compile_query(descriptor, scope, cx.bag, cx.cache, cx.warnings) {
                Some(compiled) => {
                    let cell = cx.pool.cell(compiled.key.clone(), compiled.ir.clone());
                    cell.note_name(name.clone());
                    fields.insert(name.clone(), LocalDecl::Query(cell.clone()));
                    fields.insert(format!("{name}Loaded").into(), LocalDecl::QueryLoaded(cell));
                }
                None => {
                    fields.insert(name.clone(), LocalDecl::Gated { loaded: false });
                    fields.insert(
                        format!("{name}Loaded").into(),
                        LocalDecl::Gated { loaded: true },
                    );
                }
            }
        }
    }

    let mut node_scope = scope.clone();
    let mut node_decls = decls.clone();
    if !fields.is_empty() {
        let mut chain = (**decls).clone();
        chain.push(LocalScope {
            node: id.clone(),
            fields,
        });
        node_decls = Arc::new(chain);
        node_scope.bind(
            "local",
            Value::namespace(LocalNs::new(cx.locals.clone(), node_decls.clone())),
        );
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
        Some(RouteMatch::Node(route, _matched)) => {
            let route_path = format!("{path}/r:{}", route.path.trim_matches('/'));
            resolve_node(&route.node, scope, parent, root, &route_path, decls, cx)
        }
        Some(RouteMatch::Redirect(to)) => {
            // `*` and explicit redirects replace — the address was nobody's
            // page, so it earns no Back entry.
            cx.ops.push(ScreenOp::Navigate {
                to,
                query: None,
                base_depth: Some(we_screen::template_root_depth(
                    &cx.screen.nav.current_path(),
                )),
                replace: true,
            });
            vec![]
        }
        None => vec![],
    }
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
