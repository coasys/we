use tauri::State;
use crate::app_state::AppState;

#[tauri::command]
pub fn get_port(state: State<'_, AppState>) -> u16 {
    state.graphql_port
}

#[tauri::command]
pub fn request_credential(state: State<'_, AppState>) -> String {
    state.req_credential.clone()
}