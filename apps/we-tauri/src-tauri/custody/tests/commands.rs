//! The capability is required: the app's manifest lists every command, so none is callable without a capability; the
//! identity window's capability grants the flow commands and nothing of the core API; the main
//! window's grants its own commands, two event calls and nothing more, and none of the flow
//! commands. Each handler's own label check is `window::require`, tested in
//! the crate; this checks the files the Tauri build reads agree with it.

use std::collections::BTreeSet;
use std::path::PathBuf;

use we_custody::window::{COMMANDS, IDENTITY, MAIN};

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
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

/// The command names that `lib.rs` registers with `tauri::generate_handler!`.
fn registered_commands() -> BTreeSet<String> {
    let lib = std::fs::read_to_string(app_dir().join("src/lib.rs")).unwrap();
    let list = lib
        .split("generate_handler![")
        .nth(1)
        .expect("lib.rs registers its commands")
        .split(']')
        .next()
        .unwrap();
    list.split(',')
        .map(|path| path.trim().rsplit("::").next().unwrap().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

/// The only parts of the core API the main window may call: `listen` and `unlisten`, with which it
/// hears that an identity step ended (`src/platform/identityHost.ts`).
const MAIN_CORE: &[&str] = &["core:event:allow-listen", "core:event:allow-unlisten"];

#[test]
fn the_app_registers_exactly_the_commands_its_manifest_declares() {
    assert_eq!(registered_commands(), manifest_commands());
}

#[test]
fn the_main_windows_capability_grants_its_commands_and_two_event_calls_only() {
    let (windows, permissions) = capability("main.json");
    assert_eq!(windows, vec![MAIN.to_string()]);
    let identity_only: BTreeSet<String> = COMMANDS
        .iter()
        .filter(|(_, w)| *w == IDENTITY)
        .map(|(c, _)| c.to_string())
        .collect();
    let mut expected: BTreeSet<String> = manifest_commands()
        .difference(&identity_only)
        .map(|c| permission(c))
        .collect();
    expected.extend(MAIN_CORE.iter().map(|p| p.to_string()));
    // A new permission here, a plugin's or a part of the core API, fails this test until it is
    // named above with the reason the main window needs it.
    assert_eq!(permissions, expected);
}

#[test]
fn every_command_is_granted_to_one_window_and_every_window_has_a_capability() {
    let mut granted: BTreeSet<String> = BTreeSet::new();
    let mut windows: BTreeSet<String> = BTreeSet::new();
    for entry in std::fs::read_dir(app_dir().join("capabilities")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "json") {
            let (on, permissions) = capability(path.file_name().unwrap().to_str().unwrap());
            windows.extend(on);
            for p in permissions.iter().filter(|p| !p.contains(':')) {
                assert!(granted.insert(p.clone()), "{p} is granted twice");
            }
            for p in &permissions {
                assert!(
                    !p.ends_with(":default") && !p.starts_with("opener:"),
                    "{p} is a broad grant"
                );
            }
        }
    }
    let all: BTreeSet<String> = manifest_commands().iter().map(|c| permission(c)).collect();
    assert_eq!(granted, all, "every command, granted once");
    assert_eq!(
        windows,
        BTreeSet::from([MAIN.to_string(), IDENTITY.to_string()])
    );
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
    let (windows, permissions) = capability("main.json");
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
