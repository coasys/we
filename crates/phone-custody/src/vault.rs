//! `PhoneVault`: the phone's custody of a master key, `ad4m-identity-client`'s `Vault` over a file
//! beside the key file and a second platform key, [`MasterSealer`].
//!
//! On Android the master sealer is a Keystore AES-256-GCM key, `org.coasys.app.master-seeds.v1`,
//! that needs the person's biometric for every use (`setUserAuthenticationRequired(true)`, a
//! timeout of 0, `setInvalidatedByBiometricEnrollment(true)`), used through `BiometricPrompt` with
//! a `CryptoObject`: each seal and each open is one prompt, which the app shows with the `prompt`
//! sentence this crate passes. The device key's [`Sealer`] stays as phase 2a left it, with no user
//! auth, so a key login never prompts.
//!
//! `master-keys.json` holds, per identity, the master key's index, its public key, the seed
//! sealed by the master sealer under the label `coasys:phone-master:1:<scid>:<index>` (associated
//! data, so a sealed seed moved to another identity or index does not open), and a **tag**: the
//! entry's fields sealed by the device [`Sealer`]. [`Vault::master_index`] must name the key
//! without a prompt and without trusting a cache: it opens the tag (the device sealer needs no
//! biometric) and answers the index only when the tag covers the entry exactly as the file has
//! it. An open of the seed checks the key it opens to against the public key the tag covers.
//!
//! Every write is whole or not at all, as the key file's: the vault's order (store the key, then
//! acknowledge the inbox message, then write the record) leaves a crash between two steps to be
//! retried from the inbox.
//!
//! **One lock, one file, every handle.** The phone runs parallel native calls, each with its own
//! `PhoneVault` on the same folder, and the `Vault` contract wants every operation linearizable
//! across every handle and process. So no operation decides on a snapshot the handle read
//! earlier: each takes the folder's lock (`master-keys.lock`, `flock(2)`, exclusive — std's
//! `File::lock` has no Android implementation in the pinned toolchain),
//! **reads the file again**, decides and writes under it, and releases. The biometric seal and
//! open stay outside the lock — the prompt must not hold every other call off — and what they
//! decide on (the kept key's generation) is checked again inside. Everything decided on is in
//! the same file: the kept and staged keys, each identity's **custody epoch** and each record's
//! **high-water mark**, so a change of a kept key and the move of its epoch are one atomic
//! write, never two. Each device's **custody note** per identity is there too, as the client's
//! serde JSON, never read here: a swap compares the whole note (every layer of its stack) with
//! the one expected and writes the file only when they match; the note of the vault itself
//! (`VAULT_NOTE`, key id `"vault"`) is kept the same way, since key ids are never read here. And
//! this vault's **id** per identity ([`Vault::vault_id`]): 16 random bytes drawn at the first ask
//! and written in the same step, so every handle answers one id, kept beside the master keys and
//! never dropped. The rules are WE's desktop vault's (`crates/custody/src/vault.rs`): the
//! kept key never goes back a generation (a store or promote under a higher kept index answers
//! `AlreadyNewer`), a forget is a compare-and-delete (on the index, or on the epoch), and the
//! epoch moves on every successful store, promote and forget, a same-index re-store included,
//! never otherwise. An epoch is a counter, never a digest: the file's **incarnation** (drawn at
//! random when the file is first made) in the high 32 bits and the identity's count of changes
//! in the low, so a file made again does not answer an epoch a removal read before the loss,
//! except by a 1 in 2³² draw.
//!
//! **A loss is not a fresh start.** The file holds what a missing file or entry would undo — a
//! forget at an epoch counted again from nothing, a rolled-back record taken as the first. So
//! the folder notes, in `custody-metadata.json`, that the file was written and which identities
//! it holds an epoch or a mark for. A written file that is gone, or a noted identity's entry
//! missing while the file stays, is an error on every operation, never an empty start: the way
//! back is explicit — [`PhoneVault::recover_custody_epoch`] for an epoch (a fresh incarnation,
//! so no epoch read before the loss repeats) and [`Vault::record_seen_reset`] for a mark. The
//! note is written after the file that earns it (a crash between the two leaves an entry that
//! is there and not yet noted, which reads as it is and is noted under the lock by the next
//! operation that relies on it), and a noted identity is never dropped: a forgotten key's
//! epoch stays, a reset mark stays as a reset.
//!
//! The file is in `no_backup/device-keys/`, as the key file is.
//!
//! **Protection.** The master sealer reports what the Keystore gave its key (`strongbox`, `tee`,
//! `software`, `unknown`). A master key is kept only at `strongbox` or `tee`, unless the person has
//! agreed to keep it at the level the phone has ([`PhoneVault::allow_weak_protection`]): an
//! emulator's Keystore is software, which anything that can read the app's files can open.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use ad4m_identity_client::vault::KeySigner;
use ad4m_identity_client::{
    CustodyNote, Forgot, MasterUse, PendingPush, Secret, StageToken, Stored, Unlocked, Vault,
    VaultError, VaultId,
};
use ad4m_identity_core::build::Signer;
use ad4m_identity_core::Event;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{Sealer, WipeOnDrop};

pub const MASTER_FILE_NAME: &str = "master-keys.json";
/// The lock every handle and process takes around each read-decide-write of the file.
pub const LOCK_FILE_NAME: &str = "master-keys.lock";
/// Beside the file, what it has held: that it was written, and which identities it holds an
/// epoch or a record mark for — so a missing one reads as a loss, not a fresh start.
pub const MARKER_FILE_NAME: &str = "custody-metadata.json";
/// The label an entry's tag is sealed under by the device sealer.
pub const TAG_LABEL: &str = "coasys:phone-master-tag:1";
/// What a `VaultError::Unavailable` starts with when the master sealer's protection is below
/// what a master key is kept at, and the person has not agreed.
pub const WEAK_PROTECTION: &str = "weak-protection: ";
/// What a `VaultError::Unavailable` starts with when the master sealer's key is gone: a new
/// biometric was enrolled, which invalidates it, and the key kept under it can no longer open.
pub const INVALIDATED: &str = "invalidated: ";

/// The label a master seed is sealed under.
pub fn master_label(scid: &str, index: u32) -> String {
    format!("coasys:phone-master:1:{scid}:{index}")
}

/// What seals and opens a master seed: a platform key that needs the person's biometric for each
/// use. The app implements it (Kotlin, over the Android Keystore and `BiometricPrompt`); the tests
/// implement it in Rust. `prompt` is the sentence the biometric prompt shows.
#[uniffi::export(with_foreign)]
pub trait MasterSealer: Send + Sync {
    /// What the platform gave the sealing key: `strongbox`, `tee`, `software` or `unknown`. Makes
    /// the key when there is none yet.
    fn protection(&self) -> String;
    /// The sealed form of `plaintext`, bound to `label`, after the person's biometric.
    fn seal(
        &self,
        label: String,
        plaintext: Vec<u8>,
        prompt: String,
    ) -> Result<Vec<u8>, MasterSealError>;
    /// The plaintext of `sealed`, sealed under `label`, after the person's biometric.
    fn open(
        &self,
        label: String,
        sealed: Vec<u8>,
        prompt: String,
    ) -> Result<Vec<u8>, MasterSealError>;
    /// Zero every plaintext `open` has returned.
    fn wipe(&self);
}

/// Why the master sealer did not seal or open.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MasterSealError {
    /// The person closed the biometric prompt.
    #[error("the biometric prompt was cancelled")]
    Cancelled,
    /// The phone has no biometric enrolled (or no secure screen lock), so the key cannot be used.
    #[error("this phone has no fingerprint or face unlock set up")]
    NoBiometrics,
    /// The sealing key is gone: a biometric enrolled since it was made invalidated it.
    #[error("the key that sealed the master key was invalidated by a new fingerprint or face")]
    Invalidated,
    #[error("{reason}")]
    Failed { reason: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for MasterSealError {
    fn from(e: uniffi::UnexpectedUniFFICallbackError) -> Self {
        MasterSealError::Failed { reason: e.reason }
    }
}

impl From<MasterSealError> for VaultError {
    fn from(e: MasterSealError) -> Self {
        match e {
            MasterSealError::Cancelled => VaultError::Cancelled,
            MasterSealError::NoBiometrics => VaultError::NoScreenLock,
            MasterSealError::Invalidated => VaultError::Unavailable(format!("{INVALIDATED}{e}")),
            MasterSealError::Failed { reason } => VaultError::Unavailable(reason),
        }
    }
}

/// The sentence the biometric prompt shows for each use.
fn prompt_for(why: MasterUse) -> &'static str {
    match why {
        MasterUse::Link => "Confirm it's you to link a device",
        MasterUse::Revoke => "Confirm it's you to remove a device",
        MasterUse::SendMaster => "Confirm it's you to send the master key",
        // The master key signs the private record itself: re-attesting the recovery key after a
        // rotation, which a device's own write of the record waits for.
        MasterUse::Record => "Confirm it's you to update your devices",
    }
}

const PROMPT_KEEP: &str = "Confirm it's you to keep the master key on this phone";
const PROMPT_STAGE: &str = "Confirm it's you to keep the new master key on this phone";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Kind {
    Kept,
    Staged,
}

/// One master key in the file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Item {
    scid: String,
    index: u32,
    /// The master key's public half, `z6Mk…`.
    key: String,
    /// The master sealer's output, base64.
    sealed: String,
    /// The device sealer's output over [`Item::tag_body`], base64.
    tag: String,
    /// A staged key's [`StageToken`], hex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
}

impl Item {
    /// What the tag covers: every field of the entry and whether it is kept or staged.
    fn tag_body(
        kind: Kind,
        scid: &str,
        index: u32,
        key: &str,
        sealed: &str,
        owner: Option<&str>,
    ) -> Vec<u8> {
        let kind = match kind {
            Kind::Kept => "kept",
            Kind::Staged => "staged",
        };
        format!(
            "coasys:phone-master-tag:1\n{kind}\n{scid}\n{index}\n{key}\n{}\n{sealed}",
            owner.unwrap_or("")
        )
        .into_bytes()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MasterFile {
    v: u8,
    #[serde(default)]
    kept: Vec<Item>,
    #[serde(default)]
    staged: Vec<Item>,
    /// Co-signed incepts not yet confirmed published (public keys and proofs only).
    #[serde(default)]
    incepts: Vec<serde_json::Value>,
    #[serde(default)]
    pushes: Vec<PendingPush>,
    /// Drawn at random when the file is first made; the high half of every custody epoch. A
    /// file without one is damaged, not a format to open: this schema was never written
    /// without it.
    incarnation: u32,
    /// Each identity's count of changes of its kept key; a missing field is damaged, a noted
    /// identity's missing entry a loss.
    epochs: Vec<EpochEntry>,
    /// Each identity's record high-water mark.
    seen: Vec<Seen>,
    /// Each device's custody note per identity ([`Vault::custody_note`]), kept as the
    /// client's serde JSON: swapped whole under the lock, never read here. Absent in a file
    /// written before notes were kept, which had none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    notes: Vec<Note>,
    /// This vault's id per identity ([`Vault::vault_id`]): drawn at the first ask, kept here
    /// beside the master keys, never dropped. Absent in a file written before ids were kept,
    /// which had none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    ids: Vec<IdEntry>,
}

/// This vault's id for one identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdEntry {
    scid: String,
    id: VaultId,
}

/// How many times an identity's kept key changed in this file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EpochEntry {
    scid: String,
    count: u32,
}

/// The highest version of an identity's record read; `None` after a reset, which is kept —
/// the reset itself — rather than the entry dropped, so a reset is never confused with a mark
/// that was lost.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Seen {
    scid: String,
    version: Option<u64>,
}

/// One device's custody note for one identity, as the client's [`CustodyNote`] serialised it.
/// A note cleared is dropped: unlike a mark, its absence is a state the client writes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Note {
    scid: String,
    key_id: String,
    note: serde_json::Value,
}

/// What the folder noted the file has held (`custody-metadata.json`): that the file was
/// written, and the identities an epoch, a record mark or a vault id was written for. Written after the
/// file that earns the note; a noted identity is never dropped from it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Marker {
    v: u8,
    /// `master-keys.json` was written in this folder: gone, it is a loss, not a fresh start.
    #[serde(default)]
    written: bool,
    /// The identities an epoch entry was written for.
    #[serde(default)]
    epochs: Vec<String>,
    /// The identities a record mark was written for.
    #[serde(default)]
    seen: Vec<String>,
    /// The identities a vault id was written for.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    ids: Vec<String>,
}

impl Marker {
    fn fresh() -> Marker {
        Marker {
            v: 1,
            ..Marker::default()
        }
    }
}

/// `marker` made to cover `file`: `written` (when the file is there) and every identity an
/// epoch or a mark is kept for. Only ever adds — a noted identity is never dropped here, and
/// a noted-but-missing entry stays for its recovery to find. Answers whether it changed.
fn noted(marker: &mut Marker, file: &MasterFile, written: bool) -> bool {
    let mut changed = written && !marker.written;
    if written {
        marker.written = true;
    }
    for entry in &file.epochs {
        if !marker.epochs.contains(&entry.scid) {
            marker.epochs.push(entry.scid.clone());
            changed = true;
        }
    }
    for entry in &file.seen {
        if !marker.seen.contains(&entry.scid) {
            marker.seen.push(entry.scid.clone());
            changed = true;
        }
    }
    for entry in &file.ids {
        if !marker.ids.contains(&entry.scid) {
            marker.ids.push(entry.scid.clone());
            changed = true;
        }
    }
    changed
}

/// What a lost `master-keys.json` says.
const LOST_FILE: &str = "was written in this folder and is gone; it is not started again empty";

fn lost_epoch(scid: &str) -> VaultError {
    VaultError::Unavailable(format!(
        "{scid}'s custody epoch was written in this folder and is gone; \
         it is not counted again from nothing"
    ))
}

fn lost_mark(scid: &str) -> VaultError {
    VaultError::Unavailable(format!(
        "{scid}'s record mark was written in this folder and is gone; \
         only a reset starts it again"
    ))
}

fn lost_id(scid: &str) -> VaultError {
    VaultError::Unavailable(format!(
        "{scid}'s vault id was written in this folder and is gone; it is not drawn again"
    ))
}

/// 16 bytes from the OS's secure random source: a [`VaultId`].
fn draw_vault_id() -> VaultId {
    use rand_core::RngCore;
    let mut bytes = [0u8; 16];
    rand_core::OsRng.fill_bytes(&mut bytes);
    VaultId(bytes)
}

fn lost_file() -> VaultError {
    VaultError::Unavailable(format!("{MASTER_FILE_NAME} {LOST_FILE}"))
}

fn unavailable(why: impl std::fmt::Display) -> VaultError {
    VaultError::Unavailable(why.to_string())
}

impl MasterFile {
    /// The file's first state: a fresh incarnation, so nothing it answers later repeats what
    /// a file this folder had before answered.
    fn fresh() -> MasterFile {
        MasterFile {
            v: 1,
            incarnation: draw_incarnation(),
            ..MasterFile::default()
        }
    }

    fn kept(&self, scid: &str) -> Option<&Item> {
        self.kept.iter().find(|k| k.scid == scid)
    }

    /// `scid`'s epoch: the entry's count under the file's incarnation, or the incarnation
    /// alone where no entry was ever made. An entry the folder noted and that is missing was
    /// lost: an error, never counted again from nothing.
    fn epoch(&self, scid: &str, noted: &[String]) -> Result<u64, VaultError> {
        match self.epochs.iter().find(|e| e.scid == scid) {
            Some(entry) => Ok((u64::from(self.incarnation) << 32) | u64::from(entry.count)),
            None if noted.iter().any(|s| s == scid) => Err(lost_epoch(scid)),
            None => Ok(u64::from(self.incarnation) << 32),
        }
    }

    /// `scid`'s record mark as the file keeps it (`None` when none was ever read, or after a
    /// reset); a noted mark that is missing was lost: an error, never a first read again.
    fn seen_mark(&self, scid: &str, noted: &[String]) -> Result<Option<u64>, VaultError> {
        match self.seen.iter().find(|s| s.scid == scid) {
            Some(seen) => Ok(seen.version),
            None if noted.iter().any(|s| s == scid) => Err(lost_mark(scid)),
            None => Ok(None),
        }
    }

    /// Moves `scid`'s epoch, in this copy of the file: saved with the change it counts. A noted
    /// identity without an entry is a loss ([`MasterFile::epoch`]), not made again quietly.
    fn bump_epoch(&mut self, scid: &str, noted: &[String]) -> Result<(), VaultError> {
        let entry = match self.epochs.iter_mut().find(|e| e.scid == scid) {
            Some(entry) => entry,
            None => {
                if noted.iter().any(|s| s == scid) {
                    return Err(lost_epoch(scid));
                }
                self.epochs.push(EpochEntry {
                    scid: scid.to_string(),
                    count: 0,
                });
                self.epochs.last_mut().expect("just pushed")
            }
        };
        entry.count = entry.count.checked_add(1).ok_or_else(|| {
            VaultError::Unavailable("the custody epoch has no room left to move".into())
        })?;
        Ok(())
    }
}

/// A non-zero incarnation, so a file that has one is told from one written before epochs.
fn draw_incarnation() -> u32 {
    use rand_core::RngCore;
    loop {
        let drawn = rand_core::OsRng.next_u32();
        if drawn != 0 {
            return drawn;
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn io(e: crate::PhoneKeyError) -> VaultError {
    VaultError::Unavailable(e.to_string())
}

/// The file read fresh under the folder's lock: what every operation decides on.
struct Held<'a> {
    /// Serializes this handle's operations (the folder's lock serializes across handles).
    _in_process: MutexGuard<'a, ()>,
    /// The folder's lock, held until the operation ends: `master-keys.lock` locked
    /// exclusively (`flock(2)`, [`crate::file::flock_exclusive`]), across every handle and
    /// process on the folder.
    _folder: std::fs::File,
    /// The file as the lock found it.
    file: MasterFile,
    /// What the folder noted the file has held.
    marker: Marker,
}

/// The phone's master-key vault: `master-keys.json` in the key directory, the seeds sealed by
/// [`MasterSealer`] and the entries tagged by the device [`Sealer`]. Keeps no copy of the file:
/// every operation reads it again under the folder's lock ([`Held`]).
pub struct PhoneVault {
    dir: PathBuf,
    master: Arc<dyn MasterSealer>,
    device: Arc<dyn Sealer>,
    lock: Mutex<()>,
    allow_weak: AtomicBool,
}

impl PhoneVault {
    /// The vault kept in `dir`. Reads and writes are per operation, under the folder's lock;
    /// opening makes nothing.
    pub fn open(
        dir: &std::path::Path,
        master: Arc<dyn MasterSealer>,
        device: Arc<dyn Sealer>,
    ) -> Result<Self, crate::PhoneKeyError> {
        Ok(PhoneVault {
            dir: dir.to_path_buf(),
            master,
            device,
            lock: Mutex::new(()),
            allow_weak: AtomicBool::new(false),
        })
    }

    /// The person agreed to keep a master key at the protection the phone has, below StrongBox
    /// and the TEE. Lasts for this vault object: the app asks again the next time.
    pub fn allow_weak_protection(&self, allow: bool) {
        self.allow_weak.store(allow, Ordering::SeqCst);
    }

    /// What the master sealer's key has.
    pub fn protection(&self) -> String {
        self.master.protection()
    }

    /// `Ok` when a master key may be kept at the master sealer's protection.
    pub fn check_protection(&self) -> Result<(), VaultError> {
        let protection = self.master.protection();
        if matches!(protection.as_str(), "strongbox" | "tee")
            || self.allow_weak.load(Ordering::SeqCst)
        {
            return Ok(());
        }
        Err(VaultError::Unavailable(format!(
            "{WEAK_PROTECTION}{protection}"
        )))
    }

    /// The file read fresh and the folder's lock held, for one operation: every handle and
    /// process on the folder serializes on `master-keys.lock`, and decides on what the file is
    /// then — never on a copy read earlier. `recovering` reads a written-and-lost file as its
    /// fresh state; nothing else does.
    fn held(&self, recovering: bool) -> Result<Held<'_>, VaultError> {
        let in_process = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        crate::file::create_dir_durable(&self.dir).map_err(io)?;
        let folder = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.dir.join(LOCK_FILE_NAME))
            .map_err(unavailable)?;
        crate::file::flock_exclusive(&folder).map_err(unavailable)?;
        let marker = self.read_marker()?;
        let (file, present) = self.read(&marker, recovering)?;
        let mut held = Held {
            _in_process: in_process,
            _folder: folder,
            file,
            marker,
        };
        // An entry written whose note never landed (the process ended between the file's
        // write and the note) is noted now, under the lock, before anything in this
        // operation relies on it — a read, an equal retry, a no-op write: a loss after a
        // success must read as a loss, never a first use.
        if noted(&mut held.marker, &held.file, present) {
            self.write_marker(&held.marker)?;
        }
        Ok(held)
    }

    /// What the folder noted (`custody-metadata.json`): none when it was never written;
    /// unreadable is an error either way.
    fn read_marker(&self) -> Result<Marker, VaultError> {
        match std::fs::read(self.dir.join(MARKER_FILE_NAME)) {
            Ok(bytes) => {
                let marker: Marker = serde_json::from_slice(&bytes)
                    .map_err(|e| unavailable(format!("{MARKER_FILE_NAME}: {e}")))?;
                if marker.v != 1 {
                    return Err(unavailable(format!("{MARKER_FILE_NAME}: v is not 1")));
                }
                Ok(marker)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Marker::fresh()),
            Err(e) => Err(unavailable(e)),
        }
    }

    /// The marker, whole and durable, as every write in this folder is.
    fn write_marker(&self, marker: &Marker) -> Result<(), VaultError> {
        let bytes = serde_json::to_vec_pretty(marker).expect("the custody metadata serialises");
        crate::file::write_atomic(&self.dir.join(MARKER_FILE_NAME), &bytes).map_err(io)
    }

    /// The master-key file, and whether it is there. None written yet is `MasterFile::fresh`
    /// — or, `marker` says one was written and it is gone, a loss: an error, not a fresh
    /// start, unless the caller is recovering on purpose. One that does not read, or predates
    /// the history this schema keeps, is damaged rather than opened.
    fn read(&self, marker: &Marker, recovering: bool) -> Result<(MasterFile, bool), VaultError> {
        match std::fs::read(self.dir.join(MASTER_FILE_NAME)) {
            Ok(bytes) => {
                let file: MasterFile = serde_json::from_slice(&bytes)
                    .map_err(|e| unavailable(format!("{MASTER_FILE_NAME}: {e}")))?;
                if file.v != 1 {
                    return Err(unavailable(format!("{MASTER_FILE_NAME}: v is not 1")));
                }
                if file.incarnation == 0 {
                    return Err(unavailable(format!("{MASTER_FILE_NAME}: incarnation 0")));
                }
                Ok((file, true))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if marker.written && !recovering {
                    return Err(lost_file());
                }
                Ok((MasterFile::fresh(), false))
            }
            Err(e) => Err(unavailable(e)),
        }
    }

    /// Writes `next` whole, then notes in the marker what it holds: the file's entries first,
    /// durable, the note second — a crash between the two leaves an entry that is there and
    /// not yet noted, which reads as it is and is noted under the lock before the next
    /// operation relies on it ([`PhoneVault::held`]); noting first would read an unwritten
    /// entry as lost. What the note buys is the detection of a loss *after* it exists.
    ///
    /// `next` is read back first with the reader [`read`](Self::read) uses, and refused when it
    /// does not read: serde_json writes a value nested past its recursion limit (128), a custody
    /// note say, and cannot read it, and written, that file would lose every key and note in it.
    fn save(&self, held: &mut Held<'_>, next: MasterFile) -> Result<(), VaultError> {
        let bytes = serde_json::to_vec_pretty(&next).expect("the master-key file serialises");
        serde_json::from_slice::<MasterFile>(&bytes).map_err(|e| {
            unavailable(format!(
                "{MASTER_FILE_NAME}: a change that cannot be read back was refused, and the file \
                 left as it was: {e}"
            ))
        })?;
        crate::file::write_atomic(&self.dir.join(MASTER_FILE_NAME), &bytes).map_err(io)?;
        if noted(&mut held.marker, &next, true) {
            self.write_marker(&held.marker)?;
        }
        held.file = next;
        Ok(())
    }

    /// A new entry for `secret`: sealed under its label after one prompt, then tagged.
    fn seal_item(
        &self,
        kind: Kind,
        scid: &str,
        index: u32,
        secret: &Secret<[u8; 32]>,
        owner: Option<&StageToken>,
        prompt: &str,
    ) -> Result<Item, VaultError> {
        self.check_protection()?;
        let key = KeySigner::new(secret.expose(), index).key();
        let sealed = self.master.seal(
            master_label(scid, index),
            secret.expose().to_vec(),
            prompt.to_string(),
        )?;
        let sealed = STANDARD.encode(sealed);
        let owner = owner.map(|o| hex(&o.0));
        let tag = self.tag(kind, scid, index, &key, &sealed, owner.as_deref())?;
        Ok(Item {
            scid: scid.to_string(),
            index,
            key,
            sealed,
            tag,
            owner,
        })
    }

    fn tag(
        &self,
        kind: Kind,
        scid: &str,
        index: u32,
        key: &str,
        sealed: &str,
        owner: Option<&str>,
    ) -> Result<String, VaultError> {
        let body = Item::tag_body(kind, scid, index, key, sealed, owner);
        let tag = self
            .device
            .seal(TAG_LABEL.into(), body)
            .map_err(|e| VaultError::Unavailable(e.to_string()))?;
        Ok(STANDARD.encode(tag))
    }

    /// Whether `item`'s tag covers it as `kind`. Opens the tag with the device sealer (no
    /// prompt). A tag that does not open, or covers other fields, is `Tampered`.
    fn verify(&self, kind: Kind, item: &Item) -> Result<(), VaultError> {
        let tag = STANDARD
            .decode(&item.tag)
            .map_err(|_| VaultError::Tampered)?;
        let _wipe = WipeOnDrop(self.device.as_ref());
        let opened = Zeroizing::new(
            self.device
                .open(TAG_LABEL.into(), tag)
                .map_err(|_| VaultError::Tampered)?,
        );
        let expected = Item::tag_body(
            kind,
            &item.scid,
            item.index,
            &item.key,
            &item.sealed,
            item.owner.as_deref(),
        );
        if opened.as_slice() != expected.as_slice() {
            return Err(VaultError::Tampered);
        }
        Ok(())
    }

    /// The authenticated index of `scid`'s kept key in `file`, for a write that must not go back
    /// a generation or a forget that must name what it leaves: an entry its tag does not vouch
    /// for is refused (`Tampered`) rather than guessed at, as the desktop vault refuses an item
    /// that does not say its index.
    fn kept_index_held(&self, file: &MasterFile, scid: &str) -> Result<Option<u32>, VaultError> {
        match file.kept(scid) {
            Some(item) => {
                self.verify(Kind::Kept, item)?;
                Ok(Some(item.index))
            }
            None => Ok(None),
        }
    }

    /// The way back after the file, or `scid`'s epoch entry in it, was lost
    /// ([`PhoneVault::read`], [`MasterFile::epoch`]), taken on purpose — never automatically:
    /// a fresh entry under a freshly drawn incarnation, so an epoch a flow read before the
    /// loss cannot come back and a removal paused across it keeps the key rather than
    /// forgetting it. An entry that is there is left as it is, and so is every other
    /// identity's: one whose entry went with the file stays lost until it is recovered too.
    /// Answers `scid`'s epoch.
    pub fn recover_custody_epoch(&self, scid: &str) -> Result<u64, VaultError> {
        let mut held = self.held(true)?;
        if let Some(entry) = held.file.epochs.iter().find(|e| e.scid == scid) {
            return Ok((u64::from(held.file.incarnation) << 32) | u64::from(entry.count));
        }
        // The entry was written and lost while the file stayed: a new count under the same
        // incarnation would repeat epochs already answered. A fresh incarnation makes the new
        // entry's epochs new — and moves the other identities' epochs too, the safe direction
        // for a forget at an epoch read before (it keeps the key).
        if held.marker.epochs.iter().any(|s| s == scid) {
            loop {
                let drawn = draw_incarnation();
                if drawn != held.file.incarnation {
                    held.file.incarnation = drawn;
                    break;
                }
            }
        }
        let mut next = held.file.clone();
        next.epochs.push(EpochEntry {
            scid: scid.to_string(),
            count: 0,
        });
        let epoch = next
            .epoch(scid, &held.marker.epochs)
            .expect("the entry was just made");
        self.save(&mut held, next)?;
        Ok(epoch)
    }

    /// The compare-and-delete behind [`Vault::forget_master`] and [`Vault::forget_master_at`],
    /// under the lock: the kept key is removed, and its epoch moved in the same write, only while
    /// `unchanged(file, kept index)` holds; otherwise it is left and named.
    fn forget_kept(
        &self,
        scid: &str,
        unchanged: impl FnOnce(&MasterFile, &[String], u32) -> Result<bool, VaultError>,
    ) -> Result<Forgot, VaultError> {
        let mut held = self.held(false)?;
        let Some(kept) = self.kept_index_held(&held.file, scid)? else {
            return Ok(Forgot::Forgot);
        };
        if !unchanged(&held.file, &held.marker.epochs, kept)? {
            return Ok(Forgot::Kept(kept));
        }
        let mut next = held.file.clone();
        next.kept.retain(|k| k.scid != scid);
        next.bump_epoch(scid, &held.marker.epochs)?;
        self.save(&mut held, next)?;
        Ok(Forgot::Forgot)
    }

    /// The seed of `item` after one prompt, checked against the key its tag covers.
    fn open_item(&self, item: &Item, prompt: &str) -> Result<KeySigner, VaultError> {
        let sealed = STANDARD
            .decode(&item.sealed)
            .map_err(|_| VaultError::Tampered)?;
        let _wipe = MasterWipe(self.master.as_ref());
        let plain = Zeroizing::new(self.master.open(
            master_label(&item.scid, item.index),
            sealed,
            prompt.to_string(),
        )?);
        let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
            plain
                .as_slice()
                .try_into()
                .map_err(|_| VaultError::Tampered)?,
        );
        let signer = KeySigner::new(&seed, item.index);
        if signer.key() != item.key {
            return Err(VaultError::Tampered);
        }
        Ok(signer)
    }
}

/// Calls [`MasterSealer::wipe`] when dropped.
struct MasterWipe<'a>(&'a dyn MasterSealer);

impl Drop for MasterWipe<'_> {
    fn drop(&mut self) {
        self.0.wipe();
    }
}

impl Vault for PhoneVault {
    fn store_master(
        &self,
        scid: &str,
        index: u32,
        secret: Secret<[u8; 32]>,
    ) -> Result<Stored, VaultError> {
        // Checked first so that a key that can never be kept costs no prompt, and again under
        // the lock, where it decides: the prompt is not held under the lock.
        if let Some(kept) = self.kept_index_held(&self.held(false)?.file, scid)? {
            if kept > index {
                return Ok(Stored::AlreadyNewer { kept });
            }
        }
        let item = self.seal_item(Kind::Kept, scid, index, &secret, None, PROMPT_KEEP)?;
        let mut held = self.held(false)?;
        if let Some(kept) = self.kept_index_held(&held.file, scid)? {
            if kept > index {
                return Ok(Stored::AlreadyNewer { kept });
            }
        }
        let mut next = held.file.clone();
        next.kept.retain(|k| k.scid != scid);
        next.kept.push(item);
        // Every store moves it, a same-index re-store too: a forget that read the epoch before
        // a duplicate delivery must not remove what that delivery just kept.
        next.bump_epoch(scid, &held.marker.epochs)?;
        self.save(&mut held, next)?;
        Ok(Stored::Stored)
    }

    fn master_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        let item = self
            .held(false)?
            .file
            .kept
            .iter()
            .find(|k| k.scid == scid)
            .cloned();
        let Some(item) = item else {
            return Ok(None);
        };
        match self.verify(Kind::Kept, &item) {
            Ok(()) => Ok(Some(item.index)),
            // A tag that does not vouch for the entry names no key: `None`, and the caller
            // never forgets a key on `None`.
            Err(VaultError::Tampered) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn stage_master(
        &self,
        scid: &str,
        index: u32,
        secret: Secret<[u8; 32]>,
        owner: &StageToken,
    ) -> Result<(), VaultError> {
        let item = self.seal_item(
            Kind::Staged,
            scid,
            index,
            &secret,
            Some(owner),
            PROMPT_STAGE,
        )?;
        let mut held = self.held(false)?;
        let mut next = held.file.clone();
        next.staged.retain(|k| k.scid != scid);
        next.staged.push(item);
        self.save(&mut held, next)
    }

    fn staged_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        let item = self
            .held(false)?
            .file
            .staged
            .iter()
            .find(|k| k.scid == scid)
            .cloned();
        let Some(item) = item else {
            return Ok(None);
        };
        match self.verify(Kind::Staged, &item) {
            Ok(()) => Ok(Some(item.index)),
            Err(VaultError::Tampered) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Under the lock from the read of the staged and kept entries to the write: the tags are
    /// the device sealer's, which needs no prompt.
    fn promote_master(&self, scid: &str, index: u32) -> Result<Stored, VaultError> {
        let mut held = self.held(false)?;
        let staged = held
            .file
            .staged
            .iter()
            .find(|k| k.scid == scid && k.index == index)
            .cloned()
            .ok_or(VaultError::NotFound)?;
        self.verify(Kind::Staged, &staged)?;
        if let Some(kept) = self.kept_index_held(&held.file, scid)? {
            if kept > index {
                // It can never become the kept key.
                let mut next = held.file.clone();
                next.staged
                    .retain(|k| !(k.scid == scid && k.index == index));
                self.save(&mut held, next)?;
                return Ok(Stored::AlreadyNewer { kept });
            }
        }
        // The sealed seed moves as it is: its label names the identity and index, not the kind.
        let tag = self.tag(Kind::Kept, scid, index, &staged.key, &staged.sealed, None)?;
        let kept = Item {
            tag,
            owner: None,
            ..staged
        };
        let mut next = held.file.clone();
        next.staged
            .retain(|k| !(k.scid == scid && k.index == index));
        next.kept.retain(|k| k.scid != scid);
        next.kept.push(kept);
        next.bump_epoch(scid, &held.marker.epochs)?;
        self.save(&mut held, next)?;
        Ok(Stored::Stored)
    }

    fn discard_staged(
        &self,
        scid: &str,
        index: u32,
        owner: Option<&StageToken>,
    ) -> Result<(), VaultError> {
        let owner = owner.map(|o| hex(&o.0));
        let mut held = self.held(false)?;
        let mut next = held.file.clone();
        next.staged.retain(|k| {
            let matches = k.scid == scid
                && k.index == index
                && owner.as_ref().is_none_or(|o| k.owner.as_ref() == Some(o));
            !matches
        });
        if next == held.file {
            return Ok(());
        }
        self.save(&mut held, next)
    }

    /// A compare-and-delete on the index: a kept key at another index is left and named. A
    /// staged key stays.
    fn forget_master(&self, scid: &str, index: u32) -> Result<Forgot, VaultError> {
        self.forget_kept(scid, |_, _, kept| Ok(kept == index))
    }

    /// The counter in the file, read under the lock every operation takes; no prompt. An entry
    /// the folder noted and lost is an error, never 0 again ([`MasterFile::epoch`]).
    fn custody_epoch(&self, scid: &str) -> Result<u64, VaultError> {
        let held = self.held(false)?;
        held.file.epoch(scid, &held.marker.epochs)
    }

    /// A compare-and-delete on the custody epoch: a key kept since the caller read it (at any
    /// index, the same key delivered again included) moved it, and is left and named.
    fn forget_master_at(&self, scid: &str, epoch: u64) -> Result<Forgot, VaultError> {
        self.forget_kept(scid, |file, noted, _| {
            file.epoch(scid, noted).map(|now| now == epoch)
        })
    }

    fn unlock(&self, scid: &str, why: MasterUse, now: u64) -> Result<Unlocked, VaultError> {
        let item = self
            .held(false)?
            .file
            .kept
            .iter()
            .find(|k| k.scid == scid)
            .cloned()
            .ok_or(VaultError::NotFound)?;
        self.verify(Kind::Kept, &item)?;
        let signer = self.open_item(&item, prompt_for(why))?;
        Ok(Unlocked::new(Box::new(signer), why, now))
    }

    fn store_pending_incept(&self, incept: &Event) -> Result<(), VaultError> {
        let value = serde_json::to_value(incept)
            .map_err(|e| VaultError::Unavailable(format!("the incept does not serialise: {e}")))?;
        let mut held = self.held(false)?;
        let mut next = held.file.clone();
        next.incepts
            .retain(|kept| kept["scid"].as_str() != Some(incept.scid.as_str()));
        next.incepts.push(value);
        self.save(&mut held, next)
    }

    fn pending_incepts(&self) -> Result<Vec<Event>, VaultError> {
        self.held(false)?
            .file
            .incepts
            .iter()
            .map(|value| Event::from_json(value).map_err(|_| VaultError::Tampered))
            .collect()
    }

    fn incept_published(&self, scid: &str) -> Result<(), VaultError> {
        let mut held = self.held(false)?;
        let mut next = held.file.clone();
        next.incepts
            .retain(|kept| kept["scid"].as_str() != Some(scid));
        if next == held.file {
            return Ok(());
        }
        self.save(&mut held, next)
    }

    fn keep_push(&self, push: &PendingPush) -> Result<(), VaultError> {
        let mut held = self.held(false)?;
        if held.file.pushes.contains(push) {
            return Ok(());
        }
        let mut next = held.file.clone();
        next.pushes.push(push.clone());
        self.save(&mut held, next)
    }

    fn pending_pushes(&self) -> Result<Vec<PendingPush>, VaultError> {
        Ok(self.held(false)?.file.pushes.clone())
    }

    fn push_done(&self, push: &PendingPush) -> Result<(), VaultError> {
        let mut held = self.held(false)?;
        let mut next = held.file.clone();
        next.pushes.retain(|p| p != push);
        if next == held.file {
            return Ok(());
        }
        self.save(&mut held, next)
    }

    /// Kept in the file, under the lock: the mark only rises, and the answer is the mark before
    /// this read. Written only when it moves. A mark the folder noted and lost is an error,
    /// never `None` again ([`MasterFile::seen_mark`]); a reset repairs it.
    fn record_seen(&self, scid: &str, version: u64) -> Result<Option<u64>, VaultError> {
        let mut held = self.held(false)?;
        let before = held.file.seen_mark(scid, &held.marker.seen)?;
        let after = before.map_or(version, |before| before.max(version));
        if before == Some(after) {
            return Ok(before);
        }
        let mut next = held.file.clone();
        next.seen.retain(|s| s.scid != scid);
        next.seen.push(Seen {
            scid: scid.to_string(),
            version: Some(after),
        });
        self.save(&mut held, next)?;
        Ok(before)
    }

    /// Forgets the record versions of `scid` read so far, kept as a reset ([`Seen::version`]
    /// `None`) — never the entry dropped, so a reset is told from marks lost. Also the way
    /// back from a lost mark or a lost file: the reset is written, on purpose, and another
    /// identity's mark that went with the file stays lost until it is reset too.
    fn record_seen_reset(&self, scid: &str) -> Result<(), VaultError> {
        let mut held = self.held(true)?;
        let mut next = held.file.clone();
        match next.seen.iter_mut().find(|s| s.scid == scid) {
            Some(mark) => {
                if mark.version.is_none() {
                    return Ok(());
                }
                mark.version = None;
            }
            None => next.seen.push(Seen {
                scid: scid.to_string(),
                version: None,
            }),
        }
        self.save(&mut held, next)
    }

    /// From the file, under the lock: not secret, so no prompt. Gone with a lost file (an
    /// error, as every read of a lost file is), never `None` in its place.
    fn custody_note(&self, scid: &str, key_id: &str) -> Result<Option<CustodyNote>, VaultError> {
        let held = self.held(false)?;
        held.file
            .notes
            .iter()
            .find(|n| n.scid == scid && n.key_id == key_id)
            .map(|n| {
                serde_json::from_value(n.note.clone())
                    .map_err(|e| unavailable(format!("{MASTER_FILE_NAME}: a custody note: {e}")))
            })
            .transpose()
    }

    /// A compare-and-swap under the folder's lock, the one every write here takes: the file is
    /// read again, the kept note compared with `expected` as whole JSON values (every layer
    /// below the top included), and the file written whole and durable only when they match
    /// and the note changes.
    fn swap_custody_note(
        &self,
        scid: &str,
        key_id: &str,
        expected: Option<&CustodyNote>,
        note: Option<&CustodyNote>,
    ) -> Result<bool, VaultError> {
        let as_json = |n: &CustodyNote| serde_json::to_value(n).map_err(unavailable);
        let expected = expected.map(as_json).transpose()?;
        let note = note.map(as_json).transpose()?;
        let mut held = self.held(false)?;
        let at = held
            .file
            .notes
            .iter()
            .position(|n| n.scid == scid && n.key_id == key_id);
        if at.map(|i| &held.file.notes[i].note) != expected.as_ref() {
            return Ok(false);
        }
        let mut next = held.file.clone();
        match (at, note) {
            (None, None) => return Ok(true),
            (Some(i), Some(note)) => next.notes[i].note = note,
            (Some(i), None) => {
                next.notes.remove(i);
            }
            (None, Some(note)) => next.notes.push(Note {
                scid: scid.to_string(),
                key_id: key_id.to_string(),
                note,
            }),
        }
        if next != held.file {
            self.save(&mut held, next)?;
        }
        Ok(true)
    }

    /// From the file, under the folder's lock; drawn and written in the same step when `scid`
    /// has none yet, so two handles asking first at once keep one id. In the file beside the
    /// master keys, so it goes only with them; noted in the folder's metadata like an epoch, so
    /// an id written and gone (the file, or its entry while the file stays) is an error, never
    /// drawn again. A forget of the master key keeps it. Not secret, so no prompt.
    fn vault_id(&self, scid: &str) -> Result<VaultId, VaultError> {
        let mut held = self.held(false)?;
        if let Some(kept) = held.file.ids.iter().find(|e| e.scid == scid) {
            return Ok(kept.id);
        }
        if held.marker.ids.iter().any(|s| s == scid) {
            return Err(lost_id(scid));
        }
        let id = draw_vault_id();
        let mut next = held.file.clone();
        next.ids.push(IdEntry {
            scid: scid.to_string(),
            id,
        });
        self.save(&mut held, next)?;
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SealError;

    /// Both sealers: the label, then the bytes XORed with `pad`.
    struct Xor(u8);

    fn seal(pad: u8, label: &str, plaintext: &[u8]) -> Vec<u8> {
        let mut out = label.as_bytes().to_vec();
        out.push(0);
        out.extend(plaintext.iter().map(|b| b ^ pad));
        out
    }

    fn open(pad: u8, label: &str, sealed: &[u8]) -> Option<Vec<u8>> {
        let mut prefix = label.as_bytes().to_vec();
        prefix.push(0);
        let body = sealed.strip_prefix(prefix.as_slice())?;
        Some(body.iter().map(|b| b ^ pad).collect())
    }

    impl Sealer for Xor {
        fn seal(&self, label: String, plaintext: Vec<u8>) -> Result<Vec<u8>, SealError> {
            Ok(seal(self.0, &label, &plaintext))
        }
        fn open(&self, label: String, sealed: Vec<u8>) -> Result<Vec<u8>, SealError> {
            open(self.0, &label, &sealed).ok_or(SealError::Failed {
                reason: "another label".into(),
            })
        }
        fn wipe(&self) {}
    }

    impl MasterSealer for Xor {
        fn protection(&self) -> String {
            "strongbox".into()
        }
        fn seal(
            &self,
            label: String,
            plaintext: Vec<u8>,
            _: String,
        ) -> Result<Vec<u8>, MasterSealError> {
            Ok(seal(self.0, &label, &plaintext))
        }
        fn open(
            &self,
            label: String,
            sealed: Vec<u8>,
            _: String,
        ) -> Result<Vec<u8>, MasterSealError> {
            open(self.0, &label, &sealed).ok_or(MasterSealError::Failed {
                reason: "another label".into(),
            })
        }
        fn wipe(&self) {}
    }

    fn vault(dir: &std::path::Path) -> PhoneVault {
        PhoneVault::open(dir, Arc::new(Xor(0xa5)), Arc::new(Xor(0x5a))).unwrap()
    }

    fn read(dir: &std::path::Path) -> Value {
        serde_json::from_slice(&std::fs::read(dir.join(MASTER_FILE_NAME)).unwrap()).unwrap()
    }

    fn write(dir: &std::path::Path, value: &Value) {
        std::fs::write(
            dir.join(MASTER_FILE_NAME),
            serde_json::to_vec(value).unwrap(),
        )
        .unwrap();
    }

    use serde_json::Value;

    #[test]
    fn a_kept_key_survives_a_restart_and_unlocks_to_its_own_key() {
        let dir = tempfile::tempdir().unwrap();
        let secret = [3u8; 32];
        vault(dir.path())
            .store_master("scid1", 2, Secret::new(secret))
            .unwrap();
        let again = vault(dir.path());
        assert_eq!(again.master_index("scid1").unwrap(), Some(2));
        assert_eq!(again.master_index("scid2").unwrap(), None);
        let unlocked = again.unlock("scid1", MasterUse::Revoke, 100).unwrap();
        let signer = unlocked.signer(100).unwrap();
        assert_eq!(signer.key(), KeySigner::new(&secret, 2).key());
        assert!(!std::fs::read_to_string(dir.path().join(MASTER_FILE_NAME))
            .unwrap()
            .contains(&STANDARD.encode(secret)));
    }

    // An entry whose index or key was edited no longer matches its tag: it names no key, and
    // an unlock refuses it.
    #[test]
    fn an_edited_entry_names_no_key() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path())
            .store_master("scid1", 0, Secret::new([3; 32]))
            .unwrap();
        let mut file = read(dir.path());
        file["kept"][0]["index"] = 1.into();
        write(dir.path(), &file);
        let edited = vault(dir.path());
        assert_eq!(edited.master_index("scid1").unwrap(), None);
        assert!(matches!(
            edited.unlock("scid1", MasterUse::Link, 0),
            Err(VaultError::Tampered)
        ));

        // A seed sealed for another identity does not pass as this one's.
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        v.store_master("scid2", 0, Secret::new([4; 32])).unwrap();
        let mut file = read(dir.path());
        file["kept"][0]["sealed"] = file["kept"][1]["sealed"].clone();
        write(dir.path(), &file);
        assert_eq!(vault(dir.path()).master_index("scid1").unwrap(), None);
    }

    #[test]
    fn a_staged_key_is_promoted_or_discarded_by_its_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        let mine = StageToken([1; 16]);
        let theirs = StageToken([2; 16]);
        v.stage_master("scid1", 1, Secret::new([4; 32]), &mine)
            .unwrap();
        assert_eq!(v.staged_index("scid1").unwrap(), Some(1));
        v.discard_staged("scid1", 1, Some(&theirs)).unwrap();
        assert_eq!(v.staged_index("scid1").unwrap(), Some(1));
        v.promote_master("scid1", 1).unwrap();
        let again = vault(dir.path());
        assert_eq!(again.staged_index("scid1").unwrap(), None);
        assert_eq!(again.master_index("scid1").unwrap(), Some(1));
        let signer = again.unlock("scid1", MasterUse::SendMaster, 0).unwrap();
        assert_eq!(
            signer.signer(0).unwrap().key(),
            KeySigner::new(&[4; 32], 1).key()
        );
        assert_eq!(again.forget_master("scid1", 0).unwrap(), Forgot::Kept(1));
        assert_eq!(again.forget_master("scid1", 1).unwrap(), Forgot::Forgot);
        assert_eq!(vault(dir.path()).master_index("scid1").unwrap(), None);
        assert_eq!(again.forget_master("scid1", 1).unwrap(), Forgot::Forgot);
    }

    // The kept key never goes back a generation: a lower store changes nothing (and costs no
    // prompt), a staged key under a newer kept one is discarded rather than promoted.
    #[test]
    fn the_kept_key_never_goes_back_a_generation() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        assert_eq!(
            v.store_master("scid1", 2, Secret::new([3; 32])).unwrap(),
            Stored::Stored
        );
        let epoch = v.custody_epoch("scid1").unwrap();
        assert_eq!(
            v.store_master("scid1", 1, Secret::new([4; 32])).unwrap(),
            Stored::AlreadyNewer { kept: 2 }
        );
        assert_eq!(v.custody_epoch("scid1").unwrap(), epoch);
        assert_eq!(v.master_index("scid1").unwrap(), Some(2));

        v.stage_master("scid1", 1, Secret::new([5; 32]), &StageToken([1; 16]))
            .unwrap();
        assert_eq!(
            v.promote_master("scid1", 1).unwrap(),
            Stored::AlreadyNewer { kept: 2 }
        );
        assert_eq!(v.custody_epoch("scid1").unwrap(), epoch);
        let again = vault(dir.path());
        assert_eq!(again.staged_index("scid1").unwrap(), None);
        assert_eq!(again.master_index("scid1").unwrap(), Some(2));
        assert!(matches!(
            again.promote_master("scid1", 1),
            Err(VaultError::NotFound)
        ));
    }

    // The epoch moves on every store, promote and forget that changes the kept key, a same-index
    // re-store included, and survives a restart; a forget at an epoch read before a change keeps
    // the key and names it.
    #[test]
    fn a_forget_at_an_epoch_keeps_a_key_kept_since() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        let none = v.custody_epoch("scid1").unwrap();
        assert_eq!(v.forget_master_at("scid1", none).unwrap(), Forgot::Forgot);

        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        let first = v.custody_epoch("scid1").unwrap();
        assert_ne!(first, none);
        // The same key delivered again: same index, same bytes, and still a move.
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        let second = v.custody_epoch("scid1").unwrap();
        assert_ne!(second, first);
        assert_eq!(v.forget_master_at("scid1", first).unwrap(), Forgot::Kept(0));
        assert_eq!(v.master_index("scid1").unwrap(), Some(0));

        // Another identity's changes leave this one's epoch.
        v.store_master("scid2", 0, Secret::new([4; 32])).unwrap();
        let again = vault(dir.path());
        assert_eq!(again.custody_epoch("scid1").unwrap(), second);

        again
            .stage_master("scid1", 1, Secret::new([5; 32]), &StageToken([1; 16]))
            .unwrap();
        // A stage is not a change of the kept key.
        assert_eq!(again.custody_epoch("scid1").unwrap(), second);
        again.promote_master("scid1", 1).unwrap();
        let promoted = again.custody_epoch("scid1").unwrap();
        assert_ne!(promoted, second);
        assert_eq!(
            again.forget_master_at("scid1", second).unwrap(),
            Forgot::Kept(1)
        );
        assert_eq!(
            again.forget_master_at("scid1", promoted).unwrap(),
            Forgot::Forgot
        );
        assert_eq!(again.master_index("scid1").unwrap(), None);
        let forgotten = again.custody_epoch("scid1").unwrap();
        assert_ne!(forgotten, promoted);
        assert_eq!(vault(dir.path()).custody_epoch("scid1").unwrap(), forgotten);
        assert_eq!(vault(dir.path()).master_index("scid2").unwrap(), Some(0));
    }

    // Two handles on one folder — independently opened, not clones of one vault — each decide
    // on the file as the other left it: a store under a newer kept index is `AlreadyNewer`
    // even from the handle that opened first, a forget at an epoch the other moved keeps the
    // key, and the epochs the two answer never repeat.
    #[test]
    fn two_handles_on_one_folder_decide_on_the_same_store() {
        let dir = tempfile::tempdir().unwrap();
        let a = vault(dir.path());
        let b = vault(dir.path());
        a.store_master("scid1", 2, Secret::new([3; 32])).unwrap();
        // b opened before a's store: deciding on a snapshot taken then would write index 1
        // over the kept 2.
        assert_eq!(b.master_index("scid1").unwrap(), Some(2));
        assert_eq!(
            b.store_master("scid1", 1, Secret::new([4; 32])).unwrap(),
            Stored::AlreadyNewer { kept: 2 }
        );
        assert_eq!(a.master_index("scid1").unwrap(), Some(2));

        let first = b.custody_epoch("scid1").unwrap();
        b.store_master("scid1", 3, Secret::new([5; 32])).unwrap();
        let moved = a.custody_epoch("scid1").unwrap();
        assert_ne!(first, moved);
        assert_eq!(a.forget_master_at("scid1", first).unwrap(), Forgot::Kept(3));
        assert_eq!(
            a.custody_epoch("scid2").unwrap(),
            b.custody_epoch("scid2").unwrap()
        );
    }

    // A file the folder wrote and lost is a loss, not a fresh start: nothing answers or writes
    // over the loss, and the way back is an explicit recovery — a new epoch under a fresh
    // incarnation, a reset mark — which never repeats what the file answered before.
    #[test]
    fn a_vault_file_written_and_lost_is_an_error_until_recovered() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        v.record_seen("scid1", 5).unwrap();
        let before = v.custody_epoch("scid1").unwrap();
        std::fs::remove_file(dir.path().join(MASTER_FILE_NAME)).unwrap();

        let lost = vault(dir.path());
        assert!(lost.master_index("scid1").is_err());
        assert!(lost.custody_epoch("scid1").is_err());
        assert!(lost.record_seen("scid1", 6).is_err());
        assert!(lost.store_master("scid1", 0, Secret::new([3; 32])).is_err());

        let recovered = lost.recover_custody_epoch("scid1").unwrap();
        assert_ne!(recovered, before);
        // The epoch alone does not bring the record mark back: it is reset per identity, as
        // the desktop's marks are.
        assert!(lost.record_seen("scid1", 6).is_err());
        lost.record_seen_reset("scid1").unwrap();
        assert_eq!(lost.record_seen("scid1", 3).unwrap(), None);
        assert_eq!(
            lost.store_master("scid1", 0, Secret::new([3; 32])).unwrap(),
            Stored::Stored
        );
        assert!(lost.custody_epoch("scid1").unwrap() > recovered);
    }

    // An entry the folder noted and that is missing while the file stays — an epoch's or a
    // mark's — is a loss, not a first use. Another identity's entries are untouched. Recovery
    // is explicit and does not repeat an epoch the file answered before the loss.
    #[test]
    fn a_noted_entry_missing_from_the_file_is_lost_not_first_use() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        v.store_master("scid2", 0, Secret::new([4; 32])).unwrap();
        v.record_seen("scid1", 5).unwrap();
        let before = v.custody_epoch("scid1").unwrap();

        let mut file = read(dir.path());
        file.as_object_mut().unwrap()["epochs"] =
            serde_json::json!([{"scid": "scid2", "count": 1}]);
        write(dir.path(), &file);
        let lost = vault(dir.path());
        assert!(lost.custody_epoch("scid1").is_err());
        assert!(lost.store_master("scid1", 1, Secret::new([5; 32])).is_err());
        // A forget that read the epoch before the loss keeps the key rather than judge by 0.
        assert!(lost.forget_master_at("scid1", before).is_err());
        assert!(lost.custody_epoch("scid2").is_ok());

        let recovered = lost.recover_custody_epoch("scid1").unwrap();
        assert_ne!(recovered, before);
        assert_ne!(
            recovered >> 32,
            before >> 32,
            "a lost entry comes back under a fresh incarnation"
        );

        // A noted record mark gone from the file is the same, repaired by its reset only.
        let mut file = read(dir.path());
        file.as_object_mut().unwrap()["seen"] = serde_json::json!([]);
        write(dir.path(), &file);
        assert!(lost.record_seen("scid1", 9).is_err());
        assert_eq!(lost.record_seen("scid2", 1).unwrap(), None);
        lost.record_seen_reset("scid1").unwrap();
        assert_eq!(lost.record_seen("scid1", 9).unwrap(), None);
    }

    // A file without the history this vault writes — no incarnation, epochs or marks — is
    // damaged, not an older format to open: the schema is phase 2b's and was never written
    // without them.
    #[test]
    fn a_file_without_its_history_is_damaged() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path())
            .store_master("scid1", 0, Secret::new([3; 32]))
            .unwrap();
        let mut file = read(dir.path());
        let object = file.as_object_mut().unwrap();
        object.remove("incarnation");
        object.remove("epochs");
        object.remove("seen");
        write(dir.path(), &file);
        let old = vault(dir.path());
        assert!(old.master_index("scid1").is_err());
        assert!(old.custody_epoch("scid1").is_err());
    }

    // A forget refuses an entry its tag does not vouch for rather than guessing at its index.
    #[test]
    fn a_forget_or_store_refuses_an_entry_it_cannot_vouch_for() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path())
            .store_master("scid1", 0, Secret::new([3; 32]))
            .unwrap();
        let mut file = read(dir.path());
        file["kept"][0]["index"] = 1.into();
        write(dir.path(), &file);
        let edited = vault(dir.path());
        assert!(matches!(
            edited.forget_master("scid1", 1),
            Err(VaultError::Tampered)
        ));
        assert!(matches!(
            edited.store_master("scid1", 2, Secret::new([4; 32])),
            Err(VaultError::Tampered)
        ));
        assert!(read(dir.path())["kept"][0]["index"] == 1);
    }

    // The record's high-water mark: each read answers the highest before it, the mark only
    // rises, it survives a restart, and a reset forgets it.
    #[test]
    fn the_record_mark_rises_and_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        assert_eq!(v.record_seen("scid1", 3).unwrap(), None);
        assert_eq!(v.record_seen("scid1", 5).unwrap(), Some(3));
        assert_eq!(v.record_seen("scid1", 4).unwrap(), Some(5));
        assert_eq!(v.record_seen("scid2", 1).unwrap(), None);
        let again = vault(dir.path());
        assert_eq!(again.record_seen("scid1", 5).unwrap(), Some(5));
        again.record_seen_reset("scid1").unwrap();
        assert_eq!(vault(dir.path()).record_seen("scid1", 2).unwrap(), None);
        assert_eq!(vault(dir.path()).record_seen("scid2", 1).unwrap(), Some(1));
    }

    // A mark written whose note never landed — the process ended between the entry and its
    // note — is reconciled under the lock before the equal-version retry relies on it: noted
    // durably first, so losing the mark after that is an error, never a first read again.
    #[test]
    fn a_seen_retry_completes_the_note_an_interrupted_write_missed() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        assert_eq!(v.record_seen("scid1", 5).unwrap(), None);
        // The interruption: the mark stands, its note is gone.
        std::fs::remove_file(dir.path().join(MARKER_FILE_NAME)).unwrap();
        // The same version again does not move the mark — and completes the note.
        assert_eq!(v.record_seen("scid1", 5).unwrap(), Some(5));
        let mut file = read(dir.path());
        file.as_object_mut().unwrap()["seen"] = serde_json::json!([]);
        write(dir.path(), &file);
        assert!(v.record_seen("scid1", 9).is_err());
    }

    // The custody epoch has the same interrupted-commit window: an epoch entry written but
    // not noted is noted by the read that relies on it, so its loss reads as a loss.
    #[test]
    fn an_epoch_entry_is_noted_by_the_read_that_relies_on_it() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        let epoch = v.custody_epoch("scid1").unwrap();
        std::fs::remove_file(dir.path().join(MARKER_FILE_NAME)).unwrap();
        assert_eq!(v.custody_epoch("scid1").unwrap(), epoch);
        let mut file = read(dir.path());
        file.as_object_mut().unwrap()["epochs"] = serde_json::json!([]);
        write(dir.path(), &file);
        assert!(v.custody_epoch("scid1").is_err());
    }

    #[test]
    fn pushes_are_kept_until_done() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        let push = PendingPush {
            scid: "scid1".into(),
            key_id: "d3".into(),
        };
        v.keep_push(&push).unwrap();
        v.keep_push(&push).unwrap();
        assert_eq!(
            vault(dir.path()).pending_pushes().unwrap(),
            vec![push.clone()]
        );
        v.push_done(&push).unwrap();
        assert!(vault(dir.path()).pending_pushes().unwrap().is_empty());
    }

    use ad4m_identity_client::{CustodyNote, NoteToken};

    /// A release over an intent over `deepest`: three layers, so a note that differs from
    /// another only two layers down can be made.
    fn stacked(deepest: CustodyNote) -> CustodyNote {
        CustodyNote::Released {
            epoch: 9,
            token: NoteToken([3; 16]),
            restores: Some(Box::new(CustodyNote::MarkOwed {
                index: 1,
                epoch: 8,
                token: NoteToken([2; 16]),
                acquired: false,
                restores: Some(Box::new(deepest)),
            })),
        }
    }

    fn receipt(acquired: bool) -> CustodyNote {
        CustodyNote::MarkOwed {
            index: 0,
            epoch: 1,
            token: NoteToken([1; 16]),
            acquired,
            restores: None,
        }
    }

    /// A note is kept per identity and per device key, whole: every layer comes back through
    /// another handle on the folder (a restart), and another device's or identity's note is
    /// its own. Cleared, it is gone.
    #[test]
    fn a_custody_note_survives_a_restart_whole_and_per_device() {
        let dir = tempfile::tempdir().unwrap();
        let note = stacked(receipt(true));
        let v = vault(dir.path());
        assert_eq!(v.custody_note("scid1", "d1").unwrap(), None);
        assert!(v
            .swap_custody_note("scid1", "d1", None, Some(&note))
            .unwrap());
        drop(v);

        let v = vault(dir.path());
        assert_eq!(v.custody_note("scid1", "d1").unwrap(), Some(note.clone()));
        assert_eq!(v.custody_note("scid1", "d2").unwrap(), None);
        assert_eq!(v.custody_note("scid2", "d1").unwrap(), None);
        assert!(v
            .swap_custody_note("scid1", "d1", Some(&note), None)
            .unwrap());
        assert_eq!(vault(dir.path()).custody_note("scid1", "d1").unwrap(), None);
    }

    /// The compare is on the whole note: an expected note equal to the kept one at the top,
    /// and different only in the deepest layer's receipt, is stale and changes nothing.
    #[test]
    fn a_swap_from_a_note_that_differs_only_in_a_nested_layer_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        let kept = stacked(receipt(true));
        let stale = stacked(receipt(false));
        assert_eq!(kept.token(), stale.token(), "the same top layer");
        assert!(v
            .swap_custody_note("scid1", "d1", None, Some(&kept))
            .unwrap());
        assert!(!v
            .swap_custody_note("scid1", "d1", Some(&stale), None)
            .unwrap());
        assert!(!v
            .swap_custody_note("scid1", "d1", None, Some(&stale))
            .unwrap());
        assert_eq!(v.custody_note("scid1", "d1").unwrap(), Some(kept.clone()));
        assert!(v
            .swap_custody_note("scid1", "d1", Some(&kept), Some(&receipt(true)))
            .unwrap());
        assert_eq!(v.custody_note("scid1", "d1").unwrap(), Some(receipt(true)));
    }

    /// Handles on one folder (parallel native calls) swapping at once: each swap is one step
    /// under the folder's lock, so of every pair that read the same note one wins, and none
    /// is lost.
    #[test]
    fn swaps_from_two_handles_on_one_folder_never_lose_one() {
        let dir = tempfile::tempdir().unwrap();
        let counter = |n: u64| CustodyNote::Released {
            epoch: n,
            token: NoteToken([0; 16]),
            restores: None,
        };
        vault(dir.path())
            .swap_custody_note("scid1", "d1", None, Some(&counter(0)))
            .unwrap();
        let threads: Vec<_> = (0..2)
            .map(|_| {
                let dir = dir.path().to_path_buf();
                std::thread::spawn(move || {
                    let v = vault(&dir);
                    let mut won = 0;
                    while won < 20 {
                        let Some(CustodyNote::Released { epoch, .. }) =
                            v.custody_note("scid1", "d1").unwrap()
                        else {
                            panic!("the counter's note is gone");
                        };
                        if v.swap_custody_note(
                            "scid1",
                            "d1",
                            Some(&counter(epoch)),
                            Some(&counter(epoch + 1)),
                        )
                        .unwrap()
                        {
                            won += 1;
                        }
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(
            vault(dir.path()).custody_note("scid1", "d1").unwrap(),
            Some(counter(40))
        );
    }

    /// Notes live in the master-key file, so its loss is theirs: an error, never "no note".
    #[test]
    fn a_lost_file_loses_no_note_quietly() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.swap_custody_note("scid1", "d1", None, Some(&receipt(true)))
            .unwrap();
        std::fs::remove_file(dir.path().join(MASTER_FILE_NAME)).unwrap();
        assert!(v.custody_note("scid1", "d1").is_err());
        assert!(v
            .swap_custody_note("scid1", "d1", None, Some(&receipt(true)))
            .is_err());
    }

    /// The note of the vault itself (`VAULT_NOTE`, key id `"vault"`) is kept like a device
    /// key's: its whole stack comes back through another handle, a swap from a stale note is
    /// refused, and it is its own beside a device key's note of the same identity.
    #[test]
    fn the_vault_note_round_trips_whole_with_its_compare_and_swap() {
        use ad4m_identity_client::VAULT_NOTE;
        assert_eq!(VAULT_NOTE, "vault");
        let dir = tempfile::tempdir().unwrap();
        let kept = stacked(receipt(true));
        let stale = stacked(receipt(false));
        let v = vault(dir.path());
        assert_eq!(v.custody_note("scid1", VAULT_NOTE).unwrap(), None);
        assert!(v
            .swap_custody_note("scid1", VAULT_NOTE, None, Some(&kept))
            .unwrap());
        assert!(v
            .swap_custody_note("scid1", "d1", None, Some(&receipt(false)))
            .unwrap());
        drop(v);

        let v = vault(dir.path());
        assert_eq!(
            v.custody_note("scid1", VAULT_NOTE).unwrap(),
            Some(kept.clone())
        );
        assert!(!v
            .swap_custody_note("scid1", VAULT_NOTE, Some(&stale), None)
            .unwrap());
        assert!(!v
            .swap_custody_note("scid1", VAULT_NOTE, None, Some(&stale))
            .unwrap());
        assert_eq!(
            v.custody_note("scid1", VAULT_NOTE).unwrap(),
            Some(kept.clone())
        );
        assert!(v
            .swap_custody_note("scid1", VAULT_NOTE, Some(&kept), None)
            .unwrap());
        assert_eq!(v.custody_note("scid1", VAULT_NOTE).unwrap(), None);
        assert_eq!(v.custody_note("scid1", "d1").unwrap(), Some(receipt(false)));
    }

    /// The nested note is kept as the client's serde JSON, unchanged: what lands in the file is
    /// exactly `serde_json::to_value` of the note, and reads back as the same note.
    #[test]
    fn a_nested_note_is_kept_as_the_clients_json_and_reads_back_equal() {
        let dir = tempfile::tempdir().unwrap();
        let note = stacked(stacked(receipt(true)));
        let v = vault(dir.path());
        assert!(v
            .swap_custody_note("scid1", "d1", None, Some(&note))
            .unwrap());
        assert_eq!(
            read(dir.path())["notes"][0]["note"],
            serde_json::to_value(&note).unwrap()
        );
        assert_eq!(
            vault(dir.path()).custody_note("scid1", "d1").unwrap(),
            Some(note)
        );
    }

    /// A note nested past serde_json's recursion limit (128) is written by it and cannot be read
    /// back: the change is refused before `master-keys.json` is replaced, so the file, with the
    /// sealed keys and every other note in it, still opens after a restart.
    #[test]
    fn a_note_nested_past_what_can_be_read_back_is_refused_and_the_file_stays_readable() {
        let mut deep = receipt(true);
        for _ in 0..70 {
            deep = stacked(deep);
        }
        let kept = stacked(receipt(true));
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        assert!(v
            .swap_custody_note("scid2", "d1", None, Some(&kept))
            .unwrap());
        assert!(v
            .swap_custody_note("scid1", "d1", None, Some(&deep))
            .is_err());
        assert_eq!(v.custody_note("scid1", "d1").unwrap(), None);
        drop(v);

        let v = vault(dir.path());
        assert_eq!(v.custody_note("scid2", "d1").unwrap(), Some(kept));
        assert_eq!(v.custody_note("scid1", "d1").unwrap(), None);
    }

    /// A vault id is drawn once per identity and kept: the same on every ask and through another
    /// handle (a restart), another for another identity, and a forget of the master key keeps it.
    #[test]
    fn a_vault_id_is_stable_across_reopening_and_distinct_per_identity() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        let a = v.vault_id("scid1").unwrap();
        assert_eq!(v.vault_id("scid1").unwrap(), a);
        let b = v.vault_id("scid2").unwrap();
        assert_ne!(a, b);
        v.store_master("scid1", 0, Secret::new([7u8; 32])).unwrap();
        assert_eq!(v.forget_master("scid1", 0).unwrap(), Forgot::Forgot);
        drop(v);

        let v = vault(dir.path());
        assert_eq!(v.vault_id("scid1").unwrap(), a);
        assert_eq!(v.vault_id("scid2").unwrap(), b);
        assert_eq!(read(dir.path())["ids"][0]["id"], a.to_string());
    }

    /// Handles on one folder (parallel native calls) asking first at once keep one id: the draw
    /// and its write are one step under the folder's lock.
    #[test]
    fn two_first_asks_at_once_keep_one_vault_id() {
        let dir = tempfile::tempdir().unwrap();
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let dir = dir.path().to_path_buf();
                std::thread::spawn(move || vault(&dir).vault_id("scid1").unwrap())
            })
            .collect();
        let ids: Vec<VaultId> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert!(ids.iter().all(|id| *id == ids[0]), "{ids:?}");
        assert_eq!(vault(dir.path()).vault_id("scid1").unwrap(), ids[0]);
    }

    /// A kept id that is gone (with the file, or its entry while the file stays) is an error,
    /// never a fresh id: a fresh one beside a kept key would count that copy twice.
    #[test]
    fn a_lost_vault_id_is_an_error_not_a_fresh_id() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.vault_id("scid1").unwrap();
        let b = v.vault_id("scid2").unwrap();
        let mut file = read(dir.path());
        file["ids"]
            .as_array_mut()
            .unwrap()
            .retain(|e| e["scid"] != "scid1");
        write(dir.path(), &file);
        assert!(v.vault_id("scid1").is_err());
        assert_eq!(v.vault_id("scid2").unwrap(), b);

        std::fs::remove_file(dir.path().join(MASTER_FILE_NAME)).unwrap();
        assert!(v.vault_id("scid2").is_err());
        assert!(v.vault_id("scid3").is_err());
    }
}
