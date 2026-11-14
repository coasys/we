//! Regression tests for Lal's E1 review (`lal-port-e1.md`). Each test pins a
//! case where the Rust port diverged from `functions.ts`/`where.ts`/
//! `evaluate.ts`, verified by running the TypeScript reference directly.
use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::json;
use we_expr::{eval, parse, CallableRef, Env, MapEnv, Value};

fn obj(entries: &[(&str, Value)]) -> Value {
    let mut m: IndexMap<Arc<str>, Value> = IndexMap::new();
    for (k, v) in entries {
        m.insert(Arc::from(*k), v.clone());
    }
    Value::Obj(Arc::new(m))
}

fn list(items: &[Value]) -> Value {
    items.to_vec().into()
}

/// Build a `$localMetaEntry` meta object: `{touched: () => t, errors: () => e}`
/// — the shape `encode.ts`'s `{"$localMetaEntry": true}` marker decodes to.
fn meta_entry(touched: bool, errors: &[&str]) -> Value {
    let errs: Vec<Value> = errors.iter().map(|e| Value::from(*e)).collect();
    let mut m: IndexMap<Arc<str>, Value> = IndexMap::new();
    m.insert(
        "touched".into(),
        Value::Callable(CallableRef::new("touched", move |_| touched.into())),
    );
    m.insert(
        "errors".into(),
        Value::Callable(CallableRef::new("errors", move |_| errs.clone().into())),
    );
    Value::Obj(Arc::new(m))
}

/// A `$localMeta` bag from (name, touched, errors) rows.
fn local_meta(entries: &[(&str, bool, &[&str])]) -> Value {
    let mut m: IndexMap<Arc<str>, Value> = IndexMap::new();
    for (name, touched, errors) in entries {
        m.insert(Arc::from(*name), meta_entry(*touched, errors));
    }
    Value::Obj(Arc::new(m))
}

/// `__argN` bindings layered over a base env, so `call` can take a `&MapEnv`.
struct ArgEnv<'a> {
    base: &'a MapEnv,
    args: MapEnv,
}

impl Env for ArgEnv<'_> {
    fn root(&self, name: &str) -> Option<Value> {
        self.args.root(name).or_else(|| self.base.root(name))
    }
    fn call(&self, name: &str, args: &[Value]) -> Value {
        self.base.call(name, args)
    }
}

/// Call a built-in the way `functions.json`'s harness does: bind each argument
/// to `__argN` and evaluate `name(__arg0, …)` — through the real dispatch.
fn call(name: &str, args: &[Value], base: &MapEnv) -> Value {
    let mut arg_env = MapEnv::new();
    let names: Vec<String> = args
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let name = format!("__arg{i}");
            arg_env.set_root(name.as_str(), a.clone());
            name
        })
        .collect();
    let env = ArgEnv {
        base,
        args: arg_env,
    };
    let source = format!("{}({})", name, names.join(", "));
    eval(&parse(&source).unwrap(), &env)
}

fn call_json(name: &str, args: &[Value], base: &MapEnv) -> serde_json::Value {
    call(name, args, base).to_json()
}

/// `formValid` and friends read `$localMeta`/`$localScopeFields` from context
/// roots — TS checks `errors()` only, iterates exactly the supplied scope
/// list, and converts the field argument with `asText`.
#[test]
fn p2_1_form_functions_contract() {
    // The distinguishing case: a valid-but-untouched field in scope is VALID.
    let env = MapEnv::new()
        .with_root("$localMeta", local_meta(&[("a", false, &[])]))
        .with_root("$localScopeFields", vec![Value::from("a")]);
    assert_eq!(
        call_json("formValid", &[], &env),
        json!(true),
        "formValid: untouched-but-clean field must not invalidate the form"
    );

    // An empty scope list iterates nothing — bad fields outside it don't count.
    let env = MapEnv::new()
        .with_root("$localMeta", local_meta(&[("a", true, &["bad"])]))
        .with_root("$localScopeFields", Vec::<Value>::new());
    assert_eq!(call_json("formValid", &[], &env), json!(true));

    // No `$localScopeFields` at all is also vacuous — `!fields → return true`.
    let env = MapEnv::new().with_root("$localMeta", local_meta(&[("a", true, &["bad"])]));
    assert_eq!(call_json("formValid", &[], &env), json!(true));

    // And a bad field inside the scope still fails.
    let env = MapEnv::new()
        .with_root("$localMeta", local_meta(&[("a", true, &["bad"])]))
        .with_root("$localScopeFields", vec![Value::from("a")]);
    assert_eq!(call_json("formValid", &[], &env), json!(false));

    // A scope entry absent from the meta map is `?? 0` errors — valid.
    let env = MapEnv::new()
        .with_root("$localMeta", local_meta(&[("a", true, &["bad"])]))
        .with_root("$localScopeFields", vec![Value::from("b")]);
    assert_eq!(call_json("formValid", &[], &env), json!(true));
}

/// The field argument is `asText`'d — a missing or numeric argument names a
/// field (`''`/`'5'`), never aggregates the whole form.
#[test]
fn p2_1_form_field_arg_is_text_not_aggregate() {
    let env = MapEnv::new().with_root("$localMeta", local_meta(&[("a", true, &["bad"])]));
    // No argument: asText(undefined) is `''`; the `''` field has no entry —
    // valid/untouched/no error, per TS.
    assert_eq!(call_json("valid", &[], &env), json!(true));
    assert_eq!(call_json("touched", &[], &env), json!(false));
    assert_eq!(call_json("error", &[], &env), json!(""));
    // A numeric argument names field '5', which has no entry either.
    assert_eq!(call_json("valid", &[5.into()], &env), json!(true));
    assert_eq!(call_json("touched", &[5.into()], &env), json!(false));
    assert_eq!(call_json("error", &[5.into()], &env), json!(""));
    // …and a meta entry literally named '5' or '' is what those calls read.
    let env = MapEnv::new().with_root(
        "$localMeta",
        local_meta(&[("5", true, &["e5"]), ("", false, &[])]),
    );
    assert_eq!(call_json("error", &[5.into()], &env), json!("e5"));
    assert_eq!(call_json("valid", &[5.into()], &env), json!(false));
    assert_eq!(call_json("error", &[], &env), json!("")); // '' untouched
}

/// `round` is `Math.round(asNumber(v) * 10 ** max(0, floor(asNumber(d)))) /
/// factor` — a negative digit count clamps to 0 (integer result), a
/// fractional one floors, and `Math.round` keeps the sign of a zero result.
#[test]
fn p2_2_round_ts_digits_and_signed_zero() {
    let env = MapEnv::new();
    // Negative digits: max(0, floor(-1)) is 0 — round to an integer, not tens.
    assert_eq!(
        call_json("round", &[123.45.into(), (-1).into()], &env),
        json!(123)
    );
    // Fractional digits: floor(0.5) is 0 — not a √10 factor.
    assert_eq!(
        call_json("round", &[1.25.into(), 0.5.into()], &env),
        json!(1)
    );
    // `Math.round(-0.1)` and `Math.round(-0.5)` are `-0`, not `+0`.
    assert_eq!(
        call_json("round", &[(-0.1).into()], &env),
        json!({ "$number": "-0" })
    );
    assert_eq!(
        call_json("round", &[(-0.5).into()], &env),
        json!({ "$number": "-0" })
    );
    // `2.675*100 === 267.5` in IEEE — no epsilon nudge needed for 2.68.
    assert_eq!(
        call_json("round", &[2.675.into(), 2.into()], &env),
        json!(2.68)
    );
    // Halves go toward +∞, so -2.5 → -2 (existing vector round.104).
    assert_eq!(call_json("round", &[(-2.5).into()], &env), json!(-2));
    // A huge digit count: factor overflows, `Math.round(±∞)/∞` → NaN.
    assert_eq!(
        call_json("round", &[1.into(), 1e21.into()], &env),
        json!({ "$nan": true })
    );
}

/// Every text built-in starts with `asText(arg)` — a number, a list, a bool
/// or null all convert; nothing is rejected for not being a `Str`.
#[test]
fn p2_3_text_functions_apply_as_text() {
    let env = MapEnv::new();
    // contains: substring in the *text* form — a list reads as its joined
    // text (`String([12])` is '12'), there is no membership interpretation.
    assert_eq!(
        call_json("contains", &[12.into(), "2".into()], &env),
        json!(true)
    );
    assert_eq!(
        call_json("contains", &[vec![Value::from(12)].into(), 2.into()], &env),
        json!(true)
    );
    assert_eq!(
        call_json("contains", &[false.into(), "als".into()], &env),
        json!(true)
    );
    assert_eq!(
        call_json("contains", &[Value::Undefined, "x".into()], &env),
        json!(false)
    );
    // split: asText then cut — a non-string is its text, not [].
    assert_eq!(call_json("split", &[12.into()], &env), json!(["12"]));
    assert_eq!(call_json("split", &[Value::Null], &env), json!([]));
    // `separator === undefined` defaults — `null` does not (it is '').
    assert_eq!(
        call_json("split", &["a,b".into(), Value::Undefined], &env),
        json!(["a", "b"])
    );
    assert_eq!(
        call_json("split", &["a,b".into(), Value::Null], &env),
        json!(["a", ",", "b"])
    );
    assert_eq!(
        call_json(
            "join",
            &[vec![1.into(), 2.into()].into(), Value::Null],
            &env
        ),
        json!("12")
    );
    // startsWith/endsWith/trim/lower/upper — all asText first.
    assert_eq!(
        call_json("startsWith", &[Value::Null, "".into()], &env),
        json!(true)
    );
    assert_eq!(
        call_json("startsWith", &[123.into(), "1".into()], &env),
        json!(true)
    );
    assert_eq!(
        call_json("endsWith", &[12.into(), "2".into()], &env),
        json!(true)
    );
    assert_eq!(call_json("trim", &[12.into()], &env), json!("12"));
    assert_eq!(call_json("lower", &[12.into()], &env), json!("12"));
    assert_eq!(call_json("upper", &[12.into()], &env), json!("12"));
}

/// `distinct` dedupes a JS `Set` on `entry.id !== undefined ? entry.id :
/// entry` — identity for containers, not structural equality.
#[test]
fn p2_4_distinct_set_identity() {
    let env = MapEnv::new();
    // Two empty objects are two Set entries — distinct keeps both.
    let two_empty = list(&[obj(&[]), obj(&[])]);
    assert_eq!(
        call_json("count", &[call("distinct", &[two_empty], &env)], &env),
        json!(2)
    );
    // …so are two objects whose `id` is present-but-undefined (key = entry).
    let undefined_ids = list(&[
        obj(&[("id", Value::Undefined)]),
        obj(&[("id", Value::Undefined)]),
    ]);
    assert_eq!(
        call_json("count", &[call("distinct", &[undefined_ids], &env)], &env),
        json!(2)
    );
    // Two equal lists allocated separately are still two identities.
    let equal_lists = list(&[list(&[1.into()]), list(&[1.into()])]);
    assert_eq!(
        call_json("count", &[call("distinct", &[equal_lists], &env)], &env),
        json!(2)
    );
    // Object `id`s dedupe by identity too — equal id-objects stay distinct.
    let object_ids = list(&[
        obj(&[("id", obj(&[("k", 1.into())]))]),
        obj(&[("id", obj(&[("k", 1.into())]))]),
    ]);
    assert_eq!(
        call_json("count", &[call("distinct", &[object_ids], &env)], &env),
        json!(2)
    );
    // The intended dedupe still holds: same scalar id, and SameValueZero.
    let same_id = list(&[
        obj(&[("id", 1.into()), ("v", "x".into())]),
        obj(&[("id", 1.into()), ("v", "y".into())]),
    ]);
    assert_eq!(
        call_json("count", &[call("distinct", &[same_id], &env)], &env),
        json!(1)
    );
    let nans = list(&[f64::NAN.into(), f64::NAN.into()]);
    assert_eq!(
        call_json("count", &[call("distinct", &[nans], &env)], &env),
        json!(1)
    );
}

/// `filter`'s `limit` slices only `typeof limit === 'number' && limit >= 0`
/// — anything else (undefined, a numeric string, null, negative, NaN)
/// leaves the whole list.
#[test]
fn p2_5_filter_limit_type_gate() {
    let env = MapEnv::new();
    let items = list(&[1.into(), 2.into()]);
    let where_ = obj(&[]);
    for (limit, name) in [
        (Value::Undefined, "undefined"),
        (Value::Null, "null"),
        ((-1).into(), "-1"),
        ("1".into(), "'1'"),
        (f64::NAN.into(), "NaN"),
    ] {
        assert_eq!(
            call_json("filter", &[items.clone(), where_.clone(), limit], &env),
            json!([1, 2]),
            "filter limit {name} must not truncate"
        );
    }
    // A real numeric limit still slices — and `slice(0, 1.7)` floors.
    assert_eq!(
        call_json("filter", &[items.clone(), where_.clone(), 1.into()], &env),
        json!([1])
    );
    assert_eq!(
        call_json("filter", &[items.clone(), where_.clone(), 1.7.into()], &env),
        json!([1])
    );
    assert_eq!(
        call_json("filter", &[items, where_, 0.into()], &env),
        json!([])
    );
}

/// `Number(str)` takes radix literals only *unsigned* — `'+0x1'`/`'-0b1'`
/// are `NaN` — and `Number(list)` is `Number` of the comma-joined text, so a
/// single element converts through `String(x)`, never directly.
#[test]
fn p2_6_number_coercion() {
    let env = MapEnv::new();
    let run = |source: &str, env: &MapEnv| eval(&parse(source).unwrap(), env);
    // Signed radix strings are NaN — arithmetic clamps them to 0.
    assert_eq!(run("'+0x1' - 0", &env).to_json(), json!(0));
    assert_eq!(run("'-0b1' - 0", &env).to_json(), json!(0));
    assert_eq!(run("'-0x10' - 0", &env).to_json(), json!(0));
    // …while the unsigned forms still parse, and a bare prefix is NaN.
    assert_eq!(run("'0x10' - 0", &env).to_json(), json!(16));
    assert_eq!(run("'0x' - 0", &env).to_json(), json!(0));
    // `Number([x])` is `Number(String(x))`: [true] is 'true' → NaN → 0,
    // [undefined]/[null] are '' → 0, [[1]] is '1' → 1.
    assert_eq!(run("[true] - 0", &env).to_json(), json!(0));
    assert_eq!(run("[[1]] - 0", &env).to_json(), json!(1));
    assert_eq!(run("[[]] - 0", &env).to_json(), json!(0));
    assert_eq!(
        call_json(
            "plural",
            &[list(&[true.into()]), "one".into(), "other".into()],
            &env
        ),
        json!("other")
    );
    assert_eq!(
        call_json(
            "plural",
            &[list(&[Value::Undefined]), "one".into(), "other".into()],
            &env
        ),
        json!("other")
    );
    assert_eq!(
        call_json(
            "plural",
            &[list(&[1.into()]), "one".into(), "other".into()],
            &env
        ),
        json!("one")
    );
}

/// The where grammar (`where.ts`) — OR/AND take lists of records, NOT takes
/// a record, and a field's operator object resolves in family order
/// (exists → contains → range → anchors → not), not all-keys-AND. Field
/// reads go through `readField`, so denied names never reach the data.
#[test]
fn p2_7_where_matcher_reference_shape() {
    let env = MapEnv::new();
    let rows = || list(&[obj(&[("v", 1.into())])]);
    // OR/AND operands must be lists of records; other shapes fail the key.
    assert_eq!(
        call_json(
            "filter",
            &[rows(), obj(&[("OR", obj(&[("v", 1.into())]))])],
            &env
        ),
        json!([])
    );
    assert_eq!(
        call_json(
            "filter",
            &[rows(), obj(&[("AND", obj(&[("v", 1.into())]))])],
            &env
        ),
        json!([])
    );
    assert_eq!(
        call_json(
            "filter",
            &[
                rows(),
                obj(&[("OR", list(&[obj(&[("v", 2.into())]), 1.into()]))])
            ],
            &env
        ),
        json!([]),
        "a non-record OR branch cannot match"
    );
    // NOT's operand must be a record — `{NOT: 1}` fails, not "didn't match".
    assert_eq!(
        call_json("filter", &[rows(), obj(&[("NOT", 1.into())])], &env),
        json!([])
    );
    assert_eq!(
        call_json(
            "filter",
            &[rows(), obj(&[("NOT", obj(&[("v", 2.into())]))])],
            &env
        ),
        json!([{"v": 1}])
    );
    // Operator families in priority order — `exists` answers alone, other
    // keys in the object do not tighten it.
    assert_eq!(
        call_json(
            "filter",
            &[
                rows(),
                obj(&[("v", obj(&[("exists", true.into()), ("gt", 2.into())]))])
            ],
            &env
        ),
        json!([{"v": 1}])
    );
    // `contains` answers before `not` — `{not:1, contains:'1'}` passes: the
    // `not` is never reached.
    assert_eq!(
        call_json(
            "filter",
            &[
                rows(),
                obj(&[("v", obj(&[("not", 1.into()), ("contains", "1".into())]))])
            ],
            &env
        ),
        json!([{"v": 1}])
    );
    // An unrecognised key is ignored; a `not` beside it still applies.
    assert_eq!(
        call_json(
            "filter",
            &[
                rows(),
                obj(&[("v", obj(&[("bogus", 1.into()), ("not", 2.into())]))])
            ],
            &env
        ),
        json!([{"v": 1}])
    );
    assert_eq!(
        call_json(
            "filter",
            &[
                rows(),
                obj(&[("v", obj(&[("bogus", 1.into()), ("not", 1.into())]))])
            ],
            &env
        ),
        json!([])
    );
    // A record condition with no operator family is a strict-equality test —
    // `{}` can never `===`.
    assert_eq!(
        call_json("filter", &[rows(), obj(&[("v", obj(&[]))])], &env),
        json!([])
    );
    // A denied field name reads `undefined` — `{constructor: 'x'}` matches
    // nothing even when the record holds that key (env-supplied where, so the
    // parser's static denial cannot protect it).
    let rows = list(&[obj(&[("constructor", "secret".into())])]);
    assert_eq!(
        call_json(
            "filter",
            &[rows, obj(&[("constructor", "secret".into())])],
            &env
        ),
        json!([])
    );
    // List items read 'length' and canonical numeric keys like JS arrays.
    let lists = list(&[list(&[9.into()]), list(&[1.into(), 2.into()])]);
    assert_eq!(
        call_json(
            "filter",
            &[lists.clone(), obj(&[("length", 2.into())])],
            &env
        ),
        json!([[1, 2]])
    );
    assert_eq!(
        call_json("filter", &[lists, obj(&[("0", 9.into())])], &env),
        json!([[9]])
    );
}

/// `evaluate.ts` has no eval-depth cap. Flat left-associative chains spend
/// none of the parser's 40-level nesting budget, so a ≤4000-unit source can
/// hold an AST far deeper — and TS evaluates all of it. Verified live: TS
/// returns 150, 7, 42 and the full nested-template string.
#[test]
fn p2_8_flat_chains_evaluate_fully() {
    // 150 `1` terms joined by `+` — 299 units.
    let src = vec!["1"; 150].join("+");
    let expr = parse(&src).unwrap();
    assert_eq!(eval(&expr, &MapEnv::new()).to_json(), json!(150));

    // A flat member chain `x.a.a…` 120 deep is the same class.
    let mut v: Value = 7.into();
    for _ in 0..119 {
        v = obj(&[("a", v)]);
    }
    let mut env = MapEnv::new();
    env.set_root("x", v);
    let expr = parse(&format!("x{}", ".a".repeat(119))).unwrap();
    assert_eq!(eval(&expr, &env).to_json(), json!(7));

    // And a flat index chain `x[0][0]…` 150 deep.
    let mut v: Value = 42.into();
    for _ in 0..150 {
        v = list(&[v]);
    }
    env.set_root("x", v);
    let expr = parse(&format!("x{}", "[0]".repeat(150))).unwrap();
    assert_eq!(eval(&expr, &env).to_json(), json!(42));

    // Nested template holes are the other unbounded-depth source — each hole
    // re-parses at depth 0. Sixty nestings sit inside 4000 units.
    let mut s = "`a`".to_string();
    for _ in 0..60 {
        s = format!("`x${{{s}}}y`");
    }
    let expr = parse(&s).unwrap();
    let expected = format!("{}a{}", "x".repeat(60), "y".repeat(60));
    assert_eq!(eval(&expr, &MapEnv::new()).to_json(), json!(expected));
}

/// Number→text above 2^53: JS prints the shortest decimal that round-trips,
/// not the exact binary integer. `'' + 1000000000000000128` is
/// '1000000000000000100' in TS.
#[test]
fn p3_9_big_number_text_is_shortest_round_trip() {
    let src = "'' + 1000000000000000128";
    let expr = parse(src).unwrap();
    assert_eq!(
        eval(&expr, &MapEnv::new()).to_json(),
        json!("1000000000000000100")
    );
}

/// `[7]['00']` is `undefined` in JS — `'00' in [7]` is false: only the
/// canonical digits of an index are array keys. `'+0'`, `' 0'`, `'0x0'`
/// likewise.
#[test]
fn p3_10_loose_string_indices_do_not_index() {
    let env = MapEnv::new();
    for index in ["'00'", "'+0'", "' 0'", "'0x0'"] {
        let expr = parse(&format!("[7][{index}]")).unwrap();
        assert_eq!(
            eval(&expr, &env).to_json(),
            json!({"$undefined": true}),
            "index {index} must not read element 0"
        );
    }
    let expr = parse("[7]['0']").unwrap();
    assert_eq!(eval(&expr, &env).to_json(), json!(7));
}
