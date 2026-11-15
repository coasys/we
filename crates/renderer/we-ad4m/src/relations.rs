//! [`Relations`]: entity → relation → the predicate it is stored under —
//! what a `scope` drill-down needs to name the executor's `parent`.
//!
//! The table is data (`data/relations.json`), generated from WE's entity
//! manifest by `scripts/gen-relations.py`: WeNode's shared relations folded
//! into every WeNode entity, reverse relations left out, containment in
//! AD4M's spelling (`ad4m://has_child`). A space's own shapes and a foreign
//! app's models are not in it yet; a scope over one of their relations is
//! refused rather than guessed.
use std::collections::BTreeMap;

const CORE: &str = include_str!("../data/relations.json");

#[derive(Debug, Clone, Default)]
pub struct Relations {
    table: BTreeMap<String, BTreeMap<String, String>>,
}

impl Relations {
    /// WE's core entities, from the generated table.
    pub fn core() -> Self {
        Self {
            table: serde_json::from_str(CORE).expect("data/relations.json parses"),
        }
    }

    /// The predicate `entity.relation` is stored under.
    pub fn predicate(&self, entity: &str, relation: &str) -> Option<&str> {
        self.table.get(entity)?.get(relation).map(String::as_str)
    }

    /// Declare one more relation — a space's shape, a foreign model.
    pub fn insert(&mut self, entity: &str, relation: &str, predicate: &str) {
        self.table
            .entry(entity.to_string())
            .or_default()
            .insert(relation.to_string(), predicate.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn core_predicates_match_the_manifest() {
        let r = Relations::core();
        assert_eq!(
            r.predicate("CollectionBlock", "children"),
            Some("ad4m://has_child")
        );
        assert_eq!(
            r.predicate("CollectionBlock", "responses"),
            Some("we://response")
        );
        assert_eq!(r.predicate("Space", "typeStyles"), Some("we://type_style"));
        // Reverse relations are not a direction a scope walks.
        assert_eq!(r.predicate("CollectionBlock", "respondsTo"), None);
    }

    /// Every `scope` the Coasys bundle writes resolves — a scope this table
    /// cannot answer is a query the live app refuses.
    #[test]
    fn every_bundle_scope_resolves() {
        let text = include_str!("../../../../bundles/coasys.bundle.json");
        let bundle: Value = serde_json::from_str(text).unwrap();
        let mut scopes = Vec::new();
        fn walk(v: &Value, out: &mut Vec<(String, String)>) {
            match v {
                Value::Object(m) => {
                    if let Some(Value::Object(s)) = m.get("scope") {
                        if let (Some(a), Some(v)) = (s.get("anchor"), s.get("via")) {
                            if let (Some(a), Some(v)) = (a.as_str(), v.as_str()) {
                                out.push((a.into(), v.into()));
                            }
                        }
                    }
                    m.values().for_each(|c| walk(c, out));
                }
                Value::Array(a) => a.iter().for_each(|c| walk(c, out)),
                _ => {}
            }
        }
        walk(&bundle, &mut scopes);
        assert!(!scopes.is_empty());
        let r = Relations::core();
        for (anchor, via) in scopes {
            assert!(
                r.predicate(&anchor, &via).is_some(),
                "bundle scope {anchor}.{via} has no predicate"
            );
        }
    }
}
