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
