//! Handler semantics: `$invoke` pending → `Runtime::complete` lifecycle,
//! screen-op translation, `$localState` URL/persist mirrors, `$touch` /
//! `$resetLocal`.

use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    CallId, LocalState, NodeId, ResolvedNode, Runtime, SchemaNode, StaticHost, StoreBag,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
}

/// A single-node runtime over `bag`; the root carries every handler.
fn rig(
    node: SchemaNode,
    bag: StoreBag,
    href: &str,
) -> (Runtime, StaticHost, LocalState, ScreenState) {
    let locals = LocalState::new();
    let bag = Arc::new(bag);
    let runtime = Runtime::new(node, "test", bag.clone(), locals.clone());
    let host = StaticHost::new(bag);
    (runtime, host, locals, screen(href))
}

fn snapshot_bag(invokes: serde_json::Value) -> StoreBag {
    StoreBag::from_snapshot(&json!({"stores": {}, "queries": {}, "invokes": invokes})).unwrap()
}

fn root_id(root: &ResolvedNode) -> NodeId {
    root.id.clone()
}

#[test]
fn reset_local_removes_the_persisted_key_and_url_param() {
    // B9: `meta.reset()` sets the initial, removes `localStorage[persistKey]`
    // and clears the URL param — it does NOT write the initial through the
    // setter mirror. A removed key lets the next mount fall to the new
    // declared initial instead of restoring the stale persisted one.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "shade": { "type": "string", "initial": "light",
                       "persist": "shade", "syncParam": "shade" }
        },
        "props": {
            "onEdit": { "$setLocal": "shade", "value": "dark" },
            "onReset": { "$resetLocal": "$scope" }
        }
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root_id(&root);

    rt.dispatch(&mut host, &mut screen, &owner, "onEdit", Value::Null);
    assert!(screen.prefs.get("we-local:shade").is_some());
    assert_eq!(screen.nav.param("shade"), Some("dark"));

    rt.dispatch(&mut host, &mut screen, &owner, "onReset", Value::Null);
    assert!(
        locals.get(&owner, "shade").strict_eq(&Value::from("light")),
        "reset restores the declared initial"
    );
    assert!(
        screen.prefs.get("we-local:shade").is_none(),
        "reset REMOVES the persisted key, it does not persist the initial"
    );
    assert_eq!(
        screen.nav.param("shade"),
        None,
        "reset clears the URL param (routeParams.set(name, null))"
    );
}

#[test]
fn reset_local_through_a_query_only_node_hits_the_state_scope() {
    // B9: `$localScopeFields` changes only at a `$localState` node — a
    // `$queries`-only node must not shrink the reset to zero fields.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "name": { "type": "string", "initial": "A" } },
        "props": { "onEdit": { "$setLocal": "name", "value": "edited" } },
        "children": [{
            "type": "Row",
            "$queries": { "q": { "entity": "E" } },
            "children": [{ "type": "Box",
                "props": { "onReset": { "$resetLocal": "$scope" } } }]
        }]
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root_id(&root);
    let deep = {
        fn find<'a>(n: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
            if n.ty.as_ref() == ty {
                return Some(n);
            }
            n.children.iter().find_map(|c| match c {
                we_template::ResolvedChild::Node(m) => find(m, ty),
                _ => None,
            })
        }
        find(&root, "Box").unwrap().id.clone()
    };

    rt.dispatch(&mut host, &mut screen, &owner, "onEdit", Value::Null);
    assert!(locals.get(&owner, "name").strict_eq(&Value::from("edited")));

    rt.dispatch(&mut host, &mut screen, &deep, "onReset", Value::Null);
    assert!(
        locals.get(&owner, "name").strict_eq(&Value::from("A")),
        "reset through a query-only scope still reaches the enclosing $localState fields; got {:?}",
        locals.get(&owner, "name")
    );
}

#[test]
fn a_screen_write_is_visible_to_later_tokens_in_the_chain() {
    // B8: `routeStore.setParam` mutates ScreenState; the next token's
    // `routeStore.params.x` read must see it — TS store accessors see the
    // synchronous navigation-state update in the next action.
    let node = schema(json!({
        "type": "Column",
        "$localState": { "seen": { "type": "string", "initial": "" } },
        "props": { "onTap": [
            { "$invoke": "routeStore.setParam", "args": ["x", "new"] },
            { "$setLocal": "seen", "value": { "$": "routeStore.params.x" } }
        ] }
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root_id(&root);
    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    assert!(
        locals.get(&owner, "seen").strict_eq(&Value::from("new")),
        "the second token must read the param the first just wrote; got {:?}",
        locals.get(&owner, "seen")
    );
}

#[test]
fn invoke_done_never_runs_lifecycle_callbacks() {
    // WE's invoke.ts: `result instanceof Promise` gates the callbacks — a
    // synchronous answer fires none of them.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "got": { "type": "string", "initial": "" },
            "fin": { "type": "string", "initial": "" }
        },
        "props": { "onTap": { "$invoke": "storeX.call", "args": [],
            "onSuccess": [{ "$setLocal": "got", "value": { "$": "result" } }],
            "onFinally": [{ "$setLocal": "fin", "value": "done" }] } },
        "children": [{ "type": "Row" }]
    }));
    let bag = snapshot_bag(json!({"storeX.call": {"ok": true}}));
    let (mut rt, mut host, locals, mut screen) = rig(node, bag, "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root_id(&root);

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);

    assert!(
        locals.get(&owner, "got").strict_eq(&Value::Str("".into())),
        "sync invoke must not fire onSuccess"
    );
    assert!(
        locals.get(&owner, "fin").strict_eq(&Value::Str("".into())),
        "sync invoke must not fire onFinally"
    );
}

#[test]
fn invoke_pending_then_ok_runs_success_and_finally() {
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "got": { "type": "string", "initial": "" },
            "fin": { "type": "string", "initial": "" },
            "err": { "type": "string", "initial": "" }
        },
        "props": { "onTap": { "$invoke": "storeX.call", "args": [],
            "onSuccess": [{ "$setLocal": "got", "value": { "$": "result" } }],
            "onError": [{ "$setLocal": "err", "value": { "$": "result" } }],
            "onFinally": [{ "$setLocal": "fin", "value": "done" }] } },
        "children": [{ "type": "Row" }]
    }));
    let bag = snapshot_bag(json!({"storeX.call": {"$pending": true}}));
    let (mut rt, mut host, locals, mut screen) = rig(node, bag, "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root_id(&root);

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    rt.complete(
        &mut host,
        &mut screen,
        CallId(0),
        Ok(Value::Str("v".into())),
    );

    assert!(locals.get(&owner, "got").strict_eq(&Value::Str("v".into())));
    assert!(
        locals.get(&owner, "err").strict_eq(&Value::Str("".into())),
        "onError must not run on success"
    );
    assert!(locals
        .get(&owner, "fin")
        .strict_eq(&Value::Str("done".into())));
}

#[test]
fn invoke_pending_then_err_runs_error_and_finally() {
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "got": { "type": "string", "initial": "" },
            "fin": { "type": "string", "initial": "" },
            "err": { "type": "string", "initial": "" }
        },
        "props": { "onTap": { "$invoke": "storeX.call", "args": [],
            "onSuccess": [{ "$setLocal": "got", "value": { "$": "result" } }],
            "onError": [{ "$setLocal": "err", "value": { "$": "result" } }],
            "onFinally": [{ "$setLocal": "fin", "value": "done" }] } },
        "children": [{ "type": "Row" }]
    }));
    let bag = snapshot_bag(json!({"storeX.call": {"$pending": true}}));
    let (mut rt, mut host, locals, mut screen) = rig(node, bag, "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root_id(&root);

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    rt.complete(
        &mut host,
        &mut screen,
        CallId(0),
        Err(Value::Str("boom".into())),
    );

    assert!(locals
        .get(&owner, "err")
        .strict_eq(&Value::Str("boom".into())));
    assert!(
        locals.get(&owner, "got").strict_eq(&Value::Str("".into())),
        "onSuccess must not run on error"
    );
    assert!(locals
        .get(&owner, "fin")
        .strict_eq(&Value::Str("done".into())));
}

#[test]
fn completing_an_unknown_call_is_a_noop() {
    let node = schema(json!({ "type": "Column", "children": [] }));
    let (mut rt, mut host, _locals, mut screen) = rig(node, StoreBag::new(), "/");
    rt.frame(&mut host, &screen);
    rt.complete(&mut host, &mut screen, CallId(99), Ok(Value::Null)); // no panic
}

#[test]
fn invoke_routestore_setparam_updates_the_url() {
    let node = schema(json!({
        "type": "Column",
        "props": { "onTap": { "$invoke": "routeStore.setParam",
            "args": ["dna", "all"] } },
        "children": []
    }));
    let (mut rt, mut host, _locals, mut screen) = rig(node, StoreBag::new(), "/space/demo");
    let root = rt.frame(&mut host, &screen).clone();

    rt.dispatch(&mut host, &mut screen, &root.id, "onTap", Value::Null);

    assert_eq!(
        screen.nav.param("dna"),
        Some("all"),
        "routeStore.setParam must land in the URL — got {:?}",
        screen.nav.location().href()
    );
}

#[test]
fn setlocal_syncparam_writes_the_url_param() {
    // The `spine` field mirrors to `?spine=`; a local write is a navigation
    // (`localWriteMirror` → `routeStore.setParam`).
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "spine": { "type": "string", "initial": "", "syncParam": "spine" }
        },
        "props": { "onTap": { "$setLocal": "spine", "value": "bio" } },
        "children": []
    }));
    let (mut rt, mut host, _locals, mut screen) = rig(node, StoreBag::new(), "/space/demo");
    let root = rt.frame(&mut host, &screen).clone();

    rt.dispatch(&mut host, &mut screen, &root.id, "onTap", Value::Null);

    assert_eq!(screen.nav.param("spine"), Some("bio"), "syncParam mirror");
}

#[test]
fn setlocal_persist_writes_device_prefs() {
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "vol": { "type": "string", "initial": "", "persist": "playerVol" }
        },
        "props": { "onTap": { "$setLocal": "vol", "value": "loud" } },
        "children": []
    }));
    let (mut rt, mut host, _locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();

    rt.dispatch(&mut host, &mut screen, &root.id, "onTap", Value::Null);

    assert_eq!(
        screen.prefs.get("we-local:playerVol"),
        Some(json!("loud")),
        "persist mirror must land under we-local:*"
    );
}

#[test]
fn syncparam_seeds_from_the_url() {
    // URL > persisted > declared initial (`resolveLocalInitial`).
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "spine": { "type": "string", "initial": "none", "syncParam": "spine" }
        },
        "children": []
    }));
    let (mut rt, mut host, locals, screen) = rig(node, StoreBag::new(), "/space/demo?spine=bio");
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        locals
            .get(&root.id, "spine")
            .strict_eq(&Value::Str("bio".into())),
        "URL seed expected; got {:?}",
        locals.get(&root.id, "spine")
    );
}

#[test]
fn persist_seeds_from_device_prefs() {
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "vol": { "type": "string", "initial": "quiet", "persist": "playerVol" }
        },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    screen.prefs.set("we-local:playerVol", Some(&json!("loud")));
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        locals
            .get(&root.id, "vol")
            .strict_eq(&Value::Str("loud".into())),
        "persisted seed expected; got {:?}",
        locals.get(&root.id, "vol")
    );
}

#[test]
fn touch_marks_and_reset_local_restores() {
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "name": { "type": "string", "initial": "init" },
            "flag": { "type": "boolean", "initial": false }
        },
        "props": {
            "onTouch": { "$touch": "name" },
            "onReset": { "$resetLocal": "$scope" },
            "onEdit": [
                { "$setLocal": "name", "value": "edited" },
                { "$setLocal": "flag", "value": true }
            ]
        },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root_id(&root);

    assert!(!locals.is_touched(&owner, "name"));
    rt.dispatch(&mut host, &mut screen, &owner, "onTouch", Value::Null);
    assert!(
        locals.is_touched(&owner, "name"),
        "$touch must mark the field"
    );

    rt.dispatch(&mut host, &mut screen, &owner, "onEdit", Value::Null);
    assert!(locals
        .get(&owner, "name")
        .strict_eq(&Value::Str("edited".into())));
    assert!(locals.get(&owner, "flag").strict_eq(&Value::Bool(true)));

    rt.dispatch(&mut host, &mut screen, &owner, "onReset", Value::Null);
    assert!(
        locals
            .get(&owner, "name")
            .strict_eq(&Value::Str("init".into())),
        "$resetLocal must restore declared initials; got {:?}",
        locals.get(&owner, "name")
    );
    assert!(locals.get(&owner, "flag").strict_eq(&Value::Bool(false)));
    assert!(
        !locals.is_touched(&owner, "name"),
        "$resetLocal clears touched state (validation reset)"
    );
}
