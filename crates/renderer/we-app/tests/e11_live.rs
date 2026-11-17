//! E11 acceptance for the app (`EXECUTOR_PATH`; skipped without it): the
//! Coasys app on a live space edits and deletes a record from the
//! inspector, and the change goes through the validated write RPC and
//! comes back through the live query. A write the executor refuses shows
//! its message; a read-only window refuses locally.
//!
//! The record is a `TaskBlock`, not a call (the brief's choice): the
//! bundle's `recordStore.displays.CollectionBlock` lists no editable field,
//! so the inspector offers no Edit button on a call. See NOTES-e11.md.
#[path = "support/find.rs"]
mod find;

use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use find::{find, prop_str, text_of};
use serde_json::json;
use we_ad4m::testkit as kit;
use we_ad4m::{Access, SpaceRow};
use we_app::live::{live_space_app, DataMode, LiveSpace, SHARED_WRITE_REFUSED};
use we_expr::Value;
use we_screen::ScreenOp;
use we_template::ResolvedNode;

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");

struct Rig {
    _executor: kit::Executor,
    rt: we_ad4m::Runtime,
    writer: we_ad4m::Connection,
    reader: we_ad4m::Connection,
    uuid: String,
    bundle: we_template::Bundle,
}

fn rig(name: &str) -> Option<Rig> {
    let executor = kit::start_executor()?;
    let rt = we_ad4m::Runtime::new().unwrap();
    let writer = kit::connect(&rt, &executor.url);
    let uuid = kit::seed_space(&rt, &writer, name);
    kit::add_class(&rt, &writer, &uuid, "TaskBlock", kit::TASK_SDNA);
    // The app's own socket, as `--connect` has.
    let reader = kit::connect(&rt, &executor.url);
    Some(Rig {
        _executor: executor,
        rt,
        writer,
        reader,
        uuid,
        bundle: we_template::Bundle::parse(BUNDLE).unwrap(),
    })
}

impl Rig {
    /// The app on the space, with the inspector open on `card`.
    fn open(&self, card: &str, access: Access) -> (LiveSpace, mpsc::Receiver<()>) {
        open_on(&self.bundle, &self.reader, &self.uuid, card, access)
    }

    fn tasks(&self) -> Vec<serde_json::Value> {
        kit::query_rows(&self.rt, &self.writer, &self.uuid, "TaskBlock")
    }

    fn title_of(&self, id: &str) -> Option<String> {
        self.tasks()
            .into_iter()
            .find(|r| r["id"] == json!(id))
            .map(|r| r["title"].as_str().unwrap_or_default().to_string())
    }
}

/// The app on `uuid` over `conn`, with the inspector open on `card`.
fn open_on(
    bundle: &we_template::Bundle,
    conn: &we_ad4m::Connection,
    uuid: &str,
    card: &str,
    access: Access,
) -> (LiveSpace, mpsc::Receiver<()>) {
    let space = SpaceRow {
        uuid: uuid.to_string(),
        name: "e11-app".into(),
        shared_url: None,
    };
    let (mut live, _) =
        live_space_app(bundle, conn, space, "dark", DataMode::Live, access).unwrap();
    let (tx, wake) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let waker: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
        let _ = tx.lock().unwrap().send(());
    });
    live.app.session.set_waker(waker.clone());
    if let Some(host) = live.app.session.host_mut_as::<we_ad4m::WriteHost>() {
        host.set_waker(waker);
    }
    for (name, value) in [("cardType", "TaskBlock"), ("card", card)] {
        live.app.session.apply_screen(ScreenOp::SetParam {
            name: name.into(),
            value: Some(value.into()),
            push: None,
        });
    }
    live.app.session.apply_screen(ScreenOp::OpenTemplatePanel {
        id: "inspector".into(),
    });
    (live, wake)
}

fn root(live: &mut LiveSpace) -> Arc<ResolvedNode> {
    live.app.session.poll();
    live.app.session.resolve()
}

/// The inspector part of the tree, for a failure message.
fn inspector_text(root: &ResolvedNode) -> String {
    let all = we_template::normal_form(root).to_string();
    match all.find("Inspector") {
        Some(at) => all[at..].chars().take(6000).collect(),
        None => all.chars().take(3000).collect(),
    }
}

/// Resolve on each wake until `pred` holds for the tree; how long it took.
fn wait_until(
    live: &mut LiveSpace,
    wake: &mpsc::Receiver<()>,
    what: &str,
    limit: Duration,
    pred: impl Fn(&ResolvedNode) -> bool,
) -> Duration {
    let start = Instant::now();
    loop {
        let r = root(live);
        if pred(&r) {
            return start.elapsed();
        }
        let left = limit.saturating_sub(start.elapsed());
        assert!(
            !left.is_zero(),
            "{what}: not after {limit:?}. The inspector: {}",
            inspector_text(&r)
        );
        let _ = wake.recv_timeout(left.min(Duration::from_millis(100)));
    }
}

/// Wait for the condition off the tree (the executor, a notice).
fn wait_for(what: &str, limit: Duration, mut ok: impl FnMut() -> bool) -> Duration {
    let start = Instant::now();
    while !ok() {
        assert!(start.elapsed() < limit, "{what}: not after {limit:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
    start.elapsed()
}

/// The tree's normal form, props included: in edit mode a title is an
/// input's `value`, not a text run.
fn tree_text(r: &ResolvedNode) -> String {
    we_template::normal_form(r).to_string()
}

fn tree_has(text: &str) -> impl Fn(&ResolvedNode) -> bool + '_ {
    move |r| tree_text(r).contains(text)
}

fn is_text_input(n: &ResolvedNode) -> bool {
    matches!(n.ty.as_ref(), "we-input" | "we-textarea") && n.handlers.contains_key("onChange")
}

/// The Edit button: the inspector's pencil, inside the tooltip that names
/// it (the button itself carries no label).
fn edit_button(r: &ResolvedNode) -> Option<we_template::NodeId> {
    let tip = find(r, |n| {
        n.ty.as_ref() == "we-tooltip" && prop_str(n, "content") == Some("Edit this record")
    })?;
    find(tip, |n| n.ty.as_ref() == "we-button").map(|b| b.id.clone())
}

fn labelled(r: &ResolvedNode, label: &str) -> Option<we_template::NodeId> {
    find(r, |n| prop_str(n, "label") == Some(label)).map(|n| n.id.clone())
}

fn dispatch(live: &mut LiveSpace, node: &we_template::NodeId, handler: &str, event: Value) {
    live.app.session.dispatch(node, handler, event);
}

fn detail(text: &str) -> Value {
    Value::from_json(&json!({ "detail": text }))
}

/// Open the inspector's edit mode; the edit controls are drawn.
fn start_editing(live: &mut LiveSpace, wake: &mpsc::Receiver<()>, title: &str) {
    wait_until(
        live,
        wake,
        "the card",
        Duration::from_secs(30),
        tree_has(title),
    );
    let r = root(live);
    let edit = edit_button(&r).unwrap_or_else(|| panic!("no Edit button: {}", inspector_text(&r)));
    dispatch(live, &edit, "onClick", Value::Null);
    wait_until(
        live,
        wake,
        "the edit controls",
        Duration::from_secs(5),
        |r| find(r, is_text_input).is_some(),
    );
}

#[test]
fn edit_and_delete_from_the_inspector() {
    let Some(r) = rig("e11-app") else { return };
    let id = kit::create_task(&r.rt, &r.writer, &r.uuid, "Task to edit");
    assert_eq!(
        kit::find_ids(
            &r.rt,
            &r.writer,
            &r.uuid,
            "TaskBlock",
            "title",
            "Task to edit"
        ),
        std::slice::from_ref(&id)
    );
    let (mut live, wake) = r.open(&id, Access::write(r.uuid.as_str()));
    start_editing(&mut live, &wake, "Task to edit");

    // Edit: the title control, as the inspector draws it.
    let rt = root(&mut live);
    let title = find(&rt, |n| {
        is_text_input(n) && prop_str(n, "value") == Some("Task to edit")
    })
    .unwrap_or_else(|| panic!("no title control: {}", inspector_text(&rt)))
    .id
    .clone();
    dispatch(&mut live, &title, "onChange", detail("Renamed task"));
    let start = Instant::now();
    let on_exec = wait_for(
        "the executor has the new title",
        Duration::from_secs(2),
        || r.title_of(&id).as_deref() == Some("Renamed task"),
    );
    let left = Duration::from_secs(2).saturating_sub(start.elapsed());
    let on_screen = start.elapsed()
        + wait_until(
            &mut live,
            &wake,
            "the new title on screen",
            left,
            tree_has("Renamed task"),
        );
    eprintln!("edit: on the executor in {on_exec:?}, on screen in {on_screen:?}");
    assert!(live.notices().is_empty(), "{:?}", live.notices());

    // Delete: the host asks first.
    let rt = root(&mut live);
    let delete = labelled(&rt, "Delete this record").expect("the Delete button");
    dispatch(&mut live, &delete, "onClick", Value::Null);
    let confirm = live
        .pending_confirm()
        .expect("the host asks before a delete");
    assert_eq!(confirm.title, "Delete this TaskBlock?");
    assert!(
        r.title_of(&id).is_some(),
        "nothing removed before the answer"
    );
    live.answer_confirm(true);
    assert!(live.pending_confirm().is_none());
    let start = Instant::now();
    let gone = wait_for("the executor removed it", Duration::from_secs(2), || {
        r.title_of(&id).is_none()
    });
    let left = Duration::from_secs(2).saturating_sub(start.elapsed());
    let off_screen = start.elapsed()
        + wait_until(
            &mut live,
            &wake,
            "the task gone from the screen",
            left,
            |t| !tree_text(t).contains("Renamed task"),
        );
    eprintln!("delete: gone from the executor in {gone:?}, from the screen in {off_screen:?}");
    assert!(live.notices().is_empty(), "{:?}", live.notices());
}

/// Ignored: on a fresh space the "New signal type" form cannot be reached.
/// The inspector draws it only inside `count(filter(local.signalTypes, {
/// retired: { not: true } }))` — with no signal type yet, that branch's
/// `else` ("No reactions here yet …") is drawn instead. The body below
/// seeds one signal type first, which the brief's test does not, so it
/// runs with `--ignored`. The create proof is
/// `we-ad4m/tests/e11_writes.rs` `create_signal_type_writes_one_signal_type`.
#[test]
#[ignore = "the New signal type form is unreachable on a fresh space (it needs one signal type already); see NOTES-e11.md"]
fn create_a_signal_type_from_the_inspector() {
    let Some(r) = rig("e11-signal") else { return };
    kit::add_class(
        &r.rt,
        &r.writer,
        &r.uuid,
        "SignalType",
        kit::SIGNAL_TYPE_SDNA,
    );
    // Not in the brief: one signal type, so the form can be reached.
    r.rt.block_on(r.writer.ws().call::<serde_json::Value>(
        "perspective.instanceCreate",
        json!({ "uuid": r.uuid, "className": "SignalType",
                "properties": { "name": "Like", "slug": "like", "mode": "toggle" } }),
    ))
    .unwrap();
    let id = kit::create_task(&r.rt, &r.writer, &r.uuid, "Task with signals");
    let (mut live, wake) = r.open(&id, Access::write(r.uuid.as_str()));
    wait_until(
        &mut live,
        &wake,
        "the card",
        Duration::from_secs(30),
        tree_has("Task with signals"),
    );

    // Not in the brief either: open the Signals section.
    let rt = root(&mut live);
    let section = labelled(&rt, "Show or hide signals").expect("the Signals section toggle");
    dispatch(&mut live, &section, "onClick", Value::Null);
    let rt = root(&mut live);
    let new = labelled(&rt, "New signal type")
        .unwrap_or_else(|| panic!("no New signal type: {}", inspector_text(&rt)));
    dispatch(&mut live, &new, "onClick", Value::Null);
    let placeholder = |n: &ResolvedNode| prop_str(n, "placeholder") == Some("e.g. Like");
    wait_until(&mut live, &wake, "the form", Duration::from_secs(5), |t| {
        find(t, placeholder).is_some()
    });
    let rt = root(&mut live);
    let name = find(&rt, placeholder).unwrap().id.clone();
    dispatch(&mut live, &name, "onInput", detail("Upvote"));
    let rt = root(&mut live);
    let create = find(&rt, |n| {
        n.ty.as_ref() == "we-button" && text_of(n).trim() == "Create"
    })
    .expect("the Create button")
    .id
    .clone();
    dispatch(&mut live, &create, "onClick", Value::Null);
    let rows = || kit::query_rows(&r.rt, &r.writer, &r.uuid, "SignalType");
    let took = wait_for(
        "the new signal type on the executor",
        Duration::from_secs(2),
        || rows().iter().any(|row| row["name"] == "Upvote"),
    );
    eprintln!("create: on the executor in {took:?}");
    let all = rows();
    let row = all.iter().find(|row| row["name"] == "Upvote").unwrap();
    assert_eq!(row["slug"], "upvote", "{row}");
    assert_eq!(row["mode"], "toggle", "{row}");
    assert_eq!(row["aggregate"], "count", "{row}");
    assert_eq!(row["rangeMin"], 0, "{row}");
    assert_eq!(row["rangeMax"], 1, "{row}");
    wait_until(
        &mut live,
        &wake,
        "the modal closed",
        Duration::from_secs(2),
        |t| find(t, placeholder).is_none(),
    );
}

#[test]
fn a_refused_write_shows_the_executors_message() {
    let Some(r) = rig("e11-refused") else { return };
    let id = kit::create_task(&r.rt, &r.writer, &r.uuid, "Task to keep");
    let (mut live, wake) = r.open(&id, Access::write(r.uuid.as_str()));
    start_editing(&mut live, &wake, "Task to keep");

    // The test class has no `description`; the inspector offers it, as a
    // control inside the form field labelled "Description".
    let rt = root(&mut live);
    let holder = find(&rt, |n| {
        n.ty.as_ref() == "we-form-field" && prop_str(n, "label") == Some("Description")
    })
    .unwrap_or_else(|| panic!("no Description field: {}", inspector_text(&rt)));
    let control = find(holder, is_text_input)
        .unwrap_or_else(|| panic!("no control in the Description field"))
        .id
        .clone();
    dispatch(&mut live, &control, "onChange", detail("x"));
    let took = wait_for("a notice", Duration::from_secs(5), || {
        !live.notices().is_empty()
    });
    eprintln!("refusal: the notice in {took:?}");
    let notices = live.notices();
    assert_eq!(notices.len(), 1, "{notices:?}");
    let text = &notices[0].text;
    assert!(text.starts_with("Could not save that change."), "{text}");
    assert!(
        text.contains("Validation failed for class 'TaskBlock'"),
        "{text}"
    );
    assert!(text.contains("description"), "{text}");
    assert!(tree_text(&root(&mut live)).contains("Task to keep"));
    assert_eq!(r.title_of(&id).as_deref(), Some("Task to keep"));

    // A read-only window on the same space refuses a delete locally.
    let (mut ro, wake) = r.open(&id, Access::ReadOnly);
    wait_until(
        &mut ro,
        &wake,
        "the card",
        Duration::from_secs(30),
        tree_has("Task to keep"),
    );
    let rt = root(&mut ro);
    let delete = labelled(&rt, "Delete this record").expect("the Delete button");
    dispatch(&mut ro, &delete, "onClick", Value::Null);
    assert!(
        ro.pending_confirm().is_none(),
        "a read-only window asks nothing"
    );
    let notices = ro.notices();
    assert!(
        notices.iter().any(|n| n.text.contains("read-only")),
        "{notices:?}"
    );
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(r.title_of(&id).as_deref(), Some("Task to keep"));
}

#[test]
fn a_shared_space_is_not_opened_for_writing() {
    let Some(r) = rig("e11-shared") else { return };
    let space = SpaceRow {
        uuid: r.uuid.clone(),
        name: "shared".into(),
        shared_url: Some("neighbourhood://e11".into()),
    };
    let err = live_space_app(
        &r.bundle,
        &r.reader,
        space.clone(),
        "dark",
        DataMode::Live,
        Access::write(r.uuid.as_str()),
    )
    .err()
    .expect("refused");
    assert_eq!(err, SHARED_WRITE_REFUSED);
    assert!(
        live_space_app(
            &r.bundle,
            &r.reader,
            space,
            "dark",
            DataMode::Live,
            Access::ReadOnly
        )
        .is_ok(),
        "read-only still opens it"
    );
}

/// The access `--connect --write --space <a>` gives the window.
fn granted(a: &str) -> Access {
    Access::write(a)
}

/// A window granted writes in `a` opens `b` (the picker's "Switch
/// space"): `b` is read-only, says so, and an edit there is refused
/// locally — nothing reaches the executor. `a` still writes.
fn switching_space_keeps_the_grant(
    bundle: &we_template::Bundle,
    rt: &we_ad4m::Runtime,
    seeder: &we_ad4m::Connection,
    window: &we_ad4m::Connection,
    a: &str,
    b: &str,
) {
    let in_b = kit::create_task(rt, seeder, b, "Task in B");
    let (mut live, wake) = open_on(bundle, window, b, &in_b, granted(a));
    assert_eq!(live.access, Access::ReadOnly, "B opens read-only");
    let label = live.access_label();
    assert!(!label.contains("writes"), "{label}");
    assert!(
        live.notices().iter().any(|n| n.text.contains(a)),
        "a notice names the space this window may change: {:?}",
        live.notices()
    );
    start_editing(&mut live, &wake, "Task in B");
    let rt_node = root(&mut live);
    let title = find(&rt_node, |n| {
        is_text_input(n) && prop_str(n, "value") == Some("Task in B")
    })
    .expect("the title control")
    .id
    .clone();
    dispatch(&mut live, &title, "onChange", detail("Changed in B"));
    std::thread::sleep(Duration::from_millis(500));
    let title_b = kit::query_rows(rt, seeder, b, "TaskBlock")
        .into_iter()
        .find(|r| r["id"] == json!(in_b))
        .map(|r| r["title"].clone());
    assert_eq!(title_b, Some(json!("Task in B")), "B unchanged");
    assert!(
        live.notices()
            .iter()
            .any(|n| n.text.contains("read-only") && n.text.contains(a)),
        "{:?}",
        live.notices()
    );

    // Back in A, the grant holds.
    let in_a = kit::create_task(rt, seeder, a, "Task in A");
    let (mut live, wake) = open_on(bundle, window, a, &in_a, granted(a));
    assert_eq!(live.access, granted(a));
    assert!(live.access_label().starts_with("writes:"));
    start_editing(&mut live, &wake, "Task in A");
    let rt_node = root(&mut live);
    let title = find(&rt_node, |n| {
        is_text_input(n) && prop_str(n, "value") == Some("Task in A")
    })
    .expect("the title control")
    .id
    .clone();
    dispatch(&mut live, &title, "onChange", detail("Changed in A"));
    wait_for("A renamed", Duration::from_secs(5), || {
        kit::query_rows(rt, seeder, a, "TaskBlock")
            .iter()
            .any(|r| r["id"] == json!(in_a) && r["title"] == "Changed in A")
    });
}

#[test]
fn switching_space_keeps_the_grant_operator() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let seeder = kit::connect(&rt, &executor.url);
    let a = kit::seed_space(&rt, &seeder, "e11-a");
    let b = kit::seed_space_as(&rt, &seeder, "e11-b");
    for s in [&a, &b] {
        kit::add_class(&rt, &seeder, s, "TaskBlock", kit::TASK_SDNA);
    }
    // No admin credential: the window's socket is the operator, with no
    // scoped token — only the window's own check keeps B read-only.
    let window = kit::connect(&rt, &executor.url);
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    switching_space_keeps_the_grant(&bundle, &rt, &seeder, &window, &a, &b);
}

#[test]
fn switching_space_keeps_the_grant_scoped_token() {
    let Some(executor) = kit::start_executor_with_admin("e11-admin") else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let admin = kit::connect_as(&rt, &executor.url, "e11-admin");
    rt.block_on(admin.client().agent.generate("passphrase".into()))
        .unwrap();
    let a = kit::seed_space_as(&rt, &admin, "e11-a");
    let b = kit::seed_space_as(&rt, &admin, "e11-b");
    for s in [&a, &b] {
        kit::add_class(&rt, &admin, s, "TaskBlock", kit::TASK_SDNA);
    }
    let app = we_ad4m::connect::app_info(&we_ad4m::connect::GrantScope::Write { space: a.clone() });
    let token = kit::mint_token(
        &rt,
        &executor.url,
        &admin,
        &app.name,
        serde_json::to_value(&app.capabilities).unwrap(),
    );
    let window = kit::connect_as(&rt, &executor.url, &token);
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    switching_space_keeps_the_grant(&bundle, &rt, &admin, &window, &a, &b);
}
