//! `OfflineData::from_route`: one route of a `we-snapshot@2` recording,
//! answered by dataset + request — never by the local query name, never
//! from the flat tables, and never `Rows([])` for a query the recorder
//! skipped.

use serde_json::json;
use we_data::{ClassSel, Executor, OfflineData, QueryIr, SpaceId};
use we_expr::ParseCache;
use we_template::{compile_query, QueryKey, QueryState, Scope};

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

/// The pool key a template's descriptor compiles to.
fn key(descriptor: serde_json::Value) -> (QueryKey, QueryIr) {
    let bag = we_template::StoreBag::new();
    let compiled = compile_query(
        &descriptor,
        &Scope::default(),
        &bag,
        &mut ParseCache::new(),
        &mut Vec::new(),
    )
    .expect("descriptor compiles");
    (compiled.key, compiled.ir)
}

fn rows(state: QueryState) -> Option<Vec<String>> {
    match state {
        QueryState::Rows(rows) => Some(
            rows.iter()
                .map(|r| r.to_json()["id"].as_str().unwrap_or_default().to_string())
                .collect(),
        ),
        QueryState::Loading => None,
    }
}

#[test]
fn same_named_queries_get_their_own_recorded_answers() {
    let data = OfflineData::from_route(&doc(), "dna", None).expect("route loads");
    let source = data.source();
    let (tree, tree_ir) = key(json!({ "entity": "SignalType", "order": { "name": "asc" } }));
    let (inspector, inspector_ir) = key(json!({ "entity": "SignalType" }));
    assert_eq!(
        rows(source.rows(&tree, &tree_ir)),
        Some(vec!["a".into(), "l".into()])
    );
    assert_eq!(
        rows(source.rows(&inspector, &inspector_ir)),
        Some(vec!["l".into(), "a".into()])
    );
    // A request nobody recorded is not answered by a same-named capture.
    let (other, other_ir) = key(json!({ "entity": "SignalType", "limit": 2 }));
    assert_eq!(rows(source.rows(&other, &other_ir)), None);
}

#[test]
fn a_skipped_query_is_loading_and_an_answered_empty_one_is_rows() {
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let source = data.source();
    let (card, card_ir) = key(json!({ "entity": "CollectionBlock", "limit": 1 }));
    assert_eq!(
        rows(source.rows(&card, &card_ir)),
        None,
        "skipped is never asked"
    );
    let (topics, topics_ir) = key(json!({ "entity": "Topic", "order": { "name": "asc" } }));
    assert_eq!(
        rows(source.rows(&topics, &topics_ir)),
        Some(vec![]),
        "[] is an answer"
    );
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
    let (kinds, kinds_ir) = key(json!({ "entity": "RelationshipType" }));
    assert_eq!(rows(data.source().rows(&kinds, &kinds_ir)), None);
    assert_eq!(
        data.captures().unwrap().ambiguous(),
        vec![vec!["a".to_string(), "b".to_string()]]
    );
}

#[test]
fn the_flat_tables_are_never_read_for_a_route() {
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let (calls, calls_ir) = key(json!({ "entity": "CollectionBlock" }));
    assert_eq!(rows(data.source().rows(&calls, &calls_ir)), None);
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
fn the_route_executor_answers_by_request_and_space() {
    let data = OfflineData::from_route(&doc(), "dna", None).unwrap();
    let exec = data.executor();
    let demo = SpaceId::new("demo");
    let class = ClassSel::One("SignalType".into());
    let (_, inspector_ir) = key(json!({ "entity": "SignalType" }));
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
    let (_, limit_ir) = key(json!({ "entity": "SignalType", "limit": 2 }));
    assert!(pollster::block_on(exec.model_query(&demo, class, &limit_ir)).is_err());
    let (_, card_ir) = key(json!({ "entity": "CollectionBlock", "limit": 1 }));
    assert!(pollster::block_on(exec.model_query(
        &demo,
        ClassSel::One("CollectionBlock".into()),
        &card_ir
    ))
    .is_err());
}
