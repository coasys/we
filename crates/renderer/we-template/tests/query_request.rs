//! E3c-3: the typed query request and its dataset identity.
//!
//! Expected values come from E3c-design 2.1 and from the TS compile
//! (`resolveQueryProp` / `entityNamesOf` / the `$queries` block in
//! `SchemaRenderer.tsx`), not from this implementation's output.

use serde_json::json;
use we_expr::{HandleTable, MountCx, ParseCache};
use we_template::{
    compile_request, CompileCx, Compiled, DatasetSel, QueryIr, QueryRequest, Scope, StoreBag,
};

/// A mount + its table: the identity every request compiles under.
struct Cx {
    handles: HandleTable,
    mount: MountCx,
}

fn cx() -> Cx {
    Cx {
        handles: HandleTable::new(),
        mount: MountCx::explicit("test"),
    }
}

fn compile(descriptor: serde_json::Value, c: &Cx) -> Compiled {
    let bag = StoreBag::new();
    let mut cache = ParseCache::new();
    let mut warnings = Vec::new();
    let mut ccx = CompileCx::new(&bag, &mut cache, &mut warnings, &c.mount, &c.handles);
    compile_request(&descriptor, &Scope::default(), &mut ccx)
}

fn ready(descriptor: serde_json::Value, c: &Cx) -> QueryRequest {
    match compile(descriptor.clone(), c) {
        Compiled::Ready(request) => request,
        Compiled::Provisional(_) => panic!("{descriptor} compiled Provisional"),
        Compiled::Gated => panic!("{descriptor} compiled Gated"),
    }
}

#[test]
fn request_carries_classes_union_subscribe() {
    // `entityNamesOf`: a list is a union even of one, deduped, blanks
    // dropped; `subscribe: false` is a one-shot. All three are fields.
    let c = cx();
    let request = ready(
        json!({
            "entity": ["Task", "Event", "Task", ""],
            "subscribe": false
        }),
        &c,
    );
    let classes: Vec<&str> = request.classes.iter().map(|c| c.as_ref()).collect();
    assert_eq!(classes, ["Task", "Event"]);
    assert!(request.union);
    assert!(!request.subscribe);
    assert_eq!(request.dataset, DatasetSel::Here);

    let single = ready(json!({ "entity": "Task" }), &c);
    let classes: Vec<&str> = single.classes.iter().map(|c| c.as_ref()).collect();
    assert_eq!(classes, ["Task"]);
    assert!(!single.union, "a bare name is not a union");
    assert!(single.subscribe, "subscribe defaults to true");

    let one_list = ready(json!({ "entity": ["Task"] }), &c);
    assert!(one_list.union, "a list of one is still a union");
}

#[test]
fn an_authored_dataset_is_a_named_handle_and_not_in_the_ir() {
    let c = cx();
    let request = ready(
        json!({ "entity": "Task", "dataset": "datasetStore.rootDataset" }),
        &c,
    );
    let DatasetSel::Named(handle) = &request.dataset else {
        panic!("an authored dataset selects a named handle: {request:?}")
    };
    assert_eq!(
        c.handles.key(handle.handle()).as_deref(),
        Some("datasetStore.rootDataset"),
        "the handle names the evaluated dataset"
    );
    let wire = serde_json::to_value(&request.ir).unwrap();
    assert!(
        wire.get("dataset").is_none(),
        "the IR carries no dataset selector: {wire}"
    );
}

#[test]
fn two_queries_differing_only_in_dataset_get_different_keys() {
    let c = cx();
    let a = ready(json!({ "entity": "Task", "dataset": "a" }), &c);
    let b = ready(json!({ "entity": "Task", "dataset": "b" }), &c);
    let here = ready(json!({ "entity": "Task" }), &c);
    assert_eq!(a.ir_json(), b.ir_json(), "the IRs are the same question");
    assert_ne!(
        a.key(None, &c.handles),
        b.key(None, &c.handles),
        "the dataset is part of the key"
    );
    assert_ne!(
        a.key(None, &c.handles),
        here.key(None, &c.handles),
        "Named is not Here"
    );
}

#[test]
fn here_is_resolved_to_the_mount_space_before_hashing() {
    // Two mounts in different spaces never share a cell; `Here` in space
    // `s` is the same question as naming `s`.
    let c = cx();
    let here = ready(json!({ "entity": "Task" }), &c);
    let s = c.handles.mint_space("s");
    let t = c.handles.mint_space("t");
    assert_ne!(
        here.key(Some(&s), &c.handles),
        here.key(Some(&t), &c.handles)
    );
    let named_s = ready(json!({ "entity": "Task", "dataset": "s" }), &c);
    assert_eq!(
        here.key(Some(&s), &c.handles),
        named_s.key(None, &c.handles)
    );
}

#[test]
fn a_here_key_is_unchanged_from_the_pull_path() {
    // No mount space yet: a Here request keys exactly as the pull path
    // always keyed it, so the offline captures and snapshot keys hold.
    let c = cx();
    let request = ready(
        json!({ "entity": "Task", "where": { "status": "todo" } }),
        &c,
    );
    assert_eq!(
        request.key(None, &c.handles).as_str(),
        r#"{"e":["Task"],"u":false,"ds":null,"sub":true,"ir":{"where":{"status":"todo"}}}"#
    );
}

#[test]
fn a_here_key_with_no_mount_space_is_not_some_space() {
    // A mount with no space must not quietly key `Here` as a real
    // dataset — `ds:null` collides with no recorded capture's dataset.
    let c = cx();
    let here = ready(json!({ "entity": "Task" }), &c);
    assert!(
        here.key(None, &c.handles).as_str().contains("\"ds\":null"),
        "no space → null, not a shared name"
    );
    // And a named query cannot pretend to be `Here`.
    let named = ready(json!({ "entity": "Task", "dataset": "demo-a" }), &c);
    assert_ne!(named.key(None, &c.handles), here.key(None, &c.handles));
    // A space handle and a dataset handle key by name — `Here` under
    // space `demo-a` is the same question as `dataset: "demo-a"`.
    let space = c.handles.mint_space("demo-a");
    assert_eq!(
        here.key(Some(&space), &c.handles),
        named.key(None, &c.handles),
        "Here resolves to the mount's space before hashing"
    );
    // An unknown handle — minted by another table, or forged — keys as
    // nothing, never as a dataset.
    let foreign = HandleTable::new();
    let other = foreign.mint_space("demo-a");
    assert!(
        here.key(Some(&other), &c.handles)
            .as_str()
            .contains("\"ds\":null"),
        "a handle this table did not mint resolves to nothing"
    );
}

#[test]
fn a_reserved_authority_key_in_params_gates_the_query() {
    // R2: `QueryIr.extra` is flattened onto the wire, so a param spelled
    // like an authority selector would reach a source beside the typed
    // dataset. It is refused, not passed through.
    // `dataset` itself is the descriptor's typed selector and never a param.
    let c = cx();
    for reserved in ["space", "origin", "authority", "tier"] {
        let mut descriptor = serde_json::Map::new();
        descriptor.insert("entity".into(), json!("Task"));
        descriptor.insert(reserved.into(), json!("elsewhere"));
        assert!(
            matches!(compile(json!(descriptor), &c), Compiled::Gated),
            "{reserved} in params must gate"
        );
    }
    // An unreserved extra param still passes through to the IR and the key.
    let request = ready(json!({ "entity": "Task", "levels": 2 }), &c);
    assert_eq!(request.ir_json(), json!({ "levels": 2 }));
    // And on the wire: an IR deserialized with one reports it.
    let ir: QueryIr = serde_json::from_value(json!({ "dataset": "x" })).unwrap();
    assert_eq!(ir.reserved_key(), Some("dataset"));
    assert_eq!(QueryIr::default().reserved_key(), None);
}
