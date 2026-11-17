//! The recorded Coasys snapshot's capture contract — the identity a consumer
//! (E6 round 3) binds each answer to.
//!
//! Every `routes.<id>.queries` entry — answered, skipped or failed — carries
//! `scope` (the canonical path of the `$queries` node that declared it inside
//! the bundle), `dataset` (the resolved dataset the bridge ran it against) and
//! the question itself (`request`, or the authored `descriptor` where
//! resolution could not finish). The flat `stores`/`queries`/`invokes` tables
//! are a lossy projection of the `meta.flatScope` route only.
//!
//! These assertions run against the committed recording, so a recorder change
//! that drops an identity field fails a test rather than a downstream consumer.

use std::collections::BTreeSet;

use serde_json::Value;

const SNAPSHOT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/coasys/snapshot.json"
));

fn snapshot() -> Value {
    serde_json::from_str(SNAPSHOT).expect("snapshot.json parses")
}

#[test]
fn every_capture_carries_full_identity() {
    let snapshot = snapshot();
    assert_eq!(
        snapshot["meta"]["format"], "we-snapshot@2",
        "meta.format is the version gate a reader checks"
    );

    let routes = snapshot["routes"].as_object().expect("routes is an object");
    assert!(!routes.is_empty());
    for (id, route) in routes {
        for capture in route["queries"].as_array().expect("queries is a list") {
            let name = capture["name"].as_str().unwrap_or("?");
            let at = format!("routes.{id}.queries[{name}]");

            // The declaration site: a non-empty canonical path inside the bundle.
            let scope = capture["scope"]
                .as_str()
                .unwrap_or_else(|| panic!("{at}: capture has no scope"));
            assert!(!scope.is_empty(), "{at}: scope is empty");

            // The resolved dataset identity — present even when it is null
            // (`no-dataset` failures cannot name one).
            assert!(
                capture.get("dataset").is_some(),
                "{at}: capture has no dataset"
            );

            // Exactly one outcome.
            let states = ["rows", "skipped", "failed"]
                .iter()
                .filter(|k| capture.get(**k).is_some())
                .count();
            assert_eq!(states, 1, "{at}: exactly one of rows/skipped/failed");

            // The question: `request` once the descriptor resolved, always for an
            // answered capture; the authored `descriptor` for skipped/failed ones,
            // where resolution may legitimately have stopped early (row context).
            if capture.get("rows").is_some() {
                assert!(
                    capture["request"].is_object(),
                    "{at}: answered capture has no resolved request"
                );
            }
            if capture.get("skipped").is_some() || capture.get("failed").is_some() {
                assert!(
                    capture.get("descriptor").is_some(),
                    "{at}: skipped/failed capture has no authored descriptor"
                );
            }
            assert!(
                capture.get("request").is_some() || capture.get("descriptor").is_some(),
                "{at}: capture names neither request nor descriptor"
            );
            assert!(
                capture["surfaces"].is_array(),
                "{at}: capture has no surfaces"
            );
        }
    }
}

#[test]
fn flat_tables_repeat_only_the_flat_scope_route() {
    let snapshot = snapshot();
    match snapshot["meta"]["flatScope"].as_str() {
        // A routes subset that left the landing route out records the flat scope
        // as unavailable — never partial tables under a name they do not hold.
        None => {
            assert!(
                snapshot["stores"].as_object().unwrap().is_empty(),
                "flatScope null: stores must be empty"
            );
            assert!(
                snapshot["queries"].as_object().unwrap().is_empty(),
                "flatScope null: queries must be empty"
            );
            assert!(
                snapshot["invokes"].as_object().unwrap().is_empty(),
                "flatScope null: invokes must be empty"
            );
        }
        Some(scope_id) => {
            let landing = &snapshot["routes"][scope_id];
            assert_eq!(
                snapshot["stores"], landing["members"],
                "flat stores are the landing route's members"
            );

            // Flat invokes are exactly the targets the landing route declares —
            // not a union over every route's surfaces.
            let declared: BTreeSet<&str> = landing["invokeTargets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t.as_str().unwrap())
                .collect();
            let flat: BTreeSet<&str> = snapshot["invokes"]
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(
                flat, declared,
                "flat invokes must equal {scope_id}.invokeTargets"
            );

            // Flat queries are a lossy projection: the first answered capture per
            // name, which is also why the real data lives in `routes`.
            for (name, rows) in snapshot["queries"].as_object().unwrap() {
                let first = landing["queries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|c| c["name"].as_str() == Some(name) && c.get("rows").is_some())
                    .unwrap_or_else(|| {
                        panic!("flat query {name} has no answered capture in {scope_id}")
                    });
                assert_eq!(
                    *rows, first["rows"],
                    "flat query {name} is not {scope_id}'s first answer"
                );
            }
        }
    }
}

#[test]
fn same_name_under_another_scope_is_another_capture() {
    let snapshot = snapshot();
    let queries = snapshot["routes"]["index"]["queries"].as_array().unwrap();
    let captures_named = |name: &str| -> Vec<&Value> {
        queries
            .iter()
            .filter(|c| c["name"].as_str() == Some(name))
            .collect()
    };

    // `calls` is declared both by the tree panel (limit 12) and the /calls route
    // (limit 100): same name, same dataset, different scope and request — two
    // captures, neither reusing the other's rows.
    let calls = captures_named("calls");
    assert!(
        calls.len() >= 2,
        "expected both `calls` declarations recorded"
    );
    let scopes: BTreeSet<&str> = calls.iter().map(|c| c["scope"].as_str().unwrap()).collect();
    assert_eq!(
        scopes.len(),
        calls.len(),
        "each `calls` capture names its own declaration"
    );
    let requests: BTreeSet<String> = calls.iter().map(|c| c["request"].to_string()).collect();
    assert!(
        requests.len() > 1,
        "the two `calls` asks must differ (limit 12 vs 100)"
    );

    // `signalTypes` keeps the tree's name-sorted request beside the inspector's
    // unsorted one — the collision a name-keyed table could not hold.
    let answered: Vec<&Value> = captures_named("signalTypes")
        .into_iter()
        .filter(|c| c.get("rows").is_some())
        .collect();
    assert!(
        answered.len() >= 2,
        "expected both answered `signalTypes` requests"
    );
    let requests: BTreeSet<String> = answered.iter().map(|c| c["request"].to_string()).collect();
    assert!(
        requests.len() >= 2,
        "the two `signalTypes` asks must differ (sorted vs not)"
    );

    // And the skipped/failed states carry their authored descriptor — `candidates`
    // (`entity: {$: 'field.target'}`, row context only) fails no-entity everywhere.
    let failed = captures_named("candidates");
    assert_eq!(failed.len(), 1, "candidates has one declaration");
    assert_eq!(failed[0]["failed"], "no-entity");
    assert_eq!(failed[0]["descriptor"]["entity"]["$"], "field.target");
}
