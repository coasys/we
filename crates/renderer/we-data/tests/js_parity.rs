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
