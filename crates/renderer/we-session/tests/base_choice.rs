//! Slice 2: the connection list, the choice kept between starts, and what
//! a click means compared with a resume. The pinned template is resolved
//! through a session; the host here applies permitted calls only.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{
    coasys_base_template, BaseCommand, BaseController, ChoiceMemory, ConnectionRow, HostJob,
    MemoryCell, Session, BUILTIN_BUNDLE, NOT_LISTED, NO_NETWORK,
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

fn start(memory: Arc<dyn ChoiceMemory>) -> Open {
    let controller = BaseController::with_memory(BUILTIN_BUNDLE, rows(), memory);
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

/// Acceptance: the last-used tag survives a restart.
#[test]
fn the_last_used_tag_survives_a_restart() {
    let memory = Arc::new(MemoryCell::default());
    let mut first = start(memory.clone());
    assert!(!first.text().contains("Last used"), "nothing chosen yet");
    first.click("This computer");
    assert_eq!(first.jobs().len(), 1);
    drop(first);

    let mut second = start(memory.clone());
    let snap = second.controller.public_json();
    assert_eq!(snap["chosen"], "this-device", "the id is kept: {snap}");
    assert_eq!(snap["connections"][0]["chosen"], true);
    assert_eq!(snap["connections"][1]["chosen"], false);
    let text = second.text();
    assert!(text.contains("Last used"), "the tag is gone:\n{text}");
}

/// A start with a remembered place goes to it without a click. That is a
/// resume: the host is told it was not chosen now.
#[test]
fn a_restart_resumes_the_remembered_place() {
    let memory = Arc::new(MemoryCell::holding("this-device"));
    let mut open = start(memory);
    let job = open
        .controller
        .resume()
        .expect("a listed remembered place resumes");
    assert!(!job.chosen, "a resume is not a click");
    assert_eq!(job.connection.id.as_ref(), "this-device");
    assert!(open.text().contains("Opening your spaces"));
    assert!(open.controller.resume().is_none(), "one resume per start");
}

/// A remembered id the catalog no longer lists is not resumed and is not
/// an error: the list is shown.
#[test]
fn a_remembered_place_that_is_gone_shows_the_list() {
    let memory = Arc::new(MemoryCell::holding("server:gone.example"));
    let mut open = start(memory);
    assert!(open.controller.resume().is_none());
    let snap = open.controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["error"], "");
    assert!(open.text().contains("Where to keep your spaces"));
}

/// Acceptance: an unknown id is rejected. Nothing starts, nothing is kept,
/// and the list says the option is gone.
#[test]
fn an_unknown_id_is_rejected() {
    let memory = Arc::new(MemoryCell::holding("this-device"));
    let open = start(memory.clone());
    let controller = &open.controller;
    let job = controller.apply(
        BaseCommand::Choose("server:evil.example".into()),
        controller.generation(),
    );
    assert!(job.is_none(), "an unlisted id started a job");
    assert_eq!(memory.remembered().as_deref(), Some("this-device"));
    let snap = controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["chosen"], "this-device");
    assert_eq!(snap["error"], NOT_LISTED);
}

/// Acceptance: an explicit choice escapes a stale remembered place. The
/// remembered server refuses; a click on This computer reaches this
/// computer and becomes the place kept.
#[test]
fn an_explicit_choice_escapes_a_stale_remembered_place() {
    let memory = Arc::new(MemoryCell::holding("server:lab.example:12000"));
    let mut open = start(memory.clone());
    let resumed = open.controller.resume().expect("the server is listed");
    assert!(!resumed.chosen);
    assert_eq!(resumed.connection.kind.as_ref(), "server");
    assert!(open
        .controller
        .note_refused(resumed.attempt, "Can't open Lab box from this app yet."));
    assert!(open.text().contains("Can't open Lab box"));

    open.click("This computer");
    let jobs = open.jobs();
    assert_eq!(jobs.len(), 1);
    assert!(jobs[0].chosen, "a click is a choice");
    assert_eq!(jobs[0].connection.id.as_ref(), "this-device");
    assert_eq!(memory.remembered().as_deref(), Some("this-device"));
}

/// "Choose another" shows the list. After it, "Try again" does not jump
/// back to the remembered place.
#[test]
fn choose_another_stops_the_jump_to_the_remembered_place() {
    let memory = Arc::new(MemoryCell::holding("server:lab.example:12000"));
    let open = start(memory);
    let controller = &open.controller;
    let resumed = controller.resume().unwrap();
    controller.note_refused(resumed.attempt, "refused");
    // Try again from the connect stage takes the remembered place again.
    let again = controller
        .apply(BaseCommand::Retry, controller.generation())
        .expect("retry reaches the remembered place");
    assert!(!again.chosen);
    assert_eq!(again.connection.kind.as_ref(), "server");
    controller.note_unreachable(again.attempt);
    assert_eq!(controller.public_json()["stage"], "offline");

    assert!(controller
        .apply(BaseCommand::ShowConnections, controller.generation())
        .is_none());
    assert_eq!(controller.public_json()["stage"], "connect");
    let after = controller.apply(BaseCommand::Retry, controller.generation());
    assert!(after.is_none(), "retry jumped past the list: {after:?}");
    assert_eq!(controller.public_json()["stage"], "connect");
}

/// Offline "Try again" reaches the place chosen, not the first row.
#[test]
fn offline_retry_reaches_the_place_chosen() {
    let memory = Arc::new(MemoryCell::default());
    let open = start(memory);
    let controller = &open.controller;
    let job = controller
        .apply(
            BaseCommand::Choose("server:lab.example:12000".into()),
            controller.generation(),
        )
        .unwrap();
    controller.note_unreachable(job.attempt);
    let retry = controller
        .apply(BaseCommand::Retry, controller.generation())
        .unwrap();
    assert!(!retry.chosen);
    assert_eq!(retry.connection.id.as_ref(), "server:lab.example:12000");
}

/// Acceptance: this computer connects without a network. A place off this
/// computer waits for one.
#[test]
fn this_computer_connects_without_a_network() {
    let memory = Arc::new(MemoryCell::default());
    let mut open = start(memory);
    open.controller.set_online(Some(Arc::new(|| false)));
    let controller = open.controller.clone();
    let server = controller.apply(
        BaseCommand::Choose("server:lab.example:12000".into()),
        controller.generation(),
    );
    assert!(server.is_none(), "a server was dialed with no network");
    let snap = controller.public_json();
    assert_eq!(snap["stage"], "offline");
    assert_eq!(snap["offlineReason"], NO_NETWORK);

    open.click("Choose another");
    open.click("This computer");
    let jobs = open.jobs();
    assert_eq!(jobs.len(), 1, "this computer did not start");
    assert_eq!(jobs[0].connection.id.as_ref(), "this-device");
}

#[test]
fn a_server_row_names_its_address() {
    let row = ConnectionRow::server("lab.example:12000", Some("Lab box"));
    assert_eq!(row.id.as_ref(), "server:lab.example:12000");
    assert_eq!(row.kind.as_ref(), "server");
    assert_eq!(row.icon.as_ref(), "hard-drives");
    assert_eq!(row.label.as_ref(), "Lab box");
    assert_eq!(row.detail.as_ref(), "lab.example:12000");
    let bare = ConnectionRow::server("10.0.0.2:12000", None);
    assert_eq!(bare.label.as_ref(), "10.0.0.2:12000");
}
