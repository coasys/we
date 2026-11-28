# Tauri

The Tauri target (`@we/app-tauri`) runs WE in a desktop window from one Rust process. That process runs the AD4M executor and the custody service in-process, makes the main window and the tray, and answers the renderer's `invoke` calls. The renderer is the same app shell as on web, with `tauriPlatform` and a local-executor connector.

**Why:** The executor runs in this process, and its shutdown ends in `std::process::exit`. So a new account or new executor settings relaunch the whole app (`app_handle.restart()`), where Electron restarts only its child executor (`apply_account_selection` in `commands/accounts.rs`). The main window is made in code and not from `tauri.conf.json`, because only a window made in code can have a navigation handler and a new-window handler (`main_window.rs`).

**Parent:** [Targets](README.md)

<details><summary>How it works</summary>

1. `run()` adds the single-instance plugin, so a second start shows the first one's window and runs none of `start`. Then it adds the dialog plugin and the commands.
2. `start()`: `move_former_webview_data` (Linux), `find_port(12000, 13000)` and a new `Uuid` admin credential, then `AccountRegistry` and `resolve_ad4m_data_path` (`WE_AD4M_DATA_PATH`, else the selected account, else the seed's path; [Accounts](../platform/accounts.md)).
3. It opens the executor log, runs `rust_executor::init::init` when `mainnet_seed.seed` is missing, and calls `we_custody::spawn` with a `DesktopVault` and the executor's address ([Custody](../identity/custody.md)).
4. `main_window::create` and `create_tray`. In a release build, `generated::setup_seed_servers` serves the [embedded apps](../platform/embedded-apps.md) with `serve_static_app`.
5. It spawns `rust_executor::run(Ad4mConfig { port, admin_credential, app_data_path, run_dapp_server: false, connect_holochain: true, … })` on the async runtime. On Linux, `enable_media` lets the webview use the camera, the microphone and WebRTC.
6. The renderer calls `get_port` and `request_credential` to connect, the account commands for [Accounts](../platform/accounts.md), `get_executor_settings`/`set_executor_settings`, `choose_file` and `restart_executor`.
7. The main window may call only `identity_open` and `identity_public_state`. The identity window may call only the `identity_flow_*` commands. `capabilities/main.json`, `capabilities/identity.json` and `we_custody::window::require` check the caller's window label.
8. Closing the window hides it while a tray host shows the icon. Else closing quits the app.

</details>

<details><summary>Where in the code</summary>

- [src-tauri/src/lib.rs](../../../apps/we-tauri/src-tauri/src/lib.rs): `run`, `start`, `resolve_ad4m_data_path`, `enable_media`.
- [src-tauri/src/commands/](../../../apps/we-tauri/src-tauri/src/commands/): `state.rs`, `accounts.rs`, `identity.rs`; [src-tauri/capabilities/](../../../apps/we-tauri/src-tauri/capabilities/): the per-window permissions.
- [src-tauri/src/main_window.rs](../../../apps/we-tauri/src-tauri/src/main_window.rs): the window, navigation and the tray; [src-tauri/src/data_folder.rs](../../../apps/we-tauri/src-tauri/src/data_folder.rs): `move_former_webview_data`; [src-tauri/src/app_server.rs](../../../apps/we-tauri/src-tauri/src/app_server.rs): `serve_static_app`.
- [src/index.tsx](../../../apps/we-tauri/src/index.tsx) and [src/platform/](../../../apps/we-tauri/src/platform/): `tauriPlatform`, the connector, `tauriIdentityHost`; [identity/main.ts](../../../apps/we-tauri/identity/main.ts): the identity window's renderer.
- [scripts/](../../../apps/we-tauri/scripts/): `generate-seed-config.cjs`, `rename-bundle.cjs`; [src-tauri/tauri.conf.json](../../../apps/we-tauri/src-tauri/tauri.conf.json).
- Depth: [DEVELOPMENT.md](../../../apps/we-tauri/DEVELOPMENT.md).

</details>
