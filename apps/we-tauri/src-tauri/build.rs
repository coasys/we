//! The app manifest: every command this app has, so that each one is granted to a window by a
//! capability (`capabilities/*.json`) rather than to every window. Without a manifest, Tauri lets
//! every window call every command — and the identity window's commands, which run the master-key
//! flows, must answer that window only.
//!
//! `crates/custody/tests/commands.rs` reads this list and the capabilities, and checks them against the
//! custody crate's own table of which window may call what.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // The main window: the executor's connection, accounts and settings.
            "get_port",
            "request_credential",
            "list_accounts",
            "create_account",
            "set_account_display",
            "select_account",
            "remove_account",
            "apply_account_selection",
            "get_executor_settings",
            "set_executor_settings",
            "restart_executor",
            "choose_file",
            // The main window may only open the identity window and read public custody state.
            "identity_open",
            "identity_public_state",
            // The identity window only.
            "identity_flow_start",
            "identity_flow_step",
            "identity_flow_cancel",
            "identity_flow_finish",
        ]),
    ))
    .expect("failed to run tauri-build");
}
