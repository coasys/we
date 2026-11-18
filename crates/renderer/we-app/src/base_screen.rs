//! The base connect screen: the pinned template, drawn by [`RendererApp`],
//! and a host that dials This computer through [`ConnectFlow`].
//!
//! The flow starts when the template calls `baseStore.choose` or
//! `baseStore.retry`, and when the lost-connection banner asks to
//! reconnect. It does not start when the window opens.

use std::sync::{Arc, Mutex, MutexGuard};

use we_ad4m::base::{classify_failure, explicit_local_url, FailureClass};
use we_ad4m::connect::{Ask, ConnectFlow, ConnectPhase, ConnectSettings};
use we_ad4m::Connection;
use we_egui::Registry;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::{BaseController, ConnectionRow, HostJob};
use we_template::{Action, ActionRequest, Completer, Host, Invoked, RootSpec, StoreBag};

use crate::RendererApp;

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
    pub fn open(
        ctx: egui::Context,
        bundle: &we_template::Bundle,
        settings: ConnectSettings,
    ) -> Self {
        let rt = we_ad4m::Runtime::new().expect("the adapter runtime starts");
        let handle = rt.handle();
        let offer = we_ad4m::base::this_computer();
        let controller = BaseController::new(
            we_session::BUILTIN_BUNDLE,
            vec![ConnectionRow {
                id: offer.id.into(),
                kind: offer.kind.into(),
                icon: offer.icon.into(),
                label: offer.label.into(),
                detail: offer.detail.into(),
            }],
        );
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
            jobs: Jobs::Dial {
                slot: slot.clone(),
                handle: handle.clone(),
                settings: settings.clone(),
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
        Self {
            app,
            controller,
            slot,
            handle,
            settings,
            ctx,
            ready: None,
            rt,
        }
    }

    /// Draw the template. Facts update after the frame's events, so the
    /// next frame's dispatch sees the generation this frame advanced.
    pub fn frame(&mut self, ui: &mut egui::Ui) {
        self.app.frame_body(ui);
        self.sync_facts();
    }

    /// Apply a phase change. A quiet poll does not touch the snapshot.
    pub fn poll(&mut self) {
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
        match phase {
            ConnectPhase::Connected { url } => {
                if let Some(conn) = taken {
                    self.controller.note_connected(attempt);
                    self.ready = Some((conn, url));
                }
            }
            ConnectPhase::Failed { reason } => match classify_failure(&reason) {
                FailureClass::Unreachable => {
                    self.controller.note_unreachable(attempt);
                }
                FailureClass::Refused { reason } => {
                    if !self.controller.note_refused(attempt, &reason) {
                        self.controller.note_adopted_refusal(&reason);
                    }
                }
            },
            ConnectPhase::Locked { url } => {
                let sentence = format!(
                    "The executor at {} is locked. Unlock it in the AD4M launcher, then retry.",
                    we_ad4m::connect::redact_url(&url)
                );
                self.controller.note_locked(attempt, &sentence);
            }
            ConnectPhase::Searching | ConnectPhase::Checking | ConnectPhase::Asking { .. } => {}
        }
        self.sync_facts();
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
        spawn_flow(
            &self.slot,
            &self.handle,
            local_settings(&self.settings),
            &self.ctx,
            job.attempt,
        );
    }
}

fn local_settings(settings: &ConnectSettings) -> ConnectSettings {
    let mut settings = settings.clone();
    settings.url = Some(explicit_local_url(&settings));
    settings
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

/// Where a permitted connect job goes. The window dials. A test counts.
enum Jobs {
    Dial {
        slot: Arc<Mutex<SlotState>>,
        handle: tokio::runtime::Handle,
        settings: ConnectSettings,
        ctx: egui::Context,
    },
    #[cfg(test)]
    Count(Arc<Mutex<Vec<HostJob>>>),
}

struct BaseHost {
    controller: Arc<BaseController>,
    jobs: Jobs,
}

impl BaseHost {
    #[cfg(test)]
    fn counting(controller: Arc<BaseController>, jobs: Arc<Mutex<Vec<HostJob>>>) -> Self {
        Self {
            controller,
            jobs: Jobs::Count(jobs),
        }
    }

    fn start(&self, job: HostJob) {
        match &self.jobs {
            Jobs::Dial {
                slot,
                handle,
                settings,
                ctx,
            } => {
                spawn_flow(slot, handle, local_settings(settings), ctx, job.attempt);
            }
            #[cfg(test)]
            Jobs::Count(jobs) => {
                jobs.lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .push(job);
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
