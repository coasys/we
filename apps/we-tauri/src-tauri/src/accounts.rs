//! The account registry: which agent directories exist, and which one this app runs against.
//!
//! An "account" is a data directory. The identity inside it is created on first boot into it, by
//! the setup screen — registering an account deliberately does not create one, because that needs
//! a password the user has not been asked for yet. They are asked once, after the restart, on the
//! same page whether this is a genuine first run or an account being added.
//!
//! ## Where the registry lives, and why not where the launcher puts it
//!
//! The ADAM launcher keeps its equivalent at `~/.ad4m/launcher-state.json` — inside the default
//! agent's own data directory. Clearing that agent destroys the list of every *other* agent along
//! with it. This one lives in the app's config directory, which no agent owns.
//!
//! ## Deleting is not symmetrical
//!
//! An account WE created lives under `agents/` here and is removed with its data. An account WE
//! merely adopted — the pre-existing `~/.ad4m`, which is also the launcher's and Flux's — is only
//! forgotten. Erasing it would destroy another app's agent from a screen that says "remove
//! account".
//!
//! Mirrors `apps/we-electron/electron/accounts.js`. The two hosts keep separate registries in
//! their own config directories, so an account created in one is not listed by the other.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const REGISTRY_FILE: &str = "we-accounts.json";

/// Ceiling on a cached profile picture, in data-URI characters. ~192 KB, far above an 80px PNG.
const MAX_AVATAR_CHARS: usize = 200_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AccountEntry {
    pub name: String,
    pub path: PathBuf,
    /// Cached profile picture as a small data URI. See `Account::avatar`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

/// The shape the UI consumes. `id` is the data path — stable, and unique by construction, so
/// there is no separate identifier to keep in sync with the directory.
#[derive(Serialize, Clone, Debug)]
pub struct Account {
    pub id: String,
    pub name: String,
    /// A cached copy of the profile picture, as a small data URI.
    ///
    /// Cached rather than read live because the sign-in screen renders while the agent is
    /// *locked*, and the real profile lives inside the encrypted store.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    pub active: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RegistryState {
    accounts: Vec<AccountEntry>,
    selected_path: PathBuf,
}

pub struct AccountRegistry {
    config_dir: PathBuf,
    default_path: PathBuf,
    default_name: String,
}

impl AccountRegistry {
    pub fn new(config_dir: PathBuf, default_path: PathBuf) -> Self {
        AccountRegistry {
            config_dir,
            default_path,
            default_name: "Main".to_string(),
        }
    }

    fn registry_path(&self) -> PathBuf {
        self.config_dir.join(REGISTRY_FILE)
    }

    /// Accounts this app created. Only these are safe to erase on removal.
    fn managed_root(&self) -> PathBuf {
        self.config_dir.join("agents")
    }

    fn read(&self) -> RegistryState {
        // Missing or corrupt re-seeds rather than refusing to start: losing the list is
        // recoverable (the directories are still there to re-add), an app that will not open is
        // not.
        fs::read_to_string(self.registry_path())
            .ok()
            .and_then(|data| serde_json::from_str::<RegistryState>(&data).ok())
            .filter(|state| !state.accounts.is_empty())
            .unwrap_or_else(|| RegistryState {
                accounts: vec![AccountEntry {
                    name: self.default_name.clone(),
                    path: self.default_path.clone(),
                    avatar: None,
                }],
                selected_path: self.default_path.clone(),
            })
    }

    fn write(&self, state: &RegistryState) -> Result<(), String> {
        fs::create_dir_all(&self.config_dir).map_err(|e| e.to_string())?;
        let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
        fs::write(self.registry_path(), data).map_err(|e| e.to_string())
    }

    /// The data path this launch should use.
    ///
    /// Self-heals: a selection pointing at an account that is no longer listed falls back to the
    /// first one, rather than starting the executor against a directory nothing knows about.
    pub fn resolve_active_path(&self) -> PathBuf {
        let state = self.read();
        if state.accounts.iter().any(|a| a.path == state.selected_path) {
            return state.selected_path;
        }

        let fallback = state.accounts[0].path.clone();
        let healed = RegistryState {
            accounts: state.accounts,
            selected_path: fallback.clone(),
        };
        let _ = self.write(&healed);
        fallback
    }

    pub fn list(&self) -> Vec<Account> {
        let active = self.resolve_active_path();
        self.read()
            .accounts
            .into_iter()
            .map(|entry| Account {
                id: entry.path.to_string_lossy().to_string(),
                name: entry.name,
                avatar: entry.avatar,
                active: entry.path == active,
            })
            .collect()
    }

    /// Register a new account under a provisional name and select it.
    ///
    /// The real name is collected by the setup screen after the restart, so that first run and
    /// adding an account reach the same page. Until then the account still needs *a* name — it is
    /// listed in the switcher, and a user who abandons setup must be able to tell it apart.
    pub fn create(&self) -> Result<Account, String> {
        let mut state = self.read();
        let existing_names: Vec<String> = state.accounts.iter().map(|a| a.name.clone()).collect();
        let name = unique_name("New account", &existing_names);

        let managed = self.managed_root();
        let taken: Vec<String> = state
            .accounts
            .iter()
            .filter_map(|a| a.path.strip_prefix(&managed).ok())
            .map(|rest| rest.to_string_lossy().to_string())
            .collect();

        let path = managed.join(slugify(&name, &taken));
        if state.accounts.iter().any(|a| a.path == path) {
            return Err("That account already exists".to_string());
        }

        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        state.accounts.push(AccountEntry {
            name: name.clone(),
            path: path.clone(),
            avatar: None,
        });
        state.selected_path = path.clone();
        self.write(&state)?;

        Ok(Account {
            id: path.to_string_lossy().to_string(),
            name,
            avatar: None,
            active: true,
        })
    }

    /// Mirror the profile's name and picture onto the account, so a locked sign-in screen has
    /// something to show. Both fields optional — an edit to one must not clear the other.
    ///
    /// The directory keeps its original slug whatever the name becomes: renaming a data directory
    /// to match a label buys nothing and risks everything inside it.
    pub fn set_display(&self, id: &str, name: Option<&str>, avatar: Option<&str>) -> Result<(), String> {
        let trimmed = name.map(str::trim);
        if let Some("") = trimmed {
            return Err("An account name is required".to_string());
        }

        let mut state = self.read();
        let target = PathBuf::from(id);
        if !state.accounts.iter().any(|a| a.path == target) {
            return Err("No such account".to_string());
        }

        // Guard the registry against an oversized image. The shell caps the longest edge at 80px
        // before this is ever called, so it should never fire — but a JSON file the app cannot
        // start without is the wrong place to discover that an assumption changed upstream.
        let cached_avatar = avatar.filter(|a| a.len() <= MAX_AVATAR_CHARS);
        if avatar.is_some() && cached_avatar.is_none() {
            eprintln!("[accounts] Profile picture too large to cache; falling back to initials");
        }

        for account in state.accounts.iter_mut() {
            if account.path == target {
                if let Some(new_name) = trimmed {
                    account.name = new_name.to_string();
                }
                if let Some(new_avatar) = cached_avatar {
                    account.avatar = Some(new_avatar.to_string());
                }
            }
        }
        self.write(&state)
    }

    pub fn select(&self, id: &str) -> Result<(), String> {
        let mut state = self.read();
        let target = PathBuf::from(id);
        if !state.accounts.iter().any(|a| a.path == target) {
            return Err("No such account".to_string());
        }
        state.selected_path = target;
        self.write(&state)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut state = self.read();
        let target = PathBuf::from(id);

        if state.selected_path == target {
            return Err("Cannot remove the account you are signed in to".to_string());
        }
        if !state.accounts.iter().any(|a| a.path == target) {
            return Err("No such account".to_string());
        }

        state.accounts.retain(|a| a.path != target);
        self.write(&state)?;

        // Only erase what we created. See the module header.
        if target.starts_with(self.managed_root()) && target.exists() {
            if let Err(e) = fs::remove_dir_all(&target) {
                eprintln!("[accounts] Account forgotten but its data could not be deleted: {e}");
            }
        }

        Ok(())
    }
}

/// A directory name derived from what the user typed, made safe and unique.
///
/// Unlike the launcher, which maps a name straight to `~/.<name.to_lowercase()>` with no collision
/// check — so two accounts can silently share one directory, and a name containing a separator
/// escapes the intended parent entirely.
pub fn slugify(name: &str, taken: &[String]) -> String {
    let mut base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();

    while base.contains("--") {
        base = base.replace("--", "-");
    }
    let base = base.trim_matches('-').chars().take(40).collect::<String>();
    let base = if base.is_empty() {
        "account".to_string()
    } else {
        base
    };

    if !taken.contains(&base) {
        return base;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// `base`, or `base 2`, `base 3`… — so two abandoned setups are still tellable apart in the list.
pub fn unique_name(base: &str, taken: &[String]) -> String {
    if !taken.iter().any(|n| n == base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base} {n}");
        if !taken.iter().any(|name| name == &candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Expands a leading `~`. Only leading — `~` elsewhere in a path is a literal character.
pub fn expand_home(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        return home.to_path_buf();
    }
    match path.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_makes_names_safe_and_unique() {
        assert_eq!(slugify("Test Net", &[]), "test-net");
        assert_eq!(slugify("Test Net", &["test-net".to_string()]), "test-net-2");
        // A separator must not let the directory escape its parent.
        assert_eq!(slugify("../../etc", &[]), "etc");
        assert_eq!(slugify("!!!", &[]), "account");
    }

    #[test]
    fn unique_name_disambiguates_provisional_names() {
        assert_eq!(unique_name("New account", &[]), "New account");
        assert_eq!(
            unique_name("New account", &["New account".to_string()]),
            "New account 2"
        );
    }

    #[test]
    fn expand_home_only_expands_a_leading_tilde() {
        let home = PathBuf::from("/home/x");
        assert_eq!(expand_home("~", &home), home);
        assert_eq!(expand_home("~/.ad4m", &home), PathBuf::from("/home/x/.ad4m"));
        assert_eq!(expand_home("/tmp/a", &home), PathBuf::from("/tmp/a"));
        assert_eq!(expand_home("a~b", &home), PathBuf::from("a~b"));
    }
}
