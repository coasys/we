//! `$localState` sync rules — `persist` (a device-storage entry) and
//! `syncParam` (a URL query param), which decide a field's mount-time
//! initial and what a write to it mirrors outward. Port of
//! `localStateSync.ts`; the rules are the template contract, so the port is
//! faithful down to the edge cases (screen-state.md §4.4).
use we_expr::Value;

use crate::js::{js_json_eq, js_json_stringify, plain_value};

/// The storage key a `persist`-named field mirrors under —
/// `we-local:<persist>` — or `None` when the field opted out or its type has
/// no JSON form (`file`, `function`). On web the TS also asks whether
/// `localStorage` exists; here the caller's choice of [`PrefStore`] answers
/// that.
pub fn local_persist_key(field_type: &str, persist: Option<&str>) -> Option<String> {
    match persist {
        Some(name) if has_json_form(field_type) => Some(format!("we-local:{name}")),
        _ => None,
    }
}

/// `(name, push)` when the field mirrors into the URL — `None` when it
/// declared no `syncParam` or its type has no URL form. `sync_param` is the
/// declaration as JSON: a bare string is the no-history form,
/// `{name, push?}` the full one (`localSyncSpec`).
pub fn local_sync_spec(field_type: &str, sync_param: &serde_json::Value) -> Option<(String, bool)> {
    if !has_json_form(field_type) {
        return None;
    }
    match sync_param {
        serde_json::Value::String(name) => Some((name.clone(), false)),
        serde_json::Value::Object(_) => {
            let name = sync_param["name"].as_str()?.to_string();
            let push = sync_param["push"].as_bool().unwrap_or(false);
            Some((name, push))
        }
        _ => None,
    }
}

/// A param's text back into a field value (`decodeLocalParam`): `string`
/// fields keep the raw text; everything else is `JSON.parse`, with the raw
/// text as the answer when it does not parse.
pub fn decode_local_param(field_type: &str, raw: &str) -> Value {
    if field_type == "string" {
        return Value::Str(raw.into());
    }
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(j) => plain_value(&j),
        Err(_) => Value::Str(raw.into()),
    }
}

/// A field value into param text (`encodeLocalParam`): `string` fields write
/// `String(value)`; everything else `JSON.stringify` — `None` where JS would
/// produce `undefined`.
pub fn encode_local_param(field_type: &str, value: &Value) -> Option<String> {
    if field_type == "string" {
        Some(value.js_string())
    } else {
        js_json_stringify(value)
    }
}

/// The text a write puts in the param (`localParamText`) — `None`, which
/// clears it, when the value is back at the declared initial (JSON-compared,
/// so `42` matches `"42"`), so a URL holds only what differs from the
/// template's default.
pub fn local_param_text(
    field_type: &str,
    value: &Value,
    declared_initial: &Value,
) -> Option<String> {
    if js_json_eq(value, declared_initial) {
        None
    } else {
        encode_local_param(field_type, value)
    }
}

/// What a write to the field mirrors outward (`localWriteMirror`): the
/// storage entry (always JSON, whatever the field's type) and the param
/// write (`None` text clears; `push` is the spec's resolved policy).
#[derive(Clone, Debug)]
pub struct LocalWriteMirror {
    /// `localStorage.setItem(key, json)` — present when the field persists.
    pub store: Option<(String, String)>,
    /// `routeParams.set(name, text, {push})` — present when the field syncs
    /// to the URL.
    pub param: Option<LocalParamWrite>,
}

/// The URL half of a mirror: the param, its text (`None` clears it) and its
/// history policy.
#[derive(Clone, Debug)]
pub struct LocalParamWrite {
    /// The param name.
    pub name: String,
    /// The text to write — `None` removes the param.
    pub text: Option<String>,
    /// The declaration's `push` — whether the write earns a Back entry.
    pub push: bool,
}

/// `localWriteMirror` — both halves resolved from the declaration.
pub fn local_write_mirror(
    field_type: &str,
    persist: Option<&str>,
    sync_param: &serde_json::Value,
    value: &Value,
    declared_initial: &Value,
) -> LocalWriteMirror {
    let store = local_persist_key(field_type, persist)
        .map(|key| (key, js_json_stringify(value).unwrap_or_default()));
    let param = local_sync_spec(field_type, sync_param).map(|(name, push)| LocalParamWrite {
        name,
        text: local_param_text(field_type, value, declared_initial),
        push,
    });
    LocalWriteMirror { store, param }
}

/// The mount-time initial (`resolveLocalInitial`): the declared `initial`,
/// overridden by the persisted entry (`JSON.parse`; a corrupt entry lets the
/// initial stand), overridden by the URL param.
pub fn resolve_local_initial(
    field_type: &str,
    persist: Option<&str>,
    sync_param: &serde_json::Value,
    initial: &Value,
    stored_raw: Option<&str>,
    url_raw: Option<&str>,
) -> Value {
    let mut value = initial.clone();
    if local_persist_key(field_type, persist).is_some() {
        if let Some(raw) = stored_raw {
            if let Ok(j) = serde_json::from_str::<serde_json::Value>(raw) {
                value = plain_value(&j);
            }
        }
    }
    if local_sync_spec(field_type, sync_param).is_some() {
        if let Some(raw) = url_raw {
            value = decode_local_param(field_type, raw);
        }
    }
    value
}

/// `file` and `function` fields have neither a JSON form nor a URL form —
/// they opt out of both mirrors (`localStateSync.ts:25,37`).
fn has_json_form(field_type: &str) -> bool {
    field_type != "file" && field_type != "function"
}
