//! Slice 3: offline and hand-back. A session that loses its executor goes
//! back to the offline stage with "Try again"; a refused session goes back
//! to the list with the reason; a completion or a hand-back from an older
//! attempt does not replace a newer one; the network coming back retries
//! the place chosen. The pinned template is resolved through a session;
//! the host here applies permitted calls only.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{
    coasys_base_template, BaseCommand, BaseController, ConnectionRow, HostJob, NoMemory,
    OnlineProbe, Session, BUILTIN_BUNDLE, NO_NETWORK, UNREACHABLE,
};
use we_template::{
    Action, ActionRequest, Completer, Host, Invoked, NodeId, ResolvedChild, ResolvedNode, RootSpec,
    StoreBag,
};
struct ApplyHost {
    controller: Arc<BaseController>,
    jobs: Rc<RefCell<Vec<HostJob>>>,
}

impl Host for ApplyHost {
    fn act(&mut self, request: ActionRequest, _done: Completer) -> Invoked {
        let Action::Invoke { target, args } = &request.action;
        if let Some(permit) = &request.permit {
            if permit.matches(target, args) {
                if let Some(command) = we_session::command_for(target, args) {
                    if let Some(job) = self.controller.apply(command, permit.generation()) {
                        self.jobs.borrow_mut().push(job);
                    }
                }
            }
        }
        Invoked::Done(Ok(Value::Undefined))
    }
}

struct Open {
    session: Session,
    controller: Arc<BaseController>,
    jobs: Rc<RefCell<Vec<HostJob>>>,
}

impl Open {
    fn text(&mut self) -> String {
        self.session.set_base_facts(Some(self.controller.facts()));
        tree_text(&self.session.resolve())
    }

    fn click(&mut self, needle: &str) {
        self.session.set_base_facts(Some(self.controller.facts()));
        let root = self.session.resolve();
        let id = find_button(&root, needle);
        self.session.dispatch(&id, "onClick", Value::Undefined);
    }

    fn jobs(&self) -> Vec<HostJob> {
        self.jobs.borrow().clone()
    }
}

fn rows() -> Vec<ConnectionRow> {
    vec![
        ConnectionRow::this_computer(),
        ConnectionRow::server("lab.example:12000", Some("Lab box")),
    ]
}

fn start() -> Open {
    let controller = BaseController::with_memory(BUILTIN_BUNDLE, rows(), Arc::new(NoMemory));
    let jobs = Rc::new(RefCell::new(Vec::new()));
    let host = ApplyHost {
        controller: controller.clone(),
        jobs: jobs.clone(),
    };
    let mut session = Session::new(
        RootSpec::base(coasys_base_template(), BUILTIN_BUNDLE),
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
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

fn tree_text(node: &ResolvedNode) -> String {
    fn walk(node: &ResolvedNode, out: &mut String) {
        for child in &node.children {
            match child {
                ResolvedChild::Text(text) => {
                    out.push_str(text);
                    out.push('\n');
                }
                ResolvedChild::Node(next) => walk(next, out),
            }
        }
    }
    let mut out = String::new();
    walk(node, &mut out);
    out
}

fn find_button(node: &ResolvedNode, needle: &str) -> NodeId {
    fn collect(node: &ResolvedNode, out: &mut String) {
        for child in &node.children {
            match child {
                ResolvedChild::Text(text) => out.push_str(text),
                ResolvedChild::Node(next) => collect(next, out),
            }
        }
    }
    fn walk(node: &ResolvedNode, needle: &str) -> Option<NodeId> {
        if node.ty.as_ref() == "we-button" && node.handlers.contains_key("onClick") {
            let mut text = String::new();
            collect(node, &mut text);
            if text.contains(needle) {
                return Some(node.id.clone());
            }
        }
        node.children.iter().find_map(|child| match child {
            ResolvedChild::Node(next) => walk(next, needle),
            ResolvedChild::Text(_) => None,
        })
    }
    walk(node, needle).unwrap_or_else(|| panic!("no button whose text contains {needle}"))
}

fn stage(controller: &BaseController) -> String {
    controller.public_json()["stage"]
        .as_str()
        .unwrap()
        .to_string()
}

/// This computer clicked, its attempt connected: a session is open.
fn in_session(open: &mut Open) -> u64 {
    open.click("This computer");
    let attempt = open.jobs().last().expect("the click starts a job").attempt;
    open.controller.note_connected(attempt);
    assert_eq!(stage(&open.controller), "session");
    attempt
}

/// Acceptance: the executor stops under an open session → the offline
/// stage with "Try again"; a retry reaches the same place again (not a
/// click), and its success opens a session again.
#[test]
fn a_lost_session_goes_offline_and_a_retry_opens_it_again() {
    let mut open = start();
    let attempt = in_session(&mut open);

    assert!(open.controller.note_session_lost(attempt));
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "offline");
    assert_eq!(snap["offlineReason"], UNREACHABLE);
    assert_eq!(snap["busy"], false);
    let text = open.text();
    assert!(
        text.contains(UNREACHABLE),
        "offline reason missing:\n{text}"
    );
    assert!(text.contains("Try again"), "retry missing:\n{text}");

    // The same loss reported again changes nothing.
    assert!(!open.controller.note_session_lost(attempt));

    open.click("Try again");
    let jobs = open.jobs();
    assert_eq!(jobs.len(), 2, "Try again starts one job");
    let again = &jobs[1];
    assert!(!again.chosen, "a retry is not a row click");
    assert_eq!(again.connection.id.as_ref(), "this-device");
    assert_eq!(stage(&open.controller), "handing-off");

    // Still down: offline again, with the retry.
    assert!(open.controller.note_unreachable(again.attempt));
    assert_eq!(stage(&open.controller), "offline");
    open.click("Try again");
    let third = open.jobs()[2].clone();
    // Back up: the session again.
    open.controller.note_connected(third.attempt);
    assert_eq!(stage(&open.controller), "session");
}

/// Acceptance: an old attempt's completion cannot replace a newer one.
/// A session is open, the window dials again (the lost-connection banner),
/// and the old session's loss or refusal arrives late: the new attempt and
/// then the new session stay.
#[test]
fn an_old_session_cannot_hand_back_a_newer_one() {
    let mut open = start();
    let old = in_session(&mut open);
    let newer = open.controller.start_reconnect();
    assert_ne!(newer.attempt, old);

    assert!(!open.controller.note_session_lost(old));
    open.controller
        .note_adopted_refusal(old, "the old token was refused");
    open.controller.note_connected(old);
    assert_eq!(stage(&open.controller), "handing-off");
    assert_eq!(open.controller.public_json()["busy"], true);

    open.controller.note_connected(newer.attempt);
    assert_eq!(stage(&open.controller), "session");
    assert!(!open.controller.note_session_lost(old));
    open.controller
        .note_adopted_refusal(old, "the old token was refused");
    assert_eq!(
        stage(&open.controller),
        "session",
        "a late refusal of the old session closed the new one"
    );
    assert_eq!(open.controller.public_json()["error"], "");

    // The current session's own refusal still hands back, with the reason.
    let reason = "the executor refused this app's token — connect again";
    open.controller.note_adopted_refusal(newer.attempt, reason);
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["error"], reason);
}

/// Acceptance: an auth refusal goes back to the choice with the reason,
/// and the list stays up: "Try again" shows the list, it does not dial the
/// place that refused by itself.
#[test]
fn a_refused_session_returns_to_the_choice_with_the_reason() {
    let mut open = start();
    let attempt = in_session(&mut open);
    let reason = "the executor refused this app's token — connect again";
    open.controller.note_adopted_refusal(attempt, reason);
    let text = open.text();
    assert!(
        text.contains("Where to keep your spaces"),
        "the choice is not shown:\n{text}"
    );
    assert!(text.contains(reason), "the reason is not shown:\n{text}");
    // Neither a loss nor a second refusal of the same, closed session acts.
    assert!(!open.controller.note_session_lost(attempt));
    assert_eq!(stage(&open.controller), "connect");
    open.click("Try again");
    assert_eq!(open.jobs().len(), 1, "the refused place was dialed again");
    assert_eq!(stage(&open.controller), "connect");
}

/// A first attempt refused (not an adopted session) also goes to the
/// choice with its reason. Passed before slice 3: kept as a pin.
#[test]
fn a_refused_attempt_returns_to_the_choice_with_the_reason() {
    let mut open = start();
    open.click("This computer");
    let attempt = open.jobs()[0].attempt;
    assert!(open
        .controller
        .note_refused(attempt, "the executor did not accept this app"));
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["error"], "the executor did not accept this app");
    assert_eq!(snap["busy"], false);
}

fn probe(up: &Arc<AtomicBool>) -> Option<OnlineProbe> {
    let up = up.clone();
    Some(Arc::new(move || up.load(Ordering::SeqCst)))
}

/// The network coming back with the offline stage up retries the place
/// chosen, once, as "Try again" would (TS `online` event). Not a click.
#[test]
fn the_network_coming_back_retries_the_place_chosen() {
    let up = Arc::new(AtomicBool::new(false));
    let mut open = start();
    open.controller.set_online(probe(&up));
    open.click("Lab box");
    assert!(open.jobs().is_empty());
    assert_eq!(open.controller.public_json()["offlineReason"], NO_NETWORK);
    assert!(open.controller.poll_network().is_none(), "still offline");

    up.store(true, Ordering::SeqCst);
    let job = open
        .controller
        .poll_network()
        .expect("the network came back: the place chosen again");
    assert!(!job.chosen);
    assert_eq!(job.connection.id.as_ref(), "server:lab.example:12000");
    assert_eq!(stage(&open.controller), "handing-off");
    assert!(
        open.controller.poll_network().is_none(),
        "one retry per return"
    );
}

/// The network probe acts only on the offline stage: online at the list,
/// online during a session, or no probe at all starts nothing.
#[test]
fn the_network_probe_starts_nothing_elsewhere() {
    let up = Arc::new(AtomicBool::new(true));
    let mut open = start();
    open.controller.set_online(probe(&up));
    assert!(open.controller.poll_network().is_none());
    let attempt = in_session(&mut open);
    up.store(false, Ordering::SeqCst);
    assert!(open.controller.poll_network().is_none());
    up.store(true, Ordering::SeqCst);
    assert!(open.controller.poll_network().is_none());
    assert_eq!(stage(&open.controller), "session");

    // The executor stopped: offline. No probe means online, and an omitted
    // probe never retries by itself; "Try again" does.
    assert!(open.controller.note_session_lost(attempt));
    open.controller.set_online(None);
    assert!(open.controller.poll_network().is_none());
    assert_eq!(stage(&open.controller), "offline");
}

/// A stale generation (a permit from before the hand-back) starts nothing
/// on the offline stage.
#[test]
fn a_permit_from_before_the_hand_back_starts_nothing() {
    let mut open = start();
    let attempt = in_session(&mut open);
    let before = open.controller.generation();
    assert!(open.controller.note_session_lost(attempt));
    let after = open.controller.generation();
    assert_ne!(
        before, after,
        "the hand-back did not advance the generation"
    );
    assert!(open.controller.apply(BaseCommand::Retry, before).is_none());
    assert_eq!(stage(&open.controller), "offline");
}
