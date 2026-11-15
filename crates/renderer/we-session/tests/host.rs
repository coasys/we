//! E3c-1: the host is injected into the session, receives typed
//! `ActionRequest`s for legacy `$invoke` only, and answers `Done` or
//! `Pending`; a pending call settles through its `Completer`, and core runs
//! the lifecycle (`onSuccess`/`onError`/`onFinally`) on the next resolve.
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{
    Action, ActionRequest, Completer, Host, Invoked, MountCx, NodeId, ResolvedChild, ResolvedNode,
    RootSpec, SchemaNode, StaticHost, StoreBag,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn spec(v: serde_json::Value) -> RootSpec {
    RootSpec::Single {
        node: Box::new(schema(v)),
        cx: MountCx::explicit("test"),
    }
}

fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

/// What the test host saw, shared with the test after the host is boxed.
#[derive(Default)]
struct Log {
    requests: Vec<ActionRequest>,
    completers: Vec<Completer>,
}

/// Records every request; answers `Pending` (keeping the completer) or
/// `Done` — `Ok(null)`, or `Err("sync")` when `fail` — while also keeping
/// the completer.
struct RecordingHost {
    log: Rc<RefCell<Log>>,
    pending: bool,
    fail: bool,
}

impl Host for RecordingHost {
    fn act(&mut self, request: ActionRequest, done: Completer) -> Invoked {
        let mut log = self.log.borrow_mut();
        log.requests.push(request);
        log.completers.push(done);
        if self.pending {
            Invoked::Pending
        } else if self.fail {
            Invoked::Done(Err(Value::Str("sync".into())))
        } else {
            Invoked::Done(Ok(Value::Null))
        }
    }
}

fn session(v: serde_json::Value, pending: bool) -> (Session, Rc<RefCell<Log>>) {
    session_answering(v, pending, false)
}

fn session_answering(
    v: serde_json::Value,
    pending: bool,
    fail: bool,
) -> (Session, Rc<RefCell<Log>>) {
    let log = Rc::new(RefCell::new(Log::default()));
    let host = RecordingHost {
        log: log.clone(),
        pending,
        fail,
    };
    let s = Session::new(spec(v), Arc::new(StoreBag::new()), screen(), Box::new(host));
    (s, log)
}

fn local(s: &Session, node: &NodeId, field: &str) -> String {
    s.runtime.locals().get(node, field).js_string()
}

fn completer(log: &Rc<RefCell<Log>>, i: usize) -> Completer {
    log.borrow().completers[i].clone()
}

/// The lifecycle fixture: `got`/`err` take `result`, `fin` and `log`
/// record that the chain ran.
fn lifecycle_node() -> serde_json::Value {
    json!({
        "type": "Column",
        "$localState": {
            "got": { "type": "string", "initial": "" },
            "err": { "type": "string", "initial": "" },
            "fin": { "type": "string", "initial": "" },
            "log": { "type": "string", "initial": "" }
        },
        "props": { "onTap": { "$invoke": "storeX.call", "args": [],
            "onSuccess": [
                { "$setLocal": "got", "value": { "$": "result" } },
                { "$setLocal": "log", "value": { "$": "local.log + result" } }
            ],
            "onError": [{ "$setLocal": "err", "value": { "$": "result" } }],
            "onFinally": [{ "$setLocal": "fin", "value": { "$": "local.fin + 'f'" } }] } },
        "children": [{ "type": "Row" }]
    })
}

#[test]
fn recording_host_gets_evaluated_invoke_args() {
    let (mut s, log) = session(
        json!({
            "type": "Column",
            "props": { "onTap": { "$invoke": "spaceStore.createPost",
                "args": [{ "$": "event.title" }, "literal", { "$": "1 + 2" }] } },
            "children": []
        }),
        false,
    );
    let root = s.resolve();
    s.dispatch(
        &root.id,
        "onTap",
        Value::from_json(&json!({ "title": "hello" })),
    );
    let log = log.borrow();
    assert_eq!(log.requests.len(), 1, "one action reached the host");
    let req = &log.requests[0];
    assert_eq!(req.origin.node, root.id, "origin is the handler's node");
    assert_eq!(req.origin.mount.as_str(), "test", "origin names the mount");
    let Action::Invoke { target, args } = &req.action;
    assert_eq!(target.as_ref(), "spaceStore.createPost");
    let args: Vec<String> = args.iter().map(Value::js_string).collect();
    assert_eq!(args, ["hello", "literal", "3"]);
}

#[test]
fn pending_success_runs_on_success_with_result() {
    let (mut s, log) = session(lifecycle_node(), true);
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    assert_eq!(
        local(&s, &root.id, "got"),
        "",
        "nothing runs before settling"
    );
    completer(&log, 0).complete(Ok(Value::Str("v".into())));
    s.resolve();
    assert_eq!(local(&s, &root.id, "got"), "v");
    assert_eq!(local(&s, &root.id, "err"), "", "onError must not run");
}

#[test]
fn pending_error_runs_on_error() {
    let (mut s, log) = session(lifecycle_node(), true);
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    completer(&log, 0).complete(Err(Value::Str("boom".into())));
    s.resolve();
    assert_eq!(local(&s, &root.id, "err"), "boom");
    assert_eq!(local(&s, &root.id, "got"), "", "onSuccess must not run");
}

#[test]
fn finally_runs_after_either() {
    // onSuccess and onError both write `last`; onFinally appends what it
    // reads there, so it sees the selected callback's write only if it
    // runs after it (`invoke.ts`: `.finally` follows `.then`/`.catch`).
    let (mut s, log) = session(
        json!({
            "type": "Column",
            "$localState": {
                "last": { "type": "string", "initial": "" },
                "fin": { "type": "string", "initial": "" },
                "seen": { "type": "string", "initial": "" }
            },
            "props": { "onTap": { "$invoke": "storeX.call", "args": [],
                "onSuccess": [{ "$setLocal": "last", "value": { "$": "result" } }],
                "onError": [{ "$setLocal": "last", "value": { "$": "result" } }],
                "onFinally": [
                    { "$setLocal": "fin", "value": { "$": "local.fin + 'f'" } },
                    { "$setLocal": "seen", "value": { "$": "local.seen + local.last" } }
                ] } },
            "children": []
        }),
        true,
    );
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    s.dispatch(&root.id, "onTap", Value::Null);
    completer(&log, 0).complete(Ok(Value::Str("v".into())));
    completer(&log, 1).complete(Err(Value::Str("boom".into())));
    s.resolve();
    assert_eq!(local(&s, &root.id, "fin"), "ff", "onFinally after both");
    assert_eq!(
        local(&s, &root.id, "seen"),
        "vboom",
        "each onFinally read the value its onSuccess / onError wrote"
    );
}

#[test]
fn out_of_order_completions() {
    let (mut s, log) = session(lifecycle_node(), true);
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    s.dispatch(&root.id, "onTap", Value::Null);
    let (a, b) = (completer(&log, 0), completer(&log, 1));
    assert_ne!(a.call_id(), b.call_id(), "core mints one id per call");
    b.complete(Ok(Value::Str("b".into())));
    s.resolve();
    assert_eq!(
        local(&s, &root.id, "log"),
        "b",
        "the second call settles first"
    );
    a.complete(Ok(Value::Str("a".into())));
    s.resolve();
    assert_eq!(local(&s, &root.id, "log"), "ba");
}

#[test]
fn completions_in_one_drain_run_in_arrival_order() {
    let (mut s, log) = session(lifecycle_node(), true);
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    s.dispatch(&root.id, "onTap", Value::Null);
    let (a, b) = (completer(&log, 0), completer(&log, 1));
    b.complete(Ok(Value::Str("b".into())));
    a.complete(Ok(Value::Str("a".into())));
    s.resolve();
    assert_eq!(
        local(&s, &root.id, "log"),
        "ba",
        "both settle in one drain, in the order they arrived"
    );
}

#[test]
fn double_complete_is_ignored() {
    let (mut s, log) = session(lifecycle_node(), true);
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    let c = completer(&log, 0);
    c.clone().complete(Ok(Value::Str("a".into())));
    c.complete(Ok(Value::Str("a".into())));
    s.resolve();
    assert_eq!(local(&s, &root.id, "log"), "a", "callbacks ran once");
    assert_eq!(local(&s, &root.id, "fin"), "f");
    assert_eq!(s.stats().completions_ignored, 1, "the second is counted");
}

#[test]
fn done_then_late_completer_is_ignored() {
    let (mut s, log) = session(lifecycle_node(), false);
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    completer(&log, 0).complete(Ok(Value::Str("late".into())));
    s.resolve();
    assert_eq!(local(&s, &root.id, "got"), "", "Done counted, late ignored");
    assert_eq!(local(&s, &root.id, "fin"), "");
    assert_eq!(s.stats().completions_ignored, 1);
}

#[test]
fn invoke_done_runs_no_callbacks() {
    for fail in [false, true] {
        let (mut s, log) = session_answering(lifecycle_node(), false, fail);
        let root = s.resolve();
        s.dispatch(&root.id, "onTap", Value::Null);
        s.resolve();
        {
            let log = log.borrow();
            assert_eq!(log.requests.len(), 1, "the host received the call");
            let Action::Invoke { target, .. } = &log.requests[0].action;
            assert_eq!(target.as_ref(), "storeX.call");
            assert_eq!(log.requests[0].origin.node, root.id);
        }
        let what = if fail { "Done(Err)" } else { "Done(Ok)" };
        assert_eq!(local(&s, &root.id, "got"), "", "{what}: no onSuccess");
        assert_eq!(local(&s, &root.id, "err"), "", "{what}: no onError");
        assert_eq!(
            local(&s, &root.id, "fin"),
            "",
            "{what}: a sync answer has no lifecycle"
        );
    }
}

fn first_child(n: &ResolvedNode) -> Option<&ResolvedNode> {
    n.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => Some(n.as_ref()),
        ResolvedChild::Text(_) => None,
    })
}

#[test]
fn completion_after_unmount_runs_nothing() {
    let (mut s, log) = session(
        json!({
            "type": "Column",
            "$localState": {
                "show": { "type": "boolean", "initial": true },
                "got": { "type": "string", "initial": "" }
            },
            "props": { "onHide": { "$setLocal": "show", "value": false } },
            "children": [{
                "type": "$if",
                "props": {
                    "condition": { "$": "local.show" },
                    "then": {
                        "type": "we-button",
                        "props": { "onTap": { "$invoke": "storeX.call",
                            "onSuccess": [{ "$setLocal": "got", "value": { "$": "result" } }] } }
                    }
                }
            }]
        }),
        true,
    );
    let root = s.resolve();
    let button = first_child(&root)
        .expect("the button is mounted")
        .id
        .clone();
    s.dispatch(&button, "onTap", Value::Null);
    s.dispatch(&root.id, "onHide", Value::Null);
    let root = s.resolve();
    assert!(first_child(&root).is_none(), "the button left the tree");
    completer(&log, 0).complete(Ok(Value::Str("v".into())));
    s.resolve();
    assert_eq!(
        local(&s, &root.id, "got"),
        "",
        "an unmounted call runs nothing"
    );
    assert_eq!(s.stats().completions_dropped, 1, "but it is counted");
}

#[test]
fn host_never_sees_local_writes() {
    let (mut s, log) = session(
        json!({
            "type": "Column",
            "$localState": {
                "x": { "type": "string", "initial": "" },
                "flag": { "type": "boolean", "initial": false }
            },
            "props": { "onTap": [
                { "$setLocal": "x", "value": "1" },
                { "$toggleLocal": "flag" },
                { "$invoke": "storeX.call", "args": [{ "$": "local.x" }] }
            ] },
            "children": []
        }),
        false,
    );
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    assert_eq!(
        local(&s, &root.id, "flag"),
        "true",
        "the toggle wrote the local, in core"
    );
    let log = log.borrow();
    assert_eq!(log.requests.len(), 1, "only the invoke reached the host");
    let Action::Invoke { target, args } = &log.requests[0].action;
    assert_eq!(target.as_ref(), "storeX.call");
    assert_eq!(
        args[0].js_string(),
        "1",
        "the local was visible to the next token"
    );
}

#[test]
fn offline_static_host_answers_from_invokes_table() {
    let bag = StoreBag::from_snapshot(&json!({
        "stores": {}, "queries": {},
        "invokes": { "storeX.call": { "$pending": true } }
    }))
    .unwrap();
    let mut s = Session::offline(spec(lifecycle_node()), Arc::new(bag), screen());
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    let parked = s
        .host_mut_as::<StaticHost>()
        .expect("offline runs the StaticHost")
        .parked
        .remove(0);
    parked.complete(Ok(Value::Str("v".into())));
    s.resolve();
    assert_eq!(local(&s, &root.id, "got"), "v");
}

/// Review P2: an unmount permanently invalidates the calls its nodes made,
/// even when the same structural id is mounted again before the old
/// completion arrives. A call made by the remounted node still settles.
#[test]
fn completion_after_unmount_and_same_id_remount_runs_nothing() {
    let (mut s, log) = session(
        json!({
            "type": "Column",
            "$localState": {
                "show": { "type": "boolean", "initial": true },
                "got": { "type": "string", "initial": "" },
                "fin": { "type": "string", "initial": "" }
            },
            "props": {
                "onHide": { "$setLocal": "show", "value": false },
                "onShow": { "$setLocal": "show", "value": true }
            },
            "children": [{
                "type": "$if",
                "props": {
                    "condition": { "$": "local.show" },
                    "then": {
                        "type": "we-button",
                        "props": { "onTap": { "$invoke": "storeX.call",
                            "onSuccess": [{ "$setLocal": "got", "value": { "$": "local.got + result" } }],
                            "onFinally": [{ "$setLocal": "fin", "value": { "$": "local.fin + 'f'" } }] } }
                    }
                }
            }]
        }),
        true,
    );
    let root = s.resolve();
    let button = first_child(&root)
        .expect("the button is mounted")
        .id
        .clone();
    s.dispatch(&button, "onTap", Value::Null);
    s.dispatch(&root.id, "onHide", Value::Null);
    let root = s.resolve();
    assert!(first_child(&root).is_none(), "the button left the tree");
    s.dispatch(&root.id, "onShow", Value::Null);
    let root = s.resolve();
    let remounted = first_child(&root).expect("the button is back").id.clone();
    assert_eq!(remounted, button, "the remount reuses the structural id");

    completer(&log, 0).complete(Ok(Value::Str("old".into())));
    s.resolve();
    assert_eq!(
        local(&s, &root.id, "got"),
        "",
        "the old call's onSuccess must not run on the remounted node"
    );
    assert_eq!(local(&s, &root.id, "fin"), "", "nor its onFinally");
    assert_eq!(s.stats().completions_dropped, 1, "it is counted as dropped");
    assert_eq!(s.stats().completions, 0);

    s.dispatch(&remounted, "onTap", Value::Null);
    assert_eq!(
        log.borrow().requests.len(),
        2,
        "the new call reached the host"
    );
    completer(&log, 1).complete(Ok(Value::Str("new".into())));
    s.resolve();
    assert_eq!(
        local(&s, &root.id, "got"),
        "new",
        "a call made after the remount still settles"
    );
    assert_eq!(local(&s, &root.id, "fin"), "f");
    assert_eq!(s.stats().completions, 1);
}
