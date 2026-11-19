//! The phone's identity through the store: `ad4m-identity-client`'s flows over a `ViaStore`
//! built from the device keys, the app's HTTP and the master-key vault.
//!
//! [`Parts::executor`] is the one place a `ViaStore` is made. Every call builds its executor
//! there, runs one flow on the calling thread (`futures-executor`'s `block_on`: a current-thread
//! runtime, which the store's `?Send` futures need) and drops it, so the device seed is open for
//! that call only. A port `ViaStore` gains is one line there.
//!
//! What leaves for the app is public: dids, key ids, fingerprints, match codes, device names
//! from the record, and progress. The master seed stays in the vault and the record key in the
//! flows.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use ad4m_identity_client::flows::{master, requests, revoke};
use ad4m_identity_client::record::{self, Change};
use ad4m_identity_client::{
    ClientError, ExecutorRpc, OsRandom, RpcError, StoreEndpoint, SystemClock, Vault, VaultError,
    ViaExecutor, ViaStore,
};
use ad4m_identity_core::link::{match_code, may_keep_master};
use ad4m_identity_core::record::{DeviceEntry, DeviceKind, HoldsMaster};
use ad4m_identity_core::{Event, KelChain};
use ad4m_ldk::identity::DeviceRequestBody;
use futures_executor::block_on;

use crate::checkpoint::FileCheckpoints;
use crate::holder::HolderLink;
use crate::ports::{PhoneEncKey, StoreTransport, Transport, CANCELLED};
use crate::vault::{MasterSealer, PhoneVault, INVALIDATED, WEAK_PROTECTION};
use crate::{DeviceKeys, PhoneKeyError};

pub(crate) type Executor = ViaExecutor<ViaStore>;

/// The identity store the app is built with: its base URL and the store keys a signed head must
/// be signed by (the desktop's `AD4M_IDENTITY_STORE_URL` and `AD4M_IDENTITY_STORE_KEYS`).
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct StoreConfig {
    pub url: String,
    /// Ed25519 multikeys, `z6Mk…`. Empty: every signed call refuses `no-store-keys`.
    pub keys: Vec<String>,
}

/// What every executor is built from. `Send`, so a holder's link takes a copy to its thread.
#[derive(Clone)]
pub(crate) struct Parts {
    pub keys: Arc<DeviceKeys>,
    pub transport: Arc<dyn StoreTransport>,
    pub store: StoreConfig,
}

/// Why a phone the store lists as revoked is in no identity: another device revoked its key.
pub const REMOVED: &str = "Another device removed this phone from your identity.";

/// Records the identity whose log lists this phone's device key, when the key file names none:
/// its did, or `None` when the store puts the key in no log. A make or a restore publishes before
/// the key file records the identity, so a crash or a failed write between the two leaves the
/// phone in a log the key file does not name. The store's answer is checked: `ViaStore` takes
/// the key index's identity only when that identity's verified log lists this key. A log that
/// lists the key as revoked is not recorded: another device removed this phone, and it refuses
/// [`REMOVED`].
pub(crate) fn rejoin(parts: &Parts, exec: &Executor) -> Result<Option<String>, PhoneKeyError> {
    let status = block_on(exec.status()).map_err(rpc)?;
    let Some(did) = status.did else {
        return Ok(None);
    };
    if let Some(seq) = status.revoked {
        log::warn!("phone: the store lists this phone in {did}, revoked at {seq}: not recorded");
        return Err(PhoneKeyError::Refused {
            reason: REMOVED.into(),
        });
    }
    let scid = ad4m_identity_core::scid_of(&did).ok_or_else(|| PhoneKeyError::Refused {
        reason: format!("{did} is not a did:scid:coasys:1"),
    })?;
    parts.keys.record_identity(scid, None, &parts.store_url())?;
    log::warn!("phone: the store lists this phone in {did} and the key file did not: recorded");
    Ok(Some(did))
}

impl Parts {
    /// The phone's executor: the one `ViaStore` of this crate. The store is the one the phone
    /// joined at, else the one the app is built with; `cancelled` stops a holder's link.
    pub(crate) fn executor(
        &self,
        cancelled: Option<Arc<AtomicBool>>,
    ) -> Result<Executor, PhoneKeyError> {
        let parts = self.keys.parts()?;
        let url = parts
            .identity
            .as_ref()
            .and_then(|j| j.store.clone())
            .unwrap_or_else(|| self.store.url.clone());
        let store = ViaStore::new(
            Box::new(Transport::new(self.transport.clone(), cancelled)),
            Box::new(parts.signing),
            Box::new(PhoneEncKey::new(
                self.keys.sealer(),
                parts.sealed_enc,
                parts.enc,
            )),
            Box::new(SystemClock),
            Box::new(OsRandom),
            StoreEndpoint {
                url: url.trim_end_matches('/').to_string(),
                keys: self.store.keys.clone(),
            },
            parts.identity.map(|j| j.scid),
        )
        .with_can_keep_master(true)
        .with_checkpoints(Box::new(FileCheckpoints::new(&self.keys.dir())));
        Ok(ViaExecutor::new(store))
    }

    /// The scid and did of the identity the key file records. When it records none, the identity
    /// the store's verified log puts this phone's key in is recorded first ([`rejoin`]). A store
    /// that does not answer leaves it `NoIdentity`, as the key file says; one that lists the key
    /// as revoked refuses [`REMOVED`].
    pub(crate) fn member(&self) -> Result<(String, String), PhoneKeyError> {
        if let Some(member) = self.keys.status().identity {
            return Ok((member.scid, member.did));
        }
        match self.executor(None).and_then(|exec| rejoin(self, &exec)) {
            Ok(Some(_)) => {}
            Ok(None) => return Err(PhoneKeyError::NoIdentity),
            Err(PhoneKeyError::Refused { reason }) if reason == REMOVED => {
                return Err(PhoneKeyError::Refused { reason });
            }
            Err(e) => {
                log::info!("phone: the store did not say which identity lists this phone: {e}");
                return Err(PhoneKeyError::NoIdentity);
            }
        }
        let member = self
            .keys
            .status()
            .identity
            .ok_or(PhoneKeyError::NoIdentity)?;
        Ok((member.scid, member.did))
    }

    pub(crate) fn store_url(&self) -> String {
        self.keys
            .parts()
            .ok()
            .and_then(|p| p.identity.and_then(|j| j.store))
            .unwrap_or_else(|| self.store.url.clone())
            .trim_end_matches('/')
            .to_string()
    }
}

/// `ClientError` as the app sees it.
pub(crate) fn phone_error(e: ClientError) -> PhoneKeyError {
    match e {
        ClientError::Vault(v) => vault_error(v),
        ClientError::Rpc(RpcError { code, message }) => {
            if message.contains(CANCELLED) {
                PhoneKeyError::Cancelled
            } else if code >= 500 || code == 429 {
                PhoneKeyError::Unavailable { reason: message }
            } else if code == 410 {
                ended(message)
            } else {
                PhoneKeyError::Refused {
                    reason: format!("{message} ({code})"),
                }
            }
        }
        ClientError::OfferEnded(reason) => ended(reason),
        ClientError::NotAKeeper(key) => PhoneKeyError::NotAKeeper { key },
        ClientError::NeedsWords => PhoneKeyError::NeedsWords,
        other => PhoneKeyError::Refused {
            reason: other.to_string(),
        },
    }
}

/// A link, request or offer that ended at the store: in the person's words, with the store's state
/// (`expired`, `cancelled`, …) kept after it for whoever reads a report.
fn ended(state: String) -> PhoneKeyError {
    PhoneKeyError::Ended {
        reason: format!("This has ended. Start again. ({state})"),
    }
}

pub(crate) fn vault_error(e: VaultError) -> PhoneKeyError {
    match e {
        VaultError::Cancelled => PhoneKeyError::Cancelled,
        VaultError::NoScreenLock => PhoneKeyError::NoBiometrics,
        VaultError::NotFound => PhoneKeyError::NoMasterKey,
        VaultError::Unavailable(reason) => {
            if let Some(protection) = reason.strip_prefix(WEAK_PROTECTION) {
                PhoneKeyError::WeakProtection {
                    protection: protection.to_string(),
                }
            } else if reason.starts_with(INVALIDATED) {
                PhoneKeyError::KeyInvalidated
            } else {
                PhoneKeyError::Sealer { reason }
            }
        }
        VaultError::Expired => PhoneKeyError::Ended {
            reason: "Unlock timed out. Try again.".into(),
        },
        VaultError::Tampered => PhoneKeyError::Damaged {
            reason: "the master-key file does not match its tag".into(),
        },
    }
}

pub(crate) fn rpc(e: RpcError) -> PhoneKeyError {
    phone_error(ClientError::Rpc(e))
}

/// "ABCD EFGH": the last eight characters of a signing key, as the desktop shows them.
pub(crate) fn fingerprint(sign: &str) -> String {
    let chars: Vec<char> = sign.chars().collect();
    let tail: String = chars[chars.len().saturating_sub(8)..].iter().collect();
    let (a, b) = tail.split_at(tail.len().min(4));
    format!("{a} {b}").trim().to_string()
}

/// The log of `did` and its fold.
pub(crate) fn log_of(exec: &Executor, did: &str) -> Result<(Vec<Event>, KelChain), PhoneKeyError> {
    let events = block_on(exec.events(did)).map_err(rpc)?;
    let chain = ad4m_identity_core::fold(&events).map_err(|e| PhoneKeyError::Refused {
        reason: format!(
            "the identity's log does not fold: {}",
            ad4m_identity_core::error_code(&e)
        ),
    })?;
    Ok((events, chain))
}

/// The record's devices; none when the identity has no record yet. A record that is there and
/// cannot be read (it does not open, the store's receipt does not verify, it is older than one
/// read before) is an error, never an empty list: shown as one, every device would lose its name
/// and kind and read as "Device d3", and nobody would know the record was the problem.
fn record_devices(
    exec: &Executor,
    vault: &dyn Vault,
    did: &str,
) -> Result<std::collections::BTreeMap<String, DeviceEntry>, PhoneKeyError> {
    match block_on(record::read(exec, vault, did)).map_err(phone_error)? {
        Some(opened) => Ok(opened.record.devices),
        None => Ok(Default::default()),
    }
}

/// A device's name: the record's, else "Device d3".
fn device_name(devices: &std::collections::BTreeMap<String, DeviceEntry>, key_id: &str) -> String {
    devices
        .get(key_id)
        .map(|d| d.name.clone())
        .unwrap_or_else(|| format!("Device {key_id}"))
}

/// Where the phone stands in its identity.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct IdentityView {
    pub did: String,
    /// This phone's id in the log (`d3`); `None` before the store lists it.
    pub key_id: Option<String>,
    pub fingerprint: String,
    /// The seq that revoked this phone's key.
    pub revoked: Option<u64>,
    /// The index of the master key this phone keeps, when it keeps one (no prompt).
    pub master_index: Option<u32>,
    /// What the master-key sealer's key has: `strongbox`, `tee`, `software` or `unknown`.
    pub protection: String,
    pub store: String,
    /// The log's head seq.
    pub head: Option<u64>,
}

/// A master key the phone took from its inbox.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct MasterTaken {
    pub did: String,
    pub index: u32,
    /// Set when the vault keeps the key but the record does not say so yet: other devices will
    /// see this phone as holding it after a later write.
    pub note: Option<String>,
}

/// A request this phone posted.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct AskedView {
    pub request_id: String,
    pub key_id: String,
    pub fingerprint: String,
    /// The code the answering device shows beside the request.
    pub code: String,
}

/// A request of another device, as the holder sees it.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct RequestView {
    pub id: String,
    /// `send-master` or `confirm-revoke`.
    pub kind: String,
    /// The posting device key's id.
    pub by: String,
    pub device: String,
    pub fingerprint: String,
    /// The code the posting device shows.
    pub code: String,
    /// For `confirm-revoke`: the names of the devices to revoke.
    pub targets: Vec<String>,
    /// For `confirm-revoke`: the key ids of the devices to revoke, as the request names them, in
    /// the order of `targets`. The ids say which keys go; the names are the record's, which any
    /// linked device can write.
    pub target_keys: Vec<String>,
    pub rotate: bool,
    pub expires: u64,
    /// Why it cannot be answered (its poster does not check); `None` when it can.
    pub problem: Option<String>,
}

/// A request answered.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct AnswerView {
    pub kind: String,
    pub device: String,
    /// A step after the answer that did not pass (the record write), which the answer stands
    /// without.
    pub note: Option<String>,
}

/// One device of the identity: the log's key with the record's details.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct DeviceView {
    pub key_id: String,
    pub fingerprint: String,
    pub name: String,
    /// The record's kind (`phone-app`, `desktop-app`, …); `None` when the record does not list it.
    pub kind: Option<String>,
    pub added_seq: u64,
    pub revoked_seq: Option<u64>,
    pub this_device: bool,
    /// `yes`, `offered` or `no`, per the record.
    pub holds_master: String,
    pub master_index: Option<u32>,
    /// The log lets it keep the master key.
    pub may_keep_master: bool,
    pub bot: bool,
}

/// The wire name of a request's kind.
fn request_kind(body: &DeviceRequestBody) -> &'static str {
    match body {
        DeviceRequestBody::SendMaster {} => "send-master",
        DeviceRequestBody::ConfirmRevoke { .. } => "confirm-revoke",
    }
}

pub(crate) fn kind_name(kind: DeviceKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

/// This phone's entry as the record should give it, when `entry` gives it otherwise: a phone app,
/// which runs no executor (it signs in to one elsewhere), so it has no place. The device that adds
/// the phone cannot tell: a claim says only whether a device may keep the master key, so a phone
/// added through a node offer is written as a server. Name, master key and the rest are kept.
pub(crate) fn as_phone(entry: &DeviceEntry) -> Option<DeviceEntry> {
    if entry.kind == DeviceKind::PhoneApp && entry.place.is_none() && !entry.runs_executor {
        return None;
    }
    Some(DeviceEntry {
        kind: DeviceKind::PhoneApp,
        place: None,
        runs_executor: false,
        ..entry.clone()
    })
}

/// Whether this phone owes the record its mark for the master key it keeps: its custody note is
/// a receipt for the index the vault keeps ([`ad4m_identity_client::CustodyNote::landed`]) — a
/// take kept the key and its record write was cancelled or failed. Reads the log's status and
/// the vault's note: no prompt.
async fn receipt_owed(
    exec: &Executor,
    vault: &PhoneVault,
    scid: &str,
) -> Result<bool, ClientError> {
    let Some(key_id) = exec.status().await?.key_id else {
        return Ok(false);
    };
    Ok(match vault.custody_note(scid, &key_id)? {
        Some(note) => note.landed(vault, scid)?,
        None => false,
    })
}

/// The phone's identity: its device keys, the store, and its master-key vault.
#[derive(uniffi::Object)]
pub struct PhoneIdentity {
    parts: Parts,
    vault: Arc<PhoneVault>,
}

impl PhoneIdentity {
    /// What a flow's thread takes with it: a copy of the parts and the vault.
    pub(crate) fn inner(&self) -> (Parts, Arc<PhoneVault>) {
        (self.parts.clone(), self.vault.clone())
    }
}

#[uniffi::export]
impl PhoneIdentity {
    /// The identity of `keys`, through `transport` to the store `store`, keeping a master key
    /// sealed by `master` in the key directory.
    #[uniffi::constructor]
    pub fn new(
        keys: Arc<DeviceKeys>,
        transport: Arc<dyn StoreTransport>,
        master: Arc<dyn MasterSealer>,
        store: StoreConfig,
    ) -> Result<Arc<Self>, PhoneKeyError> {
        let vault = PhoneVault::open(&keys.dir(), master, keys.sealer())?;
        Ok(Arc::new(PhoneIdentity {
            parts: Parts {
                keys,
                transport,
                store,
            },
            vault: Arc::new(vault),
        }))
    }

    /// Where the phone stands, from the store's log and the vault (no prompt).
    pub fn status(&self) -> Result<IdentityView, PhoneKeyError> {
        let (scid, did) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        let status = block_on(exec.status()).map_err(rpc)?;
        Ok(IdentityView {
            did,
            key_id: status.key_id,
            fingerprint: fingerprint(&status.device_key),
            revoked: status.revoked,
            master_index: self.vault.master_index(&scid).map_err(vault_error)?,
            protection: self.vault.protection(),
            store: self.parts.store_url(),
            head: status.head.map(|h| h.seq),
        })
    }

    /// Takes a master key a holder put into this phone's inbox: checks it is the log's current
    /// master, seals it behind the biometric (one prompt), acknowledges the message, and marks
    /// this phone as holding it in the record, in that order. When that record write waits for
    /// the recovery key's re-attestation after a rotation ([`master::Taken::record_pending`]),
    /// the master just taken signs it itself ([`master::complete_pending_mark`], a second
    /// prompt): ad4m keeps no repair queue, so a take not completed here would leave the record's
    /// recovery key stale and the phone unlisted.
    ///
    /// With no master key waiting, the mark this phone still owes for the key it keeps (a take
    /// whose record write was cancelled or failed, before a restart or not: its custody note is a
    /// receipt that has landed, [`receipt_owed`]) is made now, the person's tap being the
    /// consent its prompt needs ([`master::refresh_master`], one prompt when the master signs).
    /// `None` when neither is there.
    ///
    /// `WeakProtection` before any prompt when the phone's key store is not secure hardware:
    /// the app asks the person once and calls again with `allow_weak_protection`.
    pub fn take_master(
        &self,
        allow_weak_protection: bool,
    ) -> Result<Option<MasterTaken>, PhoneKeyError> {
        let (scid, did) = self.parts.member()?;
        self.vault.allow_weak_protection(allow_weak_protection);
        let exec = self.parts.executor(None)?;
        let vault = self.vault.as_ref();
        let taken = block_on(async {
            if let Some(mut taken) = master::take_master(&exec, vault, &OsRandom).await? {
                if taken.record_pending {
                    taken.record = master::complete_pending_mark(
                        &exec,
                        vault,
                        &taken.did,
                        &SystemClock,
                        &OsRandom,
                    )
                    .await;
                    taken.record_pending = taken.record.is_err();
                }
                return Ok(Some((taken.did, taken.index, taken.record.err())));
            }
            if !receipt_owed(&exec, vault, &scid).await? {
                return Ok(None);
            }
            Ok(
                match master::refresh_master(&exec, vault, &did, &SystemClock, &OsRandom).await? {
                    master::Refreshed::Repaired { index, record }
                    | master::Refreshed::Promoted { index, record } => {
                        Some((did.clone(), index, record.err()))
                    }
                    master::Refreshed::Taken(taken) => {
                        Some((taken.did, taken.index, taken.record.err()))
                    }
                    master::Refreshed::Current
                    | master::Refreshed::Asked(_)
                    | master::Refreshed::Unknown => None,
                },
            )
        })
        .map_err(phone_error)?;
        Ok(taken.map(|(did, index, error)| MasterTaken {
            did,
            index,
            note: error.map(|e| {
                format!("The master key is kept here, but the device list was not updated: {e}")
            }),
        }))
    }

    /// The way back after the phone's master-key file, or this identity's epoch entry in it,
    /// was lost: on purpose, never automatically — a fresh epoch under a fresh incarnation, so
    /// a removal paused across the loss keeps the key rather than forgets it. Answers the new
    /// custody epoch. The app takes it where it takes the desktop's
    /// (`crates/custody`) `recover_custody_epoch`.
    pub fn recover_custody_epoch(&self) -> Result<u64, PhoneKeyError> {
        let (scid, _) = self.parts.member()?;
        self.vault.recover_custody_epoch(&scid).map_err(vault_error)
    }

    /// Asks the devices that hold the master key to send it to this phone: a `send-master`
    /// request, which a holder answers behind its own prompt. The code is the one the holder
    /// shows beside it.
    pub fn ask_for_master(&self) -> Result<AskedView, PhoneKeyError> {
        let (scid, _) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        let status = block_on(exec.status()).map_err(rpc)?;
        let key_id = status.key_id.ok_or(PhoneKeyError::NoIdentity)?;
        let id = block_on(requests::ask_for_master(&exec, None)).map_err(phone_error)?;
        Ok(AskedView {
            code: match_code(&scid, &id, &status.device_key),
            request_id: id,
            key_id,
            fingerprint: fingerprint(&status.device_key),
        })
    }

    /// Whether "Take the master key" has something to do, without doing it: a master key another
    /// device sent waits in this phone's inbox, or the mark for the key this phone keeps is still
    /// owed to the record ([`receipt_owed`]), which [`Self::take_master`] makes. No prompt, and a
    /// waiting message stays for the take. Reads the store, so a key put there since the last
    /// read is seen.
    pub fn master_waiting(&self) -> Result<bool, PhoneKeyError> {
        let (scid, _) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        let listed =
            block_on(exec.rpc().call("identity.inbox", serde_json::json!({}))).map_err(rpc)?;
        if listed
            .as_array()
            .is_some_and(|messages| messages.iter().any(|m| m["kind"] == "master"))
        {
            return Ok(true);
        }
        block_on(receipt_owed(&exec, self.vault.as_ref(), &scid)).map_err(phone_error)
    }

    /// The requests of the identity's other devices, newest last.
    pub fn requests(&self) -> Result<Vec<RequestView>, PhoneKeyError> {
        let (scid, did) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        let status = block_on(exec.status()).map_err(rpc)?;
        let listed = block_on(exec.requests(0)).map_err(rpc)?;
        let (_, chain) = log_of(&exec, &did)?;
        let devices = record_devices(&exec, self.vault.as_ref(), &did)?;
        let state = chain.state();
        Ok(listed
            .into_iter()
            .filter(|r| Some(&r.by) != status.key_id.as_ref())
            .map(|r| {
                let sign = state
                    .keys
                    .get(&r.by)
                    .map(|k| k.sign.clone())
                    .unwrap_or_default();
                let (targets, target_keys, rotate) = match &r.body {
                    DeviceRequestBody::SendMaster {} => (Vec::new(), Vec::new(), false),
                    DeviceRequestBody::ConfirmRevoke { key_ids, rotate } => (
                        key_ids.iter().map(|k| device_name(&devices, k)).collect(),
                        key_ids.clone(),
                        *rotate,
                    ),
                };
                RequestView {
                    kind: request_kind(&r.body).to_string(),
                    device: device_name(&devices, &r.by),
                    fingerprint: fingerprint(&sign),
                    code: match_code(&scid, &r.id, &sign),
                    targets,
                    target_keys,
                    rotate,
                    expires: r.expires,
                    problem: requests::check_poster(&r, &did, &chain)
                        .err()
                        .map(|e| e.to_string()),
                    by: r.by,
                    id: r.id,
                }
            })
            .collect())
    }

    /// Answers the request `id` behind the biometric prompt: sends the master key to the
    /// poster, or signs the revocation it asks for. A request for a rotation needs the 12
    /// words, which the phone does not take: `NeedsWords`.
    pub fn answer(&self, id: String) -> Result<AnswerView, PhoneKeyError> {
        let (_, did) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        let listed = block_on(exec.requests(0)).map_err(rpc)?;
        let request =
            listed
                .into_iter()
                .find(|r| r.id == id)
                .ok_or_else(|| PhoneKeyError::Ended {
                    reason: "This request was already answered, or it expired.".into(),
                })?;
        let devices = record_devices(&exec, self.vault.as_ref(), &did)?;
        let device = device_name(&devices, &request.by);
        let answered = block_on(requests::answer(
            &exec,
            self.vault.as_ref(),
            &did,
            &request,
            &SystemClock,
            &OsRandom,
        ))
        .map_err(phone_error)?;
        let note = |what: &str, e: ClientError| format!("{what} ({e})");
        let note = match answered {
            requests::Answered::MasterSent(sent) => sent
                .record
                .err()
                .map(|e| note("Master key sent. Your device list shows this after its next change.", e)),
            requests::Answered::Revoked(revoked) => revoked
                .record
                .err()
                .map(|e| note("Devices removed. Your device list shows this after its next change.", e)),
            requests::Answered::Rotated { deleted, .. } => deleted
                .err()
                .map(|e| note("Master key replaced. The request may still show on your other devices until it expires.", e)),
        };
        Ok(AnswerView {
            kind: request_kind(&request.body).to_string(),
            device,
            note,
        })
    }

    /// The identity's devices: every device key of the log, named and marked from the record.
    pub fn devices(&self) -> Result<Vec<DeviceView>, PhoneKeyError> {
        let (_, did) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        let status = block_on(exec.status()).map_err(rpc)?;
        let (events, chain) = log_of(&exec, &did)?;
        let mut devices = record_devices(&exec, self.vault.as_ref(), &did)?;
        if let Some(own) = &status.key_id {
            if let Some(fixed) = self.say_phone(&exec, &did, own, devices.get(own)) {
                devices.insert(own.clone(), fixed);
            }
        }
        Ok(chain
            .state()
            .keys
            .values()
            .map(|key| {
                let entry = devices.get(&key.id);
                DeviceView {
                    key_id: key.id.clone(),
                    fingerprint: fingerprint(&key.sign),
                    name: device_name(&devices, &key.id),
                    kind: entry.map(|e| kind_name(e.kind)),
                    added_seq: key.added,
                    revoked_seq: key.revoked,
                    this_device: Some(&key.id) == status.key_id.as_ref(),
                    holds_master: match entry.map(|e| e.holds_master) {
                        Some(HoldsMaster::Yes) => "yes",
                        Some(HoldsMaster::Offered) => "offered",
                        _ => "no",
                    }
                    .to_string(),
                    master_index: entry.and_then(|e| e.master_index),
                    may_keep_master: may_keep_master(&events, &key.id),
                    bot: !key.scopes.is_empty(),
                }
            })
            .collect())
    }

    /// Names the device `key_id` in the record.
    pub fn rename(&self, key_id: String, name: String) -> Result<(), PhoneKeyError> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(crate::invalid("a device needs a name"));
        }
        let (_, did) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        block_on(record::write(
            &exec,
            self.vault.as_ref(),
            &did,
            &[Change::Rename { key_id, name }],
            &OsRandom,
        ))
        .map_err(phone_error)?;
        Ok(())
    }

    /// Revokes the devices `key_ids`, signed with the master key behind the prompt.
    pub fn revoke(&self, key_ids: Vec<String>) -> Result<Option<String>, PhoneKeyError> {
        let (_, did) = self.parts.member()?;
        let exec = self.parts.executor(None)?;
        let revoked = block_on(revoke::revoke(
            &exec,
            self.vault.as_ref(),
            &did,
            &key_ids,
            &SystemClock,
            &OsRandom,
        ))
        .map_err(phone_error)?;
        Ok(revoked.record.err().map(|e| {
            format!("Devices removed. Your device list shows this after its next change. ({e})")
        }))
    }

    /// Adds the device whose `coasys:device:1:` code this phone scanned: puts its ticket in the
    /// device's inbox (after the biometric prompt) and waits for its claim, on a thread of the
    /// link's own.
    pub fn scan_device(&self, code: String) -> Result<Arc<HolderLink>, PhoneKeyError> {
        let (_, did) = self.parts.member()?;
        let device = ad4m_identity_core::link::DeviceString::parse(code.trim())
            .map_err(|e| crate::invalid(format!("that is not a device code: {e}")))?;
        HolderLink::start(self.parts.clone(), self.vault.clone(), did, device)
    }
}

impl PhoneIdentity {
    /// Writes this phone's own entry as a phone app ([`as_phone`]) when the record says otherwise,
    /// and answers the entry written. Only over the version `listed` was read from: a version
    /// where another device changed the entry since (marked the master key offered, renamed it)
    /// is left alone, and the next read tries again. Best effort: a write that fails changes
    /// nothing the phone shows of its own row, which the app names "This phone" either way.
    fn say_phone(
        &self,
        exec: &Executor,
        did: &str,
        key_id: &str,
        listed: Option<&DeviceEntry>,
    ) -> Option<DeviceEntry> {
        let listed = listed?;
        let fixed = as_phone(listed)?;
        let unchanged = |record: Option<&ad4m_identity_core::record::PrivateRecord>,
                         _: &KelChain| {
            if record.and_then(|r| r.devices.get(key_id)) == Some(listed) {
                Ok(())
            } else {
                Err(ClientError::Step(
                    "this phone's entry changed since it was read",
                ))
            }
        };
        block_on(record::write_if(
            exec,
            self.vault.as_ref(),
            did,
            &[Change::Device {
                key_id: key_id.to_string(),
                entry: fixed.clone(),
            }],
            &unchanged,
            &OsRandom,
        ))
        .ok()
        .map(|_| fixed)
    }
}
