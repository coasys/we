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
        .find(|i| i.as_str().ends_with("#a"))
        .cloned();
    let b = first_ids
        .iter()
        .find(|i| i.as_str().ends_with("#b"))
        .cloned();
    let (a, b) = (a.expect("row a must exist"), b.expect("row b must exist"));

    bag.set_root("rows", rows(&["z", "a", "b"]));
    let second = rt.frame(&mut host, &screen).clone();
    let mut second_ids = Vec::new();
    ids(&second, &mut second_ids);
    assert!(second_ids.iter().any(|i| i.as_str().ends_with("#z")));
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
