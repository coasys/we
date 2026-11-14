//! The resolver: [`SchemaNode`] + environment → [`ResolvedNode`] tree.
//!
//! [`resolve`] walks the authored tree once. Structure ops never reach the
//! output — `$if` leaves the branch it picked, `$each` its expanded rows, and
//! an op this stage does not know (`$agent`, `$animate`, `$part`, `$panels`,
//! `$routes`, `$queries`, `$single`) leaves a `ty = "$todo:<op>"` placeholder
//! the paint side draws as a labelled box. Everything else becomes a
//! [`ResolvedNode`]: props evaluated, `on*` props captured as [`HandlerRef`]s
//! against the scope they were written in.
//!
//! Identity: a node's [`NodeId`] is `template_id` + its child path + the
//! `$each` row key, so a re-resolve of an unchanged tree hands back the same
//! ids and [`LocalState`] keyed by them survives.
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::Value as Json;
use we_expr::{eval, ParseCache, Value};

use crate::handler::HandlerToken;
use crate::node::{JsonMap, SchemaChild, SchemaNode};
use crate::resolved::{HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope, Transition};
use crate::scope::{LocalDecl, LocalNs, LocalScope, ScopeEnv, StoreBag};
use crate::{Host, LocalState};

/// What a resolve needs besides the node and the scope: the store bag, the
/// host (it seeds `$localState` initials), the local store, the parse cache,
/// and the bookkeeping the runtime reads back — `live` node ids, the
/// child→parent map, warnings.
pub struct ResolveCx<'a> {
    pub bag: &'a StoreBag,
    pub host: &'a mut dyn Host,
    pub locals: &'a LocalState,
    pub cache: &'a mut ParseCache,
    pub template_id: &'a str,
    /// Every node id this pass produced — `LocalState::retain` drops the rest.
    pub live: &'a mut HashSet<NodeId>,
    /// child → parent, for handler bubbling at dispatch time.
    pub parents: &'a mut HashMap<NodeId, NodeId>,
    /// Resolve-time complaints (a bad expression, a token this stage does not
    /// know). Never fatal.
    pub warnings: &'a mut Vec<Arc<str>>,
    /// `$`-types that are real components (`$lane` is a widget, not a
    /// structure op) — the app answers from its widget registry. Everything
    /// else `$`-prefixed becomes a labelled `$todo:` placeholder.
    pub dollar_type: &'a dyn Fn(&str) -> bool,
}

impl ResolveCx<'_> {
    fn node_id(&self, path: &str) -> NodeId {
        NodeId::new(format!("{}:{path}", self.template_id))
    }
}

/// `true` for the prop names that carry handlers — `on` + an uppercase letter,
/// WE's rule (`isEventProp` in the Solid renderer).
pub(crate) fn is_event_prop(key: &str) -> bool {
    key.len() > 2 && key.starts_with("on") && key.as_bytes()[2].is_ascii_uppercase()
}

/// `true` for any object carrying a `$`-keyed token (`hasAnyToken` in the
/// dispatcher): an expression, a handler token, a query. Objects with none are
/// data and resolve recursively.
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
/// that is not an object (a missing branch is an empty one).
fn prop_node(props: Option<&JsonMap>, key: &str) -> Option<SchemaNode> {
    props
        .and_then(|p| p.get(key))
        .and_then(|v| serde_json::from_value::<SchemaNode>(v.clone()).ok())
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

/// The path step for the `nth` child named `name`: `#key` alone for the first
/// keyed child, `name` + index otherwise.
fn step(name: &str, nth: usize) -> String {
    if name.starts_with('#') && nth == 0 {
        name.to_string()
    } else {
        format!("{name}{nth}")
    }
}

/// The row key an `$each` item gets: its `id` when every row is a plain
/// object with a distinct string/number `id` (WE's `keyable` in keptRows.ts),
/// else the row's index — the same choice the TS side makes between keyed and
/// by-reference rows.
fn each_key(items: &[Value], index: usize) -> String {
    let row_id = |item: &Value| -> Option<String> {
        let Value::Obj(o) = item else { return None };
        match o.get("id") {
            Some(Value::Str(s)) => Some(s.to_string()),
            Some(Value::Num(n)) => Some(Value::Num(*n).js_string()),
            _ => None,
        }
    };
    let keyed = !items.is_empty() && items.iter().all(|item| row_id(item).is_some()) && {
        let mut seen = HashSet::new();
        items.iter().all(|item| seen.insert(row_id(item).unwrap()))
    };
    if keyed {
        row_id(&items[index]).unwrap()
    } else {
        index.to_string()
    }
}

/// Resolve one authored child list into resolved children. `parent` is the
/// resolved node these children hang under — structure ops and fragments
/// pass it through unchanged, so a grandchild's parent is a real node.
fn resolve_children(
    children: Option<&[SchemaChild]>,
    scope: &Scope,
    parent: &NodeId,
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
        out.extend(resolve_node(node, scope, parent, &child_path, decls, cx));
    }
    out
}

/// Resolve `node` at `path` under `scope`. Always answers a child list —
/// structure ops splice theirs in, a real node answers its single
/// [`ResolvedChild::Node`].
fn resolve_node(
    node: &SchemaNode,
    scope: &Scope,
    parent: &NodeId,
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
            match prop_node(props, branch) {
                Some(branch_node) => {
                    let branch_path = format!("{path}/p:{branch}");
                    resolve_node(&branch_node, scope, parent, &branch_path, decls, cx)
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
                let row_path = format!("{path}/{row_step}#{}", each_key(&rows, index));
                out.extend(resolve_node(
                    row_schema, &row_scope, parent, &row_path, decls, cx,
                ));
            }
            out
        }
        Some(ty) if ty.starts_with('$') && !(cx.dollar_type)(ty) => {
            // An op this stage does not know: a labelled placeholder node, its
            // children still resolved so something paints. `$`-types the host
            // registered (a `$lane` widget) fall through to the node path.
            let id = cx.node_id(path);
            cx.live.insert(id.clone());
            cx.parents.insert(id.clone(), parent.clone());
            let children = resolve_children(node.children.as_deref(), scope, &id, path, decls, cx);
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
            let id = cx.node_id(path);
            cx.live.insert(id.clone());
            cx.parents.insert(id.clone(), parent.clone());

            // `$localState` fields: seed `initial` once (against the scope the
            // node was reached in — its own `local` is not in scope yet), then
            // declare them on the `local` the subtree reads.
            let mut fields: IndexMap<Arc<str>, LocalDecl> = IndexMap::new();
            if let Some(local_state) = &node.local_state {
                for (field, spec) in local_state {
                    let field: Arc<str> = field.as_str().into();
                    fields.insert(field.clone(), LocalDecl::State);
                    if let Some(initial) = spec.get("initial") {
                        let seeded = match initial {
                            Json::Object(map)
                                if map.get("$").and_then(|s| s.as_str()).is_some() =>
                            {
                                eval_json(initial, scope, cx.bag, cx.cache, cx.warnings)
                            }
                            literal => Value::from_json(literal),
                        };
                        cx.locals.seed(&id, &field, seeded);
                    }
                }
            }
            // `$queries`: a static answer per field, read-only, plus the
            // `<name>Loaded` companion every query exposes in WE.
            if let Some(queries) = &node.queries {
                for name in queries.keys() {
                    let name: Arc<str> = name.as_str().into();
                    fields.insert(name.clone(), LocalDecl::Query(cx.bag.query(&name)));
                    fields.insert(
                        format!("{name}Loaded").into(),
                        LocalDecl::Query(Value::Bool(true)),
                    );
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
                path,
                &node_decls,
                cx,
            );
            // `slots: {name: node}` — resolve each into a child carrying the
            // slot name, so slot content paints where the widget puts it.
            if let Some(slots) = &node.slots {
                for (name, slot_node) in slots {
                    let slot_path = format!("{path}/s:{name}");
                    for child in
                        resolve_node(slot_node, &node_scope, &id, &slot_path, &node_decls, cx)
                    {
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
        None => resolve_children(node.children.as_deref(), scope, parent, path, decls, cx),
    }
}

/// The resolver's entry point: `node` under `scope` (usually the empty root
/// scope — the store bag supplies the rest).
pub fn resolve(node: &SchemaNode, scope: &Scope, cx: &mut ResolveCx) -> Vec<ResolvedChild> {
    let decls: Arc<Vec<LocalScope>> = Arc::new(Vec::new());
    resolve_node(node, scope, &NodeId::new(""), "", &decls, cx)
}
