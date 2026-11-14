//! Run [`HandlerToken`]s — the statement layer over local state and the
//! store bag, fired by a widget event.
//!
//! WE resolves every token at call time, with the callback's event bound
//! (`propResolvers/local.ts`, `conditional.ts`, `invoke.ts`), and so do we:
//! [`run`] binds `event` (and `arg`, the same value) on top of the scope the
//! handler was written in, then walks the token list.
//!
//! E3a runs `$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$invoke` (sync
//! `Done` only — `Pending` and the `onSuccess`/`onError`/`onFinally` chain
//! are E3b) and the handler-level `$if`. `$callLocal`, `$touch`,
//! `$resetLocal` and unknown verbs warn and skip.
use std::sync::Arc;

use serde_json::Value as Json;
use we_expr::{ParseCache, Value};

use crate::handler::HandlerToken;
use crate::resolve::{eval_json, handler_tokens};
use crate::resolved::NodeId;
use crate::{Host, Invoked, LocalState, Scope, StoreBag};

/// What a handler needs to fire: the host it writes through, the bag it
/// reads, the local store its `$setLocal`s land in, the parse cache, and a
/// warning sink.
pub struct HandlerCx<'a> {
    pub host: &'a mut dyn Host,
    pub bag: &'a StoreBag,
    pub locals: &'a LocalState,
    pub cache: &'a mut ParseCache,
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

/// One token's work, with `event` in scope.
fn run_token(
    token: &HandlerToken,
    scope: &Scope,
    event: &Value,
    cx: &mut HandlerCx,
) {
    match token {
        HandlerToken::SetLocal {
            field,
            value,
            merge,
            ..
        } => {
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings.push(
                    format!("$setLocal: no $localState in scope for {field:?}").into(),
                );
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
                cx.host.set_local(&owner, field, Value::Obj(Arc::new(merged)));
            } else {
                let v = value
                    .as_ref()
                    .map(|v| eval_json(v, scope, cx.bag, cx.cache, cx.warnings))
                    .unwrap_or(Value::Undefined);
                cx.host.set_local(&owner, field, v);
            }
        }
        HandlerToken::ToggleLocal { field, .. } => {
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings.push(
                    format!("$toggleLocal: no $localState in scope for {field:?}").into(),
                );
                return;
            };
            let next = !cx.host.get_local(&owner, field).truthy();
            cx.host.set_local(&owner, field, Value::Bool(next));
        }
        HandlerToken::ToggleLocalIn { field, value, .. } => {
            let Some(owner) = local_owner(scope, field) else {
                cx.warnings.push(
                    format!("$toggleLocalIn: no $localState in scope for {field:?}").into(),
                );
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
            cx.host.set_local(&owner, field, Value::List(Arc::new(list)));
        }
        HandlerToken::Invoke {
            target, args, ..
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
            match cx.host.invoke(target, evaluated) {
                Invoked::Done(_) => {}
                Invoked::Pending(_) => {
                    cx.warnings.push(
                        format!("$invoke {target:?}: pending calls land in E3b").into(),
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
                    run_token(&token, scope, event, cx);
                }
            }
        }
        other => {
            cx.warnings.push(
                format!("handler token not run this stage: {:?}", other.to_json()).into(),
            );
        }
    }
}

/// Fire `tokens` with `event` (and `arg`, the same value) bound on top of the
/// captured scope.
pub fn run(tokens: &[HandlerToken], scope: &Scope, event: Value, cx: &mut HandlerCx) {
    let mut call_scope = scope.clone();
    call_scope.bind("event", event.clone());
    call_scope.bind("arg", event.clone());
    for token in tokens {
        run_token(token, &call_scope, &event, cx);
    }
}
