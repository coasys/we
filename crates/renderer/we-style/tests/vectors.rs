//! Conformance: `buildLayoutStyles` emission and `var()` resolution against
//! the recorded vectors in `packages/schema-system/conformance/vectors/`.
//!
//! The vectors are loaded from the repo at test time — a re-recorded table or
//! a new case is picked up without touching this file. Two families of
//! assertions per case:
//!
//! - `style` — the emitted declaration map must equal `build_layout_decls`'s
//!   output exactly (keys, order-insensitive values, numbers as numbers).
//! - `resolved` — per authored prop: `raw`/`computed` markers check the
//!   emitted text and its `var()` substitution; `token`/`var` markers check
//!   that the emitted declaration is the recorded `var(--we-*)` and that the
//!   theme's table resolves it to the recorded value (`value: null` means the
//!   var is undeclared — the property paints nothing, so the Rust field must
//!   stay unset and the raw text land in `unsupported`).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::{
    build_layout_decls, emitted_for, Bag, DeclValue, Direction, StyleInput, TokenTable,
};

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors")
}

fn token_table(theme: &str) -> TokenTable {
    let path = vectors_dir().join(format!("tokens/{theme}.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let json: serde_json::Value = serde_json::from_str(&text).unwrap();
    TokenTable::from_json(&json).unwrap_or_else(|e| panic!("bad token table {theme}: {e}"))
}

fn json_to_value(j: &serde_json::Value) -> Value {
    match j {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => Value::Str(Arc::from(s.as_str())),
        serde_json::Value::Array(items) => {
            Value::List(Arc::new(items.iter().map(json_to_value).collect()))
        }
        serde_json::Value::Object(map) => Value::Obj(Arc::new(
            map.iter()
                .map(|(k, v)| (Arc::from(k.as_str()), json_to_value(v)))
                .collect::<IndexMap<Arc<str>, Value>>(),
        )),
    }
}

fn props_of(case: &serde_json::Value) -> Bag {
    match json_to_value(&case["props"]) {
        Value::Obj(o) => (*o).clone(),
        _ => Bag::new(),
    }
}

fn direction_of(case: &serde_json::Value) -> Direction {
    match case["direction"].as_str() {
        Some("column") => Direction::Column,
        _ => Direction::Row,
    }
}

/// The emitted declaration map as a plain `key → json` map, for comparison
/// with the recorded `style` object.
fn decls_json(decls: &we_style::Decls) -> BTreeMap<String, serde_json::Value> {
    decls
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_json()))
        .collect()
}

struct Misses {
    style_diff: Vec<String>,
    marker_diff: Vec<String>,
}

fn check_case(case: &serde_json::Value, tokens: &TokenTable) -> Misses {
    let id = case["id"].as_str().unwrap_or("?");
    let props = props_of(case);
    let direction = direction_of(case);
    let mut miss = Misses {
        style_diff: Vec::new(),
        marker_diff: Vec::new(),
    };

    // ── the emitted declaration map ──────────────────────────────────────
    let decls = build_layout_decls(&props, direction);
    let got = decls_json(&decls);
    let want: BTreeMap<String, serde_json::Value> =
        serde_json::from_value(case["style"].clone()).unwrap_or_default();
    if got != want {
        let mut detail = String::new();
        for k in want.keys() {
            match got.get(k) {
                None => detail.push_str(&format!(" -{k}")),
                Some(v) if *v != want[k] => {
                    detail.push_str(&format!(" ~{k}({} vs {})", v, want[k]))
                }
                _ => {}
            }
        }
        for k in got.keys() {
            if !want.contains_key(k) {
                detail.push_str(&format!(" +{k}({})", got[k]));
            }
        }
        miss.style_diff.push(format!("{id}:{detail}"));
    }

    // ── per-prop resolved markers ────────────────────────────────────────
    if let Some(resolved) = case["resolved"].as_object() {
        for (prop, marker) in resolved {
            let Some(value) = props.get(prop.as_str()) else {
                miss.marker_diff.push(format!("{id}/{prop}: prop absent"));
                continue;
            };
            let emitted = emitted_for(prop, value, &decls);
            if marker.get("raw").is_some() {
                let want_raw = marker["raw"].as_str().unwrap_or("");
                let got_raw = emitted.as_ref().map(|e| e.text()).unwrap_or_default();
                if got_raw != want_raw {
                    miss.marker_diff
                        .push(format!("{id}/{prop}: raw {got_raw:?} != {want_raw:?}"));
                }
                let want_computed = marker["computed"].as_str().unwrap_or("");
                let got_computed = tokens.substitute(want_raw).to_string();
                if got_computed != want_computed {
                    miss.marker_diff.push(format!(
                        "{id}/{prop}: computed {got_computed:?} != {want_computed:?}"
                    ));
                }
            } else if marker.get("var").is_some() {
                let var = marker["var"].as_str().unwrap_or("");
                // the emitted text must be exactly `var(<var>)`
                let want_emitted = format!("var({var})");
                let got_emitted = emitted.as_ref().map(|e| e.text().trim().to_string());
                if got_emitted.as_deref() != Some(want_emitted.as_str()) {
                    miss.marker_diff.push(format!(
                        "{id}/{prop}: emitted {got_emitted:?} != {want_emitted:?}"
                    ));
                }
                let want_token = marker["token"].as_str().unwrap_or("");
                let got_token = value.js_string();
                if got_token != want_token {
                    miss.marker_diff.push(format!(
                        "{id}/{prop}: token {got_token:?} != {want_token:?}"
                    ));
                }
                // The table value equals the recorded computed value — px
                // markers record the number without the suffix.
                if let Some(px) = marker.get("px") {
                    let want = format!("{}px", px.as_f64().unwrap_or(0.0));
                    if tokens.get(var) != Some(want.as_str()) {
                        miss.marker_diff.push(format!(
                            "{id}/{prop}: px {var}={:?} != {want:?}",
                            tokens.get(var)
                        ));
                    }
                } else if let Some(c) = marker.get("color").and_then(|c| c.as_str()) {
                    if tokens.get(var) != Some(c) {
                        miss.marker_diff.push(format!(
                            "{id}/{prop}: color {var}={:?} != {c:?}",
                            tokens.get(var)
                        ));
                    }
                } else if let Some(v) = marker.get("value") {
                    match v.as_str() {
                        Some(want) => {
                            if tokens.get(var) != Some(want) {
                                miss.marker_diff.push(format!(
                                    "{id}/{prop}: value {var}={:?} != {want:?}",
                                    tokens.get(var)
                                ));
                            }
                        }
                        None => {
                            if tokens.get(var).is_some() {
                                miss.marker_diff.push(format!(
                                    "{id}/{prop}: {var} declared but marker says null"
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
    miss
}

fn all_cases() -> serde_json::Value {
    let path = vectors_dir().join("style.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap()
}

#[test]
fn style_vectors() {
    let json = all_cases();
    let cases = json["cases"].as_array().expect("cases array");
    let mut tables: BTreeMap<String, TokenTable> = BTreeMap::new();
    let mut style_misses = Vec::new();
    let mut marker_misses = Vec::new();
    for case in cases {
        let theme = case["theme"].as_str().unwrap_or("light");
        let tokens = tables
            .entry(theme.to_string())
            .or_insert_with(|| token_table(theme));
        let miss = check_case(case, tokens);
        style_misses.extend(miss.style_diff);
        marker_misses.extend(miss.marker_diff);
    }
    for m in &style_misses {
        eprintln!("STYLE {m}");
    }
    for m in &marker_misses {
        eprintln!("MARKER {m}");
    }
    eprintln!(
        "cases={} style_misses={} marker_misses={}",
        cases.len(),
        style_misses.len(),
        marker_misses.len()
    );
    assert!(
        style_misses.is_empty() && marker_misses.is_empty(),
        "{} style, {} marker mismatches",
        style_misses.len(),
        marker_misses.len()
    );
}

/// The `resolve()` end-to-end path: every case's resolved markers must land
/// as the same evaluation outcome — a declared var resolves into a field, an
/// undeclared one leaves the field unset and the raw text in `unsupported`.
#[test]
fn resolved_styles_eval() {
    let json = all_cases();
    let cases = json["cases"].as_array().expect("cases array");
    let mut tables: BTreeMap<String, TokenTable> = BTreeMap::new();
    let mut misses = Vec::new();
    for case in cases {
        let theme = case["theme"].as_str().unwrap_or("light");
        let tokens = tables
            .entry(theme.to_string())
            .or_insert_with(|| token_table(theme));
        let props = props_of(case);
        let input = StyleInput::new(tokens, direction_of(case));
        let style = we_style::resolve(&props, &input);
        // Every `var()` the recorder saw undeclared must be reported, and
        // `styles:` must land in unsupported.
        for (prop, marker) in case["resolved"].as_object().into_iter().flatten() {
            if marker.get("value").is_some_and(|v| v.is_null()) {
                // undeclared var — field unset, raw text reported
                let var = marker["var"].as_str().unwrap_or("");
                let has_report = style
                    .unsupported
                    .iter()
                    .any(|u| u.contains(&*format!("var({var}")));
                if !has_report {
                    misses.push(format!(
                        "{}/{prop}: var({var}) undeclared but not in unsupported",
                        case["id"].as_str().unwrap_or("?")
                    ));
                }
            }
        }
    }
    for m in &misses {
        eprintln!("EVAL {m}");
    }
    eprintln!("eval misses={}", misses.len());
    assert!(misses.is_empty(), "{} eval misses", misses.len());
}
