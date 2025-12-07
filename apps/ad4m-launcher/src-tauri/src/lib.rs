mod app_state;
mod commands;

use app_state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // For now, just use a fixed port for testing
    let state = AppState {
        graphql_port: 4000,
        req_credential: "test-credential-token".to_string(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::state::get_port,
            commands::state::request_credential
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}