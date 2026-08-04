mod app_state;
mod commands;
mod app_server;
mod generated;

// Declared by path rather than through `generated/mod.rs`: that module is only emitted on the
// generator's embedded-apps path, while this file is emitted on both and is always read here.
#[path = "generated/seed_runtime.rs"]
mod seed_runtime;

use app_state::AppState;
use rust_executor::utils::find_port;
use rust_executor::Ad4mConfig;
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

/// Where the executor keeps its data: the agent's keys, datasets and settings.
///
/// Precedence is env → seed → `~/.ad4m`. The env var is the ad-hoc override — testing the
/// first-run flow means starting against an empty directory, and doing that by moving the real
/// `~/.ad4m` aside risks the agent you actually use. The seed value is the deployment default,
/// baked in at build time by `scripts/generate-seed-config.cjs`.
///
/// The default is the launcher's own directory, so out of the box WE desktop, Flux and ADAM share
/// one agent. Changing it is a data migration rather than a preference — see `SeedConfig.ad4m`.
fn resolve_ad4m_data_path() -> PathBuf {
    let home = dirs::home_dir().expect("Failed to get home directory");

    let configured = std::env::var("WE_AD4M_DATA_PATH")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| seed_runtime::AD4M_DATA_PATH.to_string());

    expand_home(&configured, &home)
}

/// Expands a leading `~`. Only leading — `~` elsewhere in a path is a literal character.
fn expand_home(path: &str, home: &std::path::Path) -> PathBuf {
    if path == "~" {
        return home.to_path_buf();
    }
    match path.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(path),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Find a free port for the GraphQL server
    let graphql_port = find_port(12000, 13000)
        .expect("Failed to find free port");
    
    // Generate a credential token
    let req_credential = Uuid::new_v4().to_string();
    
    // Where the executor keeps its data — seed-configured, env-overridable.
    let app_data_path = resolve_ad4m_data_path();
    println!("AD4M data path: {}", app_data_path.display());
    
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
            
            // Dev tools are hidden by default
            // Uncomment to enable in development:
            // #[cfg(debug_assertions)]
            // {
            //     let window = app.get_webview_window("main").unwrap();
            //     window.open_devtools();
            // }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
