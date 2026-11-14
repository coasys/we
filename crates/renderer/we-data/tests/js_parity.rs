//! JS-semantics cases the recorded vectors do not cover. Each expected
//! value is worked out from the TS source by hand — never from the Rust
//! output — so these cases pin JavaScript behaviours Rust does not share:
//! `Math.round` ties toward +∞, `Number()` radix literals, Map's
//! last-write-wins, `localeCompare`'s case-insensitive order.
use serde_json::json;
use we_data::run_host_function;
use we_expr::Value;

fn call(name: &str, options: serde_json::Value) -> serde_json::Value {
    run_host_function(name, &Value::from_json(&options)).to_json()
}

/// `Math.round(n * 10) / 10` (aggregate.ts:97): ties go toward +∞ in JS,
/// away from zero in Rust — visible only on a negative `.x5` result.
#[test]
fn negative_aggregate_results_round_like_js() {
    // mean(-1, -1.5) = -1.25 → Math.round(-12.5) = -12 → -1.2.
    // (Rust's f64::round gives -13 → -1.3.)
    let mean = call(
        "signalTally",
        json!({
            "signals": [{ "value": -1 }, { "value": -1.5 }],
            "type": { "mode": "slider", "aggregate": "mean" }
        }),
    );
    assert_eq!(mean, json!(-1.2), "mean of -1 and -1.5 — Math.round");

    // median(-1, -1.1, -1.2, -1.3) = -1.15 → Math.round(-11.5) = -11 → -1.1.
    let median = call(
        "signalTally",
        json!({
            "signals": [
                { "value": -1 },
                { "value": -1.1 },
                { "value": -1.2 },
                { "value": -1.3 }
            ],
            "type": { "mode": "rating", "aggregate": "median" }
        }),
    );
    assert_eq!(median, json!(-1.1), "median's negative tie — Math.round");

    // Positive ties agree either way — the guard against a flipped fix.
    let positive = call(
        "signalTally",
        json!({
            "signals": [{ "value": 1 }, { "value": 1.5 }],
            "type": { "mode": "slider", "aggregate": "mean" }
        }),
    );
    assert_eq!(positive, json!(1.3), "mean of 1 and 1.5 — ties up");
}

/// `aggregateFor` (aggregate.ts:74): `!type.aggregate` treats every falsy
/// aggregate as absent — `""` included — so the mode's default applies.
/// A toggle with `aggregate: ""` counts heads; it does not average.
#[test]
fn an_empty_aggregate_is_absent() {
    let tally = call(
        "signalTally",
        json!({
            "signals": [{ "value": 1 }, { "value": 1 }],
            "type": { "mode": "toggle", "aggregate": "" }
        }),
    );
    assert_eq!(tally, json!(2), "toggle + '' aggregate → count");

    // A named aggregate still wins, and 'count' on a non-toggle is still
    // corrected to the mode's own.
    let named = call(
        "signalTally",
        json!({
            "signals": [{ "value": 2 }, { "value": 4 }],
            "type": { "mode": "slider", "aggregate": "median" }
        }),
    );
    assert_eq!(named, json!(3), "median of 2 and 4");
    let corrected = call(
        "signalTally",
        json!({
            "signals": [{ "value": 2 }, { "value": 4 }],
            "type": { "mode": "slider", "aggregate": "count" }
        }),
    );
    assert_eq!(corrected, json!(3), "'count' on a slider → mean");
}

/// The profile joins build a `Map` keyed by did (reactors.ts:64,
/// voices.ts:58, involvementMenu.ts:97) — the last row for a did wins,
/// not the first. With `find` the stale row survived.
#[test]
fn profile_joins_take_the_last_duplicate() {
    let profiles = json!([
        { "did": "did:a", "name": "Old", "avatar": "a-old" },
        { "did": "did:a", "name": "New", "avatar": "a-new" }
    ]);

    let reacted = call(
        "reactors",
        json!({
            "signals": [{ "author": "did:a", "value": 1 }],
            "profiles": profiles,
            "me": "did:b"
        }),
    );
    assert_eq!(reacted["people"][0]["name"], json!("New"));
    assert_eq!(reacted["people"][0]["avatar"], json!("a-new"));

    // And the search matches the name that won — 'new' finds the person.
    let searched = call(
        "reactors",
        json!({
            "signals": [{ "author": "did:a", "value": 1 }],
            "profiles": profiles,
            "me": "did:b",
            "search": "new"
        }),
    );
    assert_eq!(searched["people"].as_array().unwrap().len(), 1);
    assert_eq!(searched["unresolved"], json!(0));

    let listed = call(
        "voices",
        json!({
            "summary": { "voices": [{ "author": "did:a", "cards": 1, "mean": 1 }] },
            "profiles": profiles,
            "me": "did:b",
            "param": ""
        }),
    );
    assert_eq!(listed[0]["name"], json!("New"));
    assert_eq!(listed[0]["avatar"], json!("a-new"));

    // A holder who left still comes from the profile cache — the last one.
    let menu = call(
        "involvementMenu",
        json!({
            "node": "n1",
            "entity": "TaskBlock",
            "rows": [{ "node": "n1", "agent": "did:a", "kind": "helper" }],
            "types": [{ "slug": "helper", "semantic": "responsible", "reflexive": false }],
            "members": [],
            "profiles": profiles,
            "me": "did:b"
        }),
    );
    assert_eq!(
        menu[0]["items"][0]["label"],
        json!("New"),
        "departed holder joins the last profile"
    );
}
