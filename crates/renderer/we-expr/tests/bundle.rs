//! Every `{"$": "…"}` token in the Coasys bundle must parse — that is the
//! corpus this language exists for. Handler expressions are the same token
//! shape nested inside `$if`/`$invoke` payloads, so a recursive walk of the
//! bundle JSON finds them all.
//!
//! The bundle is read from the repo at test time, never copied.
use std::path::PathBuf;
use we_expr::{parse, print};

fn bundle_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../bundles/coasys.bundle.json")
}

/// Every `{"$": "…"}` source in the bundle, in document order.
fn bundle_sources() -> Vec<String> {
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(bundle_path()).expect("read bundle"))
            .expect("bundle is json");
    let mut sources = Vec::new();
    fn walk(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(map) => {
                for (k, val) in map {
                    if k == "$" {
                        if let serde_json::Value::String(s) = val {
                            out.push(s.clone());
                        }
                    } else {
                        walk(val, out);
                    }
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, out);
                }
            }
            _ => {}
        }
    }
    walk(&json, &mut sources);
    sources
}

#[test]
fn bundle_expressions_parse() {
    let sources = bundle_sources();
    // The mapping documents 2,429 canonical tokens; assert ≥ so a bundle
    // that grows new expressions still passes while a truncated one fails.
    assert!(
        sources.len() >= 2429,
        "expected ≥ 2429 expression tokens, found {}",
        sources.len()
    );

    let mut failures = 0;
    for (i, src) in sources.iter().enumerate() {
        if let Err(e) = parse(src) {
            failures += 1;
            eprintln!("token {i}: {src:?}\n  parse error: {e}");
        }
    }
    assert_eq!(failures, 0, "{failures} bundle expressions failed to parse");
}

#[test]
fn bundle_print_round_trip() {
    // For every bundle expression `s`: `print(parse(print(parse(s))))`
    // must equal `print(parse(s))` — the canonical form is a fixed point.
    let sources = bundle_sources();
    let mut failures = 0;
    for src in &sources {
        let once = parse(src).expect("bundle sources all parse");
        let canonical = print(&once);
        let twice = parse(&canonical).unwrap_or_else(|e| {
            panic!("re-parse of canonical {canonical:?} failed: {e}\n  source: {src:?}")
        });
        let reparsed = print(&twice);
        if reparsed != canonical {
            failures += 1;
            if failures <= 10 {
                eprintln!("round-trip mismatch:\n  source:    {src:?}\n  canonical: {canonical:?}\n  re-print:  {reparsed:?}");
            }
        }
    }
    assert_eq!(failures, 0, "{failures} round-trip mismatches");
}
