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

use ad4m_identity_client::{StageToken, VaultError};

/// What an item kept as it is ([`StoreKind::unlocks_itself`]) carries beside its bytes as public
/// attributes, written in the same store operation as the bytes: its master index, and for a
/// staged key the token of the flow that staged it. Neither is secret; both are read with no
/// unlock. A sealed item carries the same in its own authenticated header
/// ([`crate::seal::sealed_index`], [`crate::seal::sealed_owner`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ItemTag {
    pub index: u32,
    pub owner: Option<StageToken>,
}

/// The prefix of the comment a keychain item kept with its [`ItemTag`] carries.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const INDEX_COMMENT: &str = "coasys-master-index:";
/// Between the index and the owner token in that comment.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const OWNER_COMMENT: &str = ";owner:";

/// The keychain comment (`kSecAttrComment`) that carries `tag`: `coasys-master-index:<n>`, and
/// `;owner:<32 hex digits>` after it for a staged key. One attribute, so it is written in the
/// same `SecItemAdd` as the key.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn tag_comment(tag: &ItemTag) -> String {
    let mut comment = format!("{INDEX_COMMENT}{}", tag.index);
    if let Some(owner) = tag.owner {
        comment.push_str(OWNER_COMMENT);
        for byte in owner.0 {
            comment.push_str(&format!("{byte:02x}"));
        }
    }
    comment
}

/// The [`ItemTag`] a keychain comment carries. `None` when it carries no index (an item kept
/// before the index was); an owner that does not read as a token is no owner, so the key is
/// one only a discard naming no owner forgets.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn comment_tag(comment: &str) -> Option<ItemTag> {
    let rest = comment.strip_prefix(INDEX_COMMENT)?;
    let (index, owner) = match rest.split_once(OWNER_COMMENT) {
        Some((index, owner)) => (index, Some(owner)),
        None => (rest, None),
    };
    let owner = owner.and_then(|hex| {
        let mut token = [0u8; 16];
        if hex.len() != 32 || !hex.is_ascii() {
            return None;
        }
        for (at, byte) in token.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&hex[2 * at..2 * at + 2], 16).ok()?;
        }
        Some(StageToken(token))
    });
    Some(ItemTag {
        index: index.parse().ok()?,
        owner,
    })
}

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
    /// [`put`](SecretStore::put), with `tag` kept as public attributes of the item, written in
    /// the same operation as the bytes, for a store that keeps its items as they are
    /// ([`StoreKind::unlocks_itself`]): what [`tag_of`](SecretStore::tag_of) reads back with
    /// no unlock. A sealed item carries its tag in its own authenticated header
    /// ([`crate::seal::sealed_index`]) and goes through `put`; what comes here is the item as
    /// it is — the raw master key — so a store that keeps only sealed items (the file, the
    /// Secret Service) refuses it, which is this default. Only a store that unlocks itself
    /// overrides it.
    fn put_tagged(&self, name: &str, bytes: &[u8], tag: &ItemTag) -> Result<(), VaultError> {
        let _ = (name, bytes, tag);
        Err(refused_unsealed(self.kind()))
    }
    /// The tag [`put_tagged`](SecretStore::put_tagged) kept with the item `name`, read without
    /// the item's bytes (no unlock, no prompt). `None` when the item is absent, or was kept
    /// without one, or the store keeps none.
    fn tag_of(&self, name: &str) -> Result<Option<ItemTag>, VaultError> {
        let _ = name;
        Ok(None)
    }
    /// The item `from` becomes the item `to`, replacing it, with its attribute, and `from` is
    /// gone. `NotFound` when `from` is absent. Copies then deletes: a crash between leaves the
    /// same bytes under both names. A store that can rename without reading the bytes (the
    /// keychain, whose read prompts) does so.
    fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
        let bytes = zeroize::Zeroizing::new(self.get(from)?.ok_or(VaultError::NotFound)?);
        match self.tag_of(from)? {
            Some(tag) => self.put_tagged(to, &bytes, &tag)?,
            None => self.put(to, &bytes)?,
        }
        self.delete(from)
    }
}

/// A store that keeps only sealed items was handed one as it is ([`SecretStore::put_tagged`]).
fn refused_unsealed(kind: StoreKind) -> VaultError {
    VaultError::Unavailable(format!(
        "the {kind:?} store keeps only sealed master keys; an unsealed one was refused"
    ))
}

/// The item's name for an identity: its kept master key.
pub fn item_name(scid: &str) -> String {
    format!("{KEPT_PREFIX}{scid}")
}

/// The name of the master key a rotation staged for an identity before its publish
/// (`Vault::stage_master`): a second slot beside the kept one, in the same store.
pub fn staged_name(scid: &str) -> String {
    format!("{STAGED_PREFIX}{scid}")
}

const KEPT_PREFIX: &str = "coasys.identity/";
const STAGED_PREFIX: &str = "coasys.identity.staged/";

/// The file stem a name is kept under beside the sealed files: `<scid>` for a kept item,
/// `<scid>.staged` for a staged one (a scid is base58, so it has no dot of its own).
fn stem(name: &str) -> String {
    match name.strip_prefix(STAGED_PREFIX) {
        Some(scid) => format!("{scid}.staged"),
        None => name.rsplit('/').next().unwrap_or(name).to_string(),
    }
}

/// The kept item a staged name stands beside; `None` for any other name.
fn kept_beside(name: &str) -> Option<String> {
    name.strip_prefix(STAGED_PREFIX).map(item_name)
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
        // `coasys.identity/<scid>` is `<scid>.bin`, its staged slot `<scid>.staged.bin`.
        self.dir.join(format!("{}.bin", stem(name)))
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
        std::fs::rename(&tmp, &path).map_err(io)?;
        // `Ok` means durable: the name too, not only the bytes.
        sync_dir(&self.dir).map_err(io)
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
            Err(_) => Ok(()),
            Ok(()) => sync_dir(&self.dir).map_err(io),
        }
    }

    /// One `rename(2)`: the file under `to` is the old one or the new one, never neither. The
    /// folder is synced after it, so a promote answered `Ok` is still a promote after a crash.
    fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
        match std::fs::rename(self.path(from), self.path(to)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(VaultError::NotFound),
            other => {
                other.map_err(io)?;
                sync_dir(&self.dir).map_err(io)
            }
        }
    }
}

// ─── Memory (tests) ─────────────────────────────────────────────────────────────

/// An item's bytes and the index attribute kept with them.
type MemoryItem = (Vec<u8>, Option<ItemTag>);

#[derive(Default)]
pub struct MemoryStore {
    items: std::sync::Mutex<std::collections::HashMap<String, MemoryItem>>,
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
            .map(|m| m.values().flat_map(|(bytes, _)| bytes).copied().collect())
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
            .insert(name.into(), (bytes.to_vec(), None));
        Ok(())
    }
    /// As the store it stands in for: kept only as a keychain is.
    fn put_tagged(&self, name: &str, bytes: &[u8], tag: &ItemTag) -> Result<(), VaultError> {
        if !self.kind().unlocks_itself() {
            return Err(refused_unsealed(self.kind()));
        }
        self.items
            .lock()
            .map_err(|_| VaultError::Unavailable("poisoned".into()))?
            .insert(name.into(), (bytes.to_vec(), Some(*tag)));
        Ok(())
    }
    fn tag_of(&self, name: &str) -> Result<Option<ItemTag>, VaultError> {
        Ok(self
            .items
            .lock()
            .map_err(|_| VaultError::Unavailable("poisoned".into()))?
            .get(name)
            .and_then(|(_, tag)| *tag))
    }
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
        Ok(self
            .items
            .lock()
            .map_err(|_| VaultError::Unavailable("poisoned".into()))?
            .get(name)
            .map(|(bytes, _)| bytes.clone()))
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

/// What a store's error says when the keyring it keeps items in is locked and was not unlocked in
/// time, and [`is_keyring_locked`] looks for.
const KEYRING_LOCKED: &str = "the keyring is locked";

/// The keyring is locked: it asked to be unlocked and nobody answered in time, or the person
/// dismissed the prompt. Nothing was written.
pub fn keyring_locked() -> VaultError {
    VaultError::Unavailable(format!("Secret Service: {KEYRING_LOCKED}"))
}

/// Whether `error` is a store's keyring that stayed locked ([`keyring_locked`]).
pub fn is_keyring_locked(error: &VaultError) -> bool {
    matches!(error, VaultError::Unavailable(why) if why.contains(KEYRING_LOCKED))
}

#[cfg(target_os = "linux")]
pub use secret_service_store::SecretServiceStore;

#[cfg(target_os = "linux")]
mod secret_service_store {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    use secret_service::blocking::{Collection, Item, SecretService};
    use secret_service::EncryptionType;

    use super::*;

    const ATTRIBUTE: &str = "coasys-identity";

    // ── A call answered within a bound ──
    //
    // Unlocking a locked keyring asks the person, through a prompt the Secret Service draws, and
    // the client waits for the answer with no limit: a prompt nobody answers (a desktop left, a
    // session with no prompter that can draw) held the store, and custody behind it, for good.
    // So a call waits a bound, and past it answers that the keyring is locked; the prompt stays
    // up for the person to answer, and "try again" then finds the keyring open.
    //
    // The job cannot be stopped where it waits, so a job its caller stopped waiting for must
    // change nothing when it does go on. Each job carries a [`Claim`]: its effect happens only
    // after it commits, and a caller that gives up first abandons it. Exactly one of the two wins.

    /// Not yet run, or running up to the point where it would change something.
    const PENDING: u8 = 0;
    /// Waiting on the person to unlock the keyring.
    const UNLOCKING: u8 = 1;
    /// Past the point of no return: its caller waits for its answer.
    const COMMITTED: u8 = 2;
    /// Its caller stopped waiting: it changes nothing.
    const ABANDONED: u8 = 3;

    /// One job's side of the bound: whether it may still act for its caller.
    pub(super) struct Claim {
        state: Arc<AtomicU8>,
        unlocking: Arc<AtomicBool>,
    }

    impl Claim {
        /// Whether the caller has stopped waiting: the job changes nothing and answers nothing.
        pub(super) fn abandoned(&self) -> bool {
            self.state.load(Ordering::SeqCst) == ABANDONED
        }

        /// Runs `unlock`, a call that may wait on the person, marked as waiting on the keyring so a
        /// caller that gives up meanwhile says the keyring is locked. A prompt the person dismissed
        /// is a keyring that stays locked.
        pub(super) fn unlocking(
            &self,
            unlock: impl FnOnce() -> Result<(), secret_service::Error>,
        ) -> Result<(), VaultError> {
            if self
                .state
                .compare_exchange(PENDING, UNLOCKING, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return Err(keyring_locked());
            }
            self.unlocking.store(true, Ordering::SeqCst);
            let unlocked = unlock();
            self.unlocking.store(false, Ordering::SeqCst);
            // Back to pending, unless the caller gave up meanwhile.
            let _ =
                self.state
                    .compare_exchange(UNLOCKING, PENDING, Ordering::SeqCst, Ordering::SeqCst);
            match unlocked {
                Ok(()) => Ok(()),
                Err(secret_service::Error::Prompt) | Err(secret_service::Error::Locked) => {
                    Err(keyring_locked())
                }
                Err(e) => Err(unavailable(e)),
            }
        }

        /// Takes the job's effect for its caller, just before it changes anything. False once the
        /// caller stopped waiting: the job must then change nothing.
        pub(super) fn commit(&self) -> bool {
            self.state
                .compare_exchange(PENDING, COMMITTED, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        }
    }

    type Job<S> = Box<dyn FnOnce(&S) + Send>;

    /// A thread that owns a client of type `S` and runs jobs on it, each answered within `wait`.
    pub(super) struct Bounded<S> {
        jobs: mpsc::Sender<Job<S>>,
        wait: Duration,
        /// Set while a job waits on the person to unlock the keyring: a job queued behind it waits
        /// on the same thing.
        unlocking: Arc<AtomicBool>,
    }

    impl<S> Bounded<S> {
        pub(super) fn new(jobs: mpsc::Sender<Job<S>>, wait: Duration) -> Self {
            Bounded {
                jobs,
                wait,
                unlocking: Arc::new(AtomicBool::new(false)),
            }
        }

        /// Runs `job` on the client's thread and waits up to the bound for its answer. Past it, a
        /// job that has not committed is abandoned and the answer is that the keyring is locked
        /// (when it, or the job ahead of it, waits on an unlock) or that the Secret Service did
        /// not answer; a job that has committed is waited for, as its effect is already happening.
        pub(super) fn run<T: Send + 'static>(
            &self,
            job: impl FnOnce(&S, &Claim) -> Result<T, VaultError> + Send + 'static,
        ) -> Result<T, VaultError> {
            let state = Arc::new(AtomicU8::new(PENDING));
            let claim = Claim {
                state: state.clone(),
                unlocking: self.unlocking.clone(),
            };
            let (answer, answered) = mpsc::channel();
            self.jobs
                .send(Box::new(move |client: &S| {
                    if claim.abandoned() {
                        return;
                    }
                    let _ = answer.send(job(client, &claim));
                }))
                .map_err(|_| ended())?;
            match answered.recv_timeout(self.wait) {
                Ok(result) => result,
                Err(mpsc::RecvTimeoutError::Disconnected) => Err(ended()),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let locked = self.unlocking.load(Ordering::SeqCst);
                    for from in [PENDING, UNLOCKING] {
                        if state
                            .compare_exchange(from, ABANDONED, Ordering::SeqCst, Ordering::SeqCst)
                            .is_ok()
                        {
                            return Err(if locked || from == UNLOCKING {
                                keyring_locked()
                            } else {
                                VaultError::Unavailable(format!(
                                    "Secret Service: no answer in {} s",
                                    self.wait.as_secs()
                                ))
                            });
                        }
                    }
                    // Committed: its effect is under way, and its answer is the one to give.
                    answered.recv().map_err(|_| ended())?
                }
            }
        }
    }

    /// The default collection of the session's Secret Service (GNOME Keyring, KWallet), attribute
    /// `coasys-identity = <name>`.
    ///
    /// The client is blocking, and runs on a thread of its own that holds it from connect to drop.
    /// Its blocking calls start an async runtime of their own, which panics on a thread that already
    /// runs one: the custody service's thread does, so the client is never called, or dropped,
    /// there. `tests/secret_service.rs` checks this against a real Secret Service.
    pub struct SecretServiceStore {
        jobs: Bounded<SecretService<'static>>,
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
        /// How long a call waits on the Secret Service, unlocking the keyring included, before it
        /// answers that the keyring is locked: long enough to type a keyring's password into its
        /// prompt.
        pub const UNLOCK_WAIT: Duration = Duration::from_secs(90);

        /// Connects, or answers why not — the caller falls back to [`FileStore`].
        pub fn connect() -> Result<Self, VaultError> {
            Self::connect_waiting(Self::UNLOCK_WAIT)
        }

        /// [`Self::connect`], with each call waiting at most `wait` ([`Self::UNLOCK_WAIT`]).
        pub fn connect_waiting(wait: Duration) -> Result<Self, VaultError> {
            let (jobs, inbox) = mpsc::channel::<Job<SecretService<'static>>>();
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
            Ok(SecretServiceStore {
                jobs: Bounded::new(jobs, wait),
            })
        }

        /// Runs `job` on the client's thread, answered within the bound ([`Bounded::run`]).
        fn run<T: Send + 'static>(
            &self,
            job: impl FnOnce(&SecretService<'static>, &Claim) -> Result<T, VaultError> + Send + 'static,
        ) -> Result<T, VaultError> {
            self.jobs.run(job)
        }
    }

    /// The default collection, unlocked: asks the person when it is locked.
    fn unlocked<'a>(
        service: &'a SecretService<'static>,
        claim: &Claim,
    ) -> Result<Collection<'a>, VaultError> {
        let collection = service.get_default_collection().map_err(unavailable)?;
        if collection.is_locked().map_err(unavailable)? {
            claim.unlocking(|| collection.unlock())?;
        }
        Ok(collection)
    }

    /// `item`, unlocked: asks the person when it is locked.
    fn unlocked_item(item: &Item<'_>, claim: &Claim) -> Result<(), VaultError> {
        if item.is_locked().map_err(unavailable)? {
            claim.unlocking(|| item.unlock())?;
        }
        Ok(())
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
            self.run(move |service, claim| {
                let collection = unlocked(service, claim)?;
                if !claim.commit() {
                    return Err(keyring_locked());
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
            self.run(move |service, claim| {
                let found = service
                    .search_items(HashMap::from([(ATTRIBUTE, name.as_str())]))
                    .map_err(unavailable)?;
                let item = match (
                    found.unlocked.into_iter().next(),
                    found.locked.into_iter().next(),
                ) {
                    (Some(item), _) => item,
                    (None, Some(item)) => {
                        unlocked_item(&item, claim)?;
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
            self.run(move |service, _| {
                let found = service
                    .search_items(HashMap::from([(ATTRIBUTE, name.as_str())]))
                    .map_err(unavailable)?;
                Ok(!found.unlocked.is_empty() || !found.locked.is_empty())
            })
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            let name = name.to_string();
            self.run(move |service, claim| {
                let found = service
                    .search_items(HashMap::from([(ATTRIBUTE, name.as_str())]))
                    .map_err(unavailable)?;
                // Deleting asks nobody: a locked item's delete answers that it is locked.
                if !claim.commit() {
                    return Err(keyring_locked());
                }
                for item in found.unlocked.into_iter().chain(found.locked) {
                    item.delete().map_err(|e| match e {
                        secret_service::Error::Locked => keyring_locked(),
                        e => unavailable(e),
                    })?;
                }
                Ok(())
            })
        }
    }

    /// The bound, over a client that is nothing and jobs that wait where they are told to: a job
    /// stands in for the client's unlock, which waits on a person.
    #[cfg(test)]
    mod tests {
        use std::sync::Mutex;
        use std::time::Instant;

        use super::*;

        const WAIT: Duration = Duration::from_millis(200);

        /// A client thread of its own, as the store's.
        fn bounded() -> Bounded<()> {
            let (jobs, inbox) = mpsc::channel::<Job<()>>();
            std::thread::spawn(move || {
                for job in inbox {
                    job(&());
                }
            });
            Bounded::new(jobs, WAIT)
        }

        /// A prompt nobody has answered yet: `answer` answers it.
        fn prompt() -> (mpsc::Sender<bool>, Arc<Mutex<mpsc::Receiver<bool>>>) {
            let (answer, asked) = mpsc::channel();
            (answer, Arc::new(Mutex::new(asked)))
        }

        fn answered(asked: &Arc<Mutex<mpsc::Receiver<bool>>>) -> Result<(), secret_service::Error> {
            match asked.lock().unwrap().recv() {
                Ok(true) => Ok(()),
                _ => Err(secret_service::Error::Prompt),
            }
        }

        #[test]
        fn a_prompt_nobody_answers_is_a_locked_keyring_within_the_bound_and_writes_nothing() {
            let store = bounded();
            let (answer, asked) = prompt();
            let wrote = Arc::new(AtomicBool::new(false));
            let started = Instant::now();
            let result = store.run({
                let (asked, wrote) = (asked.clone(), wrote.clone());
                move |_, claim| {
                    claim.unlocking(|| answered(&asked))?;
                    if !claim.commit() {
                        return Err(keyring_locked());
                    }
                    wrote.store(true, Ordering::SeqCst);
                    Ok(())
                }
            });
            assert!(is_keyring_locked(&result.unwrap_err()));
            assert!(started.elapsed() < WAIT * 5, "{:?}", started.elapsed());

            // The person unlocks afterwards: the job goes on, and writes nothing for a caller gone.
            answer.send(true).unwrap();
            // The next job runs after it on the same thread, so its answer means the first is done.
            store.run(|_, _| Ok(())).unwrap();
            assert!(!wrote.load(Ordering::SeqCst));
        }

        #[test]
        fn a_job_queued_behind_an_unanswered_prompt_is_a_locked_keyring_and_never_runs() {
            let store = bounded();
            let (answer, asked) = prompt();
            let first = std::thread::spawn({
                let store_jobs = store.jobs.clone();
                let unlocking = store.unlocking.clone();
                move || {
                    let store = Bounded {
                        jobs: store_jobs,
                        wait: WAIT,
                        unlocking,
                    };
                    store.run(move |_, claim| claim.unlocking(|| answered(&asked)))
                }
            });
            // Wait until the first job is at its prompt.
            while !store.unlocking.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
            let ran = Arc::new(AtomicBool::new(false));
            let second = store.run({
                let ran = ran.clone();
                move |_, _| {
                    ran.store(true, Ordering::SeqCst);
                    Ok(())
                }
            });
            assert!(is_keyring_locked(&second.unwrap_err()));
            assert!(is_keyring_locked(&first.join().unwrap().unwrap_err()));
            answer.send(true).unwrap();
            store.run(|_, _| Ok(())).unwrap();
            assert!(
                !ran.load(Ordering::SeqCst),
                "a job its caller gave up on ran"
            );
        }

        #[test]
        fn a_dismissed_prompt_is_a_locked_keyring_at_once() {
            let store = bounded();
            let started = Instant::now();
            let result = store.run(|_, claim| {
                claim.unlocking(|| Err(secret_service::Error::Prompt))?;
                Ok(())
            });
            assert!(is_keyring_locked(&result.unwrap_err()));
            assert!(started.elapsed() < WAIT);
        }

        #[test]
        fn a_job_that_committed_is_waited_for_past_the_bound() {
            let store = bounded();
            let result = store.run(|_, claim| {
                assert!(claim.commit());
                std::thread::sleep(WAIT * 2);
                Ok(7)
            });
            assert_eq!(result.unwrap(), 7);
        }

        #[test]
        fn a_slow_answer_with_no_prompt_is_no_answer_rather_than_a_locked_keyring() {
            let store = bounded();
            let result = store.run(|_, _| {
                std::thread::sleep(WAIT * 2);
                Ok(())
            });
            let error = result.unwrap_err();
            assert!(!is_keyring_locked(&error), "{error:?}");
            assert!(matches!(&error, VaultError::Unavailable(why) if why.contains("no answer")));
        }

        #[test]
        fn an_answer_in_time_is_the_answer() {
            let store = bounded();
            assert_eq!(store.run(|_, _| Ok("kept")).unwrap(), "kept");
            assert!(store
                .run(|_, _| -> Result<(), VaultError> { Err(VaultError::NotFound) })
                .is_err_and(|e| matches!(e, VaultError::NotFound)));
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
        kSecAttrAccount, kSecAttrComment, kSecAttrService, kSecClass, kSecClassGenericPassword,
        kSecMatchLimit, kSecReturnAttributes, kSecUseAuthenticationUI,
        kSecUseDataProtectionKeychain,
    };
    use security_framework_sys::keychain_item::{SecItemCopyMatching, SecItemUpdate};

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

        /// The tag as the item's comment (`kSecAttrComment`, [`tag_comment`]), added in the same
        /// `SecItemAdd` as the bytes: an attribute, so it is read with no prompt ([`tag_of`]),
        /// and only this app's access group can write it.
        fn put_tagged(&self, name: &str, bytes: &[u8], tag: &ItemTag) -> Result<(), VaultError> {
            self.delete(name)?;
            let mut options = item(name);
            options.set_access_control_options(AccessControlOptions::USER_PRESENCE);
            options.set_comment(&tag_comment(tag));
            set_generic_password_options(bytes, options).map_err(unavailable)
        }

        fn tag_of(&self, name: &str) -> Result<Option<ItemTag>, VaultError> {
            let (status, comment) = probe(name);
            match status {
                0 => Ok(comment.as_deref().and_then(comment_tag)),
                // Kept, but even its attributes need the person: it cannot tell.
                ERR_SEC_INTERACTION_NOT_ALLOWED | ERR_SEC_ITEM_NOT_FOUND => Ok(None),
                code => Err(unavailable(Error::from_code(code))),
            }
        }

        /// The staged item's account becomes the kept one's (`SecItemUpdate` of an attribute),
        /// so the key is never read out of the keychain and the move asks for no presence.
        fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
            if !self.contains(from)? {
                return Err(VaultError::NotFound);
            }
            self.delete(to)?;
            let query: Vec<(CFString, CFType)> = unsafe {
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
                        CFString::new(from).into_CFType(),
                    ),
                    (
                        CFString::wrap_under_get_rule(kSecUseDataProtectionKeychain),
                        CFBoolean::true_value().into_CFType(),
                    ),
                ]
            };
            let change: Vec<(CFString, CFType)> = unsafe {
                vec![(
                    CFString::wrap_under_get_rule(kSecAttrAccount),
                    CFString::new(to).into_CFType(),
                )]
            };
            let query = CFDictionary::from_CFType_pairs(&query);
            let change = CFDictionary::from_CFType_pairs(&change);
            match unsafe {
                SecItemUpdate(query.as_concrete_TypeRef(), change.as_concrete_TypeRef())
            } {
                0 => Ok(()),
                ERR_SEC_ITEM_NOT_FOUND => Err(VaultError::NotFound),
                code => Err(unavailable(Error::from_code(code))),
            }
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
        probe(name).0
    }

    /// [`probe_status`], and the item's comment when the keychain answered its attributes.
    fn probe(name: &str) -> (i32, Option<String>) {
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
        let mut comment = None;
        if !found.is_null() {
            // A +1 reference to the attributes dictionary; dropping the wrapper releases it.
            let attributes = unsafe { CFType::wrap_under_create_rule(found) };
            if let Some(dict) = attributes.downcast::<CFDictionary>() {
                let key = unsafe { CFString::wrap_under_get_rule(kSecAttrComment) };
                if let Some(value) = dict.find(key.as_CFTypeRef().cast()) {
                    let value = unsafe { CFType::wrap_under_get_rule(*value) };
                    comment = value.downcast::<CFString>().map(|s| s.to_string());
                }
            }
        }
        (status, comment)
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

    /// The side that holds `name`, or the one it goes to when it is new. A new staged key goes to
    /// the side of the kept item it stands beside, so it is sealed (or not) as that item is, and
    /// its promote is a move within one store: a key staged on the keychain, unsealed, never lands
    /// in a file.
    fn side(&self, name: &str) -> Result<&dyn SecretStore, VaultError> {
        if let Some(held) = self.holder(name)? {
            return Ok(held);
        }
        if let Some(kept) = kept_beside(name) {
            if let Some(held) = self.holder(&kept)? {
                return Ok(held);
            }
        }
        Ok(self.for_new())
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

    fn put_tagged(&self, name: &str, bytes: &[u8], tag: &ItemTag) -> Result<(), VaultError> {
        self.side(name)?.put_tagged(name, bytes, tag)
    }

    fn tag_of(&self, name: &str) -> Result<Option<ItemTag>, VaultError> {
        match self.holder(name)? {
            Some(side) => side.tag_of(name),
            None => Ok(None),
        }
    }

    /// Within the side that holds `from` when `to` is absent or on that side too; across sides
    /// only by copy (both sides hold the same bytes for a sealed item).
    fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
        let from_side = self.holder(from)?.ok_or(VaultError::NotFound)?;
        let to_side = self.side(to)?;
        if std::ptr::addr_eq(from_side, to_side) {
            return from_side.rename(from, to);
        }
        if from_side.kind().unlocks_itself() != to_side.kind().unlocks_itself() {
            return Err(VaultError::Unavailable(
                "a staged master key and the kept one are in stores that keep them differently"
                    .into(),
            ));
        }
        let bytes = zeroize::Zeroizing::new(from_side.get(from)?.ok_or(VaultError::NotFound)?);
        match from_side.tag_of(from)? {
            Some(tag) => to_side.put_tagged(to, &bytes, &tag)?,
            None => to_side.put(to, &bytes)?,
        }
        from_side.delete(from)
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
        self.markers.join(format!("{}.platform", stem(name)))
    }

    fn mark(&self, name: &str) -> Result<(), VaultError> {
        std::fs::create_dir_all(&self.markers).map_err(io)?;
        std::fs::write(self.marker(name), b"").map_err(io)
    }

    fn unmark(&self, name: &str) -> Result<(), VaultError> {
        match std::fs::remove_file(self.marker(name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(e)),
            _ => Ok(()),
        }
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
        self.mark(name)
    }

    fn put_tagged(&self, name: &str, bytes: &[u8], tag: &ItemTag) -> Result<(), VaultError> {
        let connected = self.reach()?;
        self.on(&connected, |store| store.put_tagged(name, bytes, tag))?;
        self.mark(name)
    }

    fn tag_of(&self, name: &str) -> Result<Option<ItemTag>, VaultError> {
        match self.reach() {
            Ok(connected) => self.on(&connected, |store| store.tag_of(name)),
            Err(why) => self.unreached(name, why, None),
        }
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
        let connected = self.reach()?;
        // Marked before the move, so a crash leaves a marker beside whichever name holds it.
        self.mark(to)?;
        self.on(&connected, |store| store.rename(from, to))?;
        self.unmark(from)
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
        self.unmark(name)
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

    /// An item kept as it is (`put_tagged`, for a store that unlocks itself) is the raw master
    /// key: a store that keeps only sealed items refuses it rather than writing it down, whoever
    /// asks — the file, a memory store standing in for one, and a placed store whose new items
    /// go to the file.
    #[test]
    fn a_store_of_sealed_items_refuses_an_item_kept_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        let name = item_name("QmScid");
        let tag = ItemTag {
            index: 0,
            owner: None,
        };
        let raw = [9u8; 32];
        let file = FileStore::new(&custody);
        assert!(matches!(
            file.put_tagged(&name, &raw, &tag),
            Err(VaultError::Unavailable(_))
        ));
        assert!(!custody.join("QmScid.bin").exists());
        let placed = PlacedStore::new(Box::new(FileStore::new(&custody)), None);
        assert!(placed.put_tagged(&name, &raw, &tag).is_err());
        assert!(!custody.join("QmScid.bin").exists());
        for kind in [StoreKind::File, StoreKind::SecretService, StoreKind::Memory] {
            let memory = MemoryStore::as_kind(kind);
            assert!(memory.put_tagged(&name, &raw, &tag).is_err(), "{kind:?}");
            assert!(memory.all_bytes().is_empty());
        }
        // The keychain keeps it, with its tag.
        let keychain = MemoryStore::as_kind(StoreKind::Keychain);
        keychain.put_tagged(&name, &raw, &tag).unwrap();
        assert_eq!(keychain.tag_of(&name).unwrap(), Some(tag));
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

    /// The keychain keeps an item's tag in its comment: the index alone for a kept key, and the
    /// staging flow's token after it for a staged one. A comment written before tokens were
    /// kept reads as a tag with no owner; an owner that does not read as a token is none.
    #[test]
    fn the_keychain_comment_carries_the_index_and_the_owner() {
        let kept = ItemTag {
            index: 3,
            owner: None,
        };
        assert_eq!(tag_comment(&kept), "coasys-master-index:3");
        assert_eq!(comment_tag(&tag_comment(&kept)), Some(kept));
        let mut token = [0u8; 16];
        token[0] = 0xab;
        token[15] = 0x01;
        let staged = ItemTag {
            index: 4,
            owner: Some(StageToken(token)),
        };
        assert_eq!(
            tag_comment(&staged),
            "coasys-master-index:4;owner:ab000000000000000000000000000001"
        );
        assert_eq!(comment_tag(&tag_comment(&staged)), Some(staged));
        assert_eq!(
            comment_tag("coasys-master-index:4;owner:not-a-token"),
            Some(ItemTag {
                index: 4,
                owner: None
            })
        );
        assert_eq!(comment_tag("coasys-master-index:x;owner:"), None);
        assert_eq!(comment_tag("another app's comment"), None);
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
