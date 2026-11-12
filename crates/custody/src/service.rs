//! The custody service: runs one identity step at a time for the identity window.
//!
//! The window sends a step and then inputs, and gets back [`Screen`]s; the service holds every
//! secret of the flow — the words until two of them come back, the seed, the unlocked master key,
//! the offer secret — and the window holds only what a screen showed it. The main window gets none
//! of it: only how the step ended, and [`CustodyPublic`].
//!
//! The flows are the identity client's (`create`, `link`, `master`, `requests`, `revoke`, and the
//! private record); the executor is reached over its WebSocket RPC with the admin credential
//! ([`ExecutorAddress`]), never in process, so moving the executor into a child process later
//! changes nothing here.
//!
//! The client's futures are not `Send` (their RPC trait is `?Send`), so the service runs on a
//! thread of its own with a current-thread runtime; [`CustodyHandle`] is the `Send` way in.

use std::sync::Arc;
use std::time::Duration;

use ad4m_client::ws_rpc::WsRpcClient;
use ad4m_identity_client::executor::IdentityStatus;
use ad4m_identity_client::flows::create::{resume, CreateFlow, CreateScreen, Created};
use ad4m_identity_client::flows::link::{Claimed, LinkFlow};
use ad4m_identity_client::flows::master::{retry_pushes, take_master};
use ad4m_identity_client::flows::requests::{self, Answered};
use ad4m_identity_client::flows::revoke::revoke;
use ad4m_identity_client::record::{self, Change};
use ad4m_identity_client::{
    ClientError, Clock, ExecutorRpc, OsRandom, Secret, SystemClock, VaultError, ViaExecutor,
};
use ad4m_identity_core::link::{DeviceString, OfferKind, CONFIRM_GRACE_S, OFFER_TTL_S};
use ad4m_identity_core::record::{DeviceEntry, DeviceKind, HoldsMaster as Holds, Place};
use ad4m_identity_core::{Event, Op};
use ad4m_ldk::identity::DeviceRequestBody;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot};

use crate::seal::{self, PassphraseProblem};
use crate::vault::{DesktopVault, Unlocking};

static CLOCK: SystemClock = SystemClock;
static RANDOM: OsRandom = OsRandom;

/// How often a device that showed its code asks whether the holder confirmed.
const JOIN_POLL: Duration = Duration::from_secs(2);

/// A change the main window may ask for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum IdentityStep {
    Create,
    /// The holder adds a server by an offer link it gives.
    AddDevice,
    /// The holder adds a device by the code that device shows ("Scan or paste a code").
    ScanDevice,
    /// This computer, a device of no identity yet, shows its code for a holder to scan.
    ShowCode,
    /// Takes the master key waiting in this device's inbox.
    TakeMaster,
    /// Asks a device that holds the master key to send it here (a `send-master` request).
    AskMaster,
    /// The holder answers a waiting request of another device.
    AnswerRequest {
        id: String,
    },
    /// Names a device in the private record.
    Rename {
        #[serde(rename = "keyId")]
        key_id: String,
    },
    Revoke {
        #[serde(rename = "keyId")]
        key_id: String,
    },
}

/// A key a `confirm-revoke` request asks to revoke, as the key log lists it: the key id and its
/// signing key's fingerprint ([`crate::keylog::fingerprint`]) say which key goes, and whether it
/// may still hold a valid master key is the log's ([`crate::keylog::device`]). `record_name`, what
/// the private record calls it, is secondary: any linked device can write it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeTarget {
    pub key_id: String,
    pub fingerprint: String,
    pub record_name: Option<String>,
    pub may_hold_master: bool,
}

/// What the identity window draws next. Only public data, except the words on `ShowWords`, which
/// is the one screen whose purpose is to show a secret — to the person, in this window.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "screen", rename_all = "kebab-case")]
pub enum Screen {
    /// The 12 words, to write on paper.
    ShowWords { words: Vec<String> },
    /// Ask for the words at these positions (from 1).
    ConfirmWords {
        positions: [usize; 2],
        error: Option<String>,
    },
    /// Choose the passphrase this computer keeps the master key behind (Linux).
    SetPassphrase { error: Option<String> },
    /// The passphrase, to unlock the master key for this step (Linux).
    EnterPassphrase { error: Option<String> },
    /// The identity exists, and this computer is its first device.
    IdentityReady {
        did: String,
        #[serde(rename = "keyId")]
        key_id: String,
    },
    /// The offer link to give the new device, and its QR code as SVG.
    Offer {
        link: String,
        #[serde(rename = "qrSvg")]
        qr_svg: String,
        expires: u64,
    },
    /// Both devices show this code; the person confirms here when they match, naming the new
    /// device. `can_keep`: it may keep the master key, so the choice is offered. `own_name`: the
    /// private record does not name this computer yet, so its name is asked too.
    Match {
        code: String,
        hint: Option<String>,
        #[serde(rename = "canKeep")]
        can_keep: bool,
        #[serde(rename = "ownName")]
        own_name: bool,
    },
    /// The device was added (`add` published). `master_sent`: the master key is in its inbox.
    /// `note`: what did not happen yet (the master key, the device's name), in words.
    Linked {
        seq: u64,
        #[serde(rename = "masterSent")]
        master_sent: bool,
        note: Option<String>,
    },
    /// The holder: paste (or type) the code the new device shows.
    EnterCode { error: Option<String> },
    /// The offer went to the new device's inbox; waiting for it to claim it.
    CodeSent { expires: u64 },
    /// The new device: its code (`coasys:device:1:…`) and the code as a QR code, SVG.
    DeviceCode {
        code: String,
        #[serde(rename = "qrSvg")]
        qr_svg: String,
        expires: u64,
    },
    /// The new device claimed the holder's offer: the code the holder shows too, and the identity.
    /// `needs_accept`: the executor records the identity as its operator only once the person
    /// accepts it here too ([`StepInput::Accept`]), as on a first run. `accepted`: they did;
    /// `confirmed`: the other device confirmed, and this one waits only for the accept.
    DeviceMatch {
        code: String,
        did: String,
        #[serde(rename = "needsAccept")]
        needs_accept: bool,
        accepted: bool,
        confirmed: bool,
    },
    /// The holder confirmed: this computer is a device of `did`.
    Joined {
        did: String,
        #[serde(rename = "keyId")]
        key_id: String,
    },
    /// This computer keeps the master key of `did` now.
    MasterTaken { did: String, note: Option<String> },
    /// A request of another device, before the person answers it. Who asks comes from the key
    /// log, not the record any device can write: `key_id`, the poster's key; `fingerprint`, its
    /// signing key as the log lists it ([`crate::keylog::fingerprint`]); `code`, the request's
    /// code (the match code of the request id and that key), which the asking device shows too.
    /// `device`: the name the record gives it, secondary; `targets`: for `confirm-revoke`, the
    /// keys it asks to revoke, each as the log lists it ([`RevokeTarget`]).
    Request {
        id: String,
        kind: &'static str,
        #[serde(rename = "keyId")]
        key_id: String,
        fingerprint: String,
        code: String,
        device: String,
        targets: Vec<RevokeTarget>,
        passphrase: bool,
        error: Option<String>,
    },
    /// The request was answered: the master key sent, or the keys revoked.
    RequestAnswered {
        kind: &'static str,
        device: String,
        note: Option<String>,
    },
    /// The request for the master key is posted: this device's key, its fingerprint and the
    /// request's code, as the device that answers shows them.
    Asked {
        #[serde(rename = "keyId")]
        key_id: String,
        fingerprint: String,
        code: String,
    },
    /// Name a device.
    Rename {
        #[serde(rename = "keyId")]
        key_id: String,
        name: String,
        error: Option<String>,
    },
    Renamed {
        #[serde(rename = "keyId")]
        key_id: String,
        name: String,
    },
    /// What revoking will do, before it is done.
    RevokeConfirm {
        #[serde(rename = "keyId")]
        key_id: String,
        /// The device may still hold a valid master key: the key log let it keep one
        /// ([`may_hold_master`]), and a revoke leaves such a copy valid until the master key is
        /// replaced.
        #[serde(rename = "mayHoldMaster")]
        may_hold_master: bool,
        passphrase: bool,
        error: Option<String>,
    },
    /// The key was revoked (`revoke` published).
    Revoked {
        #[serde(rename = "keyId")]
        key_id: String,
        seq: u64,
    },
    /// An identity made here earlier that the store refused for good: why, and the way out —
    /// discard it ([`StepInput::Discard`]) or cancel.
    PendingRefused { did: String, message: String },
    /// The step stopped. Nothing was published unless the message says so.
    Failed { message: String },
}

impl Screen {
    /// How the step ended, once the screen is a last one.
    pub fn outcome(&self) -> Option<StepOutcome> {
        match self {
            Screen::IdentityReady { .. }
            | Screen::Linked { .. }
            | Screen::Revoked { .. }
            | Screen::Joined { .. }
            | Screen::MasterTaken { .. }
            | Screen::RequestAnswered { .. }
            | Screen::Asked { .. }
            | Screen::Renamed { .. } => Some(StepOutcome::Done),
            Screen::Failed { .. } => Some(StepOutcome::Failed),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StepOutcome {
    Done,
    Cancelled,
    Failed,
}

/// One input from the identity window.
///
/// Words and passphrases arrive as plain `String`s: they have already crossed the window's DOM, the
/// host's IPC and the sidecar's JSON line, and serde has made its own copies on the way, none of which
/// this crate can wipe. Each is moved into a `Secret` as soon as it is read, and that copy is wiped
/// when the step ends; the earlier ones are only as short-lived as their owners make them.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StepInput {
    WordsWritten,
    Words {
        answers: [String; 2],
    },
    Passphrase {
        passphrase: String,
        confirm: Option<String>,
    },
    /// Wait for the new device to claim the offer (resolves with `Match`).
    WaitClaim,
    /// The codes match: sign the `add`, with the new device's name, whether it keeps the master
    /// key too (offered only on a `Match` with `canKeep`), and this computer's own name when
    /// the `Match` asked for it. Each may be left out.
    #[serde(rename_all = "camelCase")]
    Confirm {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        keep_master: bool,
        #[serde(default)]
        this_name: Option<String>,
    },
    /// The code the new device shows, pasted.
    Code {
        code: String,
    },
    /// The new device: wait for a holder's offer (resolves with `DeviceMatch`).
    WaitLink,
    /// The new device: wait for the holder to confirm (resolves with `Joined`, or with
    /// `DeviceMatch` once the holder confirmed a claim that still waits for [`StepInput::Accept`]).
    WaitJoin,
    /// The new device, on a `DeviceMatch` with `needsAccept`: the person accepts the identity, and
    /// the executor may record it as its operator (`identity.acceptJoin`). Sent while a `WaitJoin`
    /// waits: that one resolves with the accepted `DeviceMatch`, and this one follows the join to
    /// its end (resolves with `Joined`).
    Accept,
    /// Yes to the request, with the passphrase where the computer needs one.
    Answer {
        passphrase: Option<String>,
    },
    /// The device's new name.
    Name {
        name: String,
    },
    /// Revoke, with the passphrase where the computer needs one.
    Revoke {
        passphrase: Option<String>,
    },
    /// Forget the identity on `PendingRefused`, which can never be published.
    Discard,
}

impl std::fmt::Debug for StepInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never prints a word or a passphrase.
        let name = match self {
            StepInput::WordsWritten => "words-written",
            StepInput::Words { .. } => "words",
            StepInput::Passphrase { .. } => "passphrase",
            StepInput::WaitClaim => "wait-claim",
            StepInput::Confirm { .. } => "confirm",
            StepInput::Code { .. } => "code",
            StepInput::WaitLink => "wait-link",
            StepInput::WaitJoin => "wait-join",
            StepInput::Accept => "accept",
            StepInput::Answer { .. } => "answer",
            StepInput::Name { .. } => "name",
            StepInput::Revoke { .. } => "revoke",
            StepInput::Discard => "discard",
        };
        f.write_str(name)
    }
}

/// What the main window may know: public facts about the identity, never a secret.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustodyPublic {
    pub did: Option<String>,
    pub holds_master: Option<HoldsMaster>,
    pub unlock: &'static str,
    /// Why no identity step can run on this computer, in words a person reads; `None` when they
    /// can. Set when the executor answers `identity.status` with no identity store, or with one it
    /// trusts no key for, so nothing it publishes could take; `None` too while the executor does
    /// not answer, since nothing is known then (a step asks again).
    pub blocked: Option<&'static str>,
    /// The devices the private record names, by key id. Empty before the first record write, or
    /// when the record cannot be read now.
    pub devices: Vec<DeviceName>,
    /// The revoked keys that may still hold a valid master key, from the key log
    /// ([`crate::keylog::revoked_holders`]): the record drops a key's entry when it is revoked, and a
    /// revoke does not replace the master key. Empty when the log cannot be read now.
    pub revoked_holders: Vec<String>,
    /// The requests of other devices waiting in the identity's box.
    pub requests: Vec<RequestView>,
    /// A master key waits in this computer's inbox ("Take the master key").
    pub master_waiting: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HoldsMaster {
    pub index: u32,
}

/// One device of the private record: its name and whether it holds the master key (`false`,
/// `"offered"`: waiting in its inbox, `true`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceName {
    pub key_id: String,
    pub name: String,
    pub kind: DeviceKind,
    pub holds_master: Holds,
}

/// One waiting request, as the main window lists it: never its signed parts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestView {
    pub id: String,
    /// `send-master` or `confirm-revoke`.
    pub kind: String,
    /// The key id of the device that posted it.
    pub by: String,
    /// For `confirm-revoke`: the keys it asks to revoke.
    pub key_ids: Vec<String>,
    pub expires: u64,
}

/// Where the executor's RPC is, and the admin credential for it. Nothing else of the executor: the
/// identity store it uses, and whether it trusts it, are asked of it (`identity.status`).
#[derive(Clone)]
pub struct ExecutorAddress {
    /// `http://127.0.0.1:<port>`
    pub url: String,
    /// The credential custody calls the executor with: the custody credential where the executor
    /// runs `--custody-channel` (the sidecar's), else the admin credential (Tauri, no custody channel).
    pub credential: Arc<str>,
}

impl std::fmt::Debug for ExecutorAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExecutorAddress")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

/// Why the handle could not answer.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CustodyError {
    #[error("a step is already open")]
    Busy,
    #[error("no step is open")]
    NoStep,
    #[error("that input does not belong to this screen")]
    WrongInput,
    #[error("the custody service stopped")]
    Stopped,
}

/// Where a cancel is answered: `None` once the step ended, else the screen to show instead
/// ([`CustodyHandle::cancel`]).
type CancelReply = oneshot::Sender<Option<Screen>>;

enum Request {
    Start(IdentityStep, oneshot::Sender<Result<Screen, CustodyError>>),
    Step(StepInput, oneshot::Sender<Result<Screen, CustodyError>>),
    Cancel(CancelReply),
    Public(oneshot::Sender<CustodyPublic>),
}

/// The `Send` handle to the custody thread.
#[derive(Clone)]
pub struct CustodyHandle {
    tx: mpsc::UnboundedSender<Request>,
}

impl CustodyHandle {
    async fn ask<T>(
        &self,
        make: impl FnOnce(oneshot::Sender<T>) -> Request,
    ) -> Result<T, CustodyError> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(make(tx)).map_err(|_| CustodyError::Stopped)?;
        rx.await.map_err(|_| CustodyError::Stopped)
    }

    pub async fn start(&self, step: IdentityStep) -> Result<Screen, CustodyError> {
        self.ask(|tx| Request::Start(step, tx)).await?
    }

    pub async fn step(&self, input: StepInput) -> Result<Screen, CustodyError> {
        self.ask(|tx| Request::Step(input, tx)).await?
    }

    /// Ends the open step, wiping what it held. Harmless with none open, and a stopped service
    /// holds none. `None` once the step ended; a step that could not be ended answers the screen to
    /// show instead, and the window stays: a new device whose claim had already joined shows
    /// `Joined`, and one whose cancel the executor did not confirm says so ([`cancel_join`]).
    pub async fn cancel(&self) -> Option<Screen> {
        self.ask(Request::Cancel).await.unwrap_or(None)
    }

    pub async fn public_state(&self) -> Result<CustodyPublic, CustodyError> {
        self.ask(Request::Public).await
    }
}

/// Starts the custody thread.
pub fn spawn(vault: DesktopVault, executor: ExecutorAddress) -> CustodyHandle {
    let (tx, rx) = mpsc::unbounded_channel();
    std::thread::Builder::new()
        .name("custody".into())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("custody runtime");
            runtime.block_on(serve(vault, executor, rx));
        })
        .expect("custody thread");
    CustodyHandle { tx }
}

type Rx = mpsc::UnboundedReceiver<Request>;

async fn connect(address: &ExecutorAddress) -> Result<ViaExecutor<WsRpcClient>, String> {
    WsRpcClient::connect(&address.url, &address.credential)
        .await
        .map(ViaExecutor::new)
        .map_err(|_| {
            "The identity service on this computer is still starting. Try again in a moment."
                .to_string()
        })
}

/// What a step says when the executor has no identity store it can use — its network names none,
/// or it was given a store URL without that store's key — before the step starts and whenever the
/// executor refuses for that reason (`no-store-keys`).
pub const NO_STORE: &str =
    "This network has no identity store, or a store URL without its key, so this computer cannot \
     make or change an identity. Nothing was changed.";

/// The store a step publishes through, which an offer names: the one `identity.status` reports the
/// executor uses (its config's, else its network seed's), when it trusts a key for it. Else the
/// step's refusal, before words are made, an offer is opened or a key is unlocked: without a
/// trusted key the executor accepts no head from the store, and every publish is refused.
async fn trusted_store<R: ExecutorRpc>(executor: &ViaExecutor<R>) -> Result<String, Screen> {
    match executor.status().await {
        Ok(IdentityStatus {
            store: Some(store), ..
        }) if store.trusted => Ok(store.url),
        Ok(_) => Err(Screen::Failed {
            message: NO_STORE.into(),
        }),
        Err(e) => Err(failed(&ClientError::Rpc(e))),
    }
}

/// The executor refused because it trusts no identity store key (`identity.storeKeys`).
fn names_no_store(e: &ClientError) -> bool {
    matches!(e, ClientError::Rpc(e) if e.code == 503 && e.message.starts_with("no-store-keys"))
}

/// Words a person reads, for each way a flow stops.
fn failed(e: &ClientError) -> Screen {
    let message = match e {
        e if names_no_store(e) => NO_STORE.into(),
        ClientError::Vault(VaultError::Cancelled) => {
            "The unlock was cancelled. Nothing changed.".into()
        }
        ClientError::Vault(VaultError::NotFound) => {
            "This computer does not keep your master key.".into()
        }
        ClientError::Vault(VaultError::Unavailable(why)) => {
            format!("This computer could not keep your master key: {why}")
        }
        ClientError::HasIdentity(did) => format!("This computer already speaks for {did}."),
        ClientError::CreatePending(did) => format!(
            "{did} was made on this computer and is still being finished. Open this step again \
             to finish it; no other identity can be made here until it is."
        ),
        ClientError::OfferEnded(state) => {
            format!("The offer ended ({state}) before it was confirmed. Nothing was added.")
        }
        ClientError::NotAKeeper(_) => "That device cannot keep the master key: only an app on \
                                       a computer or a phone can. Nothing was sent."
            .into(),
        ClientError::Poster(why) => {
            format!("The request does not check out ({why}). Nothing was done.")
        }
        ClientError::NeedsWords => "This request also asks to replace the master key, which \
                                    needs your 12 words. This version cannot do that yet."
            .into(),
        ClientError::RecordBusy => {
            "Your device list is being changed on another device. Try again in a moment.".into()
        }
        ClientError::Rpc(e) => format!(
            "The identity service on this computer answered: {}",
            e.message
        ),
        other => other.to_string(),
    };
    Screen::Failed { message }
}

async fn serve(vault: DesktopVault, address: ExecutorAddress, mut rx: Rx) {
    while let Some(request) = rx.recv().await {
        match request {
            Request::Start(step, reply) => {
                let mut reply = Some(reply);
                match step {
                    IdentityStep::Create => run_create(&vault, &address, &mut rx, &mut reply).await,
                    IdentityStep::AddDevice => {
                        run_link(&vault, &address, &mut rx, &mut reply).await
                    }
                    IdentityStep::ScanDevice => {
                        run_scan(&vault, &address, &mut rx, &mut reply).await
                    }
                    IdentityStep::ShowCode => {
                        run_show_code(&vault, &address, &mut rx, &mut reply).await
                    }
                    IdentityStep::TakeMaster => {
                        run_take_master(&vault, &address, &mut rx, &mut reply).await
                    }
                    IdentityStep::AskMaster => run_ask_master(&vault, &address, &mut reply).await,
                    IdentityStep::AnswerRequest { id } => {
                        run_answer(&vault, &address, &mut rx, &mut reply, id).await
                    }
                    IdentityStep::Rename { key_id } => {
                        run_rename(&vault, &address, &mut rx, &mut reply, key_id).await
                    }
                    IdentityStep::Revoke { key_id } => {
                        run_revoke(&vault, &address, &mut rx, &mut reply, key_id).await
                    }
                }
            }
            Request::Step(_, reply) => {
                let _ = reply.send(Err(CustodyError::NoStep));
            }
            Request::Cancel(reply) => {
                let _ = reply.send(None);
            }
            Request::Public(reply) => {
                let _ = reply.send(public_state(&vault, &address).await);
            }
        }
    }
}

/// Finishes an identity whose `create` kept its incept here and did not see the publish answered
/// (the app stopped, or the publish failed): publishes that incept again, which needs no unlock.
/// `None` when nothing is pending for this executor. Asks the executor nothing when nothing is kept.
///
/// Only the incept listing this executor's device key is touched (the identity client's `resume`
/// picks it): the custody folder is shared by every account on the computer, and another
/// account's incept is that account's to finish. An incept this executor can never publish,
/// because it already speaks for another identity, is forgotten.
async fn finish_pending<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
) -> Result<Option<Created>, ClientError> {
    if vault.pending_incepts()?.is_empty() {
        return Ok(None);
    }
    log::info!("custody: finishing an identity whose publish was not confirmed");
    match resume(executor, &vault.unlocking(None)).await {
        Err(ClientError::HasIdentity(held)) => {
            let status = executor.status().await?;
            if let Some(incept) = own_pending(vault, &status.device_key)? {
                log::warn!(
                    "custody: this computer speaks for {held}; forgetting the incept of {} it can \
                     never publish",
                    ad4m_identity_core::did_of(&incept.scid)
                );
                vault.forget_pending(&incept.scid)?;
            }
            Ok(None)
        }
        other => other,
    }
}

/// The kept incept that lists `device_key` — this executor's, when it is the executor's own key.
fn own_pending(vault: &DesktopVault, device_key: &str) -> Result<Option<Event>, VaultError> {
    Ok(vault.pending_incepts()?.into_iter().find(|incept| {
        matches!(&incept.op, Op::Incept { add, .. } if add.iter().any(|d| d.sign == device_key))
    }))
}

/// How a refused publish of a kept incept stands: `None` when trying again may work (the store or
/// the executor did not answer, a rate limit, a head signed by a key this build does not trust);
/// else the sentence that says why it never will, and whether this computer's key is the reason.
fn refused_for_good(e: &ClientError, did: &str) -> Option<(String, bool)> {
    match e {
        ClientError::Rpc(e) if e.code == 409 && e.message.starts_with("key-taken") => Some((
            format!(
                "The identity store refused {did}: this computer's key is already in a key log, \
                 so publishing it again cannot work."
            ),
            true,
        )),
        ClientError::Rpc(e) if e.code == 409 && e.message.starts_with("conflict") => Some((
            format!(
                "The identity store holds a different log for {did}, so publishing this one \
                 cannot work."
            ),
            false,
        )),
        ClientError::Rpc(e) if e.code == 400 || e.code == 403 => Some((
            format!("The identity store refused {did}: {}", e.message),
            false,
        )),
        ClientError::Fold(why) => Some((
            format!("The identity kept here for {did} does not check out ({why})."),
            false,
        )),
        ClientError::Protocol(why) => Some((format!("{did} cannot be published: {why}"), false)),
        _ => None,
    }
}

/// [`finish_pending`] where a step does not depend on it: a failure is logged, and the next
/// attempt (any step, or the main window asking for the state) tries again.
async fn finish_pending_quietly<R: ExecutorRpc>(executor: &ViaExecutor<R>, vault: &DesktopVault) {
    if let Err(e) = finish_pending(executor, vault).await {
        log::warn!("custody: the pending identity is not finished yet: {e}");
    }
}

async fn public_state(vault: &DesktopVault, address: &ExecutorAddress) -> CustodyPublic {
    match connect(address).await {
        Ok(executor) => public_state_on(Some(&executor), vault).await,
        Err(_) => public_state_on::<WsRpcClient>(None, vault).await,
    }
}

/// [`public_state`] with the executor, when it answers.
async fn public_state_on<R: ExecutorRpc>(
    executor: Option<&ViaExecutor<R>>,
    vault: &DesktopVault,
) -> CustodyPublic {
    let (did, blocked) = match executor {
        Some(executor) => {
            finish_pending_quietly(executor, vault).await;
            match executor.status().await {
                Ok(status) => (
                    status.did,
                    (!status.store.is_some_and(|s| s.trusted)).then_some(NO_STORE),
                ),
                Err(_) => (None, None),
            }
        }
        None => (None, None),
    };
    let mut master_waiting = false;
    let mut devices = Vec::new();
    let mut requests = Vec::new();
    let mut revoked_holders = Vec::new();
    if let (Some(executor), Some(did)) = (executor, did.as_deref()) {
        master_waiting = master_waits(executor).await;
        // Where the operating system unlocks a new item, the master key waiting is taken as the
        // app starts and whenever the main window asks: the keychain's own unlock guards it, as
        // it guards the key made here. A sealed item needs the passphrase, so the person takes
        // it in the identity window ("Take the master key").
        let held = ad4m_identity_core::scid_of(did).map(|scid| held_sealed(vault, scid));
        // The same unlock pushes again what the retry list keeps: a master key given to a device
        // whose push the app did not see through. `retry_pushes` unlocks only when a push is left.
        if let Some(Ok(Some(false))) = held {
            retry_quietly(executor, &vault.unlocking(None), did).await;
        }
        // Not held yet: where a new item goes decides. Held: where it rests.
        let os_unlocks = match held {
            Some(Ok(None)) => !vault.needs_passphrase(),
            Some(Ok(Some(sealed))) => !sealed,
            _ => false,
        };
        if master_waiting && os_unlocks {
            match take_master(executor, &vault.unlocking(None), &RANDOM).await {
                Ok(Some(taken)) => {
                    log::info!("custody: took master #{} of the identity", taken.index);
                    master_waiting = master_waits(executor).await;
                }
                Ok(None) => master_waiting = false,
                Err(e) => log::warn!("custody: the waiting master key was not taken: {e}"),
            }
        }
        devices = match record::read(executor, &vault.unlocking(None), did).await {
            Ok(opened) => opened.map(|o| device_names(&o.record)).unwrap_or_default(),
            Err(e) => {
                log::warn!("custody: the device list cannot be read now: {e}");
                Vec::new()
            }
        };
        revoked_holders = match executor.events(did).await {
            Ok(events) => crate::keylog::revoked_holders(&events),
            Err(e) => {
                log::warn!("custody: the key log cannot be read now: {e}");
                Vec::new()
            }
        };
        requests = waiting_requests(executor).await;
    }
    // Whether this identity's key is held here and, if so, whether it is sealed.
    let sealed = did
        .as_deref()
        .and_then(ad4m_identity_core::scid_of)
        .and_then(|scid| match held_sealed(vault, scid) {
            Ok(sealed) => sealed,
            // The store could not be asked (no Secret Service, a keychain error, a copy on both
            // sides): reported as not known to hold one, and logged so the cause is not lost.
            Err(e) => {
                log::warn!("custody: cannot tell whether the master key is held here: {e}");
                None
            }
        });
    // The index sits inside the sealed item; only master #0 is held for now (no rotation yet).
    let holds_master = sealed.map(|_| HoldsMaster { index: 0 });
    // The unlock of the key reported as held; with none held, the unlock a new one would get.
    let unlock = if sealed.unwrap_or_else(|| vault.needs_passphrase()) {
        "passphrase"
    } else {
        // The operating system's own prompt: Touch ID or the login password on macOS, the Secret
        // Service's unlock on Linux. One word for every platform, so no caller names one.
        "os"
    };
    CustodyPublic {
        did,
        holds_master,
        unlock,
        blocked,
        devices,
        revoked_holders,
        requests,
        master_waiting,
    }
}

/// Whether a master key waits in this computer's inbox. `identity.inbox` reads the store first,
/// so a key put there since the executor's last read is seen. False when it cannot be asked.
async fn master_waits<R: ExecutorRpc>(executor: &ViaExecutor<R>) -> bool {
    match executor.rpc().call("identity.inbox", json!({})).await {
        Ok(Value::Array(messages)) => messages.iter().any(|m| m["kind"] == "master"),
        Ok(_) => false,
        Err(e) => {
            log::warn!(
                "custody: this computer's inbox cannot be read: {}",
                e.message
            );
            false
        }
    }
}

/// The record's devices, as the main window shows them.
fn device_names(record: &ad4m_identity_core::record::PrivateRecord) -> Vec<DeviceName> {
    record
        .devices
        .iter()
        .map(|(key_id, entry)| DeviceName {
            key_id: key_id.clone(),
            name: entry.name.clone(),
            kind: entry.kind,
            holds_master: entry.holds_master,
        })
        .collect()
}

/// The identity's waiting requests, without their signed parts. Empty when the box cannot be
/// read: the requests are asked for again each time.
async fn waiting_requests<R: ExecutorRpc>(executor: &ViaExecutor<R>) -> Vec<RequestView> {
    let listed = match executor
        .rpc()
        .call("identity.requests", json!({ "since": 0 }))
        .await
    {
        Ok(Value::Array(listed)) => listed,
        Ok(_) => return Vec::new(),
        Err(e) => {
            log::warn!("custody: the request box cannot be read now: {}", e.message);
            return Vec::new();
        }
    };
    listed
        .iter()
        .filter_map(|r| {
            let text = |v: &Value| v.as_str().map(str::to_string);
            Some(RequestView {
                id: text(&r["id"])?,
                kind: text(&r["body"]["kind"])?,
                by: text(&r["by"])?,
                key_ids: r["body"]["keyIds"]
                    .as_array()
                    .map(|ids| ids.iter().filter_map(text).collect())
                    .unwrap_or_default(),
                expires: r["expires"].as_u64()?,
            })
        })
        .collect()
}

/// `None` when `scid`'s key is not held here; else whether it is sealed under a passphrase — from
/// where that one item rests, never from where a new one would go.
fn held_sealed(vault: &DesktopVault, scid: &str) -> Result<Option<bool>, VaultError> {
    if !vault.holds(scid)? {
        return Ok(None);
    }
    Ok(Some(vault.needs_passphrase_for(scid)?))
}

type Reply = Option<oneshot::Sender<Result<Screen, CustodyError>>>;

/// Answers the waiting request with `screen`.
fn answer(reply: &mut Reply, screen: Result<Screen, CustodyError>) {
    if let Some(reply) = reply.take() {
        let _ = reply.send(screen);
    }
}

/// The next request inside a flow: a step input (with its reply slot filled), or the flow's end.
/// A second `Start` while a step is open is refused, and `Public` is answered in passing.
async fn next_input(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Option<StepInput> {
    match next_input_or_cancel(vault, address, rx, reply).await {
        Ok(input) => Some(input),
        Err(cancel) => {
            if let Some(cancel) = cancel {
                let _ = cancel.send(None);
            }
            None
        }
    }
}

/// [`next_input`], for a flow that must end something before the cancel is answered: the flow's
/// end comes with the cancel's reply (`None` when the window went away).
async fn next_input_or_cancel(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Result<StepInput, Option<CancelReply>> {
    loop {
        match rx.recv().await {
            None => return Err(None),
            Some(Request::Step(input, r)) => {
                *reply = Some(r);
                return Ok(input);
            }
            Some(Request::Cancel(r)) => return Err(Some(r)),
            Some(Request::Start(_, r)) => {
                let _ = r.send(Err(CustodyError::Busy));
            }
            Some(Request::Public(r)) => {
                let _ = r.send(public_state(vault, address).await);
            }
        }
    }
}

/// A pending identity that could not be finished yet: why, and that trying again finishes it.
fn unfinished(e: &ClientError) -> Screen {
    let Screen::Failed { message } = failed(e) else {
        unreachable!("failed() answers Failed")
    };
    if names_no_store(e) {
        return Screen::Failed { message };
    }
    Screen::Failed {
        message: format!(
            "Your identity was made on this computer but is not published yet. {message} \
             Try again in a moment: the same identity will be finished."
        ),
    }
}

fn passphrase_error(problem: PassphraseProblem) -> Option<String> {
    Some(problem.message())
}

// ─── create ─────────────────────────────────────────────────────────────────────

async fn run_create(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    create_on(&executor, vault, address, rx, reply).await
}

/// [`run_create`] once the executor answers.
async fn create_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    // Before anything: words shown for an identity the store could never take would be a lie.
    if let Err(refused) = trusted_store(executor).await {
        return answer(reply, Ok(refused));
    }
    // An identity made here earlier whose publish was not confirmed is finished, never replaced:
    // its master key is already kept, and its words are the ones the person wrote down.
    match finish_pending(executor, vault).await {
        Ok(Some(created)) => {
            return answer(
                reply,
                Ok(Screen::IdentityReady {
                    did: created.did,
                    key_id: created.device_key_id,
                }),
            )
        }
        Ok(None) => {}
        Err(e) => {
            if !offer_discard(executor, vault, address, rx, reply, &e).await {
                return;
            }
        }
    }
    // Refuse before showing words that would make nothing: this device speaks for someone already.
    let device_key = match executor.status().await {
        Ok(status) if status.did.is_some() => {
            return answer(
                reply,
                Ok(failed(&ClientError::HasIdentity(
                    status.did.unwrap_or_default(),
                ))),
            )
        }
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
        Ok(status) => status.device_key,
    };
    let (mut flow, first) = CreateFlow::start(&RANDOM);
    let CreateScreen::ShowWords(words) = first else {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: "The words were not made.".into(),
            }),
        );
    };
    // The client hands the words over as a `Secret`, wiped when `words` drops below; the screen is
    // the one place they leave it, to be drawn in the identity window.
    answer(
        reply,
        Ok(Screen::ShowWords {
            words: words.expose().clone(),
        }),
    );
    drop(words);

    let mut positions = [0usize; 2];
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        match input {
            StepInput::WordsWritten if positions == [0, 0] => match flow.words_written(&RANDOM) {
                Ok(CreateScreen::ConfirmWords { positions: p }) => {
                    positions = p;
                    answer(
                        reply,
                        Ok(Screen::ConfirmWords {
                            positions,
                            error: None,
                        }),
                    );
                }
                Ok(_) => answer(reply, Err(CustodyError::WrongInput)),
                Err(e) => return answer(reply, Ok(failed(&e))),
            },
            StepInput::Words { answers } if positions != [0, 0] => {
                // Moved, not copied, into secrets that wipe themselves when this step ends.
                let [first, second] = answers;
                let answers = (Secret::new(first), Secret::new(second));
                match flow.confirm([answers.0.expose(), answers.1.expose()]) {
                    Ok(()) => break,
                    Err(ClientError::WrongWords) => answer(
                        reply,
                        Ok(Screen::ConfirmWords {
                            positions,
                            error: Some(
                                "Those are not the words at those places. Check your paper.".into(),
                            ),
                        }),
                    ),
                    Err(e) => return answer(reply, Ok(failed(&e))),
                }
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    }

    // A new identity's item goes where a new item goes. The macOS keychain asks when the item is
    // written. A sealed item: the passphrase comes first.
    let mut passphrase: Option<Secret<String>> = None;
    if vault.needs_passphrase() {
        let Some(p) = new_passphrase(vault, address, rx, reply).await else {
            return;
        };
        passphrase = Some(p);
    }

    // incept, the executor's co-signature, the vault keeps master #0 and the incept, publish.
    let unlocking = vault.unlocking(passphrase);
    let screen = match flow.finish(executor, &unlocking).await {
        Ok(created) => Screen::IdentityReady {
            did: created.did,
            key_id: created.device_key_id,
        },
        // Custody came first, so a publish that failed left an identity to finish, not a loss —
        // when the incept kept is this executor's. Another account's is not this step's.
        Err(e) if own_pending(vault, &device_key).ok().flatten().is_some() => unfinished(&e),
        Err(e) => failed(&e),
    };
    answer(reply, Ok(screen));
}

/// After `finish_pending` failed in a create: whether the create goes on to new words.
///
/// A failure that trying again may fix ends the step with [`unfinished`]: the same identity is
/// finished on the next attempt. One that never will (the store refused this incept for good)
/// names the cause and offers to discard it; the person's answer decides. Discarding forgets the
/// incept only — the master key stays where it rests, since nothing here can be sure the store
/// holds no log that names it.
async fn offer_discard<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    e: &ClientError,
) -> bool {
    let incept = match executor.status().await {
        Ok(status) => own_pending(vault, &status.device_key).ok().flatten(),
        Err(_) => None,
    };
    // Nothing of this executor's is pending (another account's incept, or no answer): say what
    // failed, and claim no identity made here.
    let Some(incept) = incept else {
        answer(reply, Ok(failed(e)));
        return false;
    };
    let did = ad4m_identity_core::did_of(&incept.scid);
    let Some((message, key_taken)) = refused_for_good(e, &did) else {
        answer(reply, Ok(unfinished(e)));
        return false;
    };
    answer(
        reply,
        Ok(Screen::PendingRefused {
            did: did.clone(),
            message,
        }),
    );
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return false;
        };
        let StepInput::Discard = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        if let Err(e) = vault.forget_pending(&incept.scid) {
            answer(reply, Ok(failed(&ClientError::Vault(e))));
            return false;
        }
        if key_taken {
            // New words would list the same key, and be refused the same way.
            answer(
                reply,
                Ok(Screen::Failed {
                    message: format!(
                        "{did} is discarded. This computer's key is already in a key log, so the \
                         identity store would refuse a new identity made with it too."
                    ),
                }),
            );
            return false;
        }
        return true;
    }
}

// ─── link (the holder's side) ───────────────────────────────────────────────────

/// Whether a flow on the key of `did`, an identity already made, asks for a passphrase: decided by
/// where that key rests here, since two identities on one computer can rest in different stores.
fn passphrase_for(vault: &DesktopVault, did: &str) -> Result<bool, ClientError> {
    let scid = ad4m_identity_core::scid_of(did).ok_or(VaultError::NotFound)?;
    Ok(vault.needs_passphrase_for(scid)?)
}

async fn run_link(vault: &DesktopVault, address: &ExecutorAddress, rx: &mut Rx, reply: &mut Reply) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    // The offer names the store the executor uses, and the claiming device publishes through it.
    let store_url = match trusted_store(&executor).await {
        Ok(url) => url,
        Err(refused) => return answer(reply, Ok(refused)),
    };
    let (did, own_key) = match holder_of(&executor, vault).await {
        Ok(holder) => holder,
        Err(screen) => return answer(reply, Ok(screen)),
    };

    // The one unlock of the flow — a flow asks the person to unlock once, not per signature: where
    // this identity's key is sealed, after the passphrase. The unlocking outlives the flow, which
    // pushes the master key with it when the person keeps it on the new device.
    let needs = match passphrase_for(vault, &did) {
        Ok(needs) => needs,
        Err(e) => return answer(reply, Ok(failed(&e))),
    };
    let mut unlocking = vault.unlocking(None);
    if needs {
        answer(reply, Ok(Screen::EnterPassphrase { error: None }));
    }
    let flow = loop {
        if needs {
            let Some(input) = next_input(vault, address, rx, reply).await else {
                return;
            };
            let StepInput::Passphrase { passphrase: p, .. } = input else {
                answer(reply, Err(CustodyError::WrongInput));
                continue;
            };
            unlocking = vault.unlocking(Some(Secret::new(p)));
        }
        match LinkFlow::open(
            &executor,
            &unlocking,
            &did,
            OfferKind::Node,
            None,
            &store_url,
            &CLOCK,
            &RANDOM,
        )
        .await
        {
            Ok(flow) => break flow,
            Err(ClientError::Vault(VaultError::Cancelled)) if needs => {
                answer(reply, Ok(wrong_passphrase()));
            }
            Err(e) => return answer(reply, Ok(failed(&e))),
        }
    };
    let link = flow.link();
    answer(
        reply,
        Ok(Screen::Offer {
            qr_svg: qr_svg(&link),
            link,
            expires: offer_expiry(),
        }),
    );
    follow_link(
        &flow,
        &executor,
        &unlocking,
        &did,
        own_key.as_deref(),
        vault,
        address,
        rx,
        reply,
    )
    .await
}

/// The identity this computer speaks for and this computer's key id in its log, finishing a
/// pending identity first. A screen that ends the step when there is none.
async fn holder_of<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
) -> Result<(String, Option<String>), Screen> {
    finish_pending_quietly(executor, vault).await;
    match executor.status().await {
        Ok(status) => match status.did {
            Some(did) => Ok((did, status.key_id)),
            None => Err(Screen::Failed {
                message: "Make your identity first.".into(),
            }),
        },
        Err(e) => Err(failed(&ClientError::Rpc(e))),
    }
}

fn wrong_passphrase() -> Screen {
    Screen::EnterPassphrase {
        error: Some("That passphrase does not open your master key.".into()),
    }
}

/// The link after its offer is out (a link shown, or a ticket put for a scanned code): waits for
/// the claim, shows the match code with the choices the device allows, and confirms.
///
/// The device is listed by the name the person gives (else the name it suggested). The first
/// link also lists this computer, which made the identity before any record existed, under the
/// name the person gives it then: the Devices page shows every device by name from then on.
#[allow(clippy::too_many_arguments)]
async fn follow_link<R: ExecutorRpc>(
    flow: &LinkFlow<'_, R>,
    executor: &ViaExecutor<R>,
    unlocking: &Unlocking<'_>,
    did: &str,
    own_key: Option<&str>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let own_listed = match (own_key, record::read(executor, unlocking, did).await) {
        (Some(key), Ok(opened)) => opened.is_some_and(|o| o.record.devices.contains_key(key)),
        // Unknown: not asked, rather than a second entry over one the record may hold.
        (_, Err(_)) | (None, _) => true,
    };
    let mut claimed: Option<Claimed> = None;
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        match input {
            StepInput::WaitClaim if claimed.is_none() => {
                // Waits for the claim, or for the window to cancel meanwhile.
                let outcome = tokio::select! {
                    claim = flow.wait_for_claim() => Some(claim),
                    () = wait_cancel(vault, address, rx) => None,
                };
                match outcome {
                    Some(Ok(claim)) => {
                        let screen = Screen::Match {
                            code: claim.match_code.clone(),
                            hint: claim.hint.clone(),
                            can_keep: flow.may_keep(&claim),
                            own_name: !own_listed,
                        };
                        claimed = Some(claim);
                        answer(reply, Ok(screen));
                    }
                    Some(Err(e)) => return answer(reply, Ok(failed(&e))),
                    None => return answer(reply, Err(CustodyError::NoStep)),
                }
            }
            StepInput::Confirm {
                name,
                keep_master,
                this_name,
            } if claimed.is_some() => {
                let claim = claimed.take().expect("checked above");
                let app = flow.may_keep(&claim);
                let entry = DeviceEntry {
                    name: given_name(name)
                        .or_else(|| claim.hint.clone())
                        .unwrap_or_else(|| "Another device".into()),
                    kind: if app {
                        DeviceKind::DesktopApp
                    } else {
                        DeviceKind::Server
                    },
                    place: Some(if app { Place::Computer } else { Place::Server }),
                    address: None,
                    runs_executor: true,
                    holds_master: Holds::No,
                    operator: None,
                };
                let linked = match flow.confirm(&claim, entry, keep_master && app).await {
                    Ok(linked) => linked,
                    Err(e) => return answer(reply, Ok(failed(&e))),
                };
                let mut notes = Vec::new();
                if let (false, Some(own)) = (own_listed, own_key) {
                    let own_entry = this_computer(given_name(this_name), true);
                    let change = Change::Device {
                        key_id: own.to_string(),
                        entry: own_entry,
                    };
                    if let Err(e) =
                        record::write(executor, unlocking, did, &[change], &RANDOM).await
                    {
                        log::warn!("custody: this computer was not listed in the record: {e}");
                        notes.push("This computer's name was not saved: rename it on Devices.");
                    }
                }
                if let Err(e) = &linked.record {
                    log::warn!("custody: the linked device was not listed in the record: {e}");
                    notes.push("Its name was not saved: rename it on Devices.");
                }
                if let Some(Err(e)) = &linked.master {
                    log::warn!("custody: the master key was not put in its inbox: {e}");
                    notes.push(
                        "The master key did not reach it yet: it is sent again the next time \
                         this computer unlocks.",
                    );
                }
                retry_quietly(executor, unlocking, did).await;
                return answer(
                    reply,
                    Ok(Screen::Linked {
                        seq: linked.head.seq,
                        master_sent: matches!(linked.master, Some(Ok(_))),
                        note: (!notes.is_empty()).then(|| notes.join(" ")),
                    }),
                );
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    }
}

/// A name the person typed, trimmed; `None` when blank.
fn given_name(name: Option<String>) -> Option<String> {
    name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty())
}

/// This computer's entry in the record: the desktop app, holding the master key or not.
fn this_computer(name: Option<String>, holds: bool) -> DeviceEntry {
    DeviceEntry {
        name: name.unwrap_or_else(|| "This computer".into()),
        kind: DeviceKind::DesktopApp,
        place: Some(Place::Computer),
        address: None,
        runs_executor: true,
        holds_master: if holds { Holds::Yes } else { Holds::No },
        operator: None,
    }
}

/// Pushes again what the retry list keeps for `did`, with `unlocking`. Failures stay on the list
/// for the next unlock and are only logged: the step that called this succeeded either way.
async fn retry_quietly<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    unlocking: &Unlocking<'_>,
    did: &str,
) {
    match retry_pushes(executor, unlocking, did, &CLOCK, &RANDOM).await {
        Ok(retried) => {
            for (key_id, pushed) in &retried.pushes {
                match pushed {
                    Ok(_) => log::info!("custody: the master key reached {key_id}"),
                    Err(e) => log::warn!("custody: the master key did not reach {key_id} yet: {e}"),
                }
            }
            if let Some(Err(e)) = retried.record {
                log::warn!("custody: the record was not marked after the pushes: {e}");
            }
        }
        Err(e) => log::warn!("custody: the master-key pushes were not tried again: {e}"),
    }
}

// ─── link by scan (the holder's side) ───────────────────────────────────────────

/// The holder takes the new device's code (scanned or pasted), opens an offer bound to its key and
/// puts the ticket where the device reads it; then the link goes on as one the device claimed.
async fn run_scan(vault: &DesktopVault, address: &ExecutorAddress, rx: &mut Rx, reply: &mut Reply) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    let store_url = match trusted_store(&executor).await {
        Ok(url) => url,
        Err(refused) => return answer(reply, Ok(refused)),
    };
    let (did, own_key) = match holder_of(&executor, vault).await {
        Ok(holder) => holder,
        Err(screen) => return answer(reply, Ok(screen)),
    };
    let needs = match passphrase_for(vault, &did) {
        Ok(needs) => needs,
        Err(e) => return answer(reply, Ok(failed(&e))),
    };

    // The code first: one that cannot link is said before any passphrase is asked for.
    answer(reply, Ok(Screen::EnterCode { error: None }));
    let device = loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        let StepInput::Code { code } = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        match check_code(&code, &store_url, CLOCK.now()) {
            Ok(device) => break device,
            Err(error) => answer(reply, Ok(Screen::EnterCode { error: Some(error) })),
        }
    };

    let mut unlocking = vault.unlocking(None);
    if needs {
        answer(reply, Ok(Screen::EnterPassphrase { error: None }));
    }
    let flow = loop {
        if needs {
            let Some(input) = next_input(vault, address, rx, reply).await else {
                return;
            };
            let StepInput::Passphrase { passphrase: p, .. } = input else {
                answer(reply, Err(CustodyError::WrongInput));
                continue;
            };
            unlocking = vault.unlocking(Some(Secret::new(p)));
        }
        match LinkFlow::scan(
            &executor,
            &unlocking,
            &did,
            OfferKind::Device,
            &device,
            &store_url,
            &CLOCK,
            &RANDOM,
        )
        .await
        {
            Ok(flow) => break flow,
            Err(ClientError::Vault(VaultError::Cancelled)) if needs => {
                answer(reply, Ok(wrong_passphrase()));
            }
            Err(e) => return answer(reply, Ok(failed(&e))),
        }
    };
    answer(
        reply,
        Ok(Screen::CodeSent {
            expires: offer_expiry(),
        }),
    );
    follow_link(
        &flow,
        &executor,
        &unlocking,
        &did,
        own_key.as_deref(),
        vault,
        address,
        rx,
        reply,
    )
    .await
}

/// The device string in `code` (its link, or the bare string), when it can be linked now through
/// `store_url`; else what to tell the person.
fn check_code(code: &str, store_url: &str, now: u64) -> Result<DeviceString, String> {
    let device = DeviceString::parse(code).map_err(|_| {
        "That is not a device's code. Copy the whole code the new device shows.".to_string()
    })?;
    if now >= device.exp {
        return Err("That code has expired. Show a new one on the new device.".into());
    }
    if device.store.trim_end_matches('/') != store_url.trim_end_matches('/') {
        return Err(format!(
            "That device uses another identity store ({}). Both devices must use the same one.",
            device.store
        ));
    }
    Ok(device)
}

// ─── show my code (the new device's side) ────────────────────────────────────────

/// The new device shows its code; a holder scans it, the executor claims the ticket the holder
/// put for it (`link-ticket`), the person compares the match code, and the device follows the
/// claim until the holder confirms.
async fn run_show_code(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    // Subscribed before the code exists, so a claim made at once is not missed.
    let events = match executor
        .rpc()
        .watch_events(json!({ "link-ticket": null }))
        .await
    {
        Ok(events) => events,
        Err(e) => {
            log::warn!("custody: link-ticket events cannot be watched: {e}");
            return answer(
                reply,
                Ok(Screen::Failed {
                    message: "The identity service on this computer is still starting. Try \
                              again in a moment."
                        .into(),
                }),
            );
        }
    };
    show_code_on(&executor, events, vault, address, rx, reply).await
}

/// [`run_show_code`] once the executor answers and its `link-ticket` events are watched.
async fn show_code_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    mut events: broadcast::Receiver<Value>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    if let Err(refused) = trusted_store(executor).await {
        return answer(reply, Ok(refused));
    }
    match executor.status().await {
        Ok(status) => {
            if let Some(did) = status.did {
                return answer(
                    reply,
                    Ok(Screen::Failed {
                        message: format!(
                            "This computer already speaks for {did}, so it cannot join another \
                             identity."
                        ),
                    }),
                );
            }
        }
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    }
    let prepared = match executor
        .rpc()
        .call("identity.prepareDevice", json!({}))
        .await
    {
        Ok(prepared) => prepared,
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    };
    let (Some(code), Some(expires)) = (prepared["device"].as_str(), prepared["expires"].as_u64())
    else {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: "This computer's code was not made. Try again.".into(),
            }),
        );
    };
    answer(
        reply,
        Ok(Screen::DeviceCode {
            code: code.to_string(),
            qr_svg: qr_svg(code),
            expires,
        }),
    );

    let mut claim: Option<Claim> = None;
    loop {
        let input = match next_input_or_cancel(vault, address, rx, reply).await {
            Ok(input) => input,
            Err(cancel) => return cancel_claim(executor, claim.as_ref(), cancel, reply).await,
        };
        match input {
            StepInput::WaitLink if claim.is_none() => {
                let wait = Duration::from_secs(expires.saturating_sub(CLOCK.now()));
                let outcome = tokio::select! {
                    claimed = tokio::time::timeout(wait, next_ticket(&mut events)) => Some(claimed),
                    () = wait_cancel(vault, address, rx) => None,
                };
                match outcome {
                    None => return answer(reply, Err(CustodyError::NoStep)),
                    Some(Err(_)) => {
                        return answer(
                            reply,
                            Ok(Screen::Failed {
                                message: "No device linked this computer before its code \
                                          expired. Show a new code to try again."
                                    .into(),
                            }),
                        )
                    }
                    Some(Ok(None)) => {
                        return answer(
                            reply,
                            Ok(Screen::Failed {
                                message: "The identity service on this computer stopped \
                                          answering. Try again in a moment."
                                    .into(),
                            }),
                        )
                    }
                    Some(Ok(Some(claimed))) => {
                        let claimed = Claim {
                            offer_id: claimed.offer_id,
                            did: claimed.did,
                            code: claimed.match_code,
                            needs_accept: claimed.needs_accept,
                            // The offer lives at most `OFFER_TTL_S` from its claim, and the
                            // holder's confirm may land in the store's grace after it.
                            deadline: CLOCK.now() + OFFER_TTL_S + CONFIRM_GRACE_S,
                            accepted: false,
                            confirmed: false,
                        };
                        answer(reply, Ok(claimed.screen()));
                        claim = Some(claimed);
                    }
                }
            }
            StepInput::WaitJoin if claim.is_some() => {
                let claim = claim.as_mut().expect("checked above");
                match follow_claim(executor, claim, vault, address, rx, reply).await {
                    Err(cancel) => return cancel_claim(executor, Some(claim), cancel, reply).await,
                    // The other device confirmed; the person has yet to accept here.
                    Ok(screen @ Screen::DeviceMatch { .. }) => answer(reply, Ok(screen)),
                    Ok(screen) => return answer(reply, Ok(screen)),
                }
            }
            StepInput::Accept if claim.as_ref().is_some_and(Claim::awaits_accept) => {
                let claim = claim.as_mut().expect("checked above");
                if let Err(screen) = accept_join(executor, claim).await {
                    return answer(reply, Ok(screen));
                }
                let screen = match follow_claim(executor, claim, vault, address, rx, reply).await {
                    Err(cancel) => return cancel_claim(executor, Some(claim), cancel, reply).await,
                    Ok(screen) => screen,
                };
                return answer(reply, Ok(screen));
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    }
}

/// A ticket this executor claimed (`link-ticket`). `needs_accept`: the executor binds only once the
/// person accepts the identity here (`needsAccept`, from coasys/ad4m#1635; absent before it).
struct TicketClaimed {
    did: String,
    offer_id: String,
    match_code: String,
    needs_accept: bool,
}

/// The claim the new device follows, from its `link-ticket` to the join.
struct Claim {
    offer_id: String,
    did: String,
    code: String,
    needs_accept: bool,
    /// When the claim can no longer be confirmed.
    deadline: u64,
    /// The person accepted the identity here (`identity.acceptJoin`).
    accepted: bool,
    /// The holder confirmed (`awaiting-accept`), and the window was told.
    confirmed: bool,
}

impl Claim {
    fn screen(&self) -> Screen {
        Screen::DeviceMatch {
            code: self.code.clone(),
            did: self.did.clone(),
            needs_accept: self.needs_accept,
            accepted: self.accepted,
            confirmed: self.confirmed,
        }
    }

    /// The executor waits for the person to accept the identity here.
    fn awaits_accept(&self) -> bool {
        self.needs_accept && !self.accepted
    }
}

/// The next `link-ticket` event; `None` once the connection closed.
async fn next_ticket(events: &mut broadcast::Receiver<Value>) -> Option<TicketClaimed> {
    loop {
        match events.recv().await {
            Ok(event) if event["type"] == "link-ticket" => {
                let text = |key: &str| event[key].as_str().map(str::to_string);
                match (text("did"), text("offerId"), text("matchCode")) {
                    (Some(did), Some(offer_id), Some(match_code)) => {
                        return Some(TicketClaimed {
                            did,
                            offer_id,
                            match_code,
                            needs_accept: event["needsAccept"].as_bool().unwrap_or(false),
                        })
                    }
                    _ => log::warn!("custody: a link-ticket event without its fields"),
                }
            }
            Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return None,
        }
    }
}

/// Follows this executor's claim (`identity.joinStatus`) every [`JOIN_POLL`] until the holder
/// confirms it (`Joined`), the offer ends, or the claim's deadline passes — each call and each wait
/// cut off there. While it waits it answers the window: a cancel ends it (`Err`, with the cancel's
/// reply for [`cancel_claim`]), and an [`StepInput::Accept`] accepts the identity, answers the
/// waiting request with the accepted `DeviceMatch` and becomes the request this answers. A claim
/// the holder confirmed but the person has not accepted (`awaiting-accept`) answers `DeviceMatch`
/// once, so the window asks.
async fn follow_claim<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    claim: &mut Claim,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Result<Screen, Option<CancelReply>> {
    let closed = || Screen::Failed {
        message: "The other device did not confirm in time. Show a new code to try again.".into(),
    };
    let mut next_poll = tokio::time::Instant::now();
    loop {
        if claim.deadline <= CLOCK.now() {
            return Ok(closed());
        }
        let offer_id = claim.offer_id.clone();
        let deadline = claim.deadline;
        let poll = async move {
            tokio::time::sleep_until(next_poll).await;
            let left = deadline.saturating_sub(CLOCK.now());
            tokio::time::timeout(
                Duration::from_secs(left),
                executor
                    .rpc()
                    .call("identity.joinStatus", json!({ "offerId": offer_id })),
            )
            .await
        };
        let polled = tokio::select! {
            join = poll => Some(join),
            request = rx.recv() => {
                match request {
                    None => return Err(None),
                    Some(Request::Cancel(r)) => return Err(Some(r)),
                    Some(Request::Public(r)) => {
                        let _ = r.send(public_state(vault, address).await);
                    }
                    Some(Request::Start(_, r)) => {
                        let _ = r.send(Err(CustodyError::Busy));
                    }
                    Some(Request::Step(StepInput::Accept, r)) if claim.awaits_accept() => {
                        if let Err(screen) = accept_join(executor, claim).await {
                            answer(reply, Ok(screen.clone()));
                            *reply = Some(r);
                            return Ok(screen);
                        }
                        answer(reply, Ok(claim.screen()));
                        *reply = Some(r);
                        // Asked again at once: the holder may have confirmed already.
                        next_poll = tokio::time::Instant::now();
                    }
                    Some(Request::Step(_, r)) => {
                        let _ = r.send(Err(CustodyError::Busy));
                    }
                }
                None
            }
        };
        let Some(join) = polled else {
            continue;
        };
        let join = match join {
            Ok(Ok(join)) => join,
            Ok(Err(e)) => return Ok(failed(&ClientError::Rpc(e))),
            Err(_) => return Ok(closed()),
        };
        match join["state"].as_str() {
            Some("claimed") => {}
            // The holder confirmed; the executor binds once the person accepts here.
            Some("awaiting-accept") => {
                if !claim.accepted && !claim.confirmed {
                    claim.needs_accept = true;
                    claim.confirmed = true;
                    return Ok(claim.screen());
                }
            }
            Some("cancelled") => return Ok(cancelled_here()),
            Some("spent") => {
                return Ok(match (join["did"].as_str(), join["keyId"].as_str()) {
                    (Some(did), Some(key_id)) => Screen::Joined {
                        did: did.to_string(),
                        key_id: key_id.to_string(),
                    },
                    _ => Screen::Failed {
                        message: "The link was confirmed, but the identity's log does not list \
                                  this computer. Show a new code to try again."
                            .into(),
                    },
                })
            }
            other => {
                return Ok(Screen::Failed {
                    message: format!(
                        "The link ended unconfirmed ({}). Show a new code to try again.",
                        other.unwrap_or("unknown")
                    ),
                })
            }
        }
        next_poll = tokio::time::Instant::now()
            + JOIN_POLL.min(Duration::from_secs(
                claim.deadline.saturating_sub(CLOCK.now()),
            ));
    }
}

/// The person accepts the identity of `claim` here: the executor may record it as its operator once
/// the holder confirms. `identity.acceptJoin` `{ offerId }` → `{ accepted: true }` is new in
/// coasys/ad4m#1635 and not in the client this crate pins yet, so it is called by name.
async fn accept_join<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    claim: &mut Claim,
) -> Result<(), Screen> {
    match executor
        .rpc()
        .call("identity.acceptJoin", json!({ "offerId": claim.offer_id }))
        .await
    {
        Ok(_) => {
            claim.accepted = true;
            Ok(())
        }
        Err(e) if e.code == 409 && e.message.starts_with("cancelled") => Err(cancelled_here()),
        Err(e) if e.code == 404 => Err(Screen::Failed {
            message: "This link is no longer open on this computer. Show a new code to try again."
                .into(),
        }),
        Err(e) => Err(failed(&ClientError::Rpc(e))),
    }
}

/// Ends this executor's claim of `offer_id` when the person cancels, so a confirm that lands later
/// does not join this computer. `identity.cancelJoin` `{ offerId }` → `{ cancelled: true }` is new
/// in coasys/ad4m#1635, called by name until the pinned client has it. `None` once the executor
/// confirms the claim ended (or was cancelled already, 409 `cancelled`); else the screen to show
/// instead of a cancel. A claim that already bound (409 `already-joined`) is not undone, so this
/// computer did join. Any other answer, or none within [`CANCEL_WAIT`] (an executor without
/// `cancelJoin` keeps the claim until the offer expires), leaves the claim standing: a confirm may
/// still join this computer, and the screen says so.
async fn cancel_join<R: ExecutorRpc>(executor: &ViaExecutor<R>, offer_id: &str) -> Option<Screen> {
    let cancelled = tokio::time::timeout(
        CANCEL_WAIT,
        executor
            .rpc()
            .call("identity.cancelJoin", json!({ "offerId": offer_id })),
    )
    .await;
    match cancelled {
        Ok(Ok(_)) => None,
        Ok(Err(e)) if e.code == 409 && e.message.starts_with("cancelled") => None,
        Ok(Err(e)) if e.code == 409 && e.message.starts_with("already-joined") => {
            log::info!("custody: the claim of offer {offer_id} had already joined; not cancelled");
            Some(already_joined(executor, offer_id).await)
        }
        Ok(Err(e)) => {
            log::warn!("custody: the claim was not cancelled: {e}");
            Some(cancel_unconfirmed())
        }
        Err(_) => {
            log::warn!("custody: the executor did not answer the cancel of offer {offer_id}");
            Some(cancel_unconfirmed())
        }
    }
}

/// How long a cancel waits for the executor to end the claim before saying it could not.
const CANCEL_WAIT: Duration = Duration::from_secs(10);

/// Ends `claim` when the window cancels the step, before the cancel is answered, so the window
/// closes only once the executor confirmed it ([`cancel_join`]). The cancel and a request still
/// waiting on the claim are answered alike: `None`/`NoStep` once it ended, else the screen to show.
async fn cancel_claim<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    claim: Option<&Claim>,
    cancel: Option<CancelReply>,
    reply: &mut Reply,
) {
    let instead = match claim {
        Some(claim) => cancel_join(executor, &claim.offer_id).await,
        None => None,
    };
    answer(reply, instead.clone().ok_or(CustodyError::NoStep));
    if let Some(cancel) = cancel {
        let _ = cancel.send(instead);
    }
}

/// What a cancel that came too late shows: `Joined`, from the claim's `identity.joinStatus`, or in
/// words when that does not name the key this computer joined as.
async fn already_joined<R: ExecutorRpc>(executor: &ViaExecutor<R>, offer_id: &str) -> Screen {
    let status = executor
        .rpc()
        .call("identity.joinStatus", json!({ "offerId": offer_id }))
        .await;
    if let Ok(join) = &status {
        if let (Some("spent"), Some(did), Some(key_id)) = (
            join["state"].as_str(),
            join["did"].as_str(),
            join["keyId"].as_str(),
        ) {
            return Screen::Joined {
                did: did.to_string(),
                key_id: key_id.to_string(),
            };
        }
    }
    Screen::Failed {
        message: ALREADY_JOINED.into(),
    }
}

/// A cancel that reached the executor after this computer joined, when the join's key is unknown.
const ALREADY_JOINED: &str =
    "This computer had already joined the identity before the cancel reached it, so it stays \
     joined.";

/// A cancel the executor did not confirm: the claim may stand, and a confirm still join.
fn cancel_unconfirmed() -> Screen {
    Screen::Failed {
        message: CANCEL_UNCONFIRMED.into(),
    }
}

const CANCEL_UNCONFIRMED: &str =
    "The identity service on this computer did not confirm the cancel, so this computer may \
     still join the identity if the other device confirms the link.";

/// The claim was cancelled on this computer (`identity.acceptJoin` 409 `cancelled`, or a
/// `cancelled` `identity.joinStatus`).
fn cancelled_here() -> Screen {
    Screen::Failed {
        message: "This link was cancelled on this computer. Show a new code to try again.".into(),
    }
}

// ─── the master key on a linked device ──────────────────────────────────────────

/// A passphrase for a new sealed item, asked until it passes [`seal::check_new`]; `None` when
/// the window cancels.
async fn new_passphrase(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Option<Secret<String>> {
    answer(reply, Ok(Screen::SetPassphrase { error: None }));
    loop {
        let input = next_input(vault, address, rx, reply).await?;
        match input {
            StepInput::Passphrase {
                passphrase: p,
                confirm,
            } => {
                let p = Secret::new(p);
                let confirm = Secret::new(confirm.unwrap_or_default());
                match seal::check_new(p.expose(), confirm.expose()) {
                    Ok(()) => return Some(p),
                    Err(problem) => answer(
                        reply,
                        Ok(Screen::SetPassphrase {
                            error: passphrase_error(problem),
                        }),
                    ),
                }
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    }
}

/// Takes the master key waiting in this computer's inbox into the vault, where this computer
/// keeps a new item: behind the OS unlock, or sealed under a passphrase set here. Where the OS
/// unlocks it the key is also taken without this step ([`public_state_on`]).
async fn run_take_master(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    take_master_on(&executor, vault, address, rx, reply).await
}

const NO_MASTER_WAITING: &str = "No master key is waiting for this computer. Ask for it here, \
     then say yes on a device that holds it.";

/// [`run_take_master`] once the executor answers.
async fn take_master_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let did = match executor.status().await {
        Ok(status) => match status.did {
            Some(did) => did,
            None => {
                return answer(
                    reply,
                    Ok(Screen::Failed {
                        message: "This computer is not linked to an identity yet.".into(),
                    }),
                )
            }
        },
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    };
    if !master_waits(executor).await {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: NO_MASTER_WAITING.into(),
            }),
        );
    }
    let Some(scid) = ad4m_identity_core::scid_of(&did) else {
        return answer(reply, Ok(failed(&ClientError::Vault(VaultError::NotFound))));
    };
    // A key already kept here is replaced where it rests, and opened with its passphrase; a new
    // one goes where a new item goes.
    let sealed = match held_sealed(vault, scid) {
        Ok(Some(sealed)) => sealed,
        Ok(None) => false,
        Err(e) => return answer(reply, Ok(failed(&ClientError::Vault(e)))),
    };
    let held = matches!(vault.holds(scid), Ok(true));
    let mut unlocking = vault.unlocking(None);
    if !held && vault.needs_passphrase() {
        let Some(p) = new_passphrase(vault, address, rx, reply).await else {
            return;
        };
        unlocking = vault.unlocking(Some(p));
    } else if sealed {
        answer(reply, Ok(Screen::EnterPassphrase { error: None }));
    }
    loop {
        if sealed {
            let Some(input) = next_input(vault, address, rx, reply).await else {
                return;
            };
            let StepInput::Passphrase { passphrase: p, .. } = input else {
                answer(reply, Err(CustodyError::WrongInput));
                continue;
            };
            unlocking = vault.unlocking(Some(Secret::new(p)));
        }
        let screen = match take_master(executor, &unlocking, &RANDOM).await {
            Ok(Some(taken)) => Screen::MasterTaken {
                note: taken.record.err().map(|e| {
                    log::warn!("custody: the record does not mark this computer yet: {e}");
                    "Your device list does not show it yet: it is updated the next time a \
                     device changes it."
                        .to_string()
                }),
                did: taken.did,
            },
            Ok(None) => Screen::Failed {
                message: NO_MASTER_WAITING.into(),
            },
            Err(ClientError::Vault(VaultError::Cancelled)) if sealed => {
                answer(reply, Ok(wrong_passphrase()));
                continue;
            }
            Err(e) => failed(&e),
        };
        return answer(reply, Ok(screen));
    }
}

/// A linked app without the master key asks the identity's other devices for it: a
/// `send-master` request in the identity's box, which a holder answers.
async fn run_ask_master(vault: &DesktopVault, address: &ExecutorAddress, reply: &mut Reply) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    answer(reply, Ok(ask_master_on(&executor, vault).await));
}

/// [`run_ask_master`] once the executor answers.
async fn ask_master_on<R: ExecutorRpc>(executor: &ViaExecutor<R>, vault: &DesktopVault) -> Screen {
    let status = match executor.status().await {
        Ok(status) => status,
        Err(e) => return failed(&ClientError::Rpc(e)),
    };
    let (Some(did), Some(key_id)) = (status.did, status.key_id) else {
        return Screen::Failed {
            message: "This computer is not linked to an identity yet.".into(),
        };
    };
    let Some(scid) = ad4m_identity_core::scid_of(&did) else {
        return Screen::Failed {
            message: "This computer is not linked to an identity yet.".into(),
        };
    };
    if matches!(vault.holds(scid), Ok(true)) {
        return Screen::Failed {
            message: "This computer already keeps your master key.".into(),
        };
    }
    match executor
        .post_request(&DeviceRequestBody::SendMaster {}, None)
        .await
    {
        Ok(id) => Screen::Asked {
            key_id,
            fingerprint: crate::keylog::fingerprint(&status.device_key),
            code: ad4m_identity_core::link::match_code(scid, &id, &status.device_key),
        },
        Err(e) => failed(&ClientError::Rpc(e)),
    }
}

// ─── a request in the box (the holder's answer) ───────────────────────────────────

/// Shows a waiting request, by the names the record gives its devices, and does what it asks
/// when the person says yes. Saying no is closing the window: the request waits until it
/// expires, for another holder to answer.
async fn run_answer(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    id: String,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    answer_on(&executor, vault, address, rx, reply, id).await
}

/// [`run_answer`] once the executor answers.
async fn answer_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    id: String,
) {
    if let Err(refused) = trusted_store(executor).await {
        return answer(reply, Ok(refused));
    }
    let (did, _) = match holder_of(executor, vault).await {
        Ok(holder) => holder,
        Err(screen) => return answer(reply, Ok(screen)),
    };
    let request = match executor.requests(0).await {
        Ok(requests) => requests.into_iter().find(|r| r.id == id),
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    };
    let Some(request) = request else {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: "That request is no longer waiting.".into(),
            }),
        );
    };
    let needs = match passphrase_for(vault, &did) {
        Ok(needs) => needs,
        Err(e) => return answer(reply, Ok(failed(&e))),
    };
    let names = match record::read(executor, &vault.unlocking(None), &did).await {
        Ok(Some(opened)) => opened.record.devices,
        _ => Default::default(),
    };
    let name_of = |key_id: &str| {
        names
            .get(key_id)
            .map(|entry| entry.name.clone())
            .unwrap_or_else(|| format!("Device {key_id}"))
    };
    // Who asks and, for a revoke, which keys go, from the log: signing keys and whether each
    // claim said it may keep the master key. The record's names and kinds, and what it says
    // about the master key, are any linked device's to write.
    let events = match executor.events(&did).await {
        Ok(events) => events,
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    };
    let (kind, targets) = match &request.body {
        DeviceRequestBody::SendMaster {} => ("send-master", Vec::new()),
        DeviceRequestBody::ConfirmRevoke { key_ids, .. } => {
            let mut targets = Vec::with_capacity(key_ids.len());
            for key_id in key_ids {
                let Some(logged) = crate::keylog::device(&events, key_id) else {
                    return answer(
                        reply,
                        Ok(Screen::Failed {
                            message: format!(
                                "The request asks to revoke {key_id}, which is not in your key log."
                            ),
                        }),
                    );
                };
                targets.push(RevokeTarget {
                    key_id: key_id.clone(),
                    fingerprint: crate::keylog::fingerprint(&logged.sign),
                    record_name: names.get(key_id.as_str()).map(|entry| entry.name.clone()),
                    may_hold_master: logged.may_keep_master,
                });
            }
            ("confirm-revoke", targets)
        }
    };
    let logged = crate::keylog::device(&events, &request.by);
    let (Some(logged), Some(scid)) = (logged, ad4m_identity_core::scid_of(&did)) else {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: "The device that asks is not in your key log.".into(),
            }),
        );
    };
    let fingerprint = crate::keylog::fingerprint(&logged.sign);
    if kind == "send-master" && !logged.may_keep_master {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: format!(
                    "Device {} (key {fingerprint}) joined as a device that does not keep the \
                     master key, so it cannot be sent to it.",
                    request.by
                ),
            }),
        );
    }
    let code = ad4m_identity_core::link::match_code(scid, &request.id, &logged.sign);
    let device = name_of(&request.by);
    let card = |error: Option<String>| Screen::Request {
        id: id.clone(),
        kind,
        key_id: request.by.clone(),
        fingerprint: fingerprint.clone(),
        code: code.clone(),
        device: device.clone(),
        targets: targets.clone(),
        passphrase: needs,
        error,
    };
    answer(reply, Ok(card(None)));
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        let StepInput::Answer { passphrase } = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        let unlocking = vault.unlocking(passphrase.map(Secret::new));
        match requests::answer(executor, &unlocking, &did, &request, &CLOCK, &RANDOM).await {
            Ok(answered) => {
                let record = match &answered {
                    Answered::MasterSent(sent) => sent.record.as_ref().err(),
                    Answered::Revoked(revoked) => revoked.record.as_ref().err(),
                };
                if let Some(e) = record {
                    log::warn!("custody: the record was not changed after the answer: {e}");
                }
                retry_quietly(executor, &unlocking, &did).await;
                return answer(
                    reply,
                    Ok(Screen::RequestAnswered {
                        kind,
                        device: device.clone(),
                        note: record.map(|_| {
                            "Your device list does not show it yet: it is updated the next time \
                             a device changes it."
                                .to_string()
                        }),
                    }),
                );
            }
            Err(ClientError::Vault(VaultError::Cancelled)) if needs => answer(
                reply,
                Ok(card(Some(
                    "That passphrase does not open your master key.".into(),
                ))),
            ),
            Err(e) => return answer(reply, Ok(failed(&e))),
        }
    }
}

// ─── rename a device ────────────────────────────────────────────────────────────────

/// Names the device `key_id` in the identity's private record. Any linked device may: the record
/// is written with this executor's device key, and no master key is unlocked.
async fn run_rename(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    key_id: String,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    rename_on(&executor, vault, address, rx, reply, key_id).await
}

/// [`run_rename`] once the executor answers.
async fn rename_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    key_id: String,
) {
    let (did, own_key) = match holder_of(executor, vault).await {
        Ok(holder) => holder,
        Err(screen) => return answer(reply, Ok(screen)),
    };
    // A device without the master key names only itself: the record is written with any
    // linked device's key, so naming another device is the master key holder's to do.
    let holds =
        ad4m_identity_core::scid_of(&did).is_some_and(|scid| matches!(vault.holds(scid), Ok(true)));
    if !holds && own_key.as_deref() != Some(key_id.as_str()) {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: "Only a device that keeps your master key can rename another device."
                    .into(),
            }),
        );
    }
    let listed = match record::read(executor, &vault.unlocking(None), &did).await {
        Ok(opened) => opened.and_then(|o| o.record.devices.get(&key_id).cloned()),
        Err(e) => return answer(reply, Ok(failed(&e))),
    };
    answer(
        reply,
        Ok(Screen::Rename {
            key_id: key_id.clone(),
            name: listed.as_ref().map(|e| e.name.clone()).unwrap_or_default(),
            error: None,
        }),
    );
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        let StepInput::Name { name } = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        let Some(name) = given_name(Some(name)) else {
            answer(
                reply,
                Ok(Screen::Rename {
                    key_id: key_id.clone(),
                    name: String::new(),
                    error: Some("Give the device a name.".into()),
                }),
            );
            continue;
        };
        // A device the record does not list yet (this computer, which made the identity before
        // any record existed) is listed with the name; a rename alone would change nothing.
        let change = if listed.is_some() {
            Change::Rename {
                key_id: key_id.clone(),
                name: name.clone(),
            }
        } else if own_key.as_deref() == Some(key_id.as_str()) {
            let holds = ad4m_identity_core::scid_of(&did)
                .is_some_and(|scid| matches!(vault.holds(scid), Ok(true)));
            Change::Device {
                key_id: key_id.clone(),
                entry: this_computer(Some(name.clone()), holds),
            }
        } else {
            Change::Device {
                key_id: key_id.clone(),
                entry: DeviceEntry {
                    name: name.clone(),
                    kind: DeviceKind::Server,
                    place: None,
                    address: None,
                    runs_executor: true,
                    holds_master: Holds::No,
                    operator: None,
                },
            }
        };
        let screen =
            match record::write(executor, &vault.unlocking(None), &did, &[change], &RANDOM).await {
                Ok(_) => Screen::Renamed {
                    key_id: key_id.clone(),
                    name,
                },
                Err(e) => failed(&e),
            };
        return answer(reply, Ok(screen));
    }
}

/// Resolves when the window cancels; answers `Public` in passing and refuses anything else.
async fn wait_cancel(vault: &DesktopVault, address: &ExecutorAddress, rx: &mut Rx) {
    loop {
        match rx.recv().await {
            None => return,
            Some(Request::Cancel(r)) => {
                let _ = r.send(None);
                return;
            }
            Some(Request::Public(r)) => {
                let _ = r.send(public_state(vault, address).await);
            }
            Some(Request::Start(_, r)) => {
                let _ = r.send(Err(CustodyError::Busy));
            }
            Some(Request::Step(_, r)) => {
                let _ = r.send(Err(CustodyError::Busy));
            }
        }
    }
}

fn offer_expiry() -> u64 {
    ad4m_identity_client::Clock::now(&CLOCK) + ad4m_identity_core::link::OFFER_TTL_S
}

/// The offer link as a QR code, SVG, drawn in the theme's colours by the window's CSS.
pub fn qr_svg(link: &str) -> String {
    match qrcode::QrCode::new(link.as_bytes()) {
        Ok(code) => code
            .render::<qrcode::render::svg::Color<'_>>()
            .min_dimensions(200, 200)
            .quiet_zone(true)
            .build(),
        Err(_) => String::new(),
    }
}

// ─── revoke ─────────────────────────────────────────────────────────────────────

async fn run_revoke(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    key_id: String,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    revoke_on(&executor, vault, address, rx, reply, key_id).await
}

/// [`run_revoke`] once the executor answers.
async fn revoke_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    key_id: String,
) {
    if let Err(refused) = trusted_store(executor).await {
        return answer(reply, Ok(refused));
    }
    finish_pending_quietly(executor, vault).await;
    let (did, own) = match executor.status().await {
        Ok(status) => match status.did {
            Some(did) => (did, status.key_id),
            None => {
                return answer(
                    reply,
                    Ok(Screen::Failed {
                        message: "Make your identity first.".into(),
                    }),
                )
            }
        },
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    };
    if own.as_deref() == Some(key_id.as_str()) {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: "This computer cannot revoke its own key. Revoke it from another device."
                    .into(),
            }),
        );
    }
    let needs = match passphrase_for(vault, &did) {
        Ok(needs) => needs,
        Err(e) => return answer(reply, Ok(failed(&e))),
    };
    let may_hold_master = may_hold_master(executor, &did, &key_id).await;
    answer(
        reply,
        Ok(Screen::RevokeConfirm {
            key_id: key_id.clone(),
            may_hold_master,
            passphrase: needs,
            error: None,
        }),
    );
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        let StepInput::Revoke { passphrase } = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        let unlocking = vault.unlocking(passphrase.map(Secret::new));
        match revoke(
            executor,
            &unlocking,
            &did,
            std::slice::from_ref(&key_id),
            &CLOCK,
            &RANDOM,
        )
        .await
        {
            Ok(revoked) => {
                if let Err(e) = &revoked.record {
                    log::warn!("custody: the record still lists the revoked device: {e}");
                }
                return answer(
                    reply,
                    Ok(Screen::Revoked {
                        key_id,
                        seq: revoked.head.seq,
                    }),
                );
            }
            Err(ClientError::Vault(VaultError::Cancelled)) if needs => answer(
                reply,
                Ok(Screen::RevokeConfirm {
                    key_id: key_id.clone(),
                    may_hold_master,
                    passphrase: true,
                    error: Some("That passphrase does not open your master key.".into()),
                }),
            ),
            Err(e) => return answer(reply, Ok(failed(&e))),
        }
    }
}

/// Whether device `key_id` may still hold a valid master key, as the key log says
/// ([`crate::keylog::device`]): it made the identity (a standing key of the incept), or the claim
/// it joined with said `canKeepMaster`. Never the private record, which any linked device can write:
/// a record that says `holdsMaster: false` cannot hide a copy the log let the device keep. A revoke
/// does not change the master key, so such a copy stays valid until it is replaced. With no log to
/// read, it may.
async fn may_hold_master<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    did: &str,
    key_id: &str,
) -> bool {
    match executor.events(did).await {
        Ok(events) => crate::keylog::device(&events, key_id).is_some_and(|d| d.may_keep_master),
        Err(e) => {
            log::warn!("custody: the key log cannot be read now: {e}");
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    use ad4m_identity_client::vault::KeySigner;
    use ad4m_identity_client::{RpcError, Vault};
    use ad4m_identity_core::build::{cosign, Signer};
    use ad4m_identity_core::{did_of, words, Event};
    use serde_json::{json, Value};

    use crate::pending::PendingIncepts;
    use crate::seal::Kdf;
    use crate::store::FileStore;

    const CHEAP: Kdf = Kdf {
        m_kib: 64,
        t: 1,
        p: 1,
    };
    const PASSPHRASE: &str = "a passphrase of some length";

    /// An executor with one device key that co-signs and takes a publish, answering
    /// `identity.status` from what it took. Its publish can be made to fail once.
    struct FakeExecutor {
        device: KeySigner,
        held: RefCell<Option<String>>,
        refuse_publish: Cell<bool>,
        /// A refusal every publish answers with, as a store that never takes this incept.
        refuse_for_good: RefCell<Option<(u16, String)>>,
        refuse_cosign: Cell<bool>,
        /// What `identity.status` answers as `store`: a trusted one unless a test says otherwise.
        store: RefCell<Value>,
        publishes: Cell<u32>,
        calls: Cell<u32>,
        /// What any other method answers, by name (`identity.inbox`, `identity.prepareDevice`, …).
        canned: RefCell<std::collections::HashMap<&'static str, Value>>,
        /// Every call by name, with its params, in order.
        seen: RefCell<Vec<(String, Value)>>,
        /// Once the key's method is called, the method named beside it answers its value.
        then: RefCell<std::collections::HashMap<&'static str, (&'static str, Value)>>,
        /// What a method refuses with, by name, ahead of anything it would answer.
        refusals: RefCell<std::collections::HashMap<&'static str, (u16, &'static str)>>,
        /// How long a method takes to answer, by name.
        delays: RefCell<std::collections::HashMap<&'static str, Duration>>,
    }

    impl FakeExecutor {
        fn new() -> Self {
            FakeExecutor {
                device: KeySigner::new(&[5u8; 32], 0),
                held: RefCell::new(None),
                refuse_publish: Cell::new(false),
                refuse_for_good: RefCell::new(None),
                refuse_cosign: Cell::new(false),
                store: RefCell::new(json!({ "url": "https://store.example", "trusted": true })),
                publishes: Cell::new(0),
                calls: Cell::new(0),
                canned: RefCell::new(Default::default()),
                seen: RefCell::new(Vec::new()),
                then: RefCell::new(Default::default()),
                refusals: RefCell::new(Default::default()),
                delays: RefCell::new(Default::default()),
            }
        }

        /// `method` answers `value` from now on.
        fn answer(&self, method: &'static str, value: Value) {
            self.canned.borrow_mut().insert(method, value);
        }

        /// Once `when` is called, `method` answers `value` (an `identity.acceptJoin` that lets the
        /// executor join, say).
        fn answer_after(&self, when: &'static str, method: &'static str, value: Value) {
            self.then.borrow_mut().insert(when, (method, value));
        }

        /// `method` refuses with `code` and `message` from now on.
        fn refuse(&self, method: &'static str, code: u16, message: &'static str) {
            self.refusals.borrow_mut().insert(method, (code, message));
        }

        /// `method` answers only `by` after it is called, from now on.
        fn delay(&self, method: &'static str, by: Duration) {
            self.delays.borrow_mut().insert(method, by);
        }

        fn called(&self, method: &str) -> Vec<Value> {
            self.seen
                .borrow()
                .iter()
                .filter(|(m, _)| m == method)
                .map(|(_, p)| p.clone())
                .collect()
        }
    }

    #[async_trait::async_trait(?Send)]
    impl ExecutorRpc for FakeExecutor {
        async fn call(&self, method: &str, p: Value) -> Result<Value, RpcError> {
            self.calls.set(self.calls.get() + 1);
            self.seen.borrow_mut().push((method.to_string(), p.clone()));
            let delay = self.delays.borrow().get(method).copied();
            if let Some(delay) = delay {
                tokio::time::sleep(delay).await;
            }
            let then = self.then.borrow_mut().remove(method);
            if let Some((next, value)) = then {
                self.canned.borrow_mut().insert(next, value);
            }
            if let Some((code, message)) = self.refusals.borrow().get(method) {
                return Err(RpcError {
                    code: *code,
                    message: message.to_string(),
                });
            }
            if let Some(value) = self.canned.borrow().get(method) {
                return Ok(value.clone());
            }
            match method {
                "identity.status" => {
                    let held = self.held.borrow().clone();
                    Ok(json!({
                        "did": held.as_deref().map(did_of),
                        "deviceKey": Signer::key(&self.device),
                        "deviceEnc": ad4m_identity_core::encode_x25519_multikey(&[6u8; 32]),
                        "keyId": held.map(|_| "d1"),
                        "revoked": null,
                        "head": null,
                        "fork": null,
                        "store": self.store.borrow().clone(),
                    }))
                }
                "identity.cosignIncept" => {
                    if self.refuse_cosign.get() {
                        return Err(RpcError {
                            code: 500,
                            message: "the keystore is locked".into(),
                        });
                    }
                    let mut event = Event::from_json(&p["event"]).unwrap();
                    cosign(&mut event, "d1", &self.device).unwrap();
                    Ok(serde_json::to_value(&event).unwrap())
                }
                "identity.publish" => {
                    if let Some((code, message)) = self.refuse_for_good.borrow().clone() {
                        return Err(RpcError { code, message });
                    }
                    if self.refuse_publish.replace(false) {
                        return Err(RpcError {
                            code: 503,
                            message: "the store did not answer".into(),
                        });
                    }
                    let event = Event::from_json(&p["events"][0]).unwrap();
                    self.publishes.set(self.publishes.get() + 1);
                    *self.held.borrow_mut() = Some(event.scid.clone());
                    Ok(json!({
                        "scid": event.scid, "seq": 0, "hash": "h", "time": 0,
                        "store": "did:key:zStore", "sig": "s",
                    }))
                }
                other => Err(RpcError {
                    code: 404,
                    message: format!("no {other}"),
                }),
            }
        }
    }

    /// A create of fixed words, past the two words typed back.
    fn confirmed(entropy: u8) -> CreateFlow {
        let words = words::from_entropy(&[entropy; 16]);
        let list: Vec<String> = words.words().iter().map(|w| w.to_string()).collect();
        let (mut flow, _) = CreateFlow::from_words(words);
        let CreateScreen::ConfirmWords { positions } = flow.words_written(&RANDOM).unwrap() else {
            panic!("expected the confirm screen");
        };
        flow.confirm([&list[positions[0] - 1], &list[positions[1] - 1]])
            .unwrap();
        flow
    }

    /// The desktop vault over `dir`, as the app opens it on each start.
    fn open_vault(dir: &std::path::Path) -> DesktopVault {
        DesktopVault::with_kdf(
            Box::new(FileStore::new(dir)),
            PendingIncepts::file(dir),
            CHEAP,
        )
    }

    fn pass() -> Option<Secret<String>> {
        Some(Secret::new(PASSPHRASE.to_string()))
    }

    #[tokio::test]
    async fn a_create_whose_publish_failed_is_finished_after_the_app_starts_again() {
        let dir = tempfile::tempdir().unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());

        // The publish fails after custody: the master key and the incept are kept, nothing is public.
        executor.rpc().refuse_publish.set(true);
        let vault = open_vault(dir.path());
        let failed_create = confirmed(21)
            .finish(&executor, &vault.unlocking(pass()))
            .await;
        assert!(
            matches!(&failed_create, Err(ClientError::Rpc(e)) if e.code == 503),
            "{failed_create:?}"
        );
        assert!(executor.rpc().held.borrow().is_none());
        let scid = vault.pending_incepts().unwrap()[0].scid.clone();
        drop(vault);

        // The app starts again: the incept and the master key are still here.
        let vault = open_vault(dir.path());
        assert_eq!(vault.pending_incepts().unwrap().len(), 1);
        assert!(vault.holds(&scid).unwrap());

        // Other words are refused while it is pending, in words a person reads.
        let other = confirmed(22)
            .finish(&executor, &vault.unlocking(pass()))
            .await;
        let Err(e @ ClientError::CreatePending(did)) = &other else {
            panic!("{other:?}");
        };
        assert_eq!(*did, did_of(&scid));
        let Screen::Failed { message } = failed(e) else {
            unreachable!()
        };
        assert!(message.contains(did.as_str()), "{message}");

        // Finishing it publishes the same incept, with no unlock, and forgets it.
        let created = finish_pending(&executor, &vault)
            .await
            .unwrap()
            .expect("a pending identity");
        assert_eq!(created.did, did_of(&scid));
        assert_eq!(created.device_key_id, "d1");
        assert_eq!(executor.rpc().publishes.get(), 1);
        assert_eq!(executor.rpc().held.borrow().as_deref(), Some(scid.as_str()));
        assert!(vault.pending_incepts().unwrap().is_empty());
        assert!(open_vault(dir.path()).pending_incepts().unwrap().is_empty());
        assert!(vault
            .unlocking(pass())
            .unlock(&scid, ad4m_identity_client::MasterUse::Link, 0)
            .is_ok());

        // Nothing left: finishing again asks the executor nothing.
        let calls = executor.rpc().calls.get();
        assert!(finish_pending(&executor, &vault).await.unwrap().is_none());
        assert_eq!(executor.rpc().calls.get(), calls);
    }

    #[tokio::test]
    async fn a_create_that_publishes_leaves_nothing_pending() {
        let dir = tempfile::tempdir().unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());
        let vault = open_vault(dir.path());
        let created = confirmed(23)
            .finish(&executor, &vault.unlocking(pass()))
            .await
            .unwrap();
        assert!(vault.pending_incepts().unwrap().is_empty());
        assert!(!dir.path().join(crate::pending::FILE_NAME).exists());
        assert!(vault
            .holds(ad4m_identity_core::scid_of(&created.did).unwrap())
            .unwrap());
    }

    #[test]
    fn steps_and_screens_cross_ipc_in_the_shapes_the_windows_expect() {
        let step: IdentityStep = serde_json::from_str(r#"{"kind":"revoke","keyId":"d2"}"#).unwrap();
        assert_eq!(
            step,
            IdentityStep::Revoke {
                key_id: "d2".into()
            }
        );
        let step: IdentityStep = serde_json::from_str(r#"{"kind":"add-device"}"#).unwrap();
        assert_eq!(step, IdentityStep::AddDevice);
        let screen = serde_json::to_value(Screen::ConfirmWords {
            positions: [3, 11],
            error: None,
        })
        .unwrap();
        assert_eq!(screen["screen"], "confirm-words");
        assert_eq!(screen["positions"][1], 11);
        let public = serde_json::to_value(CustodyPublic {
            did: Some("did:scid:coasys:1:Qm".into()),
            holds_master: Some(HoldsMaster { index: 0 }),
            unlock: "passphrase",
            blocked: Some(NO_STORE),
            devices: vec![DeviceName {
                key_id: "d1".into(),
                name: "Work laptop".into(),
                kind: DeviceKind::DesktopApp,
                holds_master: Holds::Offered,
            }],
            revoked_holders: vec!["d3".into()],
            requests: vec![RequestView {
                id: "r1".into(),
                kind: "send-master".into(),
                by: "d2".into(),
                key_ids: vec![],
                expires: 9,
            }],
            master_waiting: true,
        })
        .unwrap();
        assert_eq!(public["devices"][0]["keyId"], "d1");
        assert_eq!(public["devices"][0]["kind"], "desktop-app");
        assert_eq!(public["devices"][0]["holdsMaster"], "offered");
        assert_eq!(public["requests"][0]["kind"], "send-master");
        assert_eq!(public["requests"][0]["keyIds"], json!([]));
        assert_eq!(public["masterWaiting"], true);
        assert_eq!(public["revokedHolders"], json!(["d3"]));
        assert_eq!(public["holdsMaster"]["index"], 0);
        assert_eq!(public["blocked"], NO_STORE);
        let screen = serde_json::to_value(Screen::PendingRefused {
            did: "did:scid:coasys:1:Qm".into(),
            message: "refused".into(),
        })
        .unwrap();
        assert_eq!(screen["screen"], "pending-refused");
        let input: StepInput = serde_json::from_str(r#"{"kind":"discard"}"#).unwrap();
        assert!(matches!(input, StepInput::Discard));
    }

    #[test]
    fn an_input_never_prints_what_was_typed() {
        let input: StepInput =
            serde_json::from_str(r#"{"kind":"passphrase","passphrase":"hunter2 hunter2 hunter2"}"#)
                .unwrap();
        assert_eq!(format!("{input:?}"), "passphrase");
        let input: StepInput =
            serde_json::from_str(r#"{"kind":"words","answers":["orbit","lamp"]}"#).unwrap();
        assert!(!format!("{input:?}").contains("orbit"));
    }

    #[test]
    fn only_the_last_screens_end_a_step() {
        assert_eq!(Screen::ShowWords { words: vec![] }.outcome(), None);
        assert_eq!(
            Screen::Linked {
                seq: 1,
                master_sent: false,
                note: None
            }
            .outcome(),
            Some(StepOutcome::Done)
        );
        for done in [
            Screen::Joined {
                did: "did:scid:x".into(),
                key_id: "d2".into(),
            },
            Screen::MasterTaken {
                did: "did:scid:x".into(),
                note: None,
            },
            Screen::RequestAnswered {
                kind: "send-master",
                device: "Phone".into(),
                note: None,
            },
            Screen::Asked {
                key_id: "d2".into(),
                fingerprint: "ABCD EFGH".into(),
                code: "R7K Q2M".into(),
            },
            Screen::Renamed {
                key_id: "d2".into(),
                name: "Desk".into(),
            },
        ] {
            assert_eq!(done.outcome(), Some(StepOutcome::Done), "{done:?}");
        }
        for open in [
            Screen::EnterCode { error: None },
            Screen::CodeSent { expires: 1 },
            Screen::DeviceCode {
                code: "c".into(),
                qr_svg: String::new(),
                expires: 1,
            },
            Screen::DeviceMatch {
                code: "R7K Q2M".into(),
                did: "did:scid:x".into(),
                needs_accept: true,
                accepted: true,
                confirmed: false,
            },
        ] {
            assert_eq!(open.outcome(), None, "{open:?}");
        }
        assert_eq!(
            Screen::Failed {
                message: String::new()
            }
            .outcome(),
            Some(StepOutcome::Failed)
        );
    }

    /// An offer names the store the executor reports it uses; with none, or one it trusts no key
    /// for, the step is refused in the same words the executor's own refusal reads as.
    #[tokio::test]
    async fn a_step_publishes_through_the_store_the_executor_reports_or_is_refused() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        *executor.rpc().store.borrow_mut() =
            json!({ "url": "https://store.network.example", "trusted": true });
        assert_eq!(
            trusted_store(&executor).await,
            Ok("https://store.network.example".to_string())
        );
        let no_store = Screen::Failed {
            message: NO_STORE.into(),
        };
        for store in [
            Value::Null,
            json!({ "url": "https://store.network.example", "trusted": false }),
        ] {
            *executor.rpc().store.borrow_mut() = store;
            assert_eq!(trusted_store(&executor).await, Err(no_store.clone()));
        }
        // An executor that predates `store` has none to report, and is refused the same way.
        assert_eq!(
            ViaExecutor::new(OldExecutor).status().await.unwrap().store,
            None
        );
        assert_eq!(
            trusted_store(&ViaExecutor::new(OldExecutor)).await,
            Err(no_store)
        );
    }

    /// `identity.status` as an executor answered it before it reported its store.
    struct OldExecutor;

    #[async_trait::async_trait(?Send)]
    impl ExecutorRpc for OldExecutor {
        async fn call(&self, _: &str, _: Value) -> Result<Value, RpcError> {
            Ok(json!({ "did": null, "deviceKey": "z6Mk", "deviceEnc": "z6LS" }))
        }
    }

    /// The first-run screen draws "Make my identity here" disabled from `blocked`: set from the
    /// executor's store, and not set while nothing is known.
    #[tokio::test]
    async fn the_public_state_is_blocked_when_the_executor_has_no_store_it_trusts() {
        let vault = DesktopVault::new(
            Box::new(crate::store::MemoryStore::new()),
            PendingIncepts::memory(),
        );
        let executor = ViaExecutor::new(FakeExecutor::new());
        assert_eq!(public_state_on(Some(&executor), &vault).await.blocked, None);
        for store in [
            Value::Null,
            json!({ "url": "https://store.example", "trusted": false }),
        ] {
            *executor.rpc().store.borrow_mut() = store;
            assert_eq!(
                public_state_on(Some(&executor), &vault).await.blocked,
                Some(NO_STORE)
            );
        }
        assert_eq!(
            public_state_on::<FakeExecutor>(None, &vault).await.blocked,
            None
        );
    }

    #[test]
    fn an_offer_link_becomes_a_qr_code() {
        let svg = qr_svg("https://id.coasys.org/o#coasys:offer:1:abc");
        assert!(svg.starts_with("<?xml") || svg.starts_with("<svg"));
    }

    #[tokio::test]
    async fn a_step_input_with_no_step_open_is_refused_and_cancel_is_harmless() {
        let vault = DesktopVault::new(
            Box::new(crate::store::MemoryStore::new()),
            crate::pending::PendingIncepts::memory(),
        );
        let handle = spawn(
            vault,
            ExecutorAddress {
                url: "http://127.0.0.1:9".into(),
                credential: Arc::from("x"),
            },
        );
        assert_eq!(
            handle.step(StepInput::WaitClaim).await,
            Err(CustodyError::NoStep)
        );
        handle.cancel().await;
        // No executor answers on port 9: the step stops at once, publishing nothing.
        let screen = handle.start(IdentityStep::Create).await.unwrap();
        assert!(matches!(screen, Screen::Failed { .. }));
        // With no executor there is no identity to report.
        let public = handle.public_state().await.unwrap();
        assert_eq!(
            (
                public.did,
                public.holds_master,
                public.unlock,
                public.blocked
            ),
            (None, None, "passphrase", None)
        );
    }

    /// With no store the executor trusts, making an identity stops before any words are made,
    /// and asks nothing more of the executor than its status.
    #[tokio::test]
    async fn a_create_with_no_trusted_store_is_refused_before_words_are_made() {
        for store in [
            Value::Null,
            json!({ "url": "https://store.example", "trusted": false }),
        ] {
            let executor = ViaExecutor::new(FakeExecutor::new());
            *executor.rpc().store.borrow_mut() = store;
            let vault = DesktopVault::new(
                Box::new(crate::store::MemoryStore::new()),
                PendingIncepts::memory(),
            );
            let screens =
                run_create_on(&executor, &vault, |_, first| async move { vec![first] }).await;
            assert_eq!(
                screens,
                vec![Screen::Failed {
                    message: NO_STORE.into()
                }]
            );
            assert_eq!(executor.rpc().calls.get(), 1);
            assert_eq!(executor.rpc().publishes.get(), 0);
        }
    }

    #[test]
    fn the_executors_no_store_refusal_reads_as_the_same_sentence() {
        let refusal = ClientError::Rpc(RpcError {
            code: 503,
            // As the executor answers it (`IdentityService::refuse_without_store_keys`).
            message: "no-store-keys: identity.storeKeys is not set, so this executor accepts no \
                      head from the identity store and cannot bind an agent to a log; set \
                      identity.storeKeys first"
                .into(),
        });
        let expected = Screen::Failed {
            message: NO_STORE.into(),
        };
        assert_eq!(failed(&refusal), expected);
        assert_eq!(unfinished(&refusal), expected);
        // Not a refusal for good: a build with a key finishes the same identity.
        assert!(refused_for_good(&refusal, "did:scid:coasys:1:Qm").is_none());
    }

    #[test]
    fn only_refusals_that_retrying_cannot_fix_count_as_for_good() {
        let rpc = |code, message: &str| {
            ClientError::Rpc(RpcError {
                code,
                message: message.into(),
            })
        };
        let did = "did:scid:coasys:1:Qm";
        for transient in [
            rpc(503, "unavailable: the store did not answer"),
            rpc(429, "rate-limited: Ip, retry after 30 s"),
            rpc(502, "bad-head-signature: the store's head is not signed"),
            ClientError::Vault(VaultError::Unavailable("locked".into())),
        ] {
            assert!(refused_for_good(&transient, did).is_none(), "{transient:?}");
        }
        let (_, key) = refused_for_good(&rpc(409, "key-taken: z6Mk sits in a log"), did).unwrap();
        assert!(key);
        for permanent in [
            rpc(409, "conflict: the store's head is seq 3 (h)"),
            rpc(400, "invalid: bad proof"),
            rpc(403, "forbidden: \"pow\""),
        ] {
            let (message, key) = refused_for_good(&permanent, did).unwrap();
            assert!(!key && message.contains(did), "{message}");
        }
    }

    #[tokio::test]
    async fn a_pending_incept_this_computer_can_never_publish_is_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());
        let vault = open_vault(dir.path());
        executor.rpc().refuse_publish.set(true);
        let _ = confirmed(31)
            .finish(&executor, &vault.unlocking(pass()))
            .await;
        let scid = vault.pending_incepts().unwrap()[0].scid.clone();

        // Meanwhile this computer came to speak for another identity.
        *executor.rpc().held.borrow_mut() = Some("QmAnotherIdentity".into());
        assert!(finish_pending(&executor, &vault).await.unwrap().is_none());
        assert!(vault.pending_incepts().unwrap().is_empty());
        assert_eq!(executor.rpc().publishes.get(), 0);
        // Only the incept is forgotten: the master key stays where it rests.
        assert!(vault.holds(&scid).unwrap());
    }

    #[tokio::test]
    async fn a_pending_incept_the_store_refused_for_good_can_be_discarded_for_new_words() {
        let dir = tempfile::tempdir().unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());
        let vault = open_vault(dir.path());
        *executor.rpc().refuse_for_good.borrow_mut() =
            Some((409, "conflict: the store's head is seq 2 (h)".into()));
        let _ = confirmed(32)
            .finish(&executor, &vault.unlocking(pass()))
            .await;
        let scid = vault.pending_incepts().unwrap()[0].scid.clone();
        let did = did_of(&scid);

        let screens = run_create_on(&executor, &vault, |window, first| async move {
            let mut seen = vec![first];
            seen.push(window.step(StepInput::Discard).await);
            seen
        })
        .await;
        let Screen::PendingRefused {
            did: refused,
            message,
        } = &screens[0]
        else {
            panic!("{screens:?}");
        };
        assert_eq!(*refused, did);
        assert!(message.contains("different log"), "{message}");
        // Discarded: the create goes on to new words, and nothing is pending.
        assert!(
            matches!(&screens[1], Screen::ShowWords { words } if words.len() == 12),
            "{screens:?}"
        );
        assert!(vault.pending_incepts().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_refusal_for_good_is_not_discarded_unless_asked() {
        let dir = tempfile::tempdir().unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());
        let vault = open_vault(dir.path());
        *executor.rpc().refuse_for_good.borrow_mut() =
            Some((409, "key-taken: z6Mk sits in a log".into()));
        let _ = confirmed(33)
            .finish(&executor, &vault.unlocking(pass()))
            .await;

        // Cancelled on the refusal screen: the incept is still kept.
        let screens = run_create_on(&executor, &vault, |_, first| async move { vec![first] }).await;
        assert!(matches!(&screens[0], Screen::PendingRefused { .. }));
        assert_eq!(vault.pending_incepts().unwrap().len(), 1);

        // Discarded where the key is taken: no new words, since they would be refused the same way.
        let screens = run_create_on(&executor, &vault, |window, first| async move {
            vec![first, window.step(StepInput::Discard).await]
        })
        .await;
        let Screen::Failed { message } = &screens[1] else {
            panic!("{screens:?}");
        };
        assert!(
            message.contains("discarded") && message.contains("key log"),
            "{message}"
        );
        assert!(vault.pending_incepts().unwrap().is_empty());
    }

    /// A co-signed-shape incept of fixed words listing another executor's device key: what another
    /// account on this computer keeps in the shared custody folder.
    fn foreign_incept(entropy: u8) -> Event {
        use ad4m_identity_core::build::incept_human;
        use ad4m_identity_core::{DeviceKey, KeyLife};
        let seed = words::seed(&words::from_entropy(&[entropy; 16]));
        let master = words::master_key(&seed, 0).unwrap();
        let (next, _) = words::next_commitment(&seed, 1).unwrap();
        let device = DeviceKey {
            id: "d1".into(),
            sign: Signer::key(&KeySigner::new(&[7u8; 32], 0)),
            enc: ad4m_identity_core::encode_x25519_multikey(&[8u8; 32]),
            life: KeyLife::Standing,
        };
        incept_human(&master, next, vec![device]).unwrap()
    }

    #[tokio::test]
    async fn another_accounts_pending_incept_is_neither_finished_nor_reported() {
        let dir = tempfile::tempdir().unwrap();
        let foreign = foreign_incept(34);
        PendingIncepts::file(dir.path()).keep(&foreign).unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());
        let vault = open_vault(dir.path());

        // Not this executor's to publish.
        assert!(finish_pending(&executor, &vault).await.unwrap().is_none());
        assert_eq!(executor.rpc().publishes.get(), 0);
        assert_eq!(vault.pending_incepts().unwrap(), vec![foreign.clone()]);

        // A create here goes on to words, and a failure before custody is not reported as an
        // identity made here and still being finished.
        executor.rpc().refuse_cosign.set(true);
        let screens = run_create_on(&executor, &vault, |window, first| async move {
            vec![write_down(&window, first).await]
        })
        .await;
        let Screen::Failed { message } = &screens[0] else {
            panic!("{screens:?}");
        };
        assert!(!message.contains("made on this computer"), "{message}");
        assert_eq!(vault.pending_incepts().unwrap(), vec![foreign]);
    }

    /// The identity window's side of a step, sending inputs to the flow as the app does.
    struct Window {
        tx: mpsc::UnboundedSender<Request>,
    }

    impl Window {
        async fn step(&self, input: StepInput) -> Screen {
            let (tx, rx) = oneshot::channel();
            self.tx.send(Request::Step(input, tx)).unwrap();
            rx.await.unwrap().unwrap()
        }
    }

    /// Runs [`create_on`] against `executor`, with `window` driving it from its first screen.
    /// The step ends when the driver returns (the window closes).
    async fn run_create_on<F, Fut>(
        executor: &ViaExecutor<FakeExecutor>,
        vault: &DesktopVault,
        window: F,
    ) -> Vec<Screen>
    where
        F: FnOnce(Window, Screen) -> Fut,
        Fut: std::future::Future<Output = Vec<Screen>>,
    {
        let address = ExecutorAddress {
            url: "http://127.0.0.1:9".into(),
            credential: Arc::from("x"),
        };
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (first_tx, first_rx) = oneshot::channel();
        let mut reply = Some(first_tx);
        let ((), screens) = tokio::join!(
            create_on(executor, vault, &address, &mut rx, &mut reply),
            async move {
                let first = first_rx.await.unwrap().unwrap();
                window(Window { tx }, first).await
            }
        );
        screens
    }

    /// From the words to the passphrase, as a person does it: the screen after the passphrase.
    async fn write_down(window: &Window, first: Screen) -> Screen {
        let Screen::ShowWords { words } = first else {
            panic!("{first:?}");
        };
        let Screen::ConfirmWords { positions, .. } = window.step(StepInput::WordsWritten).await
        else {
            panic!("expected the confirm screen");
        };
        let answers = [
            words[positions[0] - 1].clone(),
            words[positions[1] - 1].clone(),
        ];
        let next = window.step(StepInput::Words { answers }).await;
        assert!(matches!(next, Screen::SetPassphrase { .. }), "{next:?}");
        window
            .step(StepInput::Passphrase {
                passphrase: PASSPHRASE.into(),
                confirm: Some(PASSPHRASE.into()),
            })
            .await
    }

    type FirstScreen = oneshot::Receiver<Result<Screen, CustodyError>>;

    /// A step's channels as the app opens them: an address no executor answers on (each test hands
    /// the flow its fake executor), the flow's ends, the window, and the first screen's slot.
    fn opened() -> (ExecutorAddress, Rx, Reply, Window, FirstScreen) {
        let (tx, rx) = mpsc::unbounded_channel();
        let (first_tx, first_rx) = oneshot::channel();
        let address = ExecutorAddress {
            url: "http://127.0.0.1:9".into(),
            credential: Arc::from("x"),
        };
        (address, rx, Some(first_tx), Window { tx }, first_rx)
    }

    fn memory_vault(kind: crate::store::StoreKind) -> DesktopVault {
        DesktopVault::new(
            Box::new(crate::store::MemoryStore::as_kind(kind)),
            PendingIncepts::memory(),
        )
    }

    /// A SCID `ad4m_identity_core::scid_of` reads: a sha2-256 multihash.
    const LINKED_SCID: &str = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

    /// An executor that speaks for an identity (`did_of(LINKED_SCID)`, this computer `d1`) whose
    /// master key this vault does not hold: a linked device.
    fn linked_executor() -> ViaExecutor<FakeExecutor> {
        let executor = ViaExecutor::new(FakeExecutor::new());
        *executor.rpc().held.borrow_mut() = Some(LINKED_SCID.into());
        executor
    }

    #[tokio::test]
    async fn a_new_device_shows_its_code_and_follows_the_link_to_the_end() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        let expires = CLOCK.now() + 300;
        let did = "did:scid:coasys:1:Qm";
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "sign": "z6Mk", "enc": "z6LS", "device": "coasys:device:1:abc", "expires": expires }),
        );
        executor.rpc().answer(
            "identity.joinStatus",
            json!({ "state": "spent", "did": did, "keyId": "d2", "seq": 1 }),
        );
        let (events_tx, events) = broadcast::channel(8);
        // Another topic's event first: the step waits past it for the ticket.
        events_tx.send(json!({ "type": "inbox-message" })).unwrap();
        events_tx
            .send(json!({ "type": "link-ticket", "did": did, "offerId": "o1", "matchCode": "R7K Q2M" }))
            .unwrap();
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async move {
                let first = first.await.unwrap().unwrap();
                let matched = window.step(StepInput::WaitLink).await;
                let joined = window.step(StepInput::WaitJoin).await;
                vec![first, matched, joined]
            }
        );
        let Screen::DeviceCode {
            code,
            qr_svg,
            expires: shown,
        } = &screens[0]
        else {
            panic!("{screens:?}")
        };
        assert_eq!(code, "coasys:device:1:abc");
        assert!(qr_svg.contains("<svg"));
        assert_eq!(*shown, expires);
        assert!(
            matches!(
                &screens[1],
                Screen::DeviceMatch { code, did: d, needs_accept: false, accepted: false, confirmed: false }
                    if code == "R7K Q2M" && d == did
            ),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[2], Screen::Joined { did: d, key_id } if d == did && key_id == "d2"),
            "{screens:?}"
        );
        assert_eq!(
            executor.rpc().called("identity.joinStatus"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    #[tokio::test]
    async fn a_link_that_ends_unconfirmed_says_so_on_the_new_device() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
        );
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "expired" }));
        let (events_tx, events) = broadcast::channel(8);
        events_tx
            .send(json!({ "type": "link-ticket", "did": "did:scid:x", "offerId": "o1", "matchCode": "AAA BBB" }))
            .unwrap();
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), last) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async move {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                window.step(StepInput::WaitJoin).await
            }
        );
        assert!(
            matches!(&last, Screen::Failed { message } if message.contains("ended unconfirmed (expired)")),
            "{last:?}"
        );
    }

    /// A new device whose executor claims offer `o1` of `did:scid:x` at once, its `link-ticket`
    /// carrying `needsAccept` when given.
    fn claiming_device(
        needs_accept: Option<bool>,
    ) -> (ViaExecutor<FakeExecutor>, broadcast::Receiver<Value>) {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
        );
        let mut ticket = json!({ "type": "link-ticket", "did": "did:scid:x", "offerId": "o1", "matchCode": "AAA BBB" });
        if let Some(needs) = needs_accept {
            ticket["needsAccept"] = json!(needs);
        }
        let (events_tx, events) = broadcast::channel(8);
        events_tx.send(ticket).unwrap();
        (executor, events)
    }

    fn device_match(needs_accept: bool, accepted: bool, confirmed: bool) -> Screen {
        Screen::DeviceMatch {
            code: "AAA BBB".into(),
            did: "did:scid:x".into(),
            needs_accept,
            accepted,
            confirmed,
        }
    }

    /// A first run: the holder confirms before the person accepts here. The window keeps asking
    /// until they do, and the accept lets this computer join at once.
    #[tokio::test]
    async fn a_first_run_device_joins_only_once_the_person_accepts_the_identity() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "awaiting-accept" }));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor.rpc().answer_after(
            "identity.acceptJoin",
            "identity.joinStatus",
            json!({ "state": "spent", "did": "did:scid:x", "keyId": "d2", "seq": 1 }),
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                let matched = window.step(StepInput::WaitLink).await;
                // The holder confirmed: the window still asks, and waits again.
                let confirmed = window.step(StepInput::WaitJoin).await;
                let (waiting, joined) = tokio::join!(
                    window.step(StepInput::WaitJoin),
                    window.step(StepInput::Accept)
                );
                vec![matched, confirmed, waiting, joined]
            }
        );
        assert_eq!(screens[0], device_match(true, false, false));
        assert_eq!(screens[1], device_match(true, false, true));
        // The wait the window had out answers with the accept; the accept follows to the end.
        assert_eq!(screens[2], device_match(true, true, true));
        assert!(
            matches!(&screens[3], Screen::Joined { did, key_id } if did == "did:scid:x" && key_id == "d2"),
            "{screens:?}"
        );
        assert_eq!(
            executor.rpc().called("identity.acceptJoin"),
            vec![json!({ "offerId": "o1" })]
        );
        assert!(executor.rpc().called("identity.cancelJoin").is_empty());
    }

    /// Accepted before the holder confirms: the accept itself waits for the join.
    #[tokio::test]
    async fn an_accept_before_the_holder_confirms_waits_for_the_join() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor.rpc().answer(
            "identity.joinStatus",
            json!({ "state": "spent", "did": "did:scid:x", "keyId": "d2", "seq": 1 }),
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), joined) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                window.step(StepInput::Accept).await
            }
        );
        assert!(matches!(&joined, Screen::Joined { .. }), "{joined:?}");
        let calls: Vec<String> = executor
            .rpc()
            .seen
            .borrow()
            .iter()
            .map(|(m, _)| m.clone())
            .filter(|m| m.ends_with("Join") || m.ends_with("joinStatus"))
            .collect();
        assert_eq!(calls, ["identity.acceptJoin", "identity.joinStatus"]);
    }

    /// An executor that waits for an accept the `link-ticket` did not announce: the window asks.
    #[tokio::test]
    async fn a_claim_that_awaits_an_accept_asks_for_it_whatever_the_ticket_said() {
        let (executor, events) = claiming_device(None);
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "awaiting-accept" }));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let (_, screens) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(5),
                show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            async {
                first.await.unwrap().unwrap();
                let matched = window.step(StepInput::WaitLink).await;
                let asked = window.step(StepInput::WaitJoin).await;
                // Answered without a join: a wait for the step's end is refused.
                let (tx, refused) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitLink, tx))
                    .unwrap();
                let refused = refused.await.unwrap();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let cancelled = cancelled.await.unwrap();
                (matched, asked, refused, cancelled)
            }
        );
        assert_eq!(screens.0, device_match(false, false, false));
        assert_eq!(screens.1, device_match(true, false, true));
        assert!(matches!(screens.2, Err(CustodyError::WrongInput)));
        // Cancelled between waits: the claim ends with it, and only then is the cancel answered.
        assert_eq!(screens.3, None);
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// Cancel while the device waits ends the step and the executor's claim.
    #[tokio::test]
    async fn cancelling_a_claimed_link_ends_the_claim() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), waited) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitJoin, tx))
                    .unwrap();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                (cancelled.await.unwrap(), waited.await.unwrap())
            }
        );
        let (cancelled, waited) = waited;
        // Confirmed by the executor: the window may close.
        assert_eq!(cancelled, None);
        assert!(matches!(waited, Err(CustodyError::NoStep)), "{waited:?}");
        assert!(executor.rpc().called("identity.acceptJoin").is_empty());
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// An accept the executor refuses (the offer is gone) ends the step, saying so.
    #[tokio::test]
    async fn an_accept_of_an_offer_the_executor_no_longer_knows_says_so() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (waiting, accepted)) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                tokio::join!(
                    window.step(StepInput::WaitJoin),
                    window.step(StepInput::Accept)
                )
            }
        );
        // The fake answers an unknown method 404, as the executor answers an unknown offer.
        for screen in [&waiting, &accepted] {
            assert!(
                matches!(screen, Screen::Failed { message } if message.contains("no longer open")),
                "{screen:?}"
            );
        }
    }

    /// A cancel that reaches the executor after the claim bound (409 `already-joined`) does not
    /// undo the join: the step shows this computer joined, not cancelled. The cancel is answered
    /// only once the executor has: the holder's add lands while `identity.cancelJoin` is on its
    /// way, and the cancel answers `Joined`, so the window shows it rather than closing.
    #[tokio::test]
    async fn a_cancel_that_comes_after_the_join_shows_the_join() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor.rpc().refuse(
            "identity.cancelJoin",
            409,
            "already-joined: the main agent speaks for this claim's identity",
        );
        executor
            .rpc()
            .delay("identity.cancelJoin", Duration::from_millis(300));
        executor.rpc().answer_after(
            "identity.cancelJoin",
            "identity.joinStatus",
            json!({ "state": "spent", "did": "did:scid:x", "keyId": "d2", "seq": 1 }),
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (cancelled, waited)) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitJoin, tx))
                    .unwrap();
                let (tx, mut cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                // Not answered while the executor has yet to say how the claim ended.
                let cancelled =
                    match tokio::time::timeout(Duration::from_millis(100), &mut cancelled).await {
                        Ok(early) => {
                            panic!("the cancel was answered before the executor's: {early:?}")
                        }
                        Err(_) => cancelled.await.unwrap(),
                    };
                (cancelled, waited.await.unwrap())
            }
        );
        let joined = |screen: Option<&Screen>| matches!(screen, Some(Screen::Joined { did, key_id }) if did == "did:scid:x" && key_id == "d2");
        assert!(joined(cancelled.as_ref()), "{cancelled:?}");
        assert!(joined(waited.as_ref().ok()), "{waited:?}");
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// A late cancel whose join status does not name the key still says the join completed.
    #[tokio::test]
    async fn a_late_cancel_without_the_joined_key_says_the_join_completed() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().refuse(
            "identity.cancelJoin",
            409,
            "already-joined: the main agent speaks for this claim's identity",
        );
        let screen = cancel_join(&executor, "o1").await;
        assert!(
            matches!(&screen, Some(Screen::Failed { message }) if message == ALREADY_JOINED),
            "{screen:?}"
        );
        // A claim already cancelled is as good as this cancel.
        executor.rpc().refuse(
            "identity.cancelJoin",
            409,
            "cancelled: the claim of this offer is cancelled",
        );
        assert!(cancel_join(&executor, "o1").await.is_none());
    }

    /// A cancel the executor refuses, or does not answer, leaves the claim standing: the step says
    /// the cancel was not confirmed, and the window stays.
    #[tokio::test]
    async fn a_cancel_the_executor_does_not_confirm_says_so() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor
            .rpc()
            .refuse("identity.cancelJoin", 503, "the executor is busy");
        assert_eq!(
            cancel_join(&executor, "o1").await,
            Some(cancel_unconfirmed())
        );

        tokio::time::pause();
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        executor
            .rpc()
            .delay("identity.cancelJoin", CANCEL_WAIT + Duration::from_secs(1));
        assert_eq!(
            cancel_join(&executor, "o1").await,
            Some(cancel_unconfirmed())
        );
    }

    /// A cancel the executor does not confirm, through the flow: answered with the screen that
    /// says so, as is the wait it ended.
    #[tokio::test]
    async fn a_cancelled_wait_whose_cancel_is_unconfirmed_keeps_the_window() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .refuse("identity.cancelJoin", 503, "the executor is busy");
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (cancelled, waited)) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitJoin, tx))
                    .unwrap();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                (cancelled.await.unwrap(), waited.await.unwrap())
            }
        );
        assert_eq!(cancelled, Some(cancel_unconfirmed()));
        assert_eq!(waited, Ok(cancel_unconfirmed()));
    }

    /// An accept the executor refuses because the claim was cancelled here ends the step, saying so.
    #[tokio::test]
    async fn an_accept_of_a_cancelled_claim_says_it_was_cancelled() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor.rpc().refuse(
            "identity.acceptJoin",
            409,
            "cancelled: the claim of this offer is cancelled",
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (waiting, accepted)) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                tokio::join!(
                    window.step(StepInput::WaitJoin),
                    window.step(StepInput::Accept)
                )
            }
        );
        for screen in [&waiting, &accepted] {
            assert_eq!(*screen, cancelled_here(), "{screen:?}");
        }
    }

    /// A claim whose status turns `cancelled` while the device follows it ends the step, saying so.
    #[tokio::test]
    async fn a_claim_cancelled_while_followed_says_it_was_cancelled() {
        let (executor, events) = claiming_device(Some(true));
        executor.rpc().answer(
            "identity.joinStatus",
            json!({ "state": "cancelled", "did": "did:scid:x" }),
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), last) = tokio::join!(
            show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                window.step(StepInput::WaitJoin).await
            }
        );
        assert!(
            matches!(&last, Screen::Failed { message } if message == "This link was cancelled on this computer. Show a new code to try again."),
            "{last:?}"
        );
    }

    #[tokio::test]
    async fn a_computer_that_speaks_for_an_identity_shows_no_code() {
        let executor = linked_executor();
        let (_events_tx, events) = broadcast::channel(1);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, _window, first) = opened();
        show_code_on(&executor, events, &vault, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message.contains("already speaks for")),
            "{screen:?}"
        );
        assert!(executor.rpc().called("identity.prepareDevice").is_empty());
    }

    #[tokio::test]
    async fn with_no_master_key_waiting_nothing_is_taken() {
        let executor = linked_executor();
        executor.rpc().answer(
            "identity.inbox",
            json!([{ "id": "m0", "kind": "offer-ticket", "storedAt": 0, "expires": 9 }]),
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, _window, first) = opened();
        take_master_on(&executor, &vault, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message == NO_MASTER_WAITING),
            "{screen:?}"
        );
        assert!(executor.rpc().called("identity.takeMaster").is_empty());
    }

    #[tokio::test]
    async fn a_master_key_taken_into_a_sealed_store_gets_a_passphrase_first() {
        let dir = tempfile::tempdir().unwrap();
        let executor = linked_executor();
        executor.rpc().answer(
            "identity.inbox",
            json!([{ "id": "m1", "kind": "master", "storedAt": 0, "expires": 9 }]),
        );
        // Another app on this computer took it meanwhile.
        executor.rpc().answer("identity.takeMaster", Value::Null);
        let vault = open_vault(dir.path());
        assert!(vault.needs_passphrase());
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            take_master_on(&executor, &vault, &address, &mut rx, &mut reply),
            async move {
                let first = first.await.unwrap().unwrap();
                // Any other first screen ends the step, and a step sent after it would wait forever.
                if !matches!(first, Screen::SetPassphrase { error: None }) {
                    return vec![first];
                }
                // A passphrase `seal::check_new` refuses asks again, before any take.
                let weak = window
                    .step(StepInput::Passphrase {
                        passphrase: "short".into(),
                        confirm: Some("short".into()),
                    })
                    .await;
                let taken = window
                    .step(StepInput::Passphrase {
                        passphrase: PASSPHRASE.into(),
                        confirm: Some(PASSPHRASE.into()),
                    })
                    .await;
                vec![first, weak, taken]
            }
        );
        assert!(matches!(screens[0], Screen::SetPassphrase { error: None }));
        assert!(
            matches!(screens[1], Screen::SetPassphrase { error: Some(_) }),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[2], Screen::Failed { message } if message == NO_MASTER_WAITING),
            "{screens:?}"
        );
        assert_eq!(executor.rpc().called("identity.takeMaster").len(), 1);
    }

    #[tokio::test]
    async fn a_linked_device_without_the_master_key_asks_for_it() {
        let executor = linked_executor();
        executor
            .rpc()
            .answer("identity.postRequest", json!({ "id": "r1" }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let screen = ask_master_on(&executor, &vault).await;
        // The asking screen shows this device's key and the request's code, as the card does.
        let key = Signer::key(&executor.rpc().device);
        let Screen::Asked {
            key_id,
            fingerprint,
            code,
        } = &screen
        else {
            panic!("{screen:?}");
        };
        assert_eq!(key_id, "d1");
        assert_eq!(*fingerprint, crate::keylog::fingerprint(key.as_str()));
        assert_eq!(
            *code,
            ad4m_identity_core::link::match_code(LINKED_SCID, "r1", key.as_str())
        );
        assert_eq!(
            executor.rpc().called("identity.postRequest"),
            vec![json!({ "body": { "kind": "send-master" } })]
        );

        // Not linked yet: nothing to ask, nothing posted.
        let unlinked = ViaExecutor::new(FakeExecutor::new());
        let screen = ask_master_on(&unlinked, &vault).await;
        assert!(matches!(screen, Screen::Failed { .. }), "{screen:?}");
        assert!(unlinked.rpc().called("identity.postRequest").is_empty());
    }

    #[tokio::test]
    async fn a_request_no_longer_waiting_is_said_so() {
        let executor = linked_executor();
        executor.rpc().answer("identity.requests", json!([]));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, _window, first) = opened();
        answer_on(
            &executor,
            &vault,
            &address,
            &mut rx,
            &mut reply,
            "r9".into(),
        )
        .await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message.contains("no longer waiting")),
            "{screen:?}"
        );
    }

    /// The card names who asks from the key log, whatever the record says: with no record entry
    /// (no name, no kind; a renamed one is no different) the poster still shows its own key id,
    /// fingerprint and the request's code. Whether it may get the master key is its claim's, in
    /// the log, never the record's kind: the same key that joined saying no is refused.
    #[tokio::test]
    async fn a_request_card_shows_the_key_logs_device_whatever_the_record_says() {
        for may_keep in [true, false] {
            let (events, d2) = crate::keylog::tests::log_with_d2(may_keep);
            let scid = events[0].scid.clone();
            let executor = ViaExecutor::new(FakeExecutor::new());
            *executor.rpc().held.borrow_mut() = Some(scid.clone());
            let events: Vec<Value> = events
                .iter()
                .map(|e| serde_json::to_value(e).unwrap())
                .collect();
            executor.rpc().answer(
                "identity.log",
                json!({ "did": did_of(&scid), "events": events, "head": null, "fork": null }),
            );
            executor.rpc().answer(
                "identity.requests",
                json!([{
                    "id": "r1", "body": { "kind": "send-master" },
                    "by": "d2", "created": 0, "expires": 99,
                    "signed": { "req": {
                        "did": did_of(&scid), "store": "did:key:zStore", "keyId": "d2",
                        "kelSeq": 1, "kelHash": "h", "method": "POST", "path": "/requests",
                        "bodyHash": "b", "nonce": "n", "expires": 99,
                    }, "sig": "s" },
                }]),
            );
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let (address, mut rx, mut reply, window, first) = opened();
            // No answer comes: the step ends after its first screen.
            drop(window);
            answer_on(
                &executor,
                &vault,
                &address,
                &mut rx,
                &mut reply,
                "r1".into(),
            )
            .await;
            let screen = first.await.unwrap().unwrap();
            let key = Signer::key(&d2);
            if may_keep {
                let Screen::Request {
                    key_id,
                    fingerprint,
                    code,
                    device,
                    ..
                } = &screen
                else {
                    panic!("{screen:?}");
                };
                assert_eq!(key_id, "d2");
                assert_eq!(*fingerprint, crate::keylog::fingerprint(key.as_str()));
                assert_eq!(
                    *code,
                    ad4m_identity_core::link::match_code(&scid, "r1", key.as_str())
                );
                assert_eq!(device, "Device d2");
            } else {
                assert!(
                    matches!(&screen, Screen::Failed { message }
                        if message.contains("does not keep the master key")),
                    "{screen:?}"
                );
            }
        }
    }

    /// An RNG that draws `self.0` for every byte, so a test knows the record key
    /// `seal_record` drew (its first 32 bytes).
    struct Fixed(u8);

    impl rand_core::RngCore for Fixed {
        fn next_u32(&mut self) -> u32 {
            u32::from_le_bytes([self.0; 4])
        }
        fn next_u64(&mut self) -> u64 {
            u64::from_le_bytes([self.0; 8])
        }
        fn fill_bytes(&mut self, dest: &mut [u8]) {
            dest.fill(self.0);
        }
        fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand_core::Error> {
            dest.fill(self.0);
            Ok(())
        }
    }

    impl rand_core::CryptoRng for Fixed {}

    /// An executor that is device `d1` of the identity `events` make, answering its log and
    /// `record` sealed to the log's readers, as the store would.
    fn executor_with(
        events: &[Event],
        record: &ad4m_identity_core::record::PrivateRecord,
    ) -> (ViaExecutor<FakeExecutor>, String) {
        let scid = events[0].scid.clone();
        let executor = ViaExecutor::new(FakeExecutor::new());
        *executor.rpc().held.borrow_mut() = Some(scid.clone());
        let json_events: Vec<Value> = events
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect();
        let chain = ad4m_identity_core::fold(events).unwrap();
        // The store's head key: the reader trusts it for the record's receipt as for the head.
        let store = KeySigner::new(&[9u8; 32], 0);
        let seq = chain.head().seq;
        executor.rpc().answer(
            "identity.log",
            json!({
                "did": did_of(&scid), "events": json_events, "fork": null,
                "head": {
                    "scid": scid, "seq": seq, "hash": "h", "time": 0,
                    "store": format!("did:key:{}", Signer::key(&store)), "sig": "s",
                },
            }),
        );
        // `d1`, the executor's device key in `log_with_d2`, signs the envelope.
        let d1 = KeySigner::new(&[2u8; 32], 0);
        let sealed =
            ad4m_identity_core::record::seal_record(&chain, 1, record, None, &d1, &mut Fixed(7))
                .unwrap();
        let receipt =
            ad4m_identity_core::record::sign_receipt(&scid, &sealed, seq, &store).unwrap();
        executor.rpc().answer(
            "identity.record",
            json!({ "record": sealed, "receipt": receipt }),
        );
        executor.rpc().answer(
            "identity.unwrapRecordKey",
            json!({ "key": bs58::encode([7u8; 32]).into_string() }),
        );
        (executor, did_of(&scid))
    }

    /// A record entry that names a device and says it keeps no master key.
    fn named(name: &str) -> DeviceEntry {
        DeviceEntry {
            name: name.into(),
            kind: DeviceKind::DesktopApp,
            place: None,
            address: None,
            runs_executor: true,
            holds_master: Holds::No,
            operator: None,
        }
    }

    /// A record that lies about `d3`: it calls it "Printer", a device without the master key.
    fn lying_record() -> ad4m_identity_core::record::PrivateRecord {
        let mut record = ad4m_identity_core::record::PrivateRecord::default();
        record.devices.insert("d2".into(), named("Laptop"));
        record.devices.insert("d3".into(), named("Printer"));
        record
    }

    /// `d2`'s `confirm-revoke` request for `key_ids`, as the request box lists it.
    fn revoke_request(did: &str, key_ids: &[&str]) -> Value {
        json!([{
            "id": "r1", "body": { "kind": "confirm-revoke", "keyIds": key_ids, "rotate": false },
            "by": "d2", "created": 0, "expires": 99,
            "signed": { "req": {
                "did": did, "store": "did:key:zStore", "keyId": "d2",
                "kelSeq": 2, "kelHash": "h", "method": "POST", "path": "/requests",
                "bodyHash": "b", "nonce": "n", "expires": 99,
            }, "sig": "s" },
        }])
    }

    /// The first screen of answering request `r1` on `executor`.
    async fn first_answer_screen(executor: &ViaExecutor<FakeExecutor>) -> Screen {
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        drop(window);
        answer_on(executor, &vault, &address, &mut rx, &mut reply, "r1".into()).await;
        first.await.unwrap().unwrap()
    }

    /// A revoke request's card names each key it would revoke as the key log lists it — key id and
    /// fingerprint — with the record's name only beside it, so a record that renamed the device
    /// cannot hide which key goes. Whether each may still hold a valid master key is the log's
    /// too: the record saying `holdsMaster: false` does not hide a claim that said it may keep it.
    #[tokio::test]
    async fn a_revoke_request_card_shows_each_target_from_the_key_log() {
        for d3_may_keep in [true, false] {
            let (mut events, _) = crate::keylog::tests::log_with_d2(true);
            let d3 = crate::keylog::tests::add_d3(&mut events, d3_may_keep);
            let (executor, did) = executor_with(&events, &lying_record());
            executor
                .rpc()
                .answer("identity.requests", revoke_request(&did, &["d3", "d1"]));
            let screen = first_answer_screen(&executor).await;
            let Screen::Request {
                kind,
                key_id,
                device,
                targets,
                ..
            } = &screen
            else {
                panic!("{screen:?}");
            };
            assert_eq!((*kind, key_id.as_str()), ("confirm-revoke", "d2"));
            assert_eq!(device, "Laptop");
            let d1_sign = Signer::key(&KeySigner::new(&[2u8; 32], 0));
            assert_eq!(
                *targets,
                vec![
                    RevokeTarget {
                        key_id: "d3".into(),
                        fingerprint: crate::keylog::fingerprint(Signer::key(&d3).as_str()),
                        record_name: Some("Printer".into()),
                        may_hold_master: d3_may_keep,
                    },
                    // The incept's standing key may keep it; the record does not name it.
                    RevokeTarget {
                        key_id: "d1".into(),
                        fingerprint: crate::keylog::fingerprint(d1_sign.as_str()),
                        record_name: None,
                        may_hold_master: true,
                    },
                ]
            );
            let wire = serde_json::to_value(&screen).unwrap();
            assert_eq!(wire["targets"][0]["keyId"], "d3");
            assert_eq!(wire["targets"][0]["recordName"], "Printer");
            assert_eq!(wire["targets"][0]["mayHoldMaster"], d3_may_keep);
        }
    }

    /// A revoke request for a key the log does not list is refused rather than drawn by a name.
    #[tokio::test]
    async fn a_revoke_request_for_a_key_outside_the_log_is_refused() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let (executor, did) = executor_with(&events, &lying_record());
        executor
            .rpc()
            .answer("identity.requests", revoke_request(&did, &["d3"]));
        let screen = first_answer_screen(&executor).await;
        assert!(
            matches!(&screen, Screen::Failed { message } if message.contains("d3")
                && message.contains("not in your key log")),
            "{screen:?}"
        );
    }

    /// Revoking a device from this computer warns that it may still hold a valid master key when
    /// the log let it keep one, whatever the record says; a device whose claim said no is not
    /// warned about, even where the record claims it keeps one.
    #[tokio::test]
    async fn the_revoke_screen_takes_the_master_key_warning_from_the_key_log() {
        for (d3_may_keep, record_says) in [
            (true, Holds::No),
            (false, Holds::Yes),
            (true, Holds::Yes),
            (false, Holds::No),
        ] {
            let (mut events, _) = crate::keylog::tests::log_with_d2(true);
            crate::keylog::tests::add_d3(&mut events, d3_may_keep);
            let mut record = lying_record();
            record.devices.get_mut("d3").unwrap().holds_master = record_says;
            let (executor, _) = executor_with(&events, &record);
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let (address, mut rx, mut reply, window, first) = opened();
            drop(window);
            revoke_on(
                &executor,
                &vault,
                &address,
                &mut rx,
                &mut reply,
                "d3".into(),
            )
            .await;
            let screen = first.await.unwrap().unwrap();
            assert!(
                matches!(&screen, Screen::RevokeConfirm { key_id, may_hold_master, .. }
                    if key_id == "d3" && *may_hold_master == d3_may_keep),
                "{d3_may_keep} {record_says:?}: {screen:?}"
            );
        }
    }

    /// The revoke confirmation takes from the key log whether the device may still hold a valid
    /// master key; with no log to read, it warns.
    #[tokio::test]
    async fn a_revoke_confirmation_knows_a_device_that_may_keep_the_master_key() {
        for may_keep in [true, false] {
            let (events, _) = crate::keylog::tests::log_with_d2(may_keep);
            let scid = events[0].scid.clone();
            let executor = ViaExecutor::new(FakeExecutor::new());
            let events: Vec<Value> = events
                .iter()
                .map(|e| serde_json::to_value(e).unwrap())
                .collect();
            executor.rpc().answer(
                "identity.log",
                json!({ "did": did_of(&scid), "events": events, "head": null, "fork": null }),
            );
            assert_eq!(
                may_hold_master(&executor, &did_of(&scid), "d2").await,
                may_keep
            );
        }
        let executor = ViaExecutor::new(FakeExecutor::new());
        assert!(may_hold_master(&executor, "did:scid:coasys:1:Qm", "d2").await);
        let confirm = serde_json::to_value(Screen::RevokeConfirm {
            key_id: "d2".into(),
            may_hold_master: true,
            passphrase: false,
            error: None,
        })
        .unwrap();
        assert_eq!(confirm["mayHoldMaster"], true);
    }

    /// A device without the master key names only itself; naming another device is refused.
    #[tokio::test]
    async fn a_device_without_the_master_key_renames_only_itself() {
        let executor = linked_executor();
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        drop(window);
        rename_on(
            &executor,
            &vault,
            &address,
            &mut rx,
            &mut reply,
            "d2".into(),
        )
        .await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message.contains("Only a device that keeps")),
            "{screen:?}"
        );

        // Its own key (`d1`): not refused for that.
        let (address, mut rx, mut reply, window, first) = opened();
        drop(window);
        rename_on(
            &executor,
            &vault,
            &address,
            &mut rx,
            &mut reply,
            "d1".into(),
        )
        .await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            !matches!(&screen, Screen::Failed { message } if message.contains("Only a device that keeps")),
            "{screen:?}"
        );
    }

    #[test]
    fn a_device_code_is_checked_before_any_unlock() {
        let device = DeviceString {
            sign: Signer::key(&KeySigner::new(&[7u8; 32], 0)),
            enc: ad4m_identity_core::encode_x25519_multikey(&[8u8; 32]),
            r: bs58::encode([1u8; ad4m_identity_core::link::DEVICE_R_LEN]).into_string(),
            exp: 1_000,
            hint: None,
            store: "https://store.example/".into(),
        };
        let code = device.encode();
        // The same store with or without its trailing slash, and the code pasted with spaces.
        let checked = check_code(&format!("  {code}\n"), "https://store.example", 999).unwrap();
        assert_eq!(checked.sign, device.sign);
        assert!(check_code(&code, "https://store.example", 1_000)
            .unwrap_err()
            .contains("expired"));
        assert!(check_code(&code, "https://other.example", 999)
            .unwrap_err()
            .contains("another identity store"));
        assert!(
            check_code("coasys:offer:1:zzz", "https://store.example", 999)
                .unwrap_err()
                .contains("not a device's code")
        );
    }

    #[tokio::test]
    async fn the_public_state_lists_requests_and_a_waiting_master_key() {
        let requests = json!([{
            "id": "r1",
            "body": { "kind": "confirm-revoke", "keyIds": ["d3"], "rotate": false },
            "by": "d2", "created": 0, "expires": 99, "signed": {},
        }]);
        let inbox = json!([{ "id": "m1", "kind": "master", "storedAt": 0, "expires": 9 }]);

        // A sealed store: the waiting key is shown, never taken without the passphrase.
        let dir = tempfile::tempdir().unwrap();
        let executor = linked_executor();
        executor.rpc().answer("identity.requests", requests);
        executor.rpc().answer("identity.inbox", inbox.clone());
        let public = public_state_on(Some(&executor), &open_vault(dir.path())).await;
        assert!(public.master_waiting);
        assert!(executor.rpc().called("identity.takeMaster").is_empty());
        assert_eq!(public.requests.len(), 1);
        let request = &public.requests[0];
        assert_eq!(
            (
                request.id.as_str(),
                request.kind.as_str(),
                request.by.as_str(),
                request.expires
            ),
            ("r1", "confirm-revoke", "d2", 99)
        );
        assert_eq!(request.key_ids, vec!["d3".to_string()]);
        // The record cannot be read here: no devices, rather than a failed state.
        assert!(public.devices.is_empty());

        // Where the OS unlocks a new item, the waiting key is taken as the state is asked.
        let executor = linked_executor();
        executor.rpc().answer("identity.inbox", inbox);
        executor.rpc().answer("identity.takeMaster", Value::Null);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let public = public_state_on(Some(&executor), &vault).await;
        assert_eq!(executor.rpc().called("identity.takeMaster").len(), 1);
        assert!(!public.master_waiting);
    }

    #[test]
    fn the_new_steps_and_inputs_cross_ipc_in_their_wire_form() {
        for (text, step) in [
            (r#"{"kind":"scan-device"}"#, IdentityStep::ScanDevice),
            (r#"{"kind":"show-code"}"#, IdentityStep::ShowCode),
            (r#"{"kind":"take-master"}"#, IdentityStep::TakeMaster),
            (r#"{"kind":"ask-master"}"#, IdentityStep::AskMaster),
            (
                r#"{"kind":"answer-request","id":"r1"}"#,
                IdentityStep::AnswerRequest { id: "r1".into() },
            ),
            (
                r#"{"kind":"rename","keyId":"d2"}"#,
                IdentityStep::Rename {
                    key_id: "d2".into(),
                },
            ),
        ] {
            assert_eq!(serde_json::from_str::<IdentityStep>(text).unwrap(), step);
        }
        // A bare confirm (a node offer) keeps nothing and names nothing.
        let input: StepInput = serde_json::from_str(r#"{"kind":"confirm"}"#).unwrap();
        assert!(matches!(
            input,
            StepInput::Confirm {
                name: None,
                keep_master: false,
                this_name: None
            }
        ));
        let input: StepInput = serde_json::from_str(
            r#"{"kind":"confirm","name":"Desk","keepMaster":true,"thisName":"Laptop"}"#,
        )
        .unwrap();
        assert!(matches!(
            input,
            StepInput::Confirm { keep_master: true, ref name, ref this_name }
                if name.as_deref() == Some("Desk") && this_name.as_deref() == Some("Laptop")
        ));
        for (text, debug) in [
            (r#"{"kind":"code","code":"coasys:device:1:x"}"#, "code"),
            (r#"{"kind":"wait-link"}"#, "wait-link"),
            (r#"{"kind":"wait-join"}"#, "wait-join"),
            (r#"{"kind":"accept"}"#, "accept"),
            (r#"{"kind":"answer","passphrase":"secret words"}"#, "answer"),
            (r#"{"kind":"name","name":"Desk"}"#, "name"),
        ] {
            let input: StepInput = serde_json::from_str(text).unwrap();
            assert_eq!(format!("{input:?}"), debug);
        }
        let screen = serde_json::to_value(Screen::Match {
            code: "R7K Q2M".into(),
            hint: None,
            can_keep: true,
            own_name: true,
        })
        .unwrap();
        assert_eq!(
            (&screen["screen"], &screen["canKeep"], &screen["ownName"]),
            (&json!("match"), &json!(true), &json!(true))
        );
        let screen = serde_json::to_value(Screen::Request {
            id: "r1".into(),
            kind: "send-master",
            key_id: "d2".into(),
            fingerprint: "ABCD EFGH".into(),
            code: "R7K Q2M".into(),
            device: "Phone".into(),
            targets: vec![],
            passphrase: true,
            error: None,
        })
        .unwrap();
        assert_eq!(screen["screen"], "request");
        assert_eq!(screen["kind"], "send-master");
        assert_eq!(
            (&screen["keyId"], &screen["fingerprint"], &screen["code"]),
            (&json!("d2"), &json!("ABCD EFGH"), &json!("R7K Q2M"))
        );
        let screen = serde_json::to_value(Screen::DeviceCode {
            code: "c".into(),
            qr_svg: "<svg/>".into(),
            expires: 5,
        })
        .unwrap();
        assert_eq!(
            (&screen["screen"], &screen["qrSvg"]),
            (&json!("device-code"), &json!("<svg/>"))
        );
        let screen = serde_json::to_value(Screen::DeviceMatch {
            code: "R7K Q2M".into(),
            did: "did:scid:x".into(),
            needs_accept: true,
            accepted: false,
            confirmed: true,
        })
        .unwrap();
        assert_eq!(
            screen,
            json!({
                "screen": "device-match", "code": "R7K Q2M", "did": "did:scid:x",
                "needsAccept": true, "accepted": false, "confirmed": true,
            })
        );
    }
}
