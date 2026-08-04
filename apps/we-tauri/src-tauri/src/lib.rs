mod accounts;
mod app_state;
mod commands;
mod app_server;
mod generated;

// Declared by path rather than through `generated/mod.rs`: that module is only emitted on the
// generator's embedded-apps path, while this file is emitted on both and is always read here.
#[path = "generated/seed_runtime.rs"]
mod seed_runtime;

use accounts::{expand_home, AccountRegistry};
use app_state::AppState;
use rust_executor::utils::find_port;
use rust_executor::Ad4mConfig;
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

/// The seed's data path — the deployment default, and the account the registry seeds itself with.
///
/// Baked in at build time by `scripts/generate-seed-config.cjs`. Defaults to the launcher's own
/// directory, so out of the box WE desktop, Flux and ADAM share one agent. See `SeedConfig.ad4m`.
fn seed_data_path(home: &std::path::Path) -> PathBuf {
    expand_home(seed_runtime::AD4M_DATA_PATH, home)
}

/// This app's own configuration directory — the account registry, and the directories of accounts
/// it created. Not inside any agent's data, so clearing an agent cannot destroy the list of the
/// others (which is exactly what the ADAM launcher's layout does).
fn config_dir() -> PathBuf {
    dirs::config_dir()
        .expect("Failed to get config directory")
        .join("we")
}

/// Where the executor keeps its data this launch.
///
/// Precedence is env → the selected account → the seed default (via the registry, which seeds
/// itself from it). The env var wins outright and bypasses the registry: it is the ad-hoc override
/// for testing a first run against a throwaway directory, and having that quietly register itself
/// as a permanent account would be a surprise.
fn resolve_ad4m_data_path(registry: &AccountRegistry, home: &std::path::Path) -> PathBuf {
    if let Some(from_env) = std::env::var("WE_AD4M_DATA_PATH")
        .ok()
        .filter(|value| !value.is_empty())
    {
        return expand_home(&from_env, home);
    }
    registry.resolve_active_path()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Find a free port for the GraphQL server
    let graphql_port = find_port(12000, 13000)
        .expect("Failed to find free port");
    
    // Generate a credential token
    let req_credential = Uuid::new_v4().to_string();
    
    let home = dirs::home_dir().expect("Failed to get home directory");
    let config_dir = config_dir();
    let default_data_path = seed_data_path(&home);

    // Where the executor keeps its data — the selected account, env-overridable.
    let registry = AccountRegistry::new(config_dir.clone(), default_data_path.clone());
    let app_data_path = resolve_ad4m_data_path(&registry, &home);
    println!("AD4M data path: {}", app_data_path.display());

    std::fs::create_dir_all(&app_data_path)
        .expect("Failed to create app data directory");

    // Initialize AD4M. Scaffolds the directory when it has never been used — which is now a
    // reachable state, since a newly created account starts as an empty directory.
    rust_executor::init::init(
        Some(app_data_path.to_str().unwrap().to_string()),
        None, // No bootstrap seed override — the account uses mainnet.
    ).expect("Failed to initialize AD4M");

    let state = AppState {
        graphql_port,
        req_credential: req_credential.clone(),
        config_dir,
        default_data_path,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::state::get_port,
            commands::state::request_credential,
            commands::accounts::list_accounts,
            commands::accounts::create_account,
            commands::accounts::rename_account,
            commands::accounts::select_account,
            commands::accounts::remove_account,
            commands::accounts::apply_account_selection
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
