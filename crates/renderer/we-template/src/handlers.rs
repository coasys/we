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
//! store map's `screen` rows — while `$setLocal` and friends write through
//! the [`Host`], and `$invoke` answers `Done` or parks a `Pending` the
//! [`crate::Runtime`] completes later.
use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value as Json;
use we_expr::{ParseCache, Value};
use we_screen::{local_write_mirror, template_root_depth, ScreenOp, ScreenState};

use crate::handler::{CallId, HandlerToken};
use crate::resolve::{eval_json, handler_tokens};
use crate::resolved::NodeId;
use crate::{Host, Invoked, LocalState, Scope, StoreBag};

/// A pending `$invoke`: who asked, in which scope, and the lifecycle token
/// lists. [`crate::Runtime::complete`] fires them — `onSuccess`/`onError`
/// with `result` bound, `onFinally` with the plain scope — unless the node
/// has left the tree.
pub struct PendingCall {
    /// The node whose handler raised the call — checked against the live
    /// set before the callbacks run.
    pub node: NodeId,
    pub scope: Scope,
    pub on_success: Option<Json>,
    pub on_error: Option<Json>,
    pub on_finally: Option<Json>,
}

/// Calls awaiting settlement, keyed by the ticket [`Invoked::Pending`]
/// answered.
pub type PendingMap = HashMap<CallId, PendingCall>;

/// What a handler needs to fire.
pub struct HandlerCx<'a> {
    pub host: &'a mut dyn Host,
    pub bag: &'a StoreBag,
    pub locals: &'a LocalState,
    pub cache: &'a mut ParseCache,
    pub screen: &'a mut ScreenState,
    pub pending: &'a mut PendingMap,
    /// The node the handler lives on — a pending call's owner.
    pub node: &'a NodeId,
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
    cx.host.set_local(owner, field, value.clone());
    let Some((ty, persist, sync_param, initial)) = local_decl(scope, field) else {
        return;
    };
    let persist_name = match &persist {
        Value::Str(s) => Some(s.to_string()),
        _ => None,
    };
    let mirror = local_write_mirror(&ty, persist_name.as_deref(), &sync_param, &value, &initial);
    if let Some((key, json)) = mirror.store {
        cx.screen.apply(ScreenOp::SetPref {
            key,
            value: serde_json::from_str(&json).ok(),
        });
    }
    if let Some(param) = mirror.param {
        cx.screen.apply(ScreenOp::SetParam {
            name: param.name,
            value: param.text,
            push: Some(param.push),
        });
    }
}

/// A `$invoke` target's [`ScreenOp`], when it names one — the store map's
/// `screen` rows, in the names a template writes. `None` → the host answers.
fn screen_op(target: &str, args: &[Value], screen: &ScreenState) -> Option<ScreenOp> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Undefined);
    let text = |v: &Value| -> String { v.js_string() };
    match target {
        "routeStore.navigate" => Some(ScreenOp::Navigate {
            to: text(&arg(0)),
            query: None,
            // The template's own root — a relative `to` resolves from it.
            base_depth: Some(template_root_depth(&screen.nav.current_path())),
            replace: false,
        }),
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
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings
                    .push(format!("$setLocal: no $localState in scope for {field:?}").into());
                return;
            };
            if let Some(spec) = merge {
                // `merge:` — shallow-merge evaluated members into the object
                // the field holds (`{...(current ?? {}), ...resolved}` in WE).
                let evaluated = eval_json(spec, scope, cx.bag, cx.cache, cx.warnings);
                let mut merged = match cx.host.get_local(&owner, field) {
                    Value::Obj(o) => (*o).clone(),
                    _ => Default::default(),
                };
                if let Value::Obj(patch) = evaluated {
                    for (k, v) in patch.iter() {
                        merged.insert(k.clone(), v.clone());
                    }
                }
                write_local(scope, &owner, field, Value::Obj(Arc::new(merged)), cx);
            } else {
                let v = value
                    .as_ref()
                    .map(|v| eval_json(v, scope, cx.bag, cx.cache, cx.warnings))
                    .unwrap_or(Value::Undefined);
                write_local(scope, &owner, field, v, cx);
            }
        }
        HandlerToken::ToggleLocal { field, .. } => {
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings
                    .push(format!("$toggleLocal: no $localState in scope for {field:?}").into());
                return;
            };
            let next = !cx.host.get_local(&owner, field).truthy();
            write_local(scope, &owner, field, Value::Bool(next), cx);
        }
        HandlerToken::ToggleLocalIn { field, value, .. } => {
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings
                    .push(format!("$toggleLocalIn: no $localState in scope for {field:?}").into());
                return;
            };
            let member = value
                .as_ref()
                .map(|v| eval_json(v, scope, cx.bag, cx.cache, cx.warnings))
                .unwrap_or(Value::Undefined);
            let current = cx.host.get_local(&owner, field);
            let mut list: Vec<Value> = match current {
                Value::List(l) => (*l).clone(),
                Value::Undefined | Value::Null => vec![],
                other => {
                    cx.warnings.push(
                        format!("$toggleLocalIn: {field:?} holds {other:?}, not an array").into(),
                    );
                    return;
                }
            };
            match list.iter().position(|v| v.strict_eq(&member)) {
                Some(at) => {
                    list.remove(at);
                }
                None => list.push(member),
            }
            write_local(scope, &owner, field, Value::List(Arc::new(list)), cx);
        }
        HandlerToken::CallLocal { field, .. } => {
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings
                    .push(format!("$callLocal: no $localState in scope for {field:?}").into());
                return;
            };
            let event = scope.get("event").cloned().unwrap_or(Value::Undefined);
            match cx.host.get_local(&owner, field) {
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
            // (`resolveResetLocalProp` walks `$localScopeFields`), touched
            // cleared with it — `meta.reset()` in the validation layer.
            for name in scope_fields(scope) {
                let Some(owner) = local_owner(scope, &name) else {
                    continue;
                };
                let initial = local_decl(scope, &name)
                    .map(|(_, _, _, initial)| initial)
                    .unwrap_or(Value::Undefined);
                write_local(scope, &owner, &name, initial, cx);
                cx.locals.untouch(&owner, &name);
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
            // store map's answer for routeStore/shellStore/themeStore.
            if let Some(op) = screen_op(target, &evaluated, cx.screen) {
                cx.screen.apply(op);
                return;
            }
            match cx.host.invoke(target, evaluated) {
                // A sync answer carries no lifecycle (WE: callbacks are a
                // Promise's companions — `result instanceof Promise`).
                Invoked::Done(_) => {}
                Invoked::Pending(id) => {
                    cx.pending.insert(
                        id,
                        PendingCall {
                            node: cx.node.clone(),
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
