use crate::app_state::AppState;
use tauri::State;

#[tauri::command]
pub fn get_port(state: State<'_, AppState>) -> u16 {
    state.graphql_port
}

#[tauri::command]
pub fn request_credential(state: State<'_, AppState>) -> String {
    state.req_credential.clone()
}
