//! Handler tokens and the [`Host`] they run against (§3.4 of the plan).
//!
//! A handler is a list of tokens — `$invoke`, `$setLocal`, `$toggleLocal`,
//! `$toggleLocalIn`, `$callLocal`, `$touch`, `$resetLocal`, and the
//! handler-level `$if` (`types.ts`). Their arguments — expressions, nested
//! handler lists — stay as raw [`serde_json::Value`]: a token is data, and the
//! evaluator resolves its parts when it fires, lazily, not at parse time.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use we_expr::Value;

use crate::node::JsonMap;
use crate::resolved::NodeId;

/// One handler token. Unknown verbs land in [`HandlerToken::Other`] verbatim —
/// a token this build does not know is still data, and still round-trips.
#[derive(Debug, Clone)]
pub enum HandlerToken {
    /// `$invoke`: call a store method or host function. `args` is usually an
    /// array; `onSuccess`/`onError`/`onFinally` are handler token lists. All
    /// kept raw.
    Invoke {
        target: String,
        args: Option<serde_json::Value>,
        on_success: Option<serde_json::Value>,
        on_error: Option<serde_json::Value>,
        on_finally: Option<serde_json::Value>,
        extra: JsonMap,
    },
    /// `$setLocal`: write a local field — `value` a literal or expression, or
    /// `merge` an object merged into it.
    SetLocal {
        field: String,
        value: Option<serde_json::Value>,
        merge: Option<serde_json::Value>,
        extra: JsonMap,
    },
    /// `$toggleLocal`: flip a boolean local field.
    ToggleLocal { field: String, extra: JsonMap },
    /// `$toggleLocalIn`: add or remove one value in an array-typed field.
    ToggleLocalIn {
        field: String,
        value: Option<serde_json::Value>,
        extra: JsonMap,
    },
    /// `$callLocal`: call a function-typed local field.
    CallLocal { field: String, extra: JsonMap },
    /// `$touch`: mark a field touched for validation.
    Touch { field: String, extra: JsonMap },
    /// `$resetLocal`: back to `initial`.
    ResetLocal { field: String, extra: JsonMap },
    /// The handler-level `$if`: `condition` is an expression token, `then` and
    /// `else` a handler token or a list of them. Not the node `{ type: "$if" }`.
    If {
        condition: serde_json::Value,
        then: Option<serde_json::Value>,
        else_: Option<serde_json::Value>,
        extra: JsonMap,
    },
    /// A verb this build does not know, kept exactly as written.
    Other(serde_json::Value),
}

impl HandlerToken {
    /// Read one token out of its JSON form.
    pub fn from_json(value: serde_json::Value) -> HandlerToken {
        let serde_json::Value::Object(map) = value else {
            return HandlerToken::Other(value);
        };
        let take = |map: &JsonMap, key: &str| map.get(key).cloned();
        let rest = |map: &JsonMap, named: &[&str]| -> JsonMap {
            map.iter()
                .filter(|(k, _)| !named.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        };
        if let Some(target) = map.get("$invoke").and_then(|v| v.as_str()) {
            return HandlerToken::Invoke {
                target: target.to_string(),
                args: take(&map, "args"),
                on_success: take(&map, "onSuccess"),
                on_error: take(&map, "onError"),
                on_finally: take(&map, "onFinally"),
                extra: rest(
                    &map,
                    &["$invoke", "args", "onSuccess", "onError", "onFinally"],
                ),
            };
        }
        if let Some(field) = map.get("$setLocal").and_then(|v| v.as_str()) {
            return HandlerToken::SetLocal {
                field: field.to_string(),
                value: take(&map, "value"),
                merge: take(&map, "merge"),
                extra: rest(&map, &["$setLocal", "value", "merge"]),
            };
        }
        if let Some(field) = map.get("$toggleLocal").and_then(|v| v.as_str()) {
            return HandlerToken::ToggleLocal {
                field: field.to_string(),
                extra: rest(&map, &["$toggleLocal"]),
            };
        }
        if let Some(field) = map.get("$toggleLocalIn").and_then(|v| v.as_str()) {
            return HandlerToken::ToggleLocalIn {
                field: field.to_string(),
                value: take(&map, "value"),
                extra: rest(&map, &["$toggleLocalIn", "value"]),
            };
        }
        if let Some(field) = map.get("$callLocal").and_then(|v| v.as_str()) {
            return HandlerToken::CallLocal {
                field: field.to_string(),
                extra: rest(&map, &["$callLocal"]),
            };
        }
        if let Some(field) = map.get("$touch").and_then(|v| v.as_str()) {
            return HandlerToken::Touch {
                field: field.to_string(),
                extra: rest(&map, &["$touch"]),
            };
        }
        if let Some(field) = map.get("$resetLocal").and_then(|v| v.as_str()) {
            return HandlerToken::ResetLocal {
                field: field.to_string(),
                extra: rest(&map, &["$resetLocal"]),
            };
        }
        if let Some(serde_json::Value::Object(body)) = map.get("$if") {
            return HandlerToken::If {
                condition: take(body, "condition").unwrap_or(serde_json::Value::Null),
                then: take(body, "then"),
                else_: take(body, "else"),
                extra: rest(body, &["condition", "then", "else"]),
            };
        }
        HandlerToken::Other(serde_json::Value::Object(map))
    }

    /// The token's JSON form, keys in their written order.
    pub fn to_json(&self) -> serde_json::Value {
        let put = |map: &mut JsonMap, key: &str, value: &Option<serde_json::Value>| {
            if let Some(v) = value {
                map.insert(key.to_string(), v.clone());
            }
        };
        let finish = |mut map: JsonMap, extra: &JsonMap| {
            map.extend(extra.clone());
            serde_json::Value::Object(map)
        };
        match self {
            HandlerToken::Invoke {
                target,
                args,
                on_success,
                on_error,
                on_finally,
                extra,
            } => {
                let mut map = JsonMap::new();
                map.insert("$invoke".to_string(), target.clone().into());
                put(&mut map, "args", args);
                put(&mut map, "onSuccess", on_success);
                put(&mut map, "onError", on_error);
                put(&mut map, "onFinally", on_finally);
                finish(map, extra)
            }
            HandlerToken::SetLocal {
                field,
                value,
                merge,
                extra,
            } => {
                let mut map = JsonMap::new();
                map.insert("$setLocal".to_string(), field.clone().into());
                put(&mut map, "value", value);
                put(&mut map, "merge", merge);
                finish(map, extra)
            }
            HandlerToken::ToggleLocal { field, extra } => {
                let mut map = JsonMap::new();
                map.insert("$toggleLocal".to_string(), field.clone().into());
                finish(map, extra)
            }
            HandlerToken::ToggleLocalIn {
                field,
                value,
                extra,
            } => {
                let mut map = JsonMap::new();
                map.insert("$toggleLocalIn".to_string(), field.clone().into());
                put(&mut map, "value", value);
                finish(map, extra)
            }
            HandlerToken::CallLocal { field, extra } => {
                let mut map = JsonMap::new();
                map.insert("$callLocal".to_string(), field.clone().into());
                finish(map, extra)
            }
            HandlerToken::Touch { field, extra } => {
                let mut map = JsonMap::new();
                map.insert("$touch".to_string(), field.clone().into());
                finish(map, extra)
            }
            HandlerToken::ResetLocal { field, extra } => {
                let mut map = JsonMap::new();
                map.insert("$resetLocal".to_string(), field.clone().into());
                finish(map, extra)
            }
            HandlerToken::If {
                condition,
                then,
                else_,
                extra,
            } => {
                let mut body = JsonMap::new();
                body.insert("condition".to_string(), condition.clone());
                put(&mut body, "then", then);
                put(&mut body, "else", else_);
                body.extend(extra.clone());
                let mut map = JsonMap::new();
                map.insert("$if".to_string(), serde_json::Value::Object(body));
                serde_json::Value::Object(map)
            }
            HandlerToken::Other(value) => value.clone(),
        }
    }
}

impl Serialize for HandlerToken {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for HandlerToken {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(HandlerToken::from_json(serde_json::Value::deserialize(
            deserializer,
        )?))
    }
}

/// A pending call's ticket. [`crate::Runtime`]-like code (E3) finishes it
/// later with `complete(call_id, result)` — nothing in the resolver or the
/// widgets blocks on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CallId(pub u64);

/// What `Host::invoke` answered: the call settled already (with an `Ok` or an
/// `Err` value — an error is a value here), or it is pending under a [`CallId`].
#[derive(Debug)]
pub enum Invoked {
    Done(Result<Value, Value>),
    Pending(CallId),
}

/// The host a handler runs against: the store bag's methods, and each node's
/// `$localState`.
///
/// ```
/// use std::collections::HashMap;
/// use we_expr::Value;
/// use we_template::{Host, Invoked, NodeId};
///
/// struct DemoHost {
///     fields: HashMap<String, Value>,
/// }
/// impl Host for DemoHost {
///     fn invoke(&mut self, _target: &str, _args: Vec<Value>) -> Invoked {
///         Invoked::Done(Ok(Value::Null))
///     }
///     fn set_local(&mut self, node: &NodeId, field: &str, value: Value) {
///         self.fields.insert(format!("{}:{field}", node.as_str()), value);
///     }
///     fn get_local(&self, node: &NodeId, field: &str) -> Value {
///         self.fields
///             .get(&format!("{}:{field}", node.as_str()))
///             .cloned()
///             .unwrap_or(Value::Undefined)
///     }
/// }
///
/// let mut host = DemoHost { fields: HashMap::new() };
/// host.set_local(&"n1".into(), "open", true.into());
/// assert!(host.get_local(&"n1".into(), "open").strict_eq(&true.into()));
/// ```
pub trait Host {
    /// Call `target` — a store member like `spaceStore.create` — with `args`.
    fn invoke(&mut self, target: &str, args: Vec<Value>) -> Invoked;
    /// Write `node`'s `$localState` field.
    fn set_local(&mut self, node: &NodeId, field: &str, value: Value);
    /// Read `node`'s `$localState` field; `Undefined` when unset.
    fn get_local(&self, node: &NodeId, field: &str) -> Value;
}
