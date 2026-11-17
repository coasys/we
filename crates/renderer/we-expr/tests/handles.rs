//! E3c-7: interned handles (`HandleRef`/`HandleTable`/`SpaceHandle`) and the
//! mount identity types (`Tier`, `MountCx`, `Provenance`, `BundleSlot`,
//! `MountId`) — stamping only. Expected values come from E3c-design 4.2,
//! 4.4 and 4.6.5, not from the implementation's output.

use we_expr::{
    eval, parse, HandleKind, HandleTable, MapEnv, MapNamespace, MountCx, Namespace, Provenance,
    Tier, Value,
};

#[test]
fn a_handle_is_minted_by_its_table_and_interned() {
    let table = HandleTable::new();
    let a = table.mint(HandleKind::Space, "preview-coasys");
    let again = table.mint(HandleKind::Space, "preview-coasys");
    let other = table.mint(HandleKind::Space, "other-space");
    let dataset = table.mint(HandleKind::Dataset, "preview-coasys");

    // Interned: the same ask answers the same handle; `==` is identity.
    assert_eq!(a, again);
    assert_ne!(a, other);
    // Kind is part of the identity: a space and a dataset named alike
    // are not the same handle.
    assert_ne!(a, dataset);
    assert_eq!(a.kind(), HandleKind::Space);
    assert_eq!(dataset.kind(), HandleKind::Dataset);

    // The host's way back: only this table resolves its own handles.
    assert_eq!(table.key(&a).as_deref(), Some("preview-coasys"));
    assert_eq!(table.key(&other).as_deref(), Some("other-space"));
}

#[test]
fn mint_space_gives_a_space_handle() {
    let table = HandleTable::new();
    let space = table.mint_space("preview-coasys");
    assert_eq!(space.handle().kind(), HandleKind::Space);
    assert_eq!(table.key(space.handle()).as_deref(), Some("preview-coasys"));
}

#[test]
fn a_tainted_twin_resolves_to_nothing() {
    let table = HandleTable::new();
    let h = table.mint(HandleKind::Dataset, "d1");

    let twin_a = h.tainted();
    let twin_b = h.tainted();
    // Twins of one handle are `==` to each other — a template can compare
    // what it was handed — and to nothing the table answers.
    assert_eq!(twin_a, twin_b);
    assert!(twin_a.is_tainted());
    assert_ne!(twin_a, h, "a tainted twin is not the handle itself");
    assert_eq!(
        table.key(&twin_a),
        None,
        "a tainted handle resolves to nothing"
    );
    // The original the twin degrades is still reachable for a use-site check.
    assert_eq!(twin_a.untainted(), Some(h.clone()));
    assert_eq!(table.key(&h).as_deref(), Some("d1"));
}

#[test]
fn forged_handle_is_impossible() {
    // Type level: `HandleRef` has no public constructor — only
    // `HandleTable::mint` makes one (the `compile_fail` doctest on
    // `HandleTable` proves `HandleRef::new(...)` does not compile).
    // Runtime level: a `HandleRef` this table did not mint — a different
    // table's handle is the closest thing to a forgery that can be
    // built — resolves to nothing instead of probing for authority.
    let table = HandleTable::new();
    let foreign = HandleTable::new().mint(HandleKind::Space, "preview-coasys");
    assert_eq!(table.key(&foreign), None);
}

#[test]
fn a_handle_value_is_opaque_in_expressions() {
    let table = HandleTable::new();
    let h = table.mint(HandleKind::Space, "preview-coasys");

    let v = Value::handle(h.clone());
    let Value::Namespace(ns) = &v else {
        panic!("a handle is a namespace value");
    };
    // It reports as a handle — and as nothing else: no members to read,
    // no enumeration, no string. `settle` keeps the handle — a handle is
    // a value, not a store, or `==` would collapse to `Undefined`s.
    assert_eq!(ns.as_handle(), Some(&h));
    assert!(ns.get("id").is_undefined());
    assert!(ns.get("uuid").is_undefined());
    assert!(ns.keys().is_empty());
    let Value::Namespace(settled) = v.settle() else {
        panic!("a handle settles to itself")
    };
    assert_eq!(settled.as_handle(), Some(&h));
    assert_eq!(v.js_string(), "", "a handle does not stringify");
    assert_eq!(v.to_text().as_ref(), "");
    assert_eq!(
        v.to_json(),
        serde_json::json!({"$handle": "space"}),
        "the normal form prints the kind, never the key"
    );

    // Comparison is the handle's identity, so two wrappings of one handle
    // — `app.spaces[i].handle` read twice — are `==` (the language's `==`
    // is strict; `evaluate.ts` reads it as `===`).
    let env = MapEnv::new()
        .with_root("h1", Value::handle(h.clone()))
        .with_root("h2", Value::handle(h))
        .with_root(
            "other",
            Value::handle(table.mint(HandleKind::Space, "other")),
        );
    let j = |src: &str| eval(&parse(src).unwrap(), &env).to_json();
    assert_eq!(j("h1 == h2"), serde_json::json!(true));
    assert_eq!(j("h1 == other"), serde_json::json!(false));
    // `count(h)` is 0 — there is nothing in it to count.
    assert_eq!(j("count(h1)"), serde_json::json!(0));
}

#[test]
fn a_plain_namespace_is_not_a_handle() {
    let ns = MapNamespace::new([("x".into(), 1.into())].into_iter().collect());
    assert_eq!(ns.as_handle(), None, "the default is no handle");
    let Value::Namespace(inner) = Value::namespace(ns) else {
        unreachable!()
    };
    assert_eq!(inner.as_handle(), None);
}

#[test]
fn mount_context_defaults() {
    // `MountCx::explicit` — `Session::offline` and tests — is Space tier
    // and `Explicit` provenance; `meta.role` is never consulted for it.
    let cx = MountCx::explicit("test");
    assert_eq!(cx.tier, Tier::Space);
    assert_eq!(cx.space, None);
    assert!(matches!(cx.provenance, Provenance::Explicit));
    assert_eq!(cx.mount.as_str(), "test");

    // A caller that says App gets App — the default is the untrusted one.
    let app = MountCx::explicit_app("test");
    assert_eq!(app.tier, Tier::App);
    assert!(Tier::Space < Tier::App, "Space < App");
}
