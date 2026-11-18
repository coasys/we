//! The whole Coasys bundle parses into the bundle types and writes back to
//! equal JSON — no field lost. The shared vectors and fixtures this test will
//! sit beside live under `../../packages` from the workspace root; the bundle
//! itself is read by absolute path from `CARGO_MANIFEST_DIR`.
use we_template::Bundle;

const BUNDLE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
);

#[test]
fn coasys_bundle_round_trips() {
    let text = std::fs::read_to_string(BUNDLE_PATH)
        .unwrap_or_else(|e| panic!("cannot read {BUNDLE_PATH}: {e}"));
    let bundle = Bundle::parse(&text).unwrap_or_else(|e| panic!("bundle did not parse: {e}"));

    assert!(bundle.is_supported(), "unexpected bundle header");
    assert_eq!(bundle.name, "Coasys");

    let original: serde_json::Value = serde_json::from_str(&text).unwrap();
    let written_text = serde_json::to_string(&bundle).unwrap();
    let written: serde_json::Value = serde_json::from_str(&written_text).unwrap();
    assert_eq!(written, original, "the bundle lost or changed a field");
    // Order matters to the normal form, and `assert_eq` on two `Value`s
    // cannot see it — object equality ignores key order. Compare the
    // serialized forms: same keys, same order.
    assert_eq!(
        written_text,
        serde_json::to_string(&original).unwrap(),
        "the bundle's keys came back in a different order"
    );
}

#[test]
fn bundle_base_round_trips_and_stays_out_of_extra() {
    let text = r#"{"format":"we-bundle","formatVersion":1,"id":"coasys","version":"0","name":"Coasys","base":{"type":"Column","children":["hi"]},"note":"kept"}"#;
    let bundle = Bundle::parse(text).unwrap();
    assert!(bundle.base.is_some());
    assert!(bundle.extra.get("base").is_none());
    assert_eq!(
        bundle.extra.get("note").and_then(|v| v.as_str()),
        Some("kept")
    );
    let again = serde_json::to_string(&bundle).unwrap();
    let parsed = Bundle::parse(&again).unwrap();
    assert_eq!(
        parsed.base.as_ref().and_then(|n| n.ty.as_deref()),
        Some("Column")
    );

    let absent = r#"{"format":"we-bundle","formatVersion":1,"id":"x","version":"0","name":"X"}"#;
    let bundle = Bundle::parse(absent).unwrap();
    assert!(bundle.base.is_none());
    assert!(!serde_json::to_string(&bundle).unwrap().contains("\"base\""));
}
