//! Slice 4: the executor this host runs. Its starting, ready, failed and
//! stopped states draw the pinned template's screens; a stop under an open
//! session takes the window back; "Start Coasys" / "Try again" asks for one
//! start; a completion from before an executor change does not replace it;
//! a locked agent is not a password request; a host that runs no executor
//! never reports one. The pinned template is resolved through a session;
//! the host here applies permitted calls only.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{
    coasys_base_template, AgentState, BaseCommand, BaseController, BaseJob, ConnectionRow,
    ExecutorState, MemoryCell, NoMemory, Session, BUILTIN_BUNDLE,
};
use we_template::{
    Action, ActionRequest, Completer, Host, Invoked, NodeId, ResolvedChild, ResolvedNode, RootSpec,
    StoreBag,
};

struct ApplyHost {
    controller: Arc<BaseController>,
    jobs: Rc<RefCell<Vec<BaseJob>>>,
}

impl Host for ApplyHost {
    fn act(&mut self, request: ActionRequest, _done: Completer) -> Invoked {
        let Action::Invoke { target, args } = &request.action;
        if let Some(permit) = &request.permit {
            if permit.matches(target, args) {
                if let Some(command) = we_session::command_for(target, args) {
                    if let Some(job) = self.controller.apply_base(command, permit.generation()) {
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
    jobs: Rc<RefCell<Vec<BaseJob>>>,
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

    fn jobs(&self) -> Vec<BaseJob> {
        self.jobs.borrow().clone()
    }

    fn dials(&self) -> Vec<we_session::HostJob> {
        self.jobs()
            .into_iter()
            .filter_map(|job| match job {
                BaseJob::Dial(job) => Some(job),
                BaseJob::StartExecutor => None,
            })
            .collect()
    }

    fn starts(&self) -> usize {
        self.jobs()
            .iter()
            .filter(|job| matches!(job, BaseJob::StartExecutor))
            .count()
    }
}

fn open_with(controller: Arc<BaseController>) -> Open {
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

/// A host that runs this computer's executor, which is starting.
fn owned() -> Open {
    let controller = BaseController::with_memory(
        BUILTIN_BUNDLE,
        vec![ConnectionRow::this_computer()],
        Arc::new(NoMemory),
    );
    controller.own_executor(ExecutorState::Starting);
    open_with(controller)
}

fn ready() -> ExecutorState {
    ExecutorState::Ready {
        agent: Some(AgentState::Unlocked),
    }
}

fn stopped() -> ExecutorState {
    ExecutorState::Failed {
        reason: "Another program stopped it.".into(),
        stopped: true,
    }
}

fn failed_to_start() -> ExecutorState {
    ExecutorState::Failed {
        reason: "It stopped before it was ready (exit 1).".into(),
        stopped: false,
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

/// Ready, This computer clicked, its attempt connected: a session is open.
fn in_session(open: &mut Open) -> u64 {
    open.controller.note_executor(ready());
    open.click("This computer");
    let attempt = open.dials().last().expect("the click dials").attempt;
    open.controller.note_connected(attempt);
    assert_eq!(stage(&open.controller), "session");
    attempt
}

/// Acceptance: starting, failed to start and stopped each draw B's own
/// screen, with B's words, from the public snapshot.
#[test]
fn starting_failed_and_stopped_draw_the_base_screens() {
    let mut open = owned();
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "starting");
    assert_eq!(snap["executorPhase"], "starting");
    let text = open.text();
    assert!(text.contains("Starting Coasys"), "starting:\n{text}");
    assert!(
        !text.contains("This computer"),
        "the list shows while the executor starts:\n{text}"
    );

    open.controller.note_executor(failed_to_start());
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "failed");
    assert_eq!(snap["executorPhase"], "failed");
    assert_eq!(snap["executorStopped"], false);
    assert_eq!(
        snap["executorReason"],
        "It stopped before it was ready (exit 1)."
    );
    let text = open.text();
    assert!(text.contains("Coasys couldn’t start"), "failed:\n{text}");
    assert!(
        text.contains("It stopped before it was ready (exit 1)."),
        "{text}"
    );
    assert!(text.contains("Try again"), "{text}");
    assert!(!text.contains("Coasys stopped"), "{text}");
}

/// Acceptance: stopped is distinct from failed-to-start — its own heading,
/// its own button, its own flag in the snapshot.
#[test]
fn stopped_is_not_failed_to_start() {
    let mut open = owned();
    open.controller.note_executor(ready());
    open.controller.note_executor(stopped());
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "failed");
    assert_eq!(snap["executorStopped"], true);
    let text = open.text();
    assert!(text.contains("Coasys stopped"), "stopped:\n{text}");
    assert!(text.contains("Start it to open your spaces."), "{text}");
    assert!(text.contains("Start Coasys"), "{text}");
    assert!(text.contains("Another program stopped it."), "{text}");
    assert!(!text.contains("couldn’t start"), "{text}");
}

/// Acceptance (ready): nothing is dialed while the executor starts; ready
/// shows the list, or reaches the remembered place without a click.
#[test]
fn ready_shows_the_list_or_resumes_the_place_chosen() {
    let open = owned();
    assert!(open.controller.resume().is_none(), "dialed while starting");
    assert!(open.controller.note_executor(ready()).is_none());
    assert_eq!(stage(&open.controller), "connect");
    assert_eq!(open.controller.public_json()["executorPhase"], "ready");

    let controller = BaseController::with_memory(
        BUILTIN_BUNDLE,
        vec![ConnectionRow::this_computer()],
        Arc::new(MemoryCell::holding("this-device")),
    );
    controller.own_executor(ExecutorState::Starting);
    assert!(controller.resume().is_none(), "dialed while starting");
    assert_eq!(stage(&controller), "starting");
    let job = controller
        .note_executor(ready())
        .expect("ready reaches the remembered place");
    assert!(!job.chosen, "a resume is not a click");
    assert_eq!(job.connection.id.as_ref(), "this-device");
    assert_eq!(stage(&controller), "handing-off");
    // Ready again is nothing new: no second dial.
    assert!(controller.note_executor(ready()).is_none());
}

/// Acceptance: the executor stops under an open session → the base takes
/// the window back, on the stopped screen, and a permit from the session
/// no longer matches. The flow's own loss, arriving later, does not turn it
/// into the offline stage.
#[test]
fn a_stop_during_a_session_takes_the_window_back() {
    let mut open = owned();
    let attempt = in_session(&mut open);
    let before = open.controller.generation();

    open.controller.note_executor(stopped());
    assert!(!open.controller.in_session(), "the session kept the window");
    assert_eq!(stage(&open.controller), "failed");
    assert!(open.controller.generation() > before, "old permits match");
    assert!(
        open.controller
            .apply_base(BaseCommand::Retry, before)
            .is_none(),
        "a permit from the session started something"
    );
    assert!(!open.controller.note_session_lost(attempt));
    assert_eq!(stage(&open.controller), "failed");
    let text = open.text();
    assert!(text.contains("Coasys stopped"), "{text}");
}

/// Acceptance: retry starts once. The stopped screen's button asks for one
/// start; the same permit again, and a retry while it starts, ask for none.
#[test]
fn start_coasys_asks_for_one_start() {
    let mut open = owned();
    open.controller.note_executor(ready());
    open.controller.note_executor(stopped());
    let generation = open.controller.generation();

    open.click("Start Coasys");
    assert_eq!(open.starts(), 1, "one click, one start: {:?}", open.jobs());
    assert_eq!(stage(&open.controller), "starting");
    assert_eq!(open.controller.public_json()["executorPhase"], "starting");
    assert!(
        open.controller
            .apply_base(BaseCommand::Retry, generation)
            .is_none(),
        "the click's permit started a second one"
    );
    let now = open.controller.generation();
    assert!(
        open.controller
            .apply_base(BaseCommand::Retry, now)
            .is_none(),
        "a retry while it starts started a second one"
    );
    assert!(open.controller.facts().busy, "starting is not busy");
    assert!(open.dials().is_empty(), "dialed while it starts");

    // Failed to start: "Try again" asks for one start too.
    open.controller.note_executor(failed_to_start());
    open.click("Try again");
    assert_eq!(open.starts(), 2);
    assert!(open.dials().is_empty());
}

/// Acceptance: an answer from before an executor change cannot replace it.
/// An attempt is in flight when the executor stops; that attempt's late
/// success or failure leaves the stopped screen up.
#[test]
fn a_late_completion_does_not_replace_the_stopped_screen() {
    let mut open = owned();
    open.controller.note_executor(ready());
    open.click("This computer");
    let attempt = open.dials()[0].attempt;
    assert_eq!(stage(&open.controller), "handing-off");

    open.controller.note_executor(stopped());
    assert_eq!(stage(&open.controller), "failed");
    open.controller.note_connected(attempt);
    assert_eq!(stage(&open.controller), "failed", "late success won");
    assert!(!open.controller.in_session());
    assert!(!open.controller.note_unreachable(attempt));
    assert_eq!(stage(&open.controller), "failed", "late failure won");
}

/// Acceptance: a locked agent is reported as it is. It is not a password
/// request (no `password` stage, `passwordIsNew` false); the host goes on
/// to the list, where the connect itself says the agent is locked.
#[test]
fn a_locked_agent_is_not_a_password_request() {
    let open = owned();
    open.controller.note_executor(ExecutorState::Ready {
        agent: Some(AgentState::Locked),
    });
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["executorPhase"], "ready");
    assert_eq!(snap["passwordIsNew"], false);
    assert_eq!(snap["passwordWrong"], false);
}

/// Acceptance: a host that attaches to an executor someone else runs never
/// reports it as its own. Executor changes it is given do nothing (pin:
/// this held before the change).
#[test]
fn a_host_without_its_own_executor_reports_none() {
    let mut open = open_with(BaseController::with_this_computer());
    assert_eq!(open.controller.public_json()["executorPhase"], "");
    assert!(open.controller.note_executor(stopped()).is_none());
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["executorPhase"], "");
    assert_eq!(snap["executorStopped"], false);
    let text = open.text();
    assert!(text.contains("This computer"), "{text}");
    assert!(!text.contains("Coasys stopped"), "{text}");
}
