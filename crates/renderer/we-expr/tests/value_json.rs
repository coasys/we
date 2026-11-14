//! `Value` <-> JSON with the four vector markers from task C1:
//! `$undefined`, `$nan`, `$namespace`, `$callable`.
use indexmap::IndexMap;
use serde_json::json;
use std::sync::Arc;
use we_expr::{CallableRef, MapNamespace, Value};

fn obj(entries: Vec<(&str, Value)>) -> Value {
    Value::Obj(Arc::new(
        entries
            .into_iter()
            .map(|(k, v)| (Arc::from(k), v))
            .collect(),
    ))
}

fn round_trip(value: Value) -> Value {
    Value::from_json(&value.to_json())
}

#[test]
fn markers_round_trip() {
    assert!(round_trip(Value::Undefined).is_undefined());
    assert!(round_trip(Value::Num(f64::NAN)).to_json() == json!({"$nan": true}));
    let ns = MapNamespace::new(IndexMap::from([("a".into(), 1.into())]));
    match round_trip(Value::namespace(ns)) {
        Value::Namespace(ns) => {
            assert!(ns.get("a").strict_eq(&1.into()));
            assert_eq!(ns.keys(), vec!["a".into()]);
        }
        other => panic!("expected a namespace, got {other:?}"),
    }
    match round_trip(Value::from(CallableRef::named("save"))) {
        Value::Callable(c) => {
            assert_eq!(c.name(), "save");
            assert!(c.call(&[]).is_undefined());
        }
        other => panic!("expected a callable, got {other:?}"),
    }
}

#[test]
fn plain_values_round_trip() {
    let value = obj(vec![
        ("s", "text".into()),
        ("n", 1.5.into()),
        ("b", true.into()),
        ("z", Value::Null),
        ("u", Value::Undefined),
        ("l", vec![1.into(), "two".into()].into()),
        ("o", obj(vec![("x", "y".into())])),
    ]);
    assert_eq!(value.to_json(), round_trip(value.clone()).to_json());
}

#[test]
fn key_order_is_kept() {
    // A `BTreeMap` instead of `IndexMap` turns this red: the order `z, a, m`
    // written is the order read back out.
    let value = obj(vec![("z", 1.into()), ("a", 2.into()), ("m", 3.into())]);
    let json = value.to_json();
    let keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["z", "a", "m"]);
}

/// `encode.ts`'s `$number` marker: the numbers JSON cannot spell — `-0`
/// (which `JSON.stringify` prints as `0`) and the infinities (which it
/// prints as `null`) — plus a bigint's digits.
#[test]
fn number_markers_round_trip() {
    for (n, encoded) in [
        (-0.0, json!({"$number": "-0"})),
        (f64::INFINITY, json!({"$number": "Infinity"})),
        (f64::NEG_INFINITY, json!({"$number": "-Infinity"})),
    ] {
        assert_eq!(Value::Num(n).to_json(), encoded);
        match Value::from_json(&encoded) {
            Value::Num(back) => {
                assert_eq!(back.to_bits(), n.to_bits(), "sign and value kept");
            }
            other => panic!("expected a number, got {other:?}"),
        }
    }
    // A bigint's digits decode as `Number(t)`, as `encode.ts` does.
    match Value::from_json(&json!({"$number": "9007199254740993"})) {
        Value::Num(n) => assert_eq!(n, 9007199254740992.0),
        other => panic!("expected a number, got {other:?}"),
    }
}

/// `JSON.stringify` prints a whole number without a fraction — `2`, never
/// `2.0` — so the codec writes a JSON integer.
#[test]
fn whole_numbers_write_as_integers() {
    assert_eq!(
        serde_json::to_string(&Value::from(2.0).to_json()).unwrap(),
        "2"
    );
    assert_eq!(Value::from(2.0).to_json(), json!(2));
    assert_eq!(Value::from(-7.0).to_json(), json!(-7));
    // Fractions keep them, and a whole number beyond MAX_SAFE_INTEGER does
    // not pretend to be an i64.
    assert_eq!(
        serde_json::to_string(&Value::from(2.5).to_json()).unwrap(),
        "2.5"
    );
    assert!(Value::from(1.5e17)
        .to_json()
        .as_f64()
        .is_some_and(|n| n == 1.5e17));
}

/// `{"$namespace": true}` — the opaque form `encode.ts` writes when a
/// namespace has no enumerable members (output position only).
#[test]
fn opaque_namespace_round_trip() {
    let encoded = json!({"$namespace": true});
    match Value::from_json(&encoded) {
        Value::Namespace(ns) => {
            assert!(ns.keys().is_empty());
            assert!(ns.get("anything").is_undefined());
        }
        other => panic!("expected a namespace, got {other:?}"),
    }
    // And a namespace with nothing enumerable writes the same marker.
    let empty = MapNamespace::new(IndexMap::new());
    assert_eq!(Value::namespace(empty).to_json(), encoded);
    // A namespace with members still writes the member map.
    let bag = MapNamespace::new(IndexMap::from([("a".into(), 1.into())]));
    assert_eq!(
        Value::namespace(bag).to_json(),
        json!({"$namespace": {"a": 1}})
    );
}

/// `{"$localMetaEntry": true, touched, errors}` — the context shape the
/// `error`/`valid`/`touched`/`formValid` built-ins read (the `*.117`-`*.121`
/// function vectors). Decodes to an object of two nullary callables.
#[test]
fn local_meta_entry_decodes() {
    let encoded = json!({
        "$localMeta": {
            "email": {"$localMetaEntry": true, "touched": true, "errors": ["required"]}
        }
    });
    let Value::Obj(meta) = Value::from_json(&encoded["$localMeta"]) else {
        panic!("expected an object");
    };
    let Value::Obj(entry) = &meta["email"] else {
        panic!("expected the entry to be an object");
    };
    for (key, want) in [
        ("touched", true.into()),
        ("errors", vec!["required".into()].into()),
    ] {
        match entry.get(key) {
            Some(Value::Callable(c)) => {
                let got = c.call(&[]);
                assert!(
                    got.strict_eq(&want) || got.to_json() == want.to_json(),
                    "{key}() -> {got:?}, expected {want:?}"
                );
            }
            other => panic!("expected {key} to be callable, got {other:?}"),
        }
    }
}

#[test]
fn markers_are_only_read_as_sole_key() {
    // A record that happens to carry a marker name beside its own fields is a
    // record, not a marker.
    let record = json!({"$undefined": true, "data": 1});
    match Value::from_json(&record) {
        Value::Obj(o) => assert_eq!(o.len(), 2),
        other => panic!("expected an object, got {other:?}"),
    }
}

#[test]
fn serde_uses_the_same_encoding() {
    let value = Value::Undefined;
    assert_eq!(
        serde_json::to_value(&value).unwrap(),
        json!({"$undefined": true})
    );
    assert!(serde_json::from_value::<Value>(json!({"$undefined": true}))
        .unwrap()
        .is_undefined());
}
