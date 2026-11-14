//! The Coasys bundle's host functions, in Rust.
//!
//! Each is a faithful port of the TypeScript the conformance vectors were
//! recorded from (`packages/app-shell/src/shared/sources/*.ts`, wired in
//! `index.ts`, plus `aggregate.ts`/`weighing.ts`/`involvements.ts`/
//! `provenance.ts` helpers). The vectors in
//! `packages/schema-system/conformance/vectors/host-functions.json` decide —
//! `we-expr/tests/vectors.rs` carries older test-only copies; where they
//! differ from the TS (e.g. `generatedRun`'s `?? null`, `voices`'s
//! `name || shortDid` fallback, `involvementMenu`'s item shapes) this file
//! follows the TS.
//!
//! Functions are pure `options -> Value`: the bundle expression builds the
//! options object itself, so `profiles`/`me` arrive resolved out of the bag —
//! nothing here reaches back into it. Member natives (the `native` rows of the
//! store map) are the opposite shape: they get the whole [`StoreBag`] and read
//! their inputs from it.
//!
//! Option values are always plain data (decoded JSON: `Obj`/`List`/scalars),
//! so [`get`] borrows member fields by reference — a `Namespace` never
//! appears in an options object.
use indexmap::IndexMap;
use std::cmp::Ordering;
use std::sync::Arc;
use unicode_normalization::UnicodeNormalization;
use we_expr::{js_round, js_trim, Value};
use we_template::StoreBag;

use crate::provenance::{member_get, Provenance};

/// The names expressions may call, in registration order.
pub(crate) const HOST_FUNCTIONS: [&str; 9] = [
    "reactions",
    "reactors",
    "voices",
    "voicesParam",
    "signalTally",
    "signalTypesByUse",
    "involvement",
    "involvementMenu",
    "generatedRun",
];

/// Register every host function on the bag. A call is noted `name()` in the
/// provenance's native set — it is "served by a native" just like a member.
pub(crate) fn register_host_functions(bag: &StoreBag, provenance: &Provenance) {
    for name in HOST_FUNCTIONS {
        let prov = provenance.clone();
        bag.set_function(
            name,
            Arc::new(move |args: &[Value]| {
                prov.note_native(format!("{name}()"));
                let options = args.first().cloned().unwrap_or(Value::Undefined);
                run_host_function(name, &options)
            }),
        );
    }
}

/// One function by name — the single entry point `host_functions.rs` tests.
pub fn run_host_function(name: &str, options: &Value) -> Value {
    match name {
        "reactions" => reactions(options),
        "reactors" => reactors(options),
        "signalTally" => signal_tally(options),
        "signalTypesByUse" => signal_types_by_use(options),
        "voices" => voices(options),
        "voicesParam" => voices_param(options),
        "involvement" => involvement(options),
        "involvementMenu" => involvement_menu(options),
        "generatedRun" => generated_run(options),
        _ => Value::Undefined,
    }
}

// ------------------------------------------------------------- helpers ----

static UNDEFINED: Value = Value::Undefined;

/// `options[key]` — plain-object member access. Options are decoded data, so
/// non-objects (including the `Namespace` a real bag member could be) read
/// `Undefined`, matching `undefined.member` in the sources.
fn get<'a>(v: &'a Value, key: &str) -> &'a Value {
    match v {
        Value::Obj(o) => o.get(key).unwrap_or(&UNDEFINED),
        _ => &UNDEFINED,
    }
}

fn as_list(v: &Value) -> &[Value] {
    match v {
        Value::List(l) => l.as_slice(),
        _ => &[],
    }
}

fn as_str(v: &Value) -> &str {
    match v {
        Value::Str(s) => s,
        _ => "",
    }
}

fn as_num(v: &Value) -> Option<f64> {
    match v {
        Value::Num(n) => Some(*n),
        _ => None,
    }
}

fn str_or(v: &Value) -> Option<&str> {
    match v {
        Value::Str(s) => Some(s),
        _ => None,
    }
}

/// `Number(x) || 0` — `NaN` and `0` itself collapse to `0`.
fn num_or_zero(v: &Value) -> f64 {
    let n = v.js_number();
    if n != 0.0 && n.is_finite() {
        n
    } else {
        0.0
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut map = IndexMap::new();
    for (k, v) in pairs {
        map.insert(k.into(), v);
    }
    Value::Obj(Arc::new(map))
}

fn list(items: Vec<Value>) -> Value {
    Value::List(Arc::new(items))
}

/// `new Map(profiles.map(p => [p.did, p]))` — the last row for a did wins.
/// Only a string did can ever be looked up, so non-strings never enter.
fn by_did(profiles: &[Value]) -> IndexMap<&str, &Value> {
    let mut map = IndexMap::new();
    for p in profiles {
        if let Some(did) = str_or(get(p, "did")) {
            map.insert(did, p);
        }
    }
    map
}

/// `String.prototype.localeCompare`, levelled the way the UCA levels it:
/// the base letters decide first — case and accents only break ties — then
/// the accents, then the case (lowercase before uppercase), then the raw
/// text. NFD makes "é" and "e\u{301}" tie, as in ICU.
fn locale_cmp(a: &str, b: &str) -> Ordering {
    let (ap, am, ac) = collation_keys(a);
    let (bp, bm, bc) = collation_keys(b);
    ap.cmp(&bp)
        .then_with(|| am.cmp(&bm))
        .then_with(|| ac.cmp(&bc))
        .then_with(|| a.cmp(b))
}

/// A weight for an expanded letter (æ, ß, ø, …): it sorts after every real
/// accent, so "o" < "ø" and "ss" < "ß" like `localeCompare` has them.
const VARIANT_MARK: u16 = 0x8000;

/// Letters NFD leaves whole but ICU folds into their base letters at the
/// primary level. Each reads as the string it stands for, marked VARIANT so
/// the plain spelling still wins the tie-break.
fn expansion(base: char) -> Option<&'static str> {
    match base {
        'æ' | 'Æ' => Some("ae"),
        'œ' | 'Œ' => Some("oe"),
        'ß' | 'ẞ' => Some("ss"),
        'ø' | 'Ø' => Some("o"),
        'đ' | 'Đ' | 'ð' | 'Ð' => Some("d"),
        'ł' | 'Ł' => Some("l"),
        'þ' | 'Þ' => Some("th"),
        'ŋ' | 'Ŋ' => Some("n"),
        'ħ' | 'Ħ' => Some("h"),
        'ı' => Some("i"),
        'ĸ' => Some("k"),
        'ŧ' | 'Ŧ' => Some("t"),
        _ => None,
    }
}

/// An accent's secondary weight, in the order ICU orders them
/// (acute < grave < breve < circumflex < caron < diaeresis < tilde < dot
/// above < cedilla < ogonek < macron < dot below < double grave — recorded
/// from V8, not codepoint order). Marks outside the table still sort, by
/// codepoint, between the known marks and the letter variants.
fn mark_weight(mark: char) -> u16 {
    match mark {
        '\u{301}' => 2,  // acute
        '\u{300}' => 3,  // grave
        '\u{306}' => 4,  // breve
        '\u{302}' => 5,  // circumflex
        '\u{30C}' => 6,  // caron
        '\u{308}' => 7,  // diaeresis
        '\u{303}' => 8,  // tilde
        '\u{307}' => 9,  // dot above
        '\u{327}' => 10, // cedilla
        '\u{328}' => 11, // ogonek
        '\u{304}' => 12, // macron
        '\u{323}' => 13, // dot below
        '\u{30F}' => 14, // double grave
        _ => 0x100 + mark as u16,
    }
}

/// One char's share of the three collation keys: its base letters, the
/// accent weights aligned to each base letter, and its case rank.
fn collation_keys(s: &str) -> (Vec<char>, Vec<Vec<u16>>, Vec<u8>) {
    let (mut primary, mut marks, mut case) = (Vec::new(), Vec::new(), Vec::new());
    for c in s.chars() {
        case.push(if c.is_uppercase() { 1 } else { 0 });
        let mut decomposed = c.nfd();
        let base = decomposed.next().unwrap_or(c);
        let accents: Vec<u16> = decomposed.map(mark_weight).collect();
        if let Some(exp) = expansion(base) {
            for (i, e) in exp.chars().enumerate() {
                primary.push(e);
                marks.push(if i == 0 {
                    [VARIANT_MARK]
                        .into_iter()
                        .chain(accents.iter().copied())
                        .collect()
                } else {
                    Vec::new()
                });
            }
        } else {
            let mut lower = base.to_lowercase();
            primary.extend(lower.next());
            marks.push(accents);
            for lc in lower {
                primary.push(lc);
                marks.push(Vec::new());
            }
        }
    }
    (primary, marks, case)
}

/// `relationId` — a string, a one-element list's head, or an object's `id`.
fn relation_id(v: &Value) -> String {
    match v {
        Value::Str(s) => s.to_string(),
        Value::List(l) => relation_id(l.first().unwrap_or(&UNDEFINED)),
        _ => as_str(get(v, "id")).to_string(),
    }
}

/// `idOf` — generatedRun's read: a string, or an object's `id`. No list step.
fn id_of(v: &Value) -> String {
    match v {
        Value::Str(s) => s.to_string(),
        _ => as_str(get(v, "id")).to_string(),
    }
}

// ------------------------------------------------------------ signals -----

/// `reactions` — signal rows with this agent's held write overlaid.
fn reactions(options: &Value) -> Value {
    let rows = as_list(get(options, "signals")).to_vec();
    let (record, type_, me) = (
        get(options, "record"),
        get(options, "type"),
        get(options, "me"),
    );
    // `!Array.isArray(pending) || record/type/me not strings` → rows untouched.
    if !matches!(get(options, "pending"), Value::List(_))
        || !matches!(record, Value::Str(_))
        || !matches!(type_, Value::Str(_))
        || !matches!(me, Value::Str(_))
    {
        return list(rows);
    }
    let held = as_list(get(options, "pending")).iter().find(|entry| {
        get(entry, "record").strict_eq(record) && get(entry, "type").strict_eq(type_)
    });
    let Some(held) = held else { return list(rows) };
    let value = get(held, "value");
    if !matches!(value, Value::Num(_) | Value::Null) {
        return list(rows);
    }
    let others: Vec<Value> = rows
        .into_iter()
        .filter(|row| !get(row, "author").strict_eq(me))
        .collect();
    if matches!(value, Value::Null) {
        return list(others);
    }
    let mut out = others;
    out.push(obj(vec![
        ("author", me.clone()),
        ("signalTypeId", type_.clone()),
        ("value", value.clone()),
    ]));
    list(out)
}

/// `reactors` — the people behind the signals: `me` first, then by name.
fn reactors(options: &Value) -> Value {
    let rows = as_list(get(options, "signals"));
    let cache = as_list(get(options, "profiles"));
    let mine = as_str(get(options, "me"));
    let needle = js_trim(as_str(get(options, "search"))).to_lowercase();

    let by_did = by_did(cache);
    let mut all: Vec<Value> = Vec::new();
    for row in rows {
        let Some(author) = str_or(get(row, "author")) else {
            continue;
        };
        let profile = by_did.get(author).copied();
        // `typeof profile?.name === 'string' ? profile.name : ''` — an empty
        // name stays empty (no `||` fallback here, unlike `voices`).
        let name = profile.and_then(|p| str_or(get(p, "name"))).unwrap_or("");
        let avatar = profile.and_then(|p| str_or(get(p, "avatar"))).unwrap_or("");
        all.push(obj(vec![
            ("did", author.into()),
            ("name", name.into()),
            ("avatar", avatar.into()),
            ("value", as_num(get(row, "value")).unwrap_or(0.0).into()),
            ("mine", (author == mine).into()),
        ]));
    }
    // Reader first; the rest by name. `sort_by` is stable, as JS sort is.
    all.sort_by(|a, b| {
        let (am, bm) = (get(a, "mine").truthy(), get(b, "mine").truthy());
        if am == bm {
            locale_cmp(as_str(get(a, "name")), as_str(get(b, "name")))
        } else if am {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    let unresolved = if needle.is_empty() {
        0
    } else {
        all.iter()
            .filter(|p| as_str(get(p, "name")).is_empty())
            .count()
    };
    let matching: Vec<Value> = if needle.is_empty() {
        all.clone()
    } else {
        all.iter()
            .filter(|p| as_str(get(p, "name")).to_lowercase().contains(&needle))
            .cloned()
            .collect()
    };
    obj(vec![
        ("people", matching.into()),
        ("total", all.len().into()),
        ("unresolved", unresolved.into()),
    ])
}

/// `aggregateFor` — the type's own aggregate, with the two `count`
/// corrections. Every falsy `aggregate` is absent (`""` included), and a
/// truthy non-string comes back untouched — the TS switch on its value
/// would land on `default` either way.
fn aggregate_for(t: &Value) -> Value {
    let mode = as_str(get(t, "mode"));
    let fallback = match mode {
        "toggle" => "count",
        "vote" => "sum",
        "rating" | "slider" => "mean",
        _ => "count",
    };
    let aggregate = get(t, "aggregate");
    if !aggregate.truthy()
        || (matches!(aggregate, Value::Str(s) if s.as_ref() == "count") && mode != "toggle")
    {
        fallback.into()
    } else {
        aggregate.clone()
    }
}

/// `signalTally` — one number for a type's signals, or the head count.
fn signal_tally(options: &Value) -> Value {
    // `!Array.isArray(signals)` → 0.
    let Value::List(signals) = get(options, "signals") else {
        return 0.into();
    };
    let rows: Vec<f64> = signals
        .iter()
        .filter(|s| matches!(s, Value::Obj(_) | Value::Namespace(_)))
        .filter_map(|s| as_num(get(s, "value")))
        .collect();
    let type_ = get(options, "type");
    let is_typed = matches!(type_, Value::Obj(_)) && str_or(get(type_, "mode")).is_some();
    if !is_typed {
        return rows.iter().filter(|v| **v != 0.0).count().into();
    }
    if rows.is_empty() {
        return 0.into();
    }
    let round = |n: f64| js_round(n * 10.0) / 10.0;
    // The TS switch on the aggregate's value — string names hit their arm,
    // anything else (a number, a list) lands on `default` — the mean.
    match as_str(&aggregate_for(type_)) {
        "count" => rows.iter().filter(|v| **v != 0.0).count().into(),
        "sum" => rows.iter().sum::<f64>().into(),
        "median" => {
            let mut sorted = rows.clone();
            sorted.sort_by(f64::total_cmp);
            let mid = sorted.len() / 2;
            let v = if sorted.len() % 2 == 1 {
                sorted[mid]
            } else {
                (sorted[mid - 1] + sorted[mid]) / 2.0
            };
            round(v).into()
        }
        _ => round(rows.iter().sum::<f64>() / rows.len() as f64).into(),
    }
}

/// `signalTypesByUse` — types ordered by head count, the settled `order` first.
fn signal_types_by_use(options: &Value) -> Value {
    if !matches!(get(options, "types"), Value::List(_)) {
        return list(Vec::new());
    }
    let types = as_list(get(options, "types")).to_vec();
    let rows = as_list(get(options, "signals"));
    let hidden: Vec<&str> = as_list(get(options, "muted"))
        .iter()
        .filter_map(|d| str_or(d))
        .collect();
    let mut counts: IndexMap<String, f64> = IndexMap::new();
    for row in rows {
        let Some(id) = str_or(get(row, "signalTypeId")) else {
            continue;
        };
        if str_or(get(row, "author")).is_some_and(|a| hidden.contains(&a)) {
            continue;
        }
        *counts.entry(id.to_string()).or_default() += 1.0;
    }
    let used = |t: &Value| {
        str_or(get(t, "id"))
            .and_then(|id| counts.get(id).copied())
            .unwrap_or(0.0)
    };
    // Settled order first; a type it never saw goes after all it did.
    // `new Map(settled.map((id, at) => [id, at]))` — a repeated id keeps
    // its last index, like every other Map the sources build.
    let rank: IndexMap<&str, usize> = as_list(get(options, "order"))
        .iter()
        .enumerate()
        .filter_map(|(at, id)| str_or(id).map(|id| (id, at)))
        .collect();
    let placed = |t: &Value| str_or(get(t, "id")).and_then(|id| rank.get(id).copied());
    let mut ordered = types;
    ordered.sort_by(|a, b| match (placed(a), placed(b)) {
        (Some(l), Some(r)) => l.cmp(&r),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => used(b)
            .partial_cmp(&used(a))
            .unwrap_or(std::cmp::Ordering::Equal),
    });
    if let Some(limit) = as_num(get(options, "limit")).filter(|l| *l >= 0.0) {
        ordered.truncate(limit as usize);
    }
    list(ordered)
}

// ------------------------------------------------------------- voices -----

/// `parseWeights` — `did=50,did=0` whole-percent text, or a map of fractions.
fn parse_weights(weights: &Value) -> IndexMap<String, f64> {
    let mut parsed = IndexMap::new();
    let put = |parsed: &mut IndexMap<String, f64>, who: &str, share: f64| {
        if !who.is_empty() && share.is_finite() {
            parsed.insert(who.to_string(), share.clamp(0.0, 1.0));
        }
    };
    match weights {
        Value::Str(s) => {
            for entry in s.split(',') {
                let Some(split) = entry.rfind('=') else {
                    continue;
                };
                // An empty share is not a zero — `Number('')` is 0 and would
                // mute somebody over a stray `=`. Both trims are JS's —
                // the BOM `U+FEFF` cuts, `U+0085` NEL stays.
                let share = js_trim(&entry[split + 1..]);
                if split > 0 && !share.is_empty() {
                    let n = Value::Str(share.into()).js_number();
                    put(&mut parsed, js_trim(&entry[..split]), n / 100.0);
                }
            }
        }
        Value::Obj(o) => {
            for (who, share) in o.iter() {
                put(&mut parsed, who, share.js_number());
            }
        }
        _ => {}
    }
    parsed
}

fn short_did(did: &str) -> String {
    if did.chars().count() > 16 {
        let head: String = did.chars().take(12).collect();
        let tail: String = did
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        format!("{head}…{tail}")
    } else {
        did.to_string()
    }
}

/// `voices` — summary rows joined to profiles and the address's weights.
fn voices(options: &Value) -> Value {
    let rows = as_list(get(get(options, "summary"), "voices"));
    let profiles = as_list(get(options, "profiles"));
    let by_did = by_did(profiles);
    let me = get(options, "me");
    let weights = parse_weights(get(options, "param"));

    let mut listed: Vec<Value> = Vec::new();
    for row in rows {
        let Some(did) = str_or(get(row, "author")).filter(|d| !d.is_empty()) else {
            continue;
        };
        let profile = by_did.get(did).copied();
        let pretend = str_or(get(row, "name")).is_some_and(|n| !n.is_empty());
        // `profile?.name || shortDid(did)` — an empty name falls back.
        let name = if pretend {
            as_str(get(row, "name")).to_string()
        } else {
            profile
                .and_then(|p| str_or(get(p, "name")))
                .filter(|n| !n.is_empty())
                .unwrap_or(&short_did(did))
                .to_string()
        };
        let avatar = if pretend {
            String::new()
        } else {
            profile
                .and_then(|p| str_or(get(p, "avatar")))
                .unwrap_or("")
                .to_string()
        };
        let weight = js_round(weights.get(did).copied().unwrap_or(1.0) * 100.0);
        listed.push(obj(vec![
            ("did", did.into()),
            ("name", name.into()),
            ("avatar", avatar.into()),
            ("cards", num_or_zero(get(row, "cards")).into()),
            ("mean", num_or_zero(get(row, "mean")).into()),
            ("weight", weight.into()),
            ("share", 0.into()),
            ("mine", get(row, "author").strict_eq(me).into()),
            ("pretend", pretend.into()),
        ]));
    }
    let total: f64 = listed
        .iter()
        .map(|v| as_num(get(v, "weight")).unwrap_or(0.0))
        .sum();
    for v in &mut listed {
        let share = if total != 0.0 {
            js_round(as_num(get(v, "weight")).unwrap_or(0.0) / total * 100.0)
        } else {
            0.0
        };
        if let Value::Obj(o) = v {
            Arc::make_mut(o).insert("share".into(), share.into());
        }
    }
    list(listed)
}

/// `voicesParam` — the address form with one voice changed, or `only` kept.
fn voices_param(options: &Value) -> Value {
    let mut weights = parse_weights(get(options, "param"));
    let only = get(options, "only");
    let did = get(options, "did");
    if str_or(only).is_some_and(|o| !o.is_empty()) {
        for entry in as_list(get(options, "voices")) {
            let who = match entry {
                Value::Str(s) => Some(s.to_string()),
                _ => str_or(get(entry, "did")).map(str::to_string),
            };
            if let Some(who) = who.filter(|w| !w.is_empty()) {
                weights.insert(who, 0.0);
            }
        }
        weights.shift_remove(as_str(only));
    } else if str_or(did).is_some_and(|d| !d.is_empty()) {
        // `Math.min(100, Math.max(0, Math.round(Number(weight))))` — NaN
        // survives `Math.max`/`Math.min` in JS, so clamp by hand.
        let share = js_round(get(options, "weight").js_number());
        let share = if share.is_nan() {
            share
        } else {
            share.clamp(0.0, 100.0)
        };
        if !share.is_finite() || share >= 100.0 {
            weights.shift_remove(as_str(did));
        } else {
            weights.insert(as_str(did).to_string(), share / 100.0);
        }
    }
    weights
        .iter()
        // `${who}=${Math.round(share * 100)}` — `String()` writes -0 as
        // "0", so the number goes through js_string, not Display.
        .map(|(who, share)| format!("{who}={}", Value::Num(js_round(share * 100.0)).js_string()))
        .collect::<Vec<_>>()
        .join(",")
        .into()
}

// -------------------------------------------------------- involvement -----

const SEMANTICS: [&str; 5] = [
    "responsible",
    "reviewing",
    "committed",
    "interested",
    "declined",
];

fn tone_for(semantic: &str) -> &'static str {
    if semantic == "reviewing" {
        "warning"
    } else {
        ""
    }
}

/// `applyPendingInvolvements` — held writes over observed rows.
fn apply_pending(rows: Vec<Value>, pending: &[Value]) -> Vec<Value> {
    if pending.is_empty() {
        return rows;
    }
    let key = |node: &str, agent: &str, kind: &str| format!("{node}\u{0}{agent}\u{0}{kind}");
    let held: std::collections::HashMap<String, &Value> = pending
        .iter()
        .map(|p| {
            (
                key(
                    &relation_id(get(p, "node")),
                    as_str(get(p, "agent")),
                    as_str(get(p, "kind")),
                ),
                p,
            )
        })
        .collect();
    let row_key = |row: &Value| {
        key(
            &relation_id(get(row, "node")),
            as_str(get(row, "agent")),
            as_str(get(row, "kind")),
        )
    };
    let mut out: Vec<Value> = rows
        .into_iter()
        .filter(|row| {
            held.get(&row_key(row))
                .is_none_or(|e| get(e, "on").truthy())
        })
        .collect();
    let mut present: std::collections::HashSet<String> = out.iter().map(&row_key).collect();
    for entry in pending {
        let k = key(
            &relation_id(get(entry, "node")),
            as_str(get(entry, "agent")),
            as_str(get(entry, "kind")),
        );
        if get(entry, "on").truthy() && !present.contains(&k) {
            present.insert(k);
            out.push(obj(vec![
                ("node", get(entry, "node").clone()),
                ("agent", get(entry, "agent").clone()),
                ("kind", get(entry, "kind").clone()),
            ]));
        }
    }
    out
}

/// `involvement` — `{byNode, answers, dids}` from the raw rows.
fn involvement(options: &Value) -> Value {
    // `types.filter(t => t && t.slug)` — a Map keeps the LAST of a duplicated
    // slug (IndexMap::insert overwrites the value in place).
    let mut by_slug: IndexMap<&str, &Value> = IndexMap::new();
    for t in as_list(get(options, "types")) {
        if let Some(slug) = str_or(get(t, "slug")).filter(|s| !s.is_empty()) {
            by_slug.insert(slug, t);
        }
    }
    let rows = apply_pending(
        as_list(get(options, "rows"))
            .iter()
            .filter(|r| matches!(r, Value::Obj(_) | Value::Namespace(_)))
            .cloned()
            .collect(),
        as_list(get(options, "pending")),
    );
    let me = as_str(get(options, "me"));
    // `nodes` is a JS Set of raw values — only a string entry can `has(node)`.
    let counted = match get(options, "nodes") {
        Value::List(l) => Some(l),
        _ => None,
    };
    let in_counted = |node: &str| {
        counted.as_ref().is_none_or(|l| {
            l.iter()
                .any(|n| matches!(n, Value::Str(s) if s.as_ref() == node))
        })
    };

    let mut by_node: IndexMap<Arc<str>, Value> = IndexMap::new();
    let mut answers: IndexMap<Arc<str>, Value> = IndexMap::new();
    let mut everyone: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for row in &rows {
        let node = relation_id(get(row, "node"));
        let did = as_str(get(row, "agent")).to_string();
        let kind = as_str(get(row, "kind")).to_string();
        if node.is_empty() || did.is_empty() || kind.is_empty() {
            continue;
        }
        let entry = by_node.entry(node.as_str().into()).or_insert_with(|| {
            obj(vec![
                ("people", list(Vec::new())),
                ("dids", list(Vec::new())),
                ("responsible", list(Vec::new())),
                ("reviewing", list(Vec::new())),
                ("committed", list(Vec::new())),
                ("interested", list(Vec::new())),
                ("declined", list(Vec::new())),
                ("pairs", list(Vec::new())),
            ])
        });
        let pair = format!("{did}|{kind}");
        {
            let pairs = list_field_mut(entry, "pairs");
            if pairs.iter().any(|v| as_str(v) == pair) {
                continue;
            }
            pairs.push(pair.into());
        }

        let type_ = by_slug.get(kind.as_str()).copied();
        let semantic = type_
            .and_then(|t| str_or(get(t, "semantic")))
            .filter(|s| SEMANTICS.contains(s))
            .unwrap_or("responsible");
        // `type?.name || kind` — an empty name falls back to the slug.
        let name = type_
            .and_then(|t| str_or(get(t, "name")))
            .filter(|n| !n.is_empty())
            .unwrap_or(&kind);
        let person = obj(vec![
            ("did", did.clone().into()),
            ("kind", kind.clone().into()),
            ("name", name.into()),
            ("semantic", semantic.into()),
            (
                "reflexive",
                type_.is_some_and(|t| get(t, "reflexive").truthy()).into(),
            ),
            (
                "icon",
                type_
                    .and_then(|t| str_or(get(t, "icon")))
                    .unwrap_or("")
                    .into(),
            ),
            (
                "color",
                type_
                    .and_then(|t| str_or(get(t, "color")))
                    .unwrap_or("")
                    .into(),
            ),
            ("tone", tone_for(semantic).into()),
        ]);
        list_field_mut(entry, "people").push(person);
        push_unique_str(list_field_mut(entry, semantic), &did);
        if semantic != "declined" {
            push_unique_str(list_field_mut(entry, "dids"), &did);
            if in_counted(&node) && !seen.contains(&did) {
                seen.insert(did.clone());
                everyone.push(did.clone());
            }
        }
        if did == me && type_.is_some_and(|t| get(t, "reflexive").truthy()) {
            answers.insert(node.as_str().into(), kind.into());
        }
    }

    for entry in by_node.values_mut() {
        let people = list_field_mut(entry, "people");
        people.sort_by_key(|p| {
            SEMANTICS
                .iter()
                .position(|s| *s == as_str(get(p, "semantic")))
                .unwrap_or(0)
        });
    }
    if let Some(at) = everyone.iter().position(|d| d == me).filter(|at| *at > 0) {
        let d = everyone.remove(at);
        everyone.insert(0, d);
    }
    obj(vec![
        ("byNode", Value::Obj(Arc::new(by_node))),
        ("answers", Value::Obj(Arc::new(answers))),
        (
            "dids",
            everyone
                .into_iter()
                .map(Value::from)
                .collect::<Vec<Value>>()
                .into(),
        ),
    ])
}

/// `involvementMenu` — suggestion, "Assign to me", then a group per kind.
fn involvement_menu(options: &Value) -> Value {
    // `options?.node ?? ''` then `if (!node) return []` — truthiness, then
    // the byNode property key is `String(node)`.
    let node_raw = get(options, "node");
    let node = if matches!(node_raw, Value::Undefined | Value::Null) {
        String::new()
    } else {
        node_raw.js_string()
    };
    if !node_raw.truthy() {
        return list(Vec::new());
    }
    let entity = get(options, "entity");
    let me = as_str(get(options, "me")).to_string();

    let kinds: Vec<Value> = as_list(get(options, "types"))
        .iter()
        .filter(|k| {
            str_or(get(k, "slug")).is_some_and(|s| !s.is_empty())
                && !get(k, "reflexive").truthy()
                && !get(k, "retired").truthy()
                && applies(get(k, "appliesTo"), entity)
        })
        .cloned()
        .collect();
    let on = involvement(&obj(vec![
        ("rows", get(options, "rows").clone()),
        ("types", get(options, "types").clone()),
        ("pending", get(options, "pending").clone()),
    ]));
    let on_node = get(get(&on, "byNode"), &node);
    let holders_of = |slug: &str| -> Vec<String> {
        as_list(get(on_node, "people"))
            .iter()
            .filter(|p| as_str(get(p, "kind")) == slug)
            .map(|p| as_str(get(p, "did")).to_string())
            .collect()
    };

    let mut members: IndexMap<String, Value> = IndexMap::new();
    for m in as_list(get(options, "members")) {
        if let Some(did) = str_or(get(m, "did")).filter(|d| !d.is_empty()) {
            members.insert(did.to_string(), m.clone());
        }
    }
    let by_did = by_did(as_list(get(options, "profiles")));
    for person in as_list(get(on_node, "people")) {
        let did = as_str(get(person, "did")).to_string();
        if !did.is_empty() && !members.contains_key(&did) {
            let fallback = by_did
                .get(did.as_str())
                .map(|p| (*p).clone())
                .unwrap_or_else(|| obj(vec![("did", did.clone().into())]));
            members.insert(did, fallback);
        }
    }
    // `member.name || did.slice(0,16)+'…'` — an empty name falls back.
    let name_of = |m: &Value| -> String {
        let name = as_str(get(m, "name"));
        if name.is_empty() {
            let did = as_str(get(m, "did"));
            format!("{}…", did.chars().take(16).collect::<String>())
        } else {
            name.to_string()
        }
    };
    let mut by_name: Vec<Value> = members.values().cloned().collect();
    by_name.sort_by(|a, b| locale_cmp(&name_of(a), &name_of(b)));

    let mut out: Vec<Value> = Vec::new();
    let doing = kinds
        .iter()
        .find(|k| as_str(get(k, "semantic")) == "responsible")
        .cloned();

    // The suggestion leads, then "Assign to me", then the groups.
    if let Some(doing) = &doing {
        let doing_slug = as_str(get(doing, "slug")).to_string();
        let holders = holders_of(&doing_slug);
        let said = js_trim(as_str(get(options, "said"))).to_lowercase();
        let named: Vec<&Value> = if said.is_empty() {
            Vec::new()
        } else {
            by_name
                .iter()
                .filter(|m| {
                    let name = as_str(get(m, "name")).to_lowercase();
                    name == said || name.starts_with(&format!("{said} "))
                })
                .collect()
        };
        if named.len() == 1 && as_str(get(named[0], "did")) != me && holders.is_empty() {
            out.push(obj(vec![
                ("id", get(named[0], "did").clone()),
                ("kind", doing_slug.clone().into()),
                (
                    "label",
                    format!("Assign {} — named in the conversation", name_of(named[0])).into(),
                ),
                (
                    "avatar",
                    obj(vec![
                        ("image", null_to_empty(get(named[0], "avatar").clone())),
                        ("hash", get(named[0], "did").clone()),
                        ("tone", "".into()),
                    ]),
                ),
            ]));
        }
        if !me.is_empty() && members.contains_key(&me) && !holders.contains(&me) {
            out.push(obj(vec![
                ("id", me.clone().into()),
                ("kind", doing_slug.into()),
                ("label", "Assign to me".into()),
                ("icon", "user-circle-plus".into()),
            ]));
        }
    }

    for kind in kinds {
        let slug = as_str(get(&kind, "slug")).to_string();
        let holders = holders_of(&slug);
        let mut ordered: Vec<Value> = Vec::new();
        for did in &holders {
            if let Some(m) = members.get(did) {
                ordered.push(m.clone());
            }
        }
        for m in &by_name {
            let did = as_str(get(m, "did"));
            if !holders.iter().any(|h| h == did) && did == me {
                ordered.push(m.clone());
            }
        }
        for m in &by_name {
            let did = as_str(get(m, "did"));
            if !holders.iter().any(|h| h == did) && did != me {
                ordered.push(m.clone());
            }
        }
        let tone = tone_for(as_str(get(&kind, "semantic")));
        let items: Vec<Value> = ordered
            .iter()
            .map(|member| {
                let did = as_str(get(member, "did")).to_string();
                let label = if did == me {
                    format!("{} (you)", name_of(member))
                } else {
                    name_of(member)
                };
                obj(vec![
                    ("type", "toggle".into()),
                    ("id", did.clone().into()),
                    ("kind", slug.clone().into()),
                    ("label", label.into()),
                    ("checked", holders.contains(&did).into()),
                    (
                        "avatar",
                        obj(vec![
                            ("image", null_to_empty(get(member, "avatar").clone())),
                            ("hash", did.into()),
                            ("tone", tone.into()),
                        ]),
                    ),
                ])
            })
            .collect();
        // `kind.name || kind.slug` — an empty name falls back.
        let label = str_or(get(&kind, "name"))
            .filter(|n| !n.is_empty())
            .unwrap_or(&slug)
            .to_string();
        out.push(obj(vec![
            ("type", "group".into()),
            ("id", slug.into()),
            ("label", label.into()),
            ("collapsible", true.into()),
            ("collapsed", false.into()),
            ("items", items.into()),
        ]));
    }
    list(out)
}

/// `!kind.appliesTo?.length || kind.appliesTo.includes(entity)` — absent or a
/// non-list/non-string reads `undefined` length, so the kind is offered.
fn applies(applies_to: &Value, entity: &Value) -> bool {
    match applies_to {
        Value::List(l) => l.is_empty() || l.iter().any(|a| a.strict_eq(entity)),
        Value::Str(s) => s.is_empty() || s.contains(&entity.js_string()),
        _ => true,
    }
}

/// `avatar ?? ''` — `null`/`undefined` read as the empty image.
fn null_to_empty(v: Value) -> Value {
    match v {
        Value::Undefined | Value::Null => "".into(),
        other => other,
    }
}

/// `generatedRun` — `{by:'run', run}` when a run wrote the record, else `null`
/// (the host wrapper does `?? null` — see `sources/index.ts`).
fn generated_run(options: &Value) -> Value {
    let run = id_of(get(get(options, "record"), "generatedBy"));
    if run.is_empty() {
        Value::Null
    } else {
        obj(vec![("by", "run".into()), ("run", run.into())])
    }
}

/// A `Vec<Value>` field of a `Value::Obj`, mutably — for building `byNode`.
fn list_field_mut<'a>(owner: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    let Value::Obj(o) = owner else { unreachable!() };
    match Arc::make_mut(o).get_mut(key).unwrap() {
        Value::List(l) => Arc::make_mut(l),
        _ => unreachable!(),
    }
}

fn push_unique_str(list: &mut Vec<Value>, s: &str) {
    if !list.iter().any(|v| as_str(v) == s) {
        list.push(s.into());
    }
}

// ------------------------------------------------------ member natives ----

/// A member native's signature: the whole bag in, the member's value out.
pub(crate) type MemberFn = Arc<dyn Fn(&StoreBag) -> Value + Send + Sync>;

/// A `derived`/`modelRead` `native` name → its implementation over the bag.
/// Unknown names are a store-map error at load time, so this only sees the
/// ones the seed ships.
pub(crate) fn named_native(name: &str) -> Option<MemberFn> {
    match name {
        "agent.ownProfile" => Some(Arc::new(own_profile)),
        "space.mutedDids" => Some(Arc::new(muted_dids)),
        "space.offeredInvolvementTypes" => Some(Arc::new(offered_involvement_types)),
        _ => None,
    }
}

/// A store member's list read out of the bag (or `[]` when absent).
fn member_list(bag: &StoreBag, store: &str, member: &str) -> Vec<Value> {
    let root = bag.root(store).unwrap_or(Value::Undefined);
    let member = member_get(&root, member);
    as_list(&member).to_vec()
}

fn bag_me_did(bag: &StoreBag) -> String {
    let me = bag.root("me").unwrap_or(Value::Undefined);
    let did = member_get(&me, "did");
    as_str(&did).to_string()
}

/// `ownProfile` — `profiles().find(p => p.did === me.did)`, `undefined` when
/// the viewer is not signed in (ProfileStore.tsx:220).
fn own_profile(bag: &StoreBag) -> Value {
    let did = bag_me_did(bag);
    if did.is_empty() {
        return Value::Undefined;
    }
    member_list(bag, "profileStore", "profiles")
        .into_iter()
        .find(|p| str_or(get(p, "did")) == Some(did.as_str()))
        .unwrap_or(Value::Undefined)
}

/// `mutedDids` — `mutedAgents().map(m => m.did)` (SpaceStore.tsx:5386).
fn muted_dids(bag: &StoreBag) -> Value {
    member_list(bag, "spaceStore", "mutedAgents")
        .iter()
        .filter_map(|m| str_or(get(m, "did")).map(|d| Value::from(d.to_string())))
        .collect::<Vec<Value>>()
        .into()
}

/// `offeredInvolvementTypes` — `involvementTypes().filter(k => !k.retired)`
/// (SpaceStore.tsx:4174). The snapshot records `involvementTypes`
/// post-resolution (deduped by slug, semantic-sorted) — only the retired
/// filter remains here.
fn offered_involvement_types(bag: &StoreBag) -> Value {
    member_list(bag, "spaceStore", "involvementTypes")
        .into_iter()
        .filter(|k| !get(k, "retired").truthy())
        .collect::<Vec<Value>>()
        .into()
}
