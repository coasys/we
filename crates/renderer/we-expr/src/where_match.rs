//! `matches_where` — the where-object matcher from `where.ts`, used by the
//! `filter`/`find`/`count` built-ins and by `we-store`'s query layer.
//!
//! A where-object's keys are field names (with `OR`/`AND`/`NOT` reserved);
//! a field's condition is an exact value, a set, or an operator object:
//! `{not}`, `{contains}` (case-insensitive), `{startsWith}`/`{endsWith}`
//! (case-sensitive), `{exists}`, and `{lt|lte|gt|gte}` range bounds which
//! compare only same-type numbers or same-type strings.
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
/// the match object. Non-object inputs never match.
pub fn matches_where(record: &Value, where_: &Value) -> bool {
    let Value::Obj(where_) = where_ else {
        return false;
    };
    where_.iter().all(|(key, cond)| match key.as_ref() {
        // `{OR: [w1, w2]}` — any sub-where matches.
        "OR" => match cond {
            Value::List(list) => list.iter().any(|w| matches_where(record, w)),
            _ => matches_where(record, cond),
        },
        // `{AND: [w1, w2]}` — every sub-where matches.
        "AND" => match cond {
            Value::List(list) => list.iter().all(|w| matches_where(record, w)),
            _ => matches_where(record, cond),
        },
        // `{NOT: w}` — the sub-where does not match.
        "NOT" => !matches_where(record, cond),
        key => match_field(read_field(record, key), cond),
    })
}

/// `readField` — a record's own key; absent (and any non-object) is
/// `Undefined`.
fn read_field<'a>(record: &'a Value, key: &str) -> &'a Value {
    match record {
        Value::Obj(o) => o.get(key).unwrap_or(&Value::Undefined),
        _ => &Value::Undefined,
    }
}

/// One field's condition.
fn match_field(actual: &Value, cond: &Value) -> bool {
    match cond {
        // An operator object — every present operator must hold.
        Value::Obj(ops) => ops.iter().all(|(op, arg)| match op.as_ref() {
            "not" => match arg {
                Value::List(list) => !list.iter().any(|v| same_value_zero(v, actual)),
                _ => !actual.strict_eq(arg),
            },
            "contains" => as_text(actual)
                .to_lowercase()
                .contains(&as_text(arg).to_lowercase()),
            "startsWith" => as_text(actual).starts_with(&as_text(arg)),
            "endsWith" => as_text(actual).ends_with(&as_text(arg)),
            "exists" => {
                let present = !matches!(actual, Value::Undefined | Value::Null);
                arg.truthy() == present
            }
            "lt" => range_compare(actual, arg) == Some(std::cmp::Ordering::Less),
            "lte" => matches!(
                range_compare(actual, arg),
                Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
            ),
            "gt" => range_compare(actual, arg) == Some(std::cmp::Ordering::Greater),
            "gte" => matches!(
                range_compare(actual, arg),
                Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
            ),
            _ => false,
        }),
        // A set — membership by SameValueZero.
        Value::List(list) => list.iter().any(|v| same_value_zero(v, actual)),
        // An exact value — strict equality.
        _ => actual.strict_eq(cond),
    }
}

/// `rangeCompare`: only same-type numbers or same-type strings compare —
/// anything else is no ordering at all.
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
