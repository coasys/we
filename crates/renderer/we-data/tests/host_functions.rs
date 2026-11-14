//! The conformance gate: every case in
//! `packages/schema-system/conformance/vectors/host-functions.json` against
//! the we-data natives. The vector file is the spec — `options` decodes
//! through `Value::from_json`, `result` compares through `Value::to_json`
//! (the same encoding the recorder wrote).
//!
//! Fails loudly on a wrong count too: a silently empty table is a pass only
//! if the file is missing, and this task asserts the full 46.
use std::collections::BTreeMap;

use serde::Deserialize;
use we_data::run_host_function;
use we_expr::Value;

const VECTORS: &str =
    include_str!("../../../../packages/schema-system/conformance/vectors/host-functions.json");

#[derive(Deserialize)]
struct VectorFile {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    #[serde(rename = "fn")]
    function: String,
    #[serde(default)]
    options: serde_json::Value,
    result: serde_json::Value,
}

fn cases() -> Vec<Case> {
    serde_json::from_str::<VectorFile>(VECTORS)
        .expect("host-functions.json parses")
        .cases
}

#[test]
fn vector_count_is_46() {
    let cases = cases();
    assert_eq!(cases.len(), 46, "the table silently shrank or grew");
}

#[test]
fn all_host_function_vectors_pass() {
    let cases = cases();
    assert_eq!(cases.len(), 46);

    let mut failing: BTreeMap<String, (serde_json::Value, serde_json::Value)> = BTreeMap::new();
    for case in &cases {
        let options = Value::from_json(&case.options);
        let got = run_host_function(&case.function, &options).to_json();
        if got != case.result {
            failing.insert(case.id.clone(), (case.result.clone(), got));
        }
    }
    if !failing.is_empty() {
        for (id, (expected, got)) in &failing {
            eprintln!("FAIL {id}\n  expected: {expected}\n  got:      {got}");
        }
        panic!("{} of 46 host-function cases failed", failing.len());
    }
}
