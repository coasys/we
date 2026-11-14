//! The phone's device keys, exported to the phone app through uniffi.
//!
//! A phone that joins an identity has two keys of its own: an Ed25519 **device key**, which the
//! identity's key log lists and which signs the phone's logins, and an X25519 **enc key**, which a
//! holder seals the master key (and inbox messages) to. Both are made here from the OS's random
//! source and are kept only as seeds sealed by a [`Sealer`] the app hands in: on Android a
//! non-exportable Keystore AES-GCM key, in StrongBox when the phone has one and otherwise at
//! whatever level the Keystore gives (TEE, or software on an emulator), which the app reports. The
//! seeds themselves are software keys: only the sealing key can be in secure hardware. A seed is
//! opened for the one signature that needs it, and this crate's copies are zeroed when the
//! signature is made. UniFFI's own copies are not: a seed crossing the FFI (`seal`'s argument,
//! `open`'s result) passes through serialisation buffers that nothing zeroes (the phone app's
//! README, "Known limits").
//!
//! What leaves this crate is public: multikeys, the `did:key`, a signed key statement, a claim
//! (which carries the offer's secret `s` back to the store that issued it, and the device's public
//! keys). Nothing here signs arbitrary bytes: every signature is under a domain this crate chose
//! (`coasys:session`, `coasys:claim`), over a value it shaped.
//!
//! One phone, one identity, one key file: [`DeviceKeys`] over a directory the app chooses (on
//! Android its no-backup directory, so the sealed seeds are never copied off the phone: the
//! Keystore key could not open them anywhere else anyway).

uniffi::setup_scaffolding!();

mod checkpoint;
mod claim;
mod file;
mod holder;
mod identity;
mod ports;
mod session;
mod vault;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use ed25519_dalek::SigningKey;
use zeroize::Zeroizing;

pub use claim::{ClaimProgress, PreparedClaim};
pub use holder::{HolderLink, LinkStep};
pub use identity::{
    AnswerView, AskedView, DeviceView, IdentityView, MasterTaken, PhoneIdentity, RequestView,
    StoreConfig,
};
pub use ports::{Header, StoreReply, StoreRequest, StoreTransport, TransportError};
pub use session::{SessionPurpose, SessionRequest};
pub use vault::{MasterSealError, MasterSealer};

use file::KeyFile;

/// The labels a seed is sealed under. The sealer binds the label to the sealed bytes (as AES-GCM
/// associated data), so the enc seed can never be opened as the signing seed, nor the reverse.
pub const SIGN_LABEL: &str = "coasys:phone-seed:sign:1";
pub const ENC_LABEL: &str = "coasys:phone-seed:enc:1";

/// What seals and opens a seed: the platform's key store. The app implements it (Kotlin, over the
/// Android Keystore); the tests implement it in Rust.
///
/// `open` returns the seed; [`Sealer::wipe`] is called as soon as the seed is copied out, so the
/// implementation can zero the copy it handed back, which the language it is written in may
/// otherwise keep until a garbage collector frees it. That covers the implementation's copy and
/// this crate's, not the buffers UniFFI serialises the bytes through on the way, which stay as
/// they were left.
#[uniffi::export(with_foreign)]
pub trait Sealer: Send + Sync {
    /// The sealed form of `plaintext`, bound to `label`.
    fn seal(&self, label: String, plaintext: Vec<u8>) -> Result<Vec<u8>, SealError>;
    /// The plaintext of `sealed`, which must have been sealed under `label`.
    fn open(&self, label: String, sealed: Vec<u8>) -> Result<Vec<u8>, SealError>;
    /// Zero every plaintext `open` has returned.
    fn wipe(&self);
}

/// The sealer's refusal: the key store is locked, the key is gone, the bytes do not open.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum SealError {
    #[error("{reason}")]
    Failed { reason: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for SealError {
    fn from(e: uniffi::UnexpectedUniFFICallbackError) -> Self {
        SealError::Failed { reason: e.reason }
    }
}

/// Why a device-key call did not do what it was asked. Flat across the FFI: the app sees the
/// variant (its code) and the sentence, which is all it shows.
#[derive(Debug, thiserror::Error, uniffi::Error)]
#[uniffi(flat_error)]
pub enum PhoneKeyError {
    #[error("this phone has no device key yet")]
    NoKeys,
    #[error("this phone already has a device key")]
    KeysExist,
    #[error("this phone is in no identity yet")]
    NoIdentity,
    #[error("this phone is already in {did}")]
    AlreadyJoined { did: String },
    #[error("no claim is waiting for an answer")]
    NoClaim,
    #[error("the key store refused: {reason}")]
    Sealer { reason: String },
    /// A sealed seed opened to a key that is not the one on record: the file was changed, or the
    /// sealing key is not the one that sealed it.
    #[error("the sealed key does not open to the key on record")]
    Mismatch,
    #[error("the key file is damaged: {reason}")]
    Damaged { reason: String },
    #[error("{reason}")]
    Invalid { reason: String },
    #[error("the key file could not be written: {reason}")]
    Io { reason: String },
    /// The store did not answer, or answered that it is busy: a later try may pass. The app
    /// says "offline" and tries again; nothing was changed.
    #[error("the identity store is unreachable: {reason}")]
    Unavailable { reason: String },
    /// The store or the identity's log refused the step.
    #[error("{reason}")]
    Refused { reason: String },
    /// The person closed the biometric prompt.
    #[error("the fingerprint prompt was cancelled")]
    Cancelled,
    /// The phone has no biometric enrolled, so it cannot keep or use a master key.
    #[error("Set up fingerprint or face unlock to keep the master key on this phone.")]
    NoBiometrics,
    /// A biometric enrolled since the master key was kept invalidated the key that sealed it:
    /// the phone must be sent the master key again.
    #[error("a new fingerprint or face was added, so the master key kept here can no longer open")]
    KeyInvalidated,
    /// The master sealer's key is not in secure hardware, and the person has not agreed to keep
    /// the master key at `protection` anyway.
    #[error("this phone keeps keys in {protection} only, not in secure hardware")]
    WeakProtection { protection: String },
    /// This phone keeps no master key of its identity.
    #[error("this phone does not hold the master key")]
    NoMasterKey,
    /// The device may not keep the master key (its claim did not say it may).
    #[error("{key} may not keep the master key")]
    NotAKeeper { key: String },
    /// The request asks for a rotation, which needs the 12 words.
    #[error("this request replaces the master key, which needs the 12 words: answer it on your computer")]
    NeedsWords,
    /// The offer, ticket or request ended (expired, cancelled, answered elsewhere).
    #[error("it ended: {reason}")]
    Ended { reason: String },
}

impl From<SealError> for PhoneKeyError {
    fn from(e: SealError) -> Self {
        PhoneKeyError::Sealer {
            reason: e.to_string(),
        }
    }
}

fn invalid(reason: impl Into<String>) -> PhoneKeyError {
    PhoneKeyError::Invalid {
        reason: reason.into(),
    }
}

/// The phone's public keys.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct DevicePublic {
    /// The Ed25519 device key, `z6Mk…`.
    pub sign: String,
    /// The X25519 enc key, `z6LS…`.
    pub enc: String,
    /// `did:key:` of the device key.
    pub did_key: String,
}

/// The identity whose log lists this phone's device key.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct Membership {
    /// The bare scid, as the store's paths name it.
    pub scid: String,
    /// `did:scid:coasys:1:<scid>`, as a login names it.
    pub did: String,
    /// The log entry that added this phone, when the store said.
    pub seq: Option<u64>,
}

/// A claim sent and not answered yet.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct PendingClaim {
    pub did: String,
    pub offer_id: String,
    pub store: String,
    /// Where to ask how the claim stands (`GET`, `&wait=<seconds>` to hold the answer).
    pub state_url: String,
    /// The code the holder shows too.
    pub match_code: String,
}

/// Where the phone stands.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct KeyStatus {
    pub keys: Option<DevicePublic>,
    pub identity: Option<Membership>,
    pub pending: Option<PendingClaim>,
}

/// The phone's device keys, over the key file in one directory.
#[derive(uniffi::Object)]
pub struct DeviceKeys {
    path: PathBuf,
    sealer: Arc<dyn Sealer>,
    file: Mutex<Option<KeyFile>>,
}

/// Calls [`Sealer::wipe`] when dropped: after a seed is copied out, whether or not what follows
/// succeeds.
pub(crate) struct WipeOnDrop<'a>(pub(crate) &'a dyn Sealer);

impl Drop for WipeOnDrop<'_> {
    fn drop(&mut self) {
        self.0.wipe();
    }
}

#[uniffi::export]
impl DeviceKeys {
    /// The device keys kept in `dir` (the file `device-keys.json`), sealed by `sealer`. Reads the
    /// file when there is one; makes nothing.
    #[uniffi::constructor]
    pub fn open(dir: String, sealer: Arc<dyn Sealer>) -> Result<Arc<Self>, PhoneKeyError> {
        let path = PathBuf::from(dir).join(file::FILE_NAME);
        let file = file::read(&path)?;
        Ok(Arc::new(DeviceKeys {
            path,
            sealer,
            file: Mutex::new(file),
        }))
    }

    pub fn status(&self) -> KeyStatus {
        let file = self.lock();
        match file.as_ref() {
            None => KeyStatus {
                keys: None,
                identity: None,
                pending: None,
            },
            Some(f) => KeyStatus {
                keys: Some(f.public()),
                identity: f.membership(),
                pending: f.pending.as_ref().map(|p| p.public(&f.sign)),
            },
        }
    }

    /// Makes the device key and the enc key, seals both seeds and writes the key file. Refuses
    /// when the phone has keys already: a key that has been in a log is never replaced quietly.
    pub fn create(&self) -> Result<DevicePublic, PhoneKeyError> {
        let mut file = self.lock();
        if file.is_some() {
            return Err(PhoneKeyError::KeysExist);
        }
        let sign_seed = random_seed();
        let enc_seed = random_seed();
        let sign = SigningKey::from_bytes(&sign_seed);
        let enc = ad4m_identity_core::X25519Secret::from(*enc_seed);
        let made = KeyFile::new(
            ad4m_hash_chain::encode_ed25519_multikey(sign.verifying_key().as_bytes()),
            ad4m_identity_core::x25519_multikey_of(&enc),
            self.sealer.seal(SIGN_LABEL.into(), sign_seed.to_vec())?,
            self.sealer.seal(ENC_LABEL.into(), enc_seed.to_vec())?,
        );
        file::write(&self.path, &made)?;
        let public = made.public();
        *file = Some(made);
        Ok(public)
    }

    /// The claim on the offer in `link` (an offer link, or the `coasys:offer:1:` string), to post
    /// to the offer's store. Keeps the claim as pending until [`DeviceKeys::claim_answer`] hears
    /// how it ended. `hint` is the name the phone suggests for itself ("Pixel 8").
    pub fn prepare_claim(
        &self,
        link: String,
        hint: Option<String>,
    ) -> Result<PreparedClaim, PhoneKeyError> {
        let mut guard = self.lock();
        let file = guard.as_mut().ok_or(PhoneKeyError::NoKeys)?;
        if let Some(member) = file.membership() {
            return Err(PhoneKeyError::AlreadyJoined { did: member.did });
        }
        let offer = claim::parse_offer(&link)?;
        let sign = self.signing_key(file)?;
        let (prepared, pending) = claim::prepare(&offer, &sign, &file.enc, hint)?;
        drop(sign);
        let mut next = file.clone();
        next.pending = Some(pending);
        file::write(&self.path, &next)?;
        *file = next;
        Ok(prepared)
    }

    /// What the store answered about the pending claim: `status` and `body` of either the claim's
    /// POST or its `state` GET. A `spent` state (the holder confirmed, and the log lists this
    /// phone) records the identity; a refusal or an offer that ended drops the pending claim.
    pub fn claim_answer(&self, status: u16, body: String) -> Result<ClaimProgress, PhoneKeyError> {
        let mut guard = self.lock();
        let file = guard.as_mut().ok_or(PhoneKeyError::NoKeys)?;
        let pending = file.pending.clone().ok_or(PhoneKeyError::NoClaim)?;
        let progress = claim::read_answer(&pending.scid, status, &body);
        let next = match &progress {
            ClaimProgress::Waiting { .. } => return Ok(progress),
            ClaimProgress::Joined { member } => file.joined(member),
            ClaimProgress::Ended { .. } => file.without_pending(),
        };
        file::write(&self.path, &next)?;
        *file = next;
        Ok(progress)
    }

    /// A `coasys:session` key statement for one executor, signed by the device key: what
    /// `user.loginWithKey` and `user.renewSession` take, as JSON `{statement, sig}`. The identity
    /// and the key come from the key file, the time from this phone's clock.
    pub fn sign_session(&self, request: SessionRequest) -> Result<String, PhoneKeyError> {
        self.sign_session_at(request, session::now())
    }
}

/// What the phone's executor is built from ([`identity`]'s one `ViaStore`): the device key opened
/// for that executor's life, the enc key still sealed, and the identity the key file records.
pub(crate) struct DeviceParts {
    pub signing: SigningKey,
    pub sealed_enc: Vec<u8>,
    pub enc: String,
    pub identity: Option<file::Joined>,
}

impl DeviceKeys {
    pub(crate) fn parts(&self) -> Result<DeviceParts, PhoneKeyError> {
        let guard = self.lock();
        let file = guard.as_ref().ok_or(PhoneKeyError::NoKeys)?;
        Ok(DeviceParts {
            signing: self.signing_key(file)?,
            sealed_enc: file.sealed_enc()?,
            enc: file.enc.clone(),
            identity: file.identity.clone(),
        })
    }

    pub(crate) fn sealer(&self) -> Arc<dyn Sealer> {
        self.sealer.clone()
    }

    /// The directory the key file is in: the master-key file sits beside it.
    pub(crate) fn dir(&self) -> PathBuf {
        self.path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }

    fn lock(&self) -> MutexGuard<'_, Option<KeyFile>> {
        // A panic while the lock was held left the file as it was on disk, or the write before it.
        self.file
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The device key, opened for one use. Checked against the key on record.
    fn signing_key(&self, file: &KeyFile) -> Result<SigningKey, PhoneKeyError> {
        let sealed = file.sealed_sign()?;
        let _wipe = WipeOnDrop(self.sealer.as_ref());
        let plain = Zeroizing::new(self.sealer.open(SIGN_LABEL.into(), sealed)?);
        let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
            plain
                .as_slice()
                .try_into()
                .map_err(|_| PhoneKeyError::Mismatch)?,
        );
        let key = SigningKey::from_bytes(&seed);
        if ad4m_hash_chain::encode_ed25519_multikey(key.verifying_key().as_bytes()) != file.sign {
            return Err(PhoneKeyError::Mismatch);
        }
        Ok(key)
    }

    /// The enc key, opened for one use and checked against the key on record. Phase 2a has no
    /// caller outside the tests: a holder seals to the enc key, and the inbox that opens with it
    /// is phase 2b's (`apps/we-mobile/docs/phase-2b.md`).
    #[cfg(test)]
    fn enc_key(&self, file: &KeyFile) -> Result<ad4m_identity_core::X25519Secret, PhoneKeyError> {
        let sealed = file.sealed_enc()?;
        let _wipe = WipeOnDrop(self.sealer.as_ref());
        let plain = Zeroizing::new(self.sealer.open(ENC_LABEL.into(), sealed)?);
        let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
            plain
                .as_slice()
                .try_into()
                .map_err(|_| PhoneKeyError::Mismatch)?,
        );
        let key = ad4m_identity_core::X25519Secret::from(*seed);
        if ad4m_identity_core::x25519_multikey_of(&key) != file.enc {
            return Err(PhoneKeyError::Mismatch);
        }
        Ok(key)
    }

    fn sign_session_at(&self, request: SessionRequest, now: u64) -> Result<String, PhoneKeyError> {
        let guard = self.lock();
        let file = guard.as_ref().ok_or(PhoneKeyError::NoKeys)?;
        let member = file.membership().ok_or(PhoneKeyError::NoIdentity)?;
        let statement = session::statement(&request, &member.did, &file.sign, now)?;
        let sign = self.signing_key(file)?;
        session::sign(&statement, &sign)
    }
}

fn random_seed() -> Zeroizing<[u8; 32]> {
    use rand_core::RngCore;
    let mut seed = Zeroizing::new([0u8; 32]);
    rand_core::OsRng.fill_bytes(seed.as_mut());
    seed
}

#[cfg(test)]
mod tests;
