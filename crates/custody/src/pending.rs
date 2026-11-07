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
//! The folder is shared by every desktop app and build on this computer, and two can run at once (a
//! WE build and a white-labelled one each hold their own single-instance lock). So each read and
//! each read-modify-write holds an advisory lock on `<dir>/pending-incepts.lock` for its length,
//! across processes — the in-process mutex alone let two services each write back a list without
//! the other's incept. Both lists take that one lock.

use std::path::PathBuf;
use std::sync::Mutex;

use ad4m_identity_client::{PendingPush, VaultError};
use ad4m_identity_core::Event;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// The file's name inside the custody folder.
pub const FILE_NAME: &str = "pending-incepts.json";

/// The retry list's file inside the custody folder.
pub const PUSHES_FILE_NAME: &str = "pending-pushes.json";

/// The lock every process holds while it reads or changes the file.
const LOCK_NAME: &str = "pending-incepts.lock";

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
    Memory(Mutex<(Vec<Event>, Vec<PendingPush>)>),
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
        PendingIncepts::Memory(Mutex::new((Vec::new(), Vec::new())))
    }

    /// The kept incepts.
    pub fn list(&self) -> Result<Vec<Event>, VaultError> {
        self.read_one(FILE_NAME, |m| m.0.clone())
    }

    /// Keeps `incept`, replacing a kept incept of the same identity.
    pub fn keep(&self, incept: &Event) -> Result<(), VaultError> {
        self.change(
            FILE_NAME,
            |m| &mut m.0,
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
            |m| &mut m.0,
            |events: &mut Vec<Event>| events.retain(|e| e.scid != scid),
        )
    }

    /// The master-key pushes kept and not yet confirmed sent.
    pub fn pushes(&self) -> Result<Vec<PendingPush>, VaultError> {
        self.read_one(PUSHES_FILE_NAME, |m| m.1.clone())
    }

    /// Keeps `push` on the retry list; keeping one already listed is no change.
    pub fn keep_push(&self, push: &PendingPush) -> Result<(), VaultError> {
        self.change(
            PUSHES_FILE_NAME,
            |m| &mut m.1,
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
            |m| &mut m.1,
            |pushes: &mut Vec<PendingPush>| pushes.retain(|p| p != push),
        )
    }

    fn read_one<T: DeserializeOwned>(
        &self,
        file: &str,
        memory: impl FnOnce(&(Vec<Event>, Vec<PendingPush>)) -> Vec<T>,
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

    fn change<T: Serialize + DeserializeOwned>(
        &self,
        file: &str,
        memory: impl FnOnce(&mut (Vec<Event>, Vec<PendingPush>)) -> &mut Vec<T>,
        edit: impl FnOnce(&mut Vec<T>),
    ) -> Result<(), VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let _exclusive = lock_folder(dir, true)?;
                let mut items = read(dir, file)?;
                edit(&mut items);
                write(dir, file, &items)
            }
            PendingIncepts::Memory(lists) => {
                edit(memory(
                    &mut *lists.lock().map_err(|_| unavailable("lock poisoned"))?,
                ));
                Ok(())
            }
        }
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
    use std::io::Write;
    let path = dir.join(file);
    if events.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(unavailable(e)),
            _ => Ok(()),
        };
    }
    std::fs::create_dir_all(dir).map_err(unavailable)?;
    let bytes = serde_json::to_vec(events).map_err(unavailable)?;
    // Its own temp name per process, so two writers never share one half-written file.
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let mut file = std::fs::File::create(&tmp).map_err(unavailable)?;
    file.write_all(&bytes).map_err(unavailable)?;
    file.sync_all().map_err(unavailable)?;
    std::fs::rename(&tmp, &path).map_err(unavailable)
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
}
