//! The query string — rule 6 of `screen-state.md`, `queryString` and
//! `readParams` in `RouteStore.tsx:138-157`.
//!
//! Encoding is `URLSearchParams.toString()`'s
//! (`application/x-www-form-urlencoded`): alphanumerics and `*`, `-`, `.`, `_`
//! raw, space as `+`, every other byte `%XX` — then `:` and `/` decoded back,
//! because a record id is a URI and WE writes it legibly.
use indexmap::IndexMap;
use we_expr::Value;

use crate::js::param_text;

/// `new URLSearchParams(search)` into an ordered map: `+` and `%XX` decode, a
/// bare `a` is `a=""`, and a repeated name keeps its first position with its
/// last value — `Object.fromEntries`'s answer.
pub fn parse_query(search: &str) -> IndexMap<String, String> {
    let search = search.strip_prefix('?').unwrap_or(search);
    let mut out = IndexMap::new();
    for pair in search.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        out.insert(form_decode(name), form_decode(value));
    }
    out
}

/// `queryString(values)` (`RouteStore.tsx:145`): entries whose value is
/// `null`, `undefined` or `''` are dropped; the rest are written via
/// `paramText` and encoded. Order is the record's.
pub fn query_string(values: &IndexMap<String, Value>) -> String {
    encode(values.iter().filter_map(|(k, v)| {
        match v {
            Value::Null | Value::Undefined => None,
            Value::Str(s) if s.is_empty() => None,
            // `search.set` keeps an empty *text* — only the raw value decides.
            _ => Some((k.as_str(), param_text(v))),
        }
    }))
}

/// `queryString` over plain string pairs — the `setParam` rebuild of the
/// current params (`new URLSearchParams(params)` then `queryString`): an
/// empty value is dropped the same way.
pub fn query_string_pairs(values: &IndexMap<String, String>) -> String {
    encode(
        values
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, v)| (k.as_str(), v.as_str())),
    )
}

/// One `name=value` pair — `page_identity`'s `?id=…`.
pub fn encode_pair(name: &str, value: &str) -> String {
    encode(std::iter::once((name, value)))
}

/// The location's `?search` — every stored pair written back, empties kept,
/// because the bar itself shows `?a=` for what was opened as `?a=`.
pub fn search_string(params: &IndexMap<String, String>) -> String {
    if params.is_empty() {
        String::new()
    } else {
        format!(
            "?{}",
            encode(params.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        )
    }
}

/// Join `name=value` pairs, then decode `:` and `/` back out of the whole
/// string (`queryString`'s two `replace` calls — a literal `%3A` in a value
/// encodes as `%253A` first, so only real `:`/`/` decode).
fn encode<K, V>(entries: impl Iterator<Item = (K, V)>) -> String
where
    K: AsRef<str>,
    V: AsRef<str>,
{
    entries
        .map(|(k, v)| format!("{}={}", form_encode(k.as_ref()), form_encode(v.as_ref())))
        .collect::<Vec<_>>()
        .join("&")
        .replace("%3A", ":")
        .replace("%2F", "/")
}

/// `application/x-www-form-urlencoded` percent-encoding.
fn form_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b' ' => out.push('+'),
            b'*' | b'-' | b'.' | b'_' | b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// The inverse: `+` decodes to space, `%XX` to its byte; a bare or truncated
/// `%` is literal, as `URLSearchParams` treats it.
fn form_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(hi), Some(lo)) => {
                    out.push(hi << 4 | lo);
                    i += 3;
                }
                _ => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
