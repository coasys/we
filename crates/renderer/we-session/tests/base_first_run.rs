//! Slice 5: the first run, from the identity this computer's executor
//! reports. A known empty identity opens B's first-run screen; a read that
//! failed does not; "Skip for now" is kept across starts; Devices and
//! Security are read-only; closed doors say why; no phrase or key
//! identifier reaches the store or the screen. The pinned template is
//! resolved through a session; the host here applies permitted calls only.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{
    coasys_base_template, AgentState, BaseController, BaseJob, ChoiceMemory, ConnectionRow,
    ExecutorState, IdentityDevice, IdentityFacts, MemoryCell, Session, BUILTIN_BUNDLE,
};
use we_template::{
    Action, ActionRequest, Completer, Host, Invoked, NodeId, ResolvedChild, ResolvedNode, RootSpec,
    StoreBag,
};

const DID: &str = "did:scid:coasys:1:QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const LATER: &str = "Not available in this app yet.";
const NOT_UP: &str = "Available once Coasys has started.";
const LOCKED: &str = "Coasys on this computer is locked. This app can't unlock it yet.";
const NO_STORE: &str = "This network has no identity store, or a store URL without its key, so \
                        this computer cannot make or change an identity. Nothing was changed.";

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
    fn root(&mut self) -> Arc<ResolvedNode> {
        self.session.set_base_facts(Some(self.controller.facts()));
        self.session.resolve()
    }

    fn text(&mut self) -> String {
        tree_text(&self.root())
    }

    fn click(&mut self, needle: &str) {
        let root = self.root();
        let id = find_button(&root, needle).unwrap_or_else(|| panic!("no button {needle}"));
        self.session.dispatch(&id, "onClick", Value::Undefined);
    }

    fn dials(&self) -> usize {
        self.jobs
            .borrow()
            .iter()
            .filter(|job| matches!(job, BaseJob::Dial(_)))
            .count()
    }

    fn stage(&self) -> String {
        self.controller.public_json()["stage"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// The executor is ready; the identity read it asks for answers `answer`.
    fn ready_with(&mut self, agent: Option<AgentState>, answer: Result<IdentityFacts, String>) {
        self.controller
            .note_executor(ExecutorState::Ready { agent });
        assert_eq!(self.stage(), "loading", "the identity is read first");
        let read = self
            .controller
            .identity_read_due()
            .expect("ready asks for an identity read");
        assert_eq!(self.controller.identity_read_due(), None, "asked once");
        if let Some(job) = self.controller.note_identity(read, answer) {
            self.jobs.borrow_mut().push(BaseJob::Dial(job));
        }
    }
}

/// A host that runs this computer's executor and reads its identity.
fn owned(memory: Arc<dyn ChoiceMemory>) -> Open {
    let controller =
        BaseController::with_memory(BUILTIN_BUNDLE, vec![ConnectionRow::this_computer()], memory);
    controller.keep_identity();
    controller.own_executor(ExecutorState::Starting);
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

fn empty() -> IdentityFacts {
    IdentityFacts {
        did: None,
        store_trusted: true,
        devices: vec![],
    }
}

fn made() -> IdentityFacts {
    IdentityFacts {
        did: Some(DID.into()),
        store_trusted: true,
        devices: vec![
            IdentityDevice { this_device: true },
            IdentityDevice { this_device: false },
        ],
    }
}

const UNLOCKED: Option<AgentState> = Some(AgentState::Unlocked);

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

fn text_of(node: &ResolvedNode) -> String {
    let mut out = String::new();
    for child in &node.children {
        match child {
            ResolvedChild::Text(text) => out.push_str(text),
            ResolvedChild::Node(next) => out.push_str(&text_of(next)),
        }
    }
    out
}

fn find_node<'a>(
    node: &'a ResolvedNode,
    done: &dyn Fn(&ResolvedNode) -> bool,
) -> Option<&'a ResolvedNode> {
    if done(node) {
        return Some(node);
    }
    node.children.iter().find_map(|child| match child {
        ResolvedChild::Node(next) => find_node(next, done),
        ResolvedChild::Text(_) => None,
    })
}

/// The innermost node in `node` for which `done` holds.
fn deepest<'a>(
    node: &'a ResolvedNode,
    done: &dyn Fn(&ResolvedNode) -> bool,
) -> Option<&'a ResolvedNode> {
    let inner = node.children.iter().find_map(|child| match child {
        ResolvedChild::Node(next) => deepest(next, done),
        ResolvedChild::Text(_) => None,
    });
    inner.or_else(|| done(node).then_some(node))
}

fn find_button(node: &ResolvedNode, needle: &str) -> Option<NodeId> {
    find_node(node, &|n| {
        n.ty.as_ref() == "we-button"
            && n.handlers.contains_key("onClick")
            && text_of(n).contains(needle)
    })
    .map(|n| n.id.clone())
}

/// A page B draws over the stage (fixed, the whole window) titled `title`.
fn overlay(node: &ResolvedNode, title: &str) -> bool {
    matches!(node.props.get("position"), Some(Value::Str(p)) if p.as_ref() == "fixed")
        && text_of(node).contains(title)
}

/// Every node in `node` with a handler, by type and text.
fn handled(node: &ResolvedNode, out: &mut Vec<String>) {
    if !node.handlers.is_empty() {
        out.push(format!("{}:{}", node.ty, text_of(node).trim()));
    }
    for child in &node.children {
        if let ResolvedChild::Node(next) = child {
            handled(next, out);
        }
    }
}

fn disabled(open: &mut Open, needle: &str) -> bool {
    let root = open.root();
    let node = find_node(&root, &|n| {
        n.ty.as_ref() == "we-button" && text_of(n).contains(needle)
    })
    .unwrap_or_else(|| panic!("no button {needle}"))
    .clone();
    matches!(node.props.get("disabled"), Some(Value::Bool(true)))
}

/// Acceptance: a known empty identity (the executor answered, and its
/// agent speaks for no identity) opens B's first-run screen, and nothing
/// is dialed meanwhile.
#[test]
fn a_known_empty_identity_opens_first_run() {
    let mut open = owned(Arc::new(MemoryCell::holding("this-device")));
    open.ready_with(UNLOCKED, Ok(empty()));
    assert_eq!(open.stage(), "first-run");
    let text = open.text();
    for words in [
        "Set up Coasys",
        "Create new identity",
        "Link to another device",
        "Restore with recovery phrase",
        "Skip for now",
    ] {
        assert!(text.contains(words), "{words} missing:\n{text}");
    }
    assert_eq!(
        open.dials(),
        0,
        "a remembered place is not reached past the first run"
    );
    let snap = open.controller.public_json();
    assert_eq!(snap["identityKnown"], true);
    assert_eq!(snap["hasIdentity"], true);
    assert_eq!(snap["did"], "");
}

/// Acceptance: a read that failed is not an empty identity. The list shows
/// with the reason, the identity stays unknown, and the remembered place
/// is reached as it would be without a first run.
#[test]
fn a_read_failure_does_not_open_first_run() {
    let mut open = owned(Arc::new(MemoryCell::default()));
    open.ready_with(UNLOCKED, Err("the executor did not answer".into()));
    assert_eq!(open.stage(), "connect");
    let text = open.text();
    assert!(!text.contains("Set up Coasys"), "{text}");
    assert!(
        text.contains("Couldn't read your identity: the executor did not answer"),
        "{text}"
    );
    assert_eq!(open.controller.public_json()["identityKnown"], false);

    // "Try again" reads it again; a known empty identity then opens it.
    open.click("Try again");
    assert_eq!(open.stage(), "loading");
    let read = open.controller.identity_read_due().expect("a second read");
    open.controller.note_identity(read, Ok(empty()));
    assert_eq!(open.stage(), "first-run");

    // With a remembered place, the failed read goes on to it.
    let mut open = owned(Arc::new(MemoryCell::holding("this-device")));
    open.ready_with(UNLOCKED, Err("no agent".into()));
    assert_eq!(open.stage(), "handing-off");
    assert_eq!(open.dials(), 1);
}

/// A read that answers after a newer one was asked (or after the executor
/// stopped) changes nothing.
#[test]
fn a_late_identity_answer_changes_nothing() {
    let open = owned(Arc::new(MemoryCell::default()));
    open.controller
        .note_executor(ExecutorState::Ready { agent: UNLOCKED });
    let old = open.controller.identity_read_due().expect("a read");
    open.controller.note_executor(ExecutorState::Failed {
        reason: "It stopped (signal 9).".into(),
        stopped: true,
    });
    assert_eq!(open.controller.note_identity(old, Ok(empty())), None);
    assert_eq!(open.stage(), "failed");
    open.controller.note_executor(ExecutorState::Starting);
    open.controller
        .note_executor(ExecutorState::Ready { agent: UNLOCKED });
    let new = open.controller.identity_read_due().expect("a new read");
    assert_ne!(old, new);
    assert_eq!(open.controller.note_identity(old, Ok(made())), None);
    assert_eq!(open.stage(), "loading");
    open.controller.note_identity(new, Ok(empty()));
    assert_eq!(open.stage(), "first-run");
}

/// An identity this computer speaks for does not open the first run.
/// (A pin: it passed before slice 5, which had no first run at all.)
#[test]
fn an_identity_does_not_open_first_run() {
    let mut open = owned(Arc::new(MemoryCell::default()));
    open.ready_with(UNLOCKED, Ok(made()));
    assert_eq!(open.stage(), "connect");
    assert!(open.text().contains("This computer"));
}

/// Acceptance: "Skip for now" leaves the first run, and is kept: the next
/// start with the same memory and still no identity shows the list.
#[test]
fn skip_persists_across_restart() {
    let memory = Arc::new(MemoryCell::default());
    let mut open = owned(memory.clone());
    open.ready_with(UNLOCKED, Ok(empty()));
    assert_eq!(open.stage(), "first-run");
    open.click("Skip for now");
    assert_eq!(open.stage(), "connect");
    assert!(memory.skipped(), "the skip was not kept");

    let mut again = owned(memory);
    again.ready_with(UNLOCKED, Ok(empty()));
    assert_eq!(
        again.stage(),
        "connect",
        "the first run came back after a skip"
    );
}

/// Acceptance: Devices and Security open over the stage and are read-only:
/// their only action is Back, and opening them changes no identity fact.
#[test]
fn devices_and_security_are_read_only() {
    let mut open = owned(Arc::new(MemoryCell::default()));
    open.ready_with(UNLOCKED, Ok(made()));
    let before = open.controller.public_json();
    open.click("Devices");
    assert_eq!(open.controller.public_json()["page"], "devices");
    let root = open.root();
    let page = deepest(&root, &|n| overlay(n, "Your devices"))
        .expect("the devices page")
        .clone();
    let text = tree_text(&page);
    assert!(text.contains("Your devices"), "{text}");
    assert!(text.contains("This computer"), "{text}");
    assert!(text.contains("Unnamed device"), "{text}");
    let mut actions = Vec::new();
    handled(&page, &mut actions);
    assert_eq!(actions, ["we-button:Back"], "Devices offers more than Back");
    open.click("Back");
    open.click("Security");
    let root = open.root();
    let page = deepest(&root, &|n| overlay(n, "To make changes"))
        .expect("the security page")
        .clone();
    let text = tree_text(&page);
    assert!(text.contains("Set up"), "{text}");
    assert!(
        text.contains("This app can't read where your master key is kept yet."),
        "{text}"
    );
    let mut actions = Vec::new();
    handled(&page, &mut actions);
    assert_eq!(
        actions,
        ["we-button:Back"],
        "Security offers more than Back"
    );
    open.click("Back");
    assert_eq!(
        open.controller.public_json(),
        before,
        "a page changed the store"
    );
}

/// Acceptance: a closed door says why, the reason that holds first: the
/// executor is not up, its agent is locked, the network can't publish
/// (Create only), or this app has no identity window yet. A door called
/// anyway runs nothing and says the same reason.
#[test]
fn blocked_and_locked_doors_explain_why() {
    let doors = |open: &Open| {
        let snap = open.controller.public_json();
        ["make", "link", "words"].map(|door| {
            (
                snap["doors"][door]["open"].as_bool().unwrap(),
                snap["doors"][door]["note"].as_str().unwrap().to_string(),
            )
        })
    };

    let mut open = owned(Arc::new(MemoryCell::default()));
    assert_eq!(
        doors(&open),
        [
            (false, NOT_UP.to_string()),
            (false, NOT_UP.into()),
            (false, NOT_UP.into())
        ]
    );

    open.ready_with(Some(AgentState::Locked), Ok(empty()));
    assert_eq!(open.stage(), "first-run");
    assert_eq!(
        doors(&open),
        [
            (false, LOCKED.to_string()),
            (false, LOCKED.into()),
            (false, LOCKED.into())
        ]
    );
    assert!(open.text().contains(LOCKED));
    assert!(disabled(&mut open, "Create new identity"));
    assert!(!disabled(&mut open, "Skip for now"));

    let mut open = owned(Arc::new(MemoryCell::default()));
    let blocked = IdentityFacts {
        store_trusted: false,
        ..empty()
    };
    open.ready_with(UNLOCKED, Ok(blocked));
    assert_eq!(
        doors(&open),
        [
            (false, NO_STORE.to_string()),
            (false, LATER.into()),
            (false, LATER.into())
        ]
    );
    assert_eq!(open.controller.public_json()["blocked"], NO_STORE);
    let text = open.text();
    assert!(text.contains(NO_STORE) && text.contains(LATER), "{text}");

    // Called anyway (the gate permits the target; the button is disabled):
    // nothing runs, and the first run says why.
    let generation = open.controller.generation();
    let command = we_session::command_for("baseStore.makeIdentity", &[]).unwrap();
    assert!(open.controller.apply_base(command, generation).is_none());
    let snap = open.controller.public_json();
    assert_eq!(snap["lastOutcome"], "failed");
    assert_eq!(snap["error"], NO_STORE);
    assert_eq!(open.stage(), "first-run");
}

/// Acceptance: no phrase and no key identifier in the store or on any
/// screen. The DID is the store's (B tests `did != ''`, as TS does), but no
/// screen or page draws it; device rows carry no key id.
#[test]
fn no_identifier_is_drawn() {
    let mut open = owned(Arc::new(MemoryCell::default()));
    open.ready_with(UNLOCKED, Ok(made()));
    let snap = open.controller.public_json();
    for row in snap["devices"].as_array().unwrap() {
        assert!(
            row.get("keyId").is_none(),
            "a device row carries a key id: {row}"
        );
    }
    let mut screens = vec![open.text()];
    for page in ["Devices", "Security"] {
        open.click(page);
        screens.push(open.text());
        open.click("Back");
    }
    let tail = &DID[DID.rfind(':').unwrap() + 1..];
    for text in &screens {
        assert!(!text.contains(tail), "the DID is drawn:\n{text}");
        assert!(!text.contains(&tail[..4]), "a short DID is drawn:\n{text}");
    }
}

/// A read that failed (the executor had no agent yet) is read again when
/// the agent's state changes while the list shows; the same state twice
/// reads nothing.
#[test]
fn a_failed_read_is_read_again_when_the_agent_changes() {
    let mut open = owned(Arc::new(MemoryCell::default()));
    open.ready_with(None, Err("no agent".into()));
    assert_eq!(open.stage(), "connect");
    open.controller
        .note_executor(ExecutorState::Ready { agent: None });
    assert_eq!(
        open.controller.identity_read_due(),
        None,
        "the same state read again"
    );
    open.controller
        .note_executor(ExecutorState::Ready { agent: UNLOCKED });
    assert_eq!(open.stage(), "loading");
    let read = open.controller.identity_read_due().expect("read again");
    open.controller.note_identity(read, Ok(empty()));
    assert_eq!(open.stage(), "first-run");
    // The old failure is not said over the answer.
    assert_eq!(open.controller.public_json()["error"], "");
    assert!(!open.text().contains("Couldn't read your identity"));
    // A known identity is not read again on an agent change.
    open.controller.note_executor(ExecutorState::Ready {
        agent: Some(AgentState::Locked),
    });
    assert_eq!(open.controller.identity_read_due(), None);
    assert_eq!(open.stage(), "first-run");
}

/// "Try again" clicked twice in one frame (one permit, used twice) after a
/// failed read: one read, and nothing is dialed past it. The loading stage
/// is busy and a new generation, as a connect attempt is.
#[test]
fn a_retry_permit_used_twice_does_not_skip_the_read() {
    let mut open = owned(Arc::new(MemoryCell::holding("this-device")));
    open.controller
        .note_executor(ExecutorState::Ready { agent: UNLOCKED });
    let read = open.controller.identity_read_due().unwrap();
    // A failure goes on to the remembered place, which refuses: the list,
    // with the reason, so "Try again" shows.
    let job = open
        .controller
        .note_identity(read, Err("no answer".into()))
        .expect("the remembered place");
    assert!(open.controller.note_refused(job.attempt, "Not now."));
    let root = open.root();
    let again = find_button(&root, "Try again").expect("Try again");
    open.session.dispatch(&again, "onClick", Value::Undefined);
    open.session.dispatch(&again, "onClick", Value::Undefined);
    assert_eq!(open.stage(), "loading");
    assert_eq!(open.dials(), 0, "a dial went past the identity read");
    assert_ne!(job.attempt, 0);
    assert!(open.controller.identity_read_due().is_some());
    assert!(
        open.controller.facts().busy,
        "the loading stage takes calls"
    );
}
