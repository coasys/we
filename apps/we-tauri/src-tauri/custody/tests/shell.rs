//! The shell's build settings that keep the web inspector out of a packaged build. The app crate
//! is not compiled in CI, so these read its manifest template here.

use std::path::PathBuf;

fn template() -> String {
    std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Cargo.toml.template"),
    )
    .unwrap()
}

/// The value of `key` in the `[section]` of the template, as written.
fn entry(section: &str, key: &str) -> Option<String> {
    let text = template();
    let body = text.split(&format!("\n[{section}]\n")).nth(1)?;
    let body = body.split("\n[").next().unwrap();
    body.lines()
        .find(|l| l.split('=').next().map(str::trim) == Some(key))
        .map(|l| l.split_once('=').unwrap().1.trim().to_string())
}

#[test]
fn tauri_is_built_without_its_devtools_feature() {
    let tauri = entry("dependencies", "tauri").expect("tauri is a dependency");
    assert!(!tauri.contains("devtools"), "tauri = {tauri}");
}

#[test]
fn the_devtools_feature_is_off_unless_asked_for() {
    assert_eq!(
        entry("features", "devtools").as_deref(),
        Some("[\"tauri/devtools\"]")
    );
    assert_eq!(entry("features", "default").as_deref(), Some("[]"));
}

#[test]
fn only_the_dev_script_asks_for_devtools() {
    let package: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../package.json"),
        )
        .unwrap(),
    )
    .unwrap();
    for (name, script) in package["scripts"].as_object().unwrap() {
        let script = script.as_str().unwrap();
        let asks = script.contains("devtools");
        assert_eq!(asks, name == "tauri:dev", "{name}: {script}");
    }
}
