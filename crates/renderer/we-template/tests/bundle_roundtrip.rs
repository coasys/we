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
    let written: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&bundle).unwrap()).unwrap();
    assert_eq!(written, original, "the bundle lost or changed a field");
}
