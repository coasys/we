//! `OfflineData::from_route`: one route of a `we-snapshot@2` recording,
//! answered by dataset + request — never by the local query name, never
//! from the flat tables, and never `Rows([])` for a query the recorder
//! skipped.

use std::sync::Arc;

use serde_json::json;
use we_data::{ClassSel, Executor, OfflineData, SpaceId};
use we_expr::ParseCache;
use we_template::{
    compile_request, CompileCx, Compiled, Inbox, NodeId, QueryHub, QueryRequest, QuerySource,
    Scope, SiteId, SiteSlot, StoreBag,
};

/// Two `signalTypes` declarations asking different questions (the tree
/// sorts by name, the inspector does not), a skipped one, an answered empty
/// one, and two captures of one request that disagree.
fn doc() -> serde_json::Value {
    json!({
        "meta": { "format": "we-snapshot@2", "dataset": "demo" },
        // The flat projection names `calls` and `unused`; a route loader must
        // never read it.
        "queries": { "calls": [{ "id": "flat-call" }], "unused": [{ "id": "x" }] },
        "stores": { "spaceStore": { "spacePath": "/space/demo" } },
        "routes": {
            "dna": {
                "members": { "spaceStore": { "spacePath": "/space/demo", "root": "r" } },
                "agents": { "did:a": { "did": "did:a", "name": "Ada" } },
                "invokeTargets": ["shellStore.closeShellView"],
                "queries": [
                    { "name": "signalTypes", "scope": "template.meta.panels[tree].node", "dataset": "demo",
                      "request": { "entity": "SignalType", "order": { "name": "asc" } },
                      "rows": [{ "id": "a", "name": "Agree" }, { "id": "l", "name": "Like" }] },
                    { "name": "signalTypes", "scope": "template.meta.panels[inspector].node", "dataset": "demo",
                      "request": { "entity": "SignalType" },
                      "rows": [{ "id": "l", "name": "Like" }, { "id": "a", "name": "Agree" }] },
                    { "name": "card", "scope": "template.meta.panels[inspector].node", "dataset": "demo",
                      "request": { "entity": "CollectionBlock", "limit": 1 },
                      "descriptor": { "limit": 1 }, "skipped": "when" },
                    { "name": "topics", "scope": "template.routes[/dna]", "dataset": "demo",
                      "request": { "entity": "Topic", "order": { "name": "asc" } }, "rows": [] },
                    { "name": "kinds", "scope": "a", "dataset": "demo",
                      "request": { "entity": "RelationshipType" }, "rows": [{ "id": "k1" }] },
                    { "name": "kinds", "scope": "b", "dataset": "demo",
                      "request": { "entity": "RelationshipType" }, "rows": [{ "id": "k2" }] }
                ]
            }
        }
    })
}

/// The request a template's descriptor compiles to.
fn request(descriptor: serde_json::Value) -> QueryRequest {
    let bag = StoreBag::new();
    let mut cache = ParseCache::new();
    let mut warnings = Vec::new();
    let mut cx = CompileCx {
        bag: &bag,
        cache: &mut cache,
        warnings: &mut warnings,
    };
    match compile_request(&descriptor, &Scope::default(), &mut cx) {
        Compiled::Ready(request) => request,
        other => panic!("descriptor compiles: {other:?}"),
    }
}

/// Ask a source for a request the way a frame does — claim, commit, drain —
/// and read the row ids; `None` when the claim is still loading.
fn ask_rows(source: &Arc<dyn QuerySource>, request: QueryRequest) -> Option<Vec<String>> {
    let mut hub = QueryHub::new(Arc::new(Inbox::default()));
    hub.claim(
        SiteId {
            node: NodeId::new("test:/n0"),
            slot: SiteSlot::Prop("rows".into()),
        },
        Compiled::Ready(request),
        None,
    );
    hub.commit(source.clone());
    hub.drain();
    let view = hub.cells().into_iter().next()?.view;
    view.loaded.then(|| {
        view.rows
            .iter()
            .map(|r| r.to_json()["id"].as_str().unwrap_or_default().to_string())
            .collect()
    })
}

#[test]
fn same_named_queries_get_their_own_recorded_answers() {
    let data = OfflineData::from_route(&doc(), "dna", None).expect("route loads");
    let source = data.source();
    let tree = request(json!({ "entity": "SignalType", "order": { "name": "asc" } }));
    let inspector = request(json!({ "entity": "SignalType" }));
    assert_eq!(ask_rows(&source, tree), Some(vec!["a".into(), "l".into()]));
    assert_eq!(
        ask_rows(&source, inspector),
        Some(vec!["l".into(), "a".into()])
    );
    // A request nobody recorded is not answered by a same-named capture.
    let other = request(json!({ "entity": "SignalType", "limit": 2 }));
    assert_eq!(ask_rows(&source, other), None);
}

#[test]
fn a_skipped_query_is_loading_and_an_answered_empty_one_is_rows() {
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let source = data.source();
    let card = request(json!({ "entity": "CollectionBlock", "limit": 1 }));
    assert_eq!(ask_rows(&source, card), None, "skipped is never asked");
    let topics = request(json!({ "entity": "Topic", "order": { "name": "asc" } }));
    assert_eq!(ask_rows(&source, topics), Some(vec![]), "[] is an answer");
    let captures = data.captures().unwrap();
    assert_eq!(captures.counts(), (5, 1, 0));
    assert_eq!(
        captures.unanswered(),
        vec![(
            "card".to_string(),
            "template.meta.panels[inspector].node".to_string(),
            "skipped: when".to_string()
        )]
    );
}

#[test]
fn two_captures_disagreeing_on_one_request_answer_neither() {
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let kinds = request(json!({ "entity": "RelationshipType" }));
    assert_eq!(ask_rows(&data.source(), kinds), None);
    assert_eq!(
        data.captures().unwrap().ambiguous(),
        vec![vec!["a".to_string(), "b".to_string()]]
    );
}

#[test]
fn the_flat_tables_are_never_read_for_a_route() {
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let calls = request(json!({ "entity": "CollectionBlock" }));
    assert_eq!(ask_rows(&data.source(), calls), None);
    assert!(data.queries.is_empty(), "no name-keyed table for a route");
    // Members come from the route, agents join the profiles, invokes are the
    // route's declared targets.
    assert_eq!(data.member("spaceStore", "root").to_json(), json!("r"));
    assert_eq!(
        data.member("profileStore", "profiles").to_json(),
        json!([{ "did": "did:a", "name": "Ada" }])
    );
    assert!(OfflineData::from_route(&doc(), "nope", None).is_err());
    // A route loader needs the @2 format.
    let mut legacy = doc();
    legacy.as_object_mut().unwrap().remove("meta");
    assert!(OfflineData::from_route(&legacy, "dna", None).is_err());
}

#[test]
fn a_capture_from_another_dataset_does_not_answer() {
    // The dataset is part of a request's identity: rows recorded against
    // another dataset do not answer the same question asked in this one.
    let mut doc = doc();
    doc["routes"]["dna"]["queries"]
        .as_array_mut()
        .unwrap()
        .push(
            json!({ "name": "tags", "scope": "c", "dataset": "elsewhere",
                      "request": { "entity": "Tag" }, "rows": [{ "id": "t9" }] }),
        );
    let data = OfflineData::from_route(&doc, "dna", None).expect("route loads");
    let tags = request(json!({ "entity": "Tag" }));
    assert_eq!(ask_rows(&data.source(), tags), None);
}

#[test]
fn the_route_executor_answers_by_request_and_space() {
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let exec = data.executor();
    let demo = SpaceId::new("demo");
    let class = ClassSel::One("SignalType".into());
    let inspector_ir = request(json!({ "entity": "SignalType" })).ir;
    let got = pollster::block_on(exec.model_query(&demo, class.clone(), &inspector_ir))
        .expect("recorded request answers");
    assert_eq!(
        got.to_json(),
        json!([{ "id": "l", "name": "Like" }, { "id": "a", "name": "Agree" }])
    );
    let sub = pollster::block_on(exec.model_subscribe(&demo, class.clone(), &inspector_ir))
        .expect("a subscription to the recorded request answers too");
    assert_eq!(sub.result().to_json(), got.to_json());
    // Another space, an unrecorded request, a skipped one: refused.
    assert!(pollster::block_on(exec.model_query(
        &SpaceId::new("other"),
        class.clone(),
        &inspector_ir
    ))
    .is_err());
    let limit_ir = request(json!({ "entity": "SignalType", "limit": 2 })).ir;
    assert!(pollster::block_on(exec.model_query(&demo, class, &limit_ir)).is_err());
    let card_ir = request(json!({ "entity": "CollectionBlock", "limit": 1 })).ir;
    assert!(pollster::block_on(exec.model_query(
        &demo,
        ClassSel::One("CollectionBlock".into()),
        &card_ir
    ))
    .is_err());
}

/// One `SignalType` request recorded in two datasets, with different rows.
fn two_dataset_doc(default: Option<&str>) -> serde_json::Value {
    let mut meta = json!({ "format": "we-snapshot@2" });
    if let Some(ds) = default {
        meta["dataset"] = json!(ds);
    }
    json!({
        "meta": meta,
        "routes": {
            "dna": {
                "queries": [
                    { "name": "signalTypes", "scope": "a", "dataset": "demo",
                      "request": { "entity": "SignalType" }, "rows": [{ "id": "demo-like" }] },
                    { "name": "signalTypes", "scope": "b", "dataset": "other",
                      "request": { "entity": "SignalType" }, "rows": [{ "id": "other-like" }] }
                ]
            }
        }
    })
}

fn ask(exec: &we_data::FakeExecutor, space: &str) -> Option<serde_json::Value> {
    let ir = request(json!({ "entity": "SignalType" })).ir;
    pollster::block_on(exec.model_query(
        &SpaceId::new(space),
        ClassSel::One("SignalType".into()),
        &ir,
    ))
    .ok()
    .map(|v| v.to_json())
}

#[test]
fn a_snapshot_with_no_default_space_answers_the_bound_space() {
    // Lal, E3c-3 P2: no default space, captures naming `dataset: "demo"`,
    // the factory executor bound with `for_space` as its unbound-snapshot
    // API requires — the recorded request answers with demo's rows.
    let data = OfflineData::from_route(&two_dataset_doc(None), "dna", None).expect("route loads");
    assert_eq!(data.space(), None);
    let demo = data.executor().for_space(SpaceId::new("demo"));
    assert_eq!(ask(&demo, "demo"), Some(json!([{ "id": "demo-like" }])));
    let other = data.executor().for_space(SpaceId::new("other"));
    assert_eq!(ask(&other, "other"), Some(json!([{ "id": "other-like" }])));
}

#[test]
fn the_same_request_in_two_datasets_answers_each_its_own_rows() {
    // The collection's default is `demo`; a call in `other` must get
    // other's rows, never the default's.
    let data =
        OfflineData::from_route(&two_dataset_doc(Some("demo")), "dna", None).expect("route loads");
    let demo = data.executor();
    assert_eq!(ask(&demo, "demo"), Some(json!([{ "id": "demo-like" }])));
    let other = data.executor().for_space(SpaceId::new("other"));
    assert_eq!(ask(&other, "other"), Some(json!([{ "id": "other-like" }])));
}

#[test]
fn a_reserved_dataset_in_the_ir_is_refused_against_captures() {
    // Capture identity strips `dataset`, so without the executor's
    // reserved-key guard this IR would find demo's recorded rows: the
    // refusal here is the guard's, not an unlearned key's.
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let exec = data.executor();
    let demo = SpaceId::new("demo");
    let class = ClassSel::One("SignalType".into());
    let ir = request(json!({ "entity": "SignalType" })).ir;
    assert!(pollster::block_on(exec.model_query(&demo, class.clone(), &ir)).is_ok());
    let mut ds_ir = ir.clone();
    ds_ir
        .extra
        .insert("dataset".to_string(), serde_json::json!("demo"));
    let refused = pollster::block_on(exec.model_query(&demo, class, &ds_ir));
    let err = refused.expect_err("a reserved dataset in the IR is refused");
    assert!(
        err.to_string().contains("reserved `dataset`"),
        "refused by the guard: {err}"
    );
}
