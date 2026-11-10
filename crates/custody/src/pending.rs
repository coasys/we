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
//! And the **custody notes** (`<dir>/custody-notes.json`, [`Vault::custody_note`]): per identity
//! and per device key, that device's account of its custody decisions (an acquisition whose
//! record mark is owed, a release), kept as the client's serde JSON and never read here. Each
//! change is a compare-and-swap of the whole note under the folder's lock. Not secret. Like the
//! epochs and the marks, the file is noted once written and never removed: gone, it is an error,
//! never "no note" (a release would read as never made). A note cleared leaves the file, on
//! purpose, so the folder notes the file only, not each identity in it.
//!
//! Those two are not lists that may empty: what they hold is what a missing one would undo (a
//! forget at an epoch counted again from nothing, a rolled-back record taken as the first). So
//! neither file is ever removed once written, an identity's entry in it never leaves (a forgotten
//! key's epoch stays, a reset mark is kept as a reset), and the folder notes each of them in
//! `<dir>/custody-metadata.json` before it is first written. A noted file that is gone has been
//! lost, not never written: reading it is an error, never an empty start. The metadata notes each
//! identity too, before its entry in either file is first written, so an entry missing for a
//! noted identity is the same loss, one entry at a time, while an identity never noted simply
//! has none yet (a second identity first staged into a folder that counts another's epoch, an
//! identity kept by a build before epochs were): its entry is made with its first stage or change.
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
//! [`Vault::custody_note`]: ad4m_identity_client::Vault::custody_note

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use ad4m_identity_client::{CustodyNote, PendingPush, VaultError};
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

/// The custody notes' file inside the custody folder.
pub const NOTES_FILE_NAME: &str = "custody-notes.json";

/// The file in the custody folder that notes which of the files that must not go missing
/// (the epochs, the record marks, the custody notes) have been written.
pub const METADATA_FILE_NAME: &str = "custody-metadata.json";

/// What [`METADATA_FILE_NAME`] holds.
#[derive(Default, Serialize, Deserialize)]
struct Metadata {
    version: u32,
    /// The files written in this folder that must exist from then on.
    written: Vec<String>,
    /// Per file of [`written`](Self::written), the identities an entry was made for in it,
    /// noted once the entry is written: an entry missing for one of them has been lost; one
    /// missing for an identity never noted was never made. Absent in metadata written before
    /// identities were noted (an identity whose entry is in the file is found there all the
    /// same, and is noted with the file's next change).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    entries: BTreeMap<String, Vec<String>>,
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
/// [`Exclusive::recover_epoch`]) counts in another incarnation, so it comes back to a value read
/// from the one before only if the new draw equals the old: improbable (1 in 2³² per draw, the
/// chance adding up over draws), not impossible. The count is checked: at its last value the key
/// can no longer change, rather than wrap.
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

/// A file that must not go missing, as read, with the identities noted as having an entry in it
/// ([`Metadata::entries`]).
enum Noted<T> {
    Read(T, Vec<String>),
    /// Never written in this folder.
    Never,
    /// Written, and gone.
    Lost(Vec<String>),
}

/// One device's custody note for one identity ([`Vault::custody_note`]), kept as the serde JSON
/// the client's [`CustodyNote`] wrote: the folder never reads its layers, and a swap compares
/// the whole value, every layer below the top included.
///
/// [`Vault::custody_note`]: ad4m_identity_client::Vault::custody_note
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub scid: String,
    pub key_id: String,
    pub note: serde_json::Value,
}

/// The custody notes' file.
#[derive(Serialize, Deserialize)]
struct Notes {
    version: u32,
    notes: Vec<Note>,
}

/// The custody epochs as read under the lock, and the identities noted as having one.
#[derive(Default)]
struct Counted {
    epochs: Vec<Epoch>,
    noted: Vec<String>,
}

impl Counted {
    /// `scid`'s entry; `None` when none was ever made for it. One made and gone is an error.
    fn find(&self, scid: &str) -> Result<Option<&Epoch>, VaultError> {
        match self.epochs.iter().find(|e| e.scid == scid) {
            Some(epoch) => Ok(Some(epoch)),
            None if self.noted.iter().any(|s| s == scid) => Err(lost_epoch(scid)),
            None => Ok(None),
        }
    }
}

/// The lists a memory store keeps (tests).
#[derive(Default)]
pub struct Lists {
    incepts: Vec<Event>,
    pushes: Vec<PendingPush>,
    seen: Vec<Seen>,
    epochs: Vec<Epoch>,
    notes: Vec<Note>,
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
    /// `scid`'s custody epoch: 0 while no entry was ever made for it here (no key of it kept or
    /// staged yet, or kept only by a build before epochs were). An entry this folder made and
    /// has lost is an error, never 0, as is a file of epochs that has gone: the folder notes each
    /// identity before its entry is first written ([`Metadata::entries`]), so a missing entry is
    /// told apart from one never made.
    pub fn epoch(&self, scid: &str) -> Result<u64, VaultError> {
        Ok(self.epochs(false)?.find(scid)?.map_or(0, Epoch::value))
    }

    /// The kept key of `scid` changed: its epoch goes up by one, or, when no entry was ever made
    /// for it, starts in a fresh incarnation. Answers the new epoch. A lost entry or file as for
    /// [`epoch`](Self::epoch): an error, the epoch not counted again from nothing. A count at
    /// its last value is an error too, never a wrap.
    pub fn bump_epoch(&mut self, scid: &str) -> Result<u64, VaultError> {
        let mut counted = self.epochs(false)?;
        counted.find(scid)?;
        let value = match counted.epochs.iter_mut().find(|e| e.scid == scid) {
            Some(epoch) => {
                epoch.count = epoch.count.checked_add(1).ok_or_else(|| {
                    unavailable("this identity's custody epoch is at its last value")
                })?;
                epoch.value()
            }
            None => {
                let epoch = Epoch::fresh(scid);
                let value = epoch.value();
                counted.epochs.push(epoch);
                value
            }
        };
        self.keep_epochs(counted.epochs)?;
        Ok(value)
    }

    /// Makes `scid`'s entry when none was ever made, in a fresh incarnation; one that is there
    /// is left as it is (a stage does not change the kept key). Taken before a key of `scid` is
    /// first staged, so the promote that follows finds the entry it bumps. A lost entry or file
    /// is an error, as for [`epoch`](Self::epoch). Answers the epoch.
    pub fn establish_epoch(&mut self, scid: &str) -> Result<u64, VaultError> {
        let mut counted = self.epochs(false)?;
        if let Some(epoch) = counted.find(scid)? {
            return Ok(epoch.value());
        }
        let epoch = Epoch::fresh(scid);
        let value = epoch.value();
        counted.epochs.push(epoch);
        self.keep_epochs(counted.epochs)?;
        Ok(value)
    }

    /// The way back from a lost epoch ([`epoch`](Self::epoch)), taken on purpose: when `scid`
    /// has no entry (or the whole file is lost), a new one is made in a fresh incarnation, so an
    /// epoch read before the loss matches it only by a 1 in 2³² draw. An entry that is there is
    /// left as it is, and so is every other identity's: one whose entry went with a lost file
    /// stays lost until it is recovered too. Answers `scid`'s epoch.
    pub fn recover_epoch(&mut self, scid: &str) -> Result<u64, VaultError> {
        let mut counted = self.epochs(true)?;
        if let Some(epoch) = counted.epochs.iter().find(|e| e.scid == scid) {
            return Ok(epoch.value());
        }
        let epoch = Epoch::fresh(scid);
        let value = epoch.value();
        counted.epochs.push(epoch);
        self.keep_epochs(counted.epochs)?;
        Ok(value)
    }

    /// The epochs counted in this folder (none when it never counted one) and the identities
    /// noted as having one. A lost file is an error, or, `recovering`, no epochs at all.
    fn epochs(&self, recovering: bool) -> Result<Counted, VaultError> {
        match (&self.lists, self.dir) {
            (Some(lists), _) => Ok(Counted {
                epochs: lists.epochs.clone(),
                noted: lists.epochs.iter().map(|e| e.scid.clone()).collect(),
            }),
            (None, Some(dir)) => match read_noted::<EpochsFile>(dir, EPOCHS_FILE_NAME)? {
                Noted::Read(file, noted) => Ok(Counted {
                    epochs: file.epochs()?,
                    noted,
                }),
                Noted::Never => Ok(Counted::default()),
                Noted::Lost(noted) if recovering => Ok(Counted {
                    epochs: Vec::new(),
                    noted,
                }),
                Noted::Lost(_) => Err(lost_file(EPOCHS_FILE_NAME)),
            },
            (None, None) => Ok(Counted::default()),
        }
    }

    fn keep_epochs(&mut self, epochs: Vec<Epoch>) -> Result<(), VaultError> {
        match (&mut self.lists, self.dir) {
            (Some(lists), _) => {
                lists.epochs = epochs;
                Ok(())
            }
            (None, Some(dir)) => {
                let scids: Vec<String> = epochs.iter().map(|e| e.scid.clone()).collect();
                write_noted(
                    dir,
                    EPOCHS_FILE_NAME,
                    &scids,
                    &Epochs {
                        version: FORMAT,
                        epochs,
                    },
                )
            }
            (None, None) => Err(unavailable("no custody folder")),
        }
    }
}

/// Whether `error` is a custody epoch this folder lost ([`Exclusive::epoch`]): the one a
/// person recovers from with their words ([`crate::vault::DesktopVault::recover_custody_epoch`]).
pub fn is_lost_epoch(error: &VaultError) -> bool {
    matches!(error, VaultError::Unavailable(why)
        if why.contains(LOST_EPOCH) || why.contains(&format!("{EPOCHS_FILE_NAME} {LOST_FILE}")))
}

/// What a lost epoch's error says, and [`is_lost_epoch`] looks for.
const LOST_EPOCH: &str = "custody epoch was made in this custody folder and is gone";

/// What a lost file's error says after its name.
const LOST_FILE: &str = "was written in this custody folder and is gone";

fn lost_epoch(scid: &str) -> VaultError {
    unavailable(format!(
        "{scid}'s {LOST_EPOCH}; it is not counted again from nothing"
    ))
}

fn lost_file(file: &str) -> VaultError {
    unavailable(format!("{file} {LOST_FILE}; it is not started again empty"))
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
    /// Marks this folder wrote and lost (the file gone, or unreadable, or the entry of an
    /// identity the folder noted as marked gone from it) are an error, never `None`: an older
    /// record that still verifies would be taken as the first.
    pub fn record_seen(&self, scid: &str, version: u64) -> Result<Option<u64>, VaultError> {
        self.change_noted(
            SEEN_FILE_NAME,
            false,
            |m| &mut m.seen,
            |seen: &mut Vec<Seen>, noted: &[String]| match seen.iter_mut().find(|s| s.scid == scid)
            {
                Some(mark) => {
                    let before = mark.version;
                    mark.version = Some(before.map_or(version, |before| before.max(version)));
                    Ok(before)
                }
                None if noted.iter().any(|s| s == scid) => Err(unavailable(format!(
                    "the record mark of {scid} was made in this custody folder and is gone; \
                     only a reset starts it again"
                ))),
                None => {
                    seen.push(Seen {
                        scid: scid.to_string(),
                        version: Some(version),
                    });
                    Ok(None)
                }
            },
        )
    }

    /// Forgets the record versions of `scid` opened so far. Kept as a reset ([`Seen::version`]
    /// `None`), so the next [`record_seen`](Self::record_seen) answers `None` on purpose.
    ///
    /// Also the way back from marks lost (the file gone, or `scid`'s entry): the file is
    /// written again with this reset in it. Only `scid`'s: another identity's mark that went
    /// with the file stays lost until it is reset too.
    pub fn record_seen_reset(&self, scid: &str) -> Result<(), VaultError> {
        self.change_noted(
            SEEN_FILE_NAME,
            true,
            |m| &mut m.seen,
            |seen: &mut Vec<Seen>, _: &[String]| {
                match seen.iter_mut().find(|s| s.scid == scid) {
                    Some(mark) => mark.version = None,
                    None => seen.push(Seen {
                        scid: scid.to_string(),
                        version: None,
                    }),
                }
                Ok(())
            },
        )
    }

    /// The custody note of device `key_id` for `scid` ([`Vault::custody_note`]); `None` when it
    /// has none. Read under the folder's lock. A notes' file this folder wrote and lost is an
    /// error, never `None`: a release would read as never made, a receipt as never owed.
    ///
    /// [`Vault::custody_note`]: ad4m_identity_client::Vault::custody_note
    pub fn custody_note(
        &self,
        scid: &str,
        key_id: &str,
    ) -> Result<Option<CustodyNote>, VaultError> {
        let notes = match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let _shared = lock_folder(dir, false)?;
                read_notes(dir)?
            }
            PendingIncepts::Memory(lists) => lists
                .lock()
                .map_err(|_| unavailable("lock poisoned"))?
                .notes
                .clone(),
        };
        notes
            .into_iter()
            .find(|n| n.scid == scid && n.key_id == key_id)
            .map(|n| serde_json::from_value(n.note).map_err(unavailable))
            .transpose()
    }

    /// Sets the custody note of device `key_id` for `scid` to `note` (`None` clears it) only
    /// while the kept one is still `expected` (`None`: none kept), and answers whether it was
    /// set ([`Vault::swap_custody_note`]). One read-compare-write under the folder's lock, the
    /// one every app on this computer takes for the vault's writes. The compare is on the whole
    /// note as JSON values, every layer included. Durable when it answers `true`: the file is
    /// written whole through a temp file and synced, its rename too.
    ///
    /// [`Vault::swap_custody_note`]: ad4m_identity_client::Vault::swap_custody_note
    pub fn swap_custody_note(
        &self,
        scid: &str,
        key_id: &str,
        expected: Option<&CustodyNote>,
        note: Option<&CustodyNote>,
    ) -> Result<bool, VaultError> {
        let expected = expected
            .map(serde_json::to_value)
            .transpose()
            .map_err(unavailable)?;
        let note = note
            .map(serde_json::to_value)
            .transpose()
            .map_err(unavailable)?;
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let _exclusive = lock_folder(dir, true)?;
                let mut notes = read_notes(dir)?;
                match swap_note(&mut notes, scid, key_id, expected.as_ref(), note) {
                    Swap::Refused => Ok(false),
                    Swap::Unchanged => Ok(true),
                    Swap::Changed => {
                        // The file only: the folder never reads per-identity entries of it,
                        // since a note cleared leaves on purpose.
                        write_noted(
                            dir,
                            NOTES_FILE_NAME,
                            &[],
                            &Notes {
                                version: FORMAT,
                                notes,
                            },
                        )?;
                        Ok(true)
                    }
                }
            }
            PendingIncepts::Memory(lists) => {
                let mut lists = lists.lock().map_err(|_| unavailable("lock poisoned"))?;
                Ok(!matches!(
                    swap_note(&mut lists.notes, scid, key_id, expected.as_ref(), note),
                    Swap::Refused
                ))
            }
        }
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

    /// [`change`](Self::change) for the record marks, a file that must not go missing
    /// ([`read_noted`]): a lost one is an error (or, `recovering`, started again with nothing
    /// in it), and the file is kept even when the list empties. `edit` is given the identities
    /// the folder noted as marked, so it can tell a lost entry from one never made.
    fn change_noted<R>(
        &self,
        file: &str,
        recovering: bool,
        memory: impl FnOnce(&mut Lists) -> &mut Vec<Seen>,
        edit: impl FnOnce(&mut Vec<Seen>, &[String]) -> Result<R, VaultError>,
    ) -> Result<R, VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let _exclusive = lock_folder(dir, true)?;
                let (mut items, noted) = match read_noted(dir, file)? {
                    Noted::Read(items, noted) => (items, noted),
                    Noted::Never => (Vec::new(), Vec::new()),
                    Noted::Lost(noted) if recovering => (Vec::new(), noted),
                    Noted::Lost(_) => return Err(lost_file(file)),
                };
                let answer = edit(&mut items, &noted)?;
                let scids: Vec<String> = items.iter().map(|s| s.scid.clone()).collect();
                write_noted(dir, file, &scids, &items)?;
                Ok(answer)
            }
            PendingIncepts::Memory(lists) => {
                let mut lists = lists.lock().map_err(|_| unavailable("lock poisoned"))?;
                let items = memory(&mut lists);
                let noted: Vec<String> = items.iter().map(|s| s.scid.clone()).collect();
                edit(items, &noted)
            }
        }
    }
}

/// What [`swap_note`] did.
enum Swap {
    /// The kept note is not the one expected: nothing changed.
    Refused,
    /// Expected, and already the note asked for (none kept, none asked): nothing to write.
    Unchanged,
    Changed,
}

/// The compare-and-swap of [`PendingIncepts::swap_custody_note`] on the notes as read under
/// the lock: `note` replaces the note of (`scid`, `key_id`) only while it is `expected`.
fn swap_note(
    notes: &mut Vec<Note>,
    scid: &str,
    key_id: &str,
    expected: Option<&serde_json::Value>,
    note: Option<serde_json::Value>,
) -> Swap {
    let at = notes
        .iter()
        .position(|n| n.scid == scid && n.key_id == key_id);
    if !same_note(at.map(|i| &notes[i].note), expected) {
        return Swap::Refused;
    }
    match (at, note) {
        (None, None) => return Swap::Unchanged,
        (Some(i), Some(note)) => notes[i].note = note,
        (Some(i), None) => {
            notes.remove(i);
        }
        (None, Some(note)) => notes.push(Note {
            scid: scid.to_string(),
            key_id: key_id.to_string(),
            note,
        }),
    }
    Swap::Changed
}

/// Whether the kept note is the one expected: the whole JSON value, every layer below the top
/// included, never the top layer alone (two notes may share their top and differ beneath).
fn same_note(kept: Option<&serde_json::Value>, expected: Option<&serde_json::Value>) -> bool {
    kept == expected
}

/// The custody notes, read under the folder's lock: none when the file was never written; a
/// file written and gone is an error ([`read_noted`]).
fn read_notes(dir: &std::path::Path) -> Result<Vec<Note>, VaultError> {
    match read_noted::<Notes>(dir, NOTES_FILE_NAME)? {
        Noted::Read(file, _) if file.version == FORMAT => Ok(file.notes),
        Noted::Read(file, _) => Err(unavailable(format!(
            "{NOTES_FILE_NAME} in format {}, not {FORMAT}",
            file.version
        ))),
        Noted::Never => Ok(Vec::new()),
        Noted::Lost(_) => Err(lost_file(NOTES_FILE_NAME)),
    }
}

/// `file`, one that must not go missing once written: [`Noted::Lost`] when the folder's
/// metadata says it was written and it is not there. With it, the identities the metadata notes
/// as having an entry in it. Read under the folder's lock; metadata that cannot be read is an
/// error either way.
fn read_noted<T: DeserializeOwned>(
    dir: &std::path::Path,
    file: &str,
) -> Result<Noted<T>, VaultError> {
    let noted = metadata(dir)?;
    let entries = noted.entries.get(file).cloned().unwrap_or_default();
    match std::fs::read(dir.join(file)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(|value| Noted::Read(value, entries))
            .map_err(unavailable),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if noted.written.iter().any(|f| f == file) {
                Ok(Noted::Lost(entries))
            } else {
                Ok(Noted::Never)
            }
        }
        Err(e) => Err(unavailable(e)),
    }
}

/// Writes `file`, one that must not go missing, holding entries for `scids`, then notes the file
/// and each identity in the folder's metadata: the file and its entries first, durable, the note
/// second. A crash between the two leaves an entry that is there and not yet noted, which reads
/// as it is and is noted with the next change; the other way round (note first) a crash left an
/// identity noted with no entry, a loss with no way back in a first restore on a computer not
/// linked yet. What the note buys is the detection of a loss *after* it exists: a file or entry
/// that was noted and is gone. The metadata a file that predates it never had is written with
/// the file's next change. A noted identity is never dropped from the metadata.
fn write_noted<T: Serialize + ?Sized>(
    dir: &std::path::Path,
    file: &str,
    scids: &[String],
    value: &T,
) -> Result<(), VaultError> {
    let mut noted = metadata(dir)?;
    write_bytes(dir, file, &serde_json::to_vec(value).map_err(unavailable)?)?;
    let mut changed = false;
    if !noted.written.iter().any(|f| f == file) {
        noted.written.push(file.to_string());
        changed = true;
    }
    let entries = noted.entries.entry(file.to_string()).or_default();
    for scid in scids {
        if !entries.contains(scid) {
            entries.push(scid.clone());
            changed = true;
        }
    }
    if changed {
        noted.version = FORMAT;
        write_bytes(
            dir,
            METADATA_FILE_NAME,
            &serde_json::to_vec(&noted).map_err(unavailable)?,
        )?;
    }
    Ok(())
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

    /// Lal's P2 at 564d9aaa0. `write_noted` made the metadata note durable before the entry,
    /// so a crash between the two in an identity's first `establish_epoch` (a first restore on
    /// a computer not linked yet) left the identity noted with no entry: lost, and the way back
    /// it names, "Replace my master key", refuses on a computer that is not linked. With the
    /// entry written first, that crash leaves nothing of the identity: a fresh start, and the
    /// restore goes on. Here the epochs file's write fails once, after whatever is written
    /// before it: its temp name is taken by a directory.
    #[test]
    fn a_crash_between_an_identitys_first_entry_and_its_note_is_a_fresh_start_not_a_loss() {
        let dir = tempfile::tempdir().unwrap();
        let folder = PendingIncepts::file(dir.path().to_path_buf());
        let blocked = dir
            .path()
            .join(format!("{EPOCHS_FILE_NAME}.{}.tmp", std::process::id()));
        std::fs::create_dir_all(&blocked).unwrap();
        assert!(folder.exclusive().unwrap().establish_epoch("QmB").is_err());
        std::fs::remove_dir_all(&blocked).unwrap();

        let epoch = folder.exclusive().unwrap().epoch("QmB");
        assert!(
            matches!(epoch, Ok(0)),
            "after the crash the identity reads {epoch:?}, not as never made"
        );
        let established = folder.exclusive().unwrap().establish_epoch("QmB").unwrap();
        assert_eq!(
            folder.exclusive().unwrap().epoch("QmB").unwrap(),
            established
        );
    }
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

    /// Makes the next write of `file` in `dir` fail, as a crash before it would leave the
    /// folder: its temp name taken by a directory. Undone by the guard's drop.
    struct Blocked(std::path::PathBuf);

    impl Blocked {
        fn write_of(dir: &std::path::Path, file: &str) -> Self {
            let path = dir.join(format!("{file}.{}.tmp", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Blocked(path)
        }
    }

    impl Drop for Blocked {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    /// What the metadata notes as having an entry in the epochs' file.
    fn noted_epochs(dir: &std::path::Path) -> Vec<String> {
        metadata(dir)
            .unwrap()
            .entries
            .get(EPOCHS_FILE_NAME)
            .cloned()
            .unwrap_or_default()
    }

    /// Lal's P2 at 564d9aaa0, the other stop: an identity's first epoch written, the process
    /// gone before its note. The entry is there and read as it is, never as lost; the next
    /// change notes it, and from then on its loss is told apart. In a folder that never counted
    /// an epoch, and beside another identity's.
    #[test]
    fn a_crash_after_an_identitys_first_entry_before_its_note_reads_the_entry() {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingIncepts::file(dir.path());
        {
            let _crash = Blocked::write_of(dir.path(), METADATA_FILE_NAME);
            assert!(pending.exclusive().unwrap().establish_epoch("QmA").is_err());
        }
        assert!(dir.path().join(EPOCHS_FILE_NAME).exists());
        assert!(noted_epochs(dir.path()).is_empty());
        // The next start.
        let pending = PendingIncepts::file(dir.path());
        let read = pending.exclusive().unwrap().epoch("QmA");
        assert!(matches!(read, Ok(e) if e != 0), "{read:?}");
        let read = read.unwrap();
        assert_eq!(
            pending.exclusive().unwrap().establish_epoch("QmA").unwrap(),
            read
        );
        assert_eq!(
            pending.exclusive().unwrap().bump_epoch("QmA").unwrap(),
            read + 1
        );
        assert_eq!(noted_epochs(dir.path()), ["QmA"]);

        // A second identity, beside the first.
        {
            let _crash = Blocked::write_of(dir.path(), METADATA_FILE_NAME);
            assert!(pending.exclusive().unwrap().establish_epoch("QmB").is_err());
        }
        let pending = PendingIncepts::file(dir.path());
        let folder = pending.exclusive().unwrap();
        assert_eq!(folder.epoch("QmA").unwrap(), read + 1);
        assert!(matches!(folder.epoch("QmB"), Ok(e) if e != 0));
        drop(folder);
        // Noted, a loss of the file is a loss for both.
        pending.exclusive().unwrap().bump_epoch("QmB").unwrap();
        assert_eq!(noted_epochs(dir.path()), ["QmA", "QmB"]);
        std::fs::remove_file(dir.path().join(EPOCHS_FILE_NAME)).unwrap();
        let folder = pending.exclusive().unwrap();
        assert!(folder.epoch("QmA").as_ref().is_err_and(is_lost_epoch));
        assert!(folder.epoch("QmB").as_ref().is_err_and(is_lost_epoch));
    }

    /// A change of an entry that is there, stopped before it is written, leaves the entry it
    /// had: the next change counts on from it.
    #[test]
    fn a_bump_stopped_before_its_write_leaves_the_entry_it_had() {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingIncepts::file(dir.path());
        let first = pending.exclusive().unwrap().establish_epoch("QmA").unwrap();
        {
            let _crash = Blocked::write_of(dir.path(), EPOCHS_FILE_NAME);
            assert!(pending.exclusive().unwrap().bump_epoch("QmA").is_err());
        }
        assert_eq!(pending.exclusive().unwrap().epoch("QmA").unwrap(), first);
        assert_eq!(
            pending.exclusive().unwrap().bump_epoch("QmA").unwrap(),
            first + 1
        );
    }

    /// Lal's review of we#431 at 0d4501589: a reset is the way back from a lost marks file, so
    /// it does not fail on the read that lost it. It writes the file again with its reset;
    /// another identity's mark that went with the file is still lost, not a first opening.
    #[test]
    fn a_reset_repairs_a_lost_marks_file_for_its_identity_only() {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingIncepts::file(dir.path());
        pending.record_seen("QmA", 20).unwrap();
        pending.record_seen("QmB", 7).unwrap();
        std::fs::remove_file(dir.path().join(SEEN_FILE_NAME)).unwrap();
        assert!(pending.record_seen("QmA", 10).is_err());

        pending.record_seen_reset("QmA").unwrap();
        assert!(dir.path().join(SEEN_FILE_NAME).exists());
        assert_eq!(pending.record_seen("QmA", 10).unwrap(), None);
        assert_eq!(pending.record_seen("QmA", 9).unwrap(), Some(10));
        let other = pending.record_seen("QmB", 3);
        assert!(other.is_err(), "a lost mark taken as a first: {other:?}");
        pending.record_seen_reset("QmB").unwrap();
        assert_eq!(pending.record_seen("QmB", 3).unwrap(), None);
        // An identity never marked has nothing to lose.
        assert_eq!(pending.record_seen("QmC", 1).unwrap(), None);

        // One entry gone from a file that is there: the same.
        std::fs::write(
            dir.path().join(SEEN_FILE_NAME),
            serde_json::to_vec(&[Seen {
                scid: "QmA".into(),
                version: Some(10),
            }])
            .unwrap(),
        )
        .unwrap();
        assert!(pending.record_seen("QmB", 3).is_err());
        pending.record_seen_reset("QmB").unwrap();
        assert_eq!(pending.record_seen("QmB", 3).unwrap(), None);
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

    /// A note is kept per identity and per device key, whole: every layer comes back after the
    /// folder is opened again, and another device's or identity's note is its own.
    #[test]
    fn a_custody_note_survives_reopening_whole_and_per_device() {
        let dir = tempfile::tempdir().unwrap();
        let note = stacked(receipt(true));
        let folder = PendingIncepts::file(dir.path());
        assert_eq!(folder.custody_note("QmA", "d1").unwrap(), None);
        assert!(folder
            .swap_custody_note("QmA", "d1", None, Some(&note))
            .unwrap());
        drop(folder);

        let folder = PendingIncepts::file(dir.path());
        assert_eq!(
            folder.custody_note("QmA", "d1").unwrap(),
            Some(note.clone())
        );
        assert_eq!(folder.custody_note("QmA", "d2").unwrap(), None);
        assert_eq!(folder.custody_note("QmB", "d1").unwrap(), None);
        // Cleared only from what is there; then none, and the file stays (its loss is a loss).
        assert!(folder
            .swap_custody_note("QmA", "d1", Some(&note), None)
            .unwrap());
        assert_eq!(folder.custody_note("QmA", "d1").unwrap(), None);
        assert!(dir.path().join(NOTES_FILE_NAME).exists());
    }

    /// The compare is on the whole note: an expected note equal to the kept one at the top, and
    /// different only in the deepest layer's receipt, is stale and changes nothing.
    #[test]
    fn a_swap_from_a_note_that_differs_only_in_a_nested_layer_is_refused() {
        for folder in [
            PendingIncepts::memory(),
            PendingIncepts::file(tempfile::tempdir().unwrap().keep()),
        ] {
            let kept = stacked(receipt(true));
            let stale = stacked(receipt(false));
            assert_eq!(kept.token(), stale.token(), "the same top layer");
            assert!(folder
                .swap_custody_note("QmA", "d1", None, Some(&kept))
                .unwrap());
            assert!(!folder
                .swap_custody_note("QmA", "d1", Some(&stale), None)
                .unwrap());
            assert!(!folder
                .swap_custody_note("QmA", "d1", None, Some(&stale))
                .unwrap());
            assert_eq!(
                folder.custody_note("QmA", "d1").unwrap(),
                Some(kept.clone())
            );
            assert!(folder
                .swap_custody_note("QmA", "d1", Some(&kept), Some(&receipt(true)))
                .unwrap());
            assert_eq!(
                folder.custody_note("QmA", "d1").unwrap(),
                Some(receipt(true))
            );
        }
    }

    /// Two handles on one folder (two apps) swapping at once: each swap is one step under the
    /// folder's lock, so of every pair that read the same note one wins, and none is lost.
    #[test]
    fn swaps_from_two_handles_on_one_folder_never_lose_one() {
        let dir = tempfile::tempdir().unwrap();
        let counter = |n: u64| CustodyNote::Released {
            epoch: n,
            token: NoteToken([0; 16]),
            restores: None,
        };
        PendingIncepts::file(dir.path())
            .swap_custody_note("QmA", "d1", None, Some(&counter(0)))
            .unwrap();
        let threads: Vec<_> = (0..2)
            .map(|_| {
                let dir = dir.path().to_path_buf();
                std::thread::spawn(move || {
                    let folder = PendingIncepts::file(dir);
                    let mut won = 0;
                    while won < 20 {
                        let Some(CustodyNote::Released { epoch, .. }) =
                            folder.custody_note("QmA", "d1").unwrap()
                        else {
                            panic!("the counter's note is gone");
                        };
                        if folder
                            .swap_custody_note(
                                "QmA",
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
            PendingIncepts::file(dir.path())
                .custody_note("QmA", "d1")
                .unwrap(),
            Some(counter(40))
        );
    }

    /// The notes' file, once written, must not go missing: gone, it is an error, never "no
    /// note" (a release taken back, a receipt forgotten).
    #[test]
    fn a_lost_notes_file_is_an_error_not_no_note() {
        let dir = tempfile::tempdir().unwrap();
        let folder = PendingIncepts::file(dir.path());
        folder
            .swap_custody_note("QmA", "d1", None, Some(&receipt(true)))
            .unwrap();
        std::fs::remove_file(dir.path().join(NOTES_FILE_NAME)).unwrap();
        assert!(folder.custody_note("QmA", "d1").is_err());
        assert!(folder
            .swap_custody_note("QmA", "d1", None, Some(&receipt(true)))
            .is_err());
    }
}
