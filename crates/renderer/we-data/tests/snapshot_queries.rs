//! `SnapshotQuerySource` answers a named claim from the snapshot's `queries`
//! table and stays silent for a name it lacks; `FakeExecutor` answers
//! `model_query`/`model_subscribe` from the same rows and counts writes as
//! dropped calls.
use std::sync::Arc;

use we_data::{
    ClassSel, Executor, OfflineData, QueryIr, SnapshotQuerySource, SpaceId, Write, WriteOp,
};
use we_expr::{HandleTable, MountCx, ParseCache};
use we_template::{
    compile_request, CompileCx, Compiled, Inbox, NodeId, QueryHub, QueryRequest, QuerySource,
    Scope, SiteId, SiteSlot, SlotView, StoreBag,
};

const MINI: &str = include_str!("data/coasys-mini.json");

fn mini_json() -> serde_json::Value {
    serde_json::from_str(MINI).unwrap()
}

/// Compile a `$queries` descriptor to its request — what a resolve produces
/// before the hub keys it.
fn compile(descriptor: serde_json::Value, bag: &StoreBag) -> QueryRequest {
    let mut cache = ParseCache::new();
    let mut warnings = Vec::new();
    let mount = MountCx::explicit("test");
    let handles = HandleTable::new();
    match compile_request(
        &descriptor,
        &Scope::default(),
        &mut CompileCx::new(bag, &mut cache, &mut warnings, &mount, &handles),
    ) {
        Compiled::Ready(request) => request,
        other => panic!("query compiles: {other:?}"),
    }
}

/// The view a `Named` claim on `name` gets through `source` — the compile →
/// claim → commit → drain sequence a frame runs.
fn claimed_view(
    descriptor: serde_json::Value,
    name: &str,
    bag: &Arc<StoreBag>,
    source: Arc<dyn QuerySource>,
) -> SlotView {
    let mut hub = QueryHub::new(Arc::new(Inbox::default()), HandleTable::new());
    let request = compile(descriptor, bag);
    hub.claim(
        SiteId {
            node: NodeId::new("test:/n0"),
            slot: SiteSlot::Named(name.into()),
        },
        Compiled::Ready(request),
        None,
    );
    hub.commit(source);
    hub.drain();
    hub.cells()
        .into_iter()
        .next()
        .map(|c| c.view)
        .unwrap_or_default()
}

#[test]
fn source_returns_the_named_query_rows() {
    let bag = Arc::new(StoreBag::from_snapshot(&mini_json()).unwrap());
    let view = claimed_view(
        serde_json::json!({ "entity": "SignalType" }),
        "signalTypes",
        &bag,
        Arc::new(SnapshotQuerySource::new(bag.clone())),
    );
    assert_eq!(view.rows.len(), 2, "the fixture's two signal types");
    assert!(view.loaded, "a named query the table holds answers");
}

#[test]
fn unnamed_claim_loads() {
    let bag = Arc::new(StoreBag::from_snapshot(&mini_json()).unwrap());
    let mut hub = QueryHub::new(Arc::new(Inbox::default()), HandleTable::new());
    let request = compile(serde_json::json!({ "entity": "SignalType" }), &bag);
    // A `Prop` site carries no name_hint — the name-keyed table cannot
    // answer it, exactly as an anonymous TS subscribe has no handle.
    hub.claim(
        SiteId {
            node: NodeId::new("test:/n0"),
            slot: SiteSlot::Prop("rows".into()),
        },
        Compiled::Ready(request),
        None,
    );
    hub.commit(Arc::new(SnapshotQuerySource::new(bag)));
    hub.drain();
    let view = hub.cells().into_iter().next().unwrap().view;
    assert!(!view.loaded, "an anonymous request is not answered");
    assert!(view.rows.is_empty());
}

#[test]
fn name_the_snapshot_lacks_loads() {
    let bag = Arc::new(StoreBag::from_snapshot(&mini_json()).unwrap());
    let view = claimed_view(
        serde_json::json!({ "entity": "Nope" }),
        "noSuchQuery",
        &bag,
        Arc::new(SnapshotQuerySource::new(bag.clone())),
    );
    assert!(!view.loaded, "a name the table lacks is not answered");
    assert!(view.rows.is_empty());
}

#[test]
fn a_request_the_snapshot_did_not_answer_is_refused() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    let executor = data.executor();
    let space = SpaceId::new("demo");

    // `queries.signalTypes` is a `$queries` field name — the snapshot
    // recorded it for one particular request (`order: {"name": "asc"}`).
    // A `ClassSel` names entities, and `SignalType` with a bare IR is a
    // different request than the one recorded; `Ok` would pretend the
    // fixture could answer a question nobody asked.
    let entity = pollster::block_on(executor.model_query(
        &space,
        ClassSel::one("SignalType"),
        &QueryIr::default(),
    ));
    assert!(entity.is_err(), "a bare-IR entity read must be refused");

    // Even under the recorded field name, a filter/limit makes a different
    // request: `where id = sig-pin, limit 1` is not the recorded list.
    let paged = QueryIr {
        where_: Some(serde_json::json!({ "id": "sig-pin" })),
        limit: Some(1),
        ..QueryIr::default()
    };
    let filtered =
        pollster::block_on(executor.model_query(&space, ClassSel::one("signalTypes"), &paged));
    assert!(
        filtered.is_err(),
        "a page the fixture did not record must be refused"
    );

    // `model_subscribe` is the same contract — live or not, a request is
    // answered or it is refused.
    let live = pollster::block_on(executor.model_subscribe(
        &space,
        ClassSel::one("SignalType"),
        &QueryIr::default(),
    ));
    assert!(live.is_err(), "an unrecorded subscription must be refused");
}

#[test]
fn model_query_answers_the_request_the_claim_asked() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    let executor = data.executor();
    let space = SpaceId::new("demo");
    // A one-shot `subscribe: false` read — the request `model_query` makes.
    let request = compile(
        serde_json::json!({ "entity": "SignalType", "order": { "name": "asc" }, "subscribe": false }),
        &data.bag,
    );
    executor.note(&request.key(None, &HandleTable::new()), "signalTypes");

    let rows =
        pollster::block_on(executor.model_query(&space, ClassSel::one("SignalType"), &request.ir))
            .expect("the learned request is answered");
    match rows {
        we_expr::Value::List(rows) => assert_eq!(rows.len(), 2),
        other => panic!("expected rows, got {other:?}"),
    }
    // A subscription for the same entity is a different request — `sub`
    // differs in the key — and this one was never learned.
    let live = pollster::block_on(executor.model_subscribe(
        &space,
        ClassSel::one("SignalType"),
        &request.ir,
    ));
    assert!(live.is_err(), "the subscribed twin was not learned");
}

#[test]
fn model_subscribe_opens_a_live_query_for_a_learned_request() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    let executor = data.executor();
    let space = SpaceId::new("demo");
    // `subscribe` defaults true — the request `model_subscribe` makes.
    let request = compile(
        serde_json::json!({ "entity": "SignalType", "order": { "name": "asc" } }),
        &data.bag,
    );
    executor.note(&request.key(None, &HandleTable::new()), "signalTypes");

    let live = pollster::block_on(executor.model_subscribe(
        &space,
        ClassSel::one("SignalType"),
        &request.ir,
    ))
    .expect("the learned subscription is answered");
    match live.result() {
        we_expr::Value::List(rows) => assert_eq!(rows.len(), 2),
        other => panic!("expected rows, got {other:?}"),
    }
    pollster::block_on(executor.dispose_query(&space, live.id())).unwrap();
    assert_eq!(executor.disposed(), vec![live.id().clone()]);
}

#[test]
fn a_request_for_another_space_is_refused() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    // The fixture speaks for `demo` — a call routed to `other`, or whose IR
    // names another dataset on this space, is refused.
    let executor = data.executor().for_space(SpaceId::new("demo"));
    let request = compile(
        serde_json::json!({ "entity": "SignalType", "subscribe": false }),
        &data.bag,
    );
    executor.note(&request.key(None, &HandleTable::new()), "signalTypes");

    let wrong_space = pollster::block_on(executor.model_query(
        &SpaceId::new("other"),
        ClassSel::one("SignalType"),
        &request.ir,
    ));
    assert!(wrong_space.is_err(), "a call routed elsewhere is refused");

    let mut ds_ir = request.ir.clone();
    ds_ir
        .extra
        .insert("dataset".to_string(), serde_json::json!("elsewhere"));
    let wrong_dataset = pollster::block_on(executor.model_query(
        &SpaceId::new("demo"),
        ClassSel::one("SignalType"),
        &ds_ir,
    ));
    assert!(
        wrong_dataset.is_err(),
        "a dataset that disagrees with the space is refused"
    );

    // The right space with the right request still answers.
    let rows = pollster::block_on(executor.model_query(
        &SpaceId::new("demo"),
        ClassSel::one("SignalType"),
        &request.ir,
    ));
    assert!(rows.is_ok(), "the fixture's own space answers");
}

/// `OfflineData::executor` is the factory — the snapshot claims
/// `/space/demo`, so the executor it hands out is bound to `demo`
/// without an explicit `for_space`. Another space must not receive
/// the demo rows, and a snapshot that names no space yields an
/// executor that refuses until `for_space` binds one — the
/// deliberately space-agnostic fake is `FakeExecutor::new`.
#[test]
fn the_factory_binds_the_executor_to_the_snapshot_space() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    assert_eq!(data.space(), Some(&SpaceId::new("demo")));
    let executor = data.executor();
    let request = compile(
        serde_json::json!({ "entity": "SignalType", "subscribe": false }),
        &data.bag,
    );
    executor.note(&request.key(None, &HandleTable::new()), "signalTypes");

    let wrong_space = pollster::block_on(executor.model_query(
        &SpaceId::new("other"),
        ClassSel::one("SignalType"),
        &request.ir,
    ));
    assert!(
        wrong_space.is_err(),
        "the factory bound the snapshot's space — `other` must be refused"
    );

    let rows = pollster::block_on(executor.model_query(
        &SpaceId::new("demo"),
        ClassSel::one("SignalType"),
        &request.ir,
    ));
    assert!(rows.is_ok(), "the snapshot's own space answers");

    // A snapshot that names no space: every model call refuses until
    // `for_space` binds the executor — never a silent any-space answer.
    let anonymous = OfflineData::from_snapshot(
        &serde_json::json!({ "stores": {}, "queries": { "tasks": [] } }),
        None,
    )
    .unwrap();
    let executor = anonymous.executor();
    let unbound = pollster::block_on(executor.model_query(
        &SpaceId::new("demo"),
        ClassSel::one("Task"),
        &QueryIr::default(),
    ));
    assert!(unbound.is_err(), "unbound: no space to answer for");
    let executor = executor.for_space(SpaceId::new("demo"));
    executor.teach(&ClassSel::one("Task"), false, &QueryIr::default(), "tasks");
    let bound = pollster::block_on(executor.model_query(
        &SpaceId::new("demo"),
        ClassSel::one("Task"),
        &QueryIr::default(),
    ));
    assert!(bound.is_ok(), "for_space is the explicit binding");
}

#[test]
fn writes_are_unsupported_and_count_as_dropped() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    let executor = data.executor();
    let space = SpaceId::new("demo");

    let err = pollster::block_on(executor.write(
        &space,
        Write {
            op: WriteOp::Create,
            body: serde_json::json!({ "class": "SignalType", "fields": {} }),
        },
    ))
    .expect_err("writes never run offline");
    assert!(matches!(err, we_data::ExecutorError::Unsupported(_)));
    let report = data.provenance.report();
    assert_eq!(report.dropped_calls, 1);
    assert!(report.dropped.iter().any(|d| d == "write"));
}
