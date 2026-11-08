//! The key file: the public keys, the two sealed seeds, the identity the phone is in and a claim
//! waiting for its answer. It holds nothing the sealing key does not guard: the seeds are in it
//! only as the sealer's output.

use std::fs;
use std::io::Write;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::{DevicePublic, Membership, PendingClaim, PhoneKeyError};

pub const FILE_NAME: &str = "device-keys.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyFile {
    /// `1`.
    pub v: u8,
    /// The device key, `z6Mk…`.
    pub sign: String,
    /// The enc key, `z6LS…`.
    pub enc: String,
    /// The sealer's output for the signing seed, base64.
    pub sealed_sign: String,
    /// The sealer's output for the enc seed, base64.
    pub sealed_enc: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<Joined>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<Pending>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Joined {
    pub scid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    /// The store the offer that added this phone was at: where its log, inbox and record are.
    /// Absent in a file a phone wrote before phase 2b, which then uses the store the app is
    /// built with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pending {
    pub scid: String,
    pub offer_id: String,
    pub store: String,
    pub match_code: String,
}

impl Pending {
    /// The claim as the app sees it; `key` is the device key that made it.
    pub fn public(&self, key: &str) -> PendingClaim {
        PendingClaim {
            did: ad4m_identity_core::did_of(&self.scid),
            offer_id: self.offer_id.clone(),
            store: self.store.clone(),
            state_url: crate::claim::state_url(&self.store, &self.scid, &self.offer_id, key),
            match_code: self.match_code.clone(),
        }
    }
}

impl KeyFile {
    pub fn new(sign: String, enc: String, sealed_sign: Vec<u8>, sealed_enc: Vec<u8>) -> Self {
        KeyFile {
            v: 1,
            sign,
            enc,
            sealed_sign: STANDARD.encode(sealed_sign),
            sealed_enc: STANDARD.encode(sealed_enc),
            identity: None,
            pending: None,
        }
    }

    pub fn public(&self) -> DevicePublic {
        DevicePublic {
            sign: self.sign.clone(),
            enc: self.enc.clone(),
            did_key: format!("did:key:{}", self.sign),
        }
    }

    pub fn membership(&self) -> Option<Membership> {
        self.identity.as_ref().map(|j| Membership {
            scid: j.scid.clone(),
            did: ad4m_identity_core::did_of(&j.scid),
            seq: j.seq,
        })
    }

    pub fn sealed_sign(&self) -> Result<Vec<u8>, PhoneKeyError> {
        decode(&self.sealed_sign, "sealedSign")
    }

    pub fn sealed_enc(&self) -> Result<Vec<u8>, PhoneKeyError> {
        decode(&self.sealed_enc, "sealedEnc")
    }

    pub fn joined(&self, member: &Membership) -> KeyFile {
        KeyFile {
            identity: Some(Joined {
                scid: member.scid.clone(),
                seq: member.seq,
                store: self.pending.as_ref().map(|p| p.store.clone()),
            }),
            pending: None,
            ..self.clone()
        }
    }

    pub fn without_pending(&self) -> KeyFile {
        KeyFile {
            pending: None,
            ..self.clone()
        }
    }

    fn check(&self) -> Result<(), PhoneKeyError> {
        let damaged = |reason: &str| PhoneKeyError::Damaged {
            reason: reason.into(),
        };
        if self.v != 1 {
            return Err(damaged("v is not 1"));
        }
        if !ad4m_identity_core::is_ed25519_multikey(&self.sign) {
            return Err(damaged("sign is not an Ed25519 multikey"));
        }
        if !ad4m_identity_core::is_x25519_multikey(&self.enc) {
            return Err(damaged("enc is not an X25519 multikey"));
        }
        self.sealed_sign()?;
        decode(&self.sealed_enc, "sealedEnc")?;
        Ok(())
    }
}

fn decode(text: &str, what: &str) -> Result<Vec<u8>, PhoneKeyError> {
    STANDARD.decode(text).map_err(|_| PhoneKeyError::Damaged {
        reason: format!("{what} is not base64"),
    })
}

/// The key file at `path`; `None` when there is none.
pub fn read(path: &Path) -> Result<Option<KeyFile>, PhoneKeyError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(PhoneKeyError::Io {
                reason: e.to_string(),
            })
        }
    };
    let file: KeyFile = serde_json::from_slice(&bytes).map_err(|e| PhoneKeyError::Damaged {
        reason: e.to_string(),
    })?;
    file.check()?;
    Ok(Some(file))
}

/// Writes `file` whole or not at all: a temporary file beside it, synced, then renamed over it.
/// Readable by this app's user only.
pub fn write(path: &Path, file: &KeyFile) -> Result<(), PhoneKeyError> {
    let bytes = serde_json::to_vec_pretty(file).expect("the key file serialises");
    write_atomic(path, &bytes)
}

fn io(e: std::io::Error) -> PhoneKeyError {
    PhoneKeyError::Io {
        reason: e.to_string(),
    }
}

/// Makes `dir`'s entries durable: a file renamed into it is named after a crash too, not only
/// its bytes durable (syncing the file before the rename covers the bytes, not the directory
/// entry — POSIX `fsync(2)` of the directory). A no-op where a directory cannot be opened to
/// sync. Recorded in tests.
fn sync_dir(dir: &Path) -> Result<(), PhoneKeyError> {
    #[cfg(test)]
    SYNCED_DIRS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push(dir.to_path_buf());
    #[cfg(unix)]
    fs::File::open(dir).map_err(io)?.sync_all().map_err(io)?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

/// The directories this process synced, in order (tests).
#[cfg(test)]
static SYNCED_DIRS: std::sync::Mutex<Vec<std::path::PathBuf>> = std::sync::Mutex::new(Vec::new());

#[cfg(test)]
fn synced_dirs() -> Vec<std::path::PathBuf> {
    SYNCED_DIRS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

/// `path` made a directory, every missing ancestor with it, each made durable: for every
/// directory created, the parent that gained its name is synced — the ancestor that was
/// already there included, so `Ok` means the whole path's name survives a crash, not only
/// its deepest part. One place makes the folders this crate writes into (`write_atomic`,
/// the vault's lock path), so no caller can create one early and skip the sync.
pub fn create_dir_durable(path: &Path) -> Result<(), PhoneKeyError> {
    // The missing ancestors, deepest first: each one's parent gains an entry.
    let mut missing = Vec::new();
    let mut cur = path;
    while !cur.is_dir() {
        missing.push(cur.to_path_buf());
        match cur.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => cur = parent,
            _ => break,
        }
    }
    if missing.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(path).map_err(io)?;
    // Shallowest first: the name the pre-existing ancestor gained is durable first.
    for made in missing.iter().rev() {
        if let Some(parent) = made.parent().filter(|p| !p.as_os_str().is_empty()) {
            sync_dir(parent)?;
        }
    }
    Ok(())
}

/// `bytes` at `path`, whole or not at all: a temporary file beside it, synced, then renamed over
/// it, and the directory synced so the name itself is durable before `Ok`. Readable by this
/// app's user only. The key file, the master-key file and the checkpoint file are all written
/// so. A directory made for the write is made durable with it.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), PhoneKeyError> {
    if let Some(dir) = path.parent() {
        // A directory made for the write — every missing ancestor of it — is made durable
        // with the write, at each parent that gained an entry.
        create_dir_durable(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut out = options.open(&tmp).map_err(io)?;
    out.write_all(bytes).map_err(io)?;
    out.sync_all().map_err(io)?;
    drop(out);
    fs::rename(&tmp, path).map_err(io)?;
    if let Some(dir) = path.parent() {
        // `Ok` means durable: the name the rename made too, not only the bytes.
        sync_dir(dir)?;
    }
    Ok(())
}

/// `file` locked exclusively until it is closed: `flock(2)` itself, because
/// `std::fs::File::lock` is not implemented for `target_os = "android"` — the pinned
/// toolchain takes the `lock() not supported` fallback there — and the vault's transaction
/// has to serialize on the platform it ships on, never skip locking. An open-file-
/// description lock: two `File` handles on one path conflict, in one process or across
/// two. Retried while a signal interrupts it.
#[cfg(unix)]
pub fn flock_exclusive(file: &fs::File) -> std::io::Result<()> {
    use std::os::unix::io::AsRawFd;
    loop {
        match unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } {
            0 => return Ok(()),
            _ => {
                let e = std::io::Error::last_os_error();
                if e.raw_os_error() != Some(libc::EINTR) {
                    return Err(e);
                }
            }
        }
    }
}

/// `file` locked exclusively until it is closed. Off unix (not a phone target) std's lock is
/// implemented, so it is the one use `clippy.toml`'s `disallowed-methods` allows.
#[cfg(not(unix))]
#[allow(clippy::disallowed_methods)]
pub fn flock_exclusive(file: &fs::File) -> std::io::Result<()> {
    file.lock()
}
#[cfg(test)]
mod tests {
    use super::*;

    /// The `Ok` of `write_atomic` means durable (`ad4m-identity-client`'s `Vault` contract):
    /// the file's bytes and the directory entry that names them both. Every directory made on
    /// the way is made durable at the parent that gained it — including the ancestor that was
    /// already there and names the first new one.
    #[test]
    fn a_write_syncs_the_directory_it_names() {
        let dir = tempfile::tempdir().unwrap();
        let before = synced_dirs().len();
        write_atomic(&dir.path().join("one.json"), b"{}").unwrap();
        assert!(
            synced_dirs().len() > before,
            "the rename is not durable unsynced"
        );

        // `new/deep` made for the write: `new` is synced (it names `deep`), and so is the
        // pre-existing root — it gained `new`'s name. `deep` is synced for the rename itself.
        let before = synced_dirs().len();
        let made = dir.path().join("new").join("deep");
        write_atomic(&made.join("two.json"), b"{}").unwrap();
        let synced = &synced_dirs()[before..];
        assert!(
            synced.contains(&dir.path().to_path_buf()),
            "the ancestor that was there gained `new` and is not synced: {synced:?}"
        );
        assert!(
            synced.contains(&dir.path().join("new")),
            "`new` gained `deep` and is not synced: {synced:?}"
        );
        assert!(
            synced.contains(&made),
            "the directory the rename landed in is not synced: {synced:?}"
        );
        assert_eq!(std::fs::read(made.join("two.json")).unwrap(), b"{}");
    }

    /// `create_dir_durable` makes every missing ancestor and syncs each parent that gained an
    /// entry, from the pre-existing one down; a directory already there costs no sync.
    #[test]
    fn a_made_directory_is_durable_at_each_parent_that_gained_it() {
        let dir = tempfile::tempdir().unwrap();
        let deep = dir.path().join("a").join("b").join("c");
        let before = synced_dirs().len();
        create_dir_durable(&deep).unwrap();
        assert_eq!(
            &synced_dirs()[before..],
            &[
                dir.path().to_path_buf(),
                dir.path().join("a"),
                dir.path().join("a").join("b"),
            ],
            "each parent that gained an entry, from the one that was already there"
        );
        let before = synced_dirs().len();
        create_dir_durable(&deep).unwrap();
        assert_eq!(synced_dirs().len(), before, "nothing made, nothing synced");
    }

    // The vault's transaction serializes on an exclusive lock of `master-keys.lock`, taken on a
    // fresh descriptor per operation: two independent handles on one path must conflict, in one
    // process as across two. `std::fs::File::lock` gives that on the host but not on Android
    // (`lock() not supported` in the pinned toolchain), so the lock is `flock(2)` itself.
    #[test]
    fn a_flocked_file_blocks_a_second_handle_until_released() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("master-keys.lock");
        let first = std::fs::File::create(&path).unwrap();
        flock_exclusive(&first).unwrap();

        // A second, independent handle on the same path waits for the first to close.
        let second = std::fs::File::open(&path).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            flock_exclusive(&second).expect("the second handle locks once the first closes");
            tx.send(()).unwrap();
        });
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(300))
                .is_err(),
            "the second handle locked while the first still held it"
        );
        drop(first);
        rx.recv_timeout(std::time::Duration::from_secs(10))
            .expect("the second handle locked once the first closed");
    }
}
