mod accounts;
mod app_server;
mod app_state;
mod commands;
mod executor_log;
mod generated;

// Declared by path rather than through `generated/mod.rs`: that module is only emitted on the
// generator's embedded-apps path, while this file is emitted on both and is always read here.
#[path = "generated/seed_runtime.rs"]
mod seed_runtime;

use accounts::{expand_home, AccountRegistry};
use app_state::AppState;
use executor_log::ExecutorLog;
use rust_executor::utils::find_port;
use rust_executor::{Ad4mConfig, Secret};
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

/// This app's own configuration directory.
///
/// No longer where accounts or the registry live — both moved into the data path's container, so
/// that one `mv` resets everything and every host reads the same list. All that is left here is
/// the pre-container layout, which `AccountRegistry` migrates out of on first run.
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
/// Let the webview reach the camera and microphone — and nothing else.
///
/// Calls did not work on Linux at all: both `getUserMedia` attempts failed with `NotAllowedError`,
/// which is WebKitGTK's answer when either the media settings are off or nothing answers its
/// permission request. Tauri leaves both to the application, and this application had not set them,
/// so the answer was always no. Electron's equivalents are in `main.js`; this is the same decision
/// for the other desktop host.
///
/// The permission handler is an allowlist for the same reason that one is: `UserMediaPermissionRequest`
/// is granted and every other kind — geolocation, notifications, pointer lock, and whatever WebKit
/// adds next — is refused rather than left to a default. Returning `true` from the callback means
/// "handled", so a refusal is a decision rather than a timeout.
///
/// Linux only. macOS and Windows use their own webviews, which take their answer from the OS
/// privacy settings and need nothing here.
#[cfg(target_os = "linux")]
fn enable_media(app: &tauri::App) {
    use webkit2gtk::glib::object::Cast;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        eprintln!("we: no main window to enable media on");
        return;
    };

    if let Err(error) = window.with_webview(|webview| {
        let view = webview.inner();

        if let Some(settings) = WebViewExt::settings(&view) {
            // `enable_media_stream` is what `getUserMedia` itself is gated on; `enable_webrtc` is
            // what the peer connection needs. Off by default in WebKitGTK, and independent — with
            // only the first, devices open and no call connects.
            settings.set_enable_media_stream(true);
            settings.set_enable_webrtc(true);
            settings.set_enable_media(true);
        }

        view.connect_permission_request(|_, request| {
            let wants_media = request
                .downcast_ref::<UserMediaPermissionRequest>()
                .is_some();
            if wants_media {
                request.allow();
            } else {
                request.deny();
            }
            true
        });
    }) {
        eprintln!("we: could not configure the webview for media: {error}");
    }
}

pub fn run() {
    // Find a free port for the GraphQL server
    let graphql_port = find_port(12000, 13000).expect("Failed to find free port");

    // Generate a credential token
    let req_credential = Uuid::new_v4().to_string();

    let home = dirs::home_dir().expect("Failed to get home directory");
    let config_dir = config_dir();
    let default_data_path = seed_data_path(&home);

    // Where the executor keeps its data — the selected account, env-overridable.
    let registry = AccountRegistry::new(config_dir.clone(), default_data_path.clone());
    // Clear out any account whose setup was abandoned last session before choosing one.
    registry.prune_abandoned();
    let app_data_path = resolve_ad4m_data_path(&registry, &home);
    // Read before the builder takes ownership of the state — the executor is configured once, in
    // the setup hook below, and nothing it is given can be changed after that.
    let executor_settings = registry.executor_settings();

    // Log levels reach the executor as `RUST_LOG`, which its own logging setup reads and, finding
    // set, leaves alone. Only the user's overrides go in — anything unnamed keeps the executor's
    // default. An inherited `RUST_LOG` always wins: someone who exported one before launching is
    // debugging something specific, and a settings screen quietly overriding that would be the
    // opposite of helpful.
    if !executor_settings.log_levels.is_empty() && std::env::var("RUST_LOG").is_err() {
        let rust_log =
            rust_executor::logging::build_rust_log_from_config(&executor_settings.log_levels);
        std::env::set_var("RUST_LOG", rust_log);
    }

    std::fs::create_dir_all(&app_data_path).expect("Failed to create app data directory");

    // This run's log, in the account's data directory — see `executor_log.rs`. Installed as the
    // executor's logger here, before anything logs: the executor sets up its own stdout logger when
    // `run` starts, and skips that when one is already in place. Before `init` too, because a first
    // run is the one most worth having a record of. After `RUST_LOG`, which the logger reads once.
    // Every start of the executor is a start of this process — a restart relaunches the app — so
    // rotating here rotates once per run, as the Electron host does.
    let log = ExecutorLog::open(&app_data_path);
    if let Err(error) = rust_executor::logging::init_launcher_logging(Box::new(log.clone()), None) {
        eprintln!("[main] Could not install the executor log as its logger: {error}");
    }
    log.install_panic_hook();
    log.host(&format!("AD4M data path: {}", app_data_path.display()));
    log.host(&format!("Executor log: {}", log.path().display()));

    // Scaffold the directory only when the executor has never run against it, matching the
    // electron host's `ensureDataPathInitialised`. `init` is idempotent apart from one branch: an
    // account whose `last-seen-version` predates the executor's `OLDEST_VERSION` has its state
    // cleaned. Calling it unconditionally meant an old enough account was silently wiped on the
    // boot that opened it — where electron would not have made the call at all.
    if !app_data_path.join("mainnet_seed.seed").exists() {
        log.host(&format!(
            "Data path not initialised, scaffolding: {}",
            app_data_path.display()
        ));
        rust_executor::init::init(
            Some(app_data_path.to_str().unwrap().to_string()),
            None, // No bootstrap seed override — the account uses mainnet.
        )
        .expect("Failed to initialize AD4M");
    }

    // The identity store the executor's agent language uses, and the store keys whose heads it
    // trusts: `AD4M_IDENTITY_STORE_URL` and `AD4M_IDENTITY_STORE_KEYS` (comma-separated), the
    // names the executor's own CLI reads. A build carries them when they are set while it is
    // compiled (DEVELOPMENT.md, "The identity store"); the same variables at run time override
    // that. Without a URL the agent language keeps its own setting and no offer link can be made.
    // Without a key the executor accepts no head from the store, so the custody service refuses
    // every identity step before it starts, and the app says why rather than offering it.
    let store = we_custody::host::StoreSettings::from_env(
        option_env!("AD4M_IDENTITY_STORE_URL"),
        option_env!("AD4M_IDENTITY_STORE_KEYS"),
    );
    let identity_store_trusted = store.trusted();
    let (identity_store_url, identity_store_keys) = (store.url, store.keys);
    if !identity_store_trusted {
        log.host("No identity store key: making or changing an identity is off in this build");
    }

    // The custody service: the person's master key, behind the OS unlock, in this process but never
    // in the executor's code (it is its own crate, `crates/custody`, and reaches the executor over RPC with
    // the admin credential only). The sealed file is the fallback for Linux without a Secret Service,
    // and for a macOS build without the keychain entitlement.
    // The same folder keeps the incept of an identity made here until its publish is confirmed.
    let custody_dir = we_custody::host::custody_dir(&home);
    let custody = we_custody::spawn(
        we_custody::DesktopVault::new(
            we_custody::store::system_store(custody_dir.clone()),
            we_custody::PendingIncepts::file(custody_dir),
        ),
        we_custody::ExecutorAddress {
            url: format!("http://127.0.0.1:{graphql_port}"),
            admin_credential: std::sync::Arc::from(req_credential.as_str()),
            store_url: identity_store_url.clone(),
            store_trusted: identity_store_trusted,
        },
    );

    let state = AppState {
        graphql_port,
        req_credential: req_credential.clone(),
        config_dir,
        default_data_path,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .manage(commands::identity::IdentityState::new(custody))
        .invoke_handler(tauri::generate_handler![
            commands::state::get_port,
            commands::state::request_credential,
            commands::accounts::list_accounts,
            commands::accounts::create_account,
            commands::accounts::set_account_display,
            commands::accounts::select_account,
            commands::accounts::remove_account,
            commands::accounts::apply_account_selection,
            commands::accounts::get_executor_settings,
            commands::accounts::set_executor_settings,
            commands::accounts::restart_executor,
            commands::accounts::choose_file,
            commands::identity::identity_open,
            commands::identity::identity_public_state,
            commands::identity::identity_flow_start,
            commands::identity::identity_flow_step,
            commands::identity::identity_flow_cancel,
            commands::identity::identity_flow_finish
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
                // A `Secret`: the executor can compare it and never print or serialise it.
                admin_credential: Some(Secret::new(req_credential.clone())),
                app_data_path: Some(app_data_path.to_str().unwrap().to_string()),
                // `port` is the executor's GraphQL/REST port — the same one the electron host
                // passes as `--port`. It was `gql_port` in an older Ad4mConfig.
                port: Some(graphql_port),
                run_dapp_server: Some(false), // Disabled - we serve the app ourselves
                connect_holochain: Some(true),
                // Off unless asked for: MCP opens a port that serves this agent's data to anything
                // local that speaks the protocol. Read here because the executor takes its
                // configuration once, at startup.
                enable_mcp: Some(executor_settings.mcp_enabled),
                mcp_port: Some(executor_settings.mcp_port),
                identity_store_url: identity_store_url.clone(),
                identity_store_keys: identity_store_keys.clone(),
                ..Default::default()
            };

            // Start the executor in the background
            tauri::async_runtime::spawn(async move {
                rust_executor::run(config).await;
            });

            // WebRTC needs the webview told it may have the devices — see `enable_media`.
            #[cfg(target_os = "linux")]
            enable_media(app);

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
