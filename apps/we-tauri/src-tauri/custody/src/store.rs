//! Where a custody item rests (AR-03 4.4.4): the macOS keychain, the Linux Secret Service, or a
//! file in the data folder where Linux has no Secret Service. One item per identity, named
//! `coasys.identity/<scid>`. No Windows (decision 22.4).
//!
//! A store keeps bytes; it does not know what they are. On Linux they are already sealed under the
//! passphrase ([`crate::seal`]); on macOS the keychain item's access control is the unlock, so the
//! keychain store is the one that may hold the item as it is ([`StoreKind::unlocks_itself`]).

use std::path::PathBuf;

use ad4m_identity_client::VaultError;

/// Which kind of store holds the item, and so how the person unlocks it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreKind {
    /// macOS: a keychain item behind `.userPresence` — Touch ID or the login password.
    Keychain,
    /// Linux: the Secret Service, holding the item sealed under a passphrase.
    SecretService,
    /// Linux without a Secret Service: a 0600 file holding the sealed item.
    File,
    /// Tests.
    Memory,
}

impl StoreKind {
    /// The OS asks for the unlock itself, so the item is not sealed under a passphrase.
    pub fn unlocks_itself(self) -> bool {
        matches!(self, StoreKind::Keychain)
    }
}

/// Bytes kept by name.
pub trait SecretStore: Send + Sync {
    fn kind(&self) -> StoreKind;
    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError>;
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError>;
    fn delete(&self, name: &str) -> Result<(), VaultError>;
}

/// The item's name for an identity.
pub fn item_name(scid: &str) -> String {
    format!("coasys.identity/{scid}")
}

// ─── File ───────────────────────────────────────────────────────────────────────

/// `<dir>/<scid>.bin`, mode 0600, written whole through a temp file so a crash leaves the old one.
pub struct FileStore {
    dir: PathBuf,
}

impl FileStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        FileStore { dir: dir.into() }
    }

    fn path(&self, name: &str) -> PathBuf {
        // `coasys.identity/<scid>`: a scid is base58, so the file name is the part after the slash.
        let file = name.rsplit('/').next().unwrap_or(name);
        self.dir.join(format!("{file}.bin"))
    }
}

fn io(e: std::io::Error) -> VaultError {
    VaultError::Unavailable(format!("custody file: {e}"))
}

impl SecretStore for FileStore {
    fn kind(&self) -> StoreKind {
        StoreKind::File
    }

    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
        use std::io::Write;
        std::fs::create_dir_all(&self.dir).map_err(io)?;
        let path = self.path(name);
        let tmp = path.with_extension("bin.tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp).map_err(io)?;
        file.write_all(bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
        std::fs::rename(&tmp, &path).map_err(io)
    }

    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
        match std::fs::read(self.path(name)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io(e)),
        }
    }

    fn delete(&self, name: &str) -> Result<(), VaultError> {
        match std::fs::remove_file(self.path(name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(e)),
            _ => Ok(()),
        }
    }
}

// ─── Memory (tests) ─────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct MemoryStore {
    items: std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>,
    kind: Option<StoreKind>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// A memory store that behaves as `kind` does — a keychain that unlocks itself, say.
    pub fn as_kind(kind: StoreKind) -> Self {
        MemoryStore { kind: Some(kind), ..Default::default() }
    }

    /// Every byte the store holds, for tests that look for a key where it must not be.
    pub fn all_bytes(&self) -> Vec<u8> {
        self.items.lock().map(|m| m.values().flatten().copied().collect()).unwrap_or_default()
    }
}

impl SecretStore for MemoryStore {
    fn kind(&self) -> StoreKind {
        self.kind.unwrap_or(StoreKind::Memory)
    }
    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
        self.items.lock().map_err(|_| VaultError::Unavailable("poisoned".into()))?.insert(name.into(), bytes.to_vec());
        Ok(())
    }
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
        Ok(self.items.lock().map_err(|_| VaultError::Unavailable("poisoned".into()))?.get(name).cloned())
    }
    fn delete(&self, name: &str) -> Result<(), VaultError> {
        self.items.lock().map_err(|_| VaultError::Unavailable("poisoned".into()))?.remove(name);
        Ok(())
    }
}

// ─── Linux: the Secret Service ──────────────────────────────────────────────────

#[cfg(target_os = "linux")]
pub use secret_service_store::SecretServiceStore;

#[cfg(target_os = "linux")]
mod secret_service_store {
    use std::collections::HashMap;

    use secret_service::blocking::SecretService;
    use secret_service::EncryptionType;

    use super::*;

    const ATTRIBUTE: &str = "coasys-identity";

    /// The default collection of the session's Secret Service (GNOME Keyring, KWallet), attribute
    /// `coasys-identity = <name>`. Blocking calls: the custody service runs on its own thread.
    pub struct SecretServiceStore {
        service: SecretService<'static>,
    }

    fn unavailable(e: secret_service::Error) -> VaultError {
        VaultError::Unavailable(format!("Secret Service: {e}"))
    }

    impl SecretServiceStore {
        /// Connects, or answers why not — the caller falls back to [`FileStore`].
        pub fn connect() -> Result<Self, VaultError> {
            let service = SecretService::connect(EncryptionType::Dh).map_err(unavailable)?;
            // A session bus with no Secret Service answers the connect and fails here.
            service.get_default_collection().map_err(unavailable)?;
            Ok(SecretServiceStore { service })
        }
    }

    impl SecretStore for SecretServiceStore {
        fn kind(&self) -> StoreKind {
            StoreKind::SecretService
        }

        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            let collection = self.service.get_default_collection().map_err(unavailable)?;
            if collection.is_locked().map_err(unavailable)? {
                collection.unlock().map_err(unavailable)?;
            }
            collection
                .create_item(name, HashMap::from([(ATTRIBUTE, name)]), bytes, true, "application/octet-stream")
                .map_err(unavailable)?;
            Ok(())
        }

        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            let found = self.service.search_items(HashMap::from([(ATTRIBUTE, name)])).map_err(unavailable)?;
            let item = match (found.unlocked.into_iter().next(), found.locked.into_iter().next()) {
                (Some(item), _) => item,
                (None, Some(item)) => {
                    item.unlock().map_err(unavailable)?;
                    item
                }
                (None, None) => return Ok(None),
            };
            Ok(Some(item.get_secret().map_err(unavailable)?))
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            let found = self.service.search_items(HashMap::from([(ATTRIBUTE, name)])).map_err(unavailable)?;
            for item in found.unlocked.into_iter().chain(found.locked) {
                item.delete().map_err(unavailable)?;
            }
            Ok(())
        }
    }
}

// ─── macOS: the keychain ────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub use keychain_store::KeychainStore;

#[cfg(target_os = "macos")]
mod keychain_store {
    use security_framework::passwords::{
        delete_generic_password, generic_password, set_generic_password_options, AccessControlOptions,
        PasswordOptions,
    };

    use super::*;

    /// A data-protection keychain item, generic password, service `org.coasys.app`, account the item
    /// name, readable only after the user is present (Touch ID or the login password).
    ///
    /// Needs a signed app with a keychain access group entitlement (spike SP-2, AR-03 4.4.4). An
    /// unsigned build gets `errSecMissingEntitlement` and the caller falls back to the file store.
    pub struct KeychainStore;

    const SERVICE: &str = "org.coasys.app";

    fn unavailable(e: security_framework::base::Error) -> VaultError {
        // -128 errSecUserCanceled: the person cancelled the prompt.
        if e.code() == -128 {
            VaultError::Cancelled
        } else {
            VaultError::Unavailable(format!("keychain: {e}"))
        }
    }

    impl SecretStore for KeychainStore {
        fn kind(&self) -> StoreKind {
            StoreKind::Keychain
        }

        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            let _ = delete_generic_password(SERVICE, name);
            let mut options = PasswordOptions::new_generic_password(SERVICE, name);
            options.set_access_control_options(AccessControlOptions::USER_PRESENCE);
            options.use_protected_keychain();
            set_generic_password_options(bytes, options).map_err(unavailable)
        }

        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            match generic_password(PasswordOptions::new_generic_password(SERVICE, name)) {
                Ok(bytes) => Ok(Some(bytes)),
                // -25300 errSecItemNotFound
                Err(e) if e.code() == -25300 => Ok(None),
                Err(e) => Err(unavailable(e)),
            }
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            match delete_generic_password(SERVICE, name) {
                Err(e) if e.code() != -25300 => Err(unavailable(e)),
                _ => Ok(()),
            }
        }
    }
}

/// The store this computer offers: the keychain on macOS; on Linux the Secret Service, else a file
/// under `fallback_dir`. A file on macOS only if the keychain cannot be reached at all.
pub fn system_store(fallback_dir: PathBuf) -> Box<dyn SecretStore> {
    #[cfg(target_os = "macos")]
    {
        let _ = fallback_dir;
        return Box::new(KeychainStore);
    }
    #[cfg(target_os = "linux")]
    {
        match SecretServiceStore::connect() {
            Ok(store) => return Box::new(store),
            Err(e) => log::warn!("custody: no Secret Service ({e}); keeping the sealed item in a file"),
        }
    }
    #[allow(unreachable_code)]
    Box::new(FileStore::new(fallback_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_store_keeps_one_item_per_identity_readable_only_by_its_owner() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path().join("custody"));
        let name = item_name("QmScid");
        assert_eq!(store.get(&name).unwrap(), None);
        store.put(&name, b"one").unwrap();
        store.put(&name, b"two").unwrap();
        assert_eq!(store.get(&name).unwrap().as_deref(), Some(&b"two"[..]));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("custody/QmScid.bin")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        store.delete(&name).unwrap();
        store.delete(&name).unwrap();
        assert_eq!(store.get(&name).unwrap(), None);
    }
}
