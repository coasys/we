//! The identity window's commands (AR-03 4.4.3) over the custody service in `we-custody`.
//!
//! The main window may call `identity_open` and `identity_public_state` and nothing else here; the
//! identity window calls the `identity_flow_*` commands and nothing else at all. The capabilities
//! say so (`capabilities/*.json`), and every handler checks its caller's label too
//! (`we_custody::window::require`), so a capability mistake fails closed.
//!
//! What crosses to the main window: that a step ended, and how (`identity-step-done`). Never a
//! screen — the words and the offer link stay in the identity window.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};
use we_custody::window::{self as rule, IDENTITY, MAIN};
use we_custody::{CustodyHandle, CustodyPublic, IdentityStep, Screen, StepInput, StepOutcome};

/// The custody service, the step the main window asked for, and how it ended.
pub struct IdentityState {
    custody: CustodyHandle,
    step: Arc<Mutex<Option<IdentityStep>>>,
    outcome: Arc<Mutex<Option<StepOutcome>>>,
}

impl IdentityState {
    pub fn new(custody: CustodyHandle) -> Self {
        IdentityState {
            custody,
            step: Arc::default(),
            outcome: Arc::default(),
        }
    }
}

fn check(command: &str, window: &Window) -> Result<(), String> {
    rule::require(command, window.label()).map_err(|e| e.to_string())
}

fn step_kind(step: &Option<IdentityStep>) -> &'static str {
    match step {
        Some(IdentityStep::Create) => "create",
        Some(IdentityStep::AddDevice) => "add-device",
        Some(IdentityStep::Revoke { .. }) => "revoke",
        None => "",
    }
}

/// Opens the identity window on `step`, or focuses the one already open. Carries no secret.
#[tauri::command]
pub async fn identity_open(
    app: AppHandle,
    window: Window,
    state: State<'_, IdentityState>,
    step: IdentityStep,
) -> Result<Value, String> {
    check("identity_open", &window)?;
    if let Some(open) = app.get_webview_window(IDENTITY) {
        // One identity window at a time: the step already in it goes on.
        let _ = open.set_focus();
        return Ok(json!({ "opened": false }));
    }
    *state.step.lock().map_err(|e| e.to_string())? = Some(step);
    *state.outcome.lock().map_err(|e| e.to_string())? = None;

    let identity = WebviewWindowBuilder::new(
        &app,
        IDENTITY,
        WebviewUrl::App("identity/index.html".into()),
    )
    .title("Coasys Identity")
    .inner_size(480.0, 640.0)
    .resizable(false)
    .focused(true)
    .center()
    // Its own bundle only; nothing a template or a post can point it at (AR-03 4.4.2).
    .on_navigation(|url| rule::identity_may_navigate(url.as_str()))
    .build()
    .map_err(|e| format!("could not open the identity window: {e}"))?;

    // Closing the window ends the step: an unfinished one is cancelled and wiped, and the main
    // window hears how it ended either way.
    let (custody, step, outcome, events) = (
        state.custody.clone(),
        state.step.clone(),
        state.outcome.clone(),
        app.clone(),
    );
    identity.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let ended = outcome
                .lock()
                .ok()
                .and_then(|o| *o)
                .unwrap_or(StepOutcome::Cancelled);
            let kind = step_kind(&step.lock().map(|s| s.clone()).unwrap_or(None));
            if ended == StepOutcome::Cancelled {
                let custody = custody.clone();
                tauri::async_runtime::spawn(async move { custody.cancel().await });
            }
            let _ = events.emit_to(
                MAIN,
                "identity-step-done",
                json!({ "step": kind, "outcome": ended }),
            );
        }
    });
    Ok(json!({ "opened": true }))
}

#[tauri::command]
pub async fn identity_public_state(
    window: Window,
    state: State<'_, IdentityState>,
) -> Result<CustodyPublic, String> {
    check("identity_public_state", &window)?;
    state
        .custody
        .public_state()
        .await
        .map_err(|e| e.to_string())
}

fn remember(state: &IdentityState, screen: &Screen) {
    if let Some(outcome) = screen.outcome() {
        if let Ok(mut slot) = state.outcome.lock() {
            *slot = Some(outcome);
        }
    }
}

/// Starts the step the main window opened this window for. The window cannot choose another.
#[tauri::command]
pub async fn identity_flow_start(
    window: Window,
    state: State<'_, IdentityState>,
) -> Result<Screen, String> {
    check("identity_flow_start", &window)?;
    let step = state
        .step
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("no step was asked for")?;
    let screen = state.custody.start(step).await.map_err(|e| e.to_string())?;
    remember(&state, &screen);
    Ok(screen)
}

#[tauri::command]
pub async fn identity_flow_step(
    window: Window,
    state: State<'_, IdentityState>,
    input: StepInput,
) -> Result<Screen, String> {
    check("identity_flow_step", &window)?;
    let screen = state.custody.step(input).await.map_err(|e| e.to_string())?;
    remember(&state, &screen);
    Ok(screen)
}

/// Cancels the step and closes the window.
#[tauri::command]
pub async fn identity_flow_cancel(
    window: Window,
    state: State<'_, IdentityState>,
) -> Result<(), String> {
    check("identity_flow_cancel", &window)?;
    state.custody.cancel().await;
    window.close().map_err(|e| e.to_string())
}

/// Closes the window after the step's last screen.
#[tauri::command]
pub async fn identity_flow_finish(window: Window) -> Result<(), String> {
    check("identity_flow_finish", &window)?;
    window.close().map_err(|e| e.to_string())
}
