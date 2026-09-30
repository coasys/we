//! Account commands.
//!
//! Every mutation is registry-only; nothing takes effect until `restart_app` relaunches, because
//! the executor is configured with one data path at startup and holds it for its lifetime.

use crate::accounts::{Account, AccountRegistry, ExecutorSettings, ExecutorSettingsUpdate};
use crate::app_state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Vec<Account> {
    registry(&state).list()
}

#[tauri::command]
pub fn create_account(state: State<'_, AppState>) -> Result<Account, String> {
    registry(&state).create()
}

/// What an account is shown as. Both fields optional — an edit to one must not clear the other.
#[derive(serde::Deserialize)]
pub struct AccountDisplay {
    pub name: Option<String>,
    pub avatar: Option<String>,
}

#[tauri::command]
pub fn set_account_display(
    id: String,
    display: AccountDisplay,
    state: State<'_, AppState>,
) -> Result<(), String> {
    registry(&state).set_display(&id, display.name.as_deref(), display.avatar.as_deref())
}

#[tauri::command]
pub fn select_account(id: String, state: State<'_, AppState>) -> Result<(), String> {
    registry(&state).select(&id)
}

#[tauri::command]
pub fn remove_account(id: String, state: State<'_, AppState>) -> Result<(), String> {
    registry(&state).remove(&id)
}

/// Make the selected account take effect.
///
/// A full relaunch, unlike Electron — which respawns just the executor and reloads its window.
/// The executor runs in-process here, and its own graceful shutdown ends in `std::process::exit`,
/// so there is no way to stop it that does not take this app with it. Narrowing this to a reload
/// needs an upstream change: a shutdown that returns instead of exiting, and a `run()` that can be
/// called a second time against fresh global state.
#[tauri::command]
pub fn apply_account_selection(app_handle: tauri::AppHandle) {
    // The executor is configured with one data path at startup and holds it for its lifetime, and
    // here it runs *in* this process — so switching accounts means replacing the process. Electron
    // can respawn a child executor and merely reload its window; this host cannot.
    //
    // A note for anyone debugging this in `pnpm tauri:dev`: restarting exits the binary, and if the
    // vite server is owned by `tauri dev` as a `beforeDevCommand`, the CLI treats that exit as the
    // app closing and shuts the server down with it. The relaunched binary then loads a devUrl that
    // no longer exists and shows "Connection refused" on a white screen. The dev script therefore
    // runs vite alongside rather than under the CLI. Packaged builds serve the bundled frontend and
    // were never affected.
    app_handle.restart();
}

/// Settings the executor reads at startup — see `ExecutorSettings`.
#[tauri::command]
pub fn get_executor_settings(state: State<'_, AppState>) -> ExecutorSettings {
    registry(&state).executor_settings()
}

#[tauri::command]
pub fn set_executor_settings(
    settings: ExecutorSettingsUpdate,
    state: State<'_, AppState>,
) -> Result<ExecutorSettings, String> {
    registry(&state).set_executor_settings(settings)
}

/// A path on this machine, for the backend to write to or read from.
///
/// The executor's export and import take a path on its own filesystem, and it runs in this process
/// — so this is the one place that can turn "somewhere to put it" into something it can use. Kept
/// on the Rust side rather than exposed through the dialog plugin's JS bridge, which would mean
/// granting the renderer a capability it has no other use for.
#[tauri::command]
pub async fn choose_file(
    save: bool,
    default_name: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle.dialog().file().add_filter("JSON", &["json"]);
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }

    // The blocking variants must not run on the main thread; a command already runs off it, but
    // saying so here keeps that true if this ever moves.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        if save {
            builder.blocking_save_file()
        } else {
            builder.blocking_pick_file()
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    // A path outside the local filesystem cannot be handed to the executor, and on desktop there is
    // no such thing — `into_path` fails only for the mobile content-URI case.
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

/// Start the executor over so written settings take effect.
///
/// A full relaunch, for the same reason `apply_account_selection` is one: the executor runs in this
/// process and its shutdown ends in `std::process::exit`.
#[tauri::command]
pub fn restart_executor(app_handle: tauri::AppHandle) {
    app_handle.restart();
}

fn registry(state: &State<'_, AppState>) -> AccountRegistry {
    AccountRegistry::new(state.config_dir.clone(), state.default_data_path.clone())
}
