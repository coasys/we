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

/// `join(list, sep?)` — each element as text; `', '` when the separator is
/// missing or `undefined` (`separator === undefined` — `null` is `''`).
fn join(args: &[Value], _env: &dyn Env) -> Value {
    let list = arg(args, 0);
    let Some(items) = as_list(&list) else {
        return "".into();
    };
    let sep = match args.get(1) {
        None | Some(Value::Undefined) => ", ".to_string(),
        Some(v) => as_text(v),
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

/// `split(text, sep?)` — `asText(text)` cut at `asText(sep)` (`,` when
/// missing or `undefined` — `separator === undefined`, `null` is `''`),
/// each part trimmed, empties dropped.
fn split(args: &[Value], _env: &dyn Env) -> Value {
    let text = as_text(&arg(args, 0));
    let sep = match args.get(1) {
        None | Some(Value::Undefined) => ",".to_string(),
        Some(v) => as_text(v),
    };
    text.split(sep.as_str())
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| p.into())
        .collect::<Vec<Value>>()
        .into()
}

/// `contains(haystack, needle)` — case-INSENSITIVE substring of the `asText`
/// forms (the same test the where-object's `contains` makes): `asText(12)`
/// contains `'2'`, `asText([12])` — `'12'` — contains `'2'`.
fn contains(args: &[Value], _env: &dyn Env) -> Value {
    as_text(&arg(args, 0))
        .to_lowercase()
        .contains(&as_text(&arg(args, 1)).to_lowercase())
        .into()
}

/// `startsWith(text, prefix)` — case-sensitive, on the `asText` forms.
fn starts_with(args: &[Value], _env: &dyn Env) -> Value {
    as_text(&arg(args, 0))
        .starts_with(&as_text(&arg(args, 1)))
        .into()
}

/// `endsWith(text, suffix)` — case-sensitive, on the `asText` forms.
fn ends_with(args: &[Value], _env: &dyn Env) -> Value {
    as_text(&arg(args, 0))
        .ends_with(&as_text(&arg(args, 1)))
        .into()
}

fn trim(args: &[Value], _env: &dyn Env) -> Value {
    as_text(&arg(args, 0)).trim().into()
}

fn lower(args: &[Value], _env: &dyn Env) -> Value {
    as_text(&arg(args, 0)).to_lowercase().into()
}

fn upper(args: &[Value], _env: &dyn Env) -> Value {
    as_text(&arg(args, 0)).to_uppercase().into()
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

/// `round(n, digits?)` — `Math.round(asNumber(n) * factor) / factor` with
/// `factor = 10 ** max(0, floor(asNumber(digits)))`, `functions.ts` verbatim.
/// A negative or fractional digit count floors and clamps to 0 first, so
/// `round(123.45, -1)` is `123`, not `120`.
fn round(args: &[Value], _env: &dyn Env) -> Value {
    let n = arg(args, 0).to_number();
    let digits = arg(args, 1).to_number().floor().max(0.0);
    let factor = if digits > 308.0 {
        // `10 ** 309` overflows f64, as `10 **` does in JavaScript.
        f64::INFINITY
    } else {
        10f64.powi(digits as i32)
    };
    (js_round(n * factor) / factor).into()
}

/// `Math.round` — `floor(x + 0.5)` halves toward +∞, but a zero result keeps
/// `x`'s sign (`Math.round(-0.1)` is `-0`, not `+0`), and a non-finite `x`
/// rounds to itself.
fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let rounded = (x + 0.5).floor();
    if rounded == 0.0 && x.is_sign_negative() {
        -0.0
    } else {
        rounded
    }
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
/// `$localMetaEntry` records.
fn local_meta(env: &dyn Env) -> Value {
    env.root("$localMeta").unwrap_or(Value::Undefined)
}

/// `meta(env)?.[asText(field)]` — the one read every form function makes of
/// its argument: the field argument is text, missing or not (a missing
/// argument names `''`, a number `'5'` — there is no aggregate reading).
fn field_entry(env: &dyn Env, field: &Value) -> Option<Value> {
    match local_meta(env) {
        Value::Obj(meta) => meta.get(field.to_text().as_ref()).cloned(),
        _ => None,
    }
}

/// `touched(field)` — whether the named field has been blurred or marked
/// with `$touch`; false for a field the meta bag does not hold.
fn touched(args: &[Value], env: &dyn Env) -> Value {
    field_entry(env, &arg(args, 0))
        .map(|e| prop_truthy(&e, "touched"))
        .unwrap_or(false)
        .into()
}

/// `valid(field)` — the named field has no errors, touched or not. True for
/// a field the meta bag does not hold.
fn valid(args: &[Value], env: &dyn Env) -> Value {
    field_entry(env, &arg(args, 0))
        .map(|e| field_errors(&e).is_empty())
        .unwrap_or(true)
        .into()
}

/// `error(field)` — the named field's first error once touched, `''` when
/// clean or untouched.
fn error(args: &[Value], env: &dyn Env) -> Value {
    field_entry(env, &arg(args, 0))
        .filter(|e| prop_truthy(e, "touched"))
        .and_then(|e| field_errors(&e).first().cloned())
        .unwrap_or_else(|| "".into())
}

/// `formValid()` — every field `$localScopeFields` names is error-free;
/// touched is not required. With no meta map or no scope list at all, true
/// (`!map || !fields` in `functions.ts`), so an empty scope list iterates
/// nothing and a bad field outside the scope does not count.
fn form_valid(_args: &[Value], env: &dyn Env) -> Value {
    let Value::Obj(meta) = local_meta(env) else {
        return true.into();
    };
    let Some(Value::List(fields)) = env.root("$localScopeFields") else {
        return true.into();
    };
    fields
        .iter()
        .all(|field| {
            meta.get(field.to_text().as_ref())
                .map(|e| field_errors(e).is_empty())
                // `map[name]?.errors().length ?? 0` — a missing entry is valid.
                .unwrap_or(true)
        })
        .into()
}

/// `entry.prop()` — the form functions invoke their meta members directly
/// (`entry.touched()`), not through `readValue`. A member that is not a
/// callable answers `Undefined`, as the call would in JavaScript.
fn call_prop(entry: &Value, prop: &str) -> Value {
    match entry {
        Value::Obj(e) => match e.get(prop) {
            Some(Value::Callable(c)) => c.call(&[]),
            _ => Value::Undefined,
        },
        _ => Value::Undefined,
    }
}

fn prop_truthy(entry: &Value, prop: &str) -> bool {
    call_prop(entry, prop).truthy()
}

fn field_errors(entry: &Value) -> Vec<Value> {
    match call_prop(entry, "errors") {
        Value::List(l) => l.iter().cloned().collect(),
        _ => Vec::new(),
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
