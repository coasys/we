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

    #[cfg(test)]
    pub fn sealed_enc(&self) -> Result<Vec<u8>, PhoneKeyError> {
        decode(&self.sealed_enc, "sealedEnc")
    }

    pub fn joined(&self, member: &Membership) -> KeyFile {
        KeyFile {
            identity: Some(Joined {
                scid: member.scid.clone(),
                seq: member.seq,
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
    let io = |e: std::io::Error| PhoneKeyError::Io {
        reason: e.to_string(),
    };
    let bytes = serde_json::to_vec_pretty(file).expect("the key file serialises");
    let tmp = path.with_extension("json.tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut out = options.open(&tmp).map_err(io)?;
    out.write_all(&bytes).map_err(io)?;
    out.sync_all().map_err(io)?;
    drop(out);
    fs::rename(&tmp, path).map_err(io)?;
    Ok(())
}
