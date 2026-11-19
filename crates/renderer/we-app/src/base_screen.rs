//! The base connect screen: the pinned template, drawn by [`RendererApp`],
//! and a host that dials This computer through [`ConnectFlow`].
//!
//! The flow starts when the template calls `baseStore.choose` or
//! `baseStore.retry`, when the lost-connection banner asks to reconnect,
//! and when the window opens with a remembered place still listed (a
//! resume, not a click). Every start goes through [`select`]: a server is
//! refused with its reason and nothing is dialed.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use we_ad4m::base::{select, BaseFile};
use we_ad4m::connect::{Ask, ConnectFlow, ConnectPhase, ConnectSettings, FailureKind, GrantScope};
use we_ad4m::identity::Identity;
use we_ad4m::supervisor::{Agent, Lifecycle, Supervisor, SupervisorConfig};
use we_ad4m::Connection;
use we_egui::Registry;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{
    AgentState, BaseController, BaseJob, ChoiceMemory, ConnectionRow, ExecutorState, HostJob,
    IdentityDevice, IdentityFacts, NoMemory,
};
use we_template::{Action, ActionRequest, Completer, Host, Invoked, RootSpec, StoreBag};

use crate::RendererApp;

/// This computer's executor, when the app runs it: what the base screen
/// reads and asks of it. [`Supervisor`] is the real one; tests give a
/// stand-in. A window attached to an executor someone else runs has none.
pub trait OwnedExecutor: Send + Sync {
    fn state(&self) -> ExecutorState;
    /// Grows on every change [`OwnedExecutor::state`] reports.
    fn changes(&self) -> u64;
    /// Start it; `false` when one already runs or starts.
    fn start(&self) -> bool;
    /// Read its state again; an answer older than a change is dropped.
    fn refresh(&self);
    /// Where it listens, once it does.
    fn url(&self) -> Option<String>;
    /// Called on every change, from the supervisor's threads.
    fn set_waker(&self, waker: Arc<dyn Fn() + Send + Sync>);
    /// How many times a process was started.
    fn starts(&self) -> u64;
    fn pid(&self) -> Option<u32>;
    /// Approve the window's own capability request `request_id` for
    /// `scope`, as the operator; the code that redeems it. Blocks.
    fn approve(&self, request_id: &str, scope: &GrantScope) -> Result<String, String>;
    /// Which process this is: grows with every executor process started
    /// (a start, a restart). `0` before the first.
    fn incarnation(&self) -> u64 {
        0
    }
    /// The state and the process it is about, read together.
    fn state_at(&self) -> (ExecutorState, u64) {
        (self.state(), self.incarnation())
    }
    /// The identity's public facts, read as the operator, while it is
    /// ready. Blocks.
    fn identity(&self) -> Result<Identity, String> {
        Err("this executor reads no identity".into())
    }
}

/// The supervisor's state as the controller reads it.
fn lifecycle_state(state: Lifecycle) -> ExecutorState {
    match state {
        Lifecycle::Starting => ExecutorState::Starting,
        Lifecycle::Ready { agent } => ExecutorState::Ready {
            agent: agent.map(|agent| match agent {
                Agent::Unlocked => AgentState::Unlocked,
                Agent::Locked => AgentState::Locked,
            }),
        },
        Lifecycle::Failed { reason, stopped } => ExecutorState::Failed { reason, stopped },
    }
}

impl OwnedExecutor for Supervisor {
    fn state(&self) -> ExecutorState {
        lifecycle_state(Supervisor::state(self))
    }

    fn changes(&self) -> u64 {
        Supervisor::changes(self)
    }

    fn start(&self) -> bool {
        Supervisor::start(self)
    }

    fn refresh(&self) {
        Supervisor::refresh(self)
    }

    fn url(&self) -> Option<String> {
        Supervisor::url(self)
    }

    fn set_waker(&self, waker: Arc<dyn Fn() + Send + Sync>) {
        Supervisor::set_waker(self, waker)
    }

    fn starts(&self) -> u64 {
        Supervisor::starts(self)
    }

    fn pid(&self) -> Option<u32> {
        Supervisor::pid(self)
    }

    fn approve(&self, request_id: &str, scope: &GrantScope) -> Result<String, String> {
        Supervisor::approve(self, request_id, scope)
    }

    fn incarnation(&self) -> u64 {
        Supervisor::incarnation(self)
    }

    fn state_at(&self) -> (ExecutorState, u64) {
        let (state, run) = Supervisor::state_at(self);
        (lifecycle_state(state), run)
    }

    fn identity(&self) -> Result<Identity, String> {
        Supervisor::identity(self)
    }
}

/// Where this window's executor comes from.
pub enum Owned {
    /// Run one: the window starts it at once and stops it on close.
    Run(SupervisorConfig),
    /// One someone gave the window (tests).
    Given(Arc<dyn OwnedExecutor>),
}

/// What the window asks of a connect flow. [`ConnectFlow`] is the real
/// one; unit tests put a stand-in in the slot.
trait LiveConnect: Send {
    fn phase(&self) -> ConnectPhase;
    fn answer(&self, text: String);
    fn take_connection(&self) -> Option<Connection>;
}

impl LiveConnect for ConnectFlow {
    fn phase(&self) -> ConnectPhase {
        ConnectFlow::phase(self)
    }

    fn answer(&self, text: String) {
        ConnectFlow::answer(self, text)
    }

    fn take_connection(&self) -> Option<Connection> {
        ConnectFlow::take_connection(self)
    }
}

struct LiveFlow {
    flow: Box<dyn LiveConnect>,
    attempt: u64,
    /// The address the flow dials (`--executor-url` or the owned one).
    url: Option<String>,
}

type IdentityAnswer = (u64, Result<IdentityFacts, String>);

struct SlotState {
    live: Option<LiveFlow>,
    /// The phase already applied. `None` after a new flow starts, so the
    /// next poll applies that flow's phase even when the words match the
    /// previous failure.
    seen: Option<ConnectPhase>,
}

/// The connect screen and the flow it owns.
pub struct BaseScreen {
    pub app: RendererApp,
    controller: Arc<BaseController>,
    slot: Arc<Mutex<SlotState>>,
    handle: tokio::runtime::Handle,
    settings: ConnectSettings,
    ctx: egui::Context,
    ready: Option<(Connection, String)>,
    /// This computer's executor, when the window runs it, and how many of
    /// its changes the controller has seen.
    owned: Option<Arc<dyn OwnedExecutor>>,
    owned_seen: u64,
    /// The answer to the identity read that is out, by its token, once it
    /// came (read off the UI thread, applied in [`BaseScreen::poll`]).
    identity_answer: Arc<Mutex<Option<IdentityAnswer>>>,
    /// The capability request of the window's own flow that the owned
    /// executor's operator is approving (`false`) or failed to (`true`).
    approving: Arc<Mutex<Option<(String, bool)>>>,
    /// Kept last so the runtime outlives the session that holds its handle.
    /// Nothing reads the field. Drop is the use.
    #[allow(dead_code)]
    rt: we_ad4m::Runtime,
}

impl BaseScreen {
    /// `remember` is the base file: the place chosen last and the servers
    /// listed. `None` keeps nothing.
    /// `owned` is this computer's executor when the window runs it: the
    /// starting and failed screens show until it is ready, This computer
    /// dials it where it listens, and "Start Coasys" starts it again.
    pub fn open_owned(
        ctx: egui::Context,
        bundle: &we_template::Bundle,
        settings: ConnectSettings,
        remember: Option<PathBuf>,
        owned: Option<Owned>,
    ) -> Self {
        let rt = we_ad4m::Runtime::new().expect("the adapter runtime starts");
        let handle = rt.handle();
        let owned: Option<Arc<dyn OwnedExecutor>> = match owned {
            Some(Owned::Run(config)) => {
                let supervisor = Arc::new(Supervisor::new(config, handle.clone()));
                supervisor.start();
                Some(supervisor)
            }
            Some(Owned::Given(owned)) => Some(owned),
            None => None,
        };
        let servers = remember
            .as_deref()
            .map(BaseFile::load)
            .unwrap_or_default()
            .servers;
        let rows = we_ad4m::base::catalog(&settings, &servers)
            .into_iter()
            .map(|offer| ConnectionRow {
                id: offer.id.into(),
                kind: offer.kind.into(),
                icon: offer.icon.into(),
                label: offer.label.into(),
                detail: offer.detail.into(),
            })
            .collect();
        let memory: Arc<dyn ChoiceMemory> = match remember {
            Some(path) => Arc::new(FileMemory(path)),
            None => Arc::new(NoMemory),
        };
        let controller = BaseController::with_memory(we_session::BUILTIN_BUNDLE, rows, memory);
        // Changes first, then the state: a change between the two is seen
        // again at the next poll.
        let owned_seen = owned.as_ref().map_or(0, |owned| owned.changes());
        if let Some(owned) = &owned {
            // The executor this window runs is the identity source: its
            // operator reads the identity's public facts.
            controller.keep_identity();
            let ctx_wake = ctx.clone();
            owned.set_waker(Arc::new(move || ctx_wake.request_repaint()));
            let (state, run) = owned.state_at();
            controller.own_executor_run(state, run);
        }
        let slot = Arc::new(Mutex::new(SlotState {
            live: None,
            seen: None,
        }));
        let registry = Registry::with_builtins();
        let types: std::collections::HashSet<&'static str> = registry.type_names().collect();
        let spec = RootSpec::base(
            we_session::base_template_for(bundle),
            we_session::BUILTIN_BUNDLE,
        );
        let host = Box::new(BaseHost {
            controller: controller.clone(),
            settings: settings.clone(),
            owned: owned.clone(),
            jobs: Jobs::Dial {
                slot: slot.clone(),
                handle: handle.clone(),
                ctx: ctx.clone(),
            },
        });
        let mut session = we_session::Session::new(
            spec,
            Arc::new(StoreBag::new()),
            ScreenState::desktop(ScreenSchema::default(), "/"),
            host,
        )
        .with_dollar_types(move |ty| types.contains(ty));
        let ctx_wake = ctx.clone();
        session.set_waker(Arc::new(move || ctx_wake.request_repaint()));
        session.set_bindings(controller.bindings());
        session.set_base_facts(Some(controller.facts()));
        let mut app = RendererApp::from_session(session, registry);
        if let Some(theme) = crate::gallery::load_theme_set().get("glow").cloned() {
            app.theme = theme;
        }
        let mut this = Self {
            app,
            controller,
            slot,
            handle,
            settings,
            ctx,
            ready: None,
            owned,
            owned_seen,
            identity_answer: Arc::default(),
            approving: Arc::default(),
            rt,
        };
        if let Some(job) = this.controller.resume() {
            this.spawn(job);
        }
        this.sync_facts();
        this
    }

    /// Draw the template. Facts update after the frame's events, so the
    /// next frame's dispatch sees the generation this frame advanced.
    pub fn frame(&mut self, ui: &mut egui::Ui) {
        self.app.frame_body(ui);
        self.sync_facts();
    }

    /// Apply a phase change. A quiet poll does not touch the snapshot.
    ///
    /// Also asks the host's network probe, if there is one, while the
    /// offline stage is up. The desktop app sets none: an omitted probe
    /// counts as online, so nothing retries by itself and "Try again" is
    /// the way back.
    pub fn poll(&mut self) {
        // The executor this window runs: each change it reports, newest
        // only (TS `executor.subscribe`).
        if let Some(owned) = self.owned.clone() {
            let changes = owned.changes();
            if changes != self.owned_seen {
                self.owned_seen = changes;
                // State and process together: a restart the window never
                // saw as Starting still spends the old session and flow.
                let (state, run) = owned.state_at();
                let job = self.controller.note_executor_run(state, run);
                self.drop_obsolete_flow();
                if let Some(job) = job {
                    self.spawn(job);
                }
                self.sync_facts();
            }
        }
        if let Some(owned) = self.owned.clone() {
            self.read_identity(owned.clone());
            self.approve_own_request(owned);
        }
        if let Some(job) = self.controller.poll_network() {
            self.spawn(job);
            self.sync_facts();
        }
        if self.controller.watches_network() {
            self.ctx
                .request_repaint_after(std::time::Duration::from_secs(1));
        }
        let observed = {
            let mut slot = lock_slot(&self.slot);
            let Some(live) = slot.live.as_ref() else {
                return;
            };
            let phase = live.flow.phase();
            if slot.seen.as_ref() == Some(&phase) {
                return;
            }
            let attempt = live.attempt;
            let taken = match &phase {
                ConnectPhase::Connected { .. } => live.flow.take_connection(),
                _ => None,
            };
            if taken.is_some() || !matches!(phase, ConnectPhase::Connected { .. }) {
                slot.seen = Some(phase.clone());
            }
            (attempt, phase, taken)
        };
        let (attempt, phase, taken) = observed;
        if let ConnectPhase::Connected { url } = &phase {
            // Adopted only when the controller accepts the attempt: a flow
            // that connected after its attempt was spent (the executor
            // stopped first) is dropped with its connection.
            if let Some(conn) = taken {
                if self.controller.note_connected(attempt) {
                    self.ready = Some((conn, url.clone()));
                }
            }
        } else {
            apply_phase(&self.controller, attempt, phase, self.owned.as_ref());
        }
        self.sync_facts();
    }

    /// The identity: a read the controller asks for runs off this thread,
    /// against the executor this window runs; its answer is applied here,
    /// on the next poll. A read the controller no longer waits for (the
    /// executor stopped or started again) stops asking, and its answer
    /// changes nothing ([`BaseController::note_identity`]).
    fn read_identity(&mut self, owned: Arc<dyn OwnedExecutor>) {
        let answer = self
            .identity_answer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        if let Some((read, answer)) = answer {
            if let Some(job) = self.controller.note_identity(read, answer) {
                self.spawn(job);
            }
            self.sync_facts();
        }
        let Some(read) = self.controller.identity_read_due() else {
            return;
        };
        let controller = self.controller.clone();
        let slot = self.identity_answer.clone();
        let ctx = self.ctx.clone();
        let spawned = std::thread::Builder::new()
            .name("we-identity-read".into())
            .spawn(move || {
                let mut answer = Err(String::new());
                for attempt in 0..IDENTITY_ATTEMPTS {
                    if !controller.is_reading(read) {
                        return;
                    }
                    answer = owned.identity().map(identity_facts);
                    if answer.is_ok() {
                        break;
                    }
                    if attempt + 1 < IDENTITY_ATTEMPTS {
                        std::thread::sleep(IDENTITY_RETRY);
                    }
                }
                *slot.lock().unwrap_or_else(|p| p.into_inner()) = Some((read, answer));
                ctx.request_repaint();
            });
        if let Err(e) = spawned {
            let answer = Err(format!("couldn't start the read: {e}"));
            if let Some(job) = self.controller.note_identity(read, answer) {
                self.spawn(job);
            }
            self.sync_facts();
        }
    }

    /// After an executor change: a flow whose attempt the controller spent
    /// is cancelled (dropped with its transport and any prompt), and a
    /// connection not yet taken by the window is let go.
    fn drop_obsolete_flow(&mut self) {
        let mut slot = lock_slot(&self.slot);
        if slot
            .live
            .as_ref()
            .is_some_and(|live| !self.controller.is_current(live.attempt))
        {
            slot.live = None;
            slot.seen = None;
        }
        if !self.controller.in_session() {
            self.ready = None;
        }
    }

    /// The phase of the flow the window keeps, as it says it now. Reading
    /// it changes nothing (the phase is applied in [`BaseScreen::poll`]).
    pub fn flow_phase(&self) -> Option<ConnectPhase> {
        lock_slot(&self.slot)
            .live
            .as_ref()
            .map(|live| live.flow.phase())
    }

    /// The executor this window runs, if any.
    pub fn owned(&self) -> Option<&Arc<dyn OwnedExecutor>> {
        self.owned.as_ref()
    }

    /// Whether a session holds the window. `false` once the base took it
    /// back (the executor this window runs stopped under it).
    pub fn holds_session(&self) -> bool {
        self.controller.in_session()
    }

    pub fn take_ready(&mut self) -> Option<(Connection, String)> {
        self.ready.take()
    }

    pub fn is_failed(&self) -> bool {
        matches!(
            lock_slot(&self.slot)
                .live
                .as_ref()
                .map(|live| live.flow.phase()),
            Some(ConnectPhase::Failed { .. })
        )
    }

    /// What the flow asks the person, if anything. Not the owned
    /// executor's code while its operator approves the request: the prompt
    /// shows only if that approval failed.
    pub fn ask(&self) -> Option<(Ask, Option<String>)> {
        let phase = lock_slot(&self.slot)
            .live
            .as_ref()
            .map(|live| live.flow.phase());
        match phase {
            Some(ConnectPhase::Asking { ask, note }) => {
                if let Ask::CapabilityCode { request_id } = &ask {
                    let approving = self.approving.lock().unwrap_or_else(|p| p.into_inner());
                    if matches!(&*approving, Some((id, false)) if id == request_id) {
                        return None;
                    }
                }
                Some((ask, note))
            }
            _ => None,
        }
    }

    /// The window's own flow asks the executor this window runs for a
    /// capability: there is no launcher to approve it, so the operator
    /// (the supervisor, with the admin credential) approves that request,
    /// once, for the grant the flow asked for, and answers its code. Only a
    /// flow that dials the owned executor's address; never a request the
    /// flow did not make. If the approval fails, the code prompt shows.
    fn approve_own_request(&self, owned: Arc<dyn OwnedExecutor>) {
        let (attempt, request_id) = {
            let slot = lock_slot(&self.slot);
            let Some(live) = slot.live.as_ref() else {
                return;
            };
            let ConnectPhase::Asking {
                ask: Ask::CapabilityCode { request_id },
                ..
            } = live.flow.phase()
            else {
                return;
            };
            if !dials_owned(live.url.as_deref(), owned.url().as_deref()) {
                return;
            }
            (live.attempt, request_id)
        };
        {
            let mut approving = self.approving.lock().unwrap_or_else(|p| p.into_inner());
            if approving.as_ref().is_some_and(|(id, _)| *id == request_id) {
                return;
            }
            *approving = Some((request_id.clone(), false));
        }
        let scope = self.settings.scope.clone();
        let slot = self.slot.clone();
        let approving = self.approving.clone();
        let ctx = self.ctx.clone();
        let spawned = std::thread::Builder::new()
            .name("we-executor-approve".into())
            .spawn(move || {
                match owned.approve(&request_id, &scope) {
                    Ok(code) => {
                        let slot = lock_slot(&slot);
                        if let Some(live) = slot.live.as_ref().filter(|l| l.attempt == attempt) {
                            live.flow.answer(code);
                        }
                    }
                    Err(e) => {
                        log::warn!("the executor's operator could not approve this app: {e}");
                        *approving.lock().unwrap_or_else(|p| p.into_inner()) =
                            Some((request_id, true));
                    }
                }
                ctx.request_repaint();
            });
        if spawned.is_err() {
            if let Some((_, failed)) = self
                .approving
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .as_mut()
            {
                *failed = true;
            }
        }
    }

    pub fn answer(&self, text: String) {
        if let Some(live) = lock_slot(&self.slot).live.as_ref() {
            live.flow.answer(text);
        }
    }

    /// The attempt id of the flow on screen, or `0` when none is running.
    pub fn attempt(&self) -> u64 {
        lock_slot(&self.slot)
            .live
            .as_ref()
            .map(|live| live.attempt)
            .unwrap_or(0)
    }

    /// The lost-connection banner. Dial again and show the handing-off stage.
    pub fn start_reconnect(&mut self) {
        let job = self.controller.start_reconnect();
        self.spawn(job);
        self.sync_facts();
    }

    fn sync_facts(&mut self) {
        self.app
            .session
            .set_base_facts(Some(self.controller.facts()));
    }

    fn spawn(&mut self, job: HostJob) {
        if let Some(dial) = endpoint(&self.controller, &self.settings, self.owned.as_ref(), &job) {
            spawn_flow(&self.slot, &self.handle, dial, &self.ctx, job.attempt);
        }
    }
}

/// Whether the flow dials the executor this window runs: only then may the
/// supervisor approve its capability request. Two unknown addresses are not
/// the same address.
fn dials_owned(flow: Option<&str>, owned: Option<&str>) -> bool {
    flow.is_some() && flow == owned
}

/// What a flow's phase (other than Connected) does to the base store.
/// `attempt` is the flow's attempt id: a phase of an attempt that is no
/// longer the current one, or of a session that is no longer open,
/// changes nothing.
///
/// The failure's kind decides; its words are only shown. No answer is the
/// offline stage, for the attempt in flight or for the session it opened
/// (the executor stopped under it). Anything else (a refusal, something
/// that is not an executor) is the list with the reason; a refused
/// session does not jump back to the place that refused it.
///
/// With an executor this window runs (`owned`), a locked agent is said as
/// that executor's ("Coasys on this computer is locked"), not as a
/// launcher's, and its state is read again; so is it after a lost session
/// (TS `lookAgain`).
fn apply_phase(
    controller: &BaseController,
    attempt: u64,
    phase: ConnectPhase,
    owned: Option<&Arc<dyn OwnedExecutor>>,
) {
    match phase {
        ConnectPhase::Failed {
            kind: FailureKind::Unreachable,
            ..
        } => {
            if !controller.note_unreachable(attempt) && controller.note_session_lost(attempt) {
                if let Some(owned) = owned {
                    owned.refresh();
                }
            }
        }
        ConnectPhase::Failed { reason, .. } => {
            if !controller.note_refused(attempt, &reason) {
                controller.note_adopted_refusal(attempt, &reason);
            }
        }
        ConnectPhase::Locked { url } => {
            let sentence = match owned {
                Some(owned) => {
                    owned.refresh();
                    OWNED_LOCKED.to_string()
                }
                None => format!(
                    "The executor at {} is locked. Unlock it in the AD4M launcher, then retry.",
                    we_ad4m::connect::redact_url(&url)
                ),
            };
            controller.note_locked(attempt, &sentence);
        }
        ConnectPhase::Connected { .. }
        | ConnectPhase::Searching
        | ConnectPhase::Checking
        | ConnectPhase::Asking { .. } => {}
    }
}

/// What the list says when the agent of the executor this window runs is
/// locked. This app cannot unlock it yet (slice 7: the password).
pub(crate) use we_session::OWNED_LOCKED;

/// How often the identity is asked before the read counts as failed, and
/// how far apart (TS `identityAttempts` / `identityRetryMs`, fewer: the
/// executor already answered its health check when this is asked).
const IDENTITY_ATTEMPTS: u32 = 3;
const IDENTITY_RETRY: std::time::Duration = std::time::Duration::from_millis(300);

/// The public facts the controller keeps, from what the executor said:
/// whether each device is this computer's, and nothing of its keys.
fn identity_facts(identity: Identity) -> IdentityFacts {
    IdentityFacts {
        did: identity.did,
        store_trusted: identity.store_trusted,
        devices: identity
            .devices
            .into_iter()
            .map(|device| IdentityDevice {
                this_device: device.this_device,
            })
            .collect(),
    }
}

/// The settings `job` dials, or `None` when its row is refused. A refusal
/// is the connect stage's reason; nothing is dialed, so this computer's
/// tokens never go to the place refused.
///
/// With an executor this window runs, This computer is that executor, at
/// the address it listens on now (its port may change between starts).
fn endpoint(
    controller: &BaseController,
    settings: &ConnectSettings,
    owned: Option<&Arc<dyn OwnedExecutor>>,
    job: &HostJob,
) -> Option<ConnectSettings> {
    let row = &job.connection;
    let mut settings = settings.clone();
    if let Some(url) = owned.and_then(|owned| owned.url()) {
        settings.url = Some(url);
    }
    match select(&row.kind, &row.label, &settings) {
        Ok(dial) => Some(dial),
        Err(reason) => {
            controller.note_refused(job.attempt, &reason);
            None
        }
    }
}

/// The base file as the controller's memory. The file keeps the id only.
///
/// The controller calls `remember` while it holds its lock, so the write
/// goes to [`BaseWrites`] and a click never waits on the disk.
struct FileMemory(PathBuf);

impl ChoiceMemory for FileMemory {
    fn remembered(&self) -> Option<String> {
        BaseWrites::get().settle(&self.0);
        BaseFile::load(&self.0).connection
    }

    fn remember(&self, id: &str) {
        BaseWrites::get().ask(&self.0, Some(id), false);
    }

    fn skipped(&self) -> bool {
        BaseWrites::get().settle(&self.0);
        BaseFile::load(&self.0).skipped_identity
    }

    fn remember_skip(&self) {
        BaseWrites::get().ask(&self.0, None, true);
    }
}

/// This process's base-file writes, made one at a time on one thread.
///
/// A path has at most one id waiting, the newest, so the last choice asked
/// for is the last one written. Each write is still one whole document
/// ([`BaseFile::remember`]); between processes the last rename wins.
#[derive(Default)]
struct BaseWrites {
    state: Mutex<WriteState>,
    changed: std::sync::Condvar,
}

/// What waits to be written to one base file: the newest id chosen, and
/// whether "Skip for now" is to be kept.
#[derive(Clone, Debug, Default)]
struct Pending {
    id: Option<String>,
    skip: bool,
}

#[derive(Default)]
struct WriteState {
    waiting: Vec<(PathBuf, Pending)>,
    writing: Option<PathBuf>,
    /// No writer thread: `ask` writes in place.
    inline: bool,
}

impl BaseWrites {
    fn get() -> &'static Self {
        static WRITES: std::sync::OnceLock<BaseWrites> = std::sync::OnceLock::new();
        WRITES.get_or_init(|| {
            let writes = Self::default();
            let spawned = std::thread::Builder::new()
                .name("we-base-file".into())
                .spawn(|| Self::get().run());
            if let Err(error) = spawned {
                log::warn!("we-app: no base-file thread, writing in place: {error}");
                writes.lock().inline = true;
            }
            writes
        })
    }

    fn lock(&self) -> MutexGuard<'_, WriteState> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn ask(&self, path: &std::path::Path, id: Option<&str>, skip: bool) {
        let mut state = self.lock();
        let ask = Pending {
            id: id.map(str::to_string),
            skip,
        };
        if state.inline {
            drop(state);
            return write_choice(path, &ask);
        }
        match state
            .waiting
            .iter_mut()
            .find(|(waiting, _)| waiting == path)
        {
            Some((_, pending)) => {
                if ask.id.is_some() {
                    pending.id = ask.id;
                }
                pending.skip |= ask.skip;
            }
            None => state.waiting.push((path.to_path_buf(), ask)),
        }
        self.changed.notify_all();
    }

    /// Wait until this process's writes to `path` have landed.
    fn settle(&self, path: &std::path::Path) {
        let mut state = self.lock();
        while state.writing.as_deref() == Some(path)
            || state.waiting.iter().any(|(waiting, _)| waiting == path)
        {
            state = self
                .changed
                .wait(state)
                .unwrap_or_else(|poison| poison.into_inner());
        }
    }

    fn run(&self) {
        let mut state = self.lock();
        loop {
            if state.waiting.is_empty() {
                state = self
                    .changed
                    .wait(state)
                    .unwrap_or_else(|poison| poison.into_inner());
                continue;
            }
            let (path, pending) = state.waiting.remove(0);
            state.writing = Some(path.clone());
            drop(state);
            write_choice(&path, &pending);
            state = self.lock();
            state.writing = None;
            self.changed.notify_all();
        }
    }
}

fn write_choice(path: &std::path::Path, pending: &Pending) {
    if let Some(id) = &pending.id {
        if let Err(error) = BaseFile::remember(path, id) {
            log::warn!("we-app: could not keep the connection chosen: {error}");
        }
    }
    if pending.skip {
        if let Err(error) = BaseFile::skip_identity(path) {
            log::warn!("we-app: could not keep \"Skip for now\": {error}");
        }
    }
}

fn lock_slot(slot: &Mutex<SlotState>) -> MutexGuard<'_, SlotState> {
    slot.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn spawn_flow(
    slot: &Mutex<SlotState>,
    handle: &tokio::runtime::Handle,
    settings: ConnectSettings,
    ctx: &egui::Context,
    attempt: u64,
) {
    let ctx = ctx.clone();
    let url = settings.url.clone();
    let flow = ConnectFlow::start(handle, settings, move || ctx.request_repaint());
    let mut slot = lock_slot(slot);
    slot.live = Some(LiveFlow {
        flow: Box::new(flow),
        attempt,
        url,
    });
    slot.seen = None;
}

/// Where a permitted connect job goes. The window dials. A test counts
/// the jobs and keeps the settings each dial would use.
enum Jobs {
    Dial {
        slot: Arc<Mutex<SlotState>>,
        handle: tokio::runtime::Handle,
        ctx: egui::Context,
    },
    #[cfg(test)]
    Count {
        jobs: Arc<Mutex<Vec<HostJob>>>,
        dials: Arc<Mutex<Vec<ConnectSettings>>>,
    },
}

struct BaseHost {
    controller: Arc<BaseController>,
    settings: ConnectSettings,
    owned: Option<Arc<dyn OwnedExecutor>>,
    jobs: Jobs,
}

impl BaseHost {
    #[cfg(test)]
    fn counting(controller: Arc<BaseController>, jobs: Arc<Mutex<Vec<HostJob>>>) -> Self {
        Self::counting_dials(controller, jobs, Arc::default(), ConnectSettings::default())
    }

    #[cfg(test)]
    fn counting_dials(
        controller: Arc<BaseController>,
        jobs: Arc<Mutex<Vec<HostJob>>>,
        dials: Arc<Mutex<Vec<ConnectSettings>>>,
        settings: ConnectSettings,
    ) -> Self {
        Self {
            controller,
            settings,
            owned: None,
            jobs: Jobs::Count { jobs, dials },
        }
    }

    fn start(&self, job: HostJob) {
        let Some(dial) = endpoint(&self.controller, &self.settings, self.owned.as_ref(), &job)
        else {
            return;
        };
        match &self.jobs {
            Jobs::Dial { slot, handle, ctx } => {
                spawn_flow(slot, handle, dial, ctx, job.attempt);
            }
            #[cfg(test)]
            Jobs::Count { jobs, dials } => {
                jobs.lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .push(job);
                dials
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .push(dial);
            }
        }
    }
}

impl Host for BaseHost {
    fn act(&mut self, request: ActionRequest, _done: Completer) -> Invoked {
        let Action::Invoke { target, args } = &request.action;
        let Some(permit) = &request.permit else {
            return Invoked::Done(Ok(Value::Undefined));
        };
        if permit.mount().as_str() != we_template::BASE_MOUNT {
            return Invoked::Done(Ok(Value::Undefined));
        }
        if !permit.matches(target, args) {
            return Invoked::Done(Ok(Value::Undefined));
        }
        let Some(command) = we_session::command_for(target, args) else {
            return Invoked::Done(Ok(Value::Undefined));
        };
        match self.controller.apply_base(command, permit.generation()) {
            Some(BaseJob::Dial(job)) => self.start(job),
            // Only a controller told of an executor asks for this.
            Some(BaseJob::StartExecutor) => {
                if let Some(owned) = &self.owned {
                    owned.start();
                }
            }
            None => {}
        }
        Invoked::Done(Ok(Value::Undefined))
    }
}

#[cfg(test)]
#[path = "base_host_tests.rs"]
mod tests;
