//! Run [`HandlerToken`]s — the statement layer over local state, the store
//! bag and screen state, fired by a widget event.
//!
//! WE resolves every token at call time, with the callback's event bound
//! (`propResolvers/local.ts`, `conditional.ts`, `invoke.ts`), and so do we:
//! [`run`] binds `event` (and `arg`, the same value) on top of the scope the
//! handler was written in, then walks the token list.
//!
//! `routeStore.*`/`shellStore.*`/`themeStore.*` targets become
//! [`ScreenOp`]s and land on the [`ScreenState`] the caller hands in — the
//! store map's `screen` rows — while `$setLocal` and friends write core's
//! [`LocalState`] directly. Only a domain `$invoke` reaches the [`Host`], as
//! an [`ActionRequest`] under a core-minted call id: it answers `Done`, or
//! `Pending` and the [`crate::Runtime`] runs the lifecycle when its
//! [`crate::Completer`] settles.
use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value as Json;
use we_expr::{ParseCache, Value};
use we_screen::{
    local_persist_key, local_sync_spec, local_write_mirror, template_root_depth, ScreenOp,
    ScreenState,
};

use crate::handler::{CallId, HandlerToken};
use crate::host::{Action, ActionRequest, CallBook, Origin};
use crate::resolve::{eval_json, handler_tokens};
use crate::resolved::NodeId;
use crate::scope::Roots;
use crate::screen_view::{apply_screen, ScreenView};
use crate::{Host, Invoked, LocalState, Scope};
use we_expr::MountCx;

/// A pending `$invoke`: who asked, under which mount, in which scope, and
/// the lifecycle token lists. [`crate::Runtime::complete`] fires them —
/// `onSuccess`/`onError` with `result` bound, `onFinally` with the plain
/// scope — unless the node has left the tree.
pub struct PendingCall {
    /// The node whose handler raised the call. A frame that resolves
    /// without it invalidates the call for good (`Runtime` drops it then),
    /// so a remount under the same id never runs these callbacks.
    pub node: NodeId,
    /// The mount the call started under. The callbacks stamp it — a node
    /// that survives a navigation (the chrome, say) must not let its
    /// `onSuccess` stamp the space the route moved to: the initiating
    /// authority survives into the callback (4.6.3).
    pub mount: MountCx,
    pub scope: Scope,
    pub on_success: Option<Json>,
    pub on_error: Option<Json>,
    pub on_finally: Option<Json>,
}

/// Calls awaiting settlement, keyed by the id core minted for the call the
/// host answered [`Invoked::Pending`].
pub type PendingMap = HashMap<CallId, PendingCall>;

/// What a handler needs to fire.
pub struct HandlerCx<'a> {
    pub host: &'a mut dyn Host,
    /// This mount's root view — handler args and specs evaluate against
    /// the session's own `screen`/legacy bindings, not another session's.
    pub bag: Roots<'a>,
    pub locals: &'a LocalState,
    pub cache: &'a mut ParseCache,
    pub screen: &'a mut ScreenState,
    /// The runtime's live `screen` root — every screen write goes through
    /// [`apply_screen`] so the snapshot the next token reads is current.
    pub view: &'a ScreenView,
    pub pending: &'a mut PendingMap,
    /// Call ids — a [`crate::Completer`] pushes into the session's inbox.
    pub calls: &'a mut CallBook,
    /// The node the handler lives on — a pending call's owner.
    pub node: &'a NodeId,
    /// The mount that node was resolved under — the request's origin:
    /// its stamped tier and space go onto every action the handler
    /// raises (E3c-7; stamping only).
    pub mount: &'a MountCx,
    pub warnings: &'a mut Vec<Arc<str>>,
}

/// The node a local write belongs to — the innermost `$localState` that
/// declared `field` in the handler's scope, found through the `local`
/// namespace's `$owner:<field>` read. `None` → the field is undeclared here
/// (WE warns the same and drops the write).
fn local_owner(scope: &Scope, field: &str) -> Option<NodeId> {
    let Value::Namespace(ns) = scope.get("local")? else {
        return None;
    };
    match ns.get(&format!("$owner:{field}")) {
        Value::Str(id) => Some(NodeId::from(id.as_ref())),
        _ => None,
    }
}

/// Where a `$setLocal`-family write lands: `(owner node, head field,
/// path)`. A field named exactly `field` wins — a literal `draft.title`
/// declaration is written as itself. Otherwise the name splits at the
/// first `.`: the head must be a declared field, found by the normal
/// owner lookup (innermost declaring scope; an explicit-empty
/// `$localState` truncates `$fields` but does not block it), and the tail
/// is a path into the head's value.
fn local_write_target(scope: &Scope, field: &str) -> Option<(NodeId, Arc<str>, Vec<Arc<str>>)> {
    if let Some(owner) = local_owner(scope, field) {
        return Some((owner, field.into(), Vec::new()));
    }
    let (head, tail) = field.split_once('.')?;
    let owner = local_owner(scope, head)?;
    Some((
        owner,
        head.into(),
        tail.split('.').map(Arc::<str>::from).collect(),
    ))
}

/// The field's declaration record — `local.decl(field)` — for the pieces a
/// `Value` cannot carry: the authored initial and the scope it first
/// evaluated in (`$resetLocal`'s call-time evaluation).
fn local_meta(scope: &Scope, field: &str) -> Option<crate::scope::FieldMeta> {
    let Value::Namespace(ns) = scope.get("local")? else {
        return None;
    };
    match ns.decl(field)?.downcast_ref::<crate::scope::LocalDecl>()? {
        crate::scope::LocalDecl::State(meta) => Some(meta.clone()),
        _ => None,
    }
}

/// The field's declared metadata — `local["$decl:<field>"]` — for the
/// persist/URL mirror a write makes.
fn local_decl(scope: &Scope, field: &str) -> Option<(String, Value, serde_json::Value, Value)> {
    let Value::Namespace(ns) = scope.get("local")? else {
        return None;
    };
    let Value::Obj(decl) = ns.get(&format!("$decl:{field}")) else {
        return None;
    };
    let ty = match decl.get("type") {
        Some(Value::Str(s)) => s.to_string(),
        _ => "string".to_string(),
    };
    let persist = decl.get("persist").cloned().unwrap_or(Value::Null);
    let sync_param = decl
        .get("syncParam")
        .map(|v| v.to_json())
        .unwrap_or(Json::Null);
    let initial = decl.get("initial").cloned().unwrap_or(Value::Undefined);
    Some((ty, persist, sync_param, initial))
}

/// `seg` as a list index — all digits (`"0"`, `"12"`), nothing else.
fn digits(seg: &str) -> Option<usize> {
    if !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_digit()) {
        seg.parse().ok()
    } else {
        None
    }
}

/// The value at `path` under `container` — `Undefined` wherever the walk
/// fails (a missing key, an index past `len`, a non-container): merge and
/// the toggles read the slot as empty.
fn read_path(container: &Value, path: &[Arc<str>]) -> Value {
    let mut at = container.clone();
    for seg in path {
        at = match &at {
            Value::Obj(o) => o.get(seg.as_ref()).cloned().unwrap_or(Value::Undefined),
            Value::List(l) => match digits(seg) {
                Some(i) => l.get(i).cloned().unwrap_or(Value::Undefined),
                None => return Value::Undefined,
            },
            _ => return Value::Undefined,
        };
    }
    at
}

/// Why a path write was refused — the warning's reason.
enum PathFail {
    /// A non-container sits on the path (a string, number, bool, null,
    /// namespace, callable — or a named segment on a list).
    NonContainer,
    /// A list index is past `len` — appends land at `len` exactly.
    OutOfBounds,
}

/// `container` with the `path` tail set to `value`, copy-on-write: every
/// container on the path is cloned with the one key replaced, so siblings
/// keep their values and their identities. `Undefined` is a missing slot —
/// intermediates are created as objects. A digit segment indexes a list:
/// it replaces an element or appends at `len`; past `len` refuses. A
/// non-container midway, or a named segment on a list, refuses.
fn write_path(container: &Value, path: &[Arc<str>], value: Value) -> Result<Value, PathFail> {
    let Some((seg, rest)) = path.split_first() else {
        return Ok(value);
    };
    match container {
        Value::Obj(o) => {
            let mut next = (**o).clone();
            let child = if rest.is_empty() {
                value
            } else {
                let slot = next.get(seg.as_ref()).cloned().unwrap_or(Value::Undefined);
                write_path(&slot, rest, value)?
            };
            next.insert(seg.clone(), child);
            Ok(Value::Obj(Arc::new(next)))
        }
        Value::List(l) => {
            let Some(index) = digits(seg) else {
                return Err(PathFail::NonContainer);
            };
            if index > l.len() {
                return Err(PathFail::OutOfBounds);
            }
            let mut next = (**l).clone();
            let child = if rest.is_empty() {
                value
            } else {
                let slot = next.get(index).cloned().unwrap_or(Value::Undefined);
                write_path(&slot, rest, value)?
            };
            if index == next.len() {
                next.push(child);
            } else {
                next[index] = child;
            }
            Ok(Value::List(Arc::new(next)))
        }
        // A missing slot becomes a fresh object (missing intermediates are
        // created as objects, digit segment or not).
        Value::Undefined => write_path(&Value::Obj(Arc::new(Default::default())), path, value),
        _ => Err(PathFail::NonContainer),
    }
}

/// The write every local verb funnels into: `path` empty → `value` is the
/// head's new whole value; otherwise copy-on-write at the path inside
/// `head`'s current value. A refused path warns through `verb` and writes
/// nothing. The whole head then goes through [`write_local`] — the head
/// field is the unit for revision, touch, validation and the mirrors.
fn write_at(
    scope: &Scope,
    owner: &NodeId,
    head: &str,
    path: &[Arc<str>],
    value: Value,
    cx: &mut HandlerCx,
    verb: &str,
) {
    let whole = if path.is_empty() {
        value
    } else {
        let current = cx.locals.get(owner, head);
        match write_path(&current, path, value) {
            Ok(whole) => whole,
            Err(why) => {
                let reason = match why {
                    PathFail::NonContainer => "a non-container sits on the path",
                    PathFail::OutOfBounds => "a list index on the path is past the end",
                };
                cx.warnings
                    .push(format!("${verb}: {head:?} — {reason}; no write").into());
                return;
            }
        }
    };
    write_local(scope, owner, head, whole, cx);
}

/// The scope's `State` field names — `local["$fields"]`.
fn scope_fields(scope: &Scope) -> Vec<String> {
    let Some(Value::Namespace(ns)) = scope.get("local") else {
        return Vec::new();
    };
    match ns.get("$fields") {
        Value::List(items) => items
            .iter()
            .filter_map(|v| match v {
                Value::Str(s) => Some(s.to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Write a local field, then mirror it outward — the storage entry and the
/// URL param a `persist`/`syncParam` declaration asks for (WE's setters do
/// the same through `localWriteMirror`).
fn write_local(scope: &Scope, owner: &NodeId, field: &str, value: Value, cx: &mut HandlerCx) {
    cx.locals.set(owner, field, value.clone());
    let Some((ty, persist, sync_param, initial)) = local_decl(scope, field) else {
        return;
    };
    let persist_name = match &persist {
        Value::Str(s) => Some(s.to_string()),
        _ => None,
    };
    let mirror = local_write_mirror(&ty, persist_name.as_deref(), &sync_param, &value, &initial);
    if let Some((key, json)) = mirror.store {
        apply_screen(
            cx.screen,
            cx.view,
            ScreenOp::SetPref {
                key,
                value: serde_json::from_str(&json).ok(),
            },
        );
    }
    if let Some(param) = mirror.param {
        apply_screen(
            cx.screen,
            cx.view,
            ScreenOp::SetParam {
                name: param.name,
                value: param.text,
                push: Some(param.push),
            },
        );
    }
}

/// `meta.reset()` — the field back to its initial with the mirror REMOVED,
/// not written through the setter: `localStorage.removeItem(persistKey)` and
/// `routeParams.set(name, null)`. Writing the initial into the store would
/// pin it — the next mount restores it even after the template's declared
/// initial moved on.
fn reset_local(scope: &Scope, owner: &NodeId, field: &str, value: Value, cx: &mut HandlerCx) {
    cx.locals.set(owner, field, value);
    cx.locals.untouch(owner, field);
    let Some((ty, persist, sync_param, _)) = local_decl(scope, field) else {
        return;
    };
    let persist_name = match &persist {
        Value::Str(s) => Some(s.to_string()),
        _ => None,
    };
    if let Some(key) = local_persist_key(&ty, persist_name.as_deref()) {
        apply_screen(cx.screen, cx.view, ScreenOp::SetPref { key, value: None });
    }
    if let Some((name, _)) = local_sync_spec(&ty, &sync_param) {
        apply_screen(
            cx.screen,
            cx.view,
            ScreenOp::SetParam {
                name,
                value: None,
                push: None,
            },
        );
    }
}

/// The `$nav.baseDepth` a route step bound — the route's depth in the
/// address, the base a relative navigate climbs from.
fn nav_base_depth(scope: &Scope) -> Option<usize> {
    match scope.get("$nav") {
        Some(Value::Obj(o)) => match o.get("baseDepth") {
            Some(Value::Num(n)) if *n >= 0.0 => Some(*n as usize),
            _ => None,
        },
        _ => None,
    }
}

/// A `$invoke` target's [`ScreenOp`], when it names one — the store map's
/// `screen` rows, in the names a template writes. `None` → the host answers.
fn screen_op(
    target: &str,
    args: &[Value],
    scope: &Scope,
    screen: &ScreenState,
) -> Option<ScreenOp> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Undefined);
    let text = |v: &Value| -> String { v.js_string() };
    match target {
        "routeStore.navigate" => {
            // The options object rides beside `to` — `{query, replace, base}`
            // — and `$nav.baseDepth` merges on top at call time
            // (invoke.ts): the route the handler sits in wins.
            let mut query = None;
            let mut replace = false;
            let mut base = None;
            if let Value::Obj(opts) = arg(1) {
                if let Some(Value::Obj(q)) = opts.get("query") {
                    query = Some(q.iter().map(|(k, v)| (k.to_string(), v.clone())).collect());
                }
                if let Some(Value::Obj(b)) = opts.get("base") {
                    if let Some(Value::Num(d)) = b.get("depth") {
                        base = Some(*d as usize);
                    }
                }
                replace = opts.get("replace").is_some_and(Value::truthy);
            }
            Some(ScreenOp::Navigate {
                to: text(&arg(0)),
                query,
                base_depth: Some(
                    nav_base_depth(scope)
                        .or(base)
                        .unwrap_or_else(|| template_root_depth(&screen.nav.current_path())),
                ),
                replace,
            })
        }
        "routeStore.setParam" | "routeStore.setUrlParam" => Some(ScreenOp::SetParam {
            name: text(&arg(0)),
            value: match arg(1) {
                Value::Null | Value::Undefined => None,
                v => Some(we_screen::param_text(&v)),
            },
            push: None,
        }),
        "routeStore.goBack" | "routeStore.back" => Some(ScreenOp::Back),
        "routeStore.goForward" | "routeStore.forward" => Some(ScreenOp::Forward),
        "shellStore.openShellView" => Some(ScreenOp::OpenShellView {
            id: text(&arg(0)),
            path: match arg(1) {
                Value::Str(s) => Some(s.to_string()),
                _ => None,
            },
        }),
        "shellStore.closeShellView" => Some(ScreenOp::CloseShellView),
        "shellStore.openSpaceSettings" => Some(ScreenOp::OpenSpaceSettings {
            tab: match arg(0) {
                Value::Str(s) => Some(s.to_string()),
                _ => None,
            },
            focus: match arg(1) {
                Value::Str(s) => Some(s.to_string()),
                _ => None,
            },
        }),
        "shellStore.toggleSpaceSettings" => Some(ScreenOp::ToggleSpaceSettings),
        "shellStore.openTemplatePanel" => Some(ScreenOp::OpenTemplatePanel { id: text(&arg(0)) }),
        "shellStore.closeTemplatePanel" => Some(ScreenOp::CloseTemplatePanel { id: text(&arg(0)) }),
        "shellStore.setLaneCollapsed" => Some(ScreenOp::SetLaneCollapsed {
            lane: text(&arg(0)),
            collapsed: arg(1).truthy(),
        }),
        // A width that is not a number is stored as nothing (`set_lane_width`
        // refuses non-finite), as the TS guard does.
        "shellStore.setLaneWidth" => Some(ScreenOp::SetLaneWidth {
            lane: text(&arg(0)),
            width: match arg(1) {
                Value::Num(width) => width,
                _ => f64::NAN,
            },
        }),
        "shellStore.setCreateSpaceOpen" => Some(ScreenOp::SetDialog {
            name: "create_space".to_string(),
            open: arg(0).truthy(),
        }),
        "shellStore.setJoinSpaceOpen" => Some(ScreenOp::SetDialog {
            name: "join_space".to_string(),
            open: arg(0).truthy(),
        }),
        "shellStore.resetTemplateLayout" => Some(ScreenOp::ResetTemplateLayout),
        "themeStore.setCurrentTheme" => Some(ScreenOp::SetCurrentTheme {
            theme: text(&arg(0)),
        }),
        _ => None,
    }
}

/// One token's work, with `event` in scope.
fn run_token(token: &HandlerToken, scope: &Scope, cx: &mut HandlerCx) {
    match token {
        HandlerToken::SetLocal {
            field,
            value,
            merge,
            ..
        } => {
            let Some((owner, head, path)) = local_write_target(scope, field) else {
                cx.warnings
                    .push(format!("$setLocal: no $localState in scope for {field:?}").into());
                return;
            };
            if let Some(spec) = merge {
                // `merge:` — shallow-merge evaluated members into the object
                // the slot holds (`{...(current ?? {}), ...resolved}` in WE).
                let evaluated = eval_json(spec, scope, cx.bag, cx.cache, cx.warnings);
                let slot = if path.is_empty() {
                    cx.locals.get(&owner, &head)
                } else {
                    read_path(&cx.locals.get(&owner, &head), &path)
                };
                let mut merged = match slot {
                    Value::Obj(o) => (*o).clone(),
                    _ => Default::default(),
                };
                if let Value::Obj(patch) = evaluated {
                    for (k, v) in patch.iter() {
                        merged.insert(k.clone(), v.clone());
                    }
                }
                write_at(
                    scope,
                    &owner,
                    &head,
                    &path,
                    Value::Obj(Arc::new(merged)),
                    cx,
                    "setLocal",
                );
            } else {
                let v = value
                    .as_ref()
                    .map(|v| eval_json(v, scope, cx.bag, cx.cache, cx.warnings))
                    .unwrap_or(Value::Undefined);
                write_at(scope, &owner, &head, &path, v, cx, "setLocal");
            }
        }
        HandlerToken::ToggleLocal { field, .. } => {
            let Some((owner, head, path)) = local_write_target(scope, field) else {
                cx.warnings
                    .push(format!("$toggleLocal: no $localState in scope for {field:?}").into());
                return;
            };
            let slot = if path.is_empty() {
                cx.locals.get(&owner, &head)
            } else {
                read_path(&cx.locals.get(&owner, &head), &path)
            };
            write_at(
                scope,
                &owner,
                &head,
                &path,
                Value::Bool(!slot.truthy()),
                cx,
                "toggleLocal",
            );
        }
        HandlerToken::ToggleLocalIn { field, value, .. } => {
            let Some((owner, head, path)) = local_write_target(scope, field) else {
                cx.warnings
                    .push(format!("$toggleLocalIn: no $localState in scope for {field:?}").into());
                return;
            };
            let member = value
                .as_ref()
                .map(|v| eval_json(v, scope, cx.bag, cx.cache, cx.warnings))
                .unwrap_or(Value::Undefined);
            let slot = if path.is_empty() {
                cx.locals.get(&owner, &head)
            } else {
                read_path(&cx.locals.get(&owner, &head), &path)
            };
            let mut list: Vec<Value> = match slot {
                Value::List(l) => (*l).clone(),
                Value::Undefined | Value::Null => vec![],
                other => {
                    cx.warnings.push(
                        format!("$toggleLocalIn: {field:?} holds {other:?}, not an array").into(),
                    );
                    return;
                }
            };
            // WE removes EVERY equal entry (`list.filter(e => e !== member)`,
            // local.ts) — membership is set-like, so duplicates go together.
            if list.iter().any(|v| v.strict_eq(&member)) {
                list.retain(|v| !v.strict_eq(&member));
            } else {
                list.push(member);
            }
            write_at(
                scope,
                &owner,
                &head,
                &path,
                Value::List(Arc::new(list)),
                cx,
                "toggleLocalIn",
            );
        }
        HandlerToken::CallLocal { field, .. } => {
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings
                    .push(format!("$callLocal: no $localState in scope for {field:?}").into());
                return;
            };
            let event = scope.get("event").cloned().unwrap_or(Value::Undefined);
            match cx.locals.get(&owner, field) {
                Value::Callable(f) => {
                    f.call(&[event]);
                }
                _ => cx
                    .warnings
                    .push(format!("$callLocal: {field:?} is not a function (yet?)").into()),
            }
        }
        HandlerToken::Touch { field, .. } => {
            if field == "$all" {
                for name in scope_fields(scope) {
                    if let Some(owner) = local_owner(scope, &name) {
                        cx.locals.touch(&owner, &name);
                    }
                }
                return;
            }
            match local_owner(scope, field) {
                Some(owner) => cx.locals.touch(&owner, field),
                None => cx
                    .warnings
                    .push(format!("$touch: no $localState in scope for {field:?}").into()),
            }
        }
        HandlerToken::ResetLocal { .. } => {
            // Every field of the innermost declaring scope back to `initial`
            // (`resolveResetLocalProp` walks `$localScopeFields`) with its
            // persist/URL mirror REMOVED — `meta.reset()` in the validation
            // layer. The initial is the authored JSON re-evaluated NOW, in
            // the scope the declaration first read it, against the call-time
            // bag and screen (WE: `resolveInitial(rawInitial)`) — a param a
            // `routeStore.setParam` moved since mount reads its new value,
            // never the value the last resolve left behind.
            for name in scope_fields(scope) {
                let Some(owner) = local_owner(scope, &name) else {
                    continue;
                };
                let initial = match local_meta(scope, &name) {
                    Some(meta) => meta
                        .raw_initial
                        .as_ref()
                        .map(|raw| {
                            eval_json(raw, &meta.initial_scope, cx.bag, cx.cache, cx.warnings)
                        })
                        .unwrap_or(Value::Undefined),
                    None => Value::Undefined,
                };
                reset_local(scope, &owner, &name, initial, cx);
            }
        }
        HandlerToken::Invoke {
            target,
            args,
            on_success,
            on_error,
            on_finally,
            ..
        } => {
            // Args evaluate at call time, with `event` in scope — the same
            // rule WE applies to every handler token (`resolveInvokeProp`).
            let evaluated: Vec<Value> = match args {
                Some(Json::Array(items)) => items
                    .iter()
                    .map(|a| eval_json(a, scope, cx.bag, cx.cache, cx.warnings))
                    .collect(),
                Some(other) => vec![eval_json(other, scope, cx.bag, cx.cache, cx.warnings)],
                None => vec![],
            };
            // A `screen` row applies straight to the screen state — the
            // store map's answer for routeStore/shellStore/themeStore. The
            // view's snapshot refreshes at once: the next token's
            // `screen.params.x` sees the write the way a WE action sees
            // the store's synchronous update.
            if let Some(op) = screen_op(target, &evaluated, scope, cx.screen) {
                apply_screen(cx.screen, cx.view, op);
                return;
            }
            let Some(done) = cx.calls.mint() else {
                // Every call id has been used: refuse rather than reuse one
                // an outstanding call may still hold.
                cx.warnings
                    .push(format!("$invoke {target}: call ids exhausted; not run").into());
                return;
            };
            let call = done.call_id();
            let request = ActionRequest {
                origin: Origin {
                    mount: cx.mount.mount.clone(),
                    node: cx.node.clone(),
                    tier: cx.mount.tier,
                    space: cx.mount.space.clone(),
                },
                action: Action::Invoke {
                    target: target.as_str().into(),
                    args: evaluated,
                },
            };
            match cx.host.act(request, done) {
                // A sync answer carries no lifecycle (WE: callbacks are a
                // Promise's companions — `result instanceof Promise`). The
                // call is settled: a late completion is unknown → ignored.
                Invoked::Done(_) => {}
                Invoked::Pending => {
                    cx.pending.insert(
                        call,
                        PendingCall {
                            node: cx.node.clone(),
                            mount: cx.mount.clone(),
                            scope: scope.clone(),
                            on_success: on_success.clone(),
                            on_error: on_error.clone(),
                            on_finally: on_finally.clone(),
                        },
                    );
                }
            }
        }
        HandlerToken::If {
            condition,
            then,
            else_,
            ..
        } => {
            let met = eval_json(condition, scope, cx.bag, cx.cache, cx.warnings);
            let branch = if met.truthy() { then } else { else_ };
            if let Some(branch) = branch {
                for token in handler_tokens(branch) {
                    run_token(&token, scope, cx);
                }
            }
        }
        other => {
            cx.warnings
                .push(format!("handler token not run this stage: {:?}", other.to_json()).into());
        }
    }
}

/// Fire `tokens` with `event` (and `arg`, the same value) bound on top of
/// the captured scope.
pub fn run(tokens: &[HandlerToken], scope: &Scope, event: Value, cx: &mut HandlerCx) {
    let mut call_scope = scope.clone();
    call_scope.bind("event", event.clone());
    call_scope.bind("arg", event.clone());
    for token in tokens {
        run_token(token, &call_scope, cx);
    }
}

/// A lifecycle chain — `onSuccess`/`onError` with `result` bound (WE:
/// `dispatchActions(token.onSuccess!, { ...context, result: resolved })`),
/// `onFinally` with the plain scope.
pub fn run_lifecycle(tokens_json: &Json, scope: &Scope, result: Option<Value>, cx: &mut HandlerCx) {
    let mut call_scope = scope.clone();
    if let Some(result) = result {
        call_scope.bind("result", result);
    }
    for token in handler_tokens(tokens_json) {
        run_token(&token, &call_scope, cx);
    }
}
