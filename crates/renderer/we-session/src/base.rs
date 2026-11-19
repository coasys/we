//! The connect screen's public store.
//!
//! The template is the pinned Coasys base cartridge
//! (`data/coasys-base.pin`). This module serves `baseStore` to that mount
//! and keeps the stage the template reads. It does not dial an executor
//! and it does not hold a token. The host starts a connect attempt only
//! when [`BaseController::apply`] returns a [`HostJob`].

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use we_expr::{BundleSlot, MountCx, Provenance, Tier, Value};
use we_template::{BindingSource, Bound, DataRevision, Invalidator, RootDomain, SchemaNode};

/// The bundle id the host stamps on the built-in base mount.
pub const BUILTIN_BUNDLE: &str = "coasys";

/// What the offline screen says when this computer does not answer.
pub const UNREACHABLE: &str = "Coasys isn't responding.";

/// What the connect stage says when a choose names no row of the list.
pub const NOT_LISTED: &str = "That option isn't available anymore.";

/// What the offline stage says when a place off this computer is chosen
/// while the host reports no network.
pub const NO_NETWORK: &str = "This computer is offline.";

const DOOR_NOTE: &str = "Not available on this computer.";

/// Where the id of the connection chosen last is kept between starts.
///
/// The store keeps the id only. It never keeps an address or a credential:
/// the host's catalog maps the id to a place each time.
pub trait ChoiceMemory: Send + Sync {
    /// The id kept from the last start, if any.
    fn remembered(&self) -> Option<String>;
    /// Keep `id` for the next start.
    fn remember(&self, id: &str);
}

/// A [`ChoiceMemory`] that keeps nothing.
#[derive(Debug, Default)]
pub struct NoMemory;

impl ChoiceMemory for NoMemory {
    fn remembered(&self) -> Option<String> {
        None
    }

    fn remember(&self, _id: &str) {}
}

/// A [`ChoiceMemory`] in this process. Two controllers that share one
/// cell behave as two starts of the app.
#[derive(Debug, Default)]
pub struct MemoryCell(Mutex<Option<String>>);

impl MemoryCell {
    pub fn holding(id: &str) -> Self {
        Self(Mutex::new(Some(id.to_string())))
    }
}

impl ChoiceMemory for MemoryCell {
    fn remembered(&self) -> Option<String> {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn remember(&self, id: &str) {
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(id.to_string());
    }
}

/// Whether the host has a network. `None` from the host means unknown,
/// which counts as online.
pub type OnlineProbe = Arc<dyn Fn() -> bool + Send + Sync>;

/// One row of `baseStore.connections`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectionRow {
    pub id: Arc<str>,
    pub kind: Arc<str>,
    pub icon: Arc<str>,
    pub label: Arc<str>,
    pub detail: Arc<str>,
}

impl ConnectionRow {
    /// This computer, as the desktop host offers it.
    pub fn this_computer() -> Self {
        Self {
            id: "this-device".into(),
            kind: "this-device".into(),
            icon: "laptop".into(),
            label: "This computer".into(),
            detail: "Available while this computer is on".into(),
        }
    }

    /// A server the person keeps, as the desktop host lists it:
    /// `server:<address>`, labelled with its name or else its address.
    pub fn server(address: &str, name: Option<&str>) -> Self {
        let label = name.map(str::trim).filter(|name| !name.is_empty());
        Self {
            id: format!("server:{address}").into(),
            kind: "server".into(),
            icon: "hard-drives".into(),
            label: label.unwrap_or(address).into(),
            detail: address.into(),
        }
    }
}

/// The pinned base template. The connect screen always mounts this artifact.
pub fn coasys_base_template() -> SchemaNode {
    serde_json::from_str(include_str!("../data/coasys-base.json"))
        .expect("pinned coasys base template parses")
}

/// The node the connect screen mounts.
///
/// `bundle` selects the ordinary application. It does not select this screen.
pub fn base_template_for(bundle: &we_template::Bundle) -> SchemaNode {
    let _ = bundle;
    coasys_base_template()
}

/// `data:image/svg+xml` with the mark percent-encoded. No base64.
fn mark_url() -> String {
    let svg = include_str!("../data/coasys-mark.svg");
    let mut out = String::from("data:image/svg+xml,");
    for byte in svg.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                const HEX: &[u8; 16] = b"0123456789ABCDEF";
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0xf) as usize] as char);
            }
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Starting,
    Failed,
    Connect,
    HandingOff,
    Offline,
    Session,
}

impl Stage {
    fn as_str(self) -> &'static str {
        match self {
            Stage::Starting => "starting",
            Stage::Failed => "failed",
            Stage::Connect => "connect",
            Stage::HandingOff => "handing-off",
            Stage::Offline => "offline",
            Stage::Session => "session",
        }
    }
}

struct Inner {
    generation: u64,
    attempt: u64,
    busy: bool,
    stage: Stage,
    page: String,
    error: String,
    offline_reason: String,
    /// The id chosen this start or kept from the last one. Empty for none.
    /// A retry keeps it. This is the public `chosen` string, not [`HostJob::chosen`].
    chosen_id: String,
    rows: Vec<ConnectionRow>,
    /// Go straight to the place chosen when nothing else is due. Off once
    /// the person asked to see the list, or a session was refused.
    auto: bool,
    /// [`BaseController::resume`] runs once per start.
    resumed: bool,
    online: Option<OnlineProbe>,
    /// What the probe said last. A change to online with the offline
    /// stage up retries (see [`BaseController::poll_network`]).
    was_online: bool,
    /// The attempt whose connection the window holds now, `0` for none.
    /// A hand-back names it; one from an older session does nothing.
    session: u64,
    /// The executor this host runs, as last reported. `None`: the host
    /// runs none (it attaches to one someone else runs), and executor
    /// changes do nothing.
    executor: Option<ExecutorState>,
}

/// A connect attempt the host should start. `attempt` is the id a later
/// completion must quote. `chosen` is `true` for a click on a row and
/// `false` for a resume or a retry. `connection` is the catalog row to
/// reach: the host selects the endpoint from it, never from a remembered
/// address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostJob {
    pub attempt: u64,
    pub chosen: bool,
    pub connection: ConnectionRow,
}

/// How this computer's agent is, as the host's supervisor read it. Only
/// what the executor said: a locked agent is `Locked`, never a guess at
/// which password it waits on (that needs a keyring, slice 7).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentState {
    Unlocked,
    Locked,
}

/// The executor this host runs (TS `BaseExecutorState`). A host that
/// attaches to an executor someone else runs has none: it never reports
/// one of these.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExecutorState {
    Starting,
    /// Up. `agent` is `None` when the executor has no agent yet, or the
    /// supervisor could not read it.
    Ready {
        agent: Option<AgentState>,
    },
    /// Not running. `stopped`: it ran and then stopped (outside the app,
    /// or it crashed), rather than failing to start.
    Failed {
        reason: String,
        stopped: bool,
    },
}

/// Work a permitted call or an executor change asks the host to do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BaseJob {
    /// Reach a connection.
    Dial(HostJob),
    /// Start this computer's executor (the failed stage's button).
    StartExecutor,
}

/// A permitted base-store call, after the gate has checked the arguments.
#[derive(Clone, Debug)]
pub enum BaseCommand {
    Choose(String),
    Retry,
    ShowConnections,
    OpenPage(String),
    ClosePage,
    ClearPasswordWrong,
    /// Identity and password calls. The adapters are absent, so these
    /// change nothing.
    Nop,
}

/// The base-store call `target` names, when the argument list is one this
/// host accepts. The gate has already checked the same list.
pub fn command_for(target: &str, args: &[Value]) -> Option<BaseCommand> {
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

/// The stage machine. Pure: no runtime, no socket.
pub struct BaseController {
    inner: Mutex<Inner>,
    memory: Arc<dyn ChoiceMemory>,
    model: Arc<BaseModel>,
    builtin: Arc<str>,
    mark: String,
}

impl BaseController {
    /// A controller that keeps nothing between starts.
    pub fn new(builtin: impl Into<Arc<str>>, rows: Vec<ConnectionRow>) -> Arc<Self> {
        Self::with_memory(builtin, rows, Arc::new(NoMemory))
    }

    /// A controller that starts with the id `memory` kept and keeps each
    /// new choice there.
    pub fn with_memory(
        builtin: impl Into<Arc<str>>,
        rows: Vec<ConnectionRow>,
        memory: Arc<dyn ChoiceMemory>,
    ) -> Arc<Self> {
        let chosen_id = memory.remembered().unwrap_or_default();
        let this = Arc::new(Self {
            inner: Mutex::new(Inner {
                generation: 1,
                attempt: 0,
                busy: false,
                stage: Stage::Connect,
                page: String::new(),
                error: String::new(),
                offline_reason: String::new(),
                chosen_id,
                rows,
                auto: true,
                resumed: false,
                online: None,
                was_online: true,
                session: 0,
                executor: None,
            }),
            memory,
            model: Arc::new(BaseModel::new()),
            builtin: builtin.into(),
            mark: mark_url(),
        });
        this.publish(&this.lock());
        this
    }

    /// The host's network probe. Without one the network counts as up.
    /// This computer is reached whatever it says.
    pub fn set_online(&self, online: Option<OnlineProbe>) {
        self.lock().online = online;
    }

    /// At start: go straight to the remembered connection when it is still
    /// listed. The job is not a click (`chosen` is `false`). Runs once per
    /// start; a remembered id the list no longer has leaves the list up.
    pub fn resume(&self) -> Option<HostJob> {
        let mut inner = self.lock();
        if std::mem::replace(&mut inner.resumed, true) || !inner.auto || inner.busy {
            return None;
        }
        // The host's own executor is not up yet: its ready resumes instead
        // ([`BaseController::note_executor`]).
        if inner
            .executor
            .as_ref()
            .is_some_and(|state| !matches!(state, ExecutorState::Ready { .. }))
        {
            return None;
        }
        let row = chosen_row(&inner)?;
        let job = reach(&mut inner, row, false);
        self.publish(&inner);
        job
    }

    /// This computer, mounted as [`BUILTIN_BUNDLE`].
    pub fn with_this_computer() -> Arc<Self> {
        Self::new(BUILTIN_BUNDLE, vec![ConnectionRow::this_computer()])
    }

    pub fn bindings(self: &Arc<Self>) -> Arc<dyn BindingSource> {
        Arc::new(BaseBindings {
            builtin: self.builtin.clone(),
            model: self.model.clone(),
        })
    }

    pub fn facts(&self) -> we_template::BasePermitFacts {
        let inner = self.lock();
        we_template::BasePermitFacts {
            builtin: self.builtin.clone(),
            generation: inner.generation,
            catalog: inner.rows.iter().map(|row| row.id.clone()).collect(),
            busy: inner.busy,
        }
    }

    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    /// The public snapshot as JSON. String values are the words on screen.
    pub fn public_json(&self) -> serde_json::Value {
        let inner = self.lock();
        snap_json(&inner, &self.mark)
    }

    /// Apply a permitted call.
    ///
    /// `generation` is the permit's generation. It must equal the current
    /// generation. A connect call then advances the generation, so a second
    /// permit copied from the same dispatch no longer matches.
    /// A completion for an older attempt does not change this state.
    ///
    /// For a host that runs no executor: a call that asks for an executor
    /// start ([`BaseJob::StartExecutor`]) gives `None` here. A host that
    /// runs one uses [`BaseController::apply_base`].
    pub fn apply(&self, command: BaseCommand, generation: u64) -> Option<HostJob> {
        match self.apply_base(command, generation)? {
            BaseJob::Dial(job) => Some(job),
            BaseJob::StartExecutor => None,
        }
    }

    /// [`BaseController::apply`], for a host that may run its own executor:
    /// "Try again" / "Start Coasys" on the failed stage asks the host to
    /// start it, once. The stage turns to starting and the generation
    /// advances, so the same permit, or a retry while it starts, asks for
    /// nothing more.
    pub fn apply_base(&self, command: BaseCommand, generation: u64) -> Option<BaseJob> {
        let mut inner = self.lock();
        if inner.generation != generation {
            return None;
        }
        let exempt = matches!(
            command,
            BaseCommand::ClosePage | BaseCommand::ClearPasswordWrong
        );
        if inner.busy && !exempt {
            return None;
        }
        if matches!(command, BaseCommand::Retry) {
            match inner.executor {
                Some(ExecutorState::Failed { .. }) => {
                    inner.executor = Some(ExecutorState::Starting);
                    starting(&mut inner);
                    self.publish(&inner);
                    return Some(BaseJob::StartExecutor);
                }
                Some(ExecutorState::Starting) => return None,
                _ => {}
            }
        }
        let job = match command {
            BaseCommand::Choose(id) => {
                let Some(row) = inner.rows.iter().find(|row| row.id.as_ref() == id).cloned() else {
                    inner.stage = Stage::Connect;
                    inner.error = NOT_LISTED.to_string();
                    inner.offline_reason.clear();
                    inner.page.clear();
                    self.publish(&inner);
                    return None;
                };
                inner.chosen_id.clone_from(&id);
                self.memory.remember(&id);
                reach(&mut inner, row, true)
            }
            // Offline: the place chosen again. Otherwise what a start does:
            // the place chosen while the list is not asked for, else the list.
            BaseCommand::Retry => match chosen_row(&inner) {
                Some(row) if inner.stage == Stage::Offline || inner.auto => {
                    reach(&mut inner, row, false)
                }
                _ => {
                    inner.stage = Stage::Connect;
                    inner.error.clear();
                    inner.offline_reason.clear();
                    None
                }
            },
            BaseCommand::ShowConnections => {
                inner.auto = false;
                inner.stage = Stage::Connect;
                inner.busy = false;
                inner.error.clear();
                inner.offline_reason.clear();
                inner.page.clear();
                None
            }
            BaseCommand::OpenPage(page) => {
                inner.page = page;
                None
            }
            BaseCommand::ClosePage => {
                inner.page.clear();
                None
            }
            BaseCommand::ClearPasswordWrong | BaseCommand::Nop => None,
        };
        self.publish(&inner);
        job.map(BaseJob::Dial)
    }

    /// The host runs this computer's executor, which is now `state`. Call
    /// once, before [`BaseController::resume`]: until it is ready, the
    /// starting or failed stage shows and nothing is dialed.
    pub fn own_executor(&self, state: ExecutorState) {
        let mut inner = self.lock();
        inner.executor = Some(state);
        match inner.executor {
            Some(ExecutorState::Starting) => starting(&mut inner),
            Some(ExecutorState::Failed { .. }) => failed(&mut inner),
            _ => {}
        }
        self.publish(&inner);
    }

    /// The host's executor changed to `state` (TS `executor.subscribe`).
    /// Ignored when the host runs none.
    ///
    /// - Under an open session, a failure or a new start takes the window
    ///   back: the executor stopped (the failed stage, with the button that
    ///   starts it again) or is being started again (the starting stage;
    ///   ready then reaches the place chosen again). The session is closed
    ///   and the generation advances, as a hand-back does.
    /// - Ready twice is nothing new.
    /// - Otherwise the stage is worked out again: starting or failed, or,
    ///   once ready, the place chosen (not a click) or the list. A connect
    ///   in flight when the executor stopped or started again is spent: its
    ///   completion changes nothing.
    pub fn note_executor(&self, state: ExecutorState) -> Option<HostJob> {
        let mut inner = self.lock();
        let before = inner.executor.clone()?;
        inner.executor = Some(state.clone());
        if inner.stage == Stage::Session {
            // The session's executor is gone: it stopped, or it is being
            // started again (it asked to be restarted, a new process on a
            // new port). Unlike TS, starting takes the window back too.
            match state {
                ExecutorState::Failed { .. } => {
                    let session = inner.session;
                    hand_back(&mut inner, session);
                    failed(&mut inner);
                }
                ExecutorState::Starting => {
                    let session = inner.session;
                    hand_back(&mut inner, session);
                    starting(&mut inner);
                }
                ExecutorState::Ready { .. } => {}
            }
            self.publish(&inner);
            return None;
        }
        let ready = |s: &ExecutorState| matches!(s, ExecutorState::Ready { .. });
        if ready(&before) && ready(&state) {
            self.publish(&inner);
            return None;
        }
        let job = match state {
            ExecutorState::Starting => {
                starting(&mut inner);
                None
            }
            ExecutorState::Failed { .. } => {
                failed(&mut inner);
                None
            }
            ExecutorState::Ready { .. } => {
                inner.busy = false;
                match chosen_row(&inner) {
                    Some(row) if inner.auto => reach(&mut inner, row, false),
                    _ => {
                        inner.stage = Stage::Connect;
                        None
                    }
                }
            }
        };
        self.publish(&inner);
        job
    }

    /// Whether a session holds the window.
    pub fn in_session(&self) -> bool {
        self.lock().stage == Stage::Session
    }

    /// The lost-connection banner asked to dial again. This is not a
    /// template click. `chosen` on the job is `false`.
    pub fn start_reconnect(&self) -> HostJob {
        let mut inner = self.lock();
        let row = chosen_row(&inner)
            .or_else(|| inner.rows.first().cloned())
            .expect("the catalog lists this computer");
        let job = begin_attempt(&mut inner, false, row).expect("generation advances");
        self.publish(&inner);
        job
    }

    /// `attempt` connected. `true` when it is the attempt in flight, which
    /// now holds the window as a session; `false` when it was spent (an
    /// executor change, a newer attempt): the host must drop that
    /// connection, not adopt it.
    pub fn note_connected(&self, attempt: u64) -> bool {
        if self.finish(attempt, Stage::Session, "", "") {
            self.lock().session = attempt;
            return true;
        }
        false
    }

    /// Whether `attempt` is still the one in flight or the open session.
    /// A flow for any other attempt is obsolete.
    pub fn is_current(&self, attempt: u64) -> bool {
        let inner = self.lock();
        attempt != 0
            && (inner.attempt == attempt
                || (inner.stage == Stage::Session && inner.session == attempt))
    }

    /// `false` when `attempt` is not the one in flight (it was already
    /// completed, or a newer one replaced it).
    pub fn note_unreachable(&self, attempt: u64) -> bool {
        self.finish(attempt, Stage::Offline, "", UNREACHABLE)
    }

    pub fn note_refused(&self, attempt: u64, reason: &str) -> bool {
        self.finish(attempt, Stage::Connect, reason, "")
    }

    pub fn note_locked(&self, attempt: u64, sentence: &str) {
        self.finish(attempt, Stage::Connect, sentence, "");
    }

    /// The flow already handed the connection to the window, so the attempt
    /// id is spent. A later refusal of that same session (the launcher
    /// removed the grant) returns the screen to the list, with the reason.
    /// The list stays up: it does not jump back to the place that refused.
    /// A refusal for a session that is not the one open does nothing.
    pub fn note_adopted_refusal(&self, attempt: u64, reason: &str) -> bool {
        let mut inner = self.lock();
        if !hand_back(&mut inner, attempt) {
            return false;
        }
        inner.auto = false;
        inner.stage = Stage::Connect;
        inner.error = reason.to_string();
        inner.offline_reason.clear();
        self.publish(&inner);
        true
    }

    /// The session that `attempt` opened lost its executor (it stopped,
    /// or its socket stayed down). The offline stage takes the window back,
    /// with "Try again" for the place chosen. The host drops the session.
    /// `false` when that session is not the one open.
    pub fn note_session_lost(&self, attempt: u64) -> bool {
        let mut inner = self.lock();
        if !hand_back(&mut inner, attempt) {
            return false;
        }
        inner.stage = Stage::Offline;
        inner.error.clear();
        inner.offline_reason = UNREACHABLE.to_string();
        self.publish(&inner);
        true
    }

    /// Ask the host's probe again. When it changed to online while the
    /// offline stage is up, reach the place chosen again, as "Try again"
    /// would (TS: the window's `online` event). Not a click. Without a probe
    /// the network counts as online and this never starts anything.
    pub fn poll_network(&self) -> Option<HostJob> {
        let mut inner = self.lock();
        let probe = inner.online.clone()?;
        let up = probe();
        let was = std::mem::replace(&mut inner.was_online, up);
        if !up || was || inner.stage != Stage::Offline || inner.busy {
            return None;
        }
        let row = chosen_row(&inner)?;
        let job = reach(&mut inner, row, false);
        self.publish(&inner);
        job
    }

    /// Whether the host should keep asking [`BaseController::poll_network`]:
    /// a probe is set and the offline stage is up.
    pub fn watches_network(&self) -> bool {
        let inner = self.lock();
        inner.online.is_some() && inner.stage == Stage::Offline
    }

    fn finish(&self, attempt: u64, stage: Stage, error: &str, offline: &str) -> bool {
        let mut inner = self.lock();
        if attempt == 0 || inner.attempt != attempt {
            return false;
        }
        // One completion per attempt. A later note for this id does nothing.
        inner.attempt = 0;
        inner.busy = false;
        inner.stage = stage;
        inner.error = error.to_string();
        inner.offline_reason = offline.to_string();
        inner.page.clear();
        self.publish(&inner);
        true
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn publish(&self, inner: &Inner) {
        self.model.publish(snap_value(inner, &self.mark));
    }
}

/// Close the open session `attempt`, if it is the one open: no session,
/// not busy, no page, and a new generation, so a permit from before the
/// hand-back no longer matches.
fn hand_back(inner: &mut Inner, attempt: u64) -> bool {
    if attempt == 0 || inner.stage != Stage::Session || inner.session != attempt {
        return false;
    }
    inner.session = 0;
    inner.attempt = 0;
    inner.busy = false;
    inner.page.clear();
    inner.generation = inner.generation.saturating_add(1);
    true
}

/// The executor starts: the starting stage, busy, and any connect in
/// flight spent (a new generation, no attempt).
fn starting(inner: &mut Inner) {
    spend_attempt(inner);
    inner.busy = true;
    inner.stage = Stage::Starting;
}

/// The executor is not running: the failed stage, with its button.
fn failed(inner: &mut Inner) {
    spend_attempt(inner);
    inner.busy = false;
    inner.stage = Stage::Failed;
}

fn spend_attempt(inner: &mut Inner) {
    inner.attempt = 0;
    inner.session = 0;
    inner.page.clear();
    inner.error.clear();
    inner.offline_reason.clear();
    inner.generation = inner.generation.saturating_add(1);
}

fn chosen_row(inner: &Inner) -> Option<ConnectionRow> {
    inner
        .rows
        .iter()
        .find(|row| row.id.as_ref() == inner.chosen_id)
        .cloned()
}

/// Start reaching `row`, unless it is off this computer and the host
/// reports no network: then the offline stage says so and nothing starts.
fn reach(inner: &mut Inner, row: ConnectionRow, chosen: bool) -> Option<HostJob> {
    let offline = inner.online.as_ref().is_some_and(|online| !online());
    if offline && row.kind.as_ref() != ConnectionRow::this_computer().kind.as_ref() {
        inner.was_online = false;
        inner.busy = false;
        inner.stage = Stage::Offline;
        inner.error.clear();
        inner.offline_reason = NO_NETWORK.to_string();
        inner.page.clear();
        return None;
    }
    begin_attempt(inner, chosen, row)
}

fn begin_attempt(inner: &mut Inner, chosen: bool, connection: ConnectionRow) -> Option<HostJob> {
    let next = inner.generation.checked_add(1)?;
    inner.generation = next;
    inner.attempt = next;
    inner.session = 0;
    inner.busy = true;
    inner.stage = Stage::HandingOff;
    inner.error.clear();
    inner.offline_reason.clear();
    inner.page.clear();
    Some(HostJob {
        attempt: next,
        chosen,
        connection,
    })
}

fn snap_json(inner: &Inner, mark: &str) -> serde_json::Value {
    let connections: Vec<_> = inner
        .rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.id.as_ref(),
                "kind": row.kind.as_ref(),
                "icon": row.icon.as_ref(),
                "label": row.label.as_ref(),
                "detail": row.detail.as_ref(),
                "chosen": row.id.as_ref() == inner.chosen_id,
            })
        })
        .collect();
    let door = || serde_json::json!({ "open": false, "note": DOOR_NOTE });
    serde_json::json!({
        "stage": inner.stage.as_str(),
        "page": inner.page,
        "hostKind": "computer",
        "deviceNoun": "computer",
        "brand": { "mark": mark, "name": "Coasys" },
        "identityKnown": false,
        "did": "",
        "didShort": "",
        "unpublished": "",
        "hasIdentity": false,
        "holdsMaster": false,
        "keepsLine": false,
        "blocked": "",
        "doors": { "link": door(), "make": door(), "words": door() },
        "devices": [],
        "executorPhase": match &inner.executor {
            None => "",
            Some(ExecutorState::Starting) => "starting",
            Some(ExecutorState::Ready { .. }) => "ready",
            Some(ExecutorState::Failed { .. }) => "failed",
        },
        "executorReason": match &inner.executor {
            Some(ExecutorState::Failed { reason, .. }) => reason.as_str(),
            _ => "",
        },
        "executorStopped": matches!(
            inner.executor,
            Some(ExecutorState::Failed { stopped: true, .. })
        ),
        "connections": connections,
        "chosen": inner.chosen_id,
        "busy": inner.busy,
        "lastOutcome": "",
        "error": inner.error,
        "offlineReason": inner.offline_reason,
        "passwordIsNew": false,
        "passwordWrong": false,
        "passwordEntered": false,
        "passwordConfirmed": false,
    })
}

fn snap_value(inner: &Inner, mark: &str) -> Value {
    Value::from_json(&serde_json::json!({ "$namespace": snap_json(inner, mark) }))
}

struct BaseModel {
    snap: Mutex<Value>,
    revision: AtomicU64,
    invalidators: Mutex<Vec<Invalidator>>,
}

impl BaseModel {
    fn new() -> Self {
        Self {
            snap: Mutex::new(Value::Undefined),
            revision: AtomicU64::new(0),
            invalidators: Mutex::new(Vec::new()),
        }
    }

    fn publish(&self, value: Value) {
        *self.snap.lock().unwrap_or_else(|p| p.into_inner()) = value;
        self.revision.fetch_add(1, Ordering::AcqRel);
        let invalidators = self.invalidators.lock().unwrap_or_else(|p| p.into_inner());
        for invalidator in invalidators.iter() {
            invalidator.invalidate();
        }
    }

    fn current(&self) -> Value {
        self.snap.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn revision(&self) -> u64 {
        self.revision.load(Ordering::Acquire)
    }

    fn subscribe(&self, invalidator: Invalidator) {
        self.invalidators
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(invalidator);
    }
}

/// Serves `baseStore` to the built-in base mount only.
struct BaseBindings {
    builtin: Arc<str>,
    model: Arc<BaseModel>,
}

impl std::fmt::Debug for BaseBindings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BaseBindings")
            .field("builtin", &self.builtin)
            .field("revision", &self.model.revision())
            .finish()
    }
}

impl DataRevision for BaseBindings {
    fn revision(&self) -> u64 {
        self.model.revision()
    }

    fn subscribe(&self, invalidator: Invalidator) {
        self.model.subscribe(invalidator);
    }
}

impl BindingSource for BaseBindings {
    fn root(&self, name: &str, mount: &MountCx) -> Option<Bound> {
        if name != "baseStore" || !trusted(mount, &self.builtin) {
            return None;
        }
        Some(Bound {
            value: self.model.current(),
            members: None,
            domain: Some(RootDomain::App),
        })
    }

    fn profile(&self, _did: &str, _mount: &MountCx) -> Option<Value> {
        None
    }
}

fn trusted(mount: &MountCx, builtin: &str) -> bool {
    mount.tier >= Tier::App
        && matches!(
            &mount.provenance,
            Provenance::Bundle { bundle, slot: BundleSlot::Base } if bundle.as_ref() == builtin
        )
}
