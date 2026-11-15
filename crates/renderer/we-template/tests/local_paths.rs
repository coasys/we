//! E3c-11 §7.1: nested writes — `$setLocal "draft.title"` and the same
//! paths for `$toggleLocal`, `$toggleLocalIn` and `merge`. An exact
//! declared field wins; otherwise the name splits at the first `.`, the
//! head must be a declared field, and the tail is a copy-on-write path
//! into its value. The head field is the unit for revision, validation,
//! touch, `persist`/`syncParam`.
use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    Action, ActionRequest, Completer, Host, Invoked, LocalState, NodeId, ResolvedNode, Runtime,
    SchemaNode, StaticHost, StoreBag,
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

/// `field` under `node` as an object member chain — `get("a.b", &v)` reads
/// `v["a"]["b"]`, `Undefined` wherever the walk stops.
fn get(path: &str, v: &Value) -> Value {
    let mut at = v.clone();
    for seg in path.split('.') {
        at = match &at {
            Value::Obj(o) => o.get(seg).cloned().unwrap_or(Value::Undefined),
            Value::List(l) => match seg.parse::<usize>() {
                Ok(i) => l.get(i).cloned().unwrap_or(Value::Undefined),
                Err(_) => return Value::Undefined,
            },
            _ => return Value::Undefined,
        };
    }
    at
}

/// The resolved node of type `ty` (first, in walk order).
fn find<'a>(n: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if n.ty.as_ref() == ty {
        return Some(n);
    }
    n.children.iter().find_map(|c| match c {
        we_template::ResolvedChild::Node(m) => find(m, ty),
        _ => None,
    })
}

#[test]
fn nested_write_keeps_sibling() {
    // Copy-on-write at the path: `draft.title` replaces `title` only;
    // `body` keeps its value AND its identity (the sibling's Arc survives —
    // a whole-head overwrite would lose it).
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object",
                "initial": { "title": "old", "body": { "text": "keep" } } }
        },
        "props": { "onTap": { "$setLocal": "draft.title", "value": "new" } },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    let body_before = get("body", &locals.get(&owner, "draft"));

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);

    let draft = locals.get(&owner, "draft");
    assert!(
        get("title", &draft).strict_eq(&Value::from("new")),
        "draft.title took the write: {draft:?}"
    );
    let body_after = get("body", &draft);
    assert!(
        body_after.strict_eq(&body_before),
        "sibling `body` must keep its identity — copy-on-write, not a rebuild: \
         before {body_before:?}, after {body_after:?}"
    );
}

#[test]
fn nested_write_bumps_owner_revision() {
    // The head field is the revision unit: a nested write moves
    // `LocalState`'s version, so the next frame re-resolves and a prop
    // bound at the path sees it.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "title": "old" } }
        },
        "props": {
            "onTap": { "$setLocal": "draft.title", "value": "new" },
            "seen": { "$": "local.draft.title" }
        },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    assert!(
        root.props
            .get("seen")
            .is_some_and(|v| v.strict_eq(&Value::from("old"))),
        "the prop seeded from the path: {:?}",
        root.props.get("seen")
    );
    let v0 = locals.version();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    assert!(
        locals.version() > v0,
        "a nested write must bump the owner field's revision"
    );

    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        root.props
            .get("seen")
            .is_some_and(|v| v.strict_eq(&Value::from("new"))),
        "the frame after the write re-resolved and sees it: {:?}",
        root.props.get("seen")
    );
}

#[test]
fn next_token_sees_nested_write() {
    // A local write is synchronous: the next token in the chain reads it.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "title": "old" } },
            "seen": { "type": "string", "initial": "" }
        },
        "props": { "onTap": [
            { "$setLocal": "draft.title", "value": "new" },
            { "$setLocal": "seen", "value": { "$": "local.draft.title" } }
        ] },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    assert!(
        locals.get(&owner, "seen").strict_eq(&Value::from("new")),
        "the second token must read the write the first just made; got {:?}",
        locals.get(&owner, "seen")
    );
}

#[test]
fn missing_intermediate_created() {
    // `draft.contact` does not exist: the intermediate is created as an
    // object and the write lands inside it.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": {} }
        },
        "props": { "onTap": { "$setLocal": "draft.contact.email", "value": "a@b" } },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert!(
        get("contact.email", &draft).strict_eq(&Value::from("a@b")),
        "missing intermediates are created as objects: {draft:?}"
    );
}

#[test]
fn list_index_write_and_append() {
    // A digit segment indexes a list: `tags.1` replaces, `tags.2` appends
    // at `len`, `tags.5` (beyond `len`) warns and writes nothing.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "tags": ["a", "b"] } }
        },
        "props": {
            "onReplace": { "$setLocal": "draft.tags.1", "value": "B" },
            "onAppend": { "$setLocal": "draft.tags.2", "value": "c" },
            "onEdge": { "$setLocal": "draft.tags.4", "value": "y" },
            "onBeyond": { "$setLocal": "draft.tags.5", "value": "x" }
        },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onReplace", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert!(
        get("tags.1", &draft).strict_eq(&Value::from("B")),
        "index 1 replaced: {draft:?}"
    );
    assert!(get("tags.0", &draft).strict_eq(&Value::from("a")));

    rt.dispatch(&mut host, &mut screen, &owner, "onAppend", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert!(
        get("tags.2", &draft).strict_eq(&Value::from("c")),
        "index == len appends: {draft:?}"
    );

    // One past `len` is the first index that is out of bounds.
    rt.dispatch(&mut host, &mut screen, &owner, "onEdge", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert!(
        get("tags.4", &draft).is_undefined(),
        "index len + 1 warns and writes nothing: {draft:?}"
    );

    rt.dispatch(&mut host, &mut screen, &owner, "onBeyond", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert!(
        get("tags.5", &draft).is_undefined(),
        "an index past len warns and writes nothing: {draft:?}"
    );
    let Value::List(tags) = get("tags", &draft) else {
        panic!("tags stays a list: {draft:?}")
    };
    assert_eq!(tags.len(), 3, "still three elements");
    assert!(
        !rt.stats().warnings.is_empty(),
        "the out-of-bounds write left a warning"
    );
}

#[test]
fn non_object_intermediate_warns() {
    // `draft.name` is a string: `draft.name.x` crosses a non-container —
    // a warning, and no write.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "name": "s", "n": 3 } }
        },
        "props": {
            "onStr": { "$setLocal": "draft.name.x", "value": "v" },
            "onNum": { "$setLocal": "draft.n.x", "value": "v" }
        },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    let before = locals.get(&owner, "draft").to_json();

    rt.dispatch(&mut host, &mut screen, &owner, "onStr", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert_eq!(
        draft.to_json(),
        before,
        "a non-container midway means no write: {draft:?}"
    );
    assert!(
        !rt.stats().warnings.is_empty(),
        "the crossing left a warning"
    );

    rt.dispatch(&mut host, &mut screen, &owner, "onNum", Value::Null);
    assert_eq!(
        locals.get(&owner, "draft").to_json(),
        before,
        "a number midway warns the same"
    );
}

#[test]
fn exact_dotted_field_wins() {
    // A field literally named `draft.title` beats the path reading:
    // `$setLocal "draft.title"` writes that field and `draft` is untouched.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "title": "nested" } },
            "draft.title": { "type": "string", "initial": "flat" }
        },
        "props": { "onTap": { "$setLocal": "draft.title", "value": "w" } },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    assert!(
        locals
            .get(&owner, "draft.title")
            .strict_eq(&Value::from("w")),
        "the exact dotted field took the write; got {:?}",
        locals.get(&owner, "draft.title")
    );
    let draft = locals.get(&owner, "draft");
    assert!(
        get("title", &draft).strict_eq(&Value::from("nested")),
        "`draft` itself was not path-written: {draft:?}"
    );
}

#[test]
fn empty_inner_scope_does_not_block_named_enclosing_draft() {
    // F5 kept: an explicit-empty `$localState` truncates `$fields` but does
    // not block a named lookup — the inner node's `draft.title` write
    // reaches the enclosing scope's `draft`.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "title": "outer" } }
        },
        "children": [{
            "type": "Row",
            "$localState": {},
            "props": { "onTap": { "$setLocal": "draft.title", "value": "inner" } },
            "children": []
        }]
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let outer = root.id.clone();
    let inner = find(&root, "Row")
        .expect("the inner Row mounted")
        .id
        .clone();

    rt.dispatch(&mut host, &mut screen, &inner, "onTap", Value::Null);
    let draft = locals.get(&outer, "draft");
    assert!(
        get("title", &draft).strict_eq(&Value::from("inner")),
        "the empty inner scope did not block the enclosing `draft`: {draft:?}"
    );
}

#[test]
fn nested_write_persists_whole_value() {
    // The head is the mirror's unit too: a write at `draft.title` persists
    // the whole `draft` object under `we-local:draft`, and the `syncParam`
    // text is the whole object's JSON.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object",
                "initial": { "title": "a", "body": "b" },
                "persist": "draft", "syncParam": "d" }
        },
        "props": { "onTap": { "$setLocal": "draft.title", "value": "n" } },
        "children": []
    }));
    let (mut rt, mut host, _locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    assert_eq!(
        screen.prefs.get("we-local:draft"),
        Some(json!({ "title": "n", "body": "b" })),
        "the persist mirror stores the whole head value"
    );
    assert_eq!(
        screen.nav.param("d"),
        Some("{\"title\":\"n\",\"body\":\"b\"}"),
        "the URL param carries the whole head value"
    );
}

#[test]
fn nested_toggle_local_path() {
    // `$toggleLocal` takes the same paths: `draft.flag` flips, siblings stay.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "flag": false, "keep": 1 } }
        },
        "props": { "onTap": { "$toggleLocal": "draft.flag" } },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert!(
        get("flag", &draft).strict_eq(&Value::Bool(true)),
        "draft.flag toggled: {draft:?}"
    );
    assert!(get("keep", &draft).strict_eq(&Value::from(1)));

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    assert!(
        get("flag", &locals.get(&owner, "draft")).strict_eq(&Value::Bool(false)),
        "and toggles back"
    );
}

#[test]
fn nested_toggle_local_in_path() {
    // `$toggleLocalIn` at a path: `draft.tags` gains and loses `member`.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object", "initial": { "tags": ["a"] } }
        },
        "props": { "onTap": { "$toggleLocalIn": "draft.tags", "value": "b" } },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    let draft = locals.get(&owner, "draft");
    let Value::List(tags) = get("tags", &draft) else {
        panic!("tags stays a list: {draft:?}")
    };
    assert!(
        tags.len() == 2 && tags[1].strict_eq(&Value::from("b")),
        "b joined draft.tags: {draft:?}"
    );

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    let draft = locals.get(&owner, "draft");
    let Value::List(tags) = get("tags", &draft) else {
        panic!("tags stays a list: {draft:?}")
    };
    assert!(
        tags.len() == 1 && tags[0].strict_eq(&Value::from("a")),
        "b left draft.tags: {draft:?}"
    );
}

#[test]
fn nested_merge_path() {
    // `merge:` at a path merges into the object AT the path — sibling keys
    // of `draft.contact` and of `draft` itself are kept.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "draft": { "type": "object",
                "initial": { "contact": { "name": "a" }, "other": 1 } }
        },
        "props": { "onTap": { "$setLocal": "draft.contact",
            "merge": { "email": "e" } } },
        "children": []
    }));
    let (mut rt, mut host, locals, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    let draft = locals.get(&owner, "draft");
    assert!(
        get("contact.name", &draft).strict_eq(&Value::from("a"))
            && get("contact.email", &draft).strict_eq(&Value::from("e")),
        "merge into draft.contact kept its keys: {draft:?}"
    );
    assert!(
        get("other", &draft).strict_eq(&Value::from(1)),
        "and the head's other key survived: {draft:?}"
    );
}

// ---------------------------------------------------------------- §7.2

/// The host the 7.2 chain test needs: it records the args every invoke
/// arrives with, and answers `Done` — the legacy sync answer.
#[derive(Default)]
struct RecHost {
    calls: Vec<(Arc<str>, Vec<Value>)>,
}

impl Host for RecHost {
    fn act(&mut self, request: ActionRequest, _done: Completer) -> Invoked {
        let Action::Invoke { target, args } = request.action;
        self.calls.push((target, args));
        Invoked::Done(Ok(Value::Null))
    }
}

#[test]
fn reset_reevaluates_the_raw_initial_at_call_time() {
    // §7.2: `meta.reset()` calls `resolveInitial(rawInitial)` — the initial
    // is evaluated when reset fires, in the scope it first evaluated in,
    // against the CURRENT bag and screen. The chain: `setParam` moves the
    // source, `$resetLocal` re-reads it, the `$invoke` that follows must
    // carry the NEW initial to the host — not the value the last resolve
    // recorded.
    let node = schema(json!({
        "type": "Column",
        "$localState": {
            "f": { "type": "string", "initial": { "$": "routeStore.params.x" } }
        },
        "props": { "onTap": [
            { "$invoke": "routeStore.setParam", "args": ["x", "new"] },
            { "$resetLocal": "$scope" },
            { "$invoke": "rec.send", "args": [{ "$": "local.f" }] }
        ] },
        "children": []
    }));
    let locals = LocalState::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(node, "test", bag, locals.clone());
    let mut host = RecHost::default();
    let mut screen = screen("/space/demo");
    let root = rt.frame(&mut host, &screen).clone();
    let owner = root.id.clone();
    assert!(
        locals.get(&owner, "f").is_undefined(),
        "no param at mount — the field seeded Undefined"
    );

    rt.dispatch(&mut host, &mut screen, &owner, "onTap", Value::Null);
    assert_eq!(host.calls.len(), 1, "the send reached the host");
    assert!(
        host.calls[0].1[0].strict_eq(&Value::from("new")),
        "the host must get the NEW initial — reset evaluated the raw initial \
         against the current screen; got {:?}",
        host.calls[0].1[0]
    );
    assert!(
        locals.get(&owner, "f").strict_eq(&Value::from("new")),
        "and the field itself holds it; got {:?}",
        locals.get(&owner, "f")
    );
}

#[test]
fn reset_evaluates_initial_in_the_declaring_scope() {
    // §7.2's second half: the initial is re-evaluated in the scope it was
    // declared in — the declaring node's parent scope — not the handler's.
    // An `$each` row's `f` reads `item.name`; a reset fired under an inner
    // `$each` (whose `item` shadows) must still reset to the DECLARING
    // row's name.
    let node = schema(json!({
        "type": "$each",
        "props": { "items": [["A"], ["B"]], "as": "item" },
        "children": [{
            "type": "Row",
            "$localState": {
                "f": { "type": "string", "initial": { "$": "item[0]" } },
                "marker": { "type": "string", "initial": "" }
            },
            "props": { "onEdit": { "$setLocal": "f", "value": "edit" } },
            "children": [{
                "type": "$each",
                "props": { "items": ["x"], "as": "item" },
                "children": [{
                    "type": "Box",
                    "props": { "onReset": { "$resetLocal": "$scope" } }
                }]
            }]
        }]
    }));
    let locals = LocalState::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(node, "test", bag, locals.clone());
    let mut host = RecHost::default();
    let mut screen = screen("/");
    let root = rt.frame(&mut host, &screen).clone();
    let rows: Vec<NodeId> = {
        fn collect(n: &ResolvedNode, ty: &str, out: &mut Vec<NodeId>) {
            if n.ty.as_ref() == ty {
                out.push(n.id.clone());
            }
            for c in &n.children {
                if let we_template::ResolvedChild::Node(m) = c {
                    collect(m, ty, out);
                }
            }
        }
        let mut v = Vec::new();
        collect(&root, "Row", &mut v);
        v
    };
    assert_eq!(rows.len(), 2, "two $each rows mounted");
    let boxes: Vec<NodeId> = {
        let mut v = Vec::new();
        fn collect(n: &ResolvedNode, out: &mut Vec<NodeId>) {
            if n.ty.as_ref() == "Box" {
                out.push(n.id.clone());
            }
            for c in &n.children {
                if let we_template::ResolvedChild::Node(m) = c {
                    collect(m, out);
                }
            }
        }
        collect(&root, &mut v);
        v
    };
    assert_eq!(boxes.len(), 2);
    assert!(
        locals.get(&rows[0], "f").strict_eq(&Value::from("A")),
        "row A seeded its initial"
    );

    // Edit row A's `f`, then reset from the Box under the inner `$each` —
    // whose own `item` is "x". The reset must write "A" (the declaring
    // row's item), never "x" (the handler's).
    rt.dispatch(&mut host, &mut screen, &rows[0], "onEdit", Value::Null);
    assert!(locals.get(&rows[0], "f").strict_eq(&Value::from("edit")));

    rt.dispatch(&mut host, &mut screen, &boxes[0], "onReset", Value::Null);
    assert!(
        locals.get(&rows[0], "f").strict_eq(&Value::from("A")),
        "reset re-evaluated in the DECLARING scope, not the handler's; got {:?}",
        locals.get(&rows[0], "f")
    );
}
