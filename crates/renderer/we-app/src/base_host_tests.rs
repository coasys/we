//! The production [`BaseHost`](super::BaseHost), with a counted job sink.
//! A trusted choose on the base screen starts one job. Every other path
//! starts none.

use std::sync::{Arc, Mutex};

use we_ad4m::connect::ConnectSettings;
use we_expr::{BundleSlot, Provenance, Tier, Value};
use we_screen::{ScreenSchema, ScreenState};
use we_session::{BaseController, ConnectionRow, HostJob, Session, BUILTIN_BUNDLE};
use we_template::{
    Action, ActionRequest, AppSpec, BundleTemplate, Completer, Declared, Host, Invoked, LocalState,
    NodeId, PartDef, PartSource, ResolvedChild, ResolvedNode, RootSpec, Runtime, SchemaNode,
    StoreBag,
};

struct Open {
    session: Session,
    controller: Arc<BaseController>,
    jobs: Arc<Mutex<Vec<HostJob>>>,
}

fn screen_at(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
}

fn node(value: serde_json::Value) -> SchemaNode {
    serde_json::from_value(value).unwrap()
}

fn choose_of(id: &str) -> serde_json::Value {
    serde_json::json!({ "$invoke": "baseStore.choose", "args": [id] })
}

fn button(label: &str, invoke: serde_json::Value) -> SchemaNode {
    node(serde_json::json!({
        "type": "we-button",
        "children": [label],
        "props": { "onClick": invoke }
    }))
}

fn base_button(label: &str) -> RootSpec {
    RootSpec::base(button(label, choose_of("this-device")), BUILTIN_BUNDLE)
}

fn open_with(spec: RootSpec, href: &str) -> Open {
    let controller = BaseController::with_this_computer();
    let jobs = Arc::new(Mutex::new(Vec::new()));
    let host = super::BaseHost::counting(controller.clone(), jobs.clone());
    let mut session = Session::new(
        spec,
        Arc::new(StoreBag::new()),
        screen_at(href),
        Box::new(host),
    );
    session.set_bindings(controller.bindings());
    session.set_base_facts(Some(controller.facts()));
    Open {
        session,
        controller,
        jobs,
    }
}

fn open(spec: RootSpec) -> Open {
    open_with(spec, "/")
}

fn job_count(jobs: &Mutex<Vec<HostJob>>) -> usize {
    jobs.lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .len()
}

fn text_of(node: &ResolvedNode) -> String {
    fn walk(node: &ResolvedNode, out: &mut String) {
        for child in &node.children {
            match child {
                ResolvedChild::Text(text) => out.push_str(text),
                ResolvedChild::Node(next) => walk(next, out),
            }
        }
    }
    let mut out = String::new();
    walk(node, &mut out);
    out
}

fn find_button(node: &ResolvedNode, needle: &str) -> NodeId {
    fn walk(node: &ResolvedNode, needle: &str) -> Option<NodeId> {
        if node.ty.as_ref() == "we-button" && text_of(node).contains(needle) {
            return Some(node.id.clone());
        }
        for child in &node.children {
            if let ResolvedChild::Node(next) = child {
                if let Some(id) = walk(next, needle) {
                    return Some(id);
                }
            }
        }
        None
    }
    walk(node, needle).unwrap_or_else(|| panic!("no button whose text contains {needle}"))
}

fn find_handler(node: &ResolvedNode, name: &str) -> NodeId {
    fn walk(node: &ResolvedNode, name: &str) -> Option<NodeId> {
        if node.handlers.contains_key(name) {
            return Some(node.id.clone());
        }
        for child in &node.children {
            if let ResolvedChild::Node(next) = child {
                if let Some(id) = walk(next, name) {
                    return Some(id);
                }
            }
        }
        None
    }
    walk(node, name).unwrap_or_else(|| panic!("no node with handler {name}"))
}

fn click(open: &mut Open, label: &str) {
    let root = open.session.resolve();
    let id = find_button(&root, label);
    open.session.dispatch(&id, "onClick", Value::Undefined);
}

fn assert_idle(open: &Open) {
    assert_eq!(job_count(&open.jobs), 0);
    assert_eq!(open.controller.public_json()["stage"], "connect");
    assert_eq!(open.controller.public_json()["busy"], false);
}

#[test]
fn a_trusted_choose_starts_one_job() {
    let mut open = open(base_button("This computer"));
    click(&mut open, "This computer");
    let jobs = open
        .jobs
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    assert_eq!(jobs.len(), 1);
    assert!(jobs[0].chosen);
    assert_eq!(open.controller.public_json()["stage"], "handing-off");
}

#[test]
fn a_space_mount_choose_starts_nothing() {
    let mut open = open(RootSpec::single(
        button("This computer", choose_of("this-device")),
        "space",
    ));
    click(&mut open, "This computer");
    assert_idle(&open);
    assert!(open.session.runtime().gate().denial_count() >= 1);
}

#[test]
fn an_app_slot_choose_starts_nothing() {
    let app: BundleTemplate = serde_json::from_value(serde_json::json!({
        "id": "shell",
        "meta": { "role": "app" },
        "type": "we-button",
        "children": ["This computer"],
        "props": { "onClick": { "$invoke": "baseStore.choose", "args": ["this-device"] } }
    }))
    .unwrap();
    let spec = RootSpec::App(Box::new(AppSpec {
        bundle: BUILTIN_BUNDLE.into(),
        app: Some(app),
        template: None,
        pages: Vec::new(),
        boot: None,
    }));
    let mut open = open(spec);
    click(&mut open, "This computer");
    assert_idle(&open);
    assert!(open.session.runtime().gate().denial_count() >= 1);
}

#[test]
fn a_different_bundle_choose_starts_nothing() {
    let mut open = open(RootSpec::base(
        button("This computer", choose_of("this-device")),
        "other-bundle",
    ));
    click(&mut open, "This computer");
    assert_idle(&open);
    assert!(open.session.runtime().gate().denial_count() >= 1);
}

#[test]
fn a_refused_call_starts_nothing() {
    let cases = [
        serde_json::json!({ "$invoke": "baseStore.notAMethod" }),
        serde_json::json!({ "$invoke": "baseStore.choose", "args": ["nope"] }),
        serde_json::json!({ "$invoke": "baseStore.choose", "args": ["this-device", "extra"] }),
        serde_json::json!({ "$invoke": "baseStore.submitPassword", "args": ["secret"] }),
    ];
    for invoke in cases {
        let mut open = open(RootSpec::base(button("Go", invoke), BUILTIN_BUNDLE));
        click(&mut open, "Go");
        assert_idle(&open);
        assert!(open.session.runtime().gate().denial_count() >= 1);
    }
}

#[test]
fn an_identity_call_starts_nothing() {
    let invoke = serde_json::json!({ "$invoke": "baseStore.startNow" });
    let mut open = open(RootSpec::base(button("Go", invoke), BUILTIN_BUNDLE));
    click(&mut open, "Go");
    assert_idle(&open);
    assert_eq!(open.session.runtime().gate().denial_count(), 0);
}

#[test]
fn a_busy_choose_starts_nothing() {
    let mut open = open(base_button("This computer"));
    let mut facts = open.controller.facts();
    facts.busy = true;
    open.session.set_base_facts(Some(facts));
    click(&mut open, "This computer");
    assert_idle(&open);
    assert!(open.session.runtime().gate().denial_count() >= 1);
}

#[test]
fn two_chooses_start_one_job() {
    let spec = RootSpec::base(
        node(serde_json::json!({
            "type": "we-button",
            "children": ["This computer"],
            "props": {
                "onClick": [
                    { "$invoke": "baseStore.choose", "args": ["this-device"] },
                    { "$invoke": "baseStore.choose", "args": ["this-device"] }
                ]
            }
        })),
        BUILTIN_BUNDLE,
    );
    let mut open = open(spec);
    click(&mut open, "This computer");
    assert_eq!(job_count(&open.jobs), 1);
    assert_eq!(open.controller.generation(), 2);
}

#[test]
fn a_part_choose_starts_nothing() {
    struct Parts;
    impl PartSource for Parts {
        fn part(&self, id: &str) -> Option<PartDef> {
            (id == "chooser").then(|| PartDef {
                schema: Arc::new(button("Part choose", choose_of("this-device"))),
                tier: Tier::App,
                module: "mod".into(),
                needs: Arc::from([]),
            })
        }
    }
    let root = node(serde_json::json!({
        "type": "Column",
        "children": [{ "type": "$part", "props": { "id": "chooser" } }]
    }));
    let mut open = open_parts(root, Arc::new(Parts));
    click(&mut open, "Part choose");
    assert_idle(&open);
    assert!(open.session.runtime().gate().denial_count() >= 1);
}

#[test]
fn a_panel_choose_starts_nothing() {
    let template: BundleTemplate = serde_json::from_value(serde_json::json!({
        "id": "space",
        "meta": {
            "panels": [{
                "id": "side",
                "home": "side",
                "node": {
                    "type": "we-button",
                    "children": ["Panel choose"],
                    "props": { "onClick": { "$invoke": "baseStore.choose", "args": ["this-device"] } }
                }
            }]
        },
        "type": "Column",
        "children": [{ "type": "$panels", "props": { "lane": "side" } }]
    }))
    .unwrap();
    let spec = RootSpec::App(Box::new(AppSpec {
        bundle: "space-app".into(),
        app: None,
        template: Some(template),
        pages: Vec::new(),
        boot: None,
    }));
    let mut open = open_with(spec, "/space/demo");
    click(&mut open, "Panel choose");
    assert_idle(&open);
    assert!(open.session.runtime().gate().denial_count() >= 1);
}

/// The gate issued this permit. The mount it names is not the base screen.
#[test]
fn a_permit_for_another_mount_starts_nothing() {
    let spec = RootSpec::Single {
        node: Box::new(button("This computer", choose_of("this-device"))),
        cx: we_template::MountCx {
            mount: "not-the-live-mount".into(),
            tier: Tier::App,
            space: None,
            provenance: Provenance::Bundle {
                bundle: BUILTIN_BUNDLE.into(),
                slot: BundleSlot::Base,
            },
        },
        declared: Declared::default(),
    };
    let mut open = open(spec);
    click(&mut open, "This computer");
    assert_eq!(
        job_count(&open.jobs),
        0,
        "a permit for another mount started a job"
    );
    assert_eq!(open.controller.public_json()["stage"], "connect");
}

struct Hold {
    inner: super::BaseHost,
    pending: Option<Completer>,
}

impl Host for Hold {
    fn act(&mut self, request: ActionRequest, done: Completer) -> Invoked {
        let Action::Invoke { target, .. } = &request.action;
        if target.as_ref() == "probe.wait" {
            self.pending = Some(done);
            return Invoked::Pending;
        }
        self.inner.act(request, done)
    }
}

fn open_hold(spec: RootSpec) -> Open {
    let controller = BaseController::with_this_computer();
    let jobs = Arc::new(Mutex::new(Vec::new()));
    let host = Hold {
        inner: super::BaseHost::counting(controller.clone(), jobs.clone()),
        pending: None,
    };
    let mut session = Session::new(
        spec,
        Arc::new(StoreBag::new()),
        screen_at("/"),
        Box::new(host),
    );
    session.set_bindings(controller.bindings());
    session.set_base_facts(Some(controller.facts()));
    Open {
        session,
        controller,
        jobs,
    }
}

fn open_parts(root: SchemaNode, parts: Arc<dyn PartSource>) -> Open {
    let controller = BaseController::with_this_computer();
    let jobs = Arc::new(Mutex::new(Vec::new()));
    let host = super::BaseHost::counting(controller.clone(), jobs.clone());
    let runtime = Runtime::from_spec(
        RootSpec::base(root, BUILTIN_BUNDLE),
        Arc::new(StoreBag::new()),
        LocalState::new(),
    )
    .with_sources(None, parts);
    let mut session = Session::from_parts(runtime, Box::new(host), screen_at("/"));
    session.set_bindings(controller.bindings());
    session.set_base_facts(Some(controller.facts()));
    Open {
        session,
        controller,
        jobs,
    }
}

fn open_hold_parts(root: SchemaNode, parts: Arc<dyn PartSource>) -> Open {
    let controller = BaseController::with_this_computer();
    let jobs = Arc::new(Mutex::new(Vec::new()));
    let host = Hold {
        inner: super::BaseHost::counting(controller.clone(), jobs.clone()),
        pending: None,
    };
    let runtime = Runtime::from_spec(
        RootSpec::base(root, BUILTIN_BUNDLE),
        Arc::new(StoreBag::new()),
        LocalState::new(),
    )
    .with_sources(None, parts);
    let mut session = Session::from_parts(runtime, Box::new(host), screen_at("/"));
    session.set_bindings(controller.bindings());
    session.set_base_facts(Some(controller.facts()));
    Open {
        session,
        controller,
        jobs,
    }
}

fn finish_pending(open: &mut Open) {
    let pending = open
        .session
        .host_mut_as::<Hold>()
        .expect("the hold host")
        .pending
        .take()
        .expect("a call is waiting");
    pending.complete(Ok(Value::Undefined));
    open.session.poll();
}

#[test]
fn a_callback_from_a_part_starts_nothing() {
    struct Parts;
    impl PartSource for Parts {
        fn part(&self, id: &str) -> Option<PartDef> {
            (id == "chooser").then(|| PartDef {
                schema: Arc::new(node(serde_json::json!({
                    "type": "we-button",
                    "children": ["Wait"],
                    "props": {
                        "onClick": {
                            "$invoke": "probe.wait",
                            "args": [],
                            "onSuccess": [{ "$invoke": "baseStore.choose", "args": ["this-device"] }]
                        }
                    }
                }))),
                tier: Tier::App,
                module: "mod".into(),
                needs: Arc::from([]),
            })
        }
    }
    let root = node(serde_json::json!({
        "type": "Column",
        "children": [{ "type": "$part", "props": { "id": "chooser" } }]
    }));
    let mut open = open_hold_parts(root, Arc::new(Parts));
    click(&mut open, "Wait");
    finish_pending(&mut open);
    assert_idle(&open);
}

#[test]
fn an_unmounted_callback_starts_nothing() {
    let spec = RootSpec::base(
        node(serde_json::json!({
            "type": "Column",
            "$localState": { "show": { "type": "boolean", "initial": true } },
            "props": { "onHide": { "$setLocal": "show", "value": false } },
            "children": [{
                "type": "$if",
                "props": {
                    "condition": { "$": "local.show" },
                    "then": {
                        "type": "we-button",
                        "children": ["Wait"],
                        "props": {
                            "onClick": {
                                "$invoke": "probe.wait",
                                "args": [],
                                "onSuccess": [{ "$invoke": "baseStore.choose", "args": ["this-device"] }]
                            }
                        }
                    }
                }
            }]
        })),
        BUILTIN_BUNDLE,
    );
    let mut open = open_hold(spec);
    click(&mut open, "Wait");
    let root = open.session.resolve();
    let hide = find_handler(&root, "onHide");
    open.session.dispatch(&hide, "onHide", Value::Undefined);
    let root = open.session.resolve();
    assert!(
        !text_of(&root).contains("Wait"),
        "the button is still mounted"
    );
    finish_pending(&mut open);
    assert_idle(&open);
}

/// The base screen with this computer and one kept server, and a host that
/// records what each dial would use.
struct Choice {
    open: Open,
    dials: Arc<Mutex<Vec<ConnectSettings>>>,
}

const LAB: &str = "server:lab.example:12000";

fn open_choice(spec: RootSpec, settings: ConnectSettings) -> Choice {
    let controller = BaseController::new(
        BUILTIN_BUNDLE,
        vec![
            ConnectionRow::this_computer(),
            ConnectionRow::server("lab.example:12000", Some("Lab box")),
        ],
    );
    let jobs = Arc::new(Mutex::new(Vec::new()));
    let dials = Arc::new(Mutex::new(Vec::new()));
    let host =
        super::BaseHost::counting_dials(controller.clone(), jobs.clone(), dials.clone(), settings);
    let mut session = Session::new(
        spec,
        Arc::new(StoreBag::new()),
        screen_at("/"),
        Box::new(host),
    );
    session.set_bindings(controller.bindings());
    session.set_base_facts(Some(controller.facts()));
    Choice {
        open: Open {
            session,
            controller,
            jobs,
        },
        dials,
    }
}

fn dials_of(choice: &Choice) -> Vec<ConnectSettings> {
    choice
        .dials
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
}

fn isolated(url: Option<&str>) -> (tempfile::TempDir, ConnectSettings) {
    let dir = tempfile::tempdir().unwrap();
    let settings = ConnectSettings {
        url: url.map(str::to_string),
        token_dir: Some(dir.path().join("tokens")),
        port_file: Some(dir.path().join("no-port-file")),
        ..ConnectSettings::default()
    };
    (dir, settings)
}

/// Acceptance: a server selection that is unsupported explains the
/// refusal, and nothing is dialed — not localhost under the server label,
/// and not the server with this computer's tokens.
#[test]
fn a_server_choice_refuses_and_dials_nothing() {
    let (_dir, settings) = isolated(None);
    let spec = RootSpec::base(button("Lab box", choose_of(LAB)), BUILTIN_BUNDLE);
    let mut choice = open_choice(spec, settings);
    click(&mut choice.open, "Lab box");
    assert!(dials_of(&choice).is_empty(), "a server choice dialed");
    let snap = choice.open.controller.public_json();
    assert_eq!(snap["stage"], "connect", "{snap}");
    assert_eq!(snap["busy"], false);
    assert_eq!(snap["chosen"], LAB);
    assert_eq!(
        snap["error"],
        "Can't open Lab box from this app yet. Choose This computer."
    );
}

/// Acceptance: selection never sends this computer's credentials to
/// another host. With a remote `--executor-url`, a click on This computer
/// still dials loopback.
#[test]
fn this_computer_dials_loopback_with_a_remote_url() {
    let (_dir, settings) = isolated(Some("https://remote.example:9443"));
    let mut choice = open_choice(base_button("This computer"), settings.clone());
    click(&mut choice.open, "This computer");
    let dials = dials_of(&choice);
    assert_eq!(dials.len(), 1);
    let url = dials[0].url.as_deref().unwrap_or_default();
    assert_eq!(url, "http://127.0.0.1:12000", "This computer dialed {url}");
    assert_eq!(dials[0].token_dir, settings.token_dir);
}

/// Acceptance: an unknown id is rejected at the production host. The gate
/// issues no permit for an id the catalog does not list.
#[test]
fn a_forged_unknown_id_starts_nothing() {
    let (_dir, settings) = isolated(None);
    let spec = RootSpec::base(
        button("Evil", choose_of("server:evil.example:1")),
        BUILTIN_BUNDLE,
    );
    let mut choice = open_choice(spec, settings);
    click(&mut choice.open, "Evil");
    assert_idle(&choice.open);
    assert!(dials_of(&choice).is_empty());
    assert_eq!(choice.open.controller.public_json()["chosen"], "");
    assert!(choice.open.session.runtime().gate().denial_count() >= 1);
}

// Slice 3: what a flow's typed failure does to the base store. The kind
// decides; the words are only shown.

fn failed(kind: we_ad4m::connect::FailureKind, reason: &str) -> we_ad4m::connect::ConnectPhase {
    we_ad4m::connect::ConnectPhase::Failed {
        kind,
        reason: reason.into(),
    }
}

fn attempt_in_flight(open: &mut Open) -> u64 {
    click(open, "This computer");
    open.session.set_base_facts(Some(open.controller.facts()));
    open.jobs.lock().unwrap().last().unwrap().attempt
}

/// Acceptance: an auth refusal goes to the choice with its reason, even
/// when its words read like a network error.
#[test]
fn a_typed_refusal_goes_to_the_choice_whatever_its_words() {
    use we_ad4m::connect::FailureKind;
    let mut open = open(base_button("This computer"));
    let attempt = attempt_in_flight(&mut open);
    let reason = "connection refused: this agent does not know the app";
    super::apply_phase(
        &open.controller,
        attempt,
        failed(FailureKind::Refused, reason),
        None,
    );
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "connect", "a refusal was shown as offline");
    assert_eq!(snap["error"], reason);
    assert_eq!(snap["offlineReason"], "");
}

/// Acceptance: no answer is the offline stage, even when the words say
/// "refused".
#[test]
fn a_typed_unreachable_goes_offline_whatever_its_words() {
    use we_ad4m::connect::FailureKind;
    let mut open = open(base_button("This computer"));
    let attempt = attempt_in_flight(&mut open);
    super::apply_phase(
        &open.controller,
        attempt,
        failed(FailureKind::Unreachable, "the executor refused the socket"),
        None,
    );
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "offline");
    assert_eq!(snap["offlineReason"], we_session::UNREACHABLE);
    assert_eq!(snap["error"], "");
}

/// Something that is not an executor answered: the choice, with the
/// reason. Not offline: waiting for a network would not change it.
#[test]
fn not_an_executor_goes_to_the_choice() {
    use we_ad4m::connect::FailureKind;
    let mut open = open(base_button("This computer"));
    let attempt = attempt_in_flight(&mut open);
    let reason = "No AD4M executor found: something at 127.0.0.1:9 is not one.";
    super::apply_phase(
        &open.controller,
        attempt,
        failed(FailureKind::NotAnExecutor, reason),
        None,
    );
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["error"], reason);
}

/// Acceptance: the executor stops under an open session. The flow kept
/// after the hand-off reports it, and the base takes the window back to the
/// offline stage.
#[test]
fn a_session_that_loses_its_executor_goes_offline() {
    use we_ad4m::connect::FailureKind;
    let mut open = open(base_button("This computer"));
    let attempt = attempt_in_flight(&mut open);
    open.controller.note_connected(attempt);
    super::apply_phase(
        &open.controller,
        attempt,
        failed(FailureKind::Unreachable, "the executor went away"),
        None,
    );
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "offline");
    assert_eq!(snap["offlineReason"], we_session::UNREACHABLE);
}

/// Acceptance: an old attempt's failure does not replace a newer attempt
/// or its session. Passed before slice 3 for the attempt (attempt ids);
/// the session half is new.
#[test]
fn an_old_attempt_failure_does_not_replace_a_newer_choice() {
    use we_ad4m::connect::FailureKind;
    let mut open = open(base_button("This computer"));
    let old = attempt_in_flight(&mut open);
    open.controller.note_connected(old);
    let newer = open.controller.start_reconnect();
    for kind in [FailureKind::Unreachable, FailureKind::Refused] {
        super::apply_phase(&open.controller, old, failed(kind, "late"), None);
        assert_eq!(open.controller.public_json()["stage"], "handing-off");
    }
    open.controller.note_connected(newer.attempt);
    for kind in [FailureKind::Unreachable, FailureKind::Refused] {
        super::apply_phase(&open.controller, old, failed(kind, "late"), None);
        assert_eq!(
            open.controller.public_json()["stage"],
            "session",
            "{kind:?} from the old session closed the new one"
        );
    }
}

/// Lal (slice 2, finding 1): a choose does not wait on the base file. The
/// file is a FIFO nobody writes, so reading it blocks: the choose still
/// returns and the controller still answers. Once the file can be read,
/// the choices land in the order they were made: the newest is kept.
#[cfg(unix)]
#[test]
fn a_choose_does_not_wait_for_the_base_file() {
    use std::io::Write;
    use std::time::Duration;
    use we_session::{BaseCommand, ChoiceMemory};

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("base.json");
    let memory = Arc::new(super::FileMemory(path.clone()));
    let controller = BaseController::with_memory(
        BUILTIN_BUNDLE,
        vec![
            ConnectionRow::this_computer(),
            ConnectionRow::server("lab.example:12000", Some("Lab box")),
        ],
        memory.clone(),
    );
    let made = std::process::Command::new("mkfifo")
        .arg(&path)
        .status()
        .unwrap();
    assert!(made.success());

    let (done, returned) = std::sync::mpsc::channel();
    let clicked = controller.clone();
    let generation = controller.generation();
    std::thread::spawn(move || {
        let job = clicked.apply(BaseCommand::Choose("this-device".into()), generation);
        let _ = done.send(job.is_some());
    });
    let returned = returned.recv_timeout(Duration::from_secs(2));
    let chosen = returned
        .is_ok()
        .then(|| controller.public_json()["chosen"].clone());
    // Release the FIFO only once the writer reads it: a write-only open
    // waits for a reader, which then gets "{}" and its end of file. The
    // writer thread is shared with the other tests of this process and
    // can reach the file late; data put in a FIFO nobody has open is lost.
    let fifo = path.clone();
    std::thread::spawn(move || {
        let mut fifo = std::fs::OpenOptions::new()
            .write(true)
            .open(&fifo)
            .expect("open the base-file FIFO for its reader");
        fifo.write_all(b"{}").unwrap();
    });

    assert_eq!(returned, Ok(true), "the choose waited for the base file");
    assert_eq!(chosen, Some(serde_json::json!("this-device")));
    memory.remember(LAB);
    // A second start reads after this process's writes have landed.
    let (read, kept) = std::sync::mpsc::channel();
    let again = path.clone();
    std::thread::spawn(move || {
        let _ = read.send(super::FileMemory(again).remembered());
    });
    let kept = kept.recv_timeout(Duration::from_secs(10));
    assert_eq!(kept, Ok(Some(LAB.to_string())));
    assert!(std::fs::metadata(&path).unwrap().is_file());
}

/// Lal (slice 3, finding 1): an executor that takes the connection and
/// never answers its health check is offline, and "Try again" dials it
/// again. The phase comes from a real flow against a listener that
/// accepts and never answers.
#[test]
fn a_stalled_executor_is_offline_and_try_again_redials() {
    use we_ad4m::connect::{ConnectFlow, ConnectPhase};
    use we_session::BaseCommand;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    std::thread::spawn(move || {
        let mut held = Vec::new();
        for stream in listener.incoming() {
            let Ok(stream) = stream else { return };
            held.push(stream);
        }
    });
    let (_dir, settings) = isolated(Some(&url));
    let rt = we_ad4m::Runtime::new().unwrap();
    let flow = ConnectFlow::start(&rt.handle(), settings, || {});
    let start = std::time::Instant::now();
    let phase = loop {
        let phase = flow.phase();
        if matches!(phase, ConnectPhase::Failed { .. }) {
            break phase;
        }
        assert!(start.elapsed().as_secs() < 30, "the flow did not end");
        std::thread::sleep(std::time::Duration::from_millis(20));
    };

    let mut open = open(base_button("This computer"));
    let attempt = attempt_in_flight(&mut open);
    super::apply_phase(&open.controller, attempt, phase, None);
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "offline", "{snap}");
    assert_eq!(snap["offlineReason"], we_session::UNREACHABLE, "{snap}");

    let generation = open.controller.generation();
    let retry = open.controller.apply(BaseCommand::Retry, generation);
    assert!(retry.is_some(), "Try again started nothing");
}
