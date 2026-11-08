//! `PhoneVault`: the phone's custody of a master key, `ad4m-identity-client`'s `Vault` over a file
//! beside the key file and a second platform key, [`MasterSealer`].
//!
//! On Android the master sealer is a Keystore AES-256-GCM key, `org.coasys.app.master-seeds.v1`,
//! that needs the person's biometric for every use (`setUserAuthenticationRequired(true)`, a
//! timeout of 0, `setInvalidatedByBiometricEnrollment(true)`), used through `BiometricPrompt` with
//! a `CryptoObject`: each seal and each open is one prompt, which the app shows with the `prompt`
//! sentence this crate passes. The device key's [`Sealer`] stays as phase 2a left it, with no user
//! auth, so a key login never prompts.
//!
//! `master-keys.json` holds, per identity, the master key's index, its public key, the seed
//! sealed by the master sealer under the label `coasys:phone-master:1:<scid>:<index>` (associated
//! data, so a sealed seed moved to another identity or index does not open), and a **tag**: the
//! entry's fields sealed by the device [`Sealer`]. [`Vault::master_index`] must name the key
//! without a prompt and without trusting a cache: it opens the tag (the device sealer needs no
//! biometric) and answers the index only when the tag covers the entry exactly as the file has
//! it. An open of the seed checks the key it opens to against the public key the tag covers.
//!
//! Every write is whole or not at all, as the key file's: the vault's order (store the key, then
//! acknowledge the inbox message, then write the record) leaves a crash between two steps to be
//! retried from the inbox.
//!
//! **Protection.** The master sealer reports what the Keystore gave its key (`strongbox`, `tee`,
//! `software`, `unknown`). A master key is kept only at `strongbox` or `tee`, unless the person has
//! agreed to keep it at the level the phone has ([`PhoneVault::allow_weak_protection`]): an
//! emulator's Keystore is software, which anything that can read the app's files can open.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use ad4m_identity_client::vault::KeySigner;
use ad4m_identity_client::{
    MasterUse, PendingPush, Secret, StageToken, Unlocked, Vault, VaultError,
};
use ad4m_identity_core::build::Signer;
use ad4m_identity_core::Event;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{Sealer, WipeOnDrop};

pub const MASTER_FILE_NAME: &str = "master-keys.json";
/// The label an entry's tag is sealed under by the device sealer.
pub const TAG_LABEL: &str = "coasys:phone-master-tag:1";
/// What a `VaultError::Unavailable` starts with when the master sealer's protection is below
/// what a master key is kept at, and the person has not agreed.
pub const WEAK_PROTECTION: &str = "weak-protection: ";
/// What a `VaultError::Unavailable` starts with when the master sealer's key is gone: a new
/// biometric was enrolled, which invalidates it, and the key kept under it can no longer open.
pub const INVALIDATED: &str = "invalidated: ";

/// The label a master seed is sealed under.
pub fn master_label(scid: &str, index: u32) -> String {
    format!("coasys:phone-master:1:{scid}:{index}")
}

/// What seals and opens a master seed: a platform key that needs the person's biometric for each
/// use. The app implements it (Kotlin, over the Android Keystore and `BiometricPrompt`); the tests
/// implement it in Rust. `prompt` is the sentence the biometric prompt shows.
#[uniffi::export(with_foreign)]
pub trait MasterSealer: Send + Sync {
    /// What the platform gave the sealing key: `strongbox`, `tee`, `software` or `unknown`. Makes
    /// the key when there is none yet.
    fn protection(&self) -> String;
    /// The sealed form of `plaintext`, bound to `label`, after the person's biometric.
    fn seal(
        &self,
        label: String,
        plaintext: Vec<u8>,
        prompt: String,
    ) -> Result<Vec<u8>, MasterSealError>;
    /// The plaintext of `sealed`, sealed under `label`, after the person's biometric.
    fn open(
        &self,
        label: String,
        sealed: Vec<u8>,
        prompt: String,
    ) -> Result<Vec<u8>, MasterSealError>;
    /// Zero every plaintext `open` has returned.
    fn wipe(&self);
}

/// Why the master sealer did not seal or open.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MasterSealError {
    /// The person closed the biometric prompt.
    #[error("the biometric prompt was cancelled")]
    Cancelled,
    /// The phone has no biometric enrolled (or no secure screen lock), so the key cannot be used.
    #[error("this phone has no fingerprint or face unlock set up")]
    NoBiometrics,
    /// The sealing key is gone: a biometric enrolled since it was made invalidated it.
    #[error("the key that sealed the master key was invalidated by a new fingerprint or face")]
    Invalidated,
    #[error("{reason}")]
    Failed { reason: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for MasterSealError {
    fn from(e: uniffi::UnexpectedUniFFICallbackError) -> Self {
        MasterSealError::Failed { reason: e.reason }
    }
}

impl From<MasterSealError> for VaultError {
    fn from(e: MasterSealError) -> Self {
        match e {
            MasterSealError::Cancelled => VaultError::Cancelled,
            MasterSealError::NoBiometrics => VaultError::NoScreenLock,
            MasterSealError::Invalidated => VaultError::Unavailable(format!("{INVALIDATED}{e}")),
            MasterSealError::Failed { reason } => VaultError::Unavailable(reason),
        }
    }
}

/// The sentence the biometric prompt shows for each use.
fn prompt_for(why: MasterUse) -> &'static str {
    match why {
        MasterUse::Link => "Add a device to your identity",
        MasterUse::Revoke => "Revoke a device of your identity",
        MasterUse::SendMaster => "Send your master key to your device",
    }
}

const PROMPT_KEEP: &str = "Keep your master key on this phone";
const PROMPT_STAGE: &str = "Keep your new master key on this phone";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Kind {
    Kept,
    Staged,
}

/// One master key in the file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Item {
    scid: String,
    index: u32,
    /// The master key's public half, `z6Mk…`.
    key: String,
    /// The master sealer's output, base64.
    sealed: String,
    /// The device sealer's output over [`Item::tag_body`], base64.
    tag: String,
    /// A staged key's [`StageToken`], hex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
}

impl Item {
    /// What the tag covers: every field of the entry and whether it is kept or staged.
    fn tag_body(
        kind: Kind,
        scid: &str,
        index: u32,
        key: &str,
        sealed: &str,
        owner: Option<&str>,
    ) -> Vec<u8> {
        let kind = match kind {
            Kind::Kept => "kept",
            Kind::Staged => "staged",
        };
        format!(
            "coasys:phone-master-tag:1\n{kind}\n{scid}\n{index}\n{key}\n{}\n{sealed}",
            owner.unwrap_or("")
        )
        .into_bytes()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MasterFile {
    v: u8,
    #[serde(default)]
    kept: Vec<Item>,
    #[serde(default)]
    staged: Vec<Item>,
    /// Co-signed incepts not yet confirmed published (public keys and proofs only).
    #[serde(default)]
    incepts: Vec<serde_json::Value>,
    #[serde(default)]
    pushes: Vec<PendingPush>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn io(e: crate::PhoneKeyError) -> VaultError {
    VaultError::Unavailable(e.to_string())
}

/// The phone's master-key vault: `master-keys.json` in the key directory, the seeds sealed by
/// [`MasterSealer`] and the entries tagged by the device [`Sealer`].
pub struct PhoneVault {
    path: PathBuf,
    master: Arc<dyn MasterSealer>,
    device: Arc<dyn Sealer>,
    file: Mutex<MasterFile>,
    allow_weak: AtomicBool,
}

impl PhoneVault {
    /// The vault kept in `dir`. Reads the file when there is one; makes nothing.
    pub fn open(
        dir: &std::path::Path,
        master: Arc<dyn MasterSealer>,
        device: Arc<dyn Sealer>,
    ) -> Result<Self, crate::PhoneKeyError> {
        let path = dir.join(MASTER_FILE_NAME);
        let file = match std::fs::read(&path) {
            Ok(bytes) => {
                let file: MasterFile =
                    serde_json::from_slice(&bytes).map_err(|e| crate::PhoneKeyError::Damaged {
                        reason: format!("{MASTER_FILE_NAME}: {e}"),
                    })?;
                if file.v != 1 {
                    return Err(crate::PhoneKeyError::Damaged {
                        reason: format!("{MASTER_FILE_NAME}: v is not 1"),
                    });
                }
                file
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => MasterFile {
                v: 1,
                ..MasterFile::default()
            },
            Err(e) => {
                return Err(crate::PhoneKeyError::Io {
                    reason: e.to_string(),
                })
            }
        };
        Ok(PhoneVault {
            path,
            master,
            device,
            file: Mutex::new(file),
            allow_weak: AtomicBool::new(false),
        })
    }

    /// The person agreed to keep a master key at the protection the phone has, below StrongBox
    /// and the TEE. Lasts for this vault object: the app asks again the next time.
    pub fn allow_weak_protection(&self, allow: bool) {
        self.allow_weak.store(allow, Ordering::SeqCst);
    }

    /// What the master sealer's key has.
    pub fn protection(&self) -> String {
        self.master.protection()
    }

    /// `Ok` when a master key may be kept at the master sealer's protection.
    pub fn check_protection(&self) -> Result<(), VaultError> {
        let protection = self.master.protection();
        if matches!(protection.as_str(), "strongbox" | "tee")
            || self.allow_weak.load(Ordering::SeqCst)
        {
            return Ok(());
        }
        Err(VaultError::Unavailable(format!(
            "{WEAK_PROTECTION}{protection}"
        )))
    }

    fn lock(&self) -> MutexGuard<'_, MasterFile> {
        self.file
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn save(
        &self,
        guard: &mut MutexGuard<'_, MasterFile>,
        next: MasterFile,
    ) -> Result<(), VaultError> {
        let bytes = serde_json::to_vec_pretty(&next).expect("the master-key file serialises");
        crate::file::write_atomic(&self.path, &bytes).map_err(io)?;
        **guard = next;
        Ok(())
    }

    /// A new entry for `secret`: sealed under its label after one prompt, then tagged.
    fn seal_item(
        &self,
        kind: Kind,
        scid: &str,
        index: u32,
        secret: &Secret<[u8; 32]>,
        owner: Option<&StageToken>,
        prompt: &str,
    ) -> Result<Item, VaultError> {
        self.check_protection()?;
        let key = KeySigner::new(secret.expose(), index).key();
        let sealed = self.master.seal(
            master_label(scid, index),
            secret.expose().to_vec(),
            prompt.to_string(),
        )?;
        let sealed = STANDARD.encode(sealed);
        let owner = owner.map(|o| hex(&o.0));
        let tag = self.tag(kind, scid, index, &key, &sealed, owner.as_deref())?;
        Ok(Item {
            scid: scid.to_string(),
            index,
            key,
            sealed,
            tag,
            owner,
        })
    }

    fn tag(
        &self,
        kind: Kind,
        scid: &str,
        index: u32,
        key: &str,
        sealed: &str,
        owner: Option<&str>,
    ) -> Result<String, VaultError> {
        let body = Item::tag_body(kind, scid, index, key, sealed, owner);
        let tag = self
            .device
            .seal(TAG_LABEL.into(), body)
            .map_err(|e| VaultError::Unavailable(e.to_string()))?;
        Ok(STANDARD.encode(tag))
    }

    /// Whether `item`'s tag covers it as `kind`. Opens the tag with the device sealer (no
    /// prompt). A tag that does not open, or covers other fields, is `Tampered`.
    fn verify(&self, kind: Kind, item: &Item) -> Result<(), VaultError> {
        let tag = STANDARD
            .decode(&item.tag)
            .map_err(|_| VaultError::Tampered)?;
        let _wipe = WipeOnDrop(self.device.as_ref());
        let opened = Zeroizing::new(
            self.device
                .open(TAG_LABEL.into(), tag)
                .map_err(|_| VaultError::Tampered)?,
        );
        let expected = Item::tag_body(
            kind,
            &item.scid,
            item.index,
            &item.key,
            &item.sealed,
            item.owner.as_deref(),
        );
        if opened.as_slice() != expected.as_slice() {
            return Err(VaultError::Tampered);
        }
        Ok(())
    }

    /// The seed of `item` after one prompt, checked against the key its tag covers.
    fn open_item(&self, item: &Item, prompt: &str) -> Result<KeySigner, VaultError> {
        let sealed = STANDARD
            .decode(&item.sealed)
            .map_err(|_| VaultError::Tampered)?;
        let _wipe = MasterWipe(self.master.as_ref());
        let plain = Zeroizing::new(self.master.open(
            master_label(&item.scid, item.index),
            sealed,
            prompt.to_string(),
        )?);
        let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
            plain
                .as_slice()
                .try_into()
                .map_err(|_| VaultError::Tampered)?,
        );
        let signer = KeySigner::new(&seed, item.index);
        if signer.key() != item.key {
            return Err(VaultError::Tampered);
        }
        Ok(signer)
    }
}

/// Calls [`MasterSealer::wipe`] when dropped.
struct MasterWipe<'a>(&'a dyn MasterSealer);

impl Drop for MasterWipe<'_> {
    fn drop(&mut self) {
        self.0.wipe();
    }
}

impl Vault for PhoneVault {
    fn store_master(
        &self,
        scid: &str,
        index: u32,
        secret: Secret<[u8; 32]>,
    ) -> Result<(), VaultError> {
        let item = self.seal_item(Kind::Kept, scid, index, &secret, None, PROMPT_KEEP)?;
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.kept.retain(|k| k.scid != scid);
        next.kept.push(item);
        self.save(&mut guard, next)
    }

    fn master_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        let item = self.lock().kept.iter().find(|k| k.scid == scid).cloned();
        let Some(item) = item else {
            return Ok(None);
        };
        match self.verify(Kind::Kept, &item) {
            Ok(()) => Ok(Some(item.index)),
            // A tag that does not vouch for the entry names no key: `None`, and the caller
            // never forgets a key on `None`.
            Err(VaultError::Tampered) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn stage_master(
        &self,
        scid: &str,
        index: u32,
        secret: Secret<[u8; 32]>,
        owner: &StageToken,
    ) -> Result<(), VaultError> {
        let item = self.seal_item(
            Kind::Staged,
            scid,
            index,
            &secret,
            Some(owner),
            PROMPT_STAGE,
        )?;
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.staged.retain(|k| k.scid != scid);
        next.staged.push(item);
        self.save(&mut guard, next)
    }

    fn staged_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        let item = self.lock().staged.iter().find(|k| k.scid == scid).cloned();
        let Some(item) = item else {
            return Ok(None);
        };
        match self.verify(Kind::Staged, &item) {
            Ok(()) => Ok(Some(item.index)),
            Err(VaultError::Tampered) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn promote_master(&self, scid: &str, index: u32) -> Result<(), VaultError> {
        let staged = self
            .lock()
            .staged
            .iter()
            .find(|k| k.scid == scid && k.index == index)
            .cloned()
            .ok_or(VaultError::NotFound)?;
        self.verify(Kind::Staged, &staged)?;
        // The sealed seed moves as it is: its label names the identity and index, not the kind.
        let tag = self.tag(Kind::Kept, scid, index, &staged.key, &staged.sealed, None)?;
        let kept = Item {
            tag,
            owner: None,
            ..staged
        };
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.staged
            .retain(|k| !(k.scid == scid && k.index == index));
        next.kept.retain(|k| k.scid != scid);
        next.kept.push(kept);
        self.save(&mut guard, next)
    }

    fn discard_staged(
        &self,
        scid: &str,
        index: u32,
        owner: Option<&StageToken>,
    ) -> Result<(), VaultError> {
        let owner = owner.map(|o| hex(&o.0));
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.staged.retain(|k| {
            let matches = k.scid == scid
                && k.index == index
                && owner.as_ref().is_none_or(|o| k.owner.as_ref() == Some(o));
            !matches
        });
        if next == *guard {
            return Ok(());
        }
        self.save(&mut guard, next)
    }

    fn forget_master(&self, scid: &str) -> Result<(), VaultError> {
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.kept.retain(|k| k.scid != scid);
        if next == *guard {
            return Ok(());
        }
        self.save(&mut guard, next)
    }

    fn unlock(&self, scid: &str, why: MasterUse, now: u64) -> Result<Unlocked, VaultError> {
        let item = self
            .lock()
            .kept
            .iter()
            .find(|k| k.scid == scid)
            .cloned()
            .ok_or(VaultError::NotFound)?;
        self.verify(Kind::Kept, &item)?;
        let signer = self.open_item(&item, prompt_for(why))?;
        Ok(Unlocked::new(Box::new(signer), why, now))
    }

    fn store_pending_incept(&self, incept: &Event) -> Result<(), VaultError> {
        let value = serde_json::to_value(incept)
            .map_err(|e| VaultError::Unavailable(format!("the incept does not serialise: {e}")))?;
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.incepts
            .retain(|kept| kept["scid"].as_str() != Some(incept.scid.as_str()));
        next.incepts.push(value);
        self.save(&mut guard, next)
    }

    fn pending_incepts(&self) -> Result<Vec<Event>, VaultError> {
        self.lock()
            .incepts
            .iter()
            .map(|value| Event::from_json(value).map_err(|_| VaultError::Tampered))
            .collect()
    }

    fn incept_published(&self, scid: &str) -> Result<(), VaultError> {
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.incepts
            .retain(|kept| kept["scid"].as_str() != Some(scid));
        if next == *guard {
            return Ok(());
        }
        self.save(&mut guard, next)
    }

    fn keep_push(&self, push: &PendingPush) -> Result<(), VaultError> {
        let mut guard = self.lock();
        if guard.pushes.contains(push) {
            return Ok(());
        }
        let mut next = guard.clone();
        next.pushes.push(push.clone());
        self.save(&mut guard, next)
    }

    fn pending_pushes(&self) -> Result<Vec<PendingPush>, VaultError> {
        Ok(self.lock().pushes.clone())
    }

    fn push_done(&self, push: &PendingPush) -> Result<(), VaultError> {
        let mut guard = self.lock();
        let mut next = guard.clone();
        next.pushes.retain(|p| p != push);
        if next == *guard {
            return Ok(());
        }
        self.save(&mut guard, next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SealError;

    /// Both sealers: the label, then the bytes XORed with `pad`.
    struct Xor(u8);

    fn seal(pad: u8, label: &str, plaintext: &[u8]) -> Vec<u8> {
        let mut out = label.as_bytes().to_vec();
        out.push(0);
        out.extend(plaintext.iter().map(|b| b ^ pad));
        out
    }

    fn open(pad: u8, label: &str, sealed: &[u8]) -> Option<Vec<u8>> {
        let mut prefix = label.as_bytes().to_vec();
        prefix.push(0);
        let body = sealed.strip_prefix(prefix.as_slice())?;
        Some(body.iter().map(|b| b ^ pad).collect())
    }

    impl Sealer for Xor {
        fn seal(&self, label: String, plaintext: Vec<u8>) -> Result<Vec<u8>, SealError> {
            Ok(seal(self.0, &label, &plaintext))
        }
        fn open(&self, label: String, sealed: Vec<u8>) -> Result<Vec<u8>, SealError> {
            open(self.0, &label, &sealed).ok_or(SealError::Failed {
                reason: "another label".into(),
            })
        }
        fn wipe(&self) {}
    }

    impl MasterSealer for Xor {
        fn protection(&self) -> String {
            "strongbox".into()
        }
        fn seal(
            &self,
            label: String,
            plaintext: Vec<u8>,
            _: String,
        ) -> Result<Vec<u8>, MasterSealError> {
            Ok(seal(self.0, &label, &plaintext))
        }
        fn open(
            &self,
            label: String,
            sealed: Vec<u8>,
            _: String,
        ) -> Result<Vec<u8>, MasterSealError> {
            open(self.0, &label, &sealed).ok_or(MasterSealError::Failed {
                reason: "another label".into(),
            })
        }
        fn wipe(&self) {}
    }

    fn vault(dir: &std::path::Path) -> PhoneVault {
        PhoneVault::open(dir, Arc::new(Xor(0xa5)), Arc::new(Xor(0x5a))).unwrap()
    }

    fn read(dir: &std::path::Path) -> Value {
        serde_json::from_slice(&std::fs::read(dir.join(MASTER_FILE_NAME)).unwrap()).unwrap()
    }

    fn write(dir: &std::path::Path, value: &Value) {
        std::fs::write(
            dir.join(MASTER_FILE_NAME),
            serde_json::to_vec(value).unwrap(),
        )
        .unwrap();
    }

    use serde_json::Value;

    #[test]
    fn a_kept_key_survives_a_restart_and_unlocks_to_its_own_key() {
        let dir = tempfile::tempdir().unwrap();
        let secret = [3u8; 32];
        vault(dir.path())
            .store_master("scid1", 2, Secret::new(secret))
            .unwrap();
        let again = vault(dir.path());
        assert_eq!(again.master_index("scid1").unwrap(), Some(2));
        assert_eq!(again.master_index("scid2").unwrap(), None);
        let unlocked = again.unlock("scid1", MasterUse::Revoke, 100).unwrap();
        let signer = unlocked.signer(100).unwrap();
        assert_eq!(signer.key(), KeySigner::new(&secret, 2).key());
        assert!(!std::fs::read_to_string(dir.path().join(MASTER_FILE_NAME))
            .unwrap()
            .contains(&STANDARD.encode(secret)));
    }

    // An entry whose index or key was edited no longer matches its tag: it names no key, and
    // an unlock refuses it.
    #[test]
    fn an_edited_entry_names_no_key() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path())
            .store_master("scid1", 0, Secret::new([3; 32]))
            .unwrap();
        let mut file = read(dir.path());
        file["kept"][0]["index"] = 1.into();
        write(dir.path(), &file);
        let edited = vault(dir.path());
        assert_eq!(edited.master_index("scid1").unwrap(), None);
        assert!(matches!(
            edited.unlock("scid1", MasterUse::Link, 0),
            Err(VaultError::Tampered)
        ));

        // A seed sealed for another identity does not pass as this one's.
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        v.store_master("scid2", 0, Secret::new([4; 32])).unwrap();
        let mut file = read(dir.path());
        file["kept"][0]["sealed"] = file["kept"][1]["sealed"].clone();
        write(dir.path(), &file);
        assert_eq!(vault(dir.path()).master_index("scid1").unwrap(), None);
    }

    #[test]
    fn a_staged_key_is_promoted_or_discarded_by_its_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        v.store_master("scid1", 0, Secret::new([3; 32])).unwrap();
        let mine = StageToken([1; 16]);
        let theirs = StageToken([2; 16]);
        v.stage_master("scid1", 1, Secret::new([4; 32]), &mine)
            .unwrap();
        assert_eq!(v.staged_index("scid1").unwrap(), Some(1));
        v.discard_staged("scid1", 1, Some(&theirs)).unwrap();
        assert_eq!(v.staged_index("scid1").unwrap(), Some(1));
        v.promote_master("scid1", 1).unwrap();
        let again = vault(dir.path());
        assert_eq!(again.staged_index("scid1").unwrap(), None);
        assert_eq!(again.master_index("scid1").unwrap(), Some(1));
        let signer = again.unlock("scid1", MasterUse::SendMaster, 0).unwrap();
        assert_eq!(
            signer.signer(0).unwrap().key(),
            KeySigner::new(&[4; 32], 1).key()
        );
        again.forget_master("scid1").unwrap();
        assert_eq!(vault(dir.path()).master_index("scid1").unwrap(), None);
    }

    #[test]
    fn pushes_are_kept_until_done() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(dir.path());
        let push = PendingPush {
            scid: "scid1".into(),
            key_id: "d3".into(),
        };
        v.keep_push(&push).unwrap();
        v.keep_push(&push).unwrap();
        assert_eq!(
            vault(dir.path()).pending_pushes().unwrap(),
            vec![push.clone()]
        );
        v.push_done(&push).unwrap();
        assert!(vault(dir.path()).pending_pushes().unwrap().is_empty());
    }
}
