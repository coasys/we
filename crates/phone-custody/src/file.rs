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
/// sync. Counted in tests.
fn sync_dir(dir: &Path) -> Result<(), PhoneKeyError> {
    #[cfg(test)]
    DIR_SYNCS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    #[cfg(unix)]
    fs::File::open(dir).map_err(io)?.sync_all().map_err(io)?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

/// How many directory syncs this process ran (tests).
#[cfg(test)]
static DIR_SYNCS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
fn dir_syncs() -> usize {
    DIR_SYNCS.load(std::sync::atomic::Ordering::SeqCst)
}

/// `bytes` at `path`, whole or not at all: a temporary file beside it, synced, then renamed over
/// it, and the directory synced so the name itself is durable before `Ok`. Readable by this
/// app's user only. The key file, the master-key file and the checkpoint file are all written
/// so. A directory made for the write is made durable with it.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), PhoneKeyError> {
    if let Some(dir) = path.parent() {
        if !dir.is_dir() {
            fs::create_dir_all(dir).map_err(io)?;
            // The new directory's own entry in its parent is durable with the write.
            if let Some(up) = dir.parent() {
                sync_dir(up)?;
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The `Ok` of `write_atomic` means durable (`ad4m-identity-client`'s `Vault` contract):
    /// the file's bytes and the directory entry that names them both. The first write into a
    /// directory made on the way syncs the directory's parent too.
    #[test]
    fn a_write_syncs_the_directory_it_names() {
        let dir = tempfile::tempdir().unwrap();
        let before = dir_syncs();
        write_atomic(&dir.path().join("one.json"), b"{}").unwrap();
        assert!(dir_syncs() > before, "the rename is not durable unsynced");

        let before = dir_syncs();
        let made = dir.path().join("new").join("deep");
        write_atomic(&made.join("two.json"), b"{}").unwrap();
        assert!(
            dir_syncs() >= before + 2,
            "a directory made for the write is itself made durable"
        );
        assert_eq!(std::fs::read(made.join("two.json")).unwrap(), b"{}");
    }
}
