//! The resolver's contract tests: `$if` branches, `$each` identity, local
//! state across re-resolution, and the revision counters a frame watches.
use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    LocalState, NodeId, ResolvedChild, ResolvedNode, Runtime, SchemaNode, StaticHost, StoreBag,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

/// A bare screen at `/` — the tests that navigate build their own.
fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

/// A runtime over `bag` with a fresh screen, plus its host and locals.
fn rig(node: SchemaNode, bag: StoreBag) -> (Runtime, StaticHost, LocalState, ScreenState) {
    rig_arc(node, Arc::new(bag))
}

/// The same, over a shared bag (tests that mutate it mid-flight).
fn rig_arc(node: SchemaNode, bag: Arc<StoreBag>) -> (Runtime, StaticHost, LocalState, ScreenState) {
    let locals = LocalState::new();
    let runtime = Runtime::new(node, "test", bag.clone(), locals.clone());
    let host = StaticHost::new(bag, locals.clone());
    (runtime, host, locals, screen())
}

/// All resolved node ids, pre-order.
fn ids(node: &ResolvedNode, out: &mut Vec<NodeId>) {
    out.push(node.id.clone());
    for c in &node.children {
        if let ResolvedChild::Node(n) = c {
            ids(n, out);
        }
    }
}

/// The type names in the tree, pre-order.
fn types(node: &ResolvedNode, out: &mut Vec<String>) {
    out.push(node.ty.to_string());
    for c in &node.children {
        if let ResolvedChild::Node(n) = c {
            types(n, out);
        }
    }
}

#[test]
fn if_false_resolves_the_else_branch() {
    // condition false → the `else` node is what resolves; `then` never does.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$if",
            "props": {
                "condition": false,
                "then": { "type": "ThenNode" },
                "else": { "type": "ElseNode" }
            }
        }]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let mut tys = Vec::new();
    types(&root, &mut tys);
    assert!(
        tys.iter().any(|t| t == "ElseNode"),
        "else must resolve: {tys:?}"
    );
    assert!(
        !tys.iter().any(|t| t == "ThenNode"),
        "then must not: {tys:?}"
    );
}

#[test]
fn if_true_resolves_the_then_branch() {
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$if",
            "props": {
                "condition": { "$": "flag" },
                "then": { "type": "ThenNode" },
                "else": { "type": "ElseNode" }
            }
        }]
    }));
    let bag = StoreBag::new();
    bag.set_root("flag", Value::Bool(true));
    let (mut rt, mut host, _locals, screen) = rig(node, bag);
    let root = rt.frame(&mut host, &screen).clone();
    let mut tys = Vec::new();
    types(&root, &mut tys);
    assert!(
        tys.iter().any(|t| t == "ThenNode"),
        "then must resolve: {tys:?}"
    );
    assert!(!tys.iter().any(|t| t == "ElseNode"));
}

#[test]
fn each_over_a_non_list_draws_no_rows() {
    // `items` that is not a list (a string, `undefined`) is an empty For.
    for items in [
        json!("nope"),
        json!({ "x": 1 }),
        json!({ "$": "missing.root" }),
    ] {
        let node = schema(json!({
            "type": "Column",
            "children": [{
                "type": "$each",
                "props": { "items": items, "as": "row" },
                "children": [{ "type": "RowItem" }]
            }]
        }));
        let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
        let root = rt.frame(&mut host, &screen).clone();
        let mut tys = Vec::new();
        types(&root, &mut tys);
        assert!(
            !tys.iter().any(|t| t == "RowItem"),
            "non-list items must draw no rows: {tys:?}"
        );
    }
}

#[test]
fn each_rows_keep_key_based_ids_when_a_row_is_inserted_first() {
    // Rows are `{id}`-keyed: inserting at the front must not rename existing
    // rows. (Sabotage: index-keyed ids fail this — row "a" becomes index 1.)
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "rows" }, "as": "row" },
            "children": [{ "type": "RowItem" }]
        }]
    }));
    let rows = |v: &[&str]| {
        Value::List(Arc::new(
            v.iter()
                .map(|id| {
                    Value::Obj(Arc::new(
                        [("id".into(), Value::from(*id))].into_iter().collect(),
                    ))
                })
                .collect(),
        ))
    };
    let bag = Arc::new(StoreBag::new());
    bag.set_root("rows", rows(&["a", "b"]));
    let (mut rt, mut host, _locals, screen) = rig_arc(node, bag.clone());
    let first = rt.frame(&mut host, &screen).clone();
    let mut first_ids = Vec::new();
    ids(&first, &mut first_ids);
    let a = first_ids
        .iter()
        .find(|i| i.as_str().ends_with("#ks:1:a"))
        .cloned();
    let b = first_ids
        .iter()
        .find(|i| i.as_str().ends_with("#ks:1:b"))
        .cloned();
    let (a, b) = (a.expect("row a must exist"), b.expect("row b must exist"));

    bag.set_root("rows", rows(&["z", "a", "b"]));
    let second = rt.frame(&mut host, &screen).clone();
    let mut second_ids = Vec::new();
    ids(&second, &mut second_ids);
    assert!(second_ids.iter().any(|i| i.as_str().ends_with("#ks:1:z")));
    assert!(
        second_ids.contains(&a),
        "row 'a' must keep its id after the insert: {second_ids:?}"
    );
    assert!(
        second_ids.contains(&b),
        "row 'b' must keep its id after the insert"
    );
}

#[test]
fn unkeyed_primitive_rows_keep_state_when_an_earlier_row_leaves() {
    // A2: `<For>` keys by item, never position. Primitive rows carry their
    // value identity — deleting the first row must not hand the second
    // row's seat (and its locals) a new identity.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "rows" }, "as": "row" },
            "children": [{
                "type": "we-text",
                "$localState": { "note": { "type": "string", "initial": { "$": "row" } } },
                "props": { "text": { "$": "local.note" } }
            }]
        }]
    }));
    let list = |v: &[&str]| Value::List(Arc::new(v.iter().map(|s| Value::from(*s)).collect()));
    let bag = Arc::new(StoreBag::new());
    bag.set_root("rows", list(&["a", "b"]));
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let first = rt.frame(&mut host, &screen).clone();
    let mut first_ids = Vec::new();
    ids(&first, &mut first_ids);
    let b_id = first_ids.last().expect("row b must exist").clone();
    locals.set(&b_id, "note", Value::from("B!"));

    bag.set_root("rows", list(&["b"]));
    let second = rt.frame(&mut host, &screen).clone();
    let mut second_ids = Vec::new();
    ids(&second, &mut second_ids);
    assert_eq!(
        second_ids.len() - 1,
        1,
        "one row must remain: {second_ids:?}"
    );
    assert!(
        second_ids.contains(&b_id),
        "row 'b' must keep its identity after 'a' leaves: {second_ids:?}"
    );
    let text = match second.children.last() {
        Some(ResolvedChild::Node(n)) => n.props["text"].to_text().to_string(),
        _ => panic!("row must be a node"),
    };
    assert_eq!(
        text, "B!",
        "row 'b' must keep its own local, not row 'a''s seat"
    );
}

#[test]
fn unkeyed_object_rows_key_by_reference() {
    // Same for objects without an `id`: two passes over a list holding the
    // same Arc rows — the survivor keeps its state even at a new index.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "rows" }, "as": "row" },
            "children": [{
                "type": "we-text",
                "$localState": { "note": { "type": "string", "initial": { "$": "row.n" } } },
                "props": { "text": { "$": "local.note" } }
            }]
        }]
    }));
    let obj = |n: f64| {
        Value::Obj(Arc::new(
            [("n".into(), Value::Num(n))].into_iter().collect(),
        ))
    };
    let rows_a = vec![obj(1.0), obj(2.0)];
    let survivor = rows_a[1].clone();
    let bag = Arc::new(StoreBag::new());
    bag.set_root("rows", Value::List(Arc::new(rows_a)));
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let first = rt.frame(&mut host, &screen).clone();
    let mut first_ids = Vec::new();
    ids(&first, &mut first_ids);
    let b_id = first_ids.last().expect("row b must exist").clone();
    locals.set(&b_id, "note", Value::from("two"));

    // A fresh list that still holds the same row object.
    bag.set_root("rows", Value::List(Arc::new(vec![survivor])));
    let second = rt.frame(&mut host, &screen).clone();
    let mut second_ids = Vec::new();
    ids(&second, &mut second_ids);
    assert!(
        second_ids.contains(&b_id),
        "the surviving row object must keep its identity: {second_ids:?}"
    );
    let text = match second.children.last() {
        Some(ResolvedChild::Node(n)) => n.props["text"].to_text().to_string(),
        _ => panic!("row must be a node"),
    };
    assert_eq!(text, "two");
}

#[test]
fn duplicate_primitive_rows_get_distinct_identities() {
    // F1: `<For>` maps by item — `["a", "a", "a~1"]` is three mounts, and
    // the occurrence suffix is data of its own, never text that can bleed
    // into a row's value. The old `v:s:` + `~n` encoding gave the second
    // "a" and the literal "a~1" the same NodeId — aliased locals.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "rows" }, "as": "row" },
            "children": [{
                "type": "we-text",
                "$localState": { "note": { "type": "string", "initial": "" } },
                "props": { "text": { "$": "local.note" } }
            }]
        }]
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_root(
        "rows",
        Value::List(Arc::new(
            ["a", "a", "a~1"].iter().map(|s| Value::from(*s)).collect(),
        )),
    );
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag);
    let root = rt.frame(&mut host, &screen).clone();
    let mut all_ids = Vec::new();
    ids(&root, &mut all_ids);
    let rows: Vec<NodeId> = all_ids
        .iter()
        .filter(|i| i.as_str().contains('#'))
        .cloned()
        .collect();
    assert_eq!(rows.len(), 3, "three rows must mount: {all_ids:?}");
    let unique: std::collections::HashSet<&NodeId> = rows.iter().collect();
    assert_eq!(
        unique.len(),
        3,
        "each row's identity must be its own: {all_ids:?}"
    );

    // The aliasing had teeth: a write under one row's id must not be
    // readable under another's.
    locals.set(&rows[1], "note", Value::from("second a"));
    assert!(
        locals.get(&rows[2], "note").strict_eq(&Value::from("")),
        "a write on the second \"a\" must not land on the \"a~1\" row: {:?}",
        locals.get(&rows[2], "note")
    );
}

#[test]
fn mixed_id_types_stay_on_the_keyed_path() {
    // F1: TS `keyable` tests `Set<string|number>` — `{id: 1}` and
    // `{id: "1"}` are DISTINCT ids, so the list stays keyed. The old
    // encoding stringified both to "1", declared a duplicate and fell
    // back to reference keys — a fresh record with the same id remounted
    // instead of keeping the row's mount.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "rows" }, "as": "row" },
            "children": [{ "type": "RowItem" }]
        }]
    }));
    let row = |id: Value| Value::Obj(Arc::new([("id".into(), id)].into_iter().collect()));
    let bag = Arc::new(StoreBag::new());
    bag.set_root(
        "rows",
        Value::List(Arc::new(vec![row(Value::Num(1.0)), row(Value::from("1"))])),
    );
    let (mut rt, mut host, _locals, screen) = rig_arc(node, bag.clone());
    let first = rt.frame(&mut host, &screen).clone();
    let mut first_ids = Vec::new();
    ids(&first, &mut first_ids);

    // Same ids, fresh objects — a keyed list keeps its mounts.
    bag.set_root(
        "rows",
        Value::List(Arc::new(vec![row(Value::Num(1.0)), row(Value::from("1"))])),
    );
    let second = rt.frame(&mut host, &screen).clone();
    let mut second_ids = Vec::new();
    ids(&second, &mut second_ids);
    assert_eq!(
        second_ids, first_ids,
        "fresh records with the same typed ids must keep their mounts"
    );
    assert!(
        !second_ids.iter().any(|i| i.as_str().ends_with("#1")
            && second_ids
                .iter()
                .filter(|j| j.as_str().ends_with("#1"))
                .count()
                > 1),
        "the two ids must not collapse onto one key: {second_ids:?}"
    );
}

#[test]
fn a_keyed_id_cannot_alias_an_item_key() {
    // F1: a keyed `{id: "v:s:a"}` and a primitive `"a"` are different items;
    // TS's keyed and item branches never hand them one mount. Swapping the
    // keyed row for the primitive must produce a different identity — the
    // old encoding mapped both to `v:s:a` and reused the row's local.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "rows" }, "as": "row" },
            "children": [{
                "type": "we-text",
                "$localState": { "note": { "type": "string", "initial": "" } },
                "props": { "text": { "$": "local.note" } }
            }]
        }]
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_root(
        "rows",
        Value::List(Arc::new(vec![Value::Obj(Arc::new(
            [("id".into(), Value::from("v:s:a"))].into_iter().collect(),
        ))])),
    );
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let first = rt.frame(&mut host, &screen).clone();
    let mut first_ids = Vec::new();
    ids(&first, &mut first_ids);
    let keyed_row = first_ids
        .iter()
        .find(|i| i.as_str().contains('#'))
        .expect("the keyed row must mount")
        .clone();
    locals.set(&keyed_row, "note", Value::from("keyed row"));

    bag.set_root("rows", Value::List(Arc::new(vec![Value::from("a")])));
    let second = rt.frame(&mut host, &screen).clone();
    let mut second_ids = Vec::new();
    ids(&second, &mut second_ids);
    let item_row = second_ids
        .iter()
        .find(|i| i.as_str().contains('#'))
        .expect("the primitive row must mount")
        .clone();
    assert_ne!(
        item_row, keyed_row,
        "a primitive row must not inherit a keyed row's identity"
    );
    assert!(
        locals.get(&item_row, "note").strict_eq(&Value::from("")),
        "the primitive row starts at its own initial, not the keyed row's edit"
    );
}

#[test]
fn local_state_survives_re_resolution() {
    // Seed once, write once, re-resolve: the value must still be there — and
    // `seed` must not clobber it on the next pass.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "flag": { "type": "boolean", "initial": false } },
        "children": [{ "type": "RowItem" }]
    }));
    let (mut rt, mut host, locals, screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    assert!(locals.get(&owner, "flag").strict_eq(&Value::Bool(false)));

    locals.set(&owner, "flag", Value::Bool(true));
    let _ = rt.frame(&mut host, &screen).clone(); // re-resolve after the write
    let _ = rt.frame(&mut host, &screen).clone(); // and once more, unchanged
    assert!(locals.get(&owner, "flag").strict_eq(&Value::Bool(true)));
}

#[test]
fn an_expression_initial_follows_its_source() {
    // A4: a token-object `initial` is tracked — when the source moves the
    // field resets to the new value and `touched` clears (SchemaRenderer's
    // tracking effect). An unrelated re-resolve must not clobber an edit.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "name": { "type": "string", "initial": { "$": "store.name" } } },
        "children": [{ "type": "we-text", "props": { "text": { "$": "local.name" } } }]
    }));
    let store = |name: &str| {
        Value::Obj(Arc::new(
            [("name".into(), Value::from(name))].into_iter().collect(),
        ))
    };
    let bag = Arc::new(StoreBag::new());
    bag.set_root("store", store("A"));
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    assert!(locals.get(&owner, "name").strict_eq(&Value::from("A")));

    // An unrelated pass leaves a user edit alone.
    locals.set(&owner, "name", Value::from("edited"));
    locals.touch(&owner, "name");
    let _ = rt.frame(&mut host, &screen).clone();
    assert!(locals.get(&owner, "name").strict_eq(&Value::from("edited")));
    assert!(locals.is_touched(&owner, "name"));

    // The source moving resets the field — even over an edit — and untouches.
    bag.set_root("store", store("B"));
    let _ = rt.frame(&mut host, &screen).clone();
    assert!(
        locals.get(&owner, "name").strict_eq(&Value::from("B")),
        "dynamic initial must follow its source: {:?}",
        locals.get(&owner, "name")
    );
    assert!(!locals.is_touched(&owner, "name"));
}

#[test]
fn a_constant_expression_initial_keeps_edits_across_resolves() {
    // F2: `{"$":"[]"}` allocates a fresh list every pass — comparing
    // identities says the initial "moved" and erases the edit on any
    // unrelated resolve. TS's memo for a constant has no dependencies, so
    // its tracking effect ran once at mount and never again.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "sel": { "type": "array", "initial": { "$": "[]" } } },
        "children": []
    }));
    let (mut rt, mut host, locals, screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    locals.set(&owner, "sel", Value::List(Arc::new(vec![Value::from("x")])));
    locals.touch(&owner, "sel");

    // An unrelated re-resolve — the same frame another field write would
    // produce — must leave the selection alone.
    let _ = rt.frame(&mut host, &screen).clone();
    let held = locals.get(&owner, "sel");
    match &held {
        Value::List(items) => assert_eq!(
            items.len(),
            1,
            "a dependency-free initial must not reset on an unrelated pass"
        ),
        other => panic!("sel must stay a list, got {other:?}"),
    }
    assert!(
        locals.is_touched(&owner, "sel"),
        "an unrelated pass must not clear touched"
    );
}

#[test]
fn a_derived_initial_resets_only_when_its_source_moves() {
    // F2: `{"$":"[store.name]"}` builds a fresh list each pass — but its
    // one input is `store.name`. An unrelated resolve keeps the edit; the
    // source moving resets (the memo's dep check, then `!==`, like TS).
    let node = schema(json!({
        "type": "Column",
        "$localState": { "draft": { "type": "array", "initial": { "$": "[store.name]" } } },
        "children": []
    }));
    let store = |name: &str| {
        Value::Obj(Arc::new(
            [("name".into(), Value::from(name))].into_iter().collect(),
        ))
    };
    let bag = Arc::new(StoreBag::new());
    bag.set_root("store", store("A"));
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    locals.set(
        &owner,
        "draft",
        Value::List(Arc::new(vec![Value::from("me")])),
    );
    locals.touch(&owner, "draft");
    let _ = rt.frame(&mut host, &screen).clone(); // unrelated pass
    match locals.get(&owner, "draft") {
        Value::List(items) => assert_eq!(
            items
                .first()
                .and_then(|v| v.to_json().as_str().map(String::from)),
            Some("me".to_string()),
            "unchanged deps must not reset the field"
        ),
        other => panic!("draft must stay a list: {other:?}"),
    }

    bag.set_root("store", store("B"));
    let _ = rt.frame(&mut host, &screen).clone();
    match locals.get(&owner, "draft") {
        Value::List(items) => assert_eq!(
            items
                .first()
                .and_then(|v| v.to_json().as_str().map(String::from)),
            Some("B".to_string()),
            "a moved dependency resets to the new initial"
        ),
        other => panic!("draft must stay a list: {other:?}"),
    }
    assert!(
        !locals.is_touched(&owner, "draft"),
        "a real reset clears touched"
    );
}

#[test]
fn an_initial_resets_when_a_store_list_is_replaced_equal_content() {
    // R1: `{"$":"store.items"}` — `items` answers a NEW list with identical
    // content. TS's per-key store signal fires on `!==` (identity, not
    // content), the memo emits, the field resets and untouches. The F2
    // content-relaxation must apply only to allocations the resolver
    // rebuilds itself (`$nav`, the surface box) — a store member is a real
    // dependency, and a real dependency moving means reset.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "sel": { "type": "array", "initial": { "$": "store.items" } } },
        "children": []
    }));
    let list = |xs: &[&str]| Value::List(Arc::new(xs.iter().map(|s| Value::from(*s)).collect()));
    let store = |items: Value| {
        Value::from(we_expr::MapNamespace::new(
            [("items".into(), items)].into_iter().collect(),
        ))
    };
    let bag = Arc::new(StoreBag::new());
    bag.set_root("store", store(list(&["a"])));
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    locals.set(&owner, "sel", list(&["typed"]));
    locals.touch(&owner, "sel");
    bag.set_root("store", store(list(&["a"]))); // equal content, new identity
    let _ = rt.frame(&mut host, &screen).clone();
    match locals.get(&owner, "sel") {
        Value::List(items) => assert_eq!(
            items
                .first()
                .and_then(|v| v.to_json().as_str().map(String::from)),
            Some("a".to_string()),
            "an equal-content replacement still resets (identity moved)"
        ),
        other => panic!("sel must stay a list: {other:?}"),
    }
    assert!(
        !locals.is_touched(&owner, "sel"),
        "a real reset clears touched"
    );
}

#[test]
fn an_initial_resets_when_an_enclosing_local_list_is_replaced() {
    // R1, enclosing-local variant: the parent declares `src`, the child's
    // initial reads `local.src`. `locals.set` a new list of equal content —
    // a new signal value identity — the child resets.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "src": { "type": "array", "initial": ["a"] } },
        "children": [{
            "type": "Row",
            "$localState": { "sel": { "type": "array", "initial": { "$": "local.src" } } },
            "children": []
        }]
    }));
    let list = |xs: &[&str]| Value::List(Arc::new(xs.iter().map(|s| Value::from(*s)).collect()));
    let (mut rt, mut host, locals, screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let parent = root.id.clone();
    let child = NodeId::new("test:/Row0");
    match locals.get(&child, "sel") {
        Value::List(items) => assert_eq!(items.len(), 1, "sel seeded from local.src"),
        other => panic!("sel must seed a list: {other:?}"),
    }

    locals.set(&child, "sel", list(&["typed"]));
    locals.touch(&child, "sel");
    locals.set(&parent, "src", list(&["a"])); // equal content, new identity
    let _ = rt.frame(&mut host, &screen).clone();
    match locals.get(&child, "sel") {
        Value::List(items) => assert_eq!(
            items
                .first()
                .and_then(|v| v.to_json().as_str().map(String::from)),
            Some("a".to_string()),
            "an equal-content replacement still resets (identity moved)"
        ),
        other => panic!("sel must stay a list: {other:?}"),
    }
    assert!(
        !locals.is_touched(&child, "sel"),
        "a real reset clears touched"
    );
}

#[test]
fn an_initial_resets_when_a_query_result_is_refilled_equal_content() {
    // R1, query variant: `{"$":"local.q"}` reads the cell's rows. A refill
    // carrying the same rows under a new allocation — what a live
    // subscription's update delivers — still resets.
    struct Rows;
    impl we_template::QuerySource for Rows {
        fn rows(
            &self,
            _key: &we_template::QueryKey,
            _ir: &we_template::QueryIr,
        ) -> we_template::QueryState {
            we_template::QueryState::Rows(Arc::new(vec![Value::from_json(&json!({ "id": "r1" }))]))
        }
    }
    let node = schema(json!({
        "type": "Column",
        "$queries": { "q": { "entity": "E" } },
        "children": [{
            "type": "Row",
            "$localState": { "sel": { "type": "array", "initial": { "$": "local.q" } } },
            "children": []
        }]
    }));
    let locals = LocalState::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(node, "test", bag.clone(), locals.clone())
        .with_sources(Some(Arc::new(Rows)), Arc::new(we_template::NoParts));
    let mut host = StaticHost::new(bag, locals.clone());
    let screen = screen();
    let _ = rt.frame(&mut host, &screen).clone();
    let child = NodeId::new("test:/Row0");
    match locals.get(&child, "sel") {
        Value::List(items) => assert_eq!(items.len(), 1, "sel seeded from local.q"),
        other => panic!("sel must seed a list: {other:?}"),
    }

    locals.set(
        &child,
        "sel",
        Value::List(Arc::new(vec![Value::from_json(&json!({ "id": "mine" }))])),
    );
    locals.touch(&child, "sel");
    // A refill: a fresh rows allocation, identical content.
    let cell = rt.pool().cells().into_iter().next().unwrap();
    cell.fill(we_template::QueryState::Rows(Arc::new(vec![
        Value::from_json(&json!({ "id": "r1" })),
    ])));
    rt.pool().bump();
    let _ = rt.frame(&mut host, &screen).clone();
    match locals.get(&child, "sel") {
        Value::List(items) => assert_eq!(
            items.first().and_then(|v| v
                .to_json()
                .get("id")
                .and_then(|i| i.as_str().map(String::from))),
            Some("r1".to_string()),
            "an equal-content refill still resets (identity moved)"
        ),
        other => panic!("sel must stay a list: {other:?}"),
    }
    assert!(
        !locals.is_touched(&child, "sel"),
        "a real reset clears touched"
    );
}

#[test]
fn an_unread_surface_member_change_keeps_a_derived_initial() {
    // R2: `{"$":"[surface.tier]"}` reads only `tier`. Reporting a new
    // `width` changes the surface box but not the memo's inputs — the
    // store's per-key `tier` signal never fires — so the edit survives.
    // Recording `surface` whole made width a dep: the re-evaluated fresh
    // list then `!==`'d and wiped the edit. `tier` moving still resets.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$surface",
            "children": [{
                "type": "Row",
                "$localState": { "sel": { "type": "array", "initial": { "$": "[surface.tier]" } } },
                "children": []
            }]
        }]
    }));
    let mut screen = screen();
    screen.apply(we_screen::ScreenOp::SetSurface {
        id: "test:/$surface0".into(),
        width: 400.0,
        tier: "base".into(),
    });
    let (mut rt, mut host, locals, _unused) = rig(node, StoreBag::new());
    let _ = rt.frame(&mut host, &screen).clone();
    let row = NodeId::new("test:/$surface0/Row0");
    match locals.get(&row, "sel") {
        Value::List(items) => assert_eq!(
            items
                .first()
                .and_then(|v| v.to_json().as_str().map(String::from)),
            Some("base".to_string()),
            "sel seeds [surface.tier]"
        ),
        other => panic!("sel must seed a list: {other:?}"),
    }

    locals.set(
        &row,
        "sel",
        Value::List(Arc::new(vec![Value::from("mine")])),
    );
    locals.touch(&row, "sel");

    // An unread member moving is no input of this initial — the edit stays.
    screen.apply(we_screen::ScreenOp::SetSurface {
        id: "test:/$surface0".into(),
        width: 401.0,
        tier: "base".into(),
    });
    let _ = rt.frame(&mut host, &screen).clone();
    match locals.get(&row, "sel") {
        Value::List(items) => assert_eq!(
            items
                .first()
                .and_then(|v| v.to_json().as_str().map(String::from)),
            Some("mine".to_string()),
            "a width report must not reset an initial that only reads tier"
        ),
        other => panic!("sel must stay a list: {other:?}"),
    }
    assert!(locals.is_touched(&row, "sel"), "a kept edit stays touched");

    // The read member moving resets — the dep is granular, not absent.
    screen.apply(we_screen::ScreenOp::SetSurface {
        id: "test:/$surface0".into(),
        width: 401.0,
        tier: "md".into(),
    });
    let _ = rt.frame(&mut host, &screen).clone();
    match locals.get(&row, "sel") {
        Value::List(items) => assert_eq!(
            items
                .first()
                .and_then(|v| v.to_json().as_str().map(String::from)),
            Some("md".to_string()),
            "tier moving resets to the new initial"
        ),
        other => panic!("sel must stay a list: {other:?}"),
    }
    assert!(
        !locals.is_touched(&row, "sel"),
        "a real reset clears touched"
    );
}

#[test]
fn an_accessor_initial_tracks_the_result_not_the_function() {
    // R3: `{"$":"store.sig"}` — `sig` is a reactive accessor (the
    // `markReactive` kind `readValue` calls). The member's identity never
    // changes — same callable — but the signal behind it moves A→B. TS's
    // memo subscribed to the read *inside* the accessor, so the initial
    // follows the result. Recording the callable's identity says
    // "unmoved" forever and the edit never resets.
    use std::sync::RwLock;
    let sig = Arc::new(RwLock::new(Value::from("A")));
    let sig_read = sig.clone();
    let store = Value::from(we_expr::MapNamespace::new(
        [(
            "sig".into(),
            Value::Callable(we_expr::CallableRef::accessor("sig", move |_| {
                sig_read.read().unwrap().clone()
            })),
        )]
        .into_iter()
        .collect(),
    ));
    let node = schema(json!({
        "type": "Column",
        "$localState": { "name": { "type": "string", "initial": { "$": "store.sig" } } },
        "children": []
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_root("store", store.clone());
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    assert!(locals.get(&owner, "name").strict_eq(&Value::from("A")));

    locals.set(&owner, "name", Value::from("typed"));
    locals.touch(&owner, "name");
    let _ = rt.frame(&mut host, &screen).clone(); // unrelated pass — kept
    assert!(locals.get(&owner, "name").strict_eq(&Value::from("typed")));
    assert!(locals.is_touched(&owner, "name"));

    // The accessor's result moves; a frame re-resolves (the bag version
    // is what wakes it — the signal itself is opaque to the counters).
    *sig.write().unwrap() = Value::from("B");
    bag.set_root("store", store);
    let _ = rt.frame(&mut host, &screen).clone();
    assert!(
        locals.get(&owner, "name").strict_eq(&Value::from("B")),
        "the initial must follow the accessor's result: {:?}",
        locals.get(&owner, "name")
    );
    assert!(!locals.is_touched(&owner, "name"));
}

#[test]
fn a_host_function_initial_tracks_its_result() {
    // R3, `env.call` variant: `{"$":"compute()"}` — TS's memo subscribed
    // to whatever the function read while it ran inside the memo; the
    // observable contract is that a changed RESULT is a moved input.
    use std::sync::RwLock;
    let sig = Arc::new(RwLock::new(Value::from("A")));
    let sig_read = sig.clone();
    let node = schema(json!({
        "type": "Column",
        "$localState": { "name": { "type": "string", "initial": { "$": "compute()" } } },
        "children": []
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_function(
        "compute",
        Arc::new(move |_| sig_read.read().unwrap().clone()),
    );
    let (mut rt, mut host, locals, screen) = rig_arc(node, bag.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    assert!(locals.get(&owner, "name").strict_eq(&Value::from("A")));

    locals.set(&owner, "name", Value::from("typed"));
    locals.touch(&owner, "name");
    let _ = rt.frame(&mut host, &screen).clone(); // unrelated pass — kept
    assert!(locals.get(&owner, "name").strict_eq(&Value::from("typed")));

    *sig.write().unwrap() = Value::from("B");
    locals.set(&owner, "other", Value::Bool(true)); // bump: wake a frame
    let _ = rt.frame(&mut host, &screen).clone();
    assert!(
        locals.get(&owner, "name").strict_eq(&Value::from("B")),
        "the initial must follow the call's result: {:?}",
        locals.get(&owner, "name")
    );
    assert!(!locals.is_touched(&owner, "name"));
}

#[test]
fn a_dollar_string_initial_stays_literal() {
    // A4 sub-point: `initial: "$store.name"`. TS's `resolveInitial` calls
    // `resolveProp`, which has no `$`-string branch — the dispatcher's final
    // pass-through returns it unchanged (dispatcher.ts: only `{ $: … }`
    // objects are expressions). Literal in TS, literal here.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "name": { "type": "string", "initial": "$store.name" } },
        "children": [{ "type": "we-text", "props": { "text": { "$": "local.name" } } }]
    }));
    let bag = StoreBag::new();
    bag.set_root(
        "store",
        Value::Obj(Arc::new(
            [("name".into(), Value::from("A"))].into_iter().collect(),
        )),
    );
    let (mut rt, mut host, locals, screen) = rig(node, bag);
    let root = rt.frame(&mut host, &screen).clone();
    assert!(locals
        .get(&root.id, "name")
        .strict_eq(&Value::from("$store.name")));
}

#[test]
fn a_local_state_handler_bumps_exactly_one_counter() {
    // `$setLocal` on a declared field: local revision +1, screen and data
    // revisions untouched.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "flag": { "type": "boolean", "initial": false } },
        "props": {
            "onFlip": { "$setLocal": "flag", "value": true }
        },
        "children": []
    }));
    let bag = Arc::new(StoreBag::new());
    let locals = LocalState::new();
    let mut screen = screen();
    let mut rt = Runtime::new(node, "test", bag.clone(), locals.clone());
    let mut host = StaticHost::new(bag, locals.clone());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    // Counters after the frame bound the screen roots into the bag.
    let (bag_rev, screen_rev, local_rev) = (host.bag.version(), screen.version, locals.version());

    rt.dispatch(&mut host, &mut screen, &owner, "onFlip", Value::Null);

    assert_eq!(locals.version(), local_rev + 1, "one write, one bump");
    assert_eq!(host.bag.version(), bag_rev);
    assert_eq!(screen.version, screen_rev);
    assert!(locals.get(&owner, "flag").strict_eq(&Value::Bool(true)));
}

#[test]
fn an_empty_local_state_scope_truncates_touch_all() {
    // F5: TS assigns `context.$localScopeFields` inside
    // `if (node.$localState)` — an explicit `{}` yields `[]`, so a
    // `$touch "$all"` under it marks nothing; an absent key inherits the
    // enclosing scope's fields.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "draft": { "type": "string", "initial": "keep" } },
        "children": [
            { "type": "EmptyScope",
              "$localState": {},
              "props": { "onTap": { "$touch": "$all" } } },
            { "type": "PlainChild",
              "props": { "onTap": { "$touch": "$all" } } }
        ]
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    let mut all_ids = Vec::new();
    let mut all_tys = Vec::new();
    ids(&root, &mut all_ids);
    types(&root, &mut all_tys);
    let id_of = |ty: &str| all_ids[all_tys.iter().position(|t| t == ty).unwrap()].clone();

    // The explicit-empty scope owns no fields — `$all` marks nothing.
    rt.dispatch(
        &mut host,
        &mut screen,
        &id_of("EmptyScope"),
        "onTap",
        Value::Null,
    );
    assert!(
        !locals.is_touched(&owner, "draft"),
        "an explicit-empty $localState truncates the scope — draft must stay untouched"
    );

    // The sibling without the key inherits the Column's scope — `$all`
    // marks its `draft`.
    rt.dispatch(
        &mut host,
        &mut screen,
        &id_of("PlainChild"),
        "onTap",
        Value::Null,
    );
    assert!(
        locals.is_touched(&owner, "draft"),
        "absent $localState inherits — $all marks the parent's fields"
    );
}

#[test]
fn a_second_frame_without_input_does_not_resolve_again() {
    // The cache is the contract: same revisions → same tree object.
    let node = schema(json!({
        "type": "Column",
        "children": [{ "type": "RowItem" }]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let first = rt.frame(&mut host, &screen).clone();
    assert_eq!(rt.stats().resolves, 1);
    let second = rt.frame(&mut host, &screen).clone();
    assert_eq!(rt.stats().resolves, 1, "no input, no resolve");
    assert!(Arc::ptr_eq(&first, &second));
}

#[test]
fn unsupported_ops_become_todo_placeholders() {
    // An op this stage does not know: a labelled node, children resolved.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$frobnicator",
            "children": [{ "type": "Inner" }]
        }]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let mut tys = Vec::new();
    types(&root, &mut tys);
    assert!(tys.iter().any(|t| t == "$todo:$frobnicator"), "{tys:?}");
    assert!(tys.iter().any(|t| t == "Inner"));
}

#[test]
fn declarations_on_structure_nodes_still_bind_local() {
    // A1: `RenderSchema` declares `$localState`/`$queries` before it
    // interprets structure — a fragment (no `type`), an `$each`, an `$if`
    // that declares still hands its subtree a `local`. The node flattens
    // into its parent but owns its fields' scope and lifetime.
    let node = schema(json!({
        "type": "Column",
        "children": [
            {
                "$localState": { "frag": { "type": "string", "initial": "f" } },
                "children": [
                    { "type": "we-text", "props": { "text": { "$": "local.frag" } } }
                ]
            },
            {
                "type": "$each",
                "$localState": { "shared": { "type": "string", "initial": "s" } },
                "props": { "items": [1, 2], "as": "row" },
                "children": [
                    { "type": "we-text", "props": { "text": { "$": "local.shared" } } }
                ]
            },
            {
                "type": "$if",
                "$localState": { "cond": { "type": "string", "initial": "c" } },
                "props": {
                    "condition": true,
                    "then": { "type": "we-text", "props": { "text": { "$": "local.cond" } } }
                }
            }
        ]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let mut texts = Vec::new();
    collect_texts(&root, &mut texts);
    assert_eq!(
        texts,
        vec!["f", "s", "s", "c"],
        "every declaring node's local must bind: {texts:?}"
    );
}

fn collect_texts(node: &ResolvedNode, out: &mut Vec<String>) {
    if node.ty.as_ref() == "we-text" {
        out.push(node.props["text"].to_text().to_string());
    }
    for c in &node.children {
        if let ResolvedChild::Node(n) = c {
            collect_texts(n, out);
        }
    }
}

#[test]
fn a_callback_prop_resolves_as_a_handler() {
    // `we-modal`'s `close` is a callback prop, not an `on*` prop — the Solid
    // dispatcher resolves handler tokens in any prop position into callables.
    // The resolver must capture it so `dispatch(node, "close")` runs it.
    let node = schema(json!({
        "type": "we-modal",
        "$localState": { "closed": { "type": "boolean", "initial": false } },
        "props": {
            "open": true,
            "close": { "$setLocal": "closed", "value": true }
        },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        root.handlers.contains_key("close"),
        "close must be a captured handler, not a prop: {:?}",
        root.handlers.keys().collect::<Vec<_>>()
    );
    rt.dispatch(&mut host, &mut screen, &root.id, "close", Value::Null);
    assert!(locals.get(&root.id, "closed").strict_eq(&Value::Bool(true)));
}

#[test]
fn an_expression_prop_is_not_a_callback() {
    // `{"$": …}` is a value prop, not a handler — it must still evaluate.
    let node = schema(json!({
        "type": "we-input",
        "props": { "value": { "$": "greeting" } },
        "children": []
    }));
    let bag = StoreBag::new();
    bag.set_root("greeting", Value::from("hi"));
    let (mut rt, mut host, _locals, screen) = rig(node, bag);
    let root = rt.frame(&mut host, &screen).clone();
    assert_eq!(root.props["value"].to_text().as_ref(), "hi");
    assert!(root.handlers.is_empty());
}

#[test]
fn handler_bubbles_to_an_ancestor() {
    // onSelect lives on the parent; the child's event bubbles up to it —
    // the we-tree pattern.
    let node = schema(json!({
        "type": "we-tree",
        "$localState": { "sel": { "type": "string", "initial": "" } },
        "props": {
            "onSelect": { "$setLocal": "sel", "value": { "$": "event.detail.value" } }
        },
        "children": [{ "type": "we-tree-item" }]
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new());
    let root = rt.frame(&mut host, &screen).clone();
    let child = match root.children.first() {
        Some(ResolvedChild::Node(n)) => n.id.clone(),
        _ => panic!("child must exist"),
    };
    let mut detail = indexmap::IndexMap::new();
    detail.insert(
        "detail".into(),
        Value::Obj(Arc::new(
            [("value".into(), Value::from("group|dna"))]
                .into_iter()
                .collect(),
        )),
    );
    rt.dispatch(
        &mut host,
        &mut screen,
        &child,
        "onSelect",
        Value::Obj(Arc::new(detail)),
    );
    assert!(locals
        .get(&root.id, "sel")
        .strict_eq(&Value::from("group|dna")));
}
