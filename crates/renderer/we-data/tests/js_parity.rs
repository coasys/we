//! JS-semantics cases the recorded vectors do not cover. Each expected
//! value is worked out from the TS source by hand — never from the Rust
//! output — so these cases pin JavaScript behaviours Rust does not share:
//! `Math.round` ties toward +∞, `Number()` radix literals, Map's
//! last-write-wins. (`localeCompare` is pinned by browser-recorded vectors
//! in `locale_vectors.rs`.)
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

/// The aggregates round through `Math.round` (aggregate.ts:97), which
/// reads the fraction the input actually carries — `0.49999999999999994`
/// is below half even though `0.49999999999999994 + 0.5` lands exactly on
/// one. The `(n + 0.5).floor()` shortcut adds first and rounds 1, not 0.
/// `Math.round(-0.5)` is `-0` — a value to_json marks `{"$number":"-0"}`.
/// The real `Math.round` lives in we-expr; the natives share it.
#[test]
fn math_round_reads_the_true_fraction() {
    // mean(0.049999999999999994) → Math.round(0.49999999999999994) = 0.
    let near_half = call(
        "signalTally",
        json!({
            "signals": [{ "value": 0.049999999999999994 }],
            "type": { "mode": "slider", "aggregate": "mean" }
        }),
    );
    assert_eq!(near_half, json!(0), "just under .5 rounds down");

    // mean(-0.05) → Math.round(-0.5) = -0 — the mark survives /10.
    let negative_tie = call(
        "signalTally",
        json!({
            "signals": [{ "value": -0.05 }],
            "type": { "mode": "slider", "aggregate": "mean" }
        }),
    );
    assert_eq!(
        negative_tie,
        json!({ "$number": "-0" }),
        "-0.5 rounds to -0"
    );
}

/// `voicesParam`'s `Math.round(Number(weight))` (voices.ts:88) — the same
/// boundary as a weight: just-under-half is 0%, and Math.round(-0.5) is
/// -0, which `String()` writes as "0", never "-0".
#[test]
fn voices_param_rounds_like_math_round() {
    let voiced = |weight: serde_json::Value| -> serde_json::Value {
        call(
            "voicesParam",
            json!({ "param": "", "did": "did:a", "weight": weight }),
        )
    };
    assert_eq!(
        voiced(json!(0.49999999999999994)),
        json!("did:a=0"),
        "just under .5 is 0%, not 1%"
    );
    assert_eq!(
        voiced(json!(-0.5)),
        json!("did:a=0"),
        "-0.5 weighs 0%, written '0'"
    );
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

/// `parseWeights` runs `Number(share)` on the text (weighing.ts:87) —
/// `"0x32"`, `"0b110010"`, `"0o62"` are all 50. Rust float parsing turned
/// them to NaN, dropped the entry, and defaulted the voice to 100%.
#[test]
fn weight_text_parses_like_js_number() {
    let voices_for = |param: &str| -> serde_json::Value {
        call(
            "voices",
            json!({
                "summary": { "voices": [{ "author": "did:a", "cards": 1, "mean": 1 }] },
                "profiles": [{ "did": "did:a", "name": "Ada" }],
                "me": "did:b",
                "param": param
            }),
        )
    };
    for param in ["did:a=0x32", "did:a=0b110010", "did:a=0o62"] {
        assert_eq!(
            voices_for(param)[0]["weight"],
            json!(50),
            "{param} is 50% under Number()"
        );
    }
    // Signed radix spellings are still NaN, as `Number('+0x32')` is — the
    // entry drops and the weight defaults to 100.
    assert_eq!(voices_for("did:a=+0x32")[0]["weight"], json!(100));
    // And plain text still parses.
    assert_eq!(voices_for("did:a=25")[0]["weight"], json!(25));
}

/// `parseWeights` trims like `String.trim()` (weighing.ts:86-87) — the
/// ECMAScript whitespace set, which includes the BOM `U+FEFF` Rust's
/// `trim()` leaves and excludes `U+0085` NEL that Rust's `trim()` cuts.
/// `Number(share)` applies the same set before parsing.
#[test]
fn weight_text_trims_like_js() {
    let voices_for = |param: &str| -> serde_json::Value {
        call(
            "voices",
            json!({
                "summary": { "voices": [{ "author": "did:a", "cards": 1, "mean": 1 }] },
                "profiles": [{ "did": "did:a", "name": "Ada" }],
                "me": "did:b",
                "param": param
            }),
        )
    };
    // The BOM is whitespace in JS — trimmed off the share before
    // `Number()` and off the did by `String.trim()`.
    assert_eq!(
        voices_for("did:a=\u{FEFF}50")[0]["weight"],
        json!(50),
        "Number('\\uFEFF50') is 50 — the BOM trims"
    );
    assert_eq!(
        voices_for("\u{FEFF} did:a=50")[0]["weight"],
        json!(50),
        "the BOM trims off the did too"
    );
    // NEL is NOT whitespace in JS — `Number('\u008550')` is NaN, the
    // entry drops, and the voice defaults to 100.
    assert_eq!(
        voices_for("did:a=\u{85}50")[0]["weight"],
        json!(100),
        "Number('\\u008550') is NaN — NEL does not trim"
    );
}

/// The settled `order` ranks come from `new Map(settled.map((id, at) =>
/// [id, at]))` (signalTypesByUse.ts:82) — a duplicate id keeps its LAST
/// index, so `["a","b","a"]` ranks a=2, b=1 and orders [b, a].
#[test]
fn duplicate_settled_ids_take_their_last_rank() {
    let out = call(
        "signalTypesByUse",
        json!({
            "types": [{ "id": "a", "name": "A" }, { "id": "b", "name": "B" }],
            "signals": [],
            "order": ["a", "b", "a"]
        }),
    );
    let ids: Vec<&str> = out
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["b", "a"], "a's last index is 2, after b's 1");
}
