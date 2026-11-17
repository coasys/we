//! A member the host owns (`StoreBag::set_host_member`): it reads through
//! `root` and `root_base` whatever the store root underneath is rebound to,
//! and moving it wakes a subscribed session. `spaceStore.firstScreenOpen` is
//! one: the renderer opens it after its first frame, and a live layer that
//! re-binds the `spaceStore` root meanwhile must not take it away.
use we_expr::{MapNamespace, Value};
use we_template::StoreBag;

fn obj(pairs: &[(&str, Value)]) -> Value {
    Value::namespace(MapNamespace::new(
        pairs
            .iter()
            .map(|(k, v)| ((*k).into(), v.clone()))
            .collect(),
    ))
}

fn member(bag: &StoreBag, store: &str, key: &str, base: bool) -> Value {
    let root = if base {
        bag.root_base(store)
    } else {
        bag.root(store)
    };
    match root {
        Some(Value::Namespace(ns)) => ns.get(key),
        _ => Value::Undefined,
    }
}

#[test]
fn a_host_member_survives_a_root_rebind_and_moves_the_revision() {
    let bag = StoreBag::new();
    bag.set_root("spaceStore", obj(&[("root", Value::from("r1"))]));
    assert!(member(&bag, "spaceStore", "firstScreenOpen", false).is_undefined());

    bag.set_host_member("spaceStore", "firstScreenOpen", Value::Bool(false));
    for base in [false, true] {
        assert!(member(&bag, "spaceStore", "firstScreenOpen", base).strict_eq(&Value::Bool(false)));
        assert!(member(&bag, "spaceStore", "root", base).strict_eq(&Value::from("r1")));
    }

    // A live layer rebinds the root: the host member is still there.
    bag.set_root("spaceStore", obj(&[("root", Value::from("r2"))]));
    assert!(member(&bag, "spaceStore", "firstScreenOpen", false).strict_eq(&Value::Bool(false)));
    assert!(member(&bag, "spaceStore", "root", false).strict_eq(&Value::from("r2")));

    let before = bag.version();
    bag.set_host_member("spaceStore", "firstScreenOpen", Value::Bool(true));
    assert!(bag.version() > before, "the data revision moved");
    assert!(member(&bag, "spaceStore", "firstScreenOpen", false).strict_eq(&Value::Bool(true)));
}

#[test]
fn the_same_root_gives_the_same_overlay() {
    // Readers compare roots by identity (an edit on a member's `initial` is
    // kept while the root is the same one), so a read that finds nothing
    // moved must hand back the same namespace.
    let bag = StoreBag::new();
    bag.set_root("spaceStore", obj(&[("root", Value::from("r1"))]));
    bag.set_host_member("spaceStore", "firstScreenOpen", Value::Bool(true));
    let ptr = |v: Option<Value>| match v {
        Some(Value::Namespace(ns)) => std::sync::Arc::as_ptr(&ns) as *const () as usize,
        _ => 0,
    };
    let a = ptr(bag.root("spaceStore"));
    assert_ne!(a, 0);
    assert_eq!(a, ptr(bag.root("spaceStore")));
    assert_eq!(a, ptr(bag.root_base("spaceStore")));
    bag.set_root("spaceStore", obj(&[("root", Value::from("r2"))]));
    assert_ne!(
        a,
        ptr(bag.root("spaceStore")),
        "a new root is a new overlay"
    );
}
