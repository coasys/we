//! The shared conformance vectors (`packages/schema-system/conformance`) run
//! against the Rust evaluator. The files are read from the repo at test time —
//! never copied — so a re-record on the TypeScript side is picked up here with
//! no code change.
//!
//! Failure output names the case id, the source, the expected and the got.
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use we_expr::{
    callback_value, eval, parse, print, CallableRef, Env, MapEnv, Namespace, Value, CALL_TIME_ROOTS,
};

#[derive(Deserialize)]
struct VectorFile {
    #[serde(default)]
    envs: BTreeMap<String, EnvSpec>,
    cases: Vec<ExpressionCase>,
}

/// A named environment's spec — `ExpressionEnvSpec` in `evalEnv.ts`. `stores`
/// decodes to the bag (`$`-keys are host globals; `hostSourceBag()` is
/// installed under `$sources`), `context` to the render context, `local` to
/// the `context.$local` accessor map.
#[derive(Deserialize, Default, Clone)]
struct EnvSpec {
    #[serde(default)]
    stores: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    context: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    local: BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct ExpressionCase {
    id: String,
    source: String,
    env: Option<String>,
    result: Option<serde_json::Value>,
    error: Option<String>,
    message: Option<String>,
    span: Option<(usize, usize)>,
    print: Option<String>,
}

#[derive(Deserialize)]
struct FunctionFile {
    cases: Vec<FunctionCase>,
}

#[derive(Deserialize)]
struct FunctionCase {
    id: String,
    #[serde(rename = "fn")]
    name: String,
    args: Vec<serde_json::Value>,
    context: Option<BTreeMap<String, serde_json::Value>>,
    result: serde_json::Value,
}

fn vectors_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors")
        .join(name)
}

/// The evaluation env a case's `env` decodes to — `buildEnvironment` over the
/// spec, as `evalEnv.ts` builds it: `local` reads the `context.$local`
/// accessors; `event`/`arg`/`result` are wrapped in `callback_value` (with
/// `arg` falling back to `event`); a `$`-prefixed context key is skipped; a
/// `$name` bag entry is a host global — a function is invoked for the value;
/// and an object bag entry is a store namespace. `call` finds built-ins
/// first (the evaluator's own dispatch), then the host's `$sources` — the
/// same order the renderer uses.
struct VectorEnv {
    bag: indexmap::IndexMap<Arc<str>, Value>,
    context: indexmap::IndexMap<Arc<str>, Value>,
    local: indexmap::IndexMap<Arc<str>, Value>,
}

impl Env for VectorEnv {
    fn root(&self, name: &str) -> Option<Value> {
        if name == "local" {
            return Some(Value::namespace(LocalNamespace {
                local: self.local.clone(),
            }));
        }
        if CALL_TIME_ROOTS.contains(&name) {
            if let Some(value) = self.context.get(name) {
                return Some(callback_value(value));
            }
            if name == "arg" {
                if let Some(value) = self.context.get("event") {
                    return Some(callback_value(value));
                }
            }
        }
        if !name.starts_with('$') {
            if let Some(value) = self.context.get(name) {
                return Some(value.clone());
            }
        }
        if let Some(global) = self.bag.get(format!("${name}").as_str()) {
            if !global.is_undefined() {
                return Some(match global {
                    // A host global's function is invoked for the value —
                    // `typeof global === 'function' ? global() : global`.
                    Value::Callable(c) => c.call(&[]),
                    value => value.clone(),
                });
            }
        }
        match self.bag.get(name) {
            Some(store @ Value::Obj(_)) => Some(Value::namespace(StoreNamespace {
                store: store.clone(),
            })),
            _ => None,
        }
    }

    fn call(&self, name: &str, args: &[Value]) -> Value {
        // Built-ins are dispatched by the evaluator before the env is asked;
        // what reaches here is a host source — `$sources[name](args[0])`.
        if name == "calendarMonth" {
            calendar_month(args)
        } else {
            source(name, args)
        }
    }
}

/// `local` — a namespace over `context.$local`, the signals `$localState` and
/// `$queries` made. Each member comes back as the accessor `buildEnvironment`
/// marks reactive; an undeclared field is `Undefined`.
#[derive(Debug)]
struct LocalNamespace {
    local: indexmap::IndexMap<Arc<str>, Value>,
}

impl Namespace for LocalNamespace {
    fn get(&self, key: &str) -> Value {
        match self.local.get(key) {
            Some(held) => {
                let held = held.clone();
                Value::Callable(CallableRef::accessor("anonymous", move |_| held.clone()))
            }
            None => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        self.local.keys().cloned().collect()
    }
}

/// A store — `namespace((member) => (member in store ? store[member] :
/// undefined))`. Members read raw: a function member answers an untagged
/// callable, which `readValue` refuses.
#[derive(Debug)]
struct StoreNamespace {
    store: Value,
}

impl Namespace for StoreNamespace {
    fn get(&self, key: &str) -> Value {
        match &self.store {
            Value::Obj(o) => o.get(key).cloned().unwrap_or(Value::Undefined),
            _ => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        match &self.store {
            Value::Obj(o) => o.keys().cloned().collect(),
            _ => vec![],
        }
    }
}

/// `envFor` — the `{stores, context, local}` spec becomes the bag and
/// context `buildEnvironment` reads, and `hostSourceBag()` sits under
/// `$sources` exactly where the host puts it (here: the `source` dispatch in
/// `Env::call`).
fn env_for(file: &VectorFile, name: Option<&str>) -> VectorEnv {
    let spec = name
        .and_then(|n| file.envs.get(n))
        .cloned()
        .unwrap_or_default();
    let bag = spec
        .stores
        .iter()
        .map(|(k, v)| (k.as_str().into(), Value::from_json(v)))
        .collect();
    let context = spec
        .context
        .iter()
        .map(|(k, v)| (k.as_str().into(), Value::from_json(v)))
        .collect();
    let local = spec
        .local
        .iter()
        .map(|(k, v)| (k.as_str().into(), Value::from_json(v)))
        .collect();
    VectorEnv {
        bag,
        context,
        local,
    }
}

fn describe(case: &ExpressionCase) -> String {
    let mut parts = Vec::new();
    if let Some(e) = &case.error {
        parts.push(format!("error {e:?}"));
    }
    if let Some(m) = &case.message {
        parts.push(format!("message {m:?}"));
    }
    if let Some(s) = &case.span {
        parts.push(format!("span {s:?}"));
    }
    if let Some(r) = &case.result {
        parts.push(format!("result {}", serde_json::to_string(r).unwrap()));
    }
    if let Some(p) = &case.print {
        parts.push(format!("print {p:?}"));
    }
    parts.join(" ")
}

#[test]
fn expressions_conformance() {
    let file: VectorFile =
        serde_json::from_str(&std::fs::read_to_string(vectors_path("expressions.json")).unwrap())
            .unwrap();
    let mut failures = Vec::new();
    for case in &file.cases {
        let fail = |got: String| {
            format!(
                "  {}: source {:?}\n    expected: {}\n    got: {}",
                case.id,
                case.source,
                describe(case),
                got
            )
        };
        match parse(&case.source) {
            Err(err) => {
                if case.error.is_none() {
                    failures.push(fail(format!("syntax error {err}")));
                    continue;
                }
                if case.message.as_ref().is_some_and(|m| err.message != *m) {
                    failures.push(fail(format!("error message {:?}", err.message)));
                }
                if case.span.is_some_and(|s| err.span != s) {
                    failures.push(fail(format!("error span {:?}", err.span)));
                }
            }
            Ok(expr) => {
                if case.error.is_some() {
                    failures.push(fail("parsed, expected a syntax error".to_string()));
                    continue;
                }
                if let Some(expected) = &case.print {
                    let got = print(&expr);
                    if got != *expected {
                        failures.push(fail(got));
                        continue;
                    }
                }
                if let Some(expected) = &case.result {
                    let env = env_for(&file, case.env.as_deref());
                    let got = eval(&expr, &env).to_json();
                    if got != *expected {
                        failures.push(fail(serde_json::to_string(&got).unwrap()));
                    }
                }
            }
        }
    }
    let pass = file.cases.len() - failures.len();
    for f in &failures {
        eprintln!("{f}");
    }
    println!("expressions.json: {pass}/{} pass", file.cases.len());
    assert!(
        failures.is_empty(),
        "expressions.json: {pass}/{} pass",
        file.cases.len()
    );
}

#[test]
fn functions_conformance() {
    let file: FunctionFile =
        serde_json::from_str(&std::fs::read_to_string(vectors_path("functions.json")).unwrap())
            .unwrap();
    let mut failures = Vec::new();
    for case in &file.cases {
        // Bind the case's argv to `__arg0…` and evaluate `fn(__arg0, …)`
        // through the real parse/eval/dispatch path.
        let mut env = MapEnv::new();
        for (k, v) in case.context.clone().unwrap_or_default() {
            env.set_root(k, Value::from_json(&v));
        }
        let names: Vec<String> = case
            .args
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let name = format!("__arg{i}");
                env.set_root(name.as_str(), Value::from_json(a));
                name
            })
            .collect();
        let source = format!("{}({})", case.name, names.join(", "));
        let expr = parse(&source).unwrap();
        let got = eval(&expr, &env).to_json();
        if got != case.result {
            failures.push(format!(
                "  {}: {source}\n    expected: {}\n    got: {}",
                case.id,
                serde_json::to_string(&case.result).unwrap(),
                serde_json::to_string(&got).unwrap()
            ));
        }
    }
    let pass = file.cases.len() - failures.len();
    for f in &failures {
        eprintln!("{f}");
    }
    println!("functions.json: {pass}/{} pass", file.cases.len());
    assert!(
        failures.is_empty(),
        "functions.json: {pass}/{} pass",
        file.cases.len()
    );
}

// ------------------------------------------------------------ calendar ----
// `calendarMonth` from `app-shell/.../sources/calendarMonth.ts`, in UTC — the
// timezone the conformance env pins. Civil-date maths, no clock: `isToday`
// needs the real date, taken from the system clock in days since epoch.

fn calendar_month(args: &[Value]) -> Value {
    let options = match args.first() {
        Some(Value::Obj(o)) => o,
        _ => return Vec::<Value>::new().into(),
    };
    // `anchorOf`: `new Date(options.month)` — a number is ms since epoch, a
    // string parses as a date. Then the 1st of `month + offset`.
    let (base_y, base_m) = match options.get("month") {
        Some(Value::Num(ms)) => {
            let (y, m, _) = days_to_civil((*ms / 86_400_000.0).floor() as i64);
            (y, m)
        }
        Some(Value::Str(s)) => parse_iso(s).unwrap_or_else(today_ym),
        _ => today_ym(),
    };
    let offset = options
        .get("offset")
        .map(|v| v.to_number() as i64)
        .unwrap_or(0);
    let (year, month) = add_months(base_y, base_m, offset);

    let week_start = options
        .get("weekStartsOn")
        .map(|v| v.to_number() as i64)
        .unwrap_or(0)
        .rem_euclid(7);
    let today = today_iso();

    let first_weekday = weekday_of(year, month, 1);
    let lead = (first_weekday - week_start).rem_euclid(7);
    let total = days_in_month(year, month);
    let mut cells: Vec<Value> = Vec::new();

    fn cell(today: &str, y: i64, m: i64, d: i64, in_month: bool) -> Value {
        let date = iso(y, m, d);
        let mut cell = indexmap::IndexMap::new();
        cell.insert("date".into(), date.clone().into());
        cell.insert("day".into(), d.into());
        cell.insert("inMonth".into(), in_month.into());
        cell.insert("isToday".into(), (date == today).into());
        cell.insert("weekday".into(), weekday_of(y, m, d).into());
        cell.into()
    }

    let (py, pm) = add_months(year, month, -1);
    let prev_total = days_in_month(py, pm);
    for index in (1..=lead).rev() {
        cells.push(cell(&today, py, pm, prev_total - index + 1, false));
    }
    for day in 1..=total {
        cells.push(cell(&today, year, month, day, true));
    }
    let target = if options.get("fixedWeeks").is_some_and(|v| !v.truthy()) {
        cells.len().div_ceil(7) * 7
    } else {
        42
    };
    let (ny, nm) = add_months(year, month, 1);
    let mut day = 1;
    while cells.len() < target {
        cells.push(cell(&today, ny, nm, day, false));
        day += 1;
    }
    cells.into()
}

/// Days since epoch → (year, month0, day), UTC. Howard Hinnant's civil
/// algorithm.
fn days_to_civil(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m - 1, d)
}

/// (year, month0, day) → days since epoch.
fn civil_to_days(y: i64, m0: i64, d: i64) -> i64 {
    let y = if m0 <= 1 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    // 1-based `mp` in Hinnant's formula: Jan(0)→10, Feb(1)→11, Mar(2)→0.
    let mp = if m0 <= 1 { m0 + 10 } else { m0 - 2 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn days_in_month(y: i64, m0: i64) -> i64 {
    let (ny, nm) = add_months(y, m0, 1);
    civil_to_days(ny, nm, 1) - civil_to_days(y, m0, 1)
}

/// `Date.getDay()` — 0 = Sunday. 1970-01-01 was Thursday (4).
fn weekday_of(y: i64, m0: i64, d: i64) -> i64 {
    (civil_to_days(y, m0, d) + 4).rem_euclid(7)
}

fn add_months(y: i64, m0: i64, delta: i64) -> (i64, i64) {
    let total = y * 12 + m0 + delta;
    (total.div_euclid(12), total.rem_euclid(12))
}

fn iso(y: i64, m0: i64, d: i64) -> String {
    format!("{y}-{:02}-{:02}", m0 + 1, d)
}

/// A `YYYY-MM-DD` prefix; JS `new Date(s)` is lenient, the vectors use ISO.
fn parse_iso(s: &str) -> Option<(i64, i64)> {
    let mut it = s.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    Some((y, m - 1))
}

fn today_civil() -> (i64, i64, i64) {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    days_to_civil(days)
}

fn today_ym() -> (i64, i64) {
    let (y, m, _) = today_civil();
    (y, m)
}

fn today_iso() -> String {
    let (y, m, d) = today_civil();
    iso(y, m, d)
}

// ------------------------------------------------------ host sources -------
// The `$sources` bag `evalEnv.ts` resolves after built-ins, reproduced for the
// ones the vectors call. Each is a faithful port; values arrive as `Value`.

fn obj_get<'a>(v: &'a Value, key: &str) -> &'a Value {
    match v {
        Value::Obj(o) => o.get(key).unwrap_or(&Value::Undefined),
        _ => &Value::Undefined,
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

/// `relationId` — a string, a one-element list's head, or an object's `id`.
fn relation_id(v: &Value) -> String {
    match v {
        Value::Str(s) => s.to_string(),
        Value::List(l) => relation_id(l.first().unwrap_or(&Value::Undefined)),
        Value::Obj(_) => as_str(obj_get(v, "id")).to_string(),
        _ => String::new(),
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = indexmap::IndexMap::new();
    for (k, v) in pairs {
        m.insert(k.into(), v);
    }
    m.into()
}

fn source(name: &str, args: &[Value]) -> Value {
    let options = args.first().cloned().unwrap_or(Value::Undefined);
    match name {
        "reactions" => src_reactions(&options),
        "reactors" => src_reactors(&options),
        "signalTally" => src_signal_tally(&options),
        "signalTypesByUse" => src_signal_types_by_use(&options),
        "voices" => src_voices(&options),
        "voicesParam" => src_voices_param(&options),
        "involvement" => src_involvement(&options),
        "involvementMenu" => src_involvement_menu(&options),
        "generatedRun" => src_generated_run(&options),
        _ => Value::Undefined,
    }
}

/// `reactions` — signals with this agent's held write overlaid.
fn src_reactions(options: &Value) -> Value {
    let rows = as_list(obj_get(options, "signals")).to_vec();
    let pending = as_list(obj_get(options, "pending"));
    let (record, type_, me) = (
        obj_get(options, "record"),
        obj_get(options, "type"),
        obj_get(options, "me"),
    );
    if pending.is_empty()
        || !matches!(record, Value::Str(_))
        || !matches!(type_, Value::Str(_))
        || !matches!(me, Value::Str(_))
    {
        return rows.into();
    }
    let held = pending
        .iter()
        .find(|e| obj_get(e, "record").strict_eq(record) && obj_get(e, "type").strict_eq(type_));
    let Some(held) = held else {
        return rows.into();
    };
    let value = obj_get(held, "value");
    if !matches!(value, Value::Num(_) | Value::Null) {
        return rows.into();
    }
    let others: Vec<Value> = rows
        .into_iter()
        .filter(|r| !obj_get(r, "author").strict_eq(me))
        .collect();
    if matches!(value, Value::Null) {
        return others.into();
    }
    let mut out = others;
    out.push(obj(vec![
        ("author", me.clone()),
        ("signalTypeId", type_.clone()),
        ("value", value.clone()),
    ]));
    out.into()
}

/// `reactors` — the people behind the signals, reader first then by name.
fn src_reactors(options: &Value) -> Value {
    let rows = as_list(obj_get(options, "signals"));
    let cache = as_list(obj_get(options, "profiles"));
    let mine = as_str(obj_get(options, "me"));
    let needle = as_str(obj_get(options, "search")).trim().to_lowercase();

    let mut all: Vec<Value> = Vec::new();
    for row in rows {
        let Some(author) = str_or(obj_get(row, "author")) else {
            continue;
        };
        let profile = cache
            .iter()
            .find(|p| str_or(obj_get(p, "did")) == Some(author));
        let name = profile
            .and_then(|p| str_or(obj_get(p, "name")))
            .unwrap_or("");
        let avatar = profile
            .and_then(|p| str_or(obj_get(p, "avatar")))
            .unwrap_or("");
        all.push(obj(vec![
            ("did", author.into()),
            ("name", name.into()),
            ("avatar", avatar.into()),
            ("value", as_num(obj_get(row, "value")).unwrap_or(0.0).into()),
            ("mine", (author == mine).into()),
        ]));
    }
    all.sort_by(|a, b| {
        let am = obj_get(a, "mine").truthy();
        let bm = obj_get(b, "mine").truthy();
        if am == bm {
            as_str(obj_get(a, "name")).cmp(as_str(obj_get(b, "name")))
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
            .filter(|p| as_str(obj_get(p, "name")).is_empty())
            .count()
    };
    let matching: Vec<Value> = if needle.is_empty() {
        all.clone()
    } else {
        all.iter()
            .filter(|p| as_str(obj_get(p, "name")).to_lowercase().contains(&needle))
            .cloned()
            .collect()
    };
    obj(vec![
        ("people", matching.into()),
        ("total", all.len().into()),
        ("unresolved", unresolved.into()),
    ])
}

/// `aggregateFor` — the type's aggregate, with the two `count` corrections.
fn aggregate_for(t: &Value) -> String {
    let mode = as_str(obj_get(t, "mode"));
    let fallback = match mode {
        "toggle" => "count",
        "vote" => "sum",
        "rating" | "slider" => "mean",
        _ => "count",
    };
    match str_or(obj_get(t, "aggregate")) {
        None => fallback.to_string(),
        Some("count") if mode != "toggle" => fallback.to_string(),
        Some(a) => a.to_string(),
    }
}

/// `signalTally` — one number for a type's signals, or the head count.
fn src_signal_tally(options: &Value) -> Value {
    let signals = as_list(obj_get(options, "signals"));
    if signals.is_empty() && !matches!(obj_get(options, "signals"), Value::List(_)) {
        return 0.into();
    }
    let rows: Vec<f64> = signals
        .iter()
        .filter_map(|s| as_num(obj_get(s, "value")))
        .collect();
    let round = |n: f64| (n * 10.0).round() / 10.0;
    let type_ = obj_get(options, "type");
    let is_typed = matches!(type_, Value::Obj(_)) && str_or(obj_get(type_, "mode")).is_some();
    if !is_typed {
        return rows.iter().filter(|v| **v != 0.0).count().into();
    }
    if rows.is_empty() {
        return 0.into();
    }
    match aggregate_for(type_).as_str() {
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

/// `signalTypesByUse` — types ordered by head count, settled `order` first.
fn src_signal_types_by_use(options: &Value) -> Value {
    let types = as_list(obj_get(options, "types"));
    if !matches!(obj_get(options, "types"), Value::List(_)) {
        return Vec::<Value>::new().into();
    }
    let rows = as_list(obj_get(options, "signals"));
    let hidden: Vec<&str> = as_list(obj_get(options, "muted"))
        .iter()
        .filter_map(str_or)
        .collect();
    let mut counts: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for row in rows {
        let Some(id) = str_or(obj_get(row, "signalTypeId")) else {
            continue;
        };
        if str_or(obj_get(row, "author")).is_some_and(|a| hidden.contains(&a)) {
            continue;
        }
        *counts.entry(id.to_string()).or_default() += 1.0;
    }
    let used = |t: &Value| {
        str_or(obj_get(t, "id"))
            .and_then(|id| counts.get(id).copied())
            .unwrap_or(0.0)
    };
    let settled = as_list(obj_get(options, "order"));
    let rank = |t: &Value| {
        str_or(obj_get(t, "id")).and_then(|id| settled.iter().position(|s| str_or(s) == Some(id)))
    };
    let mut ordered = types.to_vec();
    ordered.sort_by(|a, b| match (rank(a), rank(b)) {
        (Some(l), Some(r)) => l.cmp(&r),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => used(b)
            .partial_cmp(&used(a))
            .unwrap_or(std::cmp::Ordering::Equal),
    });
    let limit = as_num(obj_get(options, "limit"));
    if let Some(limit) = limit.filter(|l| *l >= 0.0) {
        ordered.truncate(limit as usize);
    }
    ordered.into()
}

/// `parseWeights` — `did=50,did=0` or a map of shares.
fn parse_weights(weights: &Value) -> indexmap::IndexMap<String, f64> {
    let mut parsed = indexmap::IndexMap::new();
    let mut put = |who: &str, share: f64| {
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
                let share = entry[split + 1..].trim();
                if split > 0 && !share.is_empty() {
                    put(
                        entry[..split].trim(),
                        share.parse::<f64>().unwrap_or(f64::NAN) / 100.0,
                    );
                }
            }
        }
        Value::Obj(o) => {
            for (who, share) in o.iter() {
                if let Value::Num(n) = share {
                    put(who, *n);
                }
            }
        }
        _ => {}
    }
    parsed
}

/// `voices` — summary rows joined to profiles and weights.
fn src_voices(options: &Value) -> Value {
    let summary = obj_get(options, "summary");
    let rows = as_list(obj_get(summary, "voices"));
    let profiles = as_list(obj_get(options, "profiles"));
    let me = as_str(obj_get(options, "me"));
    let weights = parse_weights(obj_get(options, "param"));

    let mut listed: Vec<Value> = Vec::new();
    for row in rows {
        let Some(did) = str_or(obj_get(row, "author")).filter(|d| !d.is_empty()) else {
            continue;
        };
        let profile = profiles
            .iter()
            .find(|p| str_or(obj_get(p, "did")) == Some(did));
        let pretend = str_or(obj_get(row, "name")).is_some_and(|n| !n.is_empty());
        let name = if pretend {
            as_str(obj_get(row, "name")).to_string()
        } else {
            profile
                .and_then(|p| str_or(obj_get(p, "name")))
                .unwrap_or(&short_did(did))
                .to_string()
        };
        let avatar = if pretend {
            String::new()
        } else {
            profile
                .and_then(|p| str_or(obj_get(p, "avatar")))
                .unwrap_or("")
                .to_string()
        };
        let weight = (weights.get(did).copied().unwrap_or(1.0) * 100.0).round();
        listed.push(obj(vec![
            ("did", did.into()),
            ("name", name.into()),
            ("avatar", avatar.into()),
            ("cards", as_num(obj_get(row, "cards")).unwrap_or(0.0).into()),
            ("mean", as_num(obj_get(row, "mean")).unwrap_or(0.0).into()),
            ("weight", weight.into()),
            ("share", 0.into()),
            ("mine", (did == me).into()),
            ("pretend", pretend.into()),
        ]));
    }
    let total: f64 = listed
        .iter()
        .map(|v| as_num(obj_get(v, "weight")).unwrap_or(0.0))
        .sum();
    for v in &mut listed {
        let share = if total != 0.0 {
            (as_num(obj_get(v, "weight")).unwrap_or(0.0) / total * 100.0).round()
        } else {
            0.0
        };
        if let Value::Obj(o) = v {
            std::sync::Arc::make_mut(o).insert("share".into(), share.into());
        }
    }
    listed.into()
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

/// `voicesParam` — the address form with one voice changed, or `only`.
fn src_voices_param(options: &Value) -> Value {
    let mut weights = parse_weights(obj_get(options, "param"));
    let only = obj_get(options, "only");
    let did = obj_get(options, "did");
    if str_or(only).is_some_and(|o| !o.is_empty()) {
        let listed = as_list(obj_get(options, "voices"));
        for entry in listed {
            let who = match entry {
                Value::Str(s) => Some(s.to_string()),
                _ => str_or(obj_get(entry, "did")).map(str::to_string),
            };
            if let Some(who) = who.filter(|w| !w.is_empty()) {
                weights.insert(who, 0.0);
            }
        }
        weights.shift_remove(as_str(only));
    } else if str_or(did).is_some_and(|d| !d.is_empty()) {
        let share = as_num(obj_get(options, "weight"))
            .map(|w| w.round().clamp(0.0, 100.0))
            .unwrap_or(f64::NAN);
        if !share.is_finite() || share >= 100.0 {
            weights.shift_remove(as_str(did));
        } else {
            weights.insert(as_str(did).to_string(), share / 100.0);
        }
    }
    weights
        .iter()
        .map(|(who, share)| format!("{who}={}", (share * 100.0).round()))
        .collect::<Vec<_>>()
        .join(",")
        .into()
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
                    &relation_id(obj_get(p, "node")),
                    as_str(obj_get(p, "agent")),
                    as_str(obj_get(p, "kind")),
                ),
                p,
            )
        })
        .collect();
    let mut out: Vec<Value> = rows
        .into_iter()
        .filter(|row| {
            let k = key(
                &relation_id(obj_get(row, "node")),
                as_str(obj_get(row, "agent")),
                as_str(obj_get(row, "kind")),
            );
            held.get(&k).is_none_or(|e| obj_get(e, "on").truthy())
        })
        .collect();
    let present: std::collections::HashSet<String> = out
        .iter()
        .map(|row| {
            key(
                &relation_id(obj_get(row, "node")),
                as_str(obj_get(row, "agent")),
                as_str(obj_get(row, "kind")),
            )
        })
        .collect();
    for entry in pending {
        let k = key(
            &relation_id(obj_get(entry, "node")),
            as_str(obj_get(entry, "agent")),
            as_str(obj_get(entry, "kind")),
        );
        if obj_get(entry, "on").truthy() && !present.contains(&k) {
            out.push(obj(vec![
                ("node", obj_get(entry, "node").clone()),
                ("agent", obj_get(entry, "agent").clone()),
                ("kind", obj_get(entry, "kind").clone()),
            ]));
        }
    }
    out
}

/// `involvement` — byNode / answers / dids from raw rows.
fn src_involvement(options: &Value) -> Value {
    let types = as_list(obj_get(options, "types"));
    let by_slug = |slug: &str| {
        types
            .iter()
            .find(|t| str_or(obj_get(t, "slug")) == Some(slug))
    };
    let rows = apply_pending(
        as_list(obj_get(options, "rows"))
            .iter()
            .filter(|r| matches!(r, Value::Obj(_)))
            .cloned()
            .collect(),
        as_list(obj_get(options, "pending")),
    );
    let me = as_str(obj_get(options, "me"));
    let counted = obj_get(options, "nodes");
    let counted: Option<Vec<String>> = match counted {
        Value::List(l) => Some(l.iter().map(|v| v.to_text().to_string()).collect()),
        _ => None,
    };
    const SEMANTIC: [&str; 5] = [
        "responsible",
        "reviewing",
        "committed",
        "interested",
        "declined",
    ];
    let tone = |s: &str| if s == "reviewing" { "warning" } else { "" };

    let mut by_node: indexmap::IndexMap<String, Value> = indexmap::IndexMap::new();
    let mut answers: indexmap::IndexMap<String, Value> = indexmap::IndexMap::new();
    let mut everyone: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for row in &rows {
        let node = relation_id(obj_get(row, "node"));
        let did = as_str(obj_get(row, "agent")).to_string();
        let kind = as_str(obj_get(row, "kind")).to_string();
        if node.is_empty() || did.is_empty() || kind.is_empty() {
            continue;
        }
        let entry = by_node.entry(node.clone()).or_insert_with(|| {
            obj(vec![
                ("people", Vec::<Value>::new().into()),
                ("dids", Vec::<Value>::new().into()),
                ("responsible", Vec::<Value>::new().into()),
                ("reviewing", Vec::<Value>::new().into()),
                ("committed", Vec::<Value>::new().into()),
                ("interested", Vec::<Value>::new().into()),
                ("declined", Vec::<Value>::new().into()),
                ("pairs", Vec::<Value>::new().into()),
            ])
        });
        let pair = format!("{did}|{kind}");
        let pairs = list_mut(entry, "pairs");
        if pairs.iter().any(|v| as_str(v) == pair) {
            continue;
        }
        pairs.push(pair.into());

        let type_ = by_slug(&kind);
        let semantic = type_
            .and_then(|t| str_or(obj_get(t, "semantic")))
            .filter(|s| SEMANTIC.contains(s))
            .unwrap_or("responsible")
            .to_string();
        let person = obj(vec![
            ("did", did.clone().into()),
            ("kind", kind.clone().into()),
            (
                "name",
                type_
                    .and_then(|t| str_or(obj_get(t, "name")))
                    .unwrap_or(&kind)
                    .to_string()
                    .into(),
            ),
            ("semantic", semantic.clone().into()),
            (
                "reflexive",
                type_
                    .is_some_and(|t| obj_get(t, "reflexive").truthy())
                    .into(),
            ),
            (
                "icon",
                type_
                    .and_then(|t| str_or(obj_get(t, "icon")))
                    .unwrap_or("")
                    .into(),
            ),
            (
                "color",
                type_
                    .and_then(|t| str_or(obj_get(t, "color")))
                    .unwrap_or("")
                    .into(),
            ),
            ("tone", tone(&semantic).into()),
        ]);
        list_mut(entry, "people").push(person);
        push_unique(list_mut(entry, &semantic), did.clone().into());
        if semantic != "declined" {
            push_unique(list_mut(entry, "dids"), did.clone().into());
            if counted.as_ref().is_none_or(|c| c.contains(&node)) && !seen.contains(&did) {
                seen.insert(did.clone());
                everyone.push(did.clone());
            }
        }
        if did == me && type_.is_some_and(|t| obj_get(t, "reflexive").truthy()) {
            answers.insert(node, kind.into());
        }
    }

    // People sorted by semantic rank within each record.
    for entry in by_node.values_mut() {
        let people = list_mut(entry, "people");
        people.sort_by_key(|p| {
            SEMANTIC
                .iter()
                .position(|s| *s == as_str(obj_get(p, "semantic")))
                .unwrap_or(0)
        });
    }
    if let Some(at) = everyone.iter().position(|d| d == me) {
        if at > 0 {
            let d = everyone.remove(at);
            everyone.insert(0, d);
        }
    }
    let mut node_map = indexmap::IndexMap::new();
    for (k, v) in by_node {
        node_map.insert(k.into(), v);
    }
    obj(vec![
        ("byNode", node_map.into()),
        (
            "answers",
            answers
                .into_iter()
                .map(|(k, v)| (k.into(), v))
                .collect::<indexmap::IndexMap<_, _>>()
                .into(),
        ),
        (
            "dids",
            everyone
                .into_iter()
                .map(|d| d.into())
                .collect::<Vec<Value>>()
                .into(),
        ),
    ])
}

/// `involvementMenu` — suggestion, take-it, then the kind groups.
fn src_involvement_menu(options: &Value) -> Value {
    let node = str_or(obj_get(options, "node")).unwrap_or("").to_string();
    let entity = as_str(obj_get(options, "entity")).to_string();
    let me = as_str(obj_get(options, "me")).to_string();
    if node.is_empty() {
        return Vec::<Value>::new().into();
    }
    let kinds: Vec<&Value> = as_list(obj_get(options, "types"))
        .iter()
        .filter(|k| {
            str_or(obj_get(k, "slug")).is_some()
                && !obj_get(k, "reflexive").truthy()
                && !obj_get(k, "retired").truthy()
                && {
                    let applies = as_list(obj_get(k, "appliesTo"));
                    applies.is_empty() || applies.iter().any(|a| as_str(a) == entity)
                }
        })
        .collect();
    let on = src_involvement(&obj(vec![
        ("rows", obj_get(options, "rows").clone()),
        ("types", obj_get(options, "types").clone()),
        ("pending", obj_get(options, "pending").clone()),
    ]));
    let on_node = obj_get(obj_get(&on, "byNode"), &node);
    let holders_of = |slug: &str| -> Vec<String> {
        as_list(obj_get(on_node, "people"))
            .iter()
            .filter(|p| as_str(obj_get(p, "kind")) == slug)
            .map(|p| as_str(obj_get(p, "did")).to_string())
            .collect()
    };

    let mut members: indexmap::IndexMap<String, Value> = indexmap::IndexMap::new();
    for m in as_list(obj_get(options, "members")) {
        if let Some(did) = str_or(obj_get(m, "did")) {
            members.insert(did.to_string(), m.clone());
        }
    }
    let profiles = as_list(obj_get(options, "profiles"));
    for person in as_list(obj_get(on_node, "people")) {
        let did = as_str(obj_get(person, "did")).to_string();
        if !members.contains_key(&did) {
            let fallback = profiles
                .iter()
                .find(|p| str_or(obj_get(p, "did")) == Some(&did))
                .cloned()
                .unwrap_or_else(|| obj(vec![("did", did.clone().into())]));
            members.insert(did, fallback);
        }
    }
    let name_of = |m: &Value| {
        let n = as_str(obj_get(m, "name"));
        if n.is_empty() {
            let did = as_str(obj_get(m, "did"));
            let head: String = did.chars().take(16).collect();
            format!("{head}…")
        } else {
            n.to_string()
        }
    };
    let mut by_name: Vec<Value> = members.values().cloned().collect();
    by_name.sort_by_key(|a| name_of(a));

    let mut out: Vec<Value> = Vec::new();
    let doing = kinds
        .iter()
        .find(|k| as_str(obj_get(k, "semantic")) == "responsible")
        .copied();

    // Suggestion + take-it lead the menu.
    let said = as_str(obj_get(options, "said")).trim().to_lowercase();
    if let Some(doing) = doing {
        let holders = holders_of(as_str(obj_get(doing, "slug")));
        let named: Vec<&Value> = if said.is_empty() {
            Vec::new()
        } else {
            by_name
                .iter()
                .filter(|m| {
                    let name = as_str(obj_get(m, "name")).to_lowercase();
                    name == said || name.starts_with(&format!("{said} "))
                })
                .collect()
        };
        if named.len() == 1 && as_str(obj_get(named[0], "did")) != me && holders.is_empty() {
            out.push(obj(vec![
                ("id", obj_get(named[0], "did").clone()),
                ("kind", obj_get(doing, "slug").clone()),
                (
                    "label",
                    format!("Assign {} — named in the conversation", name_of(named[0])).into(),
                ),
                (
                    "avatar",
                    obj(vec![
                        ("image", obj_get(named[0], "avatar").clone()),
                        ("hash", obj_get(named[0], "did").clone()),
                        ("tone", "".into()),
                    ]),
                ),
            ]));
        }
        if !me.is_empty() && members.contains_key(&me) && !holders.contains(&me) {
            out.push(obj(vec![
                ("id", me.clone().into()),
                ("kind", obj_get(doing, "slug").clone()),
                ("label", "Assign to me".into()),
                ("icon", "user-circle-plus".into()),
            ]));
        }
    }

    for kind in kinds {
        let slug = as_str(obj_get(kind, "slug")).to_string();
        let holders = holders_of(&slug);
        let mut ordered: Vec<Value> = Vec::new();
        for did in &holders {
            if let Some(m) = members.get(did) {
                ordered.push(m.clone());
            }
        }
        for m in &by_name {
            let did = as_str(obj_get(m, "did"));
            if !holders.contains(&did.to_string()) && did == me {
                ordered.push(m.clone());
            }
        }
        for m in &by_name {
            let did = as_str(obj_get(m, "did"));
            if !holders.contains(&did.to_string()) && did != me {
                ordered.push(m.clone());
            }
        }
        let semantic = as_str(obj_get(kind, "semantic"));
        let tone = if semantic == "reviewing" {
            "warning"
        } else {
            ""
        };
        let items: Vec<Value> = ordered
            .iter()
            .map(|member| {
                let did = as_str(obj_get(member, "did")).to_string();
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
                            ("image", obj_get(member, "avatar").clone()),
                            ("hash", did.into()),
                            ("tone", tone.into()),
                        ]),
                    ),
                ])
            })
            .collect();
        out.push(obj(vec![
            ("type", "group".into()),
            ("id", slug.clone().into()),
            (
                "label",
                str_or(obj_get(kind, "name"))
                    .unwrap_or(&slug)
                    .to_string()
                    .into(),
            ),
            ("collapsible", true.into()),
            ("collapsed", false.into()),
            ("items", items.into()),
        ]));
    }
    out.into()
}

/// `generatedRun` — `{by:'run', run}` when the record says a run wrote it.
fn src_generated_run(options: &Value) -> Value {
    let run = relation_id(obj_get(obj_get(options, "record"), "generatedBy"));
    if run.is_empty() {
        Value::Undefined
    } else {
        obj(vec![("by", "run".into()), ("run", run.into())])
    }
}

/// The `list` field of an object, mutably — a helper for building `byNode`.
fn list_mut<'a>(owner: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    let Value::Obj(o) = owner else { unreachable!() };
    match std::sync::Arc::make_mut(o).get_mut(key).unwrap() {
        Value::List(l) => std::sync::Arc::make_mut(l),
        _ => unreachable!(),
    }
}

fn push_unique(list: &mut Vec<Value>, v: Value) {
    if !list.iter().any(|e| e.strict_eq(&v)) {
        list.push(v);
    }
}
