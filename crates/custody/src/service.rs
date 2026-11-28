//! The custody service: runs one identity step at a time for the identity window.
//!
//! The window sends a step and then inputs, and gets back [`Screen`]s; the service holds every
//! secret of the flow — the words until two of them come back, the seed, the unlocked master key,
//! the offer secret — and the window holds only what a screen showed it. The main window gets none
//! of it: only how the step ended, and [`CustodyPublic`].
//!
//! The flows are the identity client's (`create`, `link`, `revoke`); the executor is reached over
//! its WebSocket RPC with the admin credential ([`ExecutorAddress`]), never in process, so moving
//! the executor into a child process later changes nothing here.
//!
//! The client's futures are not `Send` (their RPC trait is `?Send`), so the service runs on a
//! thread of its own with a current-thread runtime; [`CustodyHandle`] is the `Send` way in.
//!
//! A state read asks the vault on a separate thread ([`keychain_call`]), one call at a time. While
//! a device link waits for its claim, the custody task selects on Cancel, the claim's deadline and
//! that read, so an unlock prompt cannot hold the other two. The read still completes and answers
//! whoever asked, including when Cancel or the claim gets there first.
//!
//! A flow's own unlock, and resuming a pending incept, still call the vault on the custody task:
//! the identity client's vault is synchronous and its futures are not `Send`. Those calls happen
//! between screens, not while the claim select is running.

use std::collections::VecDeque;
use std::pin::Pin;
use std::sync::Arc;

use ad4m_client::ws_rpc::WsRpcClient;
use ad4m_identity_client::executor::IdentityStatus;
use ad4m_identity_client::flows::create::{resume, CreateFlow, CreateScreen, Created};
use ad4m_identity_client::flows::link::{Claimed, LinkFlow};
use ad4m_identity_client::flows::revoke::revoke;
use ad4m_identity_client::{
    ClientError, Clock, ExecutorRpc, OsRandom, Secret, SystemClock, VaultError, ViaExecutor,
};
use ad4m_identity_core::link::OfferKind;
use ad4m_identity_core::{Event, Op};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};

use crate::seal::{self, PassphraseProblem};
use crate::vault::DesktopVault;

static CLOCK: SystemClock = SystemClock;
static RANDOM: OsRandom = OsRandom;

/// Runs `job` on the process's one keychain thread and completes when the job does.
///
/// The OS keychain and the Secret Service answer on the thread that calls them, and that call can
/// sit inside an unlock prompt. The custody task never makes the call. It waits on this thread,
/// and while it waits it can still select on Cancel and the claim deadline. The thread runs one
/// job at a time, so a second read stays queued behind the prompt instead of opening another.
/// The job is sent when this is called, which is when the future is first polled, not when the
/// future is built: a read kept queued behind another has not entered the keychain yet.
fn keychain_call<T: Send + 'static>(
    job: impl FnOnce() -> T + Send + 'static,
) -> impl std::future::Future<Output = T> {
    let (tx, rx) = oneshot::channel();
    keychain_sender()
        .send(Box::new(move || {
            let _ = tx.send(job());
        }))
        .expect("custody keychain thread");
    async move { rx.await.expect("custody keychain thread ended") }
}

fn keychain_sender() -> &'static std::sync::mpsc::Sender<Box<dyn FnOnce() + Send>> {
    static SENDER: std::sync::OnceLock<std::sync::mpsc::Sender<Box<dyn FnOnce() + Send>>> =
        std::sync::OnceLock::new();
    SENDER.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<Box<dyn FnOnce() + Send>>();
        std::thread::Builder::new()
            .name("custody-keychain".into())
            .spawn(move || {
                while let Ok(job) = rx.recv() {
                    job();
                }
            })
            .expect("custody keychain thread");
        tx
    })
}

type ReadFut = Pin<Box<dyn std::future::Future<Output = CustodyPublic> + Send + 'static>>;
type ReadStart = Box<dyn FnOnce() -> ReadFut + Send>;

struct HeldRead {
    reply: oneshot::Sender<CustodyPublic>,
    start: ReadStart,
}

/// State reads whose keychain half has not finished.
///
/// Dropping the owner — Cancel, the next step input, or the claim arriving — does not drop the
/// replies. The rest is spawned on the runtime, still one keychain call at a time. The caller was
/// not asking to cancel the read. The future is `Send`: it only waits on the keychain thread.
struct LiveReads {
    flying: Option<(oneshot::Sender<CustodyPublic>, ReadFut)>,
    waiting: VecDeque<HeldRead>,
}

impl LiveReads {
    fn new() -> Self {
        Self {
            flying: None,
            waiting: VecDeque::new(),
        }
    }

    fn busy(&self) -> bool {
        self.flying.is_some()
    }

    /// Starts `start` now, or holds it until the read already in the keychain has returned.
    /// `start` is what calls [`keychain_call`], so a held read has not entered the keychain.
    fn push(
        &mut self,
        reply: oneshot::Sender<CustodyPublic>,
        start: impl FnOnce() -> ReadFut + Send + 'static,
    ) {
        if self.flying.is_some() {
            self.waiting.push_back(HeldRead {
                reply,
                start: Box::new(start),
            });
            return;
        }
        self.flying = Some((reply, start()));
    }

    fn deliver(&mut self, public: CustodyPublic) {
        if let Some((reply, _)) = self.flying.take() {
            let _ = reply.send(public);
        }
        if self.flying.is_none() {
            if let Some(held) = self.waiting.pop_front() {
                self.flying = Some((held.reply, (held.start)()));
            }
        }
    }

    /// Keeps the outstanding reads going after the caller returns to the rest of the step.
    fn detach(&mut self) {
        let flying = self.flying.take();
        let mut waiting = std::mem::take(&mut self.waiting);
        if flying.is_none() && waiting.is_empty() {
            return;
        }
        // Outside a runtime there is nowhere to finish them; the senders drop and the callers
        // see the service stop. Every custody path runs inside its runtime.
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        tokio::spawn(async move {
            if let Some((reply, done)) = flying {
                let _ = reply.send(done.await);
            }
            while let Some(held) = waiting.pop_front() {
                let _ = held.reply.send((held.start)().await);
            }
        });
    }
}

impl Drop for LiveReads {
    fn drop(&mut self) {
        self.detach();
    }
}

/// A change the main window may ask for. Making an identity, adding a device and revoking one;
/// a later change adds more.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum IdentityStep {
    Create,
    AddDevice,
    Revoke {
        #[serde(rename = "keyId")]
        key_id: String,
    },
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
    /// Both devices show this code; the person confirms here when they match.
    Match { code: String, hint: Option<String> },
    /// The device was added (`add` published).
    Linked { seq: u64 },
    /// What revoking will do, before it is done.
    RevokeConfirm {
        #[serde(rename = "keyId")]
        key_id: String,
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
            Screen::IdentityReady { .. } | Screen::Linked { .. } | Screen::Revoked { .. } => {
                Some(StepOutcome::Done)
            }
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
    /// The codes match: sign the `add`.
    Confirm,
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
            StepInput::Confirm => "confirm",
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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HoldsMaster {
    pub index: u32,
}

/// Where the executor's RPC is, and the admin credential for it. Nothing else of the executor: the
/// identity store it uses, and whether it trusts it, are asked of it (`identity.status`).
#[derive(Clone)]
pub struct ExecutorAddress {
    /// `http://127.0.0.1:<port>`
    pub url: String,
    pub admin_credential: Arc<str>,
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

enum Request {
    Start(IdentityStep, oneshot::Sender<Result<Screen, CustodyError>>),
    Step(StepInput, oneshot::Sender<Result<Screen, CustodyError>>),
    Cancel(oneshot::Sender<()>),
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

    /// Ends the open step, wiping what it held. Harmless with none open.
    pub async fn cancel(&self) {
        let _ = self.ask(Request::Cancel).await;
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
    WsRpcClient::connect(&address.url, &address.admin_credential)
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
        ClientError::Rpc(e) => format!(
            "The identity service on this computer answered: {}",
            e.message
        ),
        other => other.to_string(),
    };
    Screen::Failed { message }
}

async fn serve(vault: DesktopVault, address: ExecutorAddress, mut rx: Rx) {
    let vault = Arc::new(vault);
    while let Some(request) = rx.recv().await {
        match request {
            Request::Start(step, reply) => {
                let mut reply = Some(reply);
                match step {
                    IdentityStep::Create => run_create(&vault, &address, &mut rx, &mut reply).await,
                    IdentityStep::AddDevice => {
                        run_link(&vault, &address, &mut rx, &mut reply).await
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
                let _ = reply.send(());
            }
            // No step is open, so nothing is selecting on Cancel. The keychain half still runs
            // off this task; this arm just waits for it before the next request.
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

struct Prepared {
    did: Option<String>,
    blocked: Option<&'static str>,
    scid: Option<String>,
}

async fn prepare_connected(vault: &Arc<DesktopVault>, address: &ExecutorAddress) -> Prepared {
    match connect(address).await {
        Ok(executor) => prepare(Some(&executor), vault).await,
        Err(_) => prepare::<WsRpcClient>(None, vault).await,
    }
}

/// The executor's did and whether a step is blocked, without asking the keychain. The keychain
/// half is [`finish_from`], so a caller can select while that half waits.
async fn prepare<R: ExecutorRpc>(
    executor: Option<&ViaExecutor<R>>,
    vault: &DesktopVault,
) -> Prepared {
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
    let scid = did
        .as_deref()
        .and_then(ad4m_identity_core::scid_of)
        .map(str::to_string);
    Prepared { did, blocked, scid }
}

async fn public_state(vault: &Arc<DesktopVault>, address: &ExecutorAddress) -> CustodyPublic {
    match connect(address).await {
        Ok(executor) => public_state_on(Some(&executor), vault).await,
        Err(_) => public_state_on::<WsRpcClient>(None, vault).await,
    }
}

/// [`public_state`] with the executor, when it answers. `None` asks the vault with no did.
async fn public_state_on<R: ExecutorRpc>(
    executor: Option<&ViaExecutor<R>>,
    vault: &Arc<DesktopVault>,
) -> CustodyPublic {
    let prepared = prepare(executor, vault).await;
    finish_from(Arc::clone(vault), prepared).await
}

/// Whether this identity's key is held here and, if so, whether it is sealed. Off the custody
/// task: `holds` and `needs_passphrase` reach the keychain or the Secret Service, and either can
/// sit inside an unlock prompt. With none held, the unlock a new key would get.
fn finish_from(vault: Arc<DesktopVault>, prepared: Prepared) -> ReadFut {
    Box::pin(async move {
        let Prepared { did, blocked, scid } = prepared;
        let (sealed, needs_new) = keychain_call(move || {
            let sealed = match scid.as_deref() {
                Some(scid) => match held_sealed(&vault, scid) {
                    Ok(sealed) => sealed,
                    // The store could not be asked (no Secret Service, a keychain error, a copy on
                    // both sides): reported as not known to hold one, and logged so the cause is
                    // not lost.
                    Err(e) => {
                        log::warn!("custody: cannot tell whether the master key is held here: {e}");
                        None
                    }
                },
                None => None,
            };
            let needs_new = if sealed.is_none() {
                vault.needs_passphrase()
            } else {
                false
            };
            (sealed, needs_new)
        })
        .await;
        // The index sits inside the sealed item; only master #0 is held for now (no rotation yet).
        let holds_master = sealed.map(|_| HoldsMaster { index: 0 });
        let unlock = if sealed.unwrap_or(needs_new) {
            "passphrase"
        } else {
            // The operating system's own prompt: Touch ID or the login password on macOS, the
            // Secret Service's unlock on Linux. One word for every platform, so no caller names
            // one.
            "os"
        };
        CustodyPublic {
            did,
            holds_master,
            unlock,
            blocked,
        }
    })
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
/// A second `Start` while a step is open is refused. A `Public` read runs off this task, and the
/// loop selects on it and on the next request, so Cancel is not held by the read. Leaving the
/// loop does not drop a read that is still in the keychain ([`LiveReads`]).
async fn next_input(
    vault: &Arc<DesktopVault>,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Option<StepInput> {
    let mut reads = LiveReads::new();
    loop {
        tokio::select! {
            request = rx.recv() => {
                match request? {
                    Request::Step(input, r) => {
                        *reply = Some(r);
                        return Some(input);
                    }
                    Request::Cancel(r) => {
                        let _ = r.send(());
                        return None;
                    }
                    Request::Start(_, r) => {
                        let _ = r.send(Err(CustodyError::Busy));
                    }
                    Request::Public(r) => {
                        let prepared = prepare_connected(vault, address).await;
                        let vault = Arc::clone(vault);
                        reads.push(r, move || finish_from(vault, prepared));
                    }
                }
            }
            public = async { reads.flying.as_mut().unwrap().1.as_mut().await }, if reads.busy() => {
                reads.deliver(public);
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
    vault: &Arc<DesktopVault>,
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
    vault: &Arc<DesktopVault>,
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
        answer(reply, Ok(Screen::SetPassphrase { error: None }));
        loop {
            let Some(input) = next_input(vault, address, rx, reply).await else {
                return;
            };
            match input {
                StepInput::Passphrase {
                    passphrase: p,
                    confirm,
                } => {
                    let p = Secret::new(p);
                    let confirm = Secret::new(confirm.unwrap_or_default());
                    match seal::check_new(p.expose(), confirm.expose()) {
                        Ok(()) => {
                            passphrase = Some(p);
                            break;
                        }
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
    vault: &Arc<DesktopVault>,
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

async fn run_link(
    vault: &Arc<DesktopVault>,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    link_on(&executor, vault, address, rx, reply, &CLOCK).await
}

/// [`run_link`] once the executor answers. `clock` is the offer's clock: the claim deadline is
/// `open` time plus the offer's lifetime, checked while [`LinkFlow::wait_for_claim`] is polled.
async fn link_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &Arc<DesktopVault>,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    clock: &dyn Clock,
) {
    // The offer names the store the executor uses, and the claiming device publishes through it.
    let store_url = match trusted_store(executor).await {
        Ok(url) => url,
        Err(refused) => return answer(reply, Ok(refused)),
    };
    finish_pending_quietly(executor, vault).await;
    let did = match executor.status().await {
        Ok(status) => match status.did {
            Some(did) => did,
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

    // The one unlock of the flow — a flow asks the person to unlock once, not per signature: where
    // this identity's key is sealed, after the passphrase.
    let needs = match passphrase_for(vault, &did) {
        Ok(needs) => needs,
        Err(e) => return answer(reply, Ok(failed(&e))),
    };
    let mut passphrase: Option<Secret<String>> = None;
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
            passphrase = Some(Secret::new(p));
        }
        let unlocking = vault.unlocking(passphrase.take());
        match LinkFlow::open(
            executor,
            &unlocking,
            &did,
            OfferKind::Node,
            &store_url,
            clock,
            &RANDOM,
        )
        .await
        {
            Ok(flow) => break flow,
            Err(ClientError::Vault(VaultError::Cancelled)) if needs => {
                answer(
                    reply,
                    Ok(Screen::EnterPassphrase {
                        error: Some("That passphrase does not open your master key.".into()),
                    }),
                );
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
            expires: offer_expiry(clock),
        }),
    );

    let mut claimed: Option<Claimed> = None;
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        match input {
            StepInput::WaitClaim if claimed.is_none() => {
                // The claim future carries the deadline (the offer's expiry). `wait_cancel`
                // selects on Cancel and on the state read, which runs off this task.
                let outcome = tokio::select! {
                    claim = flow.wait_for_claim() => Some(claim),
                    () = wait_cancel(executor, vault, rx) => None,
                };
                match outcome {
                    Some(Ok(claim)) => {
                        let screen = Screen::Match {
                            code: claim.match_code.clone(),
                            hint: claim.hint.clone(),
                        };
                        claimed = Some(claim);
                        answer(reply, Ok(screen));
                    }
                    Some(Err(e)) => return answer(reply, Ok(failed(&e))),
                    None => return answer(reply, Err(CustodyError::NoStep)),
                }
            }
            StepInput::Confirm if claimed.is_some() => {
                let claim = claimed.take().expect("checked above");
                let screen = match flow.confirm(&claim).await {
                    Ok(head) => Screen::Linked { seq: head.seq },
                    Err(e) => failed(&e),
                };
                return answer(reply, Ok(screen));
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    }
}

/// Resolves when the window cancels. A `Public` read uses the flow's executor for the did, then
/// asks the keychain off this task ([`keychain_call`]). This loop selects on the next request and
/// on that read finishing, so Cancel is answered while the read waits. At most one read is in the
/// keychain: a second `Public` waits for the first to finish before it asks. The caller selects
/// this future against the claim, whose deadline is the offer's expiry. Dropping it when the
/// claim arrives does not drop the read.
async fn wait_cancel<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &Arc<DesktopVault>,
    rx: &mut Rx,
) {
    let mut reads = LiveReads::new();
    loop {
        tokio::select! {
            request = rx.recv() => {
                match request {
                    None => return,
                    Some(Request::Cancel(r)) => {
                        let _ = r.send(());
                        return;
                    }
                    Some(Request::Public(r)) => {
                        // The did comes from this flow's executor (a reconnect would miss a fake
                        // one, and would open a second socket in production). The keychain half
                        // owns its data, so it can finish after this select is dropped.
                        let prepared = prepare(Some(executor), vault).await;
                        let vault = Arc::clone(vault);
                        reads.push(r, move || finish_from(vault, prepared));
                    }
                    Some(Request::Start(_, r)) => {
                        let _ = r.send(Err(CustodyError::Busy));
                    }
                    Some(Request::Step(_, r)) => {
                        let _ = r.send(Err(CustodyError::Busy));
                    }
                }
            }
            public = async { reads.flying.as_mut().unwrap().1.as_mut().await }, if reads.busy() => {
                reads.deliver(public);
            }
        }
    }
}

fn offer_expiry(clock: &dyn Clock) -> u64 {
    clock.now() + ad4m_identity_core::link::OFFER_TTL_S
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
    vault: &Arc<DesktopVault>,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    key_id: String,
) {
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    if let Err(refused) = trusted_store(&executor).await {
        return answer(reply, Ok(refused));
    }
    finish_pending_quietly(&executor, vault).await;
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
    answer(
        reply,
        Ok(Screen::RevokeConfirm {
            key_id: key_id.clone(),
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
            &executor,
            &unlocking,
            &did,
            std::slice::from_ref(&key_id),
            // No "missing since" in this step: the device is revoked from now.
            None,
            &CLOCK,
        )
        .await
        {
            Ok(head) => {
                return answer(
                    reply,
                    Ok(Screen::Revoked {
                        key_id,
                        seq: head.seq,
                    }),
                )
            }
            Err(ClientError::Vault(VaultError::Cancelled)) if needs => answer(
                reply,
                Ok(Screen::RevokeConfirm {
                    key_id: key_id.clone(),
                    passphrase: true,
                    error: Some("That passphrase does not open your master key.".into()),
                }),
            ),
            Err(e) => return answer(reply, Ok(failed(&e))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Condvar, Mutex};
    use std::time::{Duration, Instant};

    use ad4m_identity_client::vault::KeySigner;
    use ad4m_identity_client::{RpcError, Vault};
    use ad4m_identity_core::build::{cosign, Signer};
    use ad4m_identity_core::{did_of, words, Event};
    use serde_json::{json, Value};

    use crate::pending::PendingIncepts;
    use crate::seal::Kdf;
    use crate::store::{FileStore, SecretStore, StoreKind};

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
        /// Events `identity.publish` took, in order, answered back by `identity.log`.
        events: RefCell<Vec<Value>>,
        /// The signed offer `identity.openOffer` took, listed by `identity.offers`.
        offer: RefCell<Option<Value>>,
        /// When set, an `identity.offers` call with `wait > 0` waits until it clears.
        hold_offers: Arc<AtomicBool>,
        /// Set while that wait is in progress.
        offers_waiting: Arc<AtomicBool>,
        /// Wakes the waiting `identity.offers` so it rechecks `hold_offers`.
        offer_release: Arc<tokio::sync::Notify>,
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
                events: RefCell::new(Vec::new()),
                offer: RefCell::new(None),
                hold_offers: Arc::new(AtomicBool::new(false)),
                offers_waiting: Arc::new(AtomicBool::new(false)),
                offer_release: Arc::new(tokio::sync::Notify::new()),
            }
        }
    }

    #[async_trait::async_trait(?Send)]
    impl ExecutorRpc for FakeExecutor {
        async fn call(&self, method: &str, p: Value) -> Result<Value, RpcError> {
            self.calls.set(self.calls.get() + 1);
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
                    self.events.borrow_mut().push(p["events"][0].clone());
                    self.publishes.set(self.publishes.get() + 1);
                    *self.held.borrow_mut() = Some(event.scid.clone());
                    Ok(json!({
                        "scid": event.scid, "seq": 0, "hash": "h", "time": 0,
                        "store": "did:key:zStore", "sig": "s",
                    }))
                }
                "identity.log" => {
                    let did = p["did"].as_str().unwrap_or("").to_string();
                    let events = self.events.borrow().clone();
                    let scid = events
                        .first()
                        .and_then(|e| e["scid"].as_str())
                        .unwrap_or("")
                        .to_string();
                    Ok(json!({
                        "did": did,
                        "events": events,
                        "head": {
                            "scid": scid, "seq": 0, "hash": "h", "time": 0,
                            "store": "did:key:zStore", "sig": "s",
                        },
                        "fork": null,
                    }))
                }
                "identity.openOffer" => {
                    let offer = p["signedOffer"].clone();
                    let id = offer["offer"]["offerId"].as_str().unwrap_or("").to_string();
                    *self.offer.borrow_mut() = Some(offer);
                    Ok(json!({ "offerId": id }))
                }
                "identity.offers" => {
                    let wait = p["wait"].as_u64().unwrap_or(0);
                    if wait > 0 && self.hold_offers.load(Ordering::SeqCst) {
                        self.offers_waiting.store(true, Ordering::SeqCst);
                        while self.hold_offers.load(Ordering::SeqCst) {
                            self.offer_release.notified().await;
                        }
                        self.offers_waiting.store(false, Ordering::SeqCst);
                    }
                    let offer = self.offer.borrow().clone().unwrap_or(Value::Null);
                    Ok(json!([{ "offer": offer, "state": { "state": "open" } }]))
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
    fn open_vault(dir: &std::path::Path) -> Arc<DesktopVault> {
        Arc::new(DesktopVault::with_kdf(
            Box::new(FileStore::new(dir)),
            PendingIncepts::file(dir),
            CHEAP,
        ))
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
        })
        .unwrap();
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
        assert_eq!(Screen::Linked { seq: 1 }.outcome(), Some(StepOutcome::Done));
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
        let vault = Arc::new(DesktopVault::new(
            Box::new(crate::store::MemoryStore::new()),
            PendingIncepts::memory(),
        ));
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
                admin_credential: Arc::from("x"),
            },
        );
        assert_eq!(
            handle.step(StepInput::Confirm).await,
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
            let vault = Arc::new(DesktopVault::new(
                Box::new(crate::store::MemoryStore::new()),
                PendingIncepts::memory(),
            ));
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
        vault: &Arc<DesktopVault>,
        window: F,
    ) -> Vec<Screen>
    where
        F: FnOnce(Window, Screen) -> Fut,
        Fut: std::future::Future<Output = Vec<Screen>>,
    {
        let address = ExecutorAddress {
            url: "http://127.0.0.1:9".into(),
            admin_credential: Arc::from("x"),
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

    /// A keychain whose calls sit until [`Block::release`]. `kind` does not: a new item's unlock
    /// is decided without a prompt, and the block stands in for the prompt a later read opens.
    struct BlockingKeychain {
        items: Mutex<std::collections::HashMap<String, Vec<u8>>>,
        block: Arc<Block>,
    }

    struct Block {
        mu: Mutex<BlockInner>,
        cv: Condvar,
    }

    struct BlockInner {
        armed: bool,
        in_flight: u32,
        max_in_flight: u32,
    }

    impl Block {
        fn new() -> Arc<Self> {
            Arc::new(Block {
                mu: Mutex::new(BlockInner {
                    armed: false,
                    in_flight: 0,
                    max_in_flight: 0,
                }),
                cv: Condvar::new(),
            })
        }

        fn enter(&self) {
            let mut g = self.mu.lock().unwrap();
            if !g.armed {
                return;
            }
            g.in_flight += 1;
            g.max_in_flight = g.max_in_flight.max(g.in_flight);
            while g.armed {
                g = self.cv.wait(g).unwrap();
            }
            g.in_flight = g.in_flight.saturating_sub(1);
        }

        fn arm(&self) {
            self.mu.lock().unwrap().armed = true;
        }

        fn release(&self) {
            let mut g = self.mu.lock().unwrap();
            g.armed = false;
            self.cv.notify_all();
        }

        fn in_flight(&self) -> u32 {
            self.mu.lock().unwrap().in_flight
        }

        fn max_in_flight(&self) -> u32 {
            self.mu.lock().unwrap().max_in_flight
        }
    }

    impl BlockingKeychain {
        fn new(block: Arc<Block>) -> Self {
            BlockingKeychain {
                items: Mutex::new(std::collections::HashMap::new()),
                block,
            }
        }
    }

    impl SecretStore for BlockingKeychain {
        fn kind(&self) -> StoreKind {
            StoreKind::Keychain
        }

        fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
            self.block.enter();
            Ok(StoreKind::Keychain)
        }

        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            self.block.enter();
            self.items
                .lock()
                .unwrap()
                .insert(name.to_string(), bytes.to_vec());
            Ok(())
        }

        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            self.block.enter();
            Ok(self.items.lock().unwrap().get(name).cloned())
        }

        fn contains(&self, name: &str) -> Result<bool, VaultError> {
            self.block.enter();
            Ok(self.items.lock().unwrap().contains_key(name))
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            self.block.enter();
            self.items.lock().unwrap().remove(name);
            Ok(())
        }
    }

    struct ManualClock(AtomicU64);

    impl Clock for ManualClock {
        fn now(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    fn wait_until(timeout: Duration, pred: impl Fn() -> bool) -> bool {
        let start = Instant::now();
        while start.elapsed() < timeout {
            if pred() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        pred()
    }

    /// Which answer must arrive while the keychain call is still inside its prompt.
    enum WhileBlocked {
        Cancel,
        Deadline,
    }

    /// One active link whose state read blocks in the keychain. `mode` is the answer that has to
    /// arrive within a second anyway: Cancel, or the claim deadline.
    async fn blocking_keychain_while_linked(mode: WhileBlocked) -> Result<(), String> {
        let block = Block::new();
        let hold_offers = Arc::new(AtomicBool::new(true));
        let offers_waiting = Arc::new(AtomicBool::new(false));
        let offer_release = Arc::new(tokio::sync::Notify::new());
        let clock = Arc::new(ManualClock(AtomicU64::new(1_700_000_000)));
        let (to_service, mut rx) = mpsc::unbounded_channel();
        let (first_tx, first_rx) = oneshot::channel();

        let block_thread = Arc::clone(&block);
        let hold_thread = Arc::clone(&hold_offers);
        let waiting_thread = Arc::clone(&offers_waiting);
        let release_thread = Arc::clone(&offer_release);
        let clock_thread = Arc::clone(&clock);
        let thread = std::thread::Builder::new()
            .name("custody-link-test".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("test runtime");
                rt.block_on(async move {
                    let mut fake = FakeExecutor::new();
                    fake.hold_offers = hold_thread;
                    fake.offers_waiting = waiting_thread;
                    fake.offer_release = release_thread;
                    let executor = ViaExecutor::new(fake);
                    let vault = Arc::new(DesktopVault::with_kdf(
                        Box::new(BlockingKeychain::new(block_thread)),
                        PendingIncepts::memory(),
                        CHEAP,
                    ));
                    confirmed(41)
                        .finish(&executor, &vault.unlocking(None))
                        .await
                        .expect("create");
                    let address = ExecutorAddress {
                        url: "http://127.0.0.1:9".into(),
                        admin_credential: Arc::from("x"),
                    };
                    let mut reply = Some(first_tx);
                    link_on(
                        &executor,
                        &vault,
                        &address,
                        &mut rx,
                        &mut reply,
                        clock_thread.as_ref(),
                    )
                    .await;
                });
            })
            .expect("custody test thread");

        // Releases the prompt and the offer poll if this case returns or panics, then joins.
        // A panic in the custody thread fails the case: `finish` reports it, and `Drop` still
        // joins on the paths that return earlier.
        struct Stop {
            block: Arc<Block>,
            hold_offers: Arc<AtomicBool>,
            offer_release: Arc<tokio::sync::Notify>,
            thread: Option<std::thread::JoinHandle<()>>,
        }
        fn panic_payload(e: Box<dyn std::any::Any + Send>) -> String {
            e.downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| e.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".into())
        }
        impl Stop {
            fn release(&self) {
                self.block.release();
                self.hold_offers.store(false, Ordering::SeqCst);
                self.offer_release.notify_waiters();
            }

            fn finish(mut self) -> Result<(), String> {
                // Unblock the prompt before joining. The assertions have already run; the thread
                // may still be leaving the step, and it must not sit in the keychain until join.
                self.release();
                let joined = self.thread.take().map(|thread| thread.join());
                match joined {
                    Some(Err(e)) => Err(format!(
                        "custody test thread panicked: {}",
                        panic_payload(e)
                    )),
                    _ => Ok(()),
                }
            }
        }
        impl Drop for Stop {
            fn drop(&mut self) {
                self.release();
                if let Some(thread) = self.thread.take() {
                    if let Err(e) = thread.join() {
                        eprintln!("custody test thread panicked: {}", panic_payload(e));
                    }
                }
            }
        }
        let _stop = Stop {
            block: Arc::clone(&block),
            hold_offers: Arc::clone(&hold_offers),
            offer_release: Arc::clone(&offer_release),
            thread: Some(thread),
        };

        let first = match tokio::time::timeout(Duration::from_secs(20), first_rx).await {
            Ok(Ok(Ok(screen))) => screen,
            Ok(Ok(Err(e))) => return Err(format!("the link refused the step: {e:?}")),
            Ok(Err(_)) => return Err("the link ended before a screen".into()),
            Err(_) => return Err("no screen within 20s".into()),
        };
        let Screen::Offer { expires, .. } = first else {
            return Err(format!("expected the offer, got {first:?}"));
        };

        let (step_tx, step_rx) = oneshot::channel();
        to_service
            .send(Request::Step(StepInput::WaitClaim, step_tx))
            .map_err(|_| "the link ended before wait-claim".to_string())?;
        if !wait_until(Duration::from_secs(10), || {
            offers_waiting.load(Ordering::SeqCst)
        }) {
            return Err("the claim poll never started".into());
        }

        block.arm();
        let (pub_tx, _pub_rx) = oneshot::channel();
        let (pub2_tx, _pub2_rx) = oneshot::channel();
        to_service
            .send(Request::Public(pub_tx))
            .map_err(|_| "the link ended before the state read".to_string())?;
        to_service
            .send(Request::Public(pub2_tx))
            .map_err(|_| "the link ended before the second state read".to_string())?;
        if !wait_until(Duration::from_secs(10), || block.in_flight() >= 1) {
            return Err("the state read never reached the keychain".into());
        }
        // The second read is queued behind the one prompt, so the keychain sees one call.
        std::thread::sleep(Duration::from_millis(50));
        let max = block.max_in_flight();
        if max != 1 {
            return Err(format!("keychain calls in flight at once: {max}"));
        }

        let bound = Duration::from_secs(1);
        match mode {
            WhileBlocked::Cancel => {
                let (cancel_tx, cancel_rx) = oneshot::channel();
                to_service
                    .send(Request::Cancel(cancel_tx))
                    .map_err(|_| "the link ended before cancel".to_string())?;
                match tokio::time::timeout(bound, cancel_rx).await {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(_)) => Err("cancel was dropped".into()),
                    Err(_) => Err(
                        "cancel did not answer within 1s while the keychain read was blocked"
                            .into(),
                    ),
                }
            }
            WhileBlocked::Deadline => {
                clock.0.store(expires, Ordering::SeqCst);
                hold_offers.store(false, Ordering::SeqCst);
                offer_release.notify_waiters();
                match tokio::time::timeout(bound, step_rx).await {
                    Ok(Ok(Ok(Screen::Failed { message }))) if message.contains("expired") => Ok(()),
                    Ok(Ok(other)) => Err(format!("the deadline answered {other:?}")),
                    Ok(Err(_)) => Err("the claim wait was dropped".into()),
                    Err(_) => Err(
                        "the claim deadline did not answer within 1s while the keychain read was blocked"
                            .into(),
                    ),
                }
            }
        }?;
        _stop.finish()?;
        Ok(())
    }

    /// A vault call that never returns (an unlock prompt nobody answers) must not hold the custody
    /// task: Cancel and the offer's expiry still answer during the claim wait, and a second state
    /// read does not enter the keychain beside the first.
    #[tokio::test]
    async fn a_blocking_keychain_read_during_a_link_lets_cancel_and_the_deadline_fire() {
        blocking_keychain_while_linked(WhileBlocked::Cancel)
            .await
            .unwrap();
        blocking_keychain_while_linked(WhileBlocked::Deadline)
            .await
            .unwrap();
    }
}
