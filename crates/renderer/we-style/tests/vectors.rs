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
    build_layout_decls, emitted_for, Bag, Color, Dimension, Direction, Edges, LineHeight, Style,
    StyleInput, TokenTable, ZIndex,
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

fn bag(key: &str, value: &str) -> Bag {
    [(Arc::from(key), Value::Str(Arc::from(value)))]
        .into_iter()
        .collect()
}

/// Ground truth against the recorded `light` table. The numbers below are
/// what the browser computed, so this pins the whole pipeline — prop →
/// emitted declaration → `var()` substitution → field evaluation — to values
/// that are known independently of any vector.
#[test]
fn known_token_values_light() {
    use we_style::{Dimension, Easing, ZIndex};

    let tokens = token_table("light");
    let input = StyleInput::new(&tokens, Direction::Row);

    // The table itself records resolved values — spot-check the raw strings.
    assert_eq!(tokens.get("--we-space-400"), Some("16px"));
    assert_eq!(tokens.get("--we-radius-pill"), Some("9999px"));
    assert_eq!(tokens.get("--we-radius-full"), Some("50%"));
    assert_eq!(tokens.get("--we-font-weight-700"), Some("700"));

    // space-400 flows through `p` → `padding: var(--we-space-400)` → 16px.
    let s = we_style::resolve(&bag("p", "400"), &input);
    assert_eq!(s.layout.padding.top, Some(Dimension::Px(16.0)));

    // The radius scale is distinct and strictly increasing.
    for (token, px) in [
        ("100", 2.0),
        ("200", 4.0),
        ("300", 6.0),
        ("400", 8.0),
        ("500", 12.0),
        ("600", 16.0),
    ] {
        let s = we_style::resolve(&bag("r", token), &input);
        assert_eq!(
            s.paint.radius.top,
            Some(Dimension::Px(px)),
            "radius-{token} should be {px}px"
        );
    }
    // pill is the capsule token; full is the circle token.
    let s = we_style::resolve(&bag("r", "pill"), &input);
    assert_eq!(s.paint.radius.top, Some(Dimension::Px(9999.0)));
    let s = we_style::resolve(&bag("r", "full"), &input);
    assert_eq!(s.paint.radius.top, Some(Dimension::Percent(0.5)));

    // Weights are numbers, not lengths.
    let s = we_style::resolve(&bag("fontWeight", "700"), &input);
    assert_eq!(s.text.font_weight, Some(700.0));

    // Durations and easings resolve out of the transition shorthand.
    let s = we_style::resolve(&bag("transition", "opacity 300 ease-out"), &input);
    assert_eq!(s.transitions.len(), 1);
    assert_eq!(s.transitions[0].duration_ms, Some(250.0));
    assert_eq!(s.transitions[0].easing, Easing::EaseOut);

    // Named z layers resolve to their recorded numbers.
    let s = we_style::resolve(&bag("zIndex", "modal"), &input);
    assert_eq!(s.paint.z_index, Some(ZIndex::Value(300)));
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

// ── evaluated-field assertions ────────────────────────────────────────────
//
// The `resolved` markers describe tokens and emitted text; these helpers map
// each marker onto the `Style` fields the evaluation must land in. The
// expectations come from the *recorded* values (`px`, `color`, `value`,
// `raw`), never by re-running the crate's own evaluator — the colour oracle
// below is a second, independently written implementation of the CSS Color 4
// conversions, so a wrong constant in `color.rs` cannot cancel itself out.

/// The shorthand precedence chains: each slot's value comes from the first
/// truthy prop in its chain (the same order `buildLayoutStyles` reads), so
/// `{"p":"300","pl":"500"}` leaves `p` owning top/right/bottom only.
const P_CHAIN: [[&str; 3]; 4] = [
    ["pt", "py", "p"],
    ["pr", "px", "p"],
    ["pb", "py", "p"],
    ["pl", "px", "p"],
];
const M_CHAIN: [[&str; 3]; 4] = [
    ["mt", "my", "m"],
    ["mr", "mx", "m"],
    ["mb", "my", "m"],
    ["ml", "mx", "m"],
];
const R_CHAIN: [[&str; 4]; 4] = [
    ["rtl", "rt", "rl", "r"],
    ["rtr", "rt", "rr", "r"],
    ["rbr", "rb", "rr", "r"],
    ["rbl", "rb", "rl", "r"],
];

/// The chain slots `prop` wins — index 0..4 = top/right/bottom/left (or
/// top-left/top-right/bottom-right/bottom-left for radius).
fn owned_slots<const N: usize>(props: &Bag, chains: &[[&str; N]; 4], prop: &str) -> Vec<usize> {
    (0..4)
        .filter(|&i| {
            chains[i]
                .iter()
                .find(|k| props.get(**k).is_some_and(|v| v.truthy()))
                .is_some_and(|k| *k == prop)
        })
        .collect()
}

/// The `Option<Dimension>` fields `prop` drives in `style`. Edge-family props
/// claim only the slots they own; everything else maps one-to-one.
fn dim_fields(style: &Style, props: &Bag, prop: &str) -> Vec<Option<Dimension>> {
    let l = &style.layout;
    let p = &style.paint;
    let pick = |e: &Edges<Option<Dimension>>, slots: Vec<usize>| {
        let all = [e.top, e.right, e.bottom, e.left];
        slots.into_iter().map(|i| all[i]).collect()
    };
    match prop {
        "p" | "px" | "py" | "pt" | "pr" | "pb" | "pl" => {
            pick(&l.padding, owned_slots(props, &P_CHAIN, prop))
        }
        "m" | "mx" | "my" | "mt" | "mr" | "mb" | "ml" => {
            pick(&l.margin, owned_slots(props, &M_CHAIN, prop))
        }
        "r" | "rt" | "rr" | "rb" | "rl" | "rtl" | "rtr" | "rbr" | "rbl" => {
            pick(&p.radius, owned_slots(props, &R_CHAIN, prop))
        }
        "gap" => l
            .gap
            .map(|(a, b)| vec![Some(a), Some(b)])
            .unwrap_or_default(),
        "width" => vec![l.width],
        "height" => vec![l.height],
        "minWidth" => vec![l.min_width],
        "minHeight" => vec![l.min_height],
        "maxWidth" => vec![l.max_width],
        "maxHeight" => vec![l.max_height],
        "top" => vec![l.inset.top],
        "right" => vec![l.inset.right],
        "bottom" => vec![l.inset.bottom],
        "left" => vec![l.inset.left],
        "fontSize" => vec![style.text.font_size],
        "letterSpacing" => vec![style.text.letter_spacing],
        "borderWidth" => vec![p.border_width],
        _ => vec![],
    }
}

/// The colour fields `prop` drives.
fn color_fields(style: &Style, prop: &str) -> Vec<Option<Color>> {
    match prop {
        "bg" => vec![style.paint.bg],
        "color" => vec![style.text.color],
        "borderColor" => vec![style.paint.border_color],
        _ => vec![],
    }
}

/// A plain `<n><unit>` — an independent reader for the recorded simple
/// forms; compound values return `None`.
fn mini_dim(text: &str) -> Option<Dimension> {
    let t = text.trim();
    if t == "0" {
        return Some(Dimension::Px(0.0));
    }
    let num = |s: &str| s.trim().parse::<f32>().ok();
    for (suffix, f) in [
        ("rem", Dimension::Rem as fn(f32) -> Dimension),
        ("px", Dimension::Px),
        ("em", Dimension::Em),
        ("vmin", Dimension::Vmin),
        ("vmax", Dimension::Vmax),
        ("vw", Dimension::Vw),
        ("vh", Dimension::Vh),
        ("dvw", Dimension::Vw),
        ("dvh", Dimension::Vh),
        ("svw", Dimension::Vw),
        ("svh", Dimension::Vh),
        ("lvw", Dimension::Vw),
        ("lvh", Dimension::Vh),
        ("ch", Dimension::Ch),
        ("ex", Dimension::Ex),
        ("lh", Dimension::Lh),
    ] {
        if let Some(n) = t.strip_suffix(suffix).and_then(num) {
            return Some(f(n));
        }
    }
    if let Some(n) = t.strip_suffix('%').and_then(num) {
        return Some(Dimension::Percent(n / 100.0));
    }
    None
}

/// `name(args…)` — the inner text, or `None`.
fn fn_args<'a>(t: &'a str, name: &str) -> Option<&'a str> {
    t.strip_prefix(name)?.strip_prefix('(')?.strip_suffix(')')
}

/// `<n>` or `<n>%` — `pct_scale` is what `100%` means on the channel.
fn num_or_pct(s: &str, pct_scale: f32) -> Option<f32> {
    let s = s.trim();
    if let Some(p) = s.strip_suffix('%') {
        p.trim().parse::<f32>().ok().map(|v| v * pct_scale)
    } else {
        s.parse::<f32>().ok()
    }
}

/// Independent colour oracle for the recorded forms — `oklch(l c h)`,
/// `oklab(l a b)`, `rgb()/rgba()` — written from the CSS Color 4 spec for
/// this test, deliberately not sharing `color.rs`'s implementation.
fn oracle_color(text: &str) -> Option<Color> {
    let t = text.trim();
    if let Some(inner) = fn_args(t, "oklch").or_else(|| fn_args(t, "oklab")) {
        let lch = t.starts_with("oklch");
        let (head, alpha) = match inner.split_once('/') {
            Some((h, a)) => (h, num_or_pct(a, 0.01)?),
            None => (inner, 1.0),
        };
        let mut it = head.split_whitespace();
        let l = num_or_pct(it.next()?, 0.01)?;
        let x = num_or_pct(it.next()?, 0.004)?;
        let y = it.next()?;
        let (a, b) = if lch {
            let rad: f32 = y.trim_end_matches("deg").parse::<f32>().ok()?.to_radians();
            (x * rad.cos(), x * rad.sin())
        } else {
            (x, y.parse::<f32>().ok()?)
        };
        return Some(oracle_oklab(l, a, b, alpha));
    }
    if let Some(inner) = fn_args(t, "rgb").or_else(|| fn_args(t, "rgba")) {
        let (head, mut alpha) = match inner.split_once('/') {
            Some((h, a)) => (h, num_or_pct(a, 0.01)?),
            None => (inner, 1.0),
        };
        let mut channels = Vec::new();
        if head.contains(',') {
            let mut parts = head.split(',');
            for _ in 0..3 {
                channels.push(num_or_pct(parts.next()?, 2.55)?);
            }
            // A fourth comma argument is alpha — `1.0`/`0.5`/`50%` scale.
            if let Some(a) = parts.next() {
                alpha = num_or_pct(a, 0.01)?;
            }
        } else {
            for p in head.split_whitespace() {
                channels.push(num_or_pct(p, 2.55)?);
            }
        }
        if channels.len() != 3 {
            return None;
        }
        return Some(Color::new(
            (channels[0] / 255.0).clamp(0.0, 1.0),
            (channels[1] / 255.0).clamp(0.0, 1.0),
            (channels[2] / 255.0).clamp(0.0, 1.0),
            alpha.clamp(0.0, 1.0),
        ));
    }
    if let Some(h) = t.strip_prefix('#') {
        let d2 = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
        return match h.len() {
            6 => Some(Color::new(
                d2(0)? as f32 / 255.0,
                d2(2)? as f32 / 255.0,
                d2(4)? as f32 / 255.0,
                1.0,
            )),
            8 => Some(Color::new(
                d2(0)? as f32 / 255.0,
                d2(2)? as f32 / 255.0,
                d2(4)? as f32 / 255.0,
                d2(6)? as f32 / 255.0,
            )),
            _ => None,
        };
    }
    None
}

/// Ottosson's OKLab → sRGB, from the spec's published constants.
#[allow(clippy::excessive_precision)]
fn oracle_oklab(l: f32, a: f32, b: f32, alpha: f32) -> Color {
    let l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = l - 0.0894841775 * a - 1.2914855480 * b;
    let (l, m, s) = (l_.powi(3), m_.powi(3), s_.powi(3));
    let lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    let gamma = |c: f32| {
        (if c <= 0.0031308 {
            12.92 * c
        } else {
            1.055 * c.powf(1.0 / 2.4) - 0.055
        })
        .clamp(0.0, 1.0)
    };
    Color::new(
        gamma(lin[0]),
        gamma(lin[1]),
        gamma(lin[2]),
        alpha.clamp(0.0, 1.0),
    )
}

fn color_close(a: Color, b: Color) -> bool {
    (a.r - b.r).abs() < 0.005
        && (a.g - b.g).abs() < 0.005
        && (a.b - b.b).abs() < 0.005
        && (a.a - b.a).abs() < 0.005
}

/// Did `prop` produce anything? The presence floor for markers whose field
/// shape can't be derived independently (compound text, keywords, enums).
fn prop_landed(style: &Style, props: &Bag, prop: &str, raw: &str) -> bool {
    let (l, t, p) = (&style.layout, &style.text, &style.paint);
    match prop {
        "display" => l.display.is_some(),
        "direction" | "reverse" => l.direction.is_some(),
        "wrap" => l.wrap.is_some(),
        "ax" | "ay" => l.justify.is_some() || l.align.is_some(),
        "alignSelf" => l.align_self.is_some(),
        "gap" => l.gap.is_some(),
        "flex" => l.flex.is_some(),
        "flexShrink" => l.flex_shrink.is_some(),
        "aspectRatio" => l.aspect_ratio.is_some(),
        "position" => l.position.is_some(),
        "overflow" => l.overflow.is_some(),
        "overflowX" => l.overflow_x.is_some(),
        "overflowY" => l.overflow_y.is_some(),
        "scrollbarWidth" => l.scrollbar_width.is_some(),
        "scrollbarGutter" => l.scrollbar_gutter.is_some(),
        "p" | "px" | "py" | "pt" | "pr" | "pb" | "pl" | "m" | "mx" | "my" | "mt" | "mr" | "mb"
        | "ml" | "r" | "rt" | "rr" | "rb" | "rl" | "rtl" | "rtr" | "rbr" | "rbl" | "width"
        | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight" | "top" | "right"
        | "bottom" | "left" | "fontSize" | "letterSpacing" | "borderWidth" => {
            let fields = dim_fields(style, props, prop);
            !fields.is_empty() && fields.iter().all(|f| f.is_some())
        }
        "bg" => p.bg.is_some() || p.bg_image.is_some() || raw.trim() == "none",
        "bgImage" => {
            p.bg_image.is_some()
                || p.bg_image_style.fit.is_some()
                || p.bg_image_style.position.is_some()
                || raw.trim() == "none"
        }
        "color" => t.color.is_some(),
        "opacity" => p.opacity.is_some(),
        "border" => p.borders.as_slice().iter().any(|s| s.is_some()),
        "borderTop" => p.borders.top.is_some(),
        "borderRight" => p.borders.right.is_some(),
        "borderBottom" => p.borders.bottom.is_some(),
        "borderLeft" => p.borders.left.is_some(),
        "borderColor" => p.border_color.is_some(),
        "shadow" | "ring" => p.shadows.is_some(),
        "transform" | "x" | "y" | "rotate" => p.transform.is_some(),
        "cursor" => p.cursor.is_some(),
        "pointerEvents" => p.pointer_events.is_some(),
        "visibility" => p.visibility.is_some(),
        "zIndex" => p.z_index.is_some(),
        "fontFamily" => t.font_family.is_some(),
        "fontWeight" => t.font_weight.is_some(),
        "lineHeight" => t.line_height.is_some(),
        "textAlign" => t.align.is_some(),
        "textDecoration" => t.decoration.is_some(),
        "textTransform" => t.transform.is_some(),
        "whiteSpace" => t.white_space.is_some(),
        "overflowWrap" => t.overflow_wrap.is_some(),
        "transition" => !style.transitions.is_empty(),
        "tone" => style.tone.is_some(),
        _ => false,
    }
}

/// The shorthand decl a prop family emits, if any — `"0 0 0 0"` emits
/// nothing, so a zero-emitting prop on an absent shorthand leaves every
/// field unset.
fn family_shorthand(prop: &str) -> Option<&'static str> {
    match prop {
        "p" | "px" | "py" | "pt" | "pr" | "pb" | "pl" => Some("padding"),
        "m" | "mx" | "my" | "mt" | "mr" | "mb" | "ml" => Some("margin"),
        "r" | "rt" | "rr" | "rb" | "rl" | "rtl" | "rtr" | "rbr" | "rbl" => Some("border-radius"),
        _ => None,
    }
}

/// Props whose value is a number, not a length.
fn num_field(style: &Style, props: &Bag, prop: &str, n: f32) -> bool {
    match prop {
        "fontWeight" => style.text.font_weight == Some(n),
        "opacity" => style.paint.opacity == Some(n),
        "flexShrink" => style.layout.flex_shrink == Some(n),
        "aspectRatio" => style.layout.aspect_ratio == Some(n),
        "lineHeight" => style.text.line_height == Some(LineHeight::Ratio(n)),
        "flex" => style.layout.flex.map(|f| f.grow) == Some(n),
        "zIndex" => style.paint.z_index == Some(ZIndex::Value(n as i32)),
        _ => prop_landed(style, props, prop, &n.to_string()),
    }
}

/// A `{"token","var","value"}` marker's non-null value — the scoped-resolved
/// text, checked per prop kind.
fn check_value_marker(
    misses: &mut Vec<String>,
    id: &str,
    prop: &str,
    resolved: &str,
    style: &Style,
    props: &Bag,
) {
    match prop {
        "fontWeight" => {
            if style.text.font_weight != resolved.trim().parse::<f32>().ok() {
                misses.push(format!(
                    "{id}/{prop}: font_weight {:?} != {resolved:?}",
                    style.text.font_weight
                ));
            }
        }
        "zIndex" => {
            let want = resolved.trim().parse::<i32>().ok().map(ZIndex::Value);
            if style.paint.z_index != want {
                misses.push(format!(
                    "{id}/{prop}: z_index {:?} != {want:?}",
                    style.paint.z_index
                ));
            }
        }
        "lineHeight" => {
            let want = if resolved.trim() == "normal" {
                Some(LineHeight::Normal)
            } else {
                resolved
                    .trim()
                    .parse::<f32>()
                    .ok()
                    .map(LineHeight::Ratio)
                    .or_else(|| mini_dim(resolved).map(LineHeight::Length))
            };
            if style.text.line_height != want {
                misses.push(format!(
                    "{id}/{prop}: line_height {:?} != {want:?}",
                    style.text.line_height
                ));
            }
        }
        "shadow" | "ring" => {
            if style.paint.shadows.is_none() {
                misses.push(format!("{id}/{prop}: shadows unset, want {resolved:?}"));
            }
        }
        _ => {
            // Dimension-valued: "50%" radius, px strings, numbers as px.
            if let Some(d) = mini_dim(resolved) {
                let fields = dim_fields(style, props, prop);
                if fields.is_empty() {
                    misses.push(format!(
                        "{id}/{prop}: no dim field mapping for {resolved:?}"
                    ));
                }
                for f in fields {
                    if f != Some(d) {
                        misses.push(format!("{id}/{prop}: {f:?} != {d:?}"));
                    }
                }
            } else if !prop_landed(style, props, prop, resolved) {
                misses.push(format!("{id}/{prop}: value {resolved:?} produced no field"));
            }
        }
    }
}

/// A `{"raw","computed"}` marker: the authored value must land in a field.
/// Simple dimension/number forms get exact expectations; compound text gets
/// the presence floor.
fn check_raw_marker(
    misses: &mut Vec<String>,
    id: &str,
    prop: &str,
    marker: &serde_json::Value,
    style: &Style,
    props: &Bag,
    decls: &we_style::Decls,
) {
    let raw = marker["raw"].as_str().unwrap_or("");
    // Number props first — `flexShrink: "0"` is a ratio, not a length.
    if let Ok(n) = raw.trim().parse::<f32>() {
        if let Some(shorthand) = family_shorthand(prop) {
            // A dim prop on an unemitted shorthand: `"0 0 0 0"` emits nothing,
            // so the whole family stays unset.
            if !decls.contains_key(shorthand) {
                let fields = dim_fields(style, props, prop);
                if fields.iter().any(|f| f.is_some()) {
                    misses.push(format!(
                        "{id}/{prop}: no {shorthand} decl but a field is set"
                    ));
                }
                return;
            }
        }
        match prop {
            "lineHeight" => {
                if style.text.line_height != Some(LineHeight::Ratio(n)) {
                    misses.push(format!(
                        "{id}/{prop}: line_height {:?} != Ratio({n})",
                        style.text.line_height
                    ));
                }
            }
            _ if !dim_fields(style, props, prop).is_empty() => {
                for f in dim_fields(style, props, prop) {
                    if f != Some(Dimension::Px(n)) {
                        misses.push(format!("{id}/{prop}: {f:?} != Px({n})"));
                    }
                }
            }
            _ => {
                if !num_field(style, props, prop, n) {
                    misses.push(format!("{id}/{prop}: raw number {n} did not land"));
                }
            }
        }
        return;
    }
    if let Some(d) = mini_dim(raw) {
        match prop {
            "lineHeight" => {
                if style.text.line_height != Some(LineHeight::Length(d)) {
                    misses.push(format!(
                        "{id}/{prop}: line_height {:?} != Length({d:?})",
                        style.text.line_height
                    ));
                }
            }
            _ => {
                let fields = dim_fields(style, props, prop);
                if fields.is_empty() {
                    misses.push(format!("{id}/{prop}: no dim field mapping for {raw:?}"));
                }
                for f in fields {
                    if f != Some(d) {
                        misses.push(format!("{id}/{prop}: {f:?} != {d:?}"));
                    }
                }
            }
        }
        return;
    }
    if prop == "gap" {
        let parts: Vec<&str> = raw.split_whitespace().collect();
        if let [a, b] = parts.as_slice() {
            if let (Some(a), Some(b)) = (mini_dim(a), mini_dim(b)) {
                if style.layout.gap != Some((a, b)) {
                    misses.push(format!(
                        "{id}/{prop}: gap {:?} != ({a:?}, {b:?})",
                        style.layout.gap
                    ));
                }
                return;
            }
        }
    }
    if !prop_landed(style, props, prop, raw) {
        misses.push(format!("{id}/{prop}: raw {raw:?} produced no field"));
    }
}

/// The `resolve()` end-to-end path: every case's resolved markers must land
/// as the same evaluation outcome — a declared token resolves into its field
/// with the recorded value, a raw value evaluates, and an undeclared var
/// leaves every field it drives unset with the raw text in `unsupported`.
///
/// A marker's expectation is the recorded value resolved through the
/// *element's own scope*: the emitted `--we-*` decls (a `tone` or `styles`
/// override) overlay the theme table exactly as a browser scopes custom
/// properties — `bg: accent` under `tone: danger` is the danger colour.
#[test]
fn resolved_styles_eval() {
    let json = all_cases();
    let cases = json["cases"].as_array().expect("cases array");
    let mut tables: BTreeMap<String, TokenTable> = BTreeMap::new();
    let mut misses = Vec::new();
    for case in cases {
        let id = case["id"].as_str().unwrap_or("?");
        let theme = case["theme"].as_str().unwrap_or("light");
        let tokens = tables
            .entry(theme.to_string())
            .or_insert_with(|| token_table(theme));
        let props = props_of(case);
        let input = StyleInput::new(tokens, direction_of(case));
        let decls = build_layout_decls(&props, direction_of(case));
        let style = we_style::resolve(&props, &input);
        // The element's custom-property scope: theme vars overlaid with the
        // `--we-*` decls this element emits (tone vars, `styles:` overrides).
        let mut scoped_vars: IndexMap<Arc<str>, Arc<str>> =
            tokens.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (k, v) in decls.iter().filter(|(k, _)| k.starts_with("--we-")) {
            scoped_vars.insert(k.clone(), Arc::from(v.text().as_str()));
        }
        let scoped = TokenTable::new(scoped_vars);
        let resolve_var = |var: &str| scoped.substitute_nested(&format!("var({var})"));
        for (prop, marker) in case["resolved"].as_object().into_iter().flatten() {
            if marker.get("value").is_some_and(|v| v.is_null()) {
                // undeclared var — every field it drives stays unset, and the
                // raw text is reported.
                let var = marker["var"].as_str().unwrap_or("");
                let mut set = dim_fields(&style, &props, prop)
                    .into_iter()
                    .any(|f| f.is_some())
                    || color_fields(&style, prop).into_iter().any(|f| f.is_some());
                if prop == "bg" {
                    set = set || style.paint.bg_image.is_some();
                }
                if set {
                    misses.push(format!(
                        "{id}/{prop}: var({var}) undeclared but a field is set"
                    ));
                }
                let has_report = style
                    .unsupported
                    .iter()
                    .any(|u| u.contains(&*format!("var({var}")));
                if !has_report {
                    misses.push(format!(
                        "{id}/{prop}: var({var}) undeclared but not in unsupported"
                    ));
                }
                continue;
            }
            if let Some(px) = marker.get("px").and_then(|p| p.as_f64()) {
                // The scoped resolution is the expectation — unscoped it must
                // still equal the recorded px (table-checks above pin that).
                let resolved = resolve_var(marker["var"].as_str().unwrap_or(""));
                let want = mini_dim(&resolved).or(Some(Dimension::Px(px as f32)));
                let fields = dim_fields(&style, &props, prop);
                if fields.is_empty() {
                    misses.push(format!("{id}/{prop}: no dim field mapping for px {px}"));
                }
                for f in fields {
                    if f != want {
                        misses.push(format!("{id}/{prop}: {f:?} != {want:?}"));
                    }
                }
            } else if let Some(c) = marker.get("color").and_then(|c| c.as_str()) {
                let resolved = resolve_var(marker["var"].as_str().unwrap_or(""));
                let want = oracle_color(&resolved);
                let fields = color_fields(&style, prop);
                if fields.is_empty() {
                    misses.push(format!("{id}/{prop}: no colour field mapping for {c:?}"));
                }
                for f in fields {
                    match (f, want) {
                        (Some(got), Some(want)) if !color_close(got, want) => misses.push(format!(
                            "{id}/{prop}: {got:?} != oracle {want:?} ({resolved})"
                        )),
                        (None, Some(want)) => misses.push(format!(
                            "{id}/{prop}: colour unset, oracle {want:?} ({resolved})"
                        )),
                        (Some(got), None) => misses.push(format!(
                            "{id}/{prop}: {got:?}, oracle cannot parse {resolved:?}"
                        )),
                        _ => {}
                    }
                }
            } else if let Some(v) = marker.get("value").and_then(|v| v.as_str()) {
                let resolved = resolve_var(marker["var"].as_str().unwrap_or(""));
                check_value_marker(&mut misses, id, prop, &resolved, &style, &props);
                let _ = v;
            } else if marker.get("raw").is_some() {
                check_raw_marker(&mut misses, id, prop, marker, &style, &props, &decls);
            }
        }
    }
    for m in &misses {
        eprintln!("EVAL {m}");
    }
    eprintln!("eval misses={}", misses.len());
    assert!(misses.is_empty(), "{} eval misses", misses.len());
}
