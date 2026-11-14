//! `matches_where` — the where-object matcher from `where.ts`, used by the
//! `filter`/`find`/`count` built-ins and by `we-data`'s query layer.
//!
//! A where-object's keys are field names (with `OR`/`AND`/`NOT` reserved);
//! a field's condition is an exact value, a set, or an operator object.
//! Operator objects resolve in `where.ts`'s family order — `exists`, then
//! `contains`, then `lt|lte|gt|gte` bounds, then `startsWith`/`endsWith`,
//! then `not` — the first family present answers alone, unrecognised keys
//! are ignored, and a record with no family at all is a strict-equality
//! test. Field reads go through the same denied-names guard as every other
//! property read.
use crate::Value;

/// `asText` — a value as the text a where-match compares: strings pass
/// through; numbers and everything else go through the `to_text` conversion
/// (which is JavaScript's number formatting).
pub fn as_text(value: &Value) -> String {
    match value {
        Value::Str(s) => s.to_string(),
        _ => value.to_text().to_string(),
    }
}

/// Does `record` satisfy `where`? `record` is the candidate object; `where`
/// the match object. Callers guard `isRecord` themselves, as `filter` does —
/// a non-record `where` never matches here.
pub fn matches_where(record: &Value, where_: &Value) -> bool {
    let Value::Obj(where_) = where_ else {
        return false;
    };
    where_.iter().all(|(key, cond)| match key.as_ref() {
        // `{OR: [w1, w2]}` — any *record* branch matches. A non-list operand
        // fails the key outright.
        "OR" => match cond {
            Value::List(list) => list
                .iter()
                .any(|branch| matches!(branch, Value::Obj(_)) && matches_where(record, branch)),
            _ => false,
        },
        // `{AND: [w1, w2]}` — every *record* branch matches.
        "AND" => match cond {
            Value::List(list) => list
                .iter()
                .all(|branch| matches!(branch, Value::Obj(_)) && matches_where(record, branch)),
            _ => false,
        },
        // `{NOT: w}` — `w` is a record that does not match.
        "NOT" => matches!(cond, Value::Obj(_)) && !matches_where(record, cond),
        key => match_field(&read_field(record, key), cond),
    })
}

/// `readField` — a record's own key, or `Undefined` for a denied name, an
/// absent key, or a non-record. A list reads `length` and canonical numeric
/// keys, as a JS array does for `'length' in a`/`'0' in a`.
fn read_field(record: &Value, key: &str) -> Value {
    if crate::DENIED_PROPERTIES.contains(&key) {
        return Value::Undefined;
    }
    match record {
        Value::Obj(o) => o.get(key).cloned().unwrap_or(Value::Undefined),
        Value::List(l) => {
            if key == "length" {
                l.len().into()
            } else {
                crate::value::canonical_index(key)
                    .and_then(|i| l.get(i))
                    .cloned()
                    .unwrap_or(Value::Undefined)
            }
        }
        _ => Value::Undefined,
    }
}

/// One field's condition — `where.ts`'s family cascade: the first family
/// present answers alone; a record carrying none is `actual === expected`.
fn match_field(actual: &Value, cond: &Value) -> bool {
    if let Value::Obj(ops) = cond {
        if let Some(exists) = ops.get("exists") {
            let present = !matches!(actual, Value::Undefined | Value::Null);
            return exists.truthy() == present;
        }
        if let Some(needle) = ops.get("contains") {
            return as_text(actual)
                .to_lowercase()
                .contains(&as_text(needle).to_lowercase());
        }
        let bounds: Vec<(&str, &Value)> = ["lt", "lte", "gt", "gte"]
            .into_iter()
            .filter_map(|op| ops.get(op).map(|bound| (op, bound)))
            .collect();
        if !bounds.is_empty() {
            return bounds.iter().all(|(op, bound)| range_op(actual, op, bound));
        }
        let mut anchored = false;
        if let Some(prefix) = ops.get("startsWith") {
            anchored = true;
            if !as_text(actual).starts_with(&as_text(prefix)) {
                return false;
            }
        }
        if let Some(suffix) = ops.get("endsWith") {
            anchored = true;
            if !as_text(actual).ends_with(&as_text(suffix)) {
                return false;
            }
        }
        if anchored {
            return true;
        }
        if let Some(excluded) = ops.get("not") {
            return match excluded {
                Value::List(list) => !list.iter().any(|v| same_value_zero(v, actual)),
                _ => !actual.strict_eq(excluded),
            };
        }
        // No operator family matched — `actual !== expected` for a record
        // can only hold through identity, as in `where.ts`'s fall-through.
        return actual.strict_eq(cond);
    }
    match cond {
        // A set — membership by SameValueZero.
        Value::List(list) => list.iter().any(|v| same_value_zero(v, actual)),
        // An exact value — strict equality.
        _ => actual.strict_eq(cond),
    }
}

/// `rangeCompare(actual, op, bound)`: only same-type numbers or same-type
/// strings compare — anything else matches nothing.
fn range_op(actual: &Value, op: &str, bound: &Value) -> bool {
    match range_compare(actual, bound) {
        Some(ordering) => match op {
            "lt" => ordering == std::cmp::Ordering::Less,
            "lte" => ordering != std::cmp::Ordering::Greater,
            "gt" => ordering == std::cmp::Ordering::Greater,
            "gte" => ordering != std::cmp::Ordering::Less,
            _ => false,
        },
        None => false,
    }
}

/// Number/number or string/string — mixed types have no ordering.
fn range_compare(a: &Value, b: &Value) -> Option<std::cmp::Ordering> {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => x.partial_cmp(y),
        (Value::Str(x), Value::Str(y)) => Some(x.cmp(y)),
        _ => None,
    }
}

/// `includes` membership — `SameValueZero`.
fn same_value_zero(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        _ => a.strict_eq(b),
    }
}
