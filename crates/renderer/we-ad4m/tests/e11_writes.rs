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

// ---- Step 3: the WriteHost, driven through a session --------------------

use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use we_ad4m::{Access, WriteHost};
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{MountCx, ResolvedChild, ResolvedNode, RootSpec, StaticHost, StoreBag};

/// A space with `CollectionBlock` and one call in it, created through the
/// write RPC; `None` when the executor has none. Returns the call's id.
struct Rig {
    _executor: kit::Executor,
    rt: we_ad4m::Runtime,
    conn: we_ad4m::Connection,
    uuid: String,
    id: String,
}

fn rig(name: &str) -> Option<Rig> {
    let executor = kit::start_executor()?;
    let rt = we_ad4m::Runtime::new().unwrap();
    let conn = kit::connect(&rt, &executor.url);
    let uuid = kit::seed_space(&rt, &conn, name);
    let exec = we_ad4m::Ad4mExecutor::new(conn.clone());
    let created = match rt.block_on(exec.write(
        &SpaceId::new(uuid.as_str()),
        write(
            WriteOp::Create,
            json!({ "className": "CollectionBlock", "properties": { "kind": "call", "title": "A" } }),
        ),
    )) {
        Ok(v) => v,
        Err(e) if skip_without_write_rpc(&e) => return None,
        Err(e) => panic!("create: {e}"),
    };
    Some(Rig {
        id: id_of(&created),
        _executor: executor,
        rt,
        conn,
        uuid,
    })
}

impl Rig {
    fn title(&self) -> Option<String> {
        kit::query_rows(&self.rt, &self.conn, &self.uuid, "CollectionBlock")
            .into_iter()
            .find(|r| r["id"] == json!(self.id))
            .map(|r| r["title"].as_str().unwrap_or_default().to_string())
    }
}

/// One button invoking `invoke`, and a text showing `local.ok` / `local.msg`
/// / `local.kind` / `local.fin` — what its lifecycle wrote (`fin` counts
/// `onFinally` runs).
fn button(invoke: serde_json::Value) -> RootSpec {
    let node = json!({
        "type": "Column",
        "$localState": {
            "ok": { "type": "boolean", "initial": false },
            "msg": { "type": "string", "initial": "" },
            "kind": { "type": "string", "initial": "" },
            "fin": { "type": "number", "initial": 0 }
        },
        "children": [
            { "type": "we-button", "props": { "onClick": invoke }, "children": ["Go"] },
            { "type": "we-text", "children": [{ "$": "`ok=${local.ok} msg=${local.msg} kind=${local.kind} fin=${local.fin}`" }] }
        ]
    });
    RootSpec::Single {
        node: Box::new(serde_json::from_value(node).unwrap()),
        cx: MountCx::explicit("test"),
        declared: we_template::Declared::default(),
    }
}

/// The lifecycle every test template's invoke carries.
fn invoke(target: &str, args: serde_json::Value) -> serde_json::Value {
    json!({
        "$invoke": target, "args": args,
        "onSuccess": [{ "$setLocal": "ok", "value": true }],
        "onError": [
            { "$setLocal": "msg", "value": { "$": "result.message" } },
            { "$setLocal": "kind", "value": { "$": "result.kind" } }
        ],
        "onFinally": [{ "$setLocal": "fin", "value": { "$": "local.fin + 1" } }]
    })
}

fn session(r: &Rig, access: Access, spec: RootSpec) -> (Session, mpsc::Receiver<()>) {
    let bag = Arc::new(StoreBag::new());
    let host = WriteHost::new(
        StaticHost::new(bag.clone()),
        r.conn.clone(),
        SpaceId::new(r.uuid.as_str()),
        bag.clone(),
        access,
    );
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let mut s = Session::new(spec, bag, screen, Box::new(host));
    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    s.set_waker(Arc::new(move || {
        let _ = tx.lock().unwrap().send(());
    }));
    (s, rx)
}

fn find<'a>(n: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if n.ty.as_ref() == ty {
        return Some(n);
    }
    n.children.iter().find_map(|c| match c {
        ResolvedChild::Node(c) => find(c, ty),
        ResolvedChild::Text(_) => None,
    })
}

fn click(s: &mut Session) {
    let root = s.resolve();
    let id = find(&root, "we-button").expect("the button").id.clone();
    s.dispatch(&id, "onClick", Value::Null);
}

fn text(s: &mut Session) -> String {
    we_template::normal_form(&s.resolve()).to_string()
}

/// Resolve on every wake until the tree contains `want`.
fn wait_for(s: &mut Session, wake: &mpsc::Receiver<()>, want: &str, limit: Duration) -> Duration {
    let start = Instant::now();
    loop {
        s.poll();
        let t = text(s);
        if t.contains(want) {
            return start.elapsed();
        }
        let left = limit.saturating_sub(start.elapsed());
        assert!(
            !left.is_zero(),
            "{want:?} not in the tree after {limit:?}: {t}"
        );
        let _ = wake.recv_timeout(left.min(Duration::from_millis(100)));
    }
}

fn host(s: &Session) -> &WriteHost {
    s.host_as::<WriteHost>().expect("a WriteHost")
}

#[test]
fn a_target_with_no_row_falls_back() {
    let Some(r) = rig("e11-fallback") else { return };
    let (mut s, _wake) = session(
        &r,
        Access::write(r.uuid.as_str()),
        button(invoke("routeStore.unknownThing", json!([]))),
    );
    click(&mut s);
    assert_eq!(host(&s).fallback.dropped, ["routeStore.unknownThing"]);
    // A sync Done runs no lifecycle.
    assert!(
        text(&mut s).contains("ok=false msg= kind="),
        "{}",
        text(&mut s)
    );
}

#[test]
fn a_write_row_reaches_the_executor_and_settles_ok() {
    let Some(r) = rig("e11-update") else { return };
    let spec = button(invoke(
        "record.update",
        json!(["CollectionBlock", r.id, { "title": "B" }]),
    ));
    let (mut s, wake) = session(&r, Access::write(r.uuid.as_str()), spec);
    click(&mut s);
    let took = wait_for(&mut s, &wake, "ok=true", Duration::from_secs(5));
    eprintln!("record.update settled in {took:?}");
    assert_eq!(r.title().as_deref(), Some("B"));
    assert!(host(&s).notices().list().is_empty());
}

#[test]
fn a_refused_write_runs_on_error_and_leaves_a_notice() {
    let Some(r) = rig("e11-refused") else { return };
    let spec = button(invoke(
        "record.update",
        json!(["CollectionBlock", r.id, { "nope": 1 }]),
    ));
    let (mut s, wake) = session(&r, Access::write(r.uuid.as_str()), spec);
    click(&mut s);
    let took = wait_for(
        &mut s,
        &wake,
        "msg=Validation failed",
        Duration::from_secs(5),
    );
    eprintln!("the refusal reached onError in {took:?}");
    let t = text(&mut s);
    assert!(t.contains("kind=validation"), "{t}");
    let notices = host(&s).notices().list();
    assert_eq!(notices.len(), 1, "{notices:?}");
    assert!(
        notices[0]
            .text
            .starts_with("Could not save that change. Validation failed"),
        "{}",
        notices[0].text
    );
    assert_eq!(r.title().as_deref(), Some("A"));
}

#[test]
fn read_only_refuses_without_calling_the_executor() {
    let Some(r) = rig("e11-readonly") else { return };
    let spec = button(invoke(
        "record.update",
        json!(["CollectionBlock", r.id, { "title": "B" }]),
    ));
    let (mut s, _wake) = session(&r, Access::ReadOnly, spec);
    click(&mut s);
    std::thread::sleep(Duration::from_millis(500));
    s.poll();
    assert_eq!(r.title().as_deref(), Some("A"), "unchanged");
    let notices = host(&s).notices().list();
    assert!(
        notices.iter().any(|n| n.text.contains("read-only")),
        "{notices:?}"
    );
    assert!(text(&mut s).contains("ok=false"));
}

#[test]
fn a_delete_waits_for_the_answer() {
    let Some(r) = rig("e11-delete") else { return };
    let spec = button(invoke("record.delete", json!(["CollectionBlock", r.id])));
    let (mut s, wake) = session(&r, Access::write(r.uuid.as_str()), spec);
    click(&mut s);
    let c = host(&s).pending_confirm().expect("asks first");
    assert_eq!(c.title, "Delete this CollectionBlock?");
    std::thread::sleep(Duration::from_millis(500));
    assert!(r.title().is_some(), "not removed before the answer");

    s.host_mut_as::<WriteHost>().unwrap().answer_confirm(false);
    wait_for(&mut s, &wake, "kind=cancelled", Duration::from_secs(5));
    assert!(host(&s).pending_confirm().is_none());
    assert!(r.title().is_some(), "cancel keeps it");
    assert!(
        host(&s).notices().list().is_empty(),
        "a cancel says nothing"
    );

    click(&mut s);
    assert!(host(&s).pending_confirm().is_some());
    s.host_mut_as::<WriteHost>().unwrap().answer_confirm(true);
    let took = wait_for(&mut s, &wake, "ok=true", Duration::from_secs(5));
    eprintln!("record.delete settled in {took:?}");
    assert!(r.title().is_none(), "removed");
}

#[test]
fn create_signal_type_writes_one_signal_type() {
    let Some(r) = rig("e11-signal-type") else {
        return;
    };
    kit::add_class(&r.rt, &r.conn, &r.uuid, "SignalType", kit::SIGNAL_TYPE_SDNA);
    let fresh = json!({
        "name": "Upvote", "slug": "", "description": "", "icon": "❤️", "iconSecondary": "",
        "mode": "toggle", "rangeMin": 0, "rangeMax": 1, "step": 1
    });
    let spec = button(invoke("spaceStore.createSignalType", json!([fresh])));
    let (mut s, wake) = session(&r, Access::write(r.uuid.as_str()), spec);
    click(&mut s);
    let took = wait_for(&mut s, &wake, "ok=true", Duration::from_secs(5));
    eprintln!("createSignalType settled in {took:?}");
    let rows = kit::query_rows(&r.rt, &r.conn, &r.uuid, "SignalType");
    assert_eq!(rows.len(), 1, "{rows:?}");
    let row = &rows[0];
    assert_eq!(row["name"], "Upvote", "{row}");
    assert_eq!(row["slug"], "upvote", "{row}");
    assert_eq!(row["mode"], "toggle", "{row}");
    assert_eq!(row["aggregate"], "count", "{row}");
    assert_eq!(row["rangeMin"], 0, "{row}");
    assert_eq!(row["rangeMax"], 1, "{row}");
}

#[test]
fn a_grant_for_another_space_refuses_here() {
    let Some(r) = rig("e11-other-space") else {
        return;
    };
    let spec = button(invoke(
        "record.update",
        json!(["CollectionBlock", r.id, { "title": "B" }]),
    ));
    let other = "00000000-0000-4000-8000-000000000000";
    let (mut s, _wake) = session(&r, Access::write(other), spec);
    click(&mut s);
    std::thread::sleep(Duration::from_millis(500));
    s.poll();
    assert_eq!(r.title().as_deref(), Some("A"), "unchanged");
    let notices = host(&s).notices().list();
    assert!(
        notices
            .iter()
            .any(|n| n.text.contains("read-only") && n.text.contains(other)),
        "{notices:?}"
    );
}

/// A local refusal settles like an executor's: `onError`, then `onFinally`
/// (a template clearing a "saving" flag there must not be left stuck).
#[test]
fn a_read_only_refusal_runs_on_error_and_on_finally() {
    let Some(r) = rig("e11-ro-lifecycle") else {
        return;
    };
    let spec = button(invoke(
        "record.update",
        json!(["CollectionBlock", r.id, { "title": "B" }]),
    ));
    let (mut s, wake) = session(&r, Access::ReadOnly, spec);
    click(&mut s);
    wait_for(
        &mut s,
        &wake,
        "kind=read-only fin=1",
        Duration::from_secs(5),
    );
    assert!(text(&mut s).contains("ok=false"), "{}", text(&mut s));
    assert_eq!(r.title().as_deref(), Some("A"));
}

#[test]
fn a_planner_error_runs_on_error_and_on_finally() {
    let Some(r) = rig("e11-plan-lifecycle") else {
        return;
    };
    let spec = button(invoke(
        "record.update",
        json!(["CollectionBlock", r.id, { "title": "B" }, { "dataset": "datasetStore.rootDataset" }]),
    ));
    let (mut s, wake) = session(&r, Access::write(r.uuid.as_str()), spec);
    click(&mut s);
    wait_for(&mut s, &wake, "kind=plan fin=1", Duration::from_secs(5));
    let t = text(&mut s);
    assert!(t.contains("msg=writes to another dataset"), "{t}");
    assert!(t.contains("ok=false"), "{t}");
    assert_eq!(r.title().as_deref(), Some("A"));
    assert_eq!(host(&s).notices().list().len(), 1);
}

/// Two deletes in one dispatch: as TS's `requestDestructive`, the second
/// question answers "no" to the first — which settles (`onError` with
/// `kind: cancelled`, then `onFinally`) — and is the one on screen.
#[test]
fn a_second_confirmation_cancels_the_first() {
    let Some(r) = rig("e11-two-deletes") else {
        return;
    };
    let one = invoke("record.delete", json!(["CollectionBlock", r.id]));
    let spec = button(json!([one.clone(), one]));
    let (mut s, wake) = session(&r, Access::write(r.uuid.as_str()), spec);
    click(&mut s);
    wait_for(
        &mut s,
        &wake,
        "kind=cancelled fin=1",
        Duration::from_secs(5),
    );
    assert!(
        host(&s).pending_confirm().is_some(),
        "the second question is open"
    );
    assert!(r.title().is_some(), "nothing removed yet");
    s.host_mut_as::<WriteHost>().unwrap().answer_confirm(true);
    wait_for(&mut s, &wake, "ok=true", Duration::from_secs(5));
    wait_for(&mut s, &wake, "fin=2", Duration::from_secs(5));
    assert!(r.title().is_none(), "the second delete ran");
}
