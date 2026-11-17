//! E11, against a real executor (`EXECUTOR_PATH`; skipped without it):
//! writes through the validated write RPC (`perspective.instance*`, A3).
//!
//! An executor without the write RPC answers "method not found"; the tests
//! then print a skip, and fail under `AD4M_REQUIRE_EXECUTOR=1`.
use we_ad4m::testkit as kit;

use serde_json::json;
use we_data::{ClassSel, Executor, ExecutorError, QueryIr, SpaceId, Write, WriteOp};
use we_expr::Value;

fn require() -> bool {
    std::env::var("AD4M_REQUIRE_EXECUTOR").is_ok_and(|v| v != "0" && !v.is_empty())
}

/// `Some(reason)` when the executor has no `perspective.instanceCreate`.
fn no_write_rpc(e: &ExecutorError) -> Option<String> {
    let text = e.to_string().to_lowercase();
    (text.contains("method not found") || text.contains("unknown method")).then(|| e.to_string())
}

fn skip_without_write_rpc(e: &ExecutorError) -> bool {
    if let Some(why) = no_write_rpc(e) {
        assert!(
            !require(),
            "AD4M_REQUIRE_EXECUTOR is set but the executor has no perspective.instanceCreate: {why}"
        );
        eprintln!("SKIP: the executor has no perspective.instanceCreate ({why})");
        return true;
    }
    false
}

fn write(op: WriteOp, body: serde_json::Value) -> Write {
    Write { op, body }
}

/// Every `CollectionBlock` row as JSON.
fn rows(
    rt: &we_ad4m::Runtime,
    exec: &we_ad4m::Ad4mExecutor,
    space: &SpaceId,
) -> Vec<serde_json::Value> {
    let v = rt
        .block_on(exec.model_query(space, ClassSel::one("CollectionBlock"), &QueryIr::default()))
        .unwrap();
    match v.to_json() {
        serde_json::Value::Array(a) => a,
        other => panic!("rows: {other}"),
    }
}

fn id_of(v: &Value) -> String {
    match v.to_json().get("id") {
        Some(serde_json::Value::String(s)) => s.clone(),
        other => panic!("no id in {other:?}"),
    }
}

#[test]
fn create_update_remove_round_trip() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let conn = kit::connect(&rt, &executor.url);
    let uuid = kit::seed_space(&rt, &conn, "e11-writes");
    let exec = we_ad4m::Ad4mExecutor::new(conn.clone());
    let space = SpaceId::new(uuid.as_str());

    let created = match rt.block_on(exec.write(
        &space,
        write(
            WriteOp::Create,
            json!({ "className": "CollectionBlock", "properties": { "kind": "call", "title": "A" } }),
        ),
    )) {
        Ok(v) => v,
        Err(e) if skip_without_write_rpc(&e) => return,
        Err(e) => panic!("create: {e}"),
    };
    let id = id_of(&created);
    assert!(id.contains(':'), "a URI: {id}");
    let found = rows(&rt, &exec, &space);
    // The row id is the instance's base URI (step 0.2).
    let row = found
        .iter()
        .find(|r| r["id"] == json!(id))
        .unwrap_or_else(|| panic!("{id} not in {found:?}"));
    assert_eq!(row["title"], "A");

    rt.block_on(exec.write(
        &space,
        write(
            WriteOp::Update,
            json!({ "className": "CollectionBlock", "baseUri": id, "properties": { "title": "B" } }),
        ),
    ))
    .unwrap();
    let found = rows(&rt, &exec, &space);
    let row = found.iter().find(|r| r["id"] == json!(id)).unwrap();
    assert_eq!(row["title"], "B");

    let removed = rt
        .block_on(exec.write(
            &space,
            write(
                WriteOp::Remove,
                json!({ "className": "CollectionBlock", "baseUri": id }),
            ),
        ))
        .unwrap();
    assert_eq!(id_of(&removed), id);
    let found = rows(&rt, &exec, &space);
    assert!(
        !found.iter().any(|r| r["id"] == json!(id)),
        "still there: {found:?}"
    );
}

#[test]
fn a_refusal_keeps_the_code_message_and_kind() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let conn = kit::connect(&rt, &executor.url);
    let uuid = kit::seed_space(&rt, &conn, "e11-refusal");
    let exec = we_ad4m::Ad4mExecutor::new(conn.clone());
    let space = SpaceId::new(uuid.as_str());
    let refused = rt.block_on(exec.write(
        &space,
        write(
            WriteOp::Create,
            json!({ "className": "CollectionBlock", "properties": { "title": "no kind" } }),
        ),
    ));
    match refused {
        Err(ExecutorError::Rejected {
            code,
            message,
            data,
        }) => {
            assert_eq!(code, 422, "{message}");
            assert!(
                message.starts_with("Validation failed for class 'CollectionBlock'"),
                "{message}"
            );
            let data = data.expect("the InstanceError");
            assert_eq!(data["kind"], "validation", "{data}");
        }
        Err(e) if skip_without_write_rpc(&e) => {}
        other => panic!("expected a Rejected, got {other:?}"),
    }
}
