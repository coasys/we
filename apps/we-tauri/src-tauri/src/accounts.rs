//! The account registry: which agent directories exist, and which one this app runs against.
//!
//! An "account" is a data directory. The identity inside it is created on first boot into it, by
//! the setup screen — registering an account deliberately does not create one, because that needs
//! a password the user has not been asked for yet. They are asked once, after the restart, on the
//! same page whether this is a genuine first run or an account being added.
//!
//! ## One container, so a rename is a complete backup
//!
//! Everything lives inside the default data directory: the accounts WE creates at
//! `<data>/we-accounts/<slug>/`, and the registry beside them at `<data>/we-accounts/registry.json`.
//! That directory is `~/.ad4m` unless the seed says otherwise.
//!
//! The point is that `mv ~/.ad4m ~/.ad4m-old` is a complete, reversible reset — every account and
//! all of their metadata leave together, the next boot scaffolds a fresh one, and renaming back
//! restores names, pictures and selection exactly. Accounts scattered across a second location, or
//! a registry in the app's own config directory, both break that: half the state moves and half
//! stays.
//!
//! It also means every host reads one list. Before, each kept a private registry under its own
//! config directory — `~/.config/Electron` in electron dev, `~/.config/WE` packaged,
//! `~/.config/we` here — so an account created in one was invisible to the others.
//!
//! The launcher's `launcher-state.json` sits in the same directory and is criticised below for it.
//! The difference is what the coupling costs: there, deleting one *agent* silently destroys the
//! record of every other, which is loss you did not ask for. Here the container is the unit you
//! move on purpose, and nothing survives it by design.
//!
//! ## The filesystem is the source of truth
//!
//! An account exists because its directory exists — `list` scans, and the registry only decorates
//! what the scan finds. A registry that decided existence drifted from the disk in both directions:
//! a directory renamed away stayed in the switcher, and `resolve_active_path` would hand it to the
//! executor, which scaffolded it back. Metadata for a path that is currently absent is kept, not
//! pruned: that is exactly what makes renaming back restore an account rather than resurrect a
//! nameless one.
//!
//! ## Deleting checks shape, not provenance
//!
//! Any AD4M account can be deleted, whichever app created it — `~/.ad4m` is not "Flux's account",
//! it is the user's account that Flux also uses, and WE is as much an AD4M client as the launcher.
//!
//! What is checked instead is that the directory actually *is* an AD4M data directory. The
//! registry holds arbitrary paths; a mistyped seed `dataPath` or a corrupted registry would
//! otherwise turn "remove account" into a recursive delete of whatever that string happens to say.
//! Paths inside the container skip the check — we created them, and one abandoned before setup has
//! no markers yet.
//!
//! The container account is refused outright while it holds nested ones, because deleting it means
//! a recursive delete of the directory they live inside — including, potentially, the account in
//! use.
//!
//! Mirrors `apps/we-electron/electron/accounts.js`. Both hosts now read the same container, so an
//! account created in one is listed by the other.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Holds both the accounts WE creates and the registry, inside the default data directory.
const CONTAINER_DIR: &str = "we-accounts";
const REGISTRY_FILE: &str = "registry.json";

/// Ceiling on a cached profile picture, in data-URI characters. ~192 KB, far above an 80px PNG.
const MAX_AVATAR_CHARS: usize = 200_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AccountEntry {
    pub name: String,
    pub path: PathBuf,
    /// Cached profile picture as a small data URI. See `Account::avatar`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    /// Setup was never finished. See `prune_abandoned`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub provisional: bool,
}

/// The shape the UI consumes. `id` is the data path — stable, and unique by construction, so
/// there is no separate identifier to keep in sync with the directory.
#[derive(Serialize, Clone, Debug)]
// The shell consumes this as JSON; without this the multi-word field would arrive snake_case
// while the TypeScript contract asks for camelCase, and would silently read as undefined.
#[serde(rename_all = "camelCase")]
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
    /// An identity has been created in this account. See `has_agent`.
    pub has_agent: bool,
    /// The ADAM launcher keeps its own registry inside this account. See `holds_launcher_state`.
    pub shared_with_launcher: bool,
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
        let registry = AccountRegistry {
            config_dir,
            default_path,
            default_name: "Main".to_string(),
        };
        registry.migrate_legacy_layout();
        registry
    }

    fn registry_path(&self) -> PathBuf {
        self.managed_root().join(REGISTRY_FILE)
    }

    /// Accounts this app creates, and the registry, both inside the container.
    fn managed_root(&self) -> PathBuf {
        self.default_path.join(CONTAINER_DIR)
    }

    /// Where accounts lived before they moved into the container. Migrated on construction.
    fn legacy_root(&self) -> PathBuf {
        self.config_dir.join("agents")
    }

    fn legacy_registry(&self) -> PathBuf {
        self.config_dir.join("we-accounts.json")
    }

    /// Every account directory that exists right now.
    ///
    /// The container's own children, plus the container itself (the default account, which has to
    /// live at the data path the launcher and Flux expect rather than one level down), plus any
    /// registry path pointing outside. Filtered by existence, which is the whole mechanism: a
    /// directory renamed away simply stops being listed.
    fn scan(&self, state: &RegistryState) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if self.default_path.exists() {
            paths.push(self.default_path.clone());
        }
        if let Ok(entries) = fs::read_dir(self.managed_root()) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    paths.push(entry.path());
                }
            }
        }
        for account in &state.accounts {
            if !paths.contains(&account.path) && account.path.exists() {
                paths.push(account.path.clone());
            }
        }
        paths
    }

    /// The accounts stored inside the container, which the default account's directory holds.
    fn nested_accounts(&self) -> Vec<PathBuf> {
        fs::read_dir(self.managed_root())
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Move accounts out of the pre-container layout, once.
    ///
    /// Their directories move rather than being re-registered in place: the point of the container
    /// is that one `mv` takes everything, which a path left behind in the app's config directory
    /// would quietly break. Registry paths are rewritten to match.
    fn migrate_legacy_layout(&self) {
        if self.registry_path().exists() || !self.legacy_registry().exists() {
            return;
        }
        let Some(legacy) = fs::read_to_string(self.legacy_registry())
            .ok()
            .and_then(|d| serde_json::from_str::<RegistryState>(&d).ok())
        else {
            return;
        };

        let (legacy_root, managed) = (self.legacy_root(), self.managed_root());
        if fs::create_dir_all(&managed).is_err() {
            return;
        }

        let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
        for account in &legacy.accounts {
            let Ok(rest) = account.path.strip_prefix(&legacy_root) else {
                continue;
            };
            let target = managed.join(rest);
            if !account.path.exists() || target.exists() {
                continue;
            }
            match fs::rename(&account.path, &target) {
                Ok(()) => moved.push((account.path.clone(), target)),
                // Across filesystems rename fails; leave it registered where it is rather than
                // copying gigabytes of Holochain state. The scan still finds it by its path.
                Err(e) => eprintln!("[accounts] Could not move an account into the container: {e}"),
            }
        }

        let rewrite = |p: &PathBuf| {
            moved
                .iter()
                .find(|(from, _)| from == p)
                .map(|(_, to)| to.clone())
                .unwrap_or_else(|| p.clone())
        };
        let count = legacy.accounts.len();
        let _ = self.write(&RegistryState {
            accounts: legacy
                .accounts
                .iter()
                .map(|a| AccountEntry {
                    path: rewrite(&a.path),
                    ..a.clone()
                })
                .collect(),
            selected_path: rewrite(&legacy.selected_path),
        });
        // Retire the old file, or this runs again every time the container goes away — and the
        // container going away is the supported way to start fresh. Keying "already migrated" on
        // the new registry existing was wrong for exactly the case the container exists to serve:
        // wiping it deletes that registry while leaving this one, so the next boot repopulated the
        // fresh container with the accounts that had just been deleted.
        //
        // Renamed rather than deleted: it is the only record of a layout we no longer write.
        let retired = self.legacy_registry().with_extension("json.migrated");
        if let Err(e) = fs::rename(self.legacy_registry(), retired) {
            eprintln!("[accounts] Migrated, but could not retire the old registry: {e}");
        }
        println!("[accounts] Migrated {count} account(s) into {}", managed.display());
    }

    fn read(&self) -> RegistryState {
        // Missing or corrupt re-seeds rather than refusing to start: losing the list is
        // recoverable (the directories are still there to re-add), an app that will not open is
        // not.
        fs::read_to_string(self.registry_path())
            .ok()
            .and_then(|data| serde_json::from_str::<RegistryState>(&data).ok())
            .unwrap_or_else(|| RegistryState {
                accounts: Vec::new(),
                selected_path: self.default_path.clone(),
            })
    }

    fn write(&self, state: &RegistryState) -> Result<(), String> {
        fs::create_dir_all(self.managed_root()).map_err(|e| e.to_string())?;
        let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
        fs::write(self.registry_path(), data).map_err(|e| e.to_string())
    }

    /// The data path this launch should use.
    ///
    /// Self-heals: a selection pointing at an account that is no longer listed falls back to the
    /// first one, rather than starting the executor against a directory nothing knows about.
    pub fn resolve_active_path(&self) -> PathBuf {
        let state = self.read();
        let present = self.scan(&state);
        if present.contains(&state.selected_path) {
            return state.selected_path;
        }

        // The selection is gone — renamed away, or deleted from under us. Fall back to an account
        // that is really there, and to the seed default when none is, which the caller scaffolds
        // into a fresh first run. Selecting a path that does not exist is what previously let
        // `init` recreate a directory the user had deliberately moved aside.
        let fallback = present.first().cloned().unwrap_or_else(|| self.default_path.clone());

        // Only persisted when it names an account that is really there. Writing the registry
        // creates the container directory, so recording a fallback to a `default_path` that does
        // not exist would recreate the very directory just moved aside — and merely *listing*
        // accounts would undo the reset.
        if present.contains(&fallback) && state.selected_path != fallback {
            let _ = self.write(&RegistryState {
                accounts: state.accounts,
                selected_path: fallback.clone(),
            });
        }
        fallback
    }

    /// Drop accounts whose setup was never finished.
    ///
    /// Only ones this app created and never saw completed, and never the selected one — that is
    /// either mid-setup right now or the account about to be signed in to. Called once at startup,
    /// so an abandoned account survives exactly as long as the session that abandoned it.
    pub fn prune_abandoned(&self) {
        let state = self.read();
        let active = self.resolve_active_path();
        let managed = self.managed_root();

        let (abandoned, kept): (Vec<_>, Vec<_>) = state
            .accounts
            .into_iter()
            .partition(|a| a.provisional && a.path != active);
        if abandoned.is_empty() {
            return;
        }

        let _ = self.write(&RegistryState {
            accounts: kept,
            selected_path: state.selected_path,
        });

        for account in &abandoned {
            // Same shape check as remove(): a registry entry is a path, not proof of what is there.
            if !account.path.starts_with(&managed) || !account.path.exists() {
                continue;
            }
            if let Err(e) = fs::remove_dir_all(&account.path) {
                eprintln!("[accounts] Could not delete an abandoned account: {e}");
            }
        }
        println!(
            "[accounts] Removed {} account(s) whose setup was never finished",
            abandoned.len()
        );
    }

    pub fn list(&self) -> Vec<Account> {
        let state = self.read();
        let active = self.resolve_active_path();

        self.scan(&state)
            .into_iter()
            .map(|path| {
                // No entry means a directory nobody has named yet — the default account on a first
                // run, or one restored by renaming a backup back before its metadata caught up.
                let meta = state.accounts.iter().find(|a| a.path == path);
                let name = meta.map(|m| m.name.clone()).unwrap_or_else(|| {
                    if path == self.default_path {
                        self.default_name.clone()
                    } else {
                        path.file_name().unwrap_or_default().to_string_lossy().to_string()
                    }
                });
                Account {
                    id: path.to_string_lossy().to_string(),
                    has_agent: has_agent(&path),
                    shared_with_launcher: holds_launcher_state(&path),
                    name,
                    avatar: meta.and_then(|m| m.avatar.clone()),
                    active: path == active,
                }
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
        let existing_names: Vec<String> = self.list().into_iter().map(|a| a.name).collect();
        let name = unique_name("New account", &existing_names);

        let managed = self.managed_root();
        // Slugs are taken from what is on disk, not from the registry: a directory left behind by
        // an account whose metadata is gone would otherwise be silently adopted by the next create.
        let taken: Vec<String> = self
            .nested_accounts()
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();

        let path = managed.join(slugify(&name, &taken));
        if path.exists() {
            return Err("That account already exists".to_string());
        }

        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        state.accounts.push(AccountEntry {
            name: name.clone(),
            path: path.clone(),
            avatar: None,
            // Provisional until setup finishes. An account whose setup is abandoned has a
            // directory, a placeholder name and no identity, and would otherwise sit in the
            // switcher forever looking real.
            provisional: true,
        });
        state.selected_path = path.clone();
        self.write(&state)?;

        Ok(Account {
            id: path.to_string_lossy().to_string(),
            name,
            avatar: None,
            active: true,
            // Just created: a directory and nothing else. The setup screen makes the identity.
            has_agent: false,
            shared_with_launcher: false,
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
        if !self.scan(&state).contains(&target) {
            return Err("No such account".to_string());
        }
        // The scan can surface an account the registry has no entry for — the default one on a
        // first run, most often. Naming it is what creates the entry.
        if !state.accounts.iter().any(|a| a.path == target) {
            state.accounts.push(AccountEntry {
                name: String::new(),
                path: target.clone(),
                avatar: None,
                provisional: false,
            });
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
                    // A name arriving is setup completing: it is written once the agent exists.
                    account.provisional = false;
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
        if !self.scan(&state).contains(&target) {
            return Err("No such account".to_string());
        }
        state.selected_path = target;
        self.write(&state)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut state = self.read();
        let target = PathBuf::from(id);

        if self.resolve_active_path() == target {
            return Err("Cannot remove the account you are signed in to".to_string());
        }
        if !self.scan(&state).contains(&target) {
            return Err("No such account".to_string());
        }

        // The default account's directory *contains* every other account, so deleting it would
        // take them all — including, if one of them is selected, the account being used. Refused
        // rather than handled: the way to clear this account is to move the directory aside, which
        // is the same gesture that backs everything up.
        if target == self.default_path && !self.nested_accounts().is_empty() {
            return Err("Remove the other accounts first — they are stored inside this one".to_string());
        }

        state.accounts.retain(|a| a.path != target);
        self.write(&state)?;

        // Erase the data — for any account, whoever created it — but for paths *outside* the
        // container only once the directory has been confirmed to hold an agent. See the module
        // header: a registry entry is a path, and a path is not proof of what is there.
        //
        // Inside the container the check would do harm rather than good. We created those
        // directories, so provenance is not in question, and an account abandoned before setup has
        // no AD4M markers yet — skipping the delete would leave the directory on disk, where the
        // scan finds it again and puts it straight back in the list.
        let is_ours = target.starts_with(self.managed_root());
        if !is_ours && !looks_like_ad4m_data(&target) {
            eprintln!(
                "[accounts] Account forgotten; its path holds no AD4M data, so nothing deleted: {}",
                target.display()
            );
            return Ok(());
        }
        if let Err(e) = fs::remove_dir_all(&target) {
            eprintln!("[accounts] Account forgotten but its data could not be deleted: {e}");
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

/// Whether a path holds an AD4M agent, by the markers `init` writes.
///
/// The guard on deletion: a registry entry is a path, and a path is not proof that anything of
/// AD4M's is there.
pub fn looks_like_ad4m_data(path: &Path) -> bool {
    path.join("mainnet_seed.seed").exists() || path.join("ad4m").exists()
}

/// Whether the ADAM launcher keeps its own registry inside this account.
///
/// The launcher stores `launcher-state.json` — its list of every agent it knows about — inside
/// `~/.ad4m`, which is also one of its agents. Deleting that directory therefore erases the
/// launcher's record of all its *other* agents too. That is the launcher's design rather than
/// something fixable from here, but it is a consequence nobody would predict, so removal names it.
/// Whether an identity has been created in this account.
///
/// The executor's own marker: `is_initialized()` is this file existing, so the boot screen's answer
/// cannot disagree with the one the session reports once it is running. Knowing it *before* the
/// executor starts is what lets a first run be told apart from a returning user — otherwise the
/// screen has to guess, and guesses badly, naming an account nobody made.
pub fn has_agent(path: &Path) -> bool {
    path.join("ad4m").join("agent.json").exists()
}

pub fn holds_launcher_state(path: &Path) -> bool {
    path.join("launcher-state.json").exists()
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

        /// A registry over a fresh temp directory, plus the paths it uses.
    fn temp_registry() -> (PathBuf, PathBuf, AccountRegistry) {
        let root = std::env::temp_dir().join(format!(
            "we-accounts-rs-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let config_dir = root.join("config");
        let default_path = root.join(".ad4m");
        fs::create_dir_all(&default_path).unwrap();
        let registry = AccountRegistry::new(config_dir, default_path.clone());
        (root, default_path, registry)
    }

    fn seed_ad4m_data(path: &Path) {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("mainnet_seed.seed"), "{}").unwrap();
    }

    #[test]
    fn lists_the_default_account_before_anything_is_registered() {
        let (root, default_path, registry) = temp_registry();
        let accounts = registry.list();

        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, default_path.to_string_lossy());
        assert_eq!(accounts[0].name, "Main");
        assert!(accounts[0].active);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn keeps_created_accounts_inside_the_container() {
        let (root, default_path, registry) = temp_registry();
        let created = registry.create().unwrap();

        assert!(PathBuf::from(&created.id).starts_with(default_path.join("we-accounts")));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_renamed_away_container_is_a_reset_and_renaming_back_restores_it() {
        let (root, default_path, registry) = temp_registry();
        registry.set_display(&default_path.to_string_lossy(), Some("Personal"), None).unwrap();
        let created = registry.create().unwrap();
        registry.set_display(&created.id, Some("Work"), None).unwrap();

        let stashed = root.join("stashed");
        fs::rename(&default_path, &stashed).unwrap();

        // Everything went with it — accounts and the metadata describing them.
        let fresh = AccountRegistry::new(root.join("config"), default_path.clone());
        assert!(fresh.list().is_empty());
        // ...and merely listing must not recreate the container, or the reset would undo itself.
        assert_eq!(fresh.resolve_active_path(), default_path);
        assert!(!default_path.exists());

        fs::rename(&stashed, &default_path).unwrap();

        let restored = AccountRegistry::new(root.join("config"), default_path.clone());
        let mut names: Vec<String> = restored.list().into_iter().map(|a| a.name).collect();
        names.sort();
        assert_eq!(names, vec!["Personal".to_string(), "Work".to_string()]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn falls_back_when_the_selected_directory_is_renamed_away() {
        let (root, default_path, registry) = temp_registry();
        let created = registry.create().unwrap();
        assert_eq!(registry.resolve_active_path(), PathBuf::from(&created.id));

        fs::rename(&created.id, format!("{}-old", created.id)).unwrap();

        // Previously the selection was only checked against the list, so a path that no longer
        // existed was still handed to the executor, which scaffolded it back.
        assert_eq!(registry.resolve_active_path(), default_path);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn refuses_the_container_account_while_it_holds_the_others() {
        let (root, default_path, registry) = temp_registry();
        seed_ad4m_data(&default_path);
        let created = registry.create().unwrap();
        registry.select(&created.id).unwrap();

        let err = registry.remove(&default_path.to_string_lossy()).unwrap_err();
        assert!(err.contains("other accounts first"), "got: {err}");
        assert!(default_path.exists());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn deletes_an_abandoned_account_inside_the_container() {
        // The shape check is for paths we did not create. Applying it here would skip the delete,
        // leave the directory on disk, and the scan would put the account straight back.
        let (root, default_path, registry) = temp_registry();
        let created = registry.create().unwrap();
        registry.select(&default_path.to_string_lossy()).unwrap();

        registry.remove(&created.id).unwrap();

        assert!(!PathBuf::from(&created.id).exists());
        assert_eq!(registry.list().len(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn migration_does_not_run_again_when_the_container_is_wiped() {
        // The container going away is the supported way to start fresh. Keying "already migrated"
        // on the new registry existing meant wiping it left the old file to repopulate the next
        // boot with the accounts that had just been deleted.
        let (root, default_path, _) = temp_registry();
        let config_dir = root.join("config");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("we-accounts.json"),
            serde_json::to_string(&RegistryState {
                accounts: vec![AccountEntry {
                    name: "Ghost".to_string(),
                    path: default_path.clone(),
                    avatar: None,
                    provisional: false,
                }],
                selected_path: default_path.clone(),
            })
            .unwrap(),
        )
        .unwrap();
        AccountRegistry::new(config_dir.clone(), default_path.clone());

        fs::remove_dir_all(&default_path).unwrap();
        fs::create_dir_all(&default_path).unwrap(); // as `init` scaffolds it on the next boot

        let after = AccountRegistry::new(config_dir, default_path);
        assert_eq!(after.list()[0].name, "Main");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn migrates_the_pre_container_layout() {
        let (root, default_path, _) = temp_registry();
        let config_dir = root.join("config");
        let legacy = config_dir.join("agents").join("work");
        seed_ad4m_data(&legacy);
        fs::write(
            config_dir.join("we-accounts.json"),
            serde_json::to_string(&RegistryState {
                accounts: vec![AccountEntry {
                    name: "Work".to_string(),
                    path: legacy.clone(),
                    avatar: None,
                    provisional: false,
                }],
                selected_path: legacy.clone(),
            })
            .unwrap(),
        )
        .unwrap();

        let migrated = AccountRegistry::new(config_dir, default_path.clone());

        // The directory moved rather than being registered where it lay: leaving it outside would
        // quietly break the promise that moving the container takes everything.
        let target = default_path.join("we-accounts").join("work");
        assert!(target.exists());
        assert!(!legacy.exists());
        assert_eq!(migrated.resolve_active_path(), target);
        assert!(migrated.list().iter().any(|a| a.name == "Work"));
        fs::remove_dir_all(root).ok();
    }

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
