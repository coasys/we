//! `SnapshotQuerySource` answers a learned key from the snapshot's `queries`
//! table and `Loading` for an unlearned one; `FakeExecutor` answers
//! `model_query`/`model_subscribe` from the same rows and counts writes as
//! dropped calls.
use std::sync::Arc;

use we_data::{
    ClassSel, Executor, OfflineData, QueryIr, SnapshotQuerySource, SpaceId, Write, WriteOp,
};
use we_expr::ParseCache;
use we_template::{compile_query, QueryPool, QuerySource, QueryState, Scope, StoreBag};

const MINI: &str = include_str!("data/coasys-mini.json");

fn mini_json() -> serde_json::Value {
    serde_json::from_str(MINI).unwrap()
}

/// Compile `{"entity": "<entity>"}` so a pool cell with a real key exists —
/// the name is noted the way `resolve` notes it on the cell.
fn cell_named(pool: &QueryPool, entity: &str, name: &str, bag: &StoreBag) {
    let mut cache = ParseCache::new();
    let mut warnings = Vec::new();
    let compiled = compile_query(
        &serde_json::json!({ "entity": entity }),
        &Scope::default(),
        bag,
        &mut cache,
        &mut warnings,
    )
    .expect("query compiles");
    let cell = pool.cell(compiled.key.clone(), compiled.ir.clone());
    cell.note_name(name.into());
}

#[test]
fn source_returns_the_named_query_rows() {
    let bag = Arc::new(StoreBag::from_snapshot(&mini_json()).unwrap());
    let pool = QueryPool::new();
    cell_named(&pool, "SignalType", "signalTypes", &bag);

    let source = SnapshotQuerySource::new(bag);
    source.note_pool(&pool);

    let cell = pool.cells().into_iter().next().unwrap();
    match source.rows(&cell.key, &cell.ir) {
        QueryState::Rows(rows) => {
            assert_eq!(rows.len(), 2, "the fixture's two signal types");
        }
        QueryState::Loading => panic!("named query should be answered"),
    }
}

#[test]
fn unlearned_key_loads() {
    let bag = Arc::new(StoreBag::from_snapshot(&mini_json()).unwrap());
    let pool = QueryPool::new();
    cell_named(&pool, "SignalType", "signalTypes", &bag);

    let source = SnapshotQuerySource::new(bag);
    // No note_pool — the source has not learned the key → Loading.
    let cell = pool.cells().into_iter().next().unwrap();
    assert!(matches!(
        source.rows(&cell.key, &cell.ir),
        QueryState::Loading
    ));
}

#[test]
fn name_the_snapshot_lacks_loads() {
    let bag = Arc::new(StoreBag::from_snapshot(&mini_json()).unwrap());
    let pool = QueryPool::new();
    cell_named(&pool, "Nope", "noSuchQuery", &bag);

    let source = SnapshotQuerySource::new(bag);
    source.note_pool(&pool);
    let cell = pool.cells().into_iter().next().unwrap();
    assert!(matches!(
        source.rows(&cell.key, &cell.ir),
        QueryState::Loading
    ));
}

#[test]
fn fake_executor_answers_model_query_from_the_fixture() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    let executor = data.executor();
    let space = SpaceId::new("demo");
    // Offline the executor knows only the snapshot's `queries` names — a
    // `ClassSel` is looked up in that table by name.
    let class = ClassSel::one("signalTypes");
    let ir = QueryIr::default();

    let rows =
        pollster::block_on(executor.model_query(&space, class, &ir)).expect("model_query answers");
    match rows {
        we_expr::Value::List(rows) => assert_eq!(rows.len(), 2),
        other => panic!("expected rows, got {other:?}"),
    }
    assert_eq!(executor.invocations(), 1);
}

#[test]
fn fake_executor_subscribe_opens_a_live_query_with_rows() {
    let data = OfflineData::from_snapshot(&mini_json(), None).unwrap();
    let executor = data.executor();
    let space = SpaceId::new("demo");
    let class = ClassSel::one("signalTypes");
    let ir = QueryIr::default();

    let live = pollster::block_on(executor.model_subscribe(&space, class, &ir))
        .expect("model_subscribe answers");
    match live.result() {
        we_expr::Value::List(rows) => assert_eq!(rows.len(), 2),
        other => panic!("expected rows, got {other:?}"),
    }
    pollster::block_on(executor.dispose_query(&space, live.id())).unwrap();
    assert_eq!(executor.disposed(), vec![live.id().clone()]);
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
