//! Where things are: the executor binary, the web bundle, the data path, the custody folder.
//!
//! The same precedence as the Tauri host (`apps/we-tauri/src-tauri/src/lib.rs`) wherever both have
//! the setting, so one data directory and one account list serve all three shells.

use std::path::{Path, PathBuf};

use crate::accounts::{expand_home, AccountRegistry};

/// The seed's `ad4m.dataPath` (`we-seed.json`), read at build time by `build.rs`.
pub const SEED_DATA_PATH: &str = env!("WE_GPUI_SEED_DATA_PATH");

/// This app's configuration directory — only the pre-container layout lives here, which the
/// registry migrates out of on first run. `we`, as Tauri's, so the two read the same legacy file.
pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| home_dir().join(".config"))
        .join("we")
}

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

pub fn seed_data_path(home: &Path) -> PathBuf {
    expand_home(SEED_DATA_PATH, home)
}

pub fn registry() -> AccountRegistry {
    let home = home_dir();
    AccountRegistry::new(config_dir(), seed_data_path(&home))
}

/// Env → the selected account → the seed default, as Tauri. The env var bypasses the registry: it
/// is the override for testing against a throwaway directory, and must not register an account.
pub fn resolve_data_path(env: Option<String>, registry: &AccountRegistry, home: &Path) -> PathBuf {
    match env.filter(|value| !value.is_empty()) {
        Some(from_env) => expand_home(&from_env, home),
        None => registry.resolve_active_path(),
    }
}

/// The executor binary: `WE_AD4M_EXECUTOR`, else the sibling ad4m checkout's release build (the
/// seed's `ad4m.repoPath`, as Electron's development path), else `ad4m-executor` on `PATH`.
pub fn executor_binary(env: Option<String>, repo_build: &Path) -> PathBuf {
    if let Some(path) = env.filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    if repo_build.exists() {
        return repo_build.to_path_buf();
    }
    PathBuf::from("ad4m-executor")
}

/// `<repo>/../ad4m/target/release/ad4m-executor`, from this crate's directory at build time.
pub fn repo_executor_build() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../..")
        .join("ad4m/target/release/ad4m-executor")
}

/// The built web bundle (`vite build` → `apps/we-gpui/dist`), or `WE_GPUI_DIST`.
pub fn dist_dir(env: Option<String>) -> PathBuf {
    env.filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist"))
}

/// One identity-store setting: the run-time variable when set and not empty, else none. Tauri also
/// falls back to a value compiled in; this spike does not bake one in.
pub fn identity_store_setting(runtime: Option<String>) -> Option<String> {
    runtime.filter(|s| !s.trim().is_empty())
}

/// A free port in `[from, to)`, as Tauri's `find_port`.
pub fn find_port(from: u16, to: u16) -> Option<u16> {
    (from..to).find(|port| std::net::TcpListener::bind(("127.0.0.1", *port)).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_env_data_path_wins_and_expands_home() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AccountRegistry::new(dir.path().join("cfg"), dir.path().join("seed"));
        let home = Path::new("/home/someone");
        assert_eq!(
            resolve_data_path(Some("~/x".into()), &registry, home),
            PathBuf::from("/home/someone/x")
        );
    }

    #[test]
    fn an_empty_env_data_path_falls_back_to_the_registry() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AccountRegistry::new(dir.path().join("cfg"), dir.path().join("seed"));
        let from_registry = registry.resolve_active_path();
        assert_eq!(
            resolve_data_path(Some(String::new()), &registry, dir.path()),
            from_registry
        );
    }

    #[test]
    fn the_executor_comes_from_env_then_the_repo_then_path() {
        let dir = tempfile::tempdir().unwrap();
        let built = dir.path().join("ad4m-executor");
        assert_eq!(executor_binary(Some("/x/exec".into()), &built), PathBuf::from("/x/exec"));
        assert_eq!(executor_binary(None, &built), PathBuf::from("ad4m-executor"));
        std::fs::write(&built, b"").unwrap();
        assert_eq!(executor_binary(Some(String::new()), &built), built);
    }

    #[test]
    fn a_blank_identity_store_setting_is_none() {
        assert_eq!(identity_store_setting(Some("  ".into())), None);
        assert_eq!(identity_store_setting(Some("u".into())), Some("u".into()));
    }

    #[test]
    fn the_seed_data_path_is_baked_in() {
        assert!(!SEED_DATA_PATH.is_empty());
    }
}
