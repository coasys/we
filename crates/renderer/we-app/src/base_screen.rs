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
use we_ad4m::connect::{Ask, ConnectFlow, ConnectPhase, ConnectSettings, FailureKind};
use we_ad4m::supervisor::{Agent, Lifecycle, Supervisor};
use we_ad4m::Connection;
use we_egui::Registry;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{
    AgentState, BaseController, ChoiceMemory, ConnectionRow, ExecutorState, HostJob, NoMemory,
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
}

impl OwnedExecutor for Supervisor {
    fn state(&self) -> ExecutorState {
        match Supervisor::state(self) {
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
}

struct LiveFlow {
    flow: ConnectFlow,
    attempt: u64,
}

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
    /// Kept last so the runtime outlives the session that holds its handle.
    /// Nothing reads the field. Drop is the use.
    #[allow(dead_code)]
    rt: we_ad4m::Runtime,
}

impl BaseScreen {
    /// `remember` is the base file: the place chosen last and the servers
    /// listed. `None` keeps nothing.
    /// `owned` is this computer's executor when the window runs it.
    pub fn open_owned(
        ctx: egui::Context,
        bundle: &we_template::Bundle,
        settings: ConnectSettings,
        remember: Option<PathBuf>,
        owned: Option<Arc<dyn OwnedExecutor>>,
    ) -> Self {
        let _ = owned;
        let rt = we_ad4m::Runtime::new().expect("the adapter runtime starts");
        let handle = rt.handle();
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
            if let Some(conn) = taken {
                self.controller.note_connected(attempt);
                self.ready = Some((conn, url.clone()));
            }
        } else {
            apply_phase(&self.controller, attempt, phase);
        }
        self.sync_facts();
    }

    /// The executor this window runs, if any.
    pub fn owned(&self) -> Option<&Arc<dyn OwnedExecutor>> {
        None
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

    pub fn ask(&self) -> Option<(Ask, Option<String>)> {
        match lock_slot(&self.slot)
            .live
            .as_ref()
            .map(|live| live.flow.phase())
        {
            Some(ConnectPhase::Asking { ask, note }) => Some((ask, note)),
            _ => None,
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
        if let Some(dial) = endpoint(&self.controller, &self.settings, &job) {
            spawn_flow(&self.slot, &self.handle, dial, &self.ctx, job.attempt);
        }
    }
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
fn apply_phase(controller: &BaseController, attempt: u64, phase: ConnectPhase) {
    match phase {
        ConnectPhase::Failed {
            kind: FailureKind::Unreachable,
            ..
        } => {
            if !controller.note_unreachable(attempt) {
                controller.note_session_lost(attempt);
            }
        }
        ConnectPhase::Failed { reason, .. } => {
            if !controller.note_refused(attempt, &reason) {
                controller.note_adopted_refusal(attempt, &reason);
            }
        }
        ConnectPhase::Locked { url } => {
            let sentence = format!(
                "The executor at {} is locked. Unlock it in the AD4M launcher, then retry.",
                we_ad4m::connect::redact_url(&url)
            );
            controller.note_locked(attempt, &sentence);
        }
        ConnectPhase::Connected { .. }
        | ConnectPhase::Searching
        | ConnectPhase::Checking
        | ConnectPhase::Asking { .. } => {}
    }
}

/// The settings `job` dials, or `None` when its row is refused. A refusal
/// is the connect stage's reason; nothing is dialed, so this computer's
/// tokens never go to the place refused.
fn endpoint(
    controller: &BaseController,
    settings: &ConnectSettings,
    job: &HostJob,
) -> Option<ConnectSettings> {
    let row = &job.connection;
    match select(&row.kind, &row.label, settings) {
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
        BaseWrites::get().ask(&self.0, id);
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

#[derive(Default)]
struct WriteState {
    waiting: Vec<(PathBuf, String)>,
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

    fn ask(&self, path: &std::path::Path, id: &str) {
        let mut state = self.lock();
        if state.inline {
            drop(state);
            return write_choice(path, id);
        }
        match state
            .waiting
            .iter_mut()
            .find(|(waiting, _)| waiting == path)
        {
            Some((_, newest)) => *newest = id.to_string(),
            None => state.waiting.push((path.to_path_buf(), id.to_string())),
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
            let (path, id) = state.waiting.remove(0);
            state.writing = Some(path.clone());
            drop(state);
            write_choice(&path, &id);
            state = self.lock();
            state.writing = None;
            self.changed.notify_all();
        }
    }
}

fn write_choice(path: &std::path::Path, id: &str) {
    if let Err(error) = BaseFile::remember(path, id) {
        log::warn!("we-app: could not keep the connection chosen: {error}");
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
    let flow = ConnectFlow::start(handle, settings, move || ctx.request_repaint());
    let mut slot = lock_slot(slot);
    slot.live = Some(LiveFlow { flow, attempt });
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
            jobs: Jobs::Count { jobs, dials },
        }
    }

    fn start(&self, job: HostJob) {
        let Some(dial) = endpoint(&self.controller, &self.settings, &job) else {
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
        if let Some(job) = self.controller.apply(command, permit.generation()) {
            self.start(job);
        }
        Invoked::Done(Ok(Value::Undefined))
    }
}

#[cfg(test)]
#[path = "base_host_tests.rs"]
mod tests;
