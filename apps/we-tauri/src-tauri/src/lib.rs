mod app_state;
mod commands;
mod app_server;
mod generated;

use app_state::AppState;
use rust_executor::utils::find_port;
use rust_executor::Ad4mConfig;
use tauri::Manager;
use uuid::Uuid;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Find a free port for the GraphQL server
    let graphql_port = find_port(12000, 13000)
        .expect("Failed to find free port");
    
    // Generate a credential token
    let req_credential = Uuid::new_v4().to_string();
    
    // Get the users ad4m directory (~/.ad4m) to access existing agent data
    let app_data_path = dirs::home_dir()
        .expect("Failed to get home directory")
        .join(".ad4m");
    
    std::fs::create_dir_all(&app_data_path)
        .expect("Failed to create app data directory");
    
    // Initialize AD4M
    rust_executor::init::init(
        Some(app_data_path.to_str().unwrap().to_string()),
        None, // No bootstrap path needed - languages are in ~/.ad4m
    ).expect("Failed to initialize AD4M");
    
    let state = AppState {
        graphql_port,
        req_credential: req_credential.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::state::get_port,
            commands::state::request_credential
        ])
        .setup(move |app| {
            // Start embedded app HTTP servers (in production only)
            // Uses configuration generated from we-seed.json
            #[cfg(not(debug_assertions))]
            {
                let resource_path_result = app.path().resource_dir();
                if let Ok(resource_path) = resource_path_result {
                    generated::setup_seed_servers(resource_path);
                } else {
                    eprintln!("Warning: Failed to get resource directory");
                }
            }
            
            let config = Ad4mConfig {
                admin_credential: Some(req_credential.clone()),
                app_data_path: Some(app_data_path.to_str().unwrap().to_string()),
                gql_port: Some(graphql_port),
                run_dapp_server: Some(false), // Disabled - we serve the app ourselves
                connect_holochain: Some(true),
                ..Default::default()
            };
            
            // Start the executor in the background
            tauri::async_runtime::spawn(async move {
                rust_executor::run(config).await;
            });
            
            // Open devtools in development
            #[cfg(not(target_os = "android"))]
            #[cfg(not(target_os = "ios"))]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
