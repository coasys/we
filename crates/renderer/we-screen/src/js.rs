//! JavaScript's `JSON.stringify`, `String(...)` and `JSON.parse` over
//! [`Value`] — the rules query params and `$localState` mirrors are written
//! in (`localStateSync.ts`, `paramText` in `RouteStore.tsx`).
use we_expr::Value;

/// A canonical integer index: `String(ToUint32(k)) === k`, and not
/// `4294967295` (`u32::MAX` is excluded from the index range in JS). These
/// are the keys JS enumerates before every other string key — `"1"`, `"10"`
/// are indices; `"01"`, `"-1"`, `"1.5"` are not.
fn integer_index(k: &str) -> Option<u32> {
    let i: u32 = k.parse().ok()?;
    (i != u32::MAX && i.to_string() == k).then_some(i)
}

/// `JSON.stringify(value)` — `None` where JS returns `undefined` (an
/// `Undefined` value, a callable, a namespace), so callers can tell "nothing
/// to write" from the text `"null"`. Non-finite numbers write `null`; an
/// object member whose value stringifies to `undefined` is dropped, in a list
/// it writes `null`. Object member order is JS's own-property order:
/// integer indices ascending first, then insertion order.
pub fn js_json_stringify(value: &Value) -> Option<String> {
    match value {
        Value::Undefined => None,
        Value::Null => Some("null".into()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Num(n) => Some(if n.is_finite() {
            value.js_string()
        } else {
            "null".into()
        }),
        Value::Str(s) => Some(serde_json::to_string(s.as_ref()).unwrap_or_default()),
        Value::List(items) => Some(format!(
            "[{}]",
            items
                .iter()
                .map(|e| js_json_stringify(e).unwrap_or_else(|| "null".into()))
                .collect::<Vec<_>>()
                .join(",")
        )),
        Value::Obj(o) => {
            // JS own-property order: canonical integer indices first in
            // ascending numeric order, the rest in insertion order — a stable
            // sort, so non-index keys never move relative to each other.
            let mut members: Vec<_> = o.iter().collect();
            members.sort_by_key(|(k, _)| integer_index(k).map_or((1u8, 0u32), |i| (0u8, i)));
            let parts: Vec<String> = members
                .into_iter()
                .filter_map(|(k, e)| {
                    js_json_stringify(e).map(|s| {
                        format!(
                            "{}:{s}",
                            serde_json::to_string(k.as_ref()).unwrap_or_default()
                        )
                    })
                })
                .collect();
            Some(format!("{{{}}}", parts.join(",")))
        }
        // A function stringifies to `undefined`; a store bag has no JSON form.
        Value::Namespace(_) | Value::Callable(_) => None,
    }
}

/// `JSON.stringify(a) === JSON.stringify(b)` — the comparison `localParamText`
/// runs to see whether a value is back at its declared initial. `None` (JS
/// `undefined`) equals `None`.
pub fn js_json_eq(a: &Value, b: &Value) -> bool {
    js_json_stringify(a) == js_json_stringify(b)
}

/// `paramText` (`RouteStore.tsx:138`) — a query value as address text:
/// strings raw, numbers and booleans via `String(...)`, lists comma-joined,
/// everything else `JSON.stringify` (which reads `undefined` as empty).
pub fn param_text(value: &Value) -> String {
    match value {
        Value::Str(s) => s.to_string(),
        Value::Num(_) | Value::Bool(_) => value.js_string(),
        Value::List(l) => l.iter().map(param_text).collect::<Vec<_>>().join(","),
        other => js_json_stringify(other).unwrap_or_default(),
    }
}

/// `JSON.parse` into a `Value` — literally, with no conformance markers:
/// `{"$number":"5"}` in storage is an object holding a string, not a number.
pub fn plain_value(j: &serde_json::Value) -> Value {
    match j {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
        serde_json::Value::String(s) => Value::Str(s.as_str().into()),
        serde_json::Value::Array(a) => {
            Value::List(std::sync::Arc::new(a.iter().map(plain_value).collect()))
        }
        serde_json::Value::Object(o) => Value::Obj(std::sync::Arc::new(
            o.iter()
                .map(|(k, v)| (k.as_str().into(), plain_value(v)))
                .collect(),
        )),
    }
}
