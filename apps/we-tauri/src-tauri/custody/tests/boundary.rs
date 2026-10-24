//! The custody service's boundary with the executor (identity plan 3.6: "a test that custody imports
//! nothing from `rust_executor`"): the executor runs language code fetched from the network, so the
//! master key must never be in a crate that links it (AR-03 4.4.1). Custody reaches it over RPC.

use std::path::{Path, PathBuf};

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn custody_names_no_executor_crate_in_its_code() {
    let mut files = Vec::new();
    rust_files(&crate_dir().join("src"), &mut files);
    assert!(!files.is_empty());
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        for forbidden in ["rust_executor", "ad4m_executor"] {
            assert!(
                !text.contains(forbidden),
                "{} names {forbidden}",
                file.display()
            );
        }
    }
}

#[test]
fn custody_depends_on_no_executor_crate() {
    let manifest = std::fs::read_to_string(crate_dir().join("Cargo.toml")).unwrap();
    let dependencies: Vec<&str> = manifest
        .lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .collect();
    for line in &dependencies {
        assert!(
            !line.contains("ad4m-executor") && !line.contains("rust-executor"),
            "Cargo.toml: {line}"
        );
    }
    // And nothing it depends on brings the executor in either: the lockfile is the whole graph.
    let lock = std::fs::read_to_string(crate_dir().join("Cargo.lock")).unwrap();
    for name in ["ad4m-executor", "rust-executor", "deno_core", "holochain"] {
        assert!(
            !lock.contains(&format!("name = \"{name}\"")),
            "Cargo.lock holds {name}"
        );
    }
}

/// The ad4m commit the custody crate builds against is the one the app's JavaScript pins
/// (`docs/contributing/ad4m-and-deploys.md`): one ad4m per WE build, Rust included.
#[test]
fn custody_builds_against_the_ad4m_commit_we_pins() {
    let root = crate_dir().join("../../../..");
    let package: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("package.json")).unwrap()).unwrap();
    let pin = package["pnpm"]["overrides"]["@coasys/ad4m"]
        .as_str()
        .unwrap()
        .to_string();
    if !pin.starts_with("https://") {
        // A release pins a published version, whose commit is its npm `gitHead`: checked by
        // `node scripts/ad4m-pin.mjs --commit`, which needs the network this test does not use.
        eprintln!("ad4m is pinned to a version ({pin}); check the rev against `node scripts/ad4m-pin.mjs --commit`");
        return;
    }
    let manifest = std::fs::read_to_string(crate_dir().join("Cargo.toml")).unwrap();
    let revs: Vec<&str> = manifest
        .lines()
        .filter(|l| l.contains("github.com/coasys/ad4m"))
        .filter_map(|l| l.split("rev = \"").nth(1)?.split('"').next())
        .collect();
    assert!(!revs.is_empty());
    for rev in revs {
        assert!(
            pin.ends_with(&format!("@{rev}")),
            "Cargo.toml pins ad4m {rev}, package.json pins {pin}: move them together"
        );
    }
}
