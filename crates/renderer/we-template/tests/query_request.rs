//! E3c-3: the typed query request and its dataset identity.
//!
//! Expected values come from E3c-design 2.1 and from the TS compile
//! (`resolveQueryProp` / `entityNamesOf` / the `$queries` block in
//! `SchemaRenderer.tsx`), not from this implementation's output.

use serde_json::json;
use we_expr::ParseCache;
use we_template::{
    compile_request, CompileCx, Compiled, DatasetHandle, DatasetSel, QueryIr, Scope, StoreBag,
};

fn compile(descriptor: serde_json::Value) -> Compiled {
    let bag = StoreBag::new();
    let mut cache = ParseCache::new();
    let mut warnings = Vec::new();
    let mut cx = CompileCx::new(&bag, &mut cache, &mut warnings);
    compile_request(&descriptor, &Scope::default(), &mut cx)
}

fn ready(descriptor: serde_json::Value) -> we_template::QueryRequest {
    match compile(descriptor.clone()) {
        Compiled::Ready(request) => request,
        Compiled::Provisional(_) => panic!("{descriptor} compiled Provisional"),
        Compiled::Gated => panic!("{descriptor} compiled Gated"),
    }
}

#[test]
fn request_carries_classes_union_subscribe() {
    // `entityNamesOf`: a list is a union even of one, deduped, blanks
    // dropped; `subscribe: false` is a one-shot. All three are fields.
    let request = ready(json!({
        "entity": ["Task", "Event", "Task", ""],
        "subscribe": false
    }));
    let classes: Vec<&str> = request.classes.iter().map(|c| c.as_ref()).collect();
    assert_eq!(classes, ["Task", "Event"]);
    assert!(request.union);
    assert!(!request.subscribe);
    assert_eq!(request.dataset, DatasetSel::Here);

    let single = ready(json!({ "entity": "Task" }));
    let classes: Vec<&str> = single.classes.iter().map(|c| c.as_ref()).collect();
    assert_eq!(classes, ["Task"]);
    assert!(!single.union, "a bare name is not a union");
    assert!(single.subscribe, "subscribe defaults to true");

    let one_list = ready(json!({ "entity": ["Task"] }));
    assert!(one_list.union, "a list of one is still a union");
}

#[test]
fn an_authored_dataset_is_a_named_handle_and_not_in_the_ir() {
    let request = ready(json!({ "entity": "Task", "dataset": "datasetStore.rootDataset" }));
    assert_eq!(
        request.dataset,
        DatasetSel::Named(DatasetHandle::new("datasetStore.rootDataset"))
    );
    let wire = serde_json::to_value(&request.ir).unwrap();
    assert!(
        wire.get("dataset").is_none(),
        "the IR carries no dataset selector: {wire}"
    );
}

#[test]
fn two_queries_differing_only_in_dataset_get_different_keys() {
    let a = ready(json!({ "entity": "Task", "dataset": "a" }));
    let b = ready(json!({ "entity": "Task", "dataset": "b" }));
    let here = ready(json!({ "entity": "Task" }));
    assert_eq!(a.ir_json(), b.ir_json(), "the IRs are the same question");
    assert_ne!(a.key(None), b.key(None), "the dataset is part of the key");
    assert_ne!(a.key(None), here.key(None), "Named is not Here");
}

#[test]
fn here_is_resolved_to_the_mount_space_before_hashing() {
    // Two mounts in different spaces never share a cell; `Here` in space
    // `s` is the same question as naming `s`.
    let here = ready(json!({ "entity": "Task" }));
    let s = DatasetHandle::new("s");
    let t = DatasetHandle::new("t");
    assert_ne!(here.key(Some(&s)), here.key(Some(&t)));
    let named_s = ready(json!({ "entity": "Task", "dataset": "s" }));
    assert_eq!(here.key(Some(&s)), named_s.key(None));
}

#[test]
fn a_here_key_is_unchanged_from_the_pull_path() {
    // No mount space yet: a Here request keys exactly as the pull path
    // always keyed it, so the offline captures and snapshot keys hold.
    let request = ready(json!({ "entity": "Task", "where": { "status": "todo" } }));
    assert_eq!(
        request.key(None).as_str(),
        r#"{"e":["Task"],"u":false,"ds":null,"sub":true,"ir":{"where":{"status":"todo"}}}"#
    );
}

#[test]
fn a_reserved_authority_key_in_params_gates_the_query() {
    // R2: `QueryIr.extra` is flattened onto the wire, so a param spelled
    // like an authority selector would reach a source beside the typed
    // dataset. It is refused, not passed through.
    // `dataset` itself is the descriptor's typed selector and never a param.
    for reserved in ["space", "origin", "authority", "tier"] {
        let mut descriptor = serde_json::Map::new();
        descriptor.insert("entity".into(), json!("Task"));
        descriptor.insert(reserved.into(), json!("elsewhere"));
        assert!(
            matches!(compile(json!(descriptor)), Compiled::Gated),
            "{reserved} in params must gate"
        );
    }
    // An unreserved extra param still passes through to the IR and the key.
    let request = ready(json!({ "entity": "Task", "levels": 2 }));
    assert_eq!(request.ir_json(), json!({ "levels": 2 }));
    // And on the wire: an IR deserialized with one reports it.
    let ir: QueryIr = serde_json::from_value(json!({ "dataset": "x" })).unwrap();
    assert_eq!(ir.reserved_key(), Some("dataset"));
    assert_eq!(QueryIr::default().reserved_key(), None);
}
