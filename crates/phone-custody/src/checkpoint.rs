//! The head each identity's log was last admitted at, kept across restarts.
//!
//! `ViaStore` measures every log it reads against the `(seq, hash)` it last admitted for that
//! identity: a log under it is `409 store-behind`, one beside it `409 fork`. Its default keeps
//! that in memory, and the phone builds a `ViaStore` per call, so without this file a store could
//! serve an older log at the next call, or after a restart. [`FileCheckpoints`] keeps them in
//! `log-checkpoints.json` beside the key file, in the app's `no_backup` directory: public (a
//! sequence number and an event hash), but a file a backup restored over, or one that went back,
//! would let a store roll the phone back, so it is never backed up and only ever written whole.
//!
//! It fails closed: a file that cannot be read, does not parse, or cannot be written is a
//! [`CheckpointFileError`] from [`FileCheckpoints::load`], [`FileCheckpoints::store`] and
//! [`FileCheckpoints::drop_scid`], never a silent "none" a store could roll the phone back
//! through. And a file that was written and is *gone* is the same: the folder notes in
//! `log-checkpoints.meta.json` that checkpoints were initialized and which identities they were
//! kept for, so a missing file after initialization — or a noted identity's missing entry — is
//! a loss, not a first run. A checkpoint written whose note never landed (the process ended
//! between the entry and its note) is noted under the lock by the next read or write that
//! relies on it. Only a genuine first use, or an explicit reset
//! (`identity.resetLog`, [`FileCheckpoints::drop_scid`]), starts a new baseline.
//!
//! And one admission at a time per identity, process-wide: `ViaStore::admitted` is get the
//! checkpoint → check the candidate log against it → set the head it admitted, and the phone
//! runs calls in parallel, each with its own `ViaStore` — and so its own `FileCheckpoints`.
//! Two that both pass the check against one checkpoint must not each keep a divergent head, so
//! [`LogCheckpoints::get`] takes the identity's **slot** (a wait-free `Mutex`+`Condvar` per
//! SCID) and the port holds it until its `set`/`forget`, another `get`, or its own drop: the
//! second admission's get answers the head the first kept, and its check then fails the way it
//! would sequentially. `set` also refuses a checkpoint at a seq already admitted under a
//! different hash — a divergent head is a fork, never written. (A compare-and-set
//! `LogCheckpoints` port in ad4m is the general shape of this fix; the slot is the phone's.)
//!
//! [`LogCheckpoints`] passes each error on as a `CheckpointError`, and `ViaStore` then fails the
//! read closed (`503`) rather than admit a log it has nothing to measure against.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};

use ad4m_identity_client::{Checkpoint, CheckpointError, LogCheckpoints};
use serde::{Deserialize, Serialize};

use crate::file::write_atomic;

pub const FILE_NAME: &str = "log-checkpoints.json";
/// What the folder noted about the checkpoints: that they were initialized, and for whom.
const MARKER_FILE_NAME: &str = "log-checkpoints.meta.json";
/// How long an admission waits for another admission of the same identity. An admission that
/// failed its check never calls `set`, and its port may live for minutes; past this wait the
/// next one fails closed (retryable) instead of blocking.
#[cfg(not(test))]
const ADMISSION_WAIT: std::time::Duration = std::time::Duration::from_secs(30);
#[cfg(test)]
const ADMISSION_WAIT: std::time::Duration = std::time::Duration::from_secs(1);

/// One lock for every read-modify-write of the file: the app runs calls on several threads, each
/// with its own `ViaStore` over the same file.
static LOCK: Mutex<()> = Mutex::new(());

/// One admission per identity, process-wide: `get` holds `scid`'s slot until `set`/`forget`,
/// another `get`, or the port drops, so a concurrent admission checks against the head the one
/// in flight kept — never the stale one it read beside it.
static SLOTS: Mutex<BTreeMap<String, Arc<Slot>>> = Mutex::new(BTreeMap::new());

struct Slot {
    busy: Mutex<bool>,
    free: Condvar,
}

fn slot(scid: &str) -> Arc<Slot> {
    let mut slots = SLOTS.lock().unwrap_or_else(|p| p.into_inner());
    slots
        .entry(scid.to_string())
        .or_insert_with(|| {
            Arc::new(Slot {
                busy: Mutex::new(false),
                free: Condvar::new(),
            })
        })
        .clone()
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CheckpointFile {
    /// `1`.
    v: u8,
    /// By SCID.
    logs: BTreeMap<String, Checkpoint>,
}

/// What the folder noted the checkpoints have held (`log-checkpoints.meta.json`): that they
/// were initialized, and the identities a checkpoint was kept for. Written after the file that
/// earns the note, as the vault's marker is.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    /// `1`.
    v: u8,
    /// Checkpoints were written in this folder: gone, the file is a loss, not a fresh start.
    #[serde(default)]
    written: bool,
    /// The identities a checkpoint was kept for: an entry missing for one of them is a loss;
    /// `identity.resetLog` un-notes its identity.
    #[serde(default)]
    logs: Vec<String>,
}

impl Marker {
    fn fresh() -> Marker {
        Marker {
            v: 1,
            ..Marker::default()
        }
    }
}

/// [`LogCheckpoints`] in `log-checkpoints.json` in `dir`.
pub(crate) struct FileCheckpoints {
    dir: PathBuf,
    path: PathBuf,
    /// The admission slot this port holds between `get` and `set`/`forget` — or its drop — so
    /// this caller's get → check → set is one transaction against every other caller's.
    held: Mutex<Option<(String, Arc<Slot>)>>,
}

impl FileCheckpoints {
    pub(crate) fn new(dir: &Path) -> Self {
        FileCheckpoints {
            dir: dir.to_path_buf(),
            path: dir.join(FILE_NAME),
            held: Mutex::new(None),
        }
    }

    /// Takes `scid`'s admission slot, releasing the one already held: at most one per port.
    /// Waits out an admission of `scid` in flight in another port.
    fn acquire(&self, scid: &str) -> Result<(), CheckpointFileError> {
        let slot = slot(scid);
        let mut held = self.held.lock().unwrap_or_else(|p| p.into_inner());
        Self::release_locked(&mut held);
        let deadline = std::time::Instant::now() + ADMISSION_WAIT;
        let mut busy = slot.busy.lock().unwrap_or_else(|p| p.into_inner());
        while *busy {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                return Err(CheckpointFileError::Busy);
            }
            busy = slot
                .free
                .wait_timeout(busy, left)
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
        *busy = true;
        drop(busy);
        *held = Some((scid.to_string(), slot));
        Ok(())
    }

    /// Ends the admission in flight, if any: a later `get` in another port goes on.
    fn release(&self) {
        let mut held = self.held.lock().unwrap_or_else(|p| p.into_inner());
        Self::release_locked(&mut held);
    }

    fn release_locked(held: &mut Option<(String, Arc<Slot>)>) {
        if let Some((_, slot)) = held.take() {
            *slot.busy.lock().unwrap_or_else(|p| p.into_inner()) = false;
            slot.free.notify_one();
        }
    }

    /// What the folder noted about the checkpoints: none when it never wrote a marker;
    /// unreadable is an error either way.
    fn marker(&self) -> Result<Marker, CheckpointFileError> {
        match std::fs::read(self.dir.join(MARKER_FILE_NAME)) {
            Ok(bytes) => {
                let marker: Marker = serde_json::from_slice(&bytes)
                    .map_err(|e| CheckpointFileError::Damaged(e.to_string()))?;
                if marker.v != 1 {
                    return Err(CheckpointFileError::Damaged(format!(
                        "version {}",
                        marker.v
                    )));
                }
                Ok(marker)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Marker::fresh()),
            Err(e) => Err(CheckpointFileError::Read(e.to_string())),
        }
    }

    /// The file, the folder's note, and whether the file is there. A file that was never
    /// written is an empty one — or, the note says it was initialized and it is gone, a loss:
    /// an error, never an empty start, unless `recovering` (an explicit reset) reads it
    /// fresh. One that does not parse is damaged: every write is whole, so it is not one this
    /// app left.
    fn read(
        &self,
        recovering: bool,
    ) -> Result<(CheckpointFile, Marker, bool), CheckpointFileError> {
        let marker = self.marker()?;
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if marker.written && !recovering {
                    return Err(CheckpointFileError::Lost);
                }
                return Ok((
                    CheckpointFile {
                        v: 1,
                        logs: BTreeMap::new(),
                    },
                    marker,
                    false,
                ));
            }
            Err(e) => return Err(CheckpointFileError::Read(e.to_string())),
        };
        let file: CheckpointFile = serde_json::from_slice(&bytes)
            .map_err(|e| CheckpointFileError::Damaged(e.to_string()))?;
        if file.v != 1 {
            return Err(CheckpointFileError::Damaged(format!("version {}", file.v)));
        }
        Ok((file, marker, true))
    }

    fn write(&self, file: &CheckpointFile) -> Result<(), CheckpointFileError> {
        let bytes = serde_json::to_vec_pretty(file).expect("the checkpoints serialise");
        write_atomic(&self.path, &bytes).map_err(|e| CheckpointFileError::Write(e.to_string()))
    }

    fn write_marker(&self, marker: &Marker) -> Result<(), CheckpointFileError> {
        let bytes = serde_json::to_vec_pretty(marker).expect("the checkpoint marker serialises");
        write_atomic(&self.dir.join(MARKER_FILE_NAME), &bytes)
            .map_err(|e| CheckpointFileError::Write(e.to_string()))
    }

    /// Notes what `file` holds — that checkpoints were initialized, and each identity with an
    /// entry — after the file's write, so the note only ever covers what exists. `changed` is
    /// a change the caller already made to `marker` that must be persisted too (a reset's
    /// un-noting, which `note` itself never makes: a noted identity is never dropped but by
    /// reset). Written only when it changed.
    fn note(
        &self,
        changed: bool,
        marker: &mut Marker,
        file: &CheckpointFile,
    ) -> Result<(), CheckpointFileError> {
        let mut changed = changed || !marker.written;
        marker.written = true;
        for scid in file.logs.keys() {
            if !marker.logs.contains(scid) {
                marker.logs.push(scid.clone());
                changed = true;
            }
        }
        if changed {
            self.write_marker(marker)?;
        }
        Ok(())
    }

    /// The checkpoint kept for `scid`: `None` before the first. An entry the folder noted and
    /// that is gone was lost: an error, never a fresh baseline a store could roll the phone
    /// back through.
    pub(crate) fn load(&self, scid: &str) -> Result<Option<Checkpoint>, CheckpointFileError> {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (file, mut marker, present) = self.read(false)?;
        if present {
            // An entry written whose note never landed (the process ended between the two)
            // is noted before this read relies on it: a loss after the success must read as
            // a loss, never a first use. Only ever adds — a noted-but-missing entry stays.
            self.note(false, &mut marker, &file)?;
        }
        match file.logs.get(scid) {
            Some(kept) => Ok(Some(kept.clone())),
            None if marker.logs.iter().any(|s| s == scid) => {
                Err(CheckpointFileError::LostEntry(scid.to_string()))
            }
            None => Ok(None),
        }
    }

    /// Keeps `checkpoint` for `scid`. Never back, and never beside: a checkpoint at a seq
    /// already admitted under another hash is a fork — refused, since two admissions cannot
    /// both be kept at one seq. A higher head stands; [`Self::drop_scid`] is the only way
    /// down. A lost entry is not quietly rewritten.
    pub(crate) fn store(
        &self,
        scid: &str,
        checkpoint: Checkpoint,
    ) -> Result<(), CheckpointFileError> {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (mut file, mut marker, present) = self.read(false)?;
        // As in `load`: every entry the file already has is noted before an equal retry (or
        // a fork refused against it) relies on it.
        if present {
            self.note(false, &mut marker, &file)?;
        }
        match file.logs.get(scid) {
            Some(kept) if *kept == checkpoint || kept.seq > checkpoint.seq => return Ok(()),
            Some(kept) if kept.seq == checkpoint.seq => {
                return Err(CheckpointFileError::Fork(checkpoint.seq));
            }
            Some(_) => {}
            None if marker.logs.iter().any(|s| s == scid) => {
                return Err(CheckpointFileError::LostEntry(scid.to_string()));
            }
            None => {}
        }
        file.logs.insert(scid.to_string(), checkpoint);
        self.write(&file)?;
        self.note(false, &mut marker, &file)
    }

    /// `identity.resetLog`: forgets `scid`'s checkpoint — and un-notes it, so a baseline is
    /// made for it again. Also the way back from a lost file or entry: the file is written
    /// again, another identity's checkpoint that went with it stays lost until it is reset
    /// too.
    pub(crate) fn drop_scid(&self, scid: &str) -> Result<(), CheckpointFileError> {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (mut file, mut marker, present) = self.read(true)?;
        let missing = !present;
        let removed = file.logs.remove(scid).is_some();
        if removed || missing {
            self.write(&file)?;
        }
        let noted = marker.logs.len();
        marker.logs.retain(|s| s != scid);
        self.note(marker.logs.len() != noted, &mut marker, &file)
    }
}

impl Drop for FileCheckpoints {
    /// The admission the port held ends with it.
    fn drop(&mut self) {
        self.release();
    }
}

/// Why the checkpoint file gave no answer. None of these is "no checkpoint".
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum CheckpointFileError {
    #[error("the log checkpoints could not be read: {0}")]
    Read(String),
    /// Another admission of the identity held its checkpoint past [`ADMISSION_WAIT`].
    #[error("another read of this identity's log is in progress; try again")]
    Busy,
    #[error("the log checkpoints file is damaged: {0}")]
    Damaged(String),
    #[error("the log checkpoints could not be written: {0}")]
    Write(String),
    /// `log-checkpoints.json` was written in this folder and is gone.
    #[error(
        "the log checkpoints were written here and are gone; they are not started again empty"
    )]
    Lost,
    /// A checkpoint for the identity was written in this folder and is gone from the file.
    #[error(
        "the log checkpoint of {0} was written here and is gone; only a reset starts it again"
    )]
    LostEntry(String),
    /// A checkpoint at a seq already admitted, under another hash: a fork, never written.
    #[error("a different log checkpoint at seq {0} was admitted already; that is a fork")]
    Fork(u64),
}

impl From<CheckpointFileError> for CheckpointError {
    fn from(e: CheckpointFileError) -> Self {
        CheckpointError(e.to_string())
    }
}

impl LogCheckpoints for FileCheckpoints {
    /// The checkpoint `ViaStore` measures the candidate log against. Takes the identity's
    /// admission slot: the get → check → set that follows in this call is one transaction
    /// against every other call's.
    fn get(&self, scid: &str) -> Result<Option<Checkpoint>, CheckpointError> {
        self.acquire(scid)?;
        // A read that fails ends the admission here: it will not reach `set`.
        let loaded = self.load(scid);
        if loaded.is_err() {
            self.release();
        }
        Ok(loaded?)
    }

    /// The head this admission kept; releases the identity's slot, the check done.
    fn set(&self, scid: &str, checkpoint: Checkpoint) -> Result<(), CheckpointError> {
        let result = self.store(scid, checkpoint);
        self.release();
        Ok(result?)
    }

    /// `identity.resetLog`; releases the identity's slot too.
    fn forget(&self, scid: &str) -> Result<(), CheckpointError> {
        let result = self.drop_scid(scid);
        self.release();
        Ok(result?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(seq: u64, hash: &str) -> Checkpoint {
        Checkpoint {
            seq,
            hash: hash.to_string(),
        }
    }

    #[test]
    fn a_checkpoint_outlives_the_port_that_wrote_it() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(FileCheckpoints::new(dir.path()).get("a").unwrap(), None);
        FileCheckpoints::new(dir.path())
            .set("a", at(3, "h3"))
            .unwrap();
        FileCheckpoints::new(dir.path())
            .set("b", at(1, "b1"))
            .unwrap();
        assert_eq!(
            FileCheckpoints::new(dir.path()).get("a").unwrap(),
            Some(at(3, "h3"))
        );
        assert_eq!(
            FileCheckpoints::new(dir.path()).get("b").unwrap(),
            Some(at(1, "b1"))
        );
        assert!(!dir.path().join("log-checkpoints.json.tmp").exists());
    }

    #[test]
    fn a_checkpoint_goes_forward_and_only_forget_takes_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let port = FileCheckpoints::new(dir.path());
        port.set("a", at(5, "h5")).unwrap();
        port.set("a", at(4, "h4")).unwrap();
        assert_eq!(port.get("a").unwrap(), Some(at(5, "h5")));
        // The same seq with another hash is a fork, never written: the port refuses it rather
        // than keep the second of two divergent heads. Only a forget starts over.
        assert!(port.set("a", at(5, "h5b")).is_err());
        assert_eq!(port.get("a").unwrap(), Some(at(5, "h5")));
        port.set("a", at(6, "h6")).unwrap();
        assert_eq!(port.get("a").unwrap(), Some(at(6, "h6")));
        port.forget("a").unwrap();
        assert_eq!(port.get("a").unwrap(), None);
        port.set("a", at(2, "h2")).unwrap();
        assert_eq!(port.get("a").unwrap(), Some(at(2, "h2")));
    }

    // Two ports on one folder, as two parallel calls each have their own ViaStore: one
    // identity's admission — get, check the candidate against the head, set — is one
    // transaction, so a get that read the same checkpoint waits for the admission in flight,
    // sees the head it kept, and a divergent head at a seq already admitted is refused.
    #[test]
    fn two_admissions_of_divergent_heads_one_wins() {
        let dir = tempfile::tempdir().unwrap();
        let a = FileCheckpoints::new(dir.path());
        let b = FileCheckpoints::new(dir.path());
        a.set("s", at(3, "h3")).unwrap();
        // A begins an admission; B's get waits for it rather than read the same checkpoint
        // and write its divergent branch beside it.
        assert_eq!(a.get("s").unwrap(), Some(at(3, "h3")));
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                let got = b.get("s").unwrap();
                tx.send(got).unwrap();
            });
            assert!(rx
                .recv_timeout(std::time::Duration::from_millis(200))
                .is_err());
            a.set("s", at(4, "hA")).unwrap();
            assert_eq!(
                rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap(),
                Some(at(4, "hA"))
            );
        });
        // A divergent head at a seq already admitted is refused outright.
        assert!(b.set("s", at(4, "hB")).is_err());
        assert_eq!(b.get("s").unwrap(), Some(at(4, "hA")));
    }

    // An admission that read the checkpoint and then failed (the store was behind, or served a
    // fork) never calls `set`, and its port can live for minutes (a holder's link). Another
    // admission of the identity waits for it at most `ADMISSION_WAIT`, then fails closed and
    // can be retried, rather than block until that port is dropped.
    #[test]
    fn an_admission_left_open_does_not_block_the_next_one_for_ever() {
        let dir = tempfile::tempdir().unwrap();
        let a = FileCheckpoints::new(dir.path());
        let b = FileCheckpoints::new(dir.path());
        // Its own scid: the slots are process-wide and tests run in parallel.
        a.set("left-open", at(3, "h3")).unwrap();
        assert_eq!(a.get("left-open").unwrap(), Some(at(3, "h3"))); // and never set: a failed check
        let started = std::time::Instant::now();
        assert!(b.get("left-open").is_err());
        assert!(started.elapsed() < ADMISSION_WAIT * 3);
        // Once A's port moves on, B admits again.
        drop(a);
        assert_eq!(b.get("left-open").unwrap(), Some(at(3, "h3")));
    }

    // A get whose read fails gives the slot back: a damaged file must not also block the
    // identity's next admission.
    #[test]
    fn a_get_that_fails_to_read_leaves_the_slot_free() {
        let dir = tempfile::tempdir().unwrap();
        let a = FileCheckpoints::new(dir.path());
        let b = FileCheckpoints::new(dir.path());
        a.set("read-fails", at(3, "h3")).unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"not json").unwrap();
        assert!(a.get("read-fails").is_err());
        let started = std::time::Instant::now();
        assert!(b.get("read-fails").is_err()); // still damaged, but not after waiting for A
        assert!(started.elapsed() < ADMISSION_WAIT);
    }

    // A file written and lost is an error, not a fresh start: the folder notes that
    // checkpoints were initialized (in `log-checkpoints.meta.json`) and which identities they
    // were kept for. Only an explicit reset (`identity.resetLog`, `drop_scid`) starts a new
    // baseline — per identity, so another identity's lost head stays lost until it is reset.
    #[test]
    fn a_checkpoint_file_written_and_lost_is_an_error_until_reset() {
        let dir = tempfile::tempdir().unwrap();
        let port = FileCheckpoints::new(dir.path());
        port.set("a", at(5, "h5")).unwrap();
        port.set("b", at(2, "h2")).unwrap();
        std::fs::remove_file(dir.path().join(FILE_NAME)).unwrap();
        assert!(matches!(port.load("a"), Err(CheckpointFileError::Lost)));
        assert!(matches!(
            port.store("a", at(1, "h1")),
            Err(CheckpointFileError::Lost)
        ));
        port.drop_scid("a").unwrap();
        assert_eq!(port.load("a").unwrap(), None);
        // The other identity's head went with the file: it stays lost until its own reset.
        assert!(matches!(
            port.load("b"),
            Err(CheckpointFileError::LostEntry(_))
        ));
        port.drop_scid("b").unwrap();
        assert_eq!(port.load("b").unwrap(), None);
        port.set("b", at(2, "h2")).unwrap();
        assert_eq!(port.load("b").unwrap(), Some(at(2, "h2")));
    }

    // A checkpoint written whose note never landed — the process ended between the entry and
    // its note — is reconciled under the lock before the next read or equal retry relies on
    // it: noted durably first, so its loss after that success is an error, never a first use.
    // Without the reconcile, the equal retry returns `Ok` leaving the note unwritten, and a
    // later loss reads as `None` — a fresh baseline a store could roll the phone back through.
    #[test]
    fn an_interrupted_write_is_noted_by_the_retry_or_read_that_relies_on_it() {
        let dir = tempfile::tempdir().unwrap();
        let port = FileCheckpoints::new(dir.path());
        port.set("crash", at(3, "h3")).unwrap();
        // The interruption: the checkpoint stands, its note is gone.
        std::fs::remove_file(dir.path().join(MARKER_FILE_NAME)).unwrap();
        // The equal retry succeeds — and completes the note it relied on.
        port.store("crash", at(3, "h3")).unwrap();
        std::fs::remove_file(dir.path().join(FILE_NAME)).unwrap();
        assert!(matches!(port.load("crash"), Err(CheckpointFileError::Lost)));

        // The same on a read: `load` notes the present-but-unnoted entry before answering.
        port.drop_scid("crash").unwrap();
        port.set("read", at(2, "h2")).unwrap();
        std::fs::remove_file(dir.path().join(MARKER_FILE_NAME)).unwrap();
        assert_eq!(port.load("read").unwrap(), Some(at(2, "h2")));
        std::fs::remove_file(dir.path().join(FILE_NAME)).unwrap();
        assert!(matches!(port.load("read"), Err(CheckpointFileError::Lost)));
    }

    #[test]
    fn the_file_is_written_whole_in_its_one_shape() {
        let dir = tempfile::tempdir().unwrap();
        FileCheckpoints::new(dir.path())
            .set("a", at(1, "h1"))
            .unwrap();
        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(FILE_NAME)).unwrap()).unwrap();
        assert_eq!(
            written,
            serde_json::json!({ "v": 1, "logs": { "a": { "seq": 1, "hash": "h1" } } })
        );
    }

    // Only a missing file is "none": a damaged one is an error, and is not written over.
    #[test]
    fn a_file_that_does_not_read_is_an_error_and_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let port = FileCheckpoints::new(dir.path());
        for damaged in [&b"{not json"[..], br#"{"v":2,"logs":{}}"#, br#"{"v":1}"#] {
            std::fs::write(&path, damaged).unwrap();
            assert!(matches!(
                port.load("a"),
                Err(CheckpointFileError::Damaged(_))
            ));
            assert!(matches!(
                port.store("a", at(1, "h1")),
                Err(CheckpointFileError::Damaged(_))
            ));
            assert!(matches!(
                port.drop_scid("a"),
                Err(CheckpointFileError::Damaged(_))
            ));
            assert_eq!(std::fs::read(&path).unwrap(), damaged);
        }

        // A file that cannot be read at all: here, a directory where the file goes.
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(matches!(port.load("a"), Err(CheckpointFileError::Read(_))));
    }

    #[test]
    fn a_write_that_fails_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        // The temp name the write goes through, taken by a directory: the write cannot go.
        std::fs::create_dir(dir.path().join("log-checkpoints.json.tmp")).unwrap();
        let port = FileCheckpoints::new(dir.path());
        assert!(matches!(
            port.store("a", at(1, "h1")),
            Err(CheckpointFileError::Write(_))
        ));
    }

    // Through the port an unreadable file is an error ViaStore fails the read on, never "none".
    #[test]
    fn the_port_returns_the_file_errors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"{not json").unwrap();
        let port = FileCheckpoints::new(dir.path());
        let err = port.get("a").unwrap_err();
        assert!(err.0.contains("damaged"), "{err}");
        assert!(port.set("a", at(1, "h1")).is_err());
        assert!(port.forget("a").is_err());
        // A directory that was never initialized has no checkpoint and nothing to lose; one
        // it cannot write to is an error.
        let missing = FileCheckpoints::new(&dir.path().join("not-there"));
        assert_eq!(missing.get("a").unwrap(), None);
        let unwritable = tempfile::tempdir().unwrap();
        std::fs::create_dir(unwritable.path().join("log-checkpoints.json.tmp")).unwrap();
        let port = FileCheckpoints::new(unwritable.path());
        assert!(port
            .set("a", at(1, "h1"))
            .unwrap_err()
            .0
            .contains("written"));
    }
}
