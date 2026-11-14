//! The minimal evaluator, against a hand-written table. Written from the spec
//! (`evaluate.ts` semantics), not from the implementation.
use indexmap::IndexMap;
use std::sync::Arc;
use we_expr::{eval, parse, MapEnv, MapNamespace, ParseCache, Value};

fn obj(entries: &[(&str, Value)]) -> Value {
    Value::Obj(Arc::new(
        entries
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect(),
    ))
}

fn env() -> MapEnv {
    let deep = obj(&[("a", 1.into())]);
    let bag = obj(&[("b", "x".into()), ("deep", deep), ("zero", 0.into())]);
    let list: Value = vec![1.into(), 2.into(), 3.into()].into();
    let same_list = list.clone();
    let other_list: Value = vec![1.into(), 2.into(), 3.into()].into();
    let ns = MapNamespace::new(IndexMap::from([("b".into(), "from-ns".into())]));
    MapEnv::new()
        .with_root("bag", bag)
        .with_root("list", list)
        .with_root("same_list", same_list)
        .with_root("other_list", other_list)
        .with_root("s", "héllo")
        .with_root("falsy_str", "")
        .with_root("ns", ns)
}

fn run(source: &str) -> Value {
    let expr = parse(source).unwrap_or_else(|e| panic!("{source:?} did not parse: {e}"));
    eval(&expr, &env())
}

/// The cases as (source, expected). Scalars compare by `strict_eq`; everything
/// else by its JSON encoding.
#[test]
fn minimal_evaluator() {
    let cases: &[(&str, Value)] = &[
        // literals
        ("'hello'", "hello".into()),
        ("\"hello\"", "hello".into()),
        ("42", 42.into()),
        ("3.5", 3.5.into()),
        ("true", true.into()),
        ("false", false.into()),
        ("null", Value::Null),
        // names
        ("missing", Value::Undefined),
        ("s", "héllo".into()),
        // member and index access
        ("bag.b", "x".into()),
        ("bag.deep.a", 1.into()),
        ("bag.missing", Value::Undefined),
        ("missing.b", Value::Undefined),
        ("list[0]", 1.into()),
        ("list[2]", 3.into()),
        ("list[5]", Value::Undefined),
        ("list['0']", 1.into()),
        ("list.length", 3.into()),
        ("s.length", 5.into()),
        ("ns.b", "from-ns".into()),
        ("ns.missing", Value::Undefined),
        // strict equality — `===`, never `==` coerced
        ("1 == 1", true.into()),
        ("1 == '1'", false.into()),
        ("null == false", false.into()),
        ("missing == missing", true.into()),
        ("null == missing", false.into()),
        ("1 != '1'", true.into()),
        ("list == same_list", true.into()),
        ("list == other_list", false.into()),
        ("bag == bag", true.into()),
        // `!`
        ("!true", false.into()),
        ("!0", true.into()),
        ("!missing", true.into()),
        ("!falsy_str", true.into()),
        ("!list", false.into()),
        // `&&`/`||` answer with booleans
        ("1 && 'x'", true.into()),
        ("0 && missing", false.into()),
        ("missing && 1", false.into()),
        ("0 || 'x'", true.into()),
        ("falsy_str || 0", false.into()),
        ("false || missing", false.into()),
        ("bag.zero && bag.b", false.into()),
        // ternary and parentheses
        ("true ? 1 : 2", 1.into()),
        ("missing ? 1 : 2", 2.into()),
        ("bag.b == 'x' ? 'yes' : 'no'", "yes".into()),
        ("(missing || false) ? 'a' : 'b'", "b".into()),
        ("!(missing || false)", true.into()),
        // unary minus
        ("-5", (-5).into()),
        ("-bag.zero", 0.into()),
    ];
    for (source, expected) in cases {
        let actual = run(source);
        assert!(
            actual.strict_eq(expected) || actual.to_json() == expected.to_json(),
            "{source:?} -> {actual:?}, expected {expected:?}"
        );
    }
}

#[test]
fn syntax_errors() {
    for bad in [
        "",
        "1 ==",
        "(",
        "a.",
        "a[",
        "'unterminated",
        "a ? 1",
        "* 2",
        // denied properties are rejected at parse time, like parser.ts
        "bag.__proto__",
        "bag.constructor",
        "bag.prototype",
    ] {
        assert!(parse(bad).is_err(), "{bad:?} should not parse");
    }
}

#[test]
fn cache_parses_each_source_once() {
    let mut cache = ParseCache::new();
    let first = cache.parse("a.b").unwrap();
    let second = cache.parse("a.b").unwrap();
    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(cache.len(), 1);
    assert!(cache.parse("a ??").is_err()); // an error is remembered too
    assert_eq!(cache.len(), 2);
}
