//! The pinned Coasys base template, driven through a session.
//! A choose starts one connect job. A second call from the same click does not.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{
    coasys_base_template, BaseCommand, BaseController, HostJob, Session, BUILTIN_BUNDLE,
    UNREACHABLE,
};
use we_template::{
    Action, ActionRequest, Completer, Host, Invoked, NodeId, ResolvedChild, ResolvedNode, RootSpec,
    SchemaNode, StoreBag,
};

struct ApplyHost {
    controller: Arc<BaseController>,
    /// Permits the gate issued and the host accepted as matching.
    permits: Rc<RefCell<usize>>,
    jobs: Rc<RefCell<Vec<HostJob>>>,
}

impl Host for ApplyHost {
    fn act(&mut self, request: ActionRequest, _done: Completer) -> Invoked {
        let Action::Invoke { target, args } = &request.action;
        if let Some(permit) = &request.permit {
            if permit.matches(target, args) {
                *self.permits.borrow_mut() += 1;
                if let Some(command) = command_for(target, args) {
                    // The permit's generation, not the controller's current one.
                    if let Some(job) = self.controller.apply(command, permit.generation()) {
                        self.jobs.borrow_mut().push(job);
                    }
                }
            }
        }
        Invoked::Done(Ok(Value::Undefined))
    }
}

fn command_for(target: &str, args: &[Value]) -> Option<BaseCommand> {
    let method = target.strip_prefix("baseStore.")?;
    Some(match method {
        "choose" => {
            let Value::Str(id) = args.first()? else {
                return None;
            };
            BaseCommand::Choose(id.to_string())
        }
        "retry" => BaseCommand::Retry,
        "showConnections" => BaseCommand::ShowConnections,
        "openPage" => {
            let Value::Str(page) = args.first()? else {
                return None;
            };
            BaseCommand::OpenPage(page.to_string())
        }
        "closePage" => BaseCommand::ClosePage,
        "clearPasswordWrong" => BaseCommand::ClearPasswordWrong,
        "submitPassword" | "makeIdentity" | "linkIdentity" | "useWords" | "startNow" => {
            BaseCommand::Nop
        }
        _ => return None,
    })
}

fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

struct Open {
    session: Session,
    controller: Arc<BaseController>,
    permits: Rc<RefCell<usize>>,
    jobs: Rc<RefCell<Vec<HostJob>>>,
}

fn open_with(node: SchemaNode) -> Open {
    let controller = BaseController::with_this_computer();
    let permits = Rc::new(RefCell::new(0));
    let jobs = Rc::new(RefCell::new(Vec::new()));
    let host = ApplyHost {
        controller: controller.clone(),
        permits: permits.clone(),
        jobs: jobs.clone(),
    };
    let mut session = Session::new(
        RootSpec::base(node, BUILTIN_BUNDLE),
        Arc::new(StoreBag::new()),
        screen(),
        Box::new(host),
    );
    session.set_bindings(controller.bindings());
    session.set_base_facts(Some(controller.facts()));
    Open {
        session,
        controller,
        permits,
        jobs,
    }
}

fn open() -> Open {
    open_with(coasys_base_template())
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
    fn walk(node: &ResolvedNode, needle: &str) -> Option<NodeId> {
        if node.ty.as_ref() == "we-button" && node.handlers.contains_key("onClick") {
            let mut text = String::new();
            fn collect(node: &ResolvedNode, out: &mut String) {
                for child in &node.children {
                    match child {
                        ResolvedChild::Text(text) => out.push_str(text),
                        ResolvedChild::Node(next) => collect(next, out),
                    }
                }
            }
            collect(node, &mut text);
            if text.contains(needle) {
                return Some(node.id.clone());
            }
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

fn strings_of(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) => out.push(text.clone()),
        serde_json::Value::Array(items) => {
            for item in items {
                strings_of(item, out);
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values() {
                strings_of(item, out);
            }
        }
        _ => {}
    }
}

#[test]
fn the_connect_stage_shows_this_computer() {
    let mut open = open();
    let root = open.session.resolve();
    let text = tree_text(&root);
    assert!(
        text.contains("Where to keep your spaces"),
        "connect heading missing:\n{text}"
    );
    assert!(text.contains("This computer"), "row label missing:\n{text}");
    assert!(
        text.contains("Available while this computer is on"),
        "row detail missing:\n{text}"
    );
    assert!(
        !text.contains("Starting Coasys"),
        "the starting stage is not this screen"
    );
    assert!(
        !text.contains("Opening your spaces"),
        "nothing is dialed yet"
    );
}

#[test]
fn a_choose_shows_opening_your_spaces() {
    let mut open = open();
    let root = open.session.resolve();
    let id = find_button(&root, "This computer");
    open.session.dispatch(&id, "onClick", Value::Undefined);
    let jobs = open.jobs.borrow().clone();
    assert_eq!(jobs.len(), 1, "one choose starts one job");
    assert!(jobs[0].chosen);
    open.session.set_base_facts(Some(open.controller.facts()));
    let text = tree_text(&open.session.resolve());
    assert!(
        text.contains("Opening your spaces"),
        "handing-off text missing:\n{text}"
    );
    assert!(!text.contains("Where to keep your spaces"));
}

#[test]
fn an_unreachable_attempt_offers_retry() {
    let mut open = open();
    let root = open.session.resolve();
    let id = find_button(&root, "This computer");
    open.session.dispatch(&id, "onClick", Value::Undefined);
    let attempt = open.jobs.borrow()[0].attempt;
    open.controller.note_unreachable(attempt);
    open.session.set_base_facts(Some(open.controller.facts()));
    let root = open.session.resolve();
    let text = tree_text(&root);
    assert!(
        text.contains("isn't responding"),
        "offline reason missing:\n{text}"
    );
    assert!(
        text.contains(UNREACHABLE),
        "offline sentence drifted:\n{text}"
    );
    assert!(text.contains("Try again"), "retry missing:\n{text}");

    let retry = find_button(&root, "Try again");
    open.session.dispatch(&retry, "onClick", Value::Undefined);
    let jobs = open.jobs.borrow();
    assert_eq!(jobs.len(), 2);
    assert!(!jobs[1].chosen, "retry is not a row click");
}

#[test]
fn a_stale_generation_does_not_start() {
    let controller = BaseController::with_this_computer();
    assert!(controller
        .apply(BaseCommand::Choose("nope".into()), controller.generation())
        .is_none());
    assert_eq!(controller.public_json()["stage"], "connect");
    assert!(controller
        .apply(
            BaseCommand::Choose("this-device".into()),
            controller.generation().wrapping_sub(1)
        )
        .is_none());
    assert_eq!(controller.generation(), 1);
    assert_eq!(controller.public_json()["stage"], "connect");
    assert_eq!(controller.public_json()["busy"], false);
}

#[test]
fn a_stale_attempt_does_not_change_the_stage() {
    let controller = BaseController::with_this_computer();
    let job = controller
        .apply(
            BaseCommand::Choose("this-device".into()),
            controller.generation(),
        )
        .expect("the current generation starts");
    controller.note_unreachable(job.attempt + 1);
    assert_eq!(controller.public_json()["stage"], "handing-off");
    controller.note_unreachable(job.attempt);
    assert_eq!(controller.public_json()["stage"], "offline");
    assert_eq!(controller.public_json()["offlineReason"], UNREACHABLE);
    controller.note_connected(job.attempt);
    assert_eq!(
        controller.public_json()["stage"],
        "offline",
        "the attempt was already completed"
    );
}

#[test]
fn a_refusal_after_the_session_returns_to_connect() {
    let mut open = open();
    let root = open.session.resolve();
    let id = find_button(&root, "This computer");
    open.session.dispatch(&id, "onClick", Value::Undefined);
    let attempt = open.jobs.borrow()[0].attempt;
    let reason = "the executor refused this app's token — connect again";
    // The attempt is still in flight. This is not an adopted session.
    open.controller.note_adopted_refusal(reason);
    assert_eq!(open.controller.public_json()["stage"], "handing-off");
    open.controller.note_connected(attempt);
    assert_eq!(open.controller.public_json()["stage"], "session");
    // The attempt id is spent. The same id cannot complete again.
    assert!(!open.controller.note_refused(attempt, reason));
    assert_eq!(open.controller.public_json()["stage"], "session");
    open.controller.note_adopted_refusal(reason);
    open.session.set_base_facts(Some(open.controller.facts()));
    let text = tree_text(&open.session.resolve());
    assert!(
        text.contains("Where to keep your spaces"),
        "connect heading missing:\n{text}"
    );
    assert!(text.contains("refused"), "refusal missing:\n{text}");
    open.controller.note_connected(attempt);
    assert_eq!(open.controller.public_json()["stage"], "connect");
}

#[test]
fn the_public_snapshot_has_no_secret_values() {
    let controller = BaseController::with_this_computer();
    let snap = controller.public_json();
    assert_eq!(snap["stage"], "connect");
    assert_eq!(snap["page"], "");
    assert_eq!(snap["hostKind"], "desktop");
    assert_eq!(snap["deviceNoun"], "computer");
    assert_eq!(snap["brand"]["name"], "Coasys");
    assert!(snap["brand"]["mark"]
        .as_str()
        .unwrap()
        .starts_with("data:image/svg+xml,"));
    assert_eq!(snap["identityKnown"], false);
    assert_eq!(snap["blocked"], "");
    assert_eq!(snap["connections"][0]["id"], "this-device");
    assert_eq!(snap["connections"][0]["label"], "This computer");
    assert_eq!(snap["connections"][0]["chosen"], false);
    assert_eq!(snap["chosen"], false);
    assert_eq!(snap["busy"], false);
    assert_eq!(snap["error"], "");
    assert_eq!(snap["offlineReason"], "");
    let mut strings = Vec::new();
    strings_of(&snap, &mut strings);
    for text in &strings {
        let lower = text.to_ascii_lowercase();
        for word in ["token", "secret", "capability", "password"] {
            assert!(
                !lower.contains(word),
                "public snapshot string contains {word}: {text}"
            );
        }
    }
}

#[test]
fn two_chooses_in_one_click_start_one_job() {
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "we-button",
        "children": ["This computer"],
        "props": {
            "onClick": [
                { "$invoke": "baseStore.choose", "args": ["this-device"] },
                { "$invoke": "baseStore.choose", "args": ["this-device"] }
            ]
        }
    }))
    .unwrap();
    let mut open = open_with(node);
    let root = open.session.resolve();
    let id = find_button(&root, "This computer");
    open.session.dispatch(&id, "onClick", Value::Undefined);
    assert_eq!(
        *open.permits.borrow(),
        2,
        "both calls in the click were permitted from the dispatch's facts"
    );
    let jobs = open.jobs.borrow();
    assert_eq!(
        jobs.len(),
        1,
        "the second permit is stale and starts nothing"
    );
    assert!(jobs[0].chosen);
}
