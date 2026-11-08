//! The incepts of identities made on this computer whose publish has not been confirmed.
//!
//! `create` keeps master #0 and the co-signed incept before it publishes, and forgets the incept once
//! the publish answers. If the app stops in between, the incept is what lets the next start finish
//! the same identity instead of leaving a master key for an identity nobody can find. So it must
//! survive a restart — and it can sit in a plain file: an incept holds public keys and proofs only,
//! no secret, which is also why it is not in the OS secret store with the master key.
//!
//! On disk: `<dir>/pending-incepts.json`, a JSON array of key-log events in their wire form, written
//! whole through a temp file so a crash leaves the previous list. The file is removed when the list
//! empties.
//!
//! Beside it, the same way, the **retry list of master-key pushes** (`<dir>/pending-pushes.json`):
//! a master key this computer is putting into another device's inbox (the person chose "Keep the
//! master key on this device" while linking it, or said yes to its request) is listed here before
//! the put and forgotten once the store takes it, so a push the app did not see through is tried
//! again at the next start and unlock (`flows::master::retry_pushes`). Each entry is an identity and
//! a device key id: no secret — every try seals the master key current then.
//!
//! The index of the master key kept here is not one of these lists: a list beside the item can
//! fall behind it (a write that fails after the item's), and a reader that trusts it would forget
//! the current key for a replaced one. It lives with the item (`crate::vault`).
//!
//! And the **custody epochs** (`<dir>/custody-epochs.json`, [`Epoch`]): per identity, how many
//! times its kept master key changed here, bumped under the folder's lock by the vault.
//!
//! And the **record high-water marks** (`<dir>/record-seen.json`, [`Vault::record_seen`]): for each
//! identity the highest version of its private record this computer opened, so a store serving
//! back an older version is refused. Public numbers, no secret.
//!
//! Those two are not lists that may empty: what they hold is what a missing one would undo (a
//! forget at an epoch counted again from nothing, a rolled-back record taken as the first). So
//! neither file is ever removed once written, an identity's entry in it never leaves (a forgotten
//! key's epoch stays, a reset mark is kept as a reset), and the folder notes each of them in
//! `<dir>/custody-metadata.json` before it is first written. A noted file that is gone has been
//! lost, not never written: reading it is an error, never an empty start. An epoch entry missing
//! for an identity whose key (kept or staged) is here is the same loss, one entry at a time.
//!
//! The folder is shared by every desktop app and build on this computer, and two can run at once (a
//! WE build and a white-labelled one each hold their own single-instance lock). So each read and
//! each read-modify-write holds an advisory lock on `<dir>/pending-incepts.lock` for its length,
//! across processes — the in-process mutex alone let two services each write back a list without
//! the other's incept. Every list takes that one lock, and so does every read-decide-write of the
//! vault's master-key slots ([`PendingIncepts::exclusive`], `crate::vault`): it is the custody
//! folder's one lock, whatever it guards (its name is older than that, and kept so every build on
//! the computer takes the same file).
//!
//! [`Vault::record_seen`]: ad4m_identity_client::Vault::record_seen

use std::path::PathBuf;
use std::sync::Mutex;

use ad4m_identity_client::{PendingPush, VaultError};
use ad4m_identity_core::Event;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// The file's name inside the custody folder.
pub const FILE_NAME: &str = "pending-incepts.json";

/// The retry list's file inside the custody folder.
pub const PUSHES_FILE_NAME: &str = "pending-pushes.json";

/// The record high-water marks' file inside the custody folder.
pub const SEEN_FILE_NAME: &str = "record-seen.json";

/// The custody epochs' file inside the custody folder.
pub const EPOCHS_FILE_NAME: &str = "custody-epochs.json";

/// The file in the custody folder that notes which of the files that must not go missing
/// (the epochs, the record marks) have been written.
pub const METADATA_FILE_NAME: &str = "custody-metadata.json";

/// What [`METADATA_FILE_NAME`] holds.
#[derive(Default, Serialize, Deserialize)]
struct Metadata {
    version: u32,
    /// The files written in this folder that must exist from then on.
    written: Vec<String>,
}

/// The format of [`METADATA_FILE_NAME`] and of the epochs' file.
const FORMAT: u32 = 1;

/// The highest version of an identity's private record opened on this computer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Seen {
    pub scid: String,
    /// `None` after [`PendingIncepts::record_seen_reset`]: the reset is kept, not the entry
    /// dropped, so a reset is never confused with marks lost.
    pub version: Option<u64>,
}

/// An identity's custody epoch: how many times the kept master key of the identity changed on
/// this computer (stored, promoted or forgotten). A flow that reads it and later changes the
/// kept key only while it is unchanged knows no other app changed the key in between, whatever
/// index that app wrote. Counted per custody folder, under its lock; not secret.
///
/// The value ([`Epoch::value`]) is a random `incarnation`, drawn when the entry is made, above
/// a `count` from 1: an entry made again (after the folder lost the file and its note, or by
/// [`Exclusive::recover_epoch`]) counts in another incarnation, so it does not come back to a
/// value read from the one before (but for a 1 in 2³² draw). The count is checked: at its last
/// value the key can no longer change, rather than wrap.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Epoch {
    pub scid: String,
    pub incarnation: u32,
    pub count: u32,
}

impl Epoch {
    /// A new entry for `scid`, in a fresh incarnation, at its first change.
    fn fresh(scid: &str) -> Self {
        Epoch {
            scid: scid.to_string(),
            incarnation: rand_core::RngCore::next_u32(&mut rand_core::OsRng),
            count: 1,
        }
    }

    /// The epoch a flow reads: never 0, which stands for no change ever counted.
    pub fn value(&self) -> u64 {
        (u64::from(self.incarnation) << 32) | u64::from(self.count)
    }
}

/// The epochs' file.
#[derive(Serialize, Deserialize)]
struct Epochs {
    version: u32,
    epochs: Vec<Epoch>,
}

/// The epochs' file as it is read: this build's, or the bare counters of the build before,
/// whose value is kept (its high half the incarnation, its low half the count).
#[derive(Deserialize)]
#[serde(untagged)]
enum EpochsFile {
    Current(Epochs),
    Before(Vec<CountedBefore>),
}

#[derive(Deserialize)]
struct CountedBefore {
    scid: String,
    epoch: u64,
}

impl EpochsFile {
    fn epochs(self) -> Result<Vec<Epoch>, VaultError> {
        match self {
            EpochsFile::Current(epochs) if epochs.version == FORMAT => Ok(epochs.epochs),
            EpochsFile::Current(epochs) => Err(unavailable(format!(
                "custody epochs in format {}, not {FORMAT}",
                epochs.version
            ))),
            EpochsFile::Before(before) => Ok(before
                .into_iter()
                .map(|b| Epoch {
                    scid: b.scid,
                    incarnation: (b.epoch >> 32) as u32,
                    count: b.epoch as u32,
                })
                .collect()),
        }
    }
}

/// A file that must not go missing, as read.
enum Noted<T> {
    Read(T),
    /// Never written in this folder.
    Never,
    /// Written, and gone.
    Lost,
}

/// The lists a memory store keeps (tests).
#[derive(Default)]
pub struct Lists {
    incepts: Vec<Event>,
    pushes: Vec<PendingPush>,
    seen: Vec<Seen>,
    epochs: Vec<Epoch>,
}

/// The custody folder's lock, held exclusively until dropped ([`PendingIncepts::exclusive`]).
/// What it guards that lives beside the lists (the custody epochs) is read and changed through
/// it, since the lock is not taken twice.
pub struct Exclusive<'a> {
    _in_process: Option<std::sync::MutexGuard<'a, ()>>,
    lists: Option<std::sync::MutexGuard<'a, Lists>>,
    _folder: Option<std::fs::File>,
    dir: Option<&'a std::path::Path>,
}

impl Exclusive<'_> {
    /// `scid`'s custody epoch: 0 before its kept key first changed here. `held` is whether a
    /// key of `scid` (kept or staged) is in the store: then an entry missing from the epochs
    /// this folder counts is lost, and an error, as is a file of epochs that has gone. Only a
    /// folder that never counted one (its keys kept by a build before epochs were) answers 0
    /// for a key it holds.
    pub fn epoch(&self, scid: &str, held: bool) -> Result<u64, VaultError> {
        match self.epochs(false)? {
            Some(epochs) => match epochs.iter().find(|e| e.scid == scid) {
                Some(epoch) => Ok(epoch.value()),
                None if held => Err(lost_epoch(scid)),
                None => Ok(0),
            },
            None => Ok(0),
        }
    }

    /// The kept key of `scid` changed: its epoch goes up by one. Answers the new epoch. `held`
    /// and a lost entry or file as for [`epoch`](Self::epoch): an error, the epoch not counted
    /// again from nothing. A count at its last value is an error too, never a wrap.
    pub fn bump_epoch(&mut self, scid: &str, held: bool) -> Result<u64, VaultError> {
        let counted = self.epochs(false)?;
        let counting = counted.is_some();
        let mut epochs = counted.unwrap_or_default();
        let value = match epochs.iter_mut().find(|e| e.scid == scid) {
            Some(epoch) => {
                epoch.count = epoch.count.checked_add(1).ok_or_else(|| {
                    unavailable("this identity's custody epoch is at its last value")
                })?;
                epoch.value()
            }
            None if held && counting => return Err(lost_epoch(scid)),
            None => {
                let epoch = Epoch::fresh(scid);
                let value = epoch.value();
                epochs.push(epoch);
                value
            }
        };
        self.keep_epochs(epochs)?;
        Ok(value)
    }

    /// The way back from a lost epoch ([`epoch`](Self::epoch)), taken on purpose: when `scid`
    /// has no entry (or the whole file is lost), a new one is made in a fresh incarnation,
    /// which no epoch read before the loss can match. An entry that is there is left as it is.
    /// Answers `scid`'s epoch.
    pub fn recover_epoch(&mut self, scid: &str) -> Result<u64, VaultError> {
        let mut epochs = self.epochs(true)?.unwrap_or_default();
        if let Some(epoch) = epochs.iter().find(|e| e.scid == scid) {
            return Ok(epoch.value());
        }
        let epoch = Epoch::fresh(scid);
        let value = epoch.value();
        epochs.push(epoch);
        self.keep_epochs(epochs)?;
        Ok(value)
    }

    /// The epochs counted in this folder; `None` when it never counted one. A lost file is an
    /// error, or, `recovering`, no epochs at all.
    fn epochs(&self, recovering: bool) -> Result<Option<Vec<Epoch>>, VaultError> {
        match (&self.lists, self.dir) {
            (Some(lists), _) => Ok((!lists.epochs.is_empty()).then(|| lists.epochs.clone())),
            (None, Some(dir)) => match read_noted::<EpochsFile>(dir, EPOCHS_FILE_NAME)? {
                Noted::Read(file) => file.epochs().map(Some),
                Noted::Never => Ok(None),
                Noted::Lost if recovering => Ok(Some(Vec::new())),
                Noted::Lost => Err(lost_file(EPOCHS_FILE_NAME)),
            },
            (None, None) => Ok(None),
        }
    }

    fn keep_epochs(&mut self, epochs: Vec<Epoch>) -> Result<(), VaultError> {
        match (&mut self.lists, self.dir) {
            (Some(lists), _) => {
                lists.epochs = epochs;
                Ok(())
            }
            (None, Some(dir)) => write_noted(
                dir,
                EPOCHS_FILE_NAME,
                &Epochs {
                    version: FORMAT,
                    epochs,
                },
            ),
            (None, None) => Err(unavailable("no custody folder")),
        }
    }
}

fn lost_epoch(scid: &str) -> VaultError {
    unavailable(format!(
        "the custody epoch of {scid} is missing while its master key is kept here; it was lost, \
         and is not counted again from nothing"
    ))
}

fn lost_file(file: &str) -> VaultError {
    unavailable(format!(
        "{file} was written in this custody folder and is gone; it is not started again empty"
    ))
}

/// The lock every process holds while it reads or changes the file.
pub const LOCK_NAME: &str = "pending-incepts.lock";

/// Holds the folder's lock until dropped: shared to read, exclusive to change.
fn lock_folder(dir: &std::path::Path, exclusive: bool) -> Result<std::fs::File, VaultError> {
    std::fs::create_dir_all(dir).map_err(unavailable)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOCK_NAME))
        .map_err(unavailable)?;
    if exclusive {
        file.lock().map_err(unavailable)?;
    } else {
        file.lock_shared().map_err(unavailable)?;
    }
    Ok(file)
}

/// Where the pending incepts, and the retry list of master-key pushes, are kept.
pub enum PendingIncepts {
    /// `<dir>/pending-incepts.json` and `<dir>/pending-pushes.json`: what the app uses.
    File { dir: PathBuf, lock: Mutex<()> },
    /// Kept only as long as the value (tests).
    Memory(Mutex<Lists>),
}

fn unavailable(why: impl std::fmt::Display) -> VaultError {
    VaultError::Unavailable(format!("pending incept: {why}"))
}

impl PendingIncepts {
    /// Kept in `dir`, the folder the custody service already owns.
    pub fn file(dir: impl Into<PathBuf>) -> Self {
        PendingIncepts::File {
            dir: dir.into(),
            lock: Mutex::new(()),
        }
    }

    pub fn memory() -> Self {
        PendingIncepts::Memory(Mutex::new(Lists::default()))
    }

    /// The kept incepts.
    pub fn list(&self) -> Result<Vec<Event>, VaultError> {
        self.read_one(FILE_NAME, |m| m.incepts.clone())
    }

    /// Keeps `incept`, replacing a kept incept of the same identity.
    pub fn keep(&self, incept: &Event) -> Result<(), VaultError> {
        self.change(
            FILE_NAME,
            |m| &mut m.incepts,
            |events: &mut Vec<Event>| {
                events.retain(|e| e.scid != incept.scid);
                events.push(incept.clone());
            },
        )
    }

    /// Forgets the incept of `scid`; nothing to do when none is kept.
    pub fn forget(&self, scid: &str) -> Result<(), VaultError> {
        self.change(
            FILE_NAME,
            |m| &mut m.incepts,
            |events: &mut Vec<Event>| events.retain(|e| e.scid != scid),
        )
    }

    /// The master-key pushes kept and not yet confirmed sent.
    pub fn pushes(&self) -> Result<Vec<PendingPush>, VaultError> {
        self.read_one(PUSHES_FILE_NAME, |m| m.pushes.clone())
    }

    /// Keeps `push` on the retry list; keeping one already listed is no change.
    pub fn keep_push(&self, push: &PendingPush) -> Result<(), VaultError> {
        self.change(
            PUSHES_FILE_NAME,
            |m| &mut m.pushes,
            |pushes: &mut Vec<PendingPush>| {
                if !pushes.contains(push) {
                    pushes.push(push.clone());
                }
            },
        )
    }

    /// Forgets `push`; nothing to do when it is not listed.
    pub fn push_done(&self, push: &PendingPush) -> Result<(), VaultError> {
        self.change(
            PUSHES_FILE_NAME,
            |m| &mut m.pushes,
            |pushes: &mut Vec<PendingPush>| pushes.retain(|p| p != push),
        )
    }

    /// Notes `version` of `scid`'s record as opened and answers the highest version opened before
    /// it (`None` before the first). The mark only rises. One read-modify-write under the lock, so
    /// two apps noting at once keep the higher.
    ///
    /// Marks this folder wrote and lost (the file gone, or unreadable) are an error, never
    /// `None`: an older record that still verifies would be taken as the first.
    pub fn record_seen(&self, scid: &str, version: u64) -> Result<Option<u64>, VaultError> {
        self.change_noted(
            SEEN_FILE_NAME,
            |m| &mut m.seen,
            |seen: &mut Vec<Seen>| match seen.iter_mut().find(|s| s.scid == scid) {
                Some(mark) => {
                    let before = mark.version;
                    mark.version = Some(before.map_or(version, |before| before.max(version)));
                    before
                }
                None => {
                    seen.push(Seen {
                        scid: scid.to_string(),
                        version: Some(version),
                    });
                    None
                }
            },
        )
    }

    /// Forgets the record versions of `scid` opened so far. Kept as a reset ([`Seen::version`]
    /// `None`), so the next [`record_seen`](Self::record_seen) answers `None` on purpose.
    pub fn record_seen_reset(&self, scid: &str) -> Result<(), VaultError> {
        self.change_noted(
            SEEN_FILE_NAME,
            |m| &mut m.seen,
            |seen: &mut Vec<Seen>| match seen.iter_mut().find(|s| s.scid == scid) {
                Some(mark) => mark.version = None,
                None => seen.push(Seen {
                    scid: scid.to_string(),
                    version: None,
                }),
            },
        )
    }

    /// Holds the custody folder's lock exclusively until the answer drops: across processes on a
    /// folder (the advisory lock on `<dir>/pending-incepts.lock`) and across threads of this one.
    /// The vault takes it around each read-decide-write of a master-key slot. Nothing else of
    /// this value may be called while it is held (each takes the same lock).
    pub fn exclusive(&self) -> Result<Exclusive<'_>, VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let in_process = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let folder = lock_folder(dir, true)?;
                Ok(Exclusive {
                    _in_process: Some(in_process),
                    lists: None,
                    _folder: Some(folder),
                    dir: Some(dir),
                })
            }
            PendingIncepts::Memory(lists) => Ok(Exclusive {
                _in_process: None,
                lists: Some(lists.lock().map_err(|_| unavailable("lock poisoned"))?),
                _folder: None,
                dir: None,
            }),
        }
    }

    fn read_one<T: DeserializeOwned>(
        &self,
        file: &str,
        memory: impl FnOnce(&Lists) -> Vec<T>,
    ) -> Result<Vec<T>, VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let _shared = lock_folder(dir, false)?;
                read(dir, file)
            }
            PendingIncepts::Memory(lists) => Ok(memory(
                &*lists.lock().map_err(|_| unavailable("lock poisoned"))?,
            )),
        }
    }

    fn change<T: Serialize + DeserializeOwned, R>(
        &self,
        file: &str,
        memory: impl FnOnce(&mut Lists) -> &mut Vec<T>,
        edit: impl FnOnce(&mut Vec<T>) -> R,
    ) -> Result<R, VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let _exclusive = lock_folder(dir, true)?;
                let mut items = read(dir, file)?;
                let answer = edit(&mut items);
                write(dir, file, &items)?;
                Ok(answer)
            }
            PendingIncepts::Memory(lists) => Ok(edit(memory(
                &mut *lists.lock().map_err(|_| unavailable("lock poisoned"))?,
            ))),
        }
    }

    /// [`change`](Self::change) for a file that must not go missing ([`read_noted`]): a lost one
    /// is an error, and the file is kept even when the list empties.
    fn change_noted<T: Serialize + DeserializeOwned, R>(
        &self,
        file: &str,
        memory: impl FnOnce(&mut Lists) -> &mut Vec<T>,
        edit: impl FnOnce(&mut Vec<T>) -> R,
    ) -> Result<R, VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let _exclusive = lock_folder(dir, true)?;
                let mut items = match read_noted(dir, file)? {
                    Noted::Read(items) => items,
                    Noted::Never => Vec::new(),
                    Noted::Lost => return Err(lost_file(file)),
                };
                let answer = edit(&mut items);
                write_noted(dir, file, &items)?;
                Ok(answer)
            }
            PendingIncepts::Memory(lists) => Ok(edit(memory(
                &mut *lists.lock().map_err(|_| unavailable("lock poisoned"))?,
            ))),
        }
    }
}

/// `file`, one that must not go missing once written: [`Noted::Lost`] when the folder's
/// metadata says it was written and it is not there. Read under the folder's lock.
fn read_noted<T: DeserializeOwned>(
    dir: &std::path::Path,
    file: &str,
) -> Result<Noted<T>, VaultError> {
    match std::fs::read(dir.join(file)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Noted::Read)
            .map_err(unavailable),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if metadata(dir)?.written.iter().any(|f| f == file) {
                Ok(Noted::Lost)
            } else {
                Ok(Noted::Never)
            }
        }
        Err(e) => Err(unavailable(e)),
    }
}

/// Writes `file`, one that must not go missing, noting it in the folder's metadata first: noted
/// and durable before the file is, so it is never there unnoted (the metadata a file that predates
/// it never had is written with its next change).
fn write_noted<T: Serialize + ?Sized>(
    dir: &std::path::Path,
    file: &str,
    value: &T,
) -> Result<(), VaultError> {
    let mut noted = metadata(dir)?;
    if !noted.written.iter().any(|f| f == file) {
        noted.version = FORMAT;
        noted.written.push(file.to_string());
        write_bytes(
            dir,
            METADATA_FILE_NAME,
            &serde_json::to_vec(&noted).map_err(unavailable)?,
        )?;
    }
    write_bytes(dir, file, &serde_json::to_vec(value).map_err(unavailable)?)
}

/// The folder's [`Metadata`]: none written yet when its file is absent; unreadable is an error.
fn metadata(dir: &std::path::Path) -> Result<Metadata, VaultError> {
    match std::fs::read(dir.join(METADATA_FILE_NAME)) {
        Ok(bytes) => {
            let metadata: Metadata = serde_json::from_slice(&bytes).map_err(unavailable)?;
            if metadata.version != FORMAT {
                return Err(unavailable(format!(
                    "custody metadata in format {}, not {FORMAT}",
                    metadata.version
                )));
            }
            Ok(metadata)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Metadata::default()),
        Err(e) => Err(unavailable(e)),
    }
}

fn read<T: DeserializeOwned>(dir: &std::path::Path, file: &str) -> Result<Vec<T>, VaultError> {
    match std::fs::read(dir.join(file)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(unavailable),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(unavailable(e)),
    }
}

fn write<T: Serialize>(dir: &std::path::Path, file: &str, events: &[T]) -> Result<(), VaultError> {
    let path = dir.join(file);
    if events.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(unavailable(e)),
            Err(_) => Ok(()),
            Ok(()) => crate::store::sync_dir(dir).map_err(unavailable),
        };
    }
    write_bytes(dir, file, &serde_json::to_vec(events).map_err(unavailable)?)
}

/// Writes `bytes` as `<dir>/<file>`, whole through a temp file, durable when it answers.
fn write_bytes(dir: &std::path::Path, file: &str, bytes: &[u8]) -> Result<(), VaultError> {
    use std::io::Write;
    let path = dir.join(file);
    std::fs::create_dir_all(dir).map_err(unavailable)?;
    // Its own temp name per process, so two writers never share one half-written file.
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let mut file = std::fs::File::create(&tmp).map_err(unavailable)?;
    file.write_all(bytes).map_err(unavailable)?;
    file.sync_all().map_err(unavailable)?;
    std::fs::rename(&tmp, &path).map_err(unavailable)?;
    // The rename too, not only the bytes: a custody epoch bumped and answered must not come
    // back lower after a power loss, or a later bump would repeat a value a flow already read.
    crate::store::sync_dir(dir).map_err(unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ad4m_identity_client::vault::KeySigner;
    use ad4m_identity_core::build::{incept_human, Signer};
    use ad4m_identity_core::{words, DeviceKey, KeyLife};

    /// An incept of fixed words listing one device (public data only).
    fn incept(entropy: u8) -> Event {
        let seed = words::seed(&words::from_entropy(&[entropy; 16]));
        let master = words::master_key(&seed, 0).unwrap();
        let (next, _) = words::next_commitment(&seed, 1).unwrap();
        let device = DeviceKey {
            id: "d1".into(),
            sign: Signer::key(&KeySigner::new(&[5u8; 32], 0)),
            enc: ad4m_identity_core::encode_x25519_multikey(&[6u8; 32]),
            life: KeyLife::Standing,
        };
        incept_human(&master, next, vec![device]).unwrap()
    }

    #[test]
    fn a_kept_incept_survives_reopening_until_it_is_published() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (incept(1), incept(2));
        let pending = PendingIncepts::file(dir.path());
        assert!(pending.list().unwrap().is_empty());
        pending.keep(&a).unwrap();
        pending.keep(&b).unwrap();
        // Keeping the same identity again replaces it rather than adding a second.
        pending.keep(&a).unwrap();
        drop(pending);

        let reopened = PendingIncepts::file(dir.path());
        let kept = reopened.list().unwrap();
        assert_eq!(kept.len(), 2);
        assert!(kept.contains(&a) && kept.contains(&b));

        reopened.forget(&a.scid).unwrap();
        assert_eq!(
            PendingIncepts::file(dir.path()).list().unwrap(),
            vec![b.clone()]
        );
        reopened.forget(&b.scid).unwrap();
        reopened.forget(&b.scid).unwrap();
        assert!(PendingIncepts::file(dir.path()).list().unwrap().is_empty());
        // An empty list leaves no file behind.
        assert!(!dir.path().join(FILE_NAME).exists());
    }

    #[test]
    fn two_services_keeping_at_once_lose_neither_incept() {
        // Each its own `PendingIncepts`, as two apps' custody services are: only the folder's lock
        // stands between their read-modify-writes.
        let dir = tempfile::tempdir().unwrap();
        let incepts: Vec<Event> = (10..30).map(incept).collect();
        std::thread::scope(|scope| {
            for chunk in incepts.chunks(5) {
                let dir = dir.path();
                scope.spawn(move || {
                    let service = PendingIncepts::file(dir);
                    for event in chunk {
                        service.keep(event).unwrap();
                    }
                });
            }
        });
        let kept = PendingIncepts::file(dir.path()).list().unwrap();
        assert_eq!(kept.len(), incepts.len());
    }

    #[test]
    fn the_kept_file_holds_no_secret() {
        let dir = tempfile::tempdir().unwrap();
        let seed = words::seed(&words::from_entropy(&[3; 16]));
        let master = words::master_key(&seed, 0).unwrap();
        PendingIncepts::file(dir.path()).keep(&incept(3)).unwrap();
        let bytes = std::fs::read(dir.path().join(FILE_NAME)).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!bytes.windows(32).any(|w| w == master.to_bytes()));
        assert!(!text.contains(&bs58::encode(master.to_bytes()).into_string()));
    }

    #[test]
    fn the_retry_list_keeps_each_push_once_beside_the_incepts() {
        let dir = tempfile::tempdir().unwrap();
        let push = |key_id: &str| PendingPush {
            scid: "QmA".into(),
            key_id: key_id.into(),
        };
        let pending = PendingIncepts::file(dir.path());
        pending.keep(&incept(4)).unwrap();
        pending.keep_push(&push("d2")).unwrap();
        pending.keep_push(&push("d3")).unwrap();
        // Kept again before its put passed: still once.
        pending.keep_push(&push("d2")).unwrap();
        drop(pending);

        let reopened = PendingIncepts::file(dir.path());
        assert_eq!(reopened.pushes().unwrap(), vec![push("d2"), push("d3")]);
        // The two lists are apart: forgetting a push leaves the incept, and the other way round.
        reopened.push_done(&push("d2")).unwrap();
        reopened.forget(&incept(4).scid).unwrap();
        assert_eq!(reopened.pushes().unwrap(), vec![push("d3")]);
        reopened.push_done(&push("d3")).unwrap();
        reopened.push_done(&push("d3")).unwrap();
        assert!(PendingIncepts::file(dir.path())
            .pushes()
            .unwrap()
            .is_empty());
        assert!(!dir.path().join(PUSHES_FILE_NAME).exists());

        let memory = PendingIncepts::memory();
        memory.keep_push(&push("d2")).unwrap();
        memory.keep_push(&push("d2")).unwrap();
        assert_eq!(memory.pushes().unwrap(), vec![push("d2")]);
        assert!(memory.list().unwrap().is_empty());
    }

    #[test]
    fn the_record_high_water_mark_rises_only_and_survives_reopening() {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingIncepts::file(dir.path());
        assert_eq!(pending.record_seen("QmA", 1).unwrap(), None);
        assert_eq!(pending.record_seen("QmA", 3).unwrap(), Some(1));
        drop(pending);
        let reopened = PendingIncepts::file(dir.path());
        // Under the mark: answers the mark, which does not fall.
        assert_eq!(reopened.record_seen("QmA", 2).unwrap(), Some(3));
        assert_eq!(reopened.record_seen("QmA", 3).unwrap(), Some(3));
        assert_eq!(reopened.record_seen("QmB", 1).unwrap(), None);
        reopened.record_seen_reset("QmA").unwrap();
        assert_eq!(reopened.record_seen("QmA", 2).unwrap(), None);
        // The other lists are apart.
        assert!(reopened.list().unwrap().is_empty());
        assert!(reopened.pushes().unwrap().is_empty());

        let memory = PendingIncepts::memory();
        assert_eq!(memory.record_seen("QmA", 4).unwrap(), None);
        assert_eq!(memory.record_seen("QmA", 2).unwrap(), Some(4));
    }

    /// Lal's review of we#431: after version 20 was opened here, the marks' file disappears (a
    /// partial clean-up, an incomplete restore of the folder). Read as no marks at all, an older
    /// record that still verifies would be taken as the first ever opened. Lost marks are an
    /// error; only a reset forgets one.
    #[test]
    fn lost_record_marks_are_an_error_and_only_a_reset_forgets_one() {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingIncepts::file(dir.path());
        assert_eq!(pending.record_seen("QmA", 20).unwrap(), None);
        std::fs::remove_file(dir.path().join(SEEN_FILE_NAME)).unwrap();
        let rolled_back = pending.record_seen("QmA", 10);
        assert!(rolled_back.is_err(), "{rolled_back:?}");
        // A new handle (the next start) the same.
        assert!(PendingIncepts::file(dir.path())
            .record_seen("QmA", 10)
            .is_err());
        // And a file that cannot be read.
        std::fs::write(dir.path().join(SEEN_FILE_NAME), b"not json").unwrap();
        assert!(pending.record_seen("QmA", 10).is_err());

        // A reset is kept as a reset: what follows starts again, and the file stays.
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingIncepts::file(dir.path());
        assert_eq!(pending.record_seen("QmA", 20).unwrap(), None);
        pending.record_seen_reset("QmA").unwrap();
        assert!(dir.path().join(SEEN_FILE_NAME).exists());
        assert_eq!(pending.record_seen("QmA", 10).unwrap(), None);
        assert_eq!(pending.record_seen("QmA", 9).unwrap(), Some(10));
        // A folder that never kept marks has none to lose.
        let fresh = tempfile::tempdir().unwrap();
        assert_eq!(
            PendingIncepts::file(fresh.path())
                .record_seen("QmA", 3)
                .unwrap(),
            None
        );
    }

    #[test]
    fn the_exclusive_lock_holds_another_handle_off_until_it_drops() {
        // Two values on one folder, as two processes' services are.
        let dir = tempfile::tempdir().unwrap();
        let held = PendingIncepts::file(dir.path());
        let other = PendingIncepts::file(dir.path());
        let guard = held.exclusive().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                other
                    .keep_push(&PendingPush {
                        scid: "QmA".into(),
                        key_id: "d2".into(),
                    })
                    .unwrap();
                tx.send(()).unwrap();
            });
            assert!(rx
                .recv_timeout(std::time::Duration::from_millis(200))
                .is_err());
            drop(guard);
            rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
        });
        assert_eq!(held.pushes().unwrap().len(), 1);
    }
}
