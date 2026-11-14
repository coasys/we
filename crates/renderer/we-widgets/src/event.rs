//! Event payloads — the only shapes a widget may hand to `cx.emit`.
//!
//! Every builder answers the value the bundle's handlers actually read
//! (verified against `bundles/coasys.bundle.json` and the TS sources —
//! see the E5b notes for the table):
//!
//! | widget | handler | reads |
//! |---|---|---|
//! | we-input / we-textarea | onInput, onChange | `event.detail` — the text |
//! | we-input | onKeyDown | `event.detail.key`, `.code`, `.isComposing` |
//! | we-select / we-switch / we-slider / we-number-input | onChange (onInput for the slider) | `event.detail` |
//! | we-date-picker / we-color-picker / we-icon-picker | onChange | `event.detail` |
//! | we-sortable | onReorder | `arg.detail` — the id list |
//! | DropdownMenu | onSelect | `arg` — the item itself, not `arg.detail` |
//! | we-modal | close / onClose | — (`{}`) |
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;

fn obj(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Obj(Arc::new(
        pairs
            .into_iter()
            .map(|(k, v)| (k.into(), v))
            .collect::<IndexMap<Arc<str>, Value>>(),
    ))
}

/// `{detail: <payload>}` — the `CustomEvent` envelope every `change`/`input`
/// handler in the bundle reads (`event.detail`).
pub fn detail(payload: Value) -> Value {
    obj([("detail", payload)])
}

/// `{detail: "…"}` — text events: `onInput`, `onChange`.
pub fn detail_str(text: &str) -> Value {
    detail(Value::Str(text.into()))
}

/// `{detail: true}` — `we-switch`'s `onChange`.
pub fn detail_bool(value: bool) -> Value {
    detail(Value::Bool(value))
}

/// `{detail: 3}` — `we-slider`/`we-number-input` numeric changes.
pub fn detail_num(value: f64) -> Value {
    detail(Value::Num(value))
}

/// `{detail: ["a","b"]}` — `we-sortable`'s `onReorder`: the ids in their new
/// order.
pub fn detail_ids(ids: Vec<String>) -> Value {
    detail(Value::List(Arc::new(
        ids.into_iter().map(|s| Value::Str(s.into())).collect(),
    )))
}

/// `{detail: {key, code, isComposing}}` — `we-input`'s `onKeyDown`; the
/// bundle reads `event.detail.key == 'Enter' && !event.detail.isComposing`.
pub fn key_down(key: &str, code: &str, is_composing: bool) -> Value {
    detail(obj([
        ("key", Value::Str(key.into())),
        ("code", Value::Str(code.into())),
        ("isComposing", Value::Bool(is_composing)),
    ]))
}

/// The item itself — `DropdownMenu`'s `onSelect` handlers read `arg.id`
/// directly, so the payload is the entry object, not a `detail` wrapper.
pub fn item(entry: Value) -> Value {
    entry
}

/// `{id: "…"}` — the `DropdownMenu` `onSelect` payload a handler reads as
/// `arg.id`.
pub fn item_id(id: impl Into<Arc<str>>) -> Value {
    item(obj([("id", Value::Str(id.into()))]))
}

/// `{}` — a click/close with no payload (`we-modal`'s `close`).
pub fn empty() -> Value {
    obj([])
}
