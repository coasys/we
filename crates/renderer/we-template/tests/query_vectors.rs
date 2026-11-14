//! Conformance vectors: `packages/schema-system/conformance/vectors/query-compile.json`.
//! Three ops — `query` (resolveQueryProp's descriptor split), `where`
//! (pruneUnresolvedWhere), `scope` (scopeIsAnchored). Every case runs against
//! an empty scope: the vectors' `$` tokens only appear under keys the split
//! carries verbatim, so no case needs a live store.

use std::sync::Arc;
use we_expr::{ParseCache, Value};
use we_template::{prune_where, query_descriptor, scope_anchored, LocalState, Scope, StoreBag};

const VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/schema-system/conformance/vectors/query-compile.json"
));

fn undefined() -> serde_json::Value {
    serde_json::json!({"$undefined": true})
}

#[test]
fn query_compile_vectors() {
    let file: serde_json::Value = serde_json::from_str(VECTORS).unwrap();
    let cases = file["cases"].as_array().unwrap();
    let mut ran = 0;
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let bag = StoreBag::new();
        let locals = LocalState::new();
        let scope = Scope::default();
        let mut cache = ParseCache::new();
        let mut warnings = Vec::<Arc<str>>::new();
        match case["op"].as_str().unwrap() {
            "query" => {
                let got = query_descriptor(&case["query"], &scope, &bag, &mut cache, &mut warnings)
                    .unwrap_or_else(|| panic!("{id}: descriptor gated"));
                assert_eq!(
                    got,
                    case["descriptor"],
                    "{id}: descriptor mismatch\n note: {}",
                    case["note"].as_str().unwrap_or("")
                );
            }
            "where" => {
                let clause = Value::from_json(&case["where"]);
                let got = prune_where(&clause).unwrap_or_else(undefined);
                assert_eq!(
                    got,
                    case["pruned"],
                    "{id}: pruned where mismatch\n note: {}",
                    case["note"].as_str().unwrap_or("")
                );
            }
            "scope" => {
                let scope_v = Value::from_json(&case["scope"]);
                assert_eq!(
                    scope_anchored(&scope_v),
                    case["anchored"].as_bool().unwrap(),
                    "{id}: anchored mismatch\n note: {}",
                    case["note"].as_str().unwrap_or("")
                );
            }
            op => panic!("{id}: unknown op {op}"),
        }
        let _ = &locals;
        ran += 1;
    }
    assert_eq!(ran, 55, "vector file grew — new cases must run too");
}
