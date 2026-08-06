//! Account commands.
//!
//! Every mutation is registry-only; nothing takes effect until `restart_app` relaunches, because
//! the executor is configured with one data path at startup and holds it for its lifetime.

use crate::accounts::{Account, AccountRegistry};
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

fn registry(state: &State<'_, AppState>) -> AccountRegistry {
    AccountRegistry::new(state.config_dir.clone(), state.default_data_path.clone())
}
