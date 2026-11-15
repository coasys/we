//! E3c-2: the inbox, the waker and the honest `poll -> Tick`.
//!
//! A `Tick` says whether anything changed (`dirty`) and how much arrived;
//! the waker is the frontend's "call `poll`" hook — egui repaints, a TUI
//! event send, a counter here. Arrivals land from any thread: completions
//! through `Completer`, binding invalidations through the `StoreBag`'s
//! subscribed invalidator.
use std::cell::RefCell;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{Session, Tick};
use we_template::{
    ActionRequest, AppSpec, BundleTemplate, Completer, DataRevision, Host, Invoked, MountCx,
    NodeId, ResolvedChild, ResolvedNode, RootSpec, SchemaNode, StoreBag, ORPHANED_CAP,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

fn session(v: serde_json::Value) -> Session {
    Session::offline(
        RootSpec::Single {
            node: Box::new(schema(v)),
            cx: MountCx::explicit("test"),
        },
        Arc::new(StoreBag::new()),
        screen(),
    )
}

/// A `Waker` that counts — the test's "the frontend was told" signal.
fn counting_waker() -> (we_template::Waker, Arc<AtomicUsize>) {
    let wakes = Arc::new(AtomicUsize::new(0));
    let w = wakes.clone();
    (
        Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }),
        wakes,
    )
}

fn count(wakes: &Arc<AtomicUsize>) -> usize {
    wakes.load(Ordering::SeqCst)
}

/// Answers `Pending` for every `$invoke` and keeps the completers — the
/// test settles them by hand, from whatever thread it likes.
struct PendingHost {
    completers: Rc<RefCell<Vec<Completer>>>,
}

impl Host for PendingHost {
    fn act(&mut self, _request: ActionRequest, done: Completer) -> Invoked {
        self.completers.borrow_mut().push(done);
        Invoked::Pending
    }
}

/// `onTap` invokes; `onSuccess` appends `result` to `local.log` — the
/// observable proof a completion's lifecycle ran.
fn invoke_node() -> serde_json::Value {
    json!({
        "type": "Column",
        "$localState": { "log": { "type": "string", "initial": "" } },
        "props": { "onTap": { "$invoke": "storeX.call", "args": [],
            "onSuccess": [{ "$setLocal": "log", "value": { "$": "local.log + result" } }] } },
        "children": []
    })
}

fn pending(v: serde_json::Value) -> (Session, Rc<RefCell<Vec<Completer>>>) {
    let completers = Rc::new(RefCell::new(Vec::new()));
    let host = PendingHost {
        completers: completers.clone(),
    };
    let s = Session::new(
        RootSpec::Single {
            node: Box::new(schema(v)),
            cx: MountCx::explicit("test"),
        },
        Arc::new(StoreBag::new()),
        screen(),
        Box::new(host),
    );
    (s, completers)
}

fn completer(completers: &Rc<RefCell<Vec<Completer>>>, i: usize) -> Completer {
    completers.borrow()[i].clone()
}

fn local(s: &Session, node: &NodeId, field: &str) -> String {
    s.runtime.locals().get(node, field).js_string()
}

fn prop(node: &ResolvedNode, name: &str) -> String {
    node.props
        .get(name)
        .map(|v| v.js_string())
        .unwrap_or_default()
}

fn find_ty<'a>(node: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if node.ty.as_ref() == ty {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_ty(n, ty),
        ResolvedChild::Text(_) => None,
    })
}

/// A namespace value the way a snapshot builds it — `set_root` wants the
/// real `MapNamespace` shape, not a plain `Obj`.
fn store_value(members: serde_json::Value) -> Value {
    StoreBag::from_snapshot(&json!({ "stores": { "s": members }, "queries": {}, "invokes": {} }))
        .unwrap()
        .root("s")
        .unwrap()
}

/// A `we-text` reading `profileStore.displayName` — the binding the
/// re-entrancy tests watch.
fn profile_spec() -> RootSpec {
    RootSpec::Single {
        node: Box::new(schema(json!({
            "type": "we-text",
            "props": { "text": { "$": "profileStore.displayName" } }
        }))),
        cx: MountCx::explicit("test"),
    }
}

fn profile_bag() -> Arc<StoreBag> {
    Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": { "profileStore": { "displayName": "before" } },
            "queries": {}, "invokes": {}
        }))
        .unwrap(),
    )
}

/// A completion that lands from another thread wakes the waker — once for
/// the whole batch that arrived before a drain — and the next `poll`
/// applies it.
#[test]
fn completion_from_another_thread_wakes() {
    let (mut s, completers) = pending(invoke_node());
    let (waker, wakes) = counting_waker();
    s.set_waker(waker);
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    s.dispatch(&root.id, "onTap", Value::Null);
    let (a, b) = (completer(&completers, 0), completer(&completers, 1));

    std::thread::spawn(move || {
        a.complete(Ok(Value::from("a")));
        b.complete(Ok(Value::from("b")));
    })
    .join()
    .unwrap();

    assert_eq!(
        count(&wakes),
        1,
        "two completions in one batch wake the waker exactly once"
    );
    let tick = s.poll();
    assert!(tick.dirty, "the pending lifecycle moves the revision");
    assert_eq!(tick.completions, 2, "both arrived and were applied");
    s.resolve();
    assert_eq!(
        local(&s, &root.id, "log"),
        "ab",
        "the next poll applied them, in arrival order"
    );
    assert_eq!(s.poll(), Tick::default(), "settled — quiet");
}

/// A poll with nothing to do answers an idle tick and never wakes.
#[test]
fn poll_quiet_tick_is_clean() {
    let mut s = session(json!({ "type": "Column", "children": [] }));
    let (waker, wakes) = counting_waker();
    s.set_waker(waker);
    s.resolve();
    assert_eq!(
        s.poll(),
        Tick::default(),
        "nothing pending, nothing moved — idle"
    );
    assert_eq!(count(&wakes), 0, "a quiet resolve and poll do not wake");
}

/// A dispatch writing a local makes the next `poll` dirty — the old
/// `usize` poll returned `0` and lied about it.
#[test]
fn poll_dirty_after_local_write() {
    let mut s = session(json!({
        "type": "we-button",
        "$localState": { "clicks": { "type": "number", "initial": 0 } },
        "props": {
            "label": { "$": "local.clicks" },
            "onClick": [{ "$setLocal": "clicks", "value": { "$": "local.clicks + 1" } }]
        }
    }));
    let root = s.resolve();
    s.dispatch(&root.id, "onClick", Value::Undefined);
    let tick = s.poll();
    assert!(tick.dirty, "the local write moved the revision");
    assert_eq!(
        tick.completions, 0,
        "nothing arrived — the write was direct"
    );
    let root = s.resolve();
    assert_eq!(prop(&root, "label"), "1");
    assert_eq!(s.poll(), Tick::default(), "settled — quiet");
}

/// A screen verb applied by a dispatch bumps the screen revision — dirty
/// without an arrival (`screen_ops` counts resolve-queued ops only).
#[test]
fn poll_dirty_after_screen_op() {
    let mut s = session(json!({
        "type": "we-button",
        "props": { "onClick": [{ "$invoke": "routeStore.navigate", "args": ["/elsewhere"] }] }
    }));
    let root = s.resolve();
    s.dispatch(&root.id, "onClick", Value::Undefined);
    let tick = s.poll();
    assert!(tick.dirty, "the navigate moved the screen revision");
    assert_eq!(
        tick.screen_ops, 0,
        "it applied inside dispatch, not via poll"
    );
    assert_eq!(s.screen.nav.current_path(), "/elsewhere");
    s.resolve();
    assert_eq!(s.poll(), Tick::default());
}

/// An op a resolve queued (a route redirect) is applied by `poll` and
/// counted — the revision moves with it.
#[test]
fn poll_counts_a_queued_screen_op() {
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "routes": [
            { "path": "/app",
              "children": [ { "type": "$routes" } ],
              "routes": [
                  { "path": "*", "redirect": "/gone" },
                  { "path": "/gone", "children": [ { "type": "GoneLeaf" } ] }
              ] }
        ],
        "children": [{ "type": "$routes" }]
    }))
    .unwrap();
    let spec = RootSpec::App(Box::new(AppSpec {
        bundle: "test".into(),
        app: None,
        template: Some(tmpl),
        pages: vec![],
        boot: None,
    }));
    let mut s = Session::offline(
        spec,
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/space/demo/app/bogus"),
    );
    // A raw frame queues the redirect op — the session has not polled yet.
    {
        let Session {
            runtime,
            host,
            screen,
        } = &mut s;
        runtime.frame(host.as_mut(), screen);
    }
    let tick = s.poll();
    assert_eq!(tick.screen_ops, 1, "poll applied the queued redirect");
    assert!(tick.dirty, "the navigate moved the screen revision");
    assert!(
        s.screen.nav.current_path().ends_with("/gone"),
        "the redirect landed — {:?}",
        s.screen.nav.current_path()
    );
    let root = s.resolve();
    assert!(find_ty(&root, "GoneLeaf").is_some());
    assert_eq!(s.poll(), Tick::default());
}

/// A `StoreBag` write bumps the data revision and wakes; a binding read
/// through the session resolves the new value — not only the counters
/// (Lal: "binding revision/wake coverage, not merely StoreBag counters").
#[test]
fn poll_dirty_after_set_root() {
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": { "profileStore": { "displayName": "before" } },
            "queries": {}, "invokes": {}
        }))
        .unwrap(),
    );
    let mut s = Session::offline(
        RootSpec::Single {
            node: Box::new(schema(json!({
                "type": "we-text",
                "props": { "text": { "$": "profileStore.displayName" } }
            }))),
            cx: MountCx::explicit("test"),
        },
        bag.clone(),
        screen(),
    );
    let (waker, wakes) = counting_waker();
    s.set_waker(waker);
    let rev = bag.revision();
    let root = s.resolve();
    assert_eq!(prop(&root, "text"), "before");

    bag.set_root(
        "profileStore",
        store_value(json!({ "displayName": "after" })),
    );
    assert!(bag.revision() > rev, "the write bumped the data revision");
    assert_eq!(count(&wakes), 1, "the write woke the frontend");

    let tick = s.poll();
    assert!(tick.dirty, "the revision is ahead of the recorded one");
    assert_eq!(tick.binding_changes, 1, "one invalidation arrived");
    let root = s.resolve();
    assert_eq!(
        prop(&root, "text"),
        "after",
        "the binding read through the session sees the new revision"
    );
    assert_eq!(s.poll(), Tick::default());
}

/// A completion arriving while the frontend is awake still reports the
/// same tick: one completion, dirty.
#[test]
fn poll_dirty_after_completion() {
    let (mut s, completers) = pending(invoke_node());
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    completer(&completers, 0).complete(Ok(Value::from("v")));
    let tick = s.poll();
    assert!(tick.dirty);
    assert_eq!(tick.completions, 1);
    s.resolve();
    assert_eq!(local(&s, &root.id, "log"), "v");
    assert_eq!(s.poll(), Tick::default());
}

/// F2: no input at all — a `set_root` on another thread must wake a
/// sleeping frontend; the next resolve shows the new value.
#[test]
fn set_root_from_another_thread_wakes_a_sleeping_frontend() {
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": { "profileStore": { "displayName": "before" } },
            "queries": {}, "invokes": {}
        }))
        .unwrap(),
    );
    let mut s = Session::offline(
        RootSpec::Single {
            node: Box::new(schema(json!({
                "type": "we-text",
                "props": { "text": { "$": "profileStore.displayName" } }
            }))),
            cx: MountCx::explicit("test"),
        },
        bag.clone(),
        screen(),
    );
    let (waker, wakes) = counting_waker();
    s.set_waker(waker);
    let root = s.resolve();
    assert_eq!(prop(&root, "text"), "before");
    assert_eq!(count(&wakes), 0);

    let writer = bag.clone();
    std::thread::spawn(move || {
        writer.set_root(
            "profileStore",
            store_value(json!({ "displayName": "after" })),
        );
    })
    .join()
    .unwrap();

    assert_eq!(
        count(&wakes),
        1,
        "a sleeping frontend is woken by the invalidation"
    );
    let tick = s.poll();
    assert!(tick.dirty, "the data revision is ahead of the recorded one");
    let root = s.resolve();
    assert_eq!(prop(&root, "text"), "after");
    assert_eq!(s.poll(), Tick::default());
}

/// F2: a write that lands inside the resolve itself — a host function the
/// resolve called — still shows up as dirty on the next `poll`, because
/// the resolve records the data revision it read *before* its first pass.
#[test]
fn set_root_during_resolve_is_seen_next_poll() {
    let bag = Arc::new(StoreBag::new());
    let fired = Arc::new(AtomicBool::new(false));
    {
        let writer = bag.clone();
        let fired = fired.clone();
        bag.set_function(
            "poke",
            Arc::new(move |_| {
                if !fired.swap(true, Ordering::SeqCst) {
                    writer.set_root("probe", Value::from("late-write"));
                }
                Value::Null
            }),
        );
    }
    let mut s = Session::offline(
        RootSpec::Single {
            node: Box::new(schema(json!({
                "type": "Column",
                "children": [
                    { "type": "we-text", "props": { "text": { "$": "poke()" } } },
                    { "type": "ProbeText", "props": { "text": { "$": "probe" } } }
                ]
            }))),
            cx: MountCx::explicit("test"),
        },
        bag,
        screen(),
    );
    s.resolve();
    let tick = s.poll();
    assert!(
        tick.dirty,
        "the source's revision ran ahead of the one the resolve recorded"
    );
    let root = s.resolve();
    assert_eq!(
        prop(find_ty(&root, "ProbeText").unwrap(), "text"),
        "late-write",
        "the second resolve sees what the first one's write changed"
    );
    assert_eq!(s.poll(), Tick::default(), "then it goes quiet");
}

/// F2: readiness is part of the revision — a store flip with no input
/// wakes, and the next resolve mounts the app instead of the boot screen.
#[test]
fn ready_flip_replaces_boot_mount() {
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "children": [{ "type": "AppBody" }]
    }))
    .unwrap();
    let spec = RootSpec::App(Box::new(AppSpec {
        bundle: "test".into(),
        app: None,
        template: Some(tmpl),
        pages: vec![],
        boot: Some(schema(json!({ "type": "BootScreen" }))),
    }));
    // sessionStore exists but names no ready marker → the boot screen mounts.
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": { "sessionStore": {} }, "queries": {}, "invokes": {}
        }))
        .unwrap(),
    );
    let mut s = Session::offline(
        spec,
        bag.clone(),
        ScreenState::desktop(ScreenSchema::default(), "/space/demo"),
    );
    let (waker, wakes) = counting_waker();
    s.set_waker(waker);
    let root = s.resolve();
    assert!(find_ty(&root, "BootScreen").is_some(), "boot is mounted");
    assert!(find_ty(&root, "AppBody").is_none());

    bag.set_root(
        "sessionStore",
        store_value(json!({ "signInStep": "ready" })),
    );
    assert_eq!(count(&wakes), 1, "the readiness flip woke the frontend");
    assert!(s.poll().dirty, "the data revision moved");

    let root = s.resolve();
    assert!(
        find_ty(&root, "AppBody").is_some(),
        "the app mounts instead of the boot screen"
    );
    assert!(find_ty(&root, "BootScreen").is_none());
    assert_eq!(s.poll(), Tick::default());
}

/// A waker that pushes once more — nothing is lost and nothing loops:
/// the push lands in the queue that was already scheduled, so the next
/// `poll` sees both arrivals and the wake count stays one.
#[test]
fn arrival_during_wake_is_kept() {
    let (mut s, completers) = pending(invoke_node());
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    s.dispatch(&root.id, "onTap", Value::Null);
    let (a, b) = (completer(&completers, 0), completer(&completers, 1));
    let once = AtomicBool::new(false);
    let wakes = Arc::new(AtomicUsize::new(0));
    {
        let wakes = wakes.clone();
        s.set_waker(Arc::new(move || {
            wakes.fetch_add(1, Ordering::SeqCst);
            if !once.swap(true, Ordering::SeqCst) {
                b.clone().complete(Ok(Value::from("b")));
            }
        }));
    }
    a.complete(Ok(Value::from("a")));
    assert_eq!(count(&wakes), 1, "the re-entrant push did not re-wake");
    let tick = s.poll();
    assert_eq!(tick.completions, 2, "nothing was lost — both arrived");
    s.resolve();
    assert_eq!(local(&s, &root.id, "log"), "ab");
    // The waker captured `b`, which owns this inbox's Arc — drop the hook
    // so the test does not leave the reference cycle behind (Lal, (a)).
    s.set_waker(Arc::new(|| {}));
}

/// Lal P2-1: invalidation must not hold the subscriber lock while the
/// waker runs — a waker that writes back to the same bag used to
/// deadlock on it. Two sessions subscribe to one bag; one's waker makes
/// a one-shot `set_root`. The outer write runs on a worker thread with a
/// timeout, so a regression fails here instead of hanging the suite.
#[test]
fn a_waker_can_set_root_on_the_same_bag() {
    let bag = profile_bag();
    let mut s1 = Session::offline(profile_spec(), bag.clone(), screen());
    let mut s2 = Session::offline(profile_spec(), bag.clone(), screen());
    let once = AtomicBool::new(false);
    let wakes = Arc::new(AtomicUsize::new(0));
    {
        let wakes = wakes.clone();
        let writer = bag.clone();
        s1.set_waker(Arc::new(move || {
            wakes.fetch_add(1, Ordering::SeqCst);
            if !once.swap(true, Ordering::SeqCst) {
                writer.set_root(
                    "profileStore",
                    store_value(json!({ "displayName": "from-the-waker" })),
                );
            }
        }));
    }
    s1.resolve();
    s2.resolve();

    let writer = bag.clone();
    let (done_tx, done_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        writer.set_root(
            "profileStore",
            store_value(json!({ "displayName": "outer" })),
        );
        let _ = done_tx.send(());
    });
    done_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the write deadlocked — the waker ran under the subscriber lock");
    worker.join().unwrap();

    assert_eq!(
        count(&wakes),
        1,
        "the batch woke once; the nested write rode the same queue"
    );
    let (t1, t2) = (s1.poll(), s2.poll());
    assert!(t1.dirty && t2.dirty);
    assert_eq!(
        t1.binding_changes, 2,
        "the outer and the nested invalidations both arrived"
    );
    assert_eq!(
        t2.binding_changes, 2,
        "the second subscriber heard both writes"
    );
    let root = s1.resolve();
    assert_eq!(
        prop(&root, "text"),
        "from-the-waker",
        "the waker's write ran inside the outer one — and landed last"
    );
}

/// Lal P2-1, second half: a waker that panics must not poison the
/// subscriber lock — the next write still notifies, and a session that
/// subscribes after the panic still registers.
#[test]
fn a_panicking_waker_does_not_poison_later_writes() {
    let bag = profile_bag();
    let mut s1 = Session::offline(profile_spec(), bag.clone(), screen());
    let blows_up = Arc::new(AtomicBool::new(true));
    let wakes = Arc::new(AtomicUsize::new(0));
    {
        let wakes = wakes.clone();
        let blows_up = blows_up.clone();
        s1.set_waker(Arc::new(move || {
            if blows_up.swap(false, Ordering::SeqCst) {
                panic!("the frontend hook blew up");
            }
            wakes.fetch_add(1, Ordering::SeqCst);
        }));
    }
    s1.resolve();

    let writer = bag.clone();
    let panicked = catch_unwind(AssertUnwindSafe(|| {
        writer.set_root("profileStore", store_value(json!({ "displayName": "one" })));
    }));
    assert!(panicked.is_err(), "the waker's panic reaches the writer");
    // The arrival landed before the panic — drain it so the next
    // write's wake is an empty→non-empty call again.
    let tick = s1.poll();
    assert!(tick.dirty);
    assert_eq!(tick.binding_changes, 1);

    let mut s2 = Session::offline(profile_spec(), bag.clone(), screen());
    let (waker2, wakes2) = counting_waker();
    s2.set_waker(waker2);
    s2.resolve();
    bag.set_root("profileStore", store_value(json!({ "displayName": "two" })));
    assert_eq!(count(&wakes), 1, "the write after the panic still notified");
    assert_eq!(
        count(&wakes2),
        1,
        "the post-panic subscriber registered and heard it"
    );
}

/// Lal P2-2: an arrival that landed before the frontend installed its
/// hook already spent the batch's one wake on the default no-op.
/// Installing the hook on a non-empty queue must wake again, or an
/// event-driven frontend sleeps while work sits queued.
#[test]
fn set_waker_after_an_arrival_still_wakes() {
    let (mut s, completers) = pending(invoke_node());
    let root = s.resolve();
    s.dispatch(&root.id, "onTap", Value::Null);
    completer(&completers, 0).complete(Ok(Value::from("v")));
    // …the empty→non-empty wake went to the default no-op hook.
    let (waker, wakes) = counting_waker();
    s.set_waker(waker);
    assert_eq!(
        count(&wakes),
        1,
        "installing the hook schedules the queued batch"
    );
    let tick = s.poll();
    assert_eq!(tick.completions, 1, "the next poll applies what was queued");
    s.resolve();
    assert_eq!(local(&s, &root.id, "log"), "v");
}

/// The per-frame budget: nine dependent queries need nine fill rounds,
/// the frame runs out at eight — it reports dirty and wakes rather than
/// spinning or stalling; the next frame finishes and a third poll is
/// quiet.
#[test]
fn exhausted_budget_wakes_and_reports_dirty() {
    let mut queries = serde_json::Map::new();
    let mut rows = serde_json::Map::new();
    for k in 1..=9usize {
        let name = format!("q{k}");
        queries.insert(
            name.clone(),
            if k == 1 {
                json!({ "entity": "E", "tag": name })
            } else {
                json!({ "entity": "E", "tag": name, "mark": { "$": format!("local.q{}", k - 1) } })
            },
        );
        rows.insert(name, json!([{ "row": k }]));
    }
    let bag = Arc::new(
        StoreBag::from_snapshot(&json!({
            "stores": {}, "queries": rows, "invokes": {}
        }))
        .unwrap(),
    );
    let mut s = Session::offline(
        RootSpec::Single {
            node: Box::new(schema(json!({
                "type": "Column",
                "$queries": queries,
                "props": { "done": { "$": "local.q9Loaded" } },
                "children": []
            }))),
            cx: MountCx::explicit("test"),
        },
        bag,
        screen(),
    );
    let (waker, wakes) = counting_waker();
    s.set_waker(waker);

    let root = s.resolve();
    assert_eq!(
        count(&wakes),
        1,
        "the exhausted budget woke the frontend instead of stalling"
    );
    assert_eq!(prop(&root, "done"), "false", "q9 is still loading");
    assert!(
        s.poll().dirty,
        "the bumped pool revision still reports dirty"
    );

    let root = s.resolve();
    assert_eq!(
        prop(&root, "done"),
        "true",
        "the next frame finished the chain"
    );
    assert_eq!(s.poll(), Tick::default(), "settled — quiet");
    assert_eq!(count(&wakes), 1, "no further wakes — it settled");
}

/// Pending calls whose node left the tree are remembered so their late
/// completions count as dropped — but a host that drops completers must
/// not grow that memory without bound: the set caps at `ORPHANED_CAP`
/// and evicts the oldest, whose late completion then counts as ignored.
#[test]
fn orphaned_calls_stay_bounded() {
    let (mut s, completers) = pending(json!({
        "type": "Column",
        "$localState": {
            "show": { "type": "boolean", "initial": true }
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
                    "props": { "onTap": { "$invoke": "storeX.call" } }
                }
            }
        }]
    }));
    let cycles = ORPHANED_CAP + 3;
    for _ in 0..cycles {
        let root = s.resolve();
        let button = find_ty(&root, "we-button")
            .expect("button mounted")
            .id
            .clone();
        s.dispatch(&button, "onTap", Value::Null); // pending call #n
        s.dispatch(&root.id, "onHide", Value::Null);
        s.resolve(); // unmounted → the call is orphaned
        s.dispatch(&root.id, "onShow", Value::Null);
    }
    assert_eq!(completers.borrow().len(), cycles);

    for i in 0..cycles {
        completer(&completers, i).complete(Ok(Value::Null));
    }
    s.poll();
    assert_eq!(
        s.stats().completions_dropped,
        ORPHANED_CAP as u64,
        "the set holds the most recent {ORPHANED_CAP}"
    );
    assert_eq!(
        s.stats().completions_ignored,
        3,
        "the oldest three were evicted — bounded, not grown"
    );
}

/// Lal P3: eviction must be by call age — `pending.retain` discovers a
/// frame's dead calls in map order, so a node's `ORPHANED_CAP + 3`
/// pending calls unmounted in ONE frame must still evict exactly the
/// three oldest mints, not whichever three ids retain visited first.
#[test]
fn orphaned_calls_evict_the_oldest_first() {
    let invokes: Vec<serde_json::Value> = (0..ORPHANED_CAP + 3)
        .map(|_| json!({ "$invoke": "storeX.call" }))
        .collect();
    let (mut s, completers) = pending(json!({
        "type": "Column",
        "$localState": {
            "show": { "type": "boolean", "initial": true }
        },
        "props": { "onHide": { "$setLocal": "show", "value": false } },
        "children": [{
            "type": "$if",
            "props": {
                "condition": { "$": "local.show" },
                "then": {
                    "type": "we-button",
                    "props": { "onTap": invokes }
                }
            }
        }]
    }));
    let root = s.resolve();
    let button = find_ty(&root, "we-button")
        .expect("button mounted")
        .id
        .clone();
    s.dispatch(&button, "onTap", Value::Null); // ORPHANED_CAP+3 calls at once
    assert_eq!(completers.borrow().len(), ORPHANED_CAP + 3);
    s.dispatch(&root.id, "onHide", Value::Null);
    s.resolve(); // one frame — every call orphans in the same retain pass

    // Completers are in mint order: the three oldest are the evictions.
    for i in 0..3 {
        completer(&completers, i).complete(Ok(Value::Null));
        s.poll();
        assert_eq!(
            s.stats().completions_ignored,
            (i + 1) as u64,
            "call #{i} — an oldest mint — was the one evicted"
        );
    }
    // The newest survived the cap — dropped, not ignored.
    for i in ORPHANED_CAP..ORPHANED_CAP + 3 {
        completer(&completers, i).complete(Ok(Value::Null));
        s.poll();
        assert_eq!(
            s.stats().completions_dropped,
            (i - ORPHANED_CAP + 1) as u64,
            "call #{i} — a newest mint — stayed remembered"
        );
    }
    for i in 3..ORPHANED_CAP {
        completer(&completers, i).complete(Ok(Value::Null));
    }
    s.poll();
    assert_eq!(s.stats().completions_dropped, ORPHANED_CAP as u64);
    assert_eq!(s.stats().completions_ignored, 3);
}
