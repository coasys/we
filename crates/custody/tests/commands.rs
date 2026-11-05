//! The capability is required: the app's manifest lists every command, so none is callable without a capability; the
//! identity window's capability grants the flow commands and nothing of the core API; the main
//! window's grants none of them. Each handler's own label check is `window::require`, tested in
//! the crate; this checks the files the Tauri build reads agree with it.

use std::collections::BTreeSet;
use std::path::PathBuf;

use we_custody::window::{COMMANDS, IDENTITY, MAIN};

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/we-tauri/src-tauri")
}

fn capability(file: &str) -> (Vec<String>, BTreeSet<String>) {
    let json: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(app_dir().join("capabilities").join(file)).unwrap(),
    )
    .unwrap();
    let windows = json["windows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w.as_str().unwrap().to_string())
        .collect();
    let permissions = json["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_string())
        .collect();
    (windows, permissions)
}

fn permission(command: &str) -> String {
    format!("allow-{}", command.replace('_', "-"))
}

/// The command names in `build.rs`'s app manifest.
fn manifest_commands() -> BTreeSet<String> {
    let build = std::fs::read_to_string(app_dir().join("build.rs")).unwrap();
    let list = build
        .split(".commands(&[")
        .nth(1)
        .expect("build.rs declares an app manifest")
        .split("])")
        .next()
        .unwrap();
    list.lines()
        .map(str::trim)
        .filter(|l| l.starts_with('"'))
        .map(|l| l.trim_matches(|c| c == '"' || c == ',').to_string())
        .collect()
}

#[test]
fn every_custody_command_is_in_the_app_manifest() {
    let declared = manifest_commands();
    for (command, _) in COMMANDS {
        assert!(
            declared.contains(*command),
            "{command} is not in build.rs's app manifest"
        );
    }
}

#[test]
fn the_identity_windows_capability_grants_its_flow_commands_and_nothing_else() {
    let (windows, permissions) = capability("identity.json");
    assert_eq!(windows, vec![IDENTITY.to_string()]);
    let expected: BTreeSet<String> = COMMANDS
        .iter()
        .filter(|(_, w)| *w == IDENTITY)
        .map(|(c, _)| permission(c))
        .collect();
    assert_eq!(permissions, expected);
    assert!(!permissions
        .iter()
        .any(|p| p.starts_with("core:") || p.contains(':')));
}

#[test]
fn the_main_windows_capability_grants_no_flow_command() {
    let (windows, permissions) = capability("default.json");
    assert_eq!(windows, vec![MAIN.to_string()]);
    for (command, window) in COMMANDS {
        let granted = permissions.contains(&permission(command));
        assert_eq!(
            granted,
            *window == MAIN,
            "{command}: granted to main = {granted}"
        );
    }
    // The main window cannot make a window: it could otherwise make one labelled `identity`.
    for p in &permissions {
        assert!(
            !matches!(
                p.as_str(),
                "core:window:allow-create" | "core:webview:allow-create-webview-window"
            ),
            "main may {p}"
        );
    }
}

#[test]
fn no_capability_file_names_a_window_twice() {
    let mut seen = BTreeSet::new();
    for entry in std::fs::read_dir(app_dir().join("capabilities")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "json") {
            let (windows, _) = capability(path.file_name().unwrap().to_str().unwrap());
            for w in windows {
                assert!(seen.insert(w.clone()), "{w} is in two capabilities");
            }
        }
    }
}
