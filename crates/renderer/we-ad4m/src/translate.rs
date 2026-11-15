//! A compiled `$query` ([`QueryIr`]) in the form `perspective.modelQuery`
//! takes — the Rust half of `createAd4mQueryAdapter().lower` in
//! `packages/backend-system/ad4m/src/ad4mAdapter.ts`:
//!
//! - `where` travels as written: the template's where-object is the model's.
//! - `order` (`{ field: dir }`) becomes the `[[field, dir]]` pairs
//!   `prepareModelQueryParams` sends; nested include orders stay objects,
//!   as TS leaves them.
//! - `select` is renamed `properties`, at the root and on every relation
//!   sub-query (`selectAsProperties`) — unrenamed the model returns every
//!   field.
//! - `scope` (`{ anchor, via, anchorId, … }`) resolves to the executor's
//!   `parent`: the anchor's `via` relation looked up in [`Relations`], one
//!   plain step as `{ id, predicate }`, anything bounded as the traverse
//!   form `{ ids, predicate, … }` (`resolveScopeToParent`).
//!
//! What it refuses: an IR carrying an authority-bearing key
//! ([`QueryIr::reserved_key`]), a scope naming a relation the table does not
//! know. An unrecognised extra key is dropped with a warning — the TS
//! adapter's `irToFlatQuery` has no slot for one either.
use ad4m_client::model::ModelQuery;
use serde_json::{Map, Value as Json};
use we_template::QueryIr;

use crate::relations::Relations;

/// `ir` as a model query, with `scope` resolved through `relations`.
pub fn model_query(ir: &QueryIr, relations: &Relations) -> Result<ModelQuery, String> {
    if let Some(key) = ir.reserved_key() {
        return Err(format!("query carries the reserved key {key:?}"));
    }
    let mut q = ModelQuery {
        where_: ir.where_.clone(),
        limit: ir.limit,
        offset: ir.offset,
        properties: ir.select.clone(),
        ..Default::default()
    };
    if let Some(order) = &ir.order {
        q.order = Some(order_pairs(order)?);
    }
    if let Some(include) = &ir.include {
        let Json::Object(map) = include else {
            return Err(format!("include must be an object, got {include}"));
        };
        q.include = Some(select_as_properties(map));
    }
    if let Some(scope) = &ir.scope {
        q.parent = Some(scope_to_parent(scope, relations)?);
    }
    for (key, value) in &ir.extra {
        match key.as_str() {
            "count" => q.count = value.as_bool(),
            other => log::warn!("we-ad4m: query key {other:?} has no modelQuery slot; dropped"),
        }
    }
    Ok(q)
}

/// `{ createdAt: "desc", name: "asc" }` → `[["createdAt","desc"],["name","asc"]]`
/// in authored order (`serde_json` keeps insertion order here).
fn order_pairs(order: &Json) -> Result<Vec<(String, String)>, String> {
    match order {
        Json::Object(map) => map
            .iter()
            .map(|(k, v)| match v.as_str() {
                Some(dir) => Ok((k.clone(), dir.to_string())),
                None => Err(format!("order.{k} must be a direction, got {v}")),
            })
            .collect(),
        // Already the wire's pair form.
        Json::Array(pairs) => pairs
            .iter()
            .map(|p| match p.as_array().map(Vec::as_slice) {
                Some([Json::String(k), Json::String(d)]) => Ok((k.clone(), d.clone())),
                _ => Err(format!("order pair must be [field, dir], got {p}")),
            })
            .collect(),
        other => Err(format!("order must be an object, got {other}")),
    }
}

/// `select` → `properties` on every relation sub-query. A projection (a
/// `from:` entry) takes no field list and is left as it is.
fn select_as_properties(include: &Map<String, Json>) -> Map<String, Json> {
    include
        .iter()
        .map(|(key, spec)| {
            let spec = match spec {
                Json::Object(sub) if !sub.contains_key("from") => {
                    let mut out = Map::new();
                    for (k, v) in sub {
                        match (k.as_str(), v) {
                            ("select", Json::Array(_)) => {
                                out.insert("properties".into(), v.clone());
                            }
                            ("include", Json::Object(inner)) => {
                                out.insert(
                                    "include".into(),
                                    Json::Object(select_as_properties(inner)),
                                );
                            }
                            _ => {
                                out.insert(k.clone(), v.clone());
                            }
                        }
                    }
                    Json::Object(out)
                }
                other => other.clone(),
            };
            (key.clone(), spec)
        })
        .collect()
}

/// `resolveScopeToParent`: a drill-down to the executor's `parent`.
fn scope_to_parent(scope: &Json, relations: &Relations) -> Result<Json, String> {
    let Json::Object(s) = scope else {
        return Err(format!("scope must be an object, got {scope}"));
    };
    let anchor = s.get("anchor").and_then(Json::as_str).unwrap_or_default();
    let via = s.get("via").and_then(Json::as_str).unwrap_or_default();
    let predicate = relations.predicate(anchor, via).ok_or_else(|| {
        format!(
            "cannot resolve scope {{ anchor: {anchor:?}, via: {via:?} }}: no such relation in the model table"
        )
    })?;
    let anchor_id = s.get("anchorId").cloned().unwrap_or(Json::Null);
    let bounded = anchor_id.is_array()
        || s.get("transitive").and_then(Json::as_bool) == Some(true)
        || s.get("direction").and_then(Json::as_str) == Some("in")
        || s.contains_key("limitPerAnchor")
        || s.contains_key("levels");
    if !bounded {
        return Ok(serde_json::json!({ "id": anchor_id, "predicate": predicate }));
    }
    // An empty list stays an empty list: "the replies to none of these"
    // answers with nothing, where dropping the scope would answer with the
    // whole space.
    let ids = match anchor_id {
        Json::Array(ids) => Json::Array(ids),
        one => Json::Array(vec![one]),
    };
    let mut out = Map::new();
    out.insert("ids".into(), ids);
    out.insert("predicate".into(), Json::from(predicate));
    if s.get("transitive").and_then(Json::as_bool) == Some(true) {
        out.insert("transitive".into(), Json::Bool(true));
    }
    if s.get("direction").and_then(Json::as_str) == Some("in") {
        out.insert("direction".into(), Json::from("in"));
    }
    for key in ["limitPerAnchor", "levels"] {
        if let Some(v) = s.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
    Ok(Json::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ir(v: Json) -> QueryIr {
        serde_json::from_value(v).unwrap()
    }

    fn wire(q: &ModelQuery) -> Json {
        serde_json::from_str(&q.query_json()).unwrap()
    }

    #[test]
    fn order_becomes_pairs_in_authored_order() {
        let q = model_query(
            &ir(json!({ "order": { "createdAt": "desc", "name": "asc" }, "limit": 20 })),
            &Relations::core(),
        )
        .unwrap();
        let w = wire(&q);
        assert_eq!(w["order"], json!([["createdAt", "desc"], ["name", "asc"]]));
        assert_eq!(w["limit"], json!(20));
    }

    #[test]
    fn where_travels_as_written_under_its_wire_name() {
        let q = model_query(
            &ir(json!({ "where": { "kind": "post", "title": { "contains": "x" } } })),
            &Relations::core(),
        )
        .unwrap();
        assert_eq!(
            wire(&q)["where"],
            json!({ "kind": "post", "title": { "contains": "x" } })
        );
    }

    #[test]
    fn select_is_properties_at_root_and_in_includes_but_not_projections() {
        let q = model_query(
            &ir(json!({
                "select": ["title"],
                "include": {
                    "children": { "select": ["text"], "include": { "signals": { "select": ["value"] } } },
                    "$n": { "from": "responses", "count": true, "select": ["x"] }
                }
            })),
            &Relations::core(),
        )
        .unwrap();
        let w = wire(&q);
        assert_eq!(w["properties"], json!(["title"]));
        assert_eq!(w["include"]["children"]["properties"], json!(["text"]));
        assert_eq!(
            w["include"]["children"]["include"]["signals"]["properties"],
            json!(["value"])
        );
        // `$`-keys travel as projections, untouched.
        assert_eq!(w["projections"]["$n"]["select"], json!(["x"]));
    }

    #[test]
    fn plain_scope_is_id_and_predicate_children_is_has_child() {
        let q = model_query(
            &ir(json!({ "scope": { "anchor": "CollectionBlock", "via": "children", "anchorId": "c1" } })),
            &Relations::core(),
        )
        .unwrap();
        assert_eq!(
            wire(&q)["parent"],
            json!({ "id": "c1", "predicate": "ad4m://has_child" })
        );
    }

    #[test]
    fn bounded_scope_is_the_traverse_form() {
        let q = model_query(
            &ir(json!({ "scope": {
                "anchor": "CollectionBlock", "via": "responses",
                "anchorId": "c1", "levels": [10, 5]
            } })),
            &Relations::core(),
        )
        .unwrap();
        assert_eq!(
            wire(&q)["parent"],
            json!({ "ids": ["c1"], "predicate": "we://response", "levels": [10, 5] })
        );
    }

    #[test]
    fn empty_anchor_list_stays_empty() {
        let q = model_query(
            &ir(json!({ "scope": { "anchor": "Space", "via": "typeStyles", "anchorId": [] } })),
            &Relations::core(),
        )
        .unwrap();
        assert_eq!(
            wire(&q)["parent"],
            json!({ "ids": [], "predicate": "we://type_style" })
        );
    }

    #[test]
    fn unknown_relation_is_refused_not_widened() {
        let err = model_query(
            &ir(json!({ "scope": { "anchor": "CollectionBlock", "via": "nope", "anchorId": "c1" } })),
            &Relations::core(),
        )
        .unwrap_err();
        assert!(err.contains("nope"), "{err}");
    }

    #[test]
    fn reserved_key_is_refused() {
        let err = model_query(&ir(json!({ "space": "other" })), &Relations::core()).unwrap_err();
        assert!(err.contains("space"), "{err}");
    }
}
