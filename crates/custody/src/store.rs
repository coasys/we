//! Where a custody item rests: the macOS keychain, the Linux Secret Service, or a file in the data
//! folder — where Linux has no Secret Service, and where a macOS build lacks the keychain
//! entitlement. One item per identity, named `coasys.identity/<scid>`. No Windows: the desktop app
//! does not ship there.
//!
//! The place is decided per item, never for the whole process ([`PlacedStore`]): the custody folder
//! is shared by every account on this computer, so one identity's key can be sealed in a file
//! (made by a build that could not use the keychain) while another's is in the keychain, and both
//! stay usable. An item is used wherever it already is; a new item goes to the platform's store
//! when this build and session can use one, else to the file. Nothing moves on its own.
//!
//! A store keeps bytes; it does not know what they are. In the Secret Service and in a file they
//! are already sealed under the passphrase ([`crate::seal`]); the keychain item's access control is
//! the unlock, so the keychain store is the one that may hold the item as it is
//! ([`StoreKind::unlocks_itself`]).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ad4m_identity_client::VaultError;

/// Which kind of store holds an item, and so how the person unlocks it. Asked per item
/// ([`SecretStore::kind_of`]): two identities on one computer can rest in different kinds.
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
    /// The kind a new item is kept in.
    fn kind(&self) -> StoreKind;
    /// The kind the item under `name` is kept in — where it is now, or, when it is not kept
    /// anywhere yet, where it would go ([`SecretStore::kind`]). Asks whether it exists, never reads
    /// it. An error is an error: it never means the item is absent.
    fn kind_of(&self, name: &str) -> Result<StoreKind, VaultError>;
    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError>;
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError>;
    /// Whether an item is kept under `name`, without reading it: no unlock, no prompt, and the bytes
    /// never leave the store.
    fn contains(&self, name: &str) -> Result<bool, VaultError>;
    fn delete(&self, name: &str) -> Result<(), VaultError>;
    /// Whether the store can be reached now, so a new item may go to it. Always, for a store that
    /// is not reached over a connection.
    fn reachable(&self) -> bool {
        true
    }
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

/// Makes the entries of `dir` durable: a file renamed into it or removed from it is renamed or
/// removed after a crash too. Syncing the file before its rename makes its bytes durable, not the
/// directory entry that names it; until the directory is synced, a power loss can leave the old
/// name (POSIX `fsync(2)` of the directory; ext4 commits it with the journal, seconds later). A
/// no-op where a directory cannot be opened to sync (Windows, whose `MoveFileEx` the rename is).
pub(crate) fn sync_dir(dir: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    std::fs::File::open(dir)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

impl SecretStore for FileStore {
    fn kind(&self) -> StoreKind {
        StoreKind::File
    }

    fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
        Ok(StoreKind::File)
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
    fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
        Ok(self.kind())
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
    use std::sync::mpsc;

    use secret_service::blocking::SecretService;
    use secret_service::EncryptionType;

    use super::*;

    const ATTRIBUTE: &str = "coasys-identity";

    type Job = Box<dyn FnOnce(&SecretService<'static>) + Send>;

    /// The default collection of the session's Secret Service (GNOME Keyring, KWallet), attribute
    /// `coasys-identity = <name>`.
    ///
    /// The client is blocking, and runs on a thread of its own that holds it from connect to drop.
    /// Its blocking calls start an async runtime of their own, which panics on a thread that already
    /// runs one: the custody service's thread does, so the client is never called, or dropped,
    /// there. `tests/secret_service.rs` checks this against a real Secret Service.
    pub struct SecretServiceStore {
        jobs: mpsc::Sender<Job>,
    }

    fn unavailable(e: secret_service::Error) -> VaultError {
        VaultError::Unavailable(format!("Secret Service: {e}"))
    }

    fn ended() -> VaultError {
        VaultError::Unavailable("Secret Service: its thread ended".into())
    }

    fn open() -> Result<SecretService<'static>, VaultError> {
        let service = SecretService::connect(EncryptionType::Dh).map_err(unavailable)?;
        // A session bus with no Secret Service answers the connect and fails here.
        service.get_default_collection().map_err(unavailable)?;
        Ok(service)
    }

    impl SecretServiceStore {
        /// Connects, or answers why not — the caller falls back to [`FileStore`].
        pub fn connect() -> Result<Self, VaultError> {
            let (jobs, inbox) = mpsc::channel::<Job>();
            let (opened, connected) = mpsc::channel();
            std::thread::Builder::new()
                .name("custody-secret-service".into())
                .spawn(move || {
                    let service = match open() {
                        Ok(service) => service,
                        Err(e) => {
                            let _ = opened.send(Err(e));
                            return;
                        }
                    };
                    let _ = opened.send(Ok(()));
                    // Ends when the store is dropped, and drops the client on this thread.
                    for job in inbox {
                        job(&service);
                    }
                })
                .map_err(|e| VaultError::Unavailable(format!("Secret Service thread: {e}")))?;
            connected.recv().map_err(|_| ended())??;
            Ok(SecretServiceStore { jobs })
        }

        /// Runs `job` on the client's thread and waits for its answer.
        fn run<T: Send + 'static>(
            &self,
            job: impl FnOnce(&SecretService<'static>) -> Result<T, VaultError> + Send + 'static,
        ) -> Result<T, VaultError> {
            let (answer, answered) = mpsc::channel();
            self.jobs
                .send(Box::new(move |service| {
                    let _ = answer.send(job(service));
                }))
                .map_err(|_| ended())?;
            answered.recv().map_err(|_| ended())?
        }
    }

    impl SecretStore for SecretServiceStore {
        fn kind(&self) -> StoreKind {
            StoreKind::SecretService
        }

        fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
            Ok(StoreKind::SecretService)
        }

        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            // The copy that crosses to the client's thread is wiped when the job ends.
            let (name, bytes) = (name.to_string(), zeroize::Zeroizing::new(bytes.to_vec()));
            self.run(move |service| {
                let collection = service.get_default_collection().map_err(unavailable)?;
                if collection.is_locked().map_err(unavailable)? {
                    collection.unlock().map_err(unavailable)?;
                }
                collection
                    .create_item(
                        &name,
                        HashMap::from([(ATTRIBUTE, name.as_str())]),
                        &bytes,
                        true,
                        "application/octet-stream",
                    )
                    .map_err(unavailable)?;
                Ok(())
            })
        }

        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            let name = name.to_string();
            self.run(move |service| {
                let found = service
                    .search_items(HashMap::from([(ATTRIBUTE, name.as_str())]))
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
            })
        }

        fn contains(&self, name: &str) -> Result<bool, VaultError> {
            // `SearchItems` answers for locked items too, listing them apart: nothing is unlocked
            // and no secret is fetched.
            let name = name.to_string();
            self.run(move |service| {
                let found = service
                    .search_items(HashMap::from([(ATTRIBUTE, name.as_str())]))
                    .map_err(unavailable)?;
                Ok(!found.unlocked.is_empty() || !found.locked.is_empty())
            })
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            let name = name.to_string();
            self.run(move |service| {
                let found = service
                    .search_items(HashMap::from([(ATTRIBUTE, name.as_str())]))
                    .map_err(unavailable)?;
                for item in found.unlocked.into_iter().chain(found.locked) {
                    item.delete().map_err(unavailable)?;
                }
                Ok(())
            })
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
    /// `errSecMissingEntitlement` from every write (a read finds nothing);
    /// [`system_store`](super::system_store) probes with one write at start and gives such a build
    /// no platform store, so its items rest in the [`FileStore`].
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

        fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
            Ok(StoreKind::Keychain)
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

    /// Whether this build may write to the data-protection keychain: the raw `OSStatus` of adding
    /// `name` as an empty item with no access control (so no prompt), which is deleted again at
    /// once. Only a write shows a missing entitlement: an unsigned build's read answers
    /// errSecItemNotFound, and its first add errSecMissingEntitlement.
    pub(super) fn write_status(name: &str) -> i32 {
        match set_generic_password_options(&[], item(name)) {
            Ok(()) => {
                let _ = delete_generic_password_options(item(name));
                0
            }
            Err(e) => e.code(),
        }
    }

    /// What the keychain answers when asked whether `name` is kept: the raw `OSStatus` of an
    /// attributes-only, no-UI `SecItemCopyMatching`. Never the data, and never a prompt: an item
    /// that exists but would need the person to read even this much answers
    /// errSecInteractionNotAllowed.
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

/// An item name no identity can have (a scid is base58, never `probe`), written and deleted once
/// at start to learn whether the keychain takes this build's writes at all.
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

// ─── Placed per item ──────────────────────────────────────────────────────────────

/// The file and, where this build and session can use one, the platform's own store, with each
/// item kept on the side that holds it.
///
/// Every call first asks both sides whether they hold the item, without reading it:
/// - one side holds it: that side is used for every read, write, check and delete, with its own
///   kind — so a key sealed in the file is opened with its passphrase while a key in the keychain
///   beside it asks for none;
/// - neither does: a new item goes to the platform store, or to the file when there is none;
/// - both do: refused. Two copies of one identity's key are not something this store made, and
///   choosing one would hide the other.
///
/// If either side cannot answer, the call is refused rather than taken to mean the item is not
/// there: falling through to the other side would hide a key, or put a second one beside it.
/// Nothing is ever moved from one side to the other.
pub struct PlacedStore {
    file: Box<dyn SecretStore>,
    platform: Option<Box<dyn SecretStore>>,
}

fn unanswered(side: &str, e: VaultError) -> VaultError {
    VaultError::Unavailable(format!(
        "cannot tell whether the {side} holds this master key: {e}"
    ))
}

impl PlacedStore {
    /// `file` is the sealed-file side; `platform` the keychain or Secret Service, `None` when this
    /// build or session cannot use one.
    pub fn new(file: Box<dyn SecretStore>, platform: Option<Box<dyn SecretStore>>) -> Self {
        PlacedStore { file, platform }
    }

    /// The side that holds `name`, `None` when neither does.
    fn holder(&self, name: &str) -> Result<Option<&dyn SecretStore>, VaultError> {
        let in_file = self
            .file
            .contains(name)
            .map_err(|e| unanswered("custody file", e))?;
        let on_platform = match self.platform.as_deref() {
            Some(platform) => platform
                .contains(name)
                .map_err(|e| unanswered("platform store", e))?
                .then_some(platform),
            None => None,
        };
        match (in_file, on_platform) {
            (true, Some(_)) => Err(VaultError::Unavailable(
                "this master key is kept both in the custody file and in the platform store; \
                 remove one copy"
                    .into(),
            )),
            (true, None) => Ok(Some(self.file.as_ref())),
            (false, platform) => Ok(platform),
        }
    }

    /// The side a new item goes to: the platform's store while it can be reached, else the file.
    fn for_new(&self) -> &dyn SecretStore {
        match self.platform.as_deref() {
            Some(platform) if platform.reachable() => platform,
            _ => self.file.as_ref(),
        }
    }

    /// The side that holds `name`, or the one it goes to when it is new.
    fn side(&self, name: &str) -> Result<&dyn SecretStore, VaultError> {
        Ok(self.holder(name)?.unwrap_or(self.for_new()))
    }
}

impl SecretStore for PlacedStore {
    fn kind(&self) -> StoreKind {
        self.for_new().kind()
    }

    fn kind_of(&self, name: &str) -> Result<StoreKind, VaultError> {
        self.side(name)?.kind_of(name)
    }

    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
        self.side(name)?.put(name, bytes)
    }

    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
        match self.holder(name)? {
            Some(side) => side.get(name),
            None => Ok(None),
        }
    }

    fn contains(&self, name: &str) -> Result<bool, VaultError> {
        Ok(self.holder(name)?.is_some())
    }

    fn delete(&self, name: &str) -> Result<(), VaultError> {
        match self.holder(name)? {
            Some(side) => side.delete(name),
            None => Ok(()),
        }
    }
}

// ─── Reconnecting ───────────────────────────────────────────────────────────────

/// Connects the platform store.
pub type Connect = Box<dyn Fn() -> Result<Box<dyn SecretStore>, VaultError> + Send + Sync>;

/// A platform store reached over a connection — the Linux Secret Service — connected when first
/// needed and again whenever it was not reached, rather than once when the service starts.
///
/// Asked once, a keyring that was slow to start at login, or a session that gained one later,
/// would leave the store absent for the life of the process, and a key kept there would look like
/// no key at all. So every call connects if it is not connected, and a call that fails drops the
/// connection for the next to make again.
///
/// While it cannot be reached, whether it holds an item is still answered, from a marker kept
/// beside the sealed files (`<scid>.platform`) whenever an item is put there: with a marker, the
/// call is refused, because the key is there and only the service is missing; without one, it does
/// not hold the item, so a computer that has no Secret Service at all keeps working from its files.
/// A new item goes to the file only while the service cannot be reached ([`PlacedStore`]).
pub struct Reconnecting {
    kind: StoreKind,
    markers: PathBuf,
    connect: Connect,
    store: Mutex<Option<Arc<dyn SecretStore>>>,
}

impl Reconnecting {
    pub fn new(kind: StoreKind, markers: impl Into<PathBuf>, connect: Connect) -> Self {
        Reconnecting {
            kind,
            markers: markers.into(),
            connect,
            store: Mutex::new(None),
        }
    }

    fn reach(&self) -> Result<Arc<dyn SecretStore>, VaultError> {
        let mut store = self.store.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(connected) = store.as_ref() {
            return Ok(connected.clone());
        }
        let connected: Arc<dyn SecretStore> = Arc::from((self.connect)()?);
        *store = Some(connected.clone());
        Ok(connected)
    }

    /// The answer of `call` on the connected store; a failure drops the connection, so the next
    /// call connects again.
    fn on<T>(
        &self,
        connected: &Arc<dyn SecretStore>,
        call: impl FnOnce(&dyn SecretStore) -> Result<T, VaultError>,
    ) -> Result<T, VaultError> {
        let answer = call(connected.as_ref());
        if answer.is_err() {
            *self.store.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
        answer
    }

    fn marker(&self, name: &str) -> PathBuf {
        let file = name.rsplit('/').next().unwrap_or(name);
        self.markers.join(format!("{file}.platform"))
    }

    fn marked(&self, name: &str) -> Result<bool, VaultError> {
        match std::fs::metadata(self.marker(name)) {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(io(e)),
        }
    }

    /// While the store cannot be reached: an item it was given is refused, anything else is absent.
    fn unreached<T>(&self, name: &str, why: VaultError, absent: T) -> Result<T, VaultError> {
        if self.marked(name)? {
            Err(VaultError::Unavailable(format!(
                "this master key is kept in the platform store, which is not answering: {why}"
            )))
        } else {
            Ok(absent)
        }
    }
}

impl SecretStore for Reconnecting {
    fn kind(&self) -> StoreKind {
        self.kind
    }

    fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
        Ok(self.kind)
    }

    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
        let connected = self.reach()?;
        self.on(&connected, |store| store.put(name, bytes))?;
        std::fs::create_dir_all(&self.markers).map_err(io)?;
        std::fs::write(self.marker(name), b"").map_err(io)
    }

    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
        match self.reach() {
            Ok(connected) => self.on(&connected, |store| store.get(name)),
            Err(why) => self.unreached(name, why, None),
        }
    }

    fn contains(&self, name: &str) -> Result<bool, VaultError> {
        match self.reach() {
            Ok(connected) => self.on(&connected, |store| store.contains(name)),
            Err(why) => self.unreached(name, why, false),
        }
    }

    fn delete(&self, name: &str) -> Result<(), VaultError> {
        match self.reach() {
            Ok(connected) => self.on(&connected, |store| store.delete(name))?,
            Err(why) => self.unreached(name, why, ())?,
        }
        match std::fs::remove_file(self.marker(name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(e)),
            _ => Ok(()),
        }
    }

    fn reachable(&self) -> bool {
        self.reach().is_ok()
    }
}

/// The store this computer offers: a [`PlacedStore`] over the sealed files in `fallback_dir` and
/// the platform's store. An item already kept on one side stays there. A new item goes, on macOS,
/// to the keychain, unless this build lacks the keychain entitlement (an unsigned or
/// ad-hoc-signed build), then to that file, sealed under a passphrase; on Linux, to the Secret
/// Service, else to that file.
pub fn system_store(fallback_dir: PathBuf) -> Box<dyn SecretStore> {
    let platform = platform_store(&fallback_dir);
    Box::new(PlacedStore::new(
        Box::new(FileStore::new(fallback_dir)),
        platform,
    ))
}

/// The keychain, when this build can use it; the Secret Service, reached whenever it answers
/// ([`Reconnecting`], its markers beside the sealed files in `dir`).
#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
fn platform_store(dir: &std::path::Path) -> Option<Box<dyn SecretStore>> {
    #[cfg(target_os = "macos")]
    {
        if keychain_usable(keychain_store::write_status(PROBE_NAME)) {
            return Some(Box::new(KeychainStore));
        }
        log::warn!(
            "custody: the data-protection keychain needs an entitlement this build lacks; keeping \
             the master key sealed in a file behind a passphrase"
        );
    }
    #[cfg(target_os = "linux")]
    {
        if let Err(e) = SecretServiceStore::connect() {
            log::warn!(
                "custody: no Secret Service yet ({e}); a new key goes to a sealed file until one \
                 answers"
            );
        }
        return Some(Box::new(Reconnecting::new(
            StoreKind::SecretService,
            dir.to_path_buf(),
            Box::new(|| {
                SecretServiceStore::connect().map(|store| Box::new(store) as Box<dyn SecretStore>)
            }),
        )));
    }
    #[allow(unreachable_code)]
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

    /// One keyring behind a connection that can be down: every connect reaches the same items.
    struct Keyring {
        items: Arc<MemoryStore>,
        up: Arc<std::sync::atomic::AtomicBool>,
    }

    struct Session(Arc<MemoryStore>);

    impl SecretStore for Session {
        fn kind(&self) -> StoreKind {
            StoreKind::SecretService
        }
        fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
            Ok(StoreKind::SecretService)
        }
        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            self.0.put(name, bytes)
        }
        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            self.0.get(name)
        }
        fn contains(&self, name: &str) -> Result<bool, VaultError> {
            self.0.contains(name)
        }
        fn delete(&self, name: &str) -> Result<(), VaultError> {
            self.0.delete(name)
        }
    }

    impl Keyring {
        fn new(up: bool) -> Self {
            Keyring {
                items: Arc::new(MemoryStore::new()),
                up: Arc::new(std::sync::atomic::AtomicBool::new(up)),
            }
        }
        fn set_up(&self, up: bool) {
            self.up.store(up, std::sync::atomic::Ordering::SeqCst);
        }
        fn store(&self, markers: &std::path::Path) -> Reconnecting {
            let (items, up) = (self.items.clone(), self.up.clone());
            Reconnecting::new(
                StoreKind::SecretService,
                markers,
                Box::new(move || {
                    if up.load(std::sync::atomic::Ordering::SeqCst) {
                        Ok(Box::new(Session(items.clone())) as Box<dyn SecretStore>)
                    } else {
                        Err(VaultError::Unavailable("no Secret Service".into()))
                    }
                }),
            )
        }
    }

    #[test]
    fn a_secret_service_that_was_down_at_start_is_used_once_it_answers() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = Keyring::new(false);
        let placed = PlacedStore::new(
            Box::new(FileStore::new(dir.path())),
            Some(Box::new(keyring.store(dir.path()))),
        );
        // Down: a new item would go to the file.
        assert_eq!(placed.kind(), StoreKind::File);
        keyring.set_up(true);
        // Up: it goes to the Secret Service, and is found there.
        assert_eq!(placed.kind(), StoreKind::SecretService);
        let name = item_name("QmScid");
        placed.put(&name, b"sealed").unwrap();
        assert!(keyring.items.contains(&name).unwrap());
        assert!(!FileStore::new(dir.path()).contains(&name).unwrap());
        assert_eq!(placed.get(&name).unwrap().as_deref(), Some(&b"sealed"[..]));
    }

    #[test]
    fn a_key_in_a_secret_service_that_stops_answering_is_refused_not_taken_as_absent() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = Keyring::new(true);
        let placed = PlacedStore::new(
            Box::new(FileStore::new(dir.path())),
            Some(Box::new(keyring.store(dir.path()))),
        );
        let name = item_name("QmScid");
        placed.put(&name, b"sealed").unwrap();

        // A fresh process, while the keyring is down: the key is not "absent", and no second one
        // can be put in the file beside it.
        keyring.set_up(false);
        let later = PlacedStore::new(
            Box::new(FileStore::new(dir.path())),
            Some(Box::new(keyring.store(dir.path()))),
        );
        assert!(matches!(
            later.contains(&name),
            Err(VaultError::Unavailable(_))
        ));
        assert!(matches!(later.get(&name), Err(VaultError::Unavailable(_))));
        assert!(later.put(&name, b"another").is_err());
        // An identity it never held is still absent, so a computer without a keyring keeps working.
        assert!(!later.contains(&item_name("QmOther")).unwrap());

        keyring.set_up(true);
        assert_eq!(later.get(&name).unwrap().as_deref(), Some(&b"sealed"[..]));
        later.delete(&name).unwrap();
        keyring.set_up(false);
        assert!(!later.contains(&name).unwrap());
    }
}
