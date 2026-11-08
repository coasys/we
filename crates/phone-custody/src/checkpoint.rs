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
//! The port's methods answer nothing, so a write that fails leaves the file as it was: the next
//! read is measured against the head before, which is the in-memory default's guarantee at worst.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ad4m_identity_client::{Checkpoint, LogCheckpoints};
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

    /// The file, or none kept yet. One that does not parse is read as none: it can only be one
    /// this app did not write, since every write is whole.
    fn read(&self) -> CheckpointFile {
        std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CheckpointFile>(&bytes).ok())
            .filter(|file| file.v == 1)
            .unwrap_or(CheckpointFile {
                v: 1,
                logs: BTreeMap::new(),
            })
    }

    fn write(&self, file: &CheckpointFile) {
        let bytes = serde_json::to_vec_pretty(file).expect("the checkpoints serialise");
        // Nothing to answer with (see the module's docs): the file stays as it was.
        let _ = write_atomic(&self.path, &bytes);
    }
}

impl LogCheckpoints for FileCheckpoints {
    fn get(&self, scid: &str) -> Option<Checkpoint> {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        self.read().logs.remove(scid)
    }

    /// Never back: two calls that read the log at once may each admit a head, and the later
    /// write may be the lower one. The higher stands; `forget` is the only way down.
    fn set(&self, scid: &str, checkpoint: Checkpoint) {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let mut file = self.read();
        if let Some(kept) = file.logs.get(scid) {
            if kept.seq > checkpoint.seq || *kept == checkpoint {
                return;
            }
        }
        file.logs.insert(scid.to_string(), checkpoint);
        self.write(&file);
    }

    fn forget(&self, scid: &str) {
        let _held = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let mut file = self.read();
        if file.logs.remove(scid).is_some() {
            self.write(&file);
        }
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
        assert_eq!(FileCheckpoints::new(dir.path()).get("a"), None);
        FileCheckpoints::new(dir.path()).set("a", at(3, "h3"));
        FileCheckpoints::new(dir.path()).set("b", at(1, "b1"));
        assert_eq!(FileCheckpoints::new(dir.path()).get("a"), Some(at(3, "h3")));
        assert_eq!(FileCheckpoints::new(dir.path()).get("b"), Some(at(1, "b1")));
        assert!(!dir.path().join("log-checkpoints.json.tmp").exists());
    }

    #[test]
    fn a_checkpoint_goes_forward_and_only_forget_takes_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let port = FileCheckpoints::new(dir.path());
        port.set("a", at(5, "h5"));
        port.set("a", at(4, "h4"));
        assert_eq!(port.get("a"), Some(at(5, "h5")));
        // The same seq with another hash is ViaStore's to judge (a fork it admitted after a
        // reset); the port keeps what it is told.
        port.set("a", at(5, "h5b"));
        assert_eq!(port.get("a"), Some(at(5, "h5b")));
        port.set("a", at(6, "h6"));
        assert_eq!(port.get("a"), Some(at(6, "h6")));
        port.forget("a");
        assert_eq!(port.get("a"), None);
        port.set("a", at(2, "h2"));
        assert_eq!(port.get("a"), Some(at(2, "h2")));
    }

    #[test]
    fn a_file_this_app_did_not_write_is_none_and_is_replaced_whole() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"{not json").unwrap();
        let port = FileCheckpoints::new(dir.path());
        assert_eq!(port.get("a"), None);
        port.set("a", at(1, "h1"));
        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(FILE_NAME)).unwrap()).unwrap();
        assert_eq!(
            written,
            serde_json::json!({ "v": 1, "logs": { "a": { "seq": 1, "hash": "h1" } } })
        );
    }
}
