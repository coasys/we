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

use std::path::PathBuf;
use std::sync::Mutex;

use ad4m_identity_client::VaultError;
use ad4m_identity_core::Event;

/// The file's name inside the custody folder.
pub const FILE_NAME: &str = "pending-incepts.json";

/// Where the pending incepts are kept.
pub enum PendingIncepts {
    /// `<dir>/pending-incepts.json`: what the app uses.
    File { dir: PathBuf, lock: Mutex<()> },
    /// Kept only as long as the value (tests).
    Memory(Mutex<Vec<Event>>),
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
        PendingIncepts::Memory(Mutex::new(Vec::new()))
    }

    /// The kept incepts.
    pub fn list(&self) -> Result<Vec<Event>, VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                read(dir)
            }
            PendingIncepts::Memory(events) => Ok(events
                .lock()
                .map_err(|_| unavailable("lock poisoned"))?
                .clone()),
        }
    }

    /// Keeps `incept`, replacing a kept incept of the same identity.
    pub fn keep(&self, incept: &Event) -> Result<(), VaultError> {
        self.change(|events| {
            events.retain(|e| e.scid != incept.scid);
            events.push(incept.clone());
        })
    }

    /// Forgets the incept of `scid`; nothing to do when none is kept.
    pub fn forget(&self, scid: &str) -> Result<(), VaultError> {
        self.change(|events| events.retain(|e| e.scid != scid))
    }

    fn change(&self, edit: impl FnOnce(&mut Vec<Event>)) -> Result<(), VaultError> {
        match self {
            PendingIncepts::File { dir, lock } => {
                let _held = lock.lock().map_err(|_| unavailable("lock poisoned"))?;
                let mut events = read(dir)?;
                edit(&mut events);
                write(dir, &events)
            }
            PendingIncepts::Memory(events) => {
                edit(&mut *events.lock().map_err(|_| unavailable("lock poisoned"))?);
                Ok(())
            }
        }
    }
}

fn read(dir: &std::path::Path) -> Result<Vec<Event>, VaultError> {
    match std::fs::read(dir.join(FILE_NAME)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(unavailable),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(unavailable(e)),
    }
}

fn write(dir: &std::path::Path, events: &[Event]) -> Result<(), VaultError> {
    use std::io::Write;
    let path = dir.join(FILE_NAME);
    if events.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(unavailable(e)),
            _ => Ok(()),
        };
    }
    std::fs::create_dir_all(dir).map_err(unavailable)?;
    let bytes = serde_json::to_vec(events).map_err(unavailable)?;
    let tmp = path.with_extension("json.tmp");
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
}
