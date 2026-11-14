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
