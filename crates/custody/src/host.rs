//! What every desktop host starts the custody service with: the folder its keys live in, and the
//! identity store settings. The Tauri app and the sidecar (`sidecar`) both read them here, so the
//! two shells keep the same keys in the same place and refuse the same steps.

use std::path::{Path, PathBuf};

/// `<data dir>/coasys/custody`, shared by every account and every desktop app on this computer:
/// `$XDG_DATA_HOME` (or `~/.local/share`) on Linux, `~/Library/Application Support` on macOS.
pub fn custody_dir(home: &Path) -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| home.join(".local/share"))
        .join("coasys")
        .join("custody")
}

/// The identity store the executor publishes to, as the executor's own CLI reads it:
/// `AD4M_IDENTITY_STORE_URL` and `AD4M_IDENTITY_STORE_KEYS` (comma-separated multikeys).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StoreSettings {
    /// Where the store is. Without one the agent language keeps its own setting and no offer link
    /// can be made.
    pub url: Option<String>,
    /// The keys whose heads the executor accepts. Without one every identity step is refused.
    pub keys: Option<Vec<String>>,
}

impl StoreSettings {
    /// Each setting from its run-time value when set and not blank, else from the value the build
    /// carries, else none.
    pub fn resolve(
        runtime_url: Option<String>,
        built_url: Option<&str>,
        runtime_keys: Option<String>,
        built_keys: Option<&str>,
    ) -> Self {
        let keys = setting(runtime_keys, built_keys)
            .map(|keys| {
                keys.split(',')
                    .map(|k| k.trim().to_string())
                    .filter(|k| !k.is_empty())
                    .collect::<Vec<_>>()
            })
            .filter(|keys| !keys.is_empty());
        StoreSettings {
            url: setting(runtime_url, built_url),
            keys,
        }
    }

    /// From this process's environment, over the values the build carries.
    pub fn from_env(built_url: Option<&str>, built_keys: Option<&str>) -> Self {
        Self::resolve(
            std::env::var("AD4M_IDENTITY_STORE_URL").ok(),
            built_url,
            std::env::var("AD4M_IDENTITY_STORE_KEYS").ok(),
            built_keys,
        )
    }

    /// The executor trusts at least one store key, so an identity step can publish.
    pub fn trusted(&self) -> bool {
        self.keys.is_some()
    }
}

fn setting(runtime: Option<String>, built: Option<&str>) -> Option<String> {
    runtime
        .filter(|s| !s.trim().is_empty())
        .or_else(|| built.map(str::to_string).filter(|s| !s.trim().is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_run_time_store_setting_overrides_the_built_one_and_empty_is_none() {
        let built = Some("https://store.built");
        let url = |runtime: Option<&str>, built| {
            StoreSettings::resolve(runtime.map(str::to_string), built, None, None).url
        };
        assert_eq!(
            url(Some("https://store.run"), built).as_deref(),
            Some("https://store.run")
        );
        assert_eq!(url(None, built).as_deref(), built);
        assert_eq!(url(Some(" "), built).as_deref(), built);
        assert_eq!(url(None, Some("")), None);
        assert_eq!(url(None, None), None);
    }

    #[test]
    fn store_keys_are_a_comma_separated_list_and_none_means_untrusted() {
        let keys = |runtime: &str| StoreSettings::resolve(None, None, Some(runtime.into()), None);
        assert_eq!(
            keys(" z6MkA, ,z6MkB ").keys,
            Some(vec!["z6MkA".to_string(), "z6MkB".to_string()])
        );
        assert!(keys("z6MkA").trusted());
        assert!(!keys(" , ").trusted());
        assert!(!StoreSettings::resolve(None, None, None, None).trusted());
        let built = StoreSettings::resolve(None, None, None, Some("z6MkC"));
        assert_eq!(built.keys, Some(vec!["z6MkC".to_string()]));
    }

    #[test]
    fn the_custody_folder_is_coasys_custody_in_the_data_dir() {
        let dir = custody_dir(Path::new("/home/someone"));
        assert!(dir.ends_with("coasys/custody"));
    }
}
