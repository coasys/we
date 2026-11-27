//! Authored key order. serde's derive writes a struct's named fields in
//! declaration order and a `#[serde(flatten)]` map last — `{"type": …,
//! "meta": …, "props": …}`, with `meta` interleaved between named fields,
//! would come back as `{"type": …, "props": …, "meta": …}`. Object order
//! reaches the normal form, so it is part of the data. The types that carry
//! a `flatten` therefore record each object's key order in a `key_order`
//! field at parse and honour it at write: `ordered_object` splits an object
//! into `(key order, map)`, `field`/`required` pull the named keys, `rest_of`
//! is the `extra` (or a nested node's body), and `serialize_ordered` writes
//! it all back.
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::node::JsonMap;

/// A whole JSON object, kept in authored order: `(key order, map)`.
pub(crate) fn ordered_object<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<(Vec<String>, JsonMap), D::Error> {
    let map = JsonMap::deserialize(deserializer)?;
    Ok((map.keys().cloned().collect(), map))
}

/// `key` out of the object, deserialized — `None` when absent.
pub(crate) fn field<'de, D, T>(map: &JsonMap, key: &'static str) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    map.get(key)
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(serde::de::Error::custom)
}

/// The same, when the format requires the key.
pub(crate) fn required<'de, D, T>(map: &JsonMap, key: &'static str) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    field::<D, T>(map, key)?.ok_or_else(|| serde::de::Error::missing_field(key))
}

/// The object's keys minus `named`, in authored order — a `flatten`ed
/// `extra`, or the body of a flattened node handed to its own `Deserialize`.
pub(crate) fn rest_of(map: &JsonMap, named: &[&'static str]) -> JsonMap {
    map.iter()
        .filter(|(k, _)| !named.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// `serde_json::to_value` — infallible for the fields these impls take it
/// over (maps, lists, strings, numbers, `Value`s themselves).
pub(crate) fn json<T: Serialize + ?Sized>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).expect("a template field serializes to JSON")
}

/// Push `key → value` when present — the `skip_serializing_if` half of the
/// named-fields list a `serialize` impl builds.
pub(crate) fn push<T: Serialize>(
    named: &mut Vec<(&'static str, serde_json::Value)>,
    key: &'static str,
    value: &Option<T>,
) {
    if let Some(v) = value {
        named.push((key, json(v)));
    }
}

/// The same for a required field — always present.
pub(crate) fn push_required<T: Serialize + ?Sized>(
    named: &mut Vec<(&'static str, serde_json::Value)>,
    key: &'static str,
    value: &T,
) {
    named.push((key, json(value)));
}

/// Write `{named…, rest…}` honouring `order`: every recorded key lands where
/// the author put it — named field or not. Fields set since parsing (no
/// recorded position) append: named in declaration order, then `rest` in map
/// order. `named` carries only the fields that are present.
pub(crate) fn serialize_ordered<S: Serializer>(
    order: &[String],
    named: Vec<(&'static str, serde_json::Value)>,
    rest: &JsonMap,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut out = JsonMap::new();
    let mut emitted = vec![false; named.len()];
    for key in order {
        if let Some(i) = named.iter().position(|(name, _)| *name == key.as_str()) {
            if !emitted[i] {
                out.insert(key.clone(), named[i].1.clone());
                emitted[i] = true;
            }
        } else if let Some(v) = rest.get(key) {
            out.insert(key.clone(), v.clone());
        }
    }
    for ((name, value), done) in named.iter().zip(emitted.iter()) {
        if !done {
            out.insert((*name).to_string(), value.clone());
        }
    }
    for (k, v) in rest {
        if !out.contains_key(k) {
            out.insert(k.clone(), v.clone());
        }
    }
    out.serialize(serializer)
}
