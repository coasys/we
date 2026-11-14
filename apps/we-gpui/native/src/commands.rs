//! The commands a page may call: the same names and arguments as the Tauri app's
//! (`apps/we-tauri/src-tauri/src/commands`), so the platform adapter is the same shape.
//!
//! Which window may call which: the custody commands by `we_custody::window::require`, the rule
//! the Tauri app checks too; everything else from the app window only.

use gpui_kit::{App, AsyncApp, PathPromptOptions};
use serde::Deserialize;
use serde_json::{Value, json};
use we_custody::window::{self as rule, MAIN};
use we_custody::{IdentityStep, StepInput};

use crate::accounts::ExecutorSettingsUpdate;
use crate::bridge::Request;
use crate::shell::{self, Shell};

/// The commands the custody rule owns; every other command belongs to the app window.
fn is_custody(command: &str) -> bool {
    rule::COMMANDS.iter().any(|(name, _)| *name == command)
}

/// Whether `label`'s window may call `command`.
pub fn allowed(command: &str, label: &str) -> Result<(), String> {
    if is_custody(command) {
        return rule::require(command, label).map_err(|e| e.to_string());
    }
    if label == MAIN {
        Ok(())
    } else {
        Err(format!("{command} is not callable from the window `{label}`"))
    }
}

fn arg<T: for<'de> Deserialize<'de>>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("argument `{name}`: {e}"))
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct AccountDisplay {
    name: Option<String>,
    avatar: Option<String>,
}

pub async fn dispatch(label: &'static str, request: Request, cx: &mut AsyncApp) -> Result<Value, String> {
    let command = request.cmd.as_str();
    allowed(command, label)?;
    let args = &request.args;
    let shell = cx.update(|cx| cx.global::<Shell>().clone());

    match command {
        "get_port" => Ok(json!(shell.port)),
        "request_credential" => Ok(json!(&*shell.credential)),

        "list_accounts" => to_value(shell.registry().list()),
        "create_account" => to_value(shell.registry().create()?),
        "set_account_display" => {
            let id: String = arg(args, "id")?;
            let display: AccountDisplay = arg(args, "display")?;
            shell
                .registry()
                .set_display(&id, display.name.as_deref(), display.avatar.as_deref())?;
            Ok(Value::Null)
        }
        "select_account" => {
            shell.registry().select(&arg::<String>(args, "id")?)?;
            Ok(Value::Null)
        }
        "remove_account" => {
            shell.registry().remove(&arg::<String>(args, "id")?)?;
            Ok(Value::Null)
        }
        // Electron's behaviour, not Tauri's: the executor is a child, so a switch restarts it and
        // reloads the page instead of relaunching the app.
        "apply_account_selection" | "restart_executor" => {
            restart(&shell, cx).await?;
            Ok(Value::Null)
        }
        "get_executor_settings" => to_value(shell.registry().executor_settings()),
        "set_executor_settings" => {
            let update: ExecutorSettingsUpdate = arg(args, "settings")?;
            to_value(shell.registry().set_executor_settings(update)?)
        }
        "choose_file" => {
            let save: bool = arg(args, "save").unwrap_or(false);
            let name: Option<String> = arg(args, "defaultName").unwrap_or(None);
            choose_file(save, name, cx).await
        }

        "identity_open" => {
            let step: IdentityStep = arg(args, "step")?;
            cx.update(|cx| identity_open(step, cx))
        }
        "identity_public_state" => {
            let custody = shell.custody.clone();
            let state = shell
                .runtime
                .spawn(async move { custody.public_state().await })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            to_value(state)
        }
        "identity_flow_start" => {
            let step = shell.identity.borrow().step.clone().ok_or("no step was asked for")?;
            let custody = shell.custody.clone();
            let screen = shell
                .runtime
                .spawn(async move { custody.start(step).await })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            remember(&shell, screen.outcome());
            to_value(screen)
        }
        "identity_flow_step" => {
            let input: StepInput = arg(args, "input")?;
            let custody = shell.custody.clone();
            let screen = shell
                .runtime
                .spawn(async move { custody.step(input).await })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            remember(&shell, screen.outcome());
            to_value(screen)
        }
        "identity_flow_cancel" => {
            let custody = shell.custody.clone();
            let _ = shell.runtime.spawn(async move { custody.cancel().await }).await;
            close_identity(&shell, cx);
            Ok(Value::Null)
        }
        "identity_flow_finish" => {
            close_identity(&shell, cx);
            Ok(Value::Null)
        }
        other => Err(format!("unknown command `{other}`")),
    }
}

fn remember(shell: &Shell, outcome: Option<we_custody::StepOutcome>) {
    if let Some(outcome) = outcome {
        shell.identity.borrow_mut().outcome = Some(outcome);
    }
}

fn close_identity(shell: &Shell, cx: &mut AsyncApp) {
    let window = shell.identity.borrow().window;
    if let Some(window) = window {
        cx.update(|cx| shell::close_webview_window(window, cx));
    }
}

/// Opens the identity window on `step`, or brings the open one forward: one at a time, and the
/// step already in it goes on.
fn identity_open(step: IdentityStep, cx: &mut App) -> Result<Value, String> {
    let shell = cx.global::<Shell>().clone();
    let open = shell.identity.borrow().window;
    if let Some(window) = open {
        let _ = window.update(cx, |_, window, _| window.activate_window());
        return Ok(json!({ "opened": false }));
    }
    {
        let mut slot = shell.identity.borrow_mut();
        slot.step = Some(step);
        slot.outcome = None;
    }
    match shell::open_identity(cx) {
        Ok(window) => {
            shell.identity.borrow_mut().window = Some(window);
            Ok(json!({ "opened": true }))
        }
        Err(e) => {
            shell.identity.borrow_mut().step = None;
            Err(format!("could not open the identity window: {e:#}"))
        }
    }
}

/// Stops the executor, starts it on the account and settings as they are now, and reloads the
/// app window so the page connects to it. Port and credential stay the same.
pub async fn restart(shell: &Shell, cx: &mut AsyncApp) -> Result<(), String> {
    let supervisor = shell.supervisor.clone();
    let launch = shell.launch();
    shell
        .runtime
        .spawn(async move {
            let stopping = supervisor.clone();
            tokio::task::spawn_blocking(move || stopping.stop())
                .await
                .map_err(|e| e.to_string())?;
            supervisor.start(launch).await
        })
        .await
        .map_err(|e| e.to_string())??;
    cx.update(shell::reload_main);
    Ok(())
}

/// A path on this machine for the executor to write to or read from (export and import), through
/// the platform's own dialog. JSON, as the Tauri command filters for.
async fn choose_file(save: bool, name: Option<String>, cx: &mut AsyncApp) -> Result<Value, String> {
    let home = crate::config::home_dir();
    let picked = if save {
        let answer = cx.update(|cx| cx.prompt_for_new_path(&home, name.as_deref()));
        answer
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    } else {
        let answer = cx.update(|cx| {
            cx.prompt_for_paths(PathPromptOptions {
                files: true,
                directories: false,
                multiple: false,
                prompt: None,
            })
        });
        answer
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
            .and_then(|paths| paths.into_iter().next())
    };
    Ok(json!(picked.map(|p| p.to_string_lossy().to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_custody::window::IDENTITY;

    #[test]
    fn the_app_window_may_not_run_an_identity_flow() {
        assert!(allowed("identity_flow_start", MAIN).is_err());
        assert!(allowed("identity_flow_step", MAIN).is_err());
        assert!(allowed("identity_open", MAIN).is_ok());
        assert!(allowed("identity_public_state", MAIN).is_ok());
    }

    #[test]
    fn the_identity_window_may_run_its_flow_and_nothing_else() {
        for command in [
            "identity_flow_start",
            "identity_flow_step",
            "identity_flow_cancel",
            "identity_flow_finish",
        ] {
            assert!(allowed(command, IDENTITY).is_ok(), "{command}");
        }
        for command in [
            "get_port",
            "request_credential",
            "list_accounts",
            "identity_open",
            "identity_public_state",
            "restart_executor",
        ] {
            assert!(allowed(command, IDENTITY).is_err(), "{command}");
        }
    }

    #[test]
    fn an_unknown_window_may_call_nothing() {
        assert!(allowed("get_port", "other").is_err());
        assert!(allowed("identity_flow_start", "other").is_err());
    }

    #[test]
    fn arguments_are_read_by_name() {
        let args = json!({ "id": "a", "display": { "name": "N" }, "step": { "kind": "create" } });
        assert_eq!(arg::<String>(&args, "id").unwrap(), "a");
        let display: AccountDisplay = arg(&args, "display").unwrap();
        assert_eq!(display.name.as_deref(), Some("N"));
        assert!(display.avatar.is_none());
        assert_eq!(arg::<IdentityStep>(&args, "step").unwrap(), IdentityStep::Create);
        assert!(arg::<String>(&args, "missing").is_err());
    }
}
