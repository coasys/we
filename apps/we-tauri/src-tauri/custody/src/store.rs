//! Where a custody item rests: the macOS keychain, the Linux Secret Service, or a file in the data
//! folder — where Linux has no Secret Service, and where a macOS build lacks the keychain
//! entitlement. One item per identity, named `coasys.identity/<scid>`. No Windows: the desktop app
//! does not ship there.
//!
//! A store keeps bytes; it does not know what they are. In the Secret Service and in a file they
//! are already sealed under the passphrase ([`crate::seal`]); the keychain item's access control is
//! the unlock, so the keychain store is the one that may hold the item as it is
//! ([`StoreKind::unlocks_itself`]).

use std::path::PathBuf;

use ad4m_identity_client::VaultError;

/// Which kind of store holds the item, and so how the person unlocks it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreKind {
    /// macOS: a keychain item behind `.userPresence` — Touch ID or the login password.
    Keychain,
    /// Linux: the Secret Service, holding the item sealed under a passphrase.
    SecretService,
    /// Linux without a Secret Service, or macOS without the keychain entitlement: a 0600 file
    /// holding the sealed item.
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
    /// Whether an item is kept under `name`, without reading it: no unlock, no prompt, and the bytes
    /// never leave the store.
    fn contains(&self, name: &str) -> Result<bool, VaultError>;
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

    /// Whether any sealed item is kept here (a `.bin` file; a half-written `.bin.tmp` does not
    /// count). Reads directory entries only.
    pub fn holds_any(&self) -> Result<bool, VaultError> {
        let entries = match std::fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(io(e)),
        };
        for entry in entries {
            let path = entry.map_err(io)?.path();
            if path.extension().is_some_and(|ext| ext == "bin") && path.is_file() {
                return Ok(true);
            }
        }
        Ok(false)
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

    fn contains(&self, name: &str) -> Result<bool, VaultError> {
        match std::fs::metadata(self.path(name)) {
            Ok(meta) => Ok(meta.is_file()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
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
        MemoryStore {
            kind: Some(kind),
            ..Default::default()
        }
    }

    /// Every byte the store holds, for tests that look for a key where it must not be.
    pub fn all_bytes(&self) -> Vec<u8> {
        self.items
            .lock()
            .map(|m| m.values().flatten().copied().collect())
            .unwrap_or_default()
    }
}

impl SecretStore for MemoryStore {
    fn kind(&self) -> StoreKind {
        self.kind.unwrap_or(StoreKind::Memory)
    }
    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
        self.items
            .lock()
            .map_err(|_| VaultError::Unavailable("poisoned".into()))?
            .insert(name.into(), bytes.to_vec());
        Ok(())
    }
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
        Ok(self
            .items
            .lock()
            .map_err(|_| VaultError::Unavailable("poisoned".into()))?
            .get(name)
            .cloned())
    }
    fn contains(&self, name: &str) -> Result<bool, VaultError> {
        Ok(self
            .items
            .lock()
            .map_err(|_| VaultError::Unavailable("poisoned".into()))?
            .contains_key(name))
    }
    fn delete(&self, name: &str) -> Result<(), VaultError> {
        self.items
            .lock()
            .map_err(|_| VaultError::Unavailable("poisoned".into()))?
            .remove(name);
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
                .create_item(
                    name,
                    HashMap::from([(ATTRIBUTE, name)]),
                    bytes,
                    true,
                    "application/octet-stream",
                )
                .map_err(unavailable)?;
            Ok(())
        }

        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            let found = self
                .service
                .search_items(HashMap::from([(ATTRIBUTE, name)]))
                .map_err(unavailable)?;
            let item = match (
                found.unlocked.into_iter().next(),
                found.locked.into_iter().next(),
            ) {
                (Some(item), _) => item,
                (None, Some(item)) => {
                    item.unlock().map_err(unavailable)?;
                    item
                }
                (None, None) => return Ok(None),
            };
            Ok(Some(item.get_secret().map_err(unavailable)?))
        }

        fn contains(&self, name: &str) -> Result<bool, VaultError> {
            // `SearchItems` answers for locked items too, listing them apart: nothing is unlocked
            // and no secret is fetched.
            let found = self
                .service
                .search_items(HashMap::from([(ATTRIBUTE, name)]))
                .map_err(unavailable)?;
            Ok(!found.unlocked.is_empty() || !found.locked.is_empty())
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            let found = self
                .service
                .search_items(HashMap::from([(ATTRIBUTE, name)]))
                .map_err(unavailable)?;
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
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use security_framework::base::Error;
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options,
        AccessControlOptions, PasswordOptions,
    };
    use security_framework_sys::item::{
        kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecMatchLimit,
        kSecReturnAttributes, kSecUseAuthenticationUI, kSecUseDataProtectionKeychain,
    };
    use security_framework_sys::keychain_item::SecItemCopyMatching;

    use super::*;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        // "Fail rather than show UI" for `kSecUseAuthenticationUI`. Deprecated in macOS 11 in favour
        // of an `LAContext` with `interactionNotAllowed`, which would pull in LocalAuthentication;
        // still exported and honoured.
        static kSecUseAuthenticationUIFail: CFStringRef;
    }

    /// A data-protection keychain item, generic password, service `org.coasys.app`, account the item
    /// name, readable only after the user is present (Touch ID or the login password).
    ///
    /// Needs an app signed with a `keychain-access-groups` entitlement. A build without one gets
    /// `errSecMissingEntitlement` from every call; [`system_store`](super::system_store) probes for
    /// that once and gives such a build the [`FileStore`] instead.
    pub struct KeychainStore;

    const SERVICE: &str = "org.coasys.app";

    const ERR_SEC_USER_CANCELED: i32 = -128;
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;

    fn unavailable(e: Error) -> VaultError {
        if e.code() == ERR_SEC_USER_CANCELED {
            VaultError::Cancelled
        } else if e.code() == ERR_SEC_MISSING_ENTITLEMENT {
            VaultError::Unavailable(format!(
                "keychain: this build lacks the keychain entitlement (keychain-access-groups), so \
                 the data-protection keychain refuses it ({e})"
            ))
        } else {
            VaultError::Unavailable(format!("keychain: {e}"))
        }
    }

    /// The one item `name` names: this service, that account, in the data-protection keychain. Every
    /// operation goes through it, because a query without `use_protected_keychain` searches the
    /// legacy file keychain and never finds an item written to the data-protection one.
    fn item(name: &str) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(SERVICE, name);
        options.use_protected_keychain();
        options
    }

    impl SecretStore for KeychainStore {
        fn kind(&self) -> StoreKind {
            StoreKind::Keychain
        }

        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            // Replacing is delete-then-add, both in the data-protection keychain: an update cannot
            // change an item's access control, and the new item must carry it.
            self.delete(name)?;
            let mut options = item(name);
            options.set_access_control_options(AccessControlOptions::USER_PRESENCE);
            set_generic_password_options(bytes, options).map_err(unavailable)
        }

        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            match generic_password(item(name)) {
                Ok(bytes) => Ok(Some(bytes)),
                Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
                Err(e) => Err(unavailable(e)),
            }
        }

        fn contains(&self, name: &str) -> Result<bool, VaultError> {
            match probe_status(name) {
                0 | ERR_SEC_INTERACTION_NOT_ALLOWED => Ok(true),
                ERR_SEC_ITEM_NOT_FOUND => Ok(false),
                code => Err(unavailable(Error::from_code(code))),
            }
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            match delete_generic_password_options(item(name)) {
                Err(e) if e.code() != ERR_SEC_ITEM_NOT_FOUND => Err(unavailable(e)),
                _ => Ok(()),
            }
        }
    }

    /// What the keychain answers when asked whether `name` is kept: the raw `OSStatus` of an
    /// attributes-only, no-UI `SecItemCopyMatching`. Never the data, and never a prompt: an item
    /// that exists but would need the person to read even this much answers
    /// errSecInteractionNotAllowed. Also how [`system_store`](super::system_store) finds out
    /// whether this build may use the data-protection keychain at all.
    pub(super) fn probe_status(name: &str) -> i32 {
        let pairs: Vec<(CFString, CFType)> = unsafe {
            vec![
                (
                    CFString::wrap_under_get_rule(kSecClass),
                    CFString::wrap_under_get_rule(kSecClassGenericPassword).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrService),
                    CFString::new(SERVICE).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrAccount),
                    CFString::new(name).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecUseDataProtectionKeychain),
                    CFBoolean::true_value().into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecReturnAttributes),
                    CFBoolean::true_value().into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecMatchLimit),
                    CFNumber::from(1i64).into_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecUseAuthenticationUI),
                    CFString::wrap_under_get_rule(kSecUseAuthenticationUIFail).into_CFType(),
                ),
            ]
        };
        let query = CFDictionary::from_CFType_pairs(&pairs);
        let mut found: CFTypeRef = std::ptr::null();
        let status = unsafe { SecItemCopyMatching(query.as_concrete_TypeRef(), &mut found) };
        if !found.is_null() {
            // A +1 reference to the attributes dictionary; dropping the wrapper releases it.
            drop(unsafe { CFType::wrap_under_create_rule(found) });
        }
        status
    }
}

/// `errSecMissingEntitlement`: the data-protection keychain refuses a build signed without a
/// `keychain-access-groups` entitlement — and an unsigned build — on every call.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const ERR_SEC_MISSING_ENTITLEMENT: i32 = -34018;

/// An item name no identity can have (a scid is base58, never `probe`), asked about once to learn
/// whether the keychain answers this build at all.
#[cfg(target_os = "macos")]
const PROBE_NAME: &str = "coasys.identity/probe";

/// Whether the keychain may hold the item, from what it answered the probe. Only a missing
/// entitlement says no: it is a fact about how the build was signed and stays true for the life of
/// the process. Any other answer — found, not found, needs interaction, or an error that may pass
/// (a locked keychain, a busy daemon) — keeps the keychain, whose calls then report the error where
/// it happens rather than the master key moving to a file for a reason that would not last.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn keychain_usable(probe_status: i32) -> bool {
    probe_status != ERR_SEC_MISSING_ENTITLEMENT
}

/// The store this computer offers. A master key already sealed in a file under `fallback_dir`
/// stays there: an earlier build of the app chose the file, and the item is readable only through
/// it. Otherwise, macOS: the keychain, unless this build lacks the keychain entitlement (an
/// unsigned or ad-hoc-signed build), then that file, sealed under a passphrase. Linux: the Secret
/// Service, else that file.
pub fn system_store(fallback_dir: PathBuf) -> Box<dyn SecretStore> {
    choose_store(FileStore::new(fallback_dir), platform_store)
}

/// [`system_store`] with the platform's own store supplied by `platform` (`None`: not usable).
pub(crate) fn choose_store(
    file: FileStore,
    platform: impl FnOnce() -> Option<Box<dyn SecretStore>>,
) -> Box<dyn SecretStore> {
    match file.holds_any() {
        Ok(true) => {
            log::info!(
                "custody: the master key is already sealed in a file here; keeping it there"
            );
            Box::new(file)
        }
        _ => platform().unwrap_or_else(|| Box::new(file)),
    }
}

/// The keychain or the Secret Service, when this build and this session can use it.
fn platform_store() -> Option<Box<dyn SecretStore>> {
    #[cfg(target_os = "macos")]
    {
        if keychain_usable(keychain_store::probe_status(PROBE_NAME)) {
            return Some(Box::new(KeychainStore));
        }
        log::warn!(
            "custody: the data-protection keychain needs an entitlement this build lacks; keeping \
             the master key sealed in a file behind a passphrase"
        );
    }
    #[cfg(target_os = "linux")]
    {
        match SecretServiceStore::connect() {
            Ok(store) => return Some(Box::new(store)),
            Err(e) => {
                log::warn!("custody: no Secret Service ({e}); keeping the sealed item in a file")
            }
        }
    }
    None
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
            let mode = std::fs::metadata(dir.path().join("custody/QmScid.bin"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        store.delete(&name).unwrap();
        store.delete(&name).unwrap();
        assert_eq!(store.get(&name).unwrap(), None);
    }

    #[test]
    fn a_file_store_says_whether_it_holds_an_item_without_reading_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path().join("custody"));
        let name = item_name("QmScid");
        // Before the folder exists at all.
        assert!(!store.contains(&name).unwrap());
        store.put(&name, b"sealed bytes").unwrap();
        assert!(store.contains(&name).unwrap());
        assert!(!store.contains(&item_name("QmOther")).unwrap());
        #[cfg(unix)]
        {
            // With the file unreadable, a read fails and `contains` still answers: it looks at the
            // directory entry, never at the bytes. (Root reads anything, so the read is only
            // asserted to fail where it can.)
            use std::os::unix::fs::PermissionsExt;
            let path = dir.path().join("custody/QmScid.bin");
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
            if std::fs::read(&path).is_err() {
                assert!(store.get(&name).is_err());
            }
            assert!(store.contains(&name).unwrap());
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        store.delete(&name).unwrap();
        assert!(!store.contains(&name).unwrap());
    }

    #[test]
    fn only_a_missing_entitlement_moves_macos_off_the_keychain() {
        // errSecMissingEntitlement: the build cannot use the data-protection keychain at all.
        assert!(!keychain_usable(ERR_SEC_MISSING_ENTITLEMENT));
        assert!(!keychain_usable(-34018));
        // errSecSuccess, errSecItemNotFound, errSecInteractionNotAllowed: the keychain answered.
        for status in [0, -25300, -25308] {
            assert!(keychain_usable(status), "{status}");
        }
        // Any other error (errSecAuthFailed, errSecNotAvailable, errSecUserCanceled, errSecParam)
        // keeps the keychain: none is known to be permanent, and its calls report it as it comes.
        for status in [-25293, -25291, -128, -50] {
            assert!(keychain_usable(status), "{status}");
        }
    }

    #[test]
    fn a_memory_store_says_whether_it_holds_an_item() {
        let store = MemoryStore::new();
        let name = item_name("QmScid");
        assert!(!store.contains(&name).unwrap());
        store.put(&name, b"bytes").unwrap();
        assert!(store.contains(&name).unwrap());
        assert!(!store.contains(&item_name("QmOther")).unwrap());
        store.delete(&name).unwrap();
        assert!(!store.contains(&name).unwrap());
    }
}
