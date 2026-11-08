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
//! It fails closed: only a file that is not there is "no checkpoint". One that cannot be read, does
//! not parse, or cannot be written is a [`CheckpointFileError`] from [`FileCheckpoints::load`],
//! [`FileCheckpoints::store`] and [`FileCheckpoints::drop_scid`], never a silent "none" a store
//! could roll the phone back through.
//!
//! [`LogCheckpoints`] passes each one on as a `CheckpointError`, and `ViaStore` then fails the read
//! closed (`503`) rather than admit a log it has nothing to measure against.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ad4m_identity_client::{Checkpoint, CheckpointError, LogCheckpoints};
use serde::{Deserialize, Serialize};

use crate::file::write_atomic;

pub const FILE_NAME: &str = "log-checkpoints.json";

/// One lock for every read-modify-write of the file: the app runs calls on several threads, each
/// with its own `ViaStore` over the same file.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CheckpointFile {
    /// `1`.
    v: u8,
    /// By SCID.
    logs: BTreeMap<String, Checkpoint>,
}

/// [`LogCheckpoints`] in `log-checkpoints.json` in `dir`.
pub(crate) struct FileCheckpoints {
    path: PathBuf,
}

impl FileCheckpoints {
    pub(crate) fn new(dir: &Path) -> Self {
        FileCheckpoints {
            path: dir.join(FILE_NAME),
        }
    }

    /// The file, or an empty one where none was written yet. Anything else that keeps it from
    /// being read is an error: every write is whole, so a file that does not parse is not one this
    /// app left, and treating it as empty would forget every head.
    fn read(&self) -> Result<CheckpointFile, CheckpointFileError> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(CheckpointFile {
                    v: 1,
                    logs: BTreeMap::new(),
                })
            }
            Err(e) => return Err(CheckpointFileError::Read(e.to_string())),
        };
        let file: CheckpointFile = serde_json::from_slice(&bytes)
            .map_err(|e| CheckpointFileError::Damaged(e.to_string()))?;
        if file.v != 1 {
            return Err(CheckpointFileError::Damaged(format!("version {}", file.v)));
        }
        Ok(file)
    }

    fn write(&self, file: &CheckpointFile) -> Result<(), CheckpointFileError> {
        let bytes = serde_json::to_vec_pretty(file).expect("the checkpoints serialise");
        write_atomic(&self.path, &bytes).map_err(|e| CheckpointFileError::Write(e.to_string()))
    }

    /// The checkpoint kept for `scid`.
    pub(crate) fn load(&self, scid: &str) -> Result<Option<Checkpoint>, CheckpointFileError> {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        Ok(self.read()?.logs.remove(scid))
    }

    /// Keeps `checkpoint` for `scid`. Never back: two calls that read the log at once may each
    /// admit a head, and the later write may be the lower one. The higher stands; [`Self::drop_scid`]
    /// is the only way down.
    pub(crate) fn store(
        &self,
        scid: &str,
        checkpoint: Checkpoint,
    ) -> Result<(), CheckpointFileError> {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let mut file = self.read()?;
        if let Some(kept) = file.logs.get(scid) {
            if kept.seq > checkpoint.seq || *kept == checkpoint {
                return Ok(());
            }
        }
        file.logs.insert(scid.to_string(), checkpoint);
        self.write(&file)
    }

    /// `identity.resetLog`: forgets `scid`'s checkpoint.
    pub(crate) fn drop_scid(&self, scid: &str) -> Result<(), CheckpointFileError> {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let mut file = self.read()?;
        if file.logs.remove(scid).is_some() {
            self.write(&file)?;
        }
        Ok(())
    }
}

/// Why the checkpoint file gave no answer. None of these is "no checkpoint".
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum CheckpointFileError {
    #[error("the log checkpoints could not be read: {0}")]
    Read(String),
    #[error("the log checkpoints file is damaged: {0}")]
    Damaged(String),
    #[error("the log checkpoints could not be written: {0}")]
    Write(String),
}

impl From<CheckpointFileError> for CheckpointError {
    fn from(e: CheckpointFileError) -> Self {
        CheckpointError(e.to_string())
    }
}

impl LogCheckpoints for FileCheckpoints {
    fn get(&self, scid: &str) -> Result<Option<Checkpoint>, CheckpointError> {
        Ok(self.load(scid)?)
    }

    fn set(&self, scid: &str, checkpoint: Checkpoint) -> Result<(), CheckpointError> {
        Ok(self.store(scid, checkpoint)?)
    }

    fn forget(&self, scid: &str) -> Result<(), CheckpointError> {
        Ok(self.drop_scid(scid)?)
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
        // The same seq with another hash is ViaStore's to judge (a fork it admitted after a
        // reset); the port keeps what it is told.
        port.set("a", at(5, "h5b")).unwrap();
        assert_eq!(port.get("a").unwrap(), Some(at(5, "h5b")));
        port.set("a", at(6, "h6")).unwrap();
        assert_eq!(port.get("a").unwrap(), Some(at(6, "h6")));
        port.forget("a").unwrap();
        assert_eq!(port.get("a").unwrap(), None);
        port.set("a", at(2, "h2")).unwrap();
        assert_eq!(port.get("a").unwrap(), Some(at(2, "h2")));
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
        let port = FileCheckpoints::new(&dir.path().join("not-there"));
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
        let missing = FileCheckpoints::new(&dir.path().join("not-there"));
        assert_eq!(missing.get("a").unwrap(), None);
        assert!(missing
            .set("a", at(1, "h1"))
            .unwrap_err()
            .0
            .contains("written"));
    }
}
