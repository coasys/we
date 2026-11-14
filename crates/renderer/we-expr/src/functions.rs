//! The built-in function library — `functions.ts` in Rust. Every function is
//! pure and total: a wrong-typed argument answers with the documented empty
//! result (`[]`, `''`, `0`, `false`, `undefined`), never a throw.
//!
//! `lookup` resolves a name to its implementation; the evaluator's dispatcher
//! tries this registry first and delegates unknown names to `Env::call` —
//! `callFunction` in `evaluate.ts`.
use std::sync::Arc;

use indexmap::IndexMap;

use crate::where_match::{as_text, matches_where};
use crate::{Env, Value};

/// A built-in: arguments already evaluated, the environment for the few
/// functions that read context (`touched`, `valid`, `error`, `formValid`).
type BuiltIn = fn(&[Value], &dyn Env) -> Value;

/// The function named `name`, or `None` to delegate to the environment.
pub(crate) fn lookup(name: &str) -> Option<BuiltIn> {
    Some(match name {
        // list
        "count" => count,
        "filter" => filter,
        "find" => find,
        "distinct" => distinct,
        "join" => join,
        "first" => first,
        "last" => last,
        "reverse" => reverse,
        "sum" => sum,
        "min" => min,
        "max" => max,
        "sort" => sort,
        "take" => take,
        "skip" => skip,
        "concat" => concat,
        // text
        "split" => split,
        "contains" => contains,
        "startsWith" => starts_with,
        "endsWith" => ends_with,
        "trim" => trim,
        "lower" => lower,
        "upper" => upper,
        "replace" => replace,
        // number
        "round" => round,
        "floor" => floor,
        "ceil" => ceil,
        "abs" => abs,
        // object
        "pick" => pick,
        "keys" => keys,
        "values" => values,
        // misc
        "plural" => plural,
        "default" => default,
        // form state — read the env's context roots
        "touched" => touched,
        "valid" => valid,
        "error" => error,
        "formValid" => form_valid,
        _ => return None,
    })
}

fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Undefined)
}

fn as_list(v: &Value) -> Option<&[Value]> {
    match v {
        Value::List(l) => Some(l.as_slice()),
        _ => None,
    }
}

// ---------------------------------------------------------------- list ----

/// `count(list)` or `count(list, where)` — a where-object narrows it.
fn count(args: &[Value], _env: &dyn Env) -> Value {
    match as_list(&arg(args, 0)) {
        Some(items) => match args.get(1) {
            Some(w) => items.iter().filter(|i| matches_where(i, w)).count().into(),
            None => items.len().into(),
        },
        None => 0.into(),
    }
}

/// `filter(list, where?, limit?)` — items matching the where-object; a
/// non-object `where` filters nothing, and `limit` truncates.
fn filter(args: &[Value], _env: &dyn Env) -> Value {
    let list = arg(args, 0);
    let Some(items) = as_list(&list) else {
        return Vec::<Value>::new().into();
    };
    let where_ = arg(args, 1);
    let limit = args
        .get(2)
        .map(|v| v.to_number().max(0.0) as usize)
        .unwrap_or(usize::MAX);
    items
        .iter()
        .filter(|i| !matches!(where_, Value::Obj(_)) || matches_where(i, &where_))
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
        .into()
}

/// `find(list, where?)` — first match or `undefined`.
fn find(args: &[Value], _env: &dyn Env) -> Value {
    let list = arg(args, 0);
    let Some(items) = as_list(&list) else {
        return Value::Undefined;
    };
    let where_ = arg(args, 1);
    items
        .iter()
        .find(|i| !matches!(where_, Value::Obj(_)) || matches_where(i, &where_))
        .cloned()
        .unwrap_or(Value::Undefined)
}

/// `distinct(list, list, …)` — the list arguments flattened, first of each
/// kept. The dedupe key is the item's `id` when it is an object that has one
/// (`{id:1, v:'x'}` and `{id:1, v:'y'}` are the same record) and the item
/// itself otherwise (`{id:1}` and `{id:'1'}` stay distinct).
fn distinct(args: &[Value], _env: &dyn Env) -> Value {
    let mut keys: Vec<Value> = Vec::new();
    let mut out: Vec<Value> = Vec::new();
    for a in args {
        if let Value::List(items) = a {
            for item in items.iter() {
                let key = match item {
                    Value::Obj(o) => o.get("id").cloned().unwrap_or_else(|| item.clone()),
                    _ => item.clone(),
                };
                if !keys.iter().any(|v| deep_eq(v, &key)) {
                    keys.push(key);
                    out.push(item.clone());
                }
            }
        }
    }
    out.into()
}

/// `join(list, sep?)` — each element as text; `', '` is the default.
fn join(args: &[Value], _env: &dyn Env) -> Value {
    let list = arg(args, 0);
    let Some(items) = as_list(&list) else {
        return "".into();
    };
    let sep = match args.get(1) {
        Some(Value::Str(s)) => s.to_string(),
        Some(v) => v.to_text().to_string(),
        None => ", ".to_string(),
    };
    items
        .iter()
        .map(|v| v.to_text().to_string())
        .collect::<Vec<_>>()
        .join(&sep)
        .into()
}

/// `first(list, where?)` / `last(list, where?)` — like `find`, from the ends.
fn first(args: &[Value], _env: &dyn Env) -> Value {
    let list = arg(args, 0);
    let Some(items) = as_list(&list) else {
        return Value::Undefined;
    };
    let where_ = arg(args, 1);
    items
        .iter()
        .find(|i| !matches!(where_, Value::Obj(_)) || matches_where(i, &where_))
        .cloned()
        .unwrap_or(Value::Undefined)
}

fn last(args: &[Value], _env: &dyn Env) -> Value {
    let list = arg(args, 0);
    let Some(items) = as_list(&list) else {
        return Value::Undefined;
    };
    let where_ = arg(args, 1);
    items
        .iter()
        .rev()
        .find(|i| !matches!(where_, Value::Obj(_)) || matches_where(i, &where_))
        .cloned()
        .unwrap_or(Value::Undefined)
}

/// `reverse(list)` — a list reversed; anything else is `[]`.
fn reverse(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::List(l) => {
            let mut items = (**l).clone();
            items.reverse();
            items.into()
        }
        _ => Vec::<Value>::new().into(),
    }
}

/// `sum(list)` — `to_number` of each element; a non-list is 0.
fn sum(args: &[Value], _env: &dyn Env) -> Value {
    match as_list(&arg(args, 0)) {
        // `fold(0.0, +)` — NOT `sum::<f64>()`, whose empty identity is `-0.0`.
        Some(items) => items.iter().fold(0.0, |a, v| a + v.to_number()).into(),
        None => 0.into(),
    }
}

/// `min(a, b, …)` / `max(a, b, …)` — over the ARGUMENTS, each `to_number`'d;
/// no arguments is 0.
fn min(args: &[Value], _env: &dyn Env) -> Value {
    if args.is_empty() {
        return 0.into();
    }
    args.iter()
        .map(|v| v.to_number())
        .fold(f64::INFINITY, f64::min)
        .into()
}

fn max(args: &[Value], _env: &dyn Env) -> Value {
    if args.is_empty() {
        return 0.into();
    }
    args.iter()
        .map(|v| v.to_number())
        .fold(f64::NEG_INFINITY, f64::max)
        .into()
}

/// `sort(list)` — numbers ascending, then strings alphabetically, in that
/// grouping; anything else sorts after. A non-list answers `[]`.
fn sort(args: &[Value], _env: &dyn Env) -> Value {
    match as_list(&arg(args, 0)) {
        Some(items) => {
            let mut items = items.to_vec();
            items.sort_by_key(as_text);
            items.into()
        }
        None => Vec::<Value>::new().into(),
    }
}

/// `take(list, n)` / `skip(list, n)`.
fn take(args: &[Value], _env: &dyn Env) -> Value {
    match (as_list(&arg(args, 0)), args.get(1)) {
        (Some(items), Some(n)) => items
            .iter()
            .take(n.to_number().max(0.0) as usize)
            .cloned()
            .collect::<Vec<_>>()
            .into(),
        _ => Vec::<Value>::new().into(),
    }
}

fn skip(args: &[Value], _env: &dyn Env) -> Value {
    match (as_list(&arg(args, 0)), args.get(1)) {
        (Some(items), Some(n)) => items
            .iter()
            .skip(n.to_number().max(0.0) as usize)
            .cloned()
            .collect::<Vec<_>>()
            .into(),
        _ => Vec::<Value>::new().into(),
    }
}

/// `concat(list, ...)` — lists and single values appended in order.
fn concat(args: &[Value], _env: &dyn Env) -> Value {
    let mut out: Vec<Value> = Vec::new();
    for a in args {
        match a {
            Value::List(l) => out.extend(l.iter().cloned()),
            _ => out.push(a.clone()),
        }
    }
    out.into()
}

// ---------------------------------------------------------------- text ----

/// `split(text, sep?)` — `,` default, each part trimmed, empties dropped.
fn split(args: &[Value], _env: &dyn Env) -> Value {
    let text = arg(args, 0);
    let Value::Str(s) = &text else {
        return Vec::<Value>::new().into();
    };
    let sep = args.get(1).map(as_text).unwrap_or_else(|| ",".to_string());
    s.split(sep.as_str())
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| p.into())
        .collect::<Vec<Value>>()
        .into()
}

/// `contains(haystack, needle)` — case-INSENSITIVE substring for text
/// (matching the vectors: `'Prefix Body'` contains `'PREFIX'`), membership
/// for a list.
fn contains(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Str(s) => s
            .to_lowercase()
            .contains(&as_text(&arg(args, 1)).to_lowercase())
            .into(),
        Value::List(l) => l.iter().any(|v| same_value_zero(v, &arg(args, 1))).into(),
        _ => Value::Bool(false),
    }
}

fn starts_with(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Str(s) => s.starts_with(&as_text(&arg(args, 1))).into(),
        _ => Value::Bool(false),
    }
}

fn ends_with(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Str(s) => s.ends_with(&as_text(&arg(args, 1))).into(),
        _ => Value::Bool(false),
    }
}

fn trim(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Str(s) => s.trim().into(),
        _ => "".into(),
    }
}

fn lower(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Str(s) => s.to_lowercase().into(),
        _ => "".into(),
    }
}

fn upper(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Str(s) => s.to_uppercase().into(),
        _ => "".into(),
    }
}

/// `replace(text, from, to)` — `String.replaceAll`.
fn replace(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Str(s) => s
            .replace(&as_text(&arg(args, 1)), &as_text(&arg(args, 2)))
            .into(),
        _ => "".into(),
    }
}

// -------------------------------------------------------------- number ----

/// `round(n, digits?)` — `toFixed`-like decimal rounding (the epsilon nudge
/// makes `2.675` at 2 come out `2.68`) combined with `Math.round`'s
/// half-toward-+∞ rule (`floor(x + 0.5)`, so `-2.5` is `-2`).
fn round(args: &[Value], _env: &dyn Env) -> Value {
    let n = arg(args, 0).to_number();
    let digits = arg(args, 1).to_number();
    let factor = 10f64.powf(digits);
    // `|n| * EPSILON`: an `EPSILON` alone is a half-ulp tie at |n|≥2 and
    // vanishes; a |n|-proportional nudge always lands one ulp toward +∞.
    let nudged = n + n.abs() * f64::EPSILON;
    (((nudged * factor) + 0.5).floor() / factor).into()
}

fn floor(args: &[Value], _env: &dyn Env) -> Value {
    arg(args, 0).to_number().floor().into()
}

fn ceil(args: &[Value], _env: &dyn Env) -> Value {
    arg(args, 0).to_number().ceil().into()
}

fn abs(args: &[Value], _env: &dyn Env) -> Value {
    arg(args, 0).to_number().abs().into()
}

// -------------------------------------------------------------- object ----

/// `pick(obj, [keys])` — the named keys only, in the order given; the denied
/// names are never picked.
fn pick(args: &[Value], _env: &dyn Env) -> Value {
    let Value::Obj(o) = arg(args, 0) else {
        return IndexMap::<Arc<str>, Value>::new().into();
    };
    let mut out = IndexMap::<Arc<str>, Value>::new();
    for k in args.iter().skip(1) {
        let Value::List(list) = k else { continue };
        for item in list.iter() {
            let key = item.to_text();
            if crate::DENIED_PROPERTIES.contains(&key.as_ref()) {
                continue;
            }
            if let Some(v) = o.get(key.as_ref()) {
                out.insert(key, v.clone());
            }
        }
    }
    out.into()
}

/// `keys(obj)` / `values(obj)` — the record's own keys/values, authored order.
fn keys(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Obj(o) => o
            .keys()
            .map(|k| Value::Str(k.clone()))
            .collect::<Vec<_>>()
            .into(),
        _ => Vec::<Value>::new().into(),
    }
}

fn values(args: &[Value], _env: &dyn Env) -> Value {
    match &arg(args, 0) {
        Value::Obj(o) => o.values().cloned().collect::<Vec<_>>().into(),
        _ => Vec::<Value>::new().into(),
    }
}

// ----------------------------------------------------------------- misc ---

/// `plural(n, one, many)` — `Number(n) === 1` picks `one`; anything else,
/// `many`. A list of one number is that number (`Number([1]) === 1`).
fn plural(args: &[Value], _env: &dyn Env) -> Value {
    if arg(args, 0).js_number() == 1.0 {
        arg(args, 1)
    } else {
        arg(args, 2)
    }
}

/// `default(value, fallback)` — `value` unless it is `undefined` or `null`.
fn default(args: &[Value], _env: &dyn Env) -> Value {
    match arg(args, 0) {
        Value::Undefined | Value::Null => arg(args, 1),
        v => v,
    }
}

// ----------------------------------------------------------------- form ---

/// The form functions read the node's `$localMeta` bag: a map from field
/// name to `{touched, errors}` — decoded from the conformance format's
/// `$localMetaEntry` records. `$localScopeFields` scopes them to the fields
/// the local form actually owns.
fn local_meta(env: &dyn Env) -> Value {
    env.root("$localMeta").unwrap_or(Value::Undefined)
}

fn local_scope_fields(env: &dyn Env) -> Vec<Value> {
    match env.root("$localScopeFields") {
        Some(Value::List(l)) => l.iter().cloned().collect(),
        _ => Vec::new(),
    }
}

/// The `$localMeta` entries, scoped to `$localScopeFields` when that root is
/// bound — the same read the TS form functions make of the node context.
fn meta_entries(env: &dyn Env) -> Vec<(Arc<str>, Value)> {
    let Value::Obj(meta) = local_meta(env) else {
        return Vec::new();
    };
    let scope = local_scope_fields(env);
    if scope.is_empty() {
        return meta.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    }
    let mut out = Vec::new();
    for field in &scope {
        let name = field.to_text();
        if let Some(entry) = meta.get(name.as_ref()) {
            out.push((name, entry.clone()));
        }
    }
    out
}

/// `touched()` — every in-scope field has been touched (or named field has).
fn touched(args: &[Value], env: &dyn Env) -> Value {
    match args.first() {
        // `touched('name')` — one field.
        Some(Value::Str(name)) => field_entry(env, name)
            .map(|e| prop_truthy(&e, "touched"))
            .unwrap_or(false)
            .into(),
        _ => {
            let entries = meta_entries(env);
            (!entries.is_empty() && entries.iter().all(|(_, e)| prop_truthy(e, "touched"))).into()
        }
    }
}

/// `valid()` — no in-scope field has errors (or named field has none).
fn valid(args: &[Value], env: &dyn Env) -> Value {
    match args.first() {
        Some(Value::Str(name)) => field_entry(env, name)
            .map(|e| field_errors(&e).is_empty())
            .unwrap_or(true)
            .into(),
        _ => meta_entries(env)
            .iter()
            .all(|(_, e)| field_errors(e).is_empty())
            .into(),
    }
}

/// `error(name?)` — the named field's first error once touched, `''` when
/// clean or untouched. With no name, the first error across the in-scope
/// fields.
fn error(args: &[Value], env: &dyn Env) -> Value {
    match args.first() {
        Some(Value::Str(name)) => field_entry(env, name)
            .filter(|e| prop_truthy(e, "touched"))
            .and_then(|e| field_errors(&e).first().cloned())
            .unwrap_or_else(|| "".into()),
        _ => meta_entries(env)
            .iter()
            .filter(|(_, e)| prop_truthy(e, "touched"))
            .find_map(|(_, e)| field_errors(e).first().cloned())
            .unwrap_or_else(|| "".into()),
    }
}

/// `formValid()` — every in-scope field valid AND touched; no fields at all
/// is vacuously valid.
fn form_valid(args: &[Value], env: &dyn Env) -> Value {
    let _ = args;
    meta_entries(env)
        .iter()
        .all(|(_, e)| prop_truthy(e, "touched") && field_errors(e).is_empty())
        .into()
}

fn field_entry(env: &dyn Env, name: &Arc<str>) -> Option<Value> {
    match local_meta(env) {
        Value::Obj(meta) => meta.get(name.as_ref()).cloned(),
        _ => None,
    }
}

fn prop_truthy(entry: &Value, prop: &str) -> bool {
    match entry {
        Value::Obj(e) => e.get(prop).map(|v| v.truthy()).unwrap_or(false),
        _ => false,
    }
}

fn field_errors(entry: &Value) -> Vec<Value> {
    match entry {
        Value::Obj(e) => match e.get("errors") {
            Some(Value::List(l)) => l.iter().cloned().collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

/// `includes` membership — `SameValueZero`.
fn same_value_zero(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        _ => a.strict_eq(b),
    }
}

/// Structural equality for `distinct`: same shape, same contents; numbers by
/// value (`NaN` counts equal to itself, as `Set` would).
fn deep_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        (Value::List(x), Value::List(y)) => {
            x.len() == y.len() && x.iter().zip(y.iter()).all(|(u, v)| deep_eq(u, v))
        }
        (Value::Obj(x), Value::Obj(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| deep_eq(v, w)))
        }
        _ => a.strict_eq(b),
    }
}
