//! `StoreMap` parses the seed; every `kind` round-trips; an unknown kind
//! fails naming the member; a missing file fails naming the path.
use we_data::{MemberKind, StoreMap};

const SEED: &str = include_str!("../data/storemap-offline.json");

#[test]
fn seed_parses() {
    let map = StoreMap::parse(SEED).expect("seed parses");
    assert_eq!(map.version, 1);
    assert!(!map.members.is_empty(), "seed ships member rows");
}

#[test]
fn every_kind_parses() {
    let text = r#"{
        "version": 1,
        "members": {
            "a.screen":    { "kind": "screen" },
            "a.derived":   { "kind": "derived" },
            "a.read":      { "kind": "modelRead" },
            "a.write":     { "kind": "modelWrite" },
            "a.flow":      { "kind": "flow" },
            "a.command":   { "kind": "command" },
            "a.widget":    { "kind": "widgetInternal" },
            "a.deferred":  { "kind": "deferred" }
        }
    }"#;
    let map = StoreMap::parse(text).expect("all kinds parse");
    assert_eq!(map.members.len(), 8);
    assert_eq!(map.members["a.derived"].kind, MemberKind::Derived);
    assert_eq!(map.members["a.read"].kind, MemberKind::ModelRead);
    assert_eq!(map.members["a.write"].kind, MemberKind::ModelWrite);
    assert_eq!(map.members["a.deferred"].kind, MemberKind::Deferred);
}

#[test]
fn unknown_kind_fails_naming_the_member() {
    let text = r#"{
        "members": {
            "spaceStore.frobnicate": { "kind": "magic" }
        }
    }"#;
    let err = StoreMap::parse(text).expect_err("unknown kind is an error");
    assert!(
        err.contains("spaceStore.frobnicate"),
        "error names the member: {err}"
    );
    assert!(err.contains("magic"), "error names the kind: {err}");
}

#[test]
fn missing_kind_fails_naming_the_member() {
    let text = r#"{ "members": { "spaceStore.x": { "note": "no kind" } } }"#;
    let err = StoreMap::parse(text).expect_err("missing kind is an error");
    assert!(
        err.contains("spaceStore.x"),
        "error names the member: {err}"
    );
}

#[test]
fn non_object_row_fails_naming_the_member() {
    let text = r#"{ "members": { "spaceStore.x": "derived" } }"#;
    let err = StoreMap::parse(text).expect_err("non-object row is an error");
    assert!(
        err.contains("spaceStore.x"),
        "error names the member: {err}"
    );
}

#[test]
fn missing_file_fails_naming_the_path() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/data/definitely-not-here.json");
    let err = StoreMap::load(path).expect_err("missing file is an error");
    assert!(
        err.contains("definitely-not-here.json"),
        "error names the path: {err}"
    );
}

#[test]
fn seed_file_loads_from_disk() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/data/storemap-offline.json");
    let map = StoreMap::load(path).expect("seed loads");
    assert_eq!(map.version, 1);
    // The rows this task implements are present and carry implementations.
    assert_eq!(
        map.members["spaceStore.mutedDids"].native(),
        Some("space.mutedDids")
    );
    assert_eq!(
        map.members["spaceStore.offeredInvolvementTypes"].native(),
        Some("space.offeredInvolvementTypes")
    );
    assert!(map.members["workflowStore.canEdit"].expr().is_some());
}
