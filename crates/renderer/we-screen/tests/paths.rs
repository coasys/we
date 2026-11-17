//! `vectors/paths.json` — every recorded `resolvePath(to, current, base)` and
//! `isRelativePath` case, replayed against the port.
//!
//! The file is read at test time from the conformance package — never copied —
//! so a re-record is picked up without a code change.
use we_screen::{is_relative_path, resolve_path, PathBase};

fn cases() -> Vec<serde_json::Value> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/schema-system/conformance/vectors/paths.json"
    );
    let text = std::fs::read_to_string(path).expect("paths.json should be readable");
    let json: serde_json::Value = serde_json::from_str(&text).expect("paths.json should parse");
    json["cases"].as_array().expect("cases is an array").clone()
}

#[test]
fn paths_vectors() {
    for case in cases() {
        let id = case["id"].as_str().unwrap();
        let to = case["to"].as_str().unwrap();
        let current = case["current"].as_str().unwrap();
        let base = PathBase {
            depth: case["base"]["depth"].as_u64().unwrap() as usize,
            root: case["base"]["root"].as_u64().unwrap() as usize,
        };
        let expected = case["result"].as_str().unwrap();
        assert_eq!(
            resolve_path(to, current, base),
            expected,
            "{id}: resolve_path({to:?}, {current:?}, {base:?})"
        );
        assert_eq!(
            is_relative_path(to),
            case["relative"].as_bool().unwrap(),
            "{id}: is_relative_path({to:?})"
        );
    }
}
