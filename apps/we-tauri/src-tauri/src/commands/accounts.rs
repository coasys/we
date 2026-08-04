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

#[tauri::command]
pub fn rename_account(id: String, name: String, state: State<'_, AppState>) -> Result<(), String> {
    registry(&state).rename(&id, &name)
}

#[tauri::command]
pub fn select_account(id: String, state: State<'_, AppState>) -> Result<(), String> {
    registry(&state).select(&id)
}

#[tauri::command]
pub fn remove_account(id: String, state: State<'_, AppState>) -> Result<(), String> {
    registry(&state).remove(&id)
}

#[tauri::command]
pub fn restart_app(app_handle: tauri::AppHandle) {
    // The executor runs in-process here (unlike Electron, which spawns a binary and must kill it
    // first), so a plain restart is enough — the process going away takes it with it.
    app_handle.restart();
}

fn registry(state: &State<'_, AppState>) -> AccountRegistry {
    AccountRegistry::new(state.config_dir.clone(), state.default_data_path.clone())
}
