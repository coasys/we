//! The shared steps name no transport, no executor and no platform: the desktop runs them over
//! the executor's RPC and the phone over the identity store's HTTPS, and neither may leak into
//! the other through this crate.

use std::path::PathBuf;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn the_steps_depend_on_no_executor_transport_or_platform() {
    // The graph this crate builds for the host, from the lockfile (`--offline`, `--locked`): the
    // lockfile also lists target-only crates (a wasm runtime's `tokio`) that never build here.
    let tree = std::process::Command::new(env!("CARGO"))
        .args([
            "tree",
            "-e",
            "normal",
            "--prefix",
            "none",
            "--offline",
            "--locked",
        ])
        .current_dir(crate_dir())
        .output()
        .unwrap();
    assert!(
        tree.status.success(),
        "{}",
        String::from_utf8_lossy(&tree.stderr)
    );
    let tree = String::from_utf8(tree.stdout).unwrap();
    let names: Vec<&str> = tree.lines().filter_map(|l| l.split(' ').next()).collect();
    for name in [
        "ad4m-executor",
        "rust-executor",
        "ad4m-client",
        "tokio",
        "uniffi",
        "jni",
        "secret-service",
    ] {
        assert!(!names.contains(&name), "the crate builds {name}");
    }
    let lock = std::fs::read_to_string(crate_dir().join("Cargo.lock")).unwrap();
    for name in ["ad4m-executor", "rust-executor", "deno_core", "holochain"] {
        assert!(
            !lock.contains(&format!("name = \"{name}\"")),
            "Cargo.lock holds {name}"
        );
    }
}

/// One ad4m per WE build: the rev here is the one `crates/custody` names, which its own test
/// checks against the app's pin. A crate that depends on this one at another rev would not unify
/// the ad4m types.
#[test]
fn the_steps_build_against_the_ad4m_commit_custody_does() {
    let revs = |path: PathBuf| -> Vec<String> {
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter(|l| l.contains("github.com/coasys/ad4m"))
            .filter_map(|l| Some(l.split("rev = \"").nth(1)?.split('"').next()?.to_string()))
            .collect()
    };
    let ours = revs(crate_dir().join("Cargo.toml"));
    let custody = revs(crate_dir().join("../custody/Cargo.toml"));
    let phone = revs(crate_dir().join("../phone-custody/Cargo.toml"));
    assert!(!ours.is_empty() && !custody.is_empty() && !phone.is_empty());
    for rev in custody.iter().chain(&phone) {
        assert_eq!(rev, &ours[0], "every crate names ad4m {}", ours[0]);
    }
}
