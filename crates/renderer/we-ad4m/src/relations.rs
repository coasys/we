//! [`Relations`]: what the adapter knows about each entity's relations —
//! the predicate a `scope` drill-down names as the executor's `parent`, and
//! whether an include over it is read polymorphically.
//!
//! The table is data (`data/relations.json`), generated from WE's entity
//! manifest by `scripts/gen-relations.py`: WeNode's shared relations folded
//! into every WeNode entity, containment in AD4M's spelling
//! (`ad4m://has_child`). A space's own shapes and a foreign app's models
//! are not in it yet; a scope over one of their relations is refused rather
//! than guessed.
use std::collections::BTreeMap;

use serde::Deserialize;

const CORE: &str = include_str!("../data/relations.json");

/// One relation, as the manifest declares it.
#[derive(Debug, Clone, Deserialize)]
pub struct Relation {
    pub predicate: String,
    /// The class it points at; empty when untyped.
    #[serde(default)]
    pub target: String,
    /// An include reads each member as the class it is
    /// (`resolvesPolymorphically`: declared, else untyped).
    #[serde(default)]
    pub polymorphic: bool,
    /// Read backwards (`respondsTo`, `partOf`): includable, never a scope.
    #[serde(default)]
    pub reverse: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Relations {
    table: BTreeMap<String, BTreeMap<String, Relation>>,
}

impl Relations {
    /// WE's core entities, from the generated table.
    pub fn core() -> Self {
        Self {
            table: serde_json::from_str(CORE).expect("data/relations.json parses"),
        }
    }

    pub fn get(&self, entity: &str, relation: &str) -> Option<&Relation> {
        self.table.get(entity)?.get(relation)
    }

    /// The predicate a scope walking `entity.relation` names — `None` for a
    /// relation read backwards, which no scope walks.
    pub fn predicate(&self, entity: &str, relation: &str) -> Option<&str> {
        self.get(entity, relation)
            .filter(|r| !r.reverse)
            .map(|r| r.predicate.as_str())
    }

    /// Declare one more relation — a space's shape, a foreign model.
    pub fn insert(&mut self, entity: &str, relation: &str, rel: Relation) {
        self.table
            .entry(entity.to_string())
            .or_default()
            .insert(relation.to_string(), rel);
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
        assert!(r.get("CollectionBlock", "respondsTo").unwrap().polymorphic);
    }

    #[test]
    fn untyped_relations_are_polymorphic_unless_they_opt_out() {
        let r = Relations::core();
        assert!(r.get("CollectionBlock", "children").unwrap().polymorphic);
        assert!(r.get("CollectionBlock", "thread").unwrap().polymorphic);
        assert!(!r.get("CollectionBlock", "signals").unwrap().polymorphic);
        assert_eq!(
            r.get("CollectionBlock", "signals").unwrap().target,
            "Signal"
        );
        // Declared `polymorphic: false` on an untyped relation.
        assert!(!r.get("SpaceLandmark", "node").unwrap().polymorphic);
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
