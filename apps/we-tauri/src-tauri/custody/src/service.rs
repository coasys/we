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

use std::sync::Arc;

use ad4m_client::ws_rpc::WsRpcClient;
use ad4m_identity_client::flows::create::{resume, CreateFlow, CreateScreen, Created};
use ad4m_identity_client::flows::link::{Claimed, LinkFlow};
use ad4m_identity_client::flows::revoke::revoke;
use ad4m_identity_client::{
    ClientError, ExecutorRpc, OsRandom, Secret, SystemClock, VaultError, ViaExecutor,
};
use ad4m_identity_core::link::OfferKind;
use ad4m_identity_core::{Event, Op};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};

use crate::seal::{self, PassphraseProblem};
use crate::vault::DesktopVault;

static CLOCK: SystemClock = SystemClock;
static RANDOM: OsRandom = OsRandom;

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
    /// can. Set when the executor trusts no identity store key, so nothing it publishes could take.
    pub blocked: Option<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HoldsMaster {
    pub index: u32,
}

/// Where the executor's RPC is, and the admin credential for it. Nothing else of the executor.
#[derive(Clone)]
pub struct ExecutorAddress {
    /// `http://127.0.0.1:<port>`
    pub url: String,
    pub admin_credential: Arc<str>,
    /// The identity store the executor's agent language uses: the offer link names it.
    pub store_url: Option<String>,
    /// The executor was started with at least one identity store key (`identity.storeKeys`). With
    /// none it accepts no head from the store, so every step that publishes is refused up front.
    pub store_trusted: bool,
}

impl std::fmt::Debug for ExecutorAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExecutorAddress")
            .field("url", &self.url)
            .field("store_url", &self.store_url)
            .field("store_trusted", &self.store_trusted)
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
        .map_err(|_| "Coasys is starting on this computer. Try again in a moment.".to_string())
}

/// What a build with no identity store key says, before any step starts and whenever the executor
/// refuses for that reason.
pub const NO_STORE: &str =
    "This build of Coasys has no identity store set up, so it cannot make or \
     change an identity yet. Nothing was changed.";

/// The step's refusal on a build whose executor trusts no store key: before words are made, an
/// offer is opened or a key is unlocked. `None` where the store is trusted.
fn no_store(address: &ExecutorAddress) -> Option<Screen> {
    (!address.store_trusted).then(|| Screen::Failed {
        message: NO_STORE.into(),
    })
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
        ClientError::Rpc(e) => format!("Coasys on this computer answered: {}", e.message),
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
    let did = match connect(address).await {
        Ok(executor) => {
            finish_pending_quietly(&executor, vault).await;
            executor.status().await.ok().and_then(|s| s.did)
        }
        Err(_) => None,
    };
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
        "touch-id-or-password"
    };
    CustodyPublic {
        did,
        holds_master,
        unlock,
        blocked: (!address.store_trusted).then_some(NO_STORE),
    }
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
    loop {
        match rx.recv().await? {
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
    // Before anything: words shown for an identity the store could never take would be a lie.
    if let Some(refused) = no_store(address) {
        return answer(reply, Ok(refused));
    }
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
    answer(reply, Ok(Screen::ShowWords { words }));

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
    if let Some(refused) = no_store(address) {
        return answer(reply, Ok(refused));
    }
    let Some(store_url) = address.store_url.clone() else {
        return answer(
            reply,
            Ok(Screen::Failed {
                message:
                    "This computer has no identity store configured, so it cannot make an offer."
                        .into(),
            }),
        );
    };
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    finish_pending_quietly(&executor, vault).await;
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
            &executor,
            &unlocking,
            &did,
            OfferKind::Node,
            &store_url,
            &CLOCK,
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
            expires: offer_expiry(),
        }),
    );

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
                    cancelled = wait_cancel(vault, address, rx) => { let _ = cancelled; None }
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

/// Resolves when the window cancels; answers `Public` in passing and refuses anything else.
async fn wait_cancel(vault: &DesktopVault, address: &ExecutorAddress, rx: &mut Rx) {
    loop {
        match rx.recv().await {
            None => return,
            Some(Request::Cancel(r)) => {
                let _ = r.send(());
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
    if let Some(refused) = no_store(address) {
        return answer(reply, Ok(refused));
    }
    let executor = match connect(address).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
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
        publishes: Cell<u32>,
        calls: Cell<u32>,
    }

    impl FakeExecutor {
        fn new() -> Self {
            FakeExecutor {
                device: KeySigner::new(&[5u8; 32], 0),
                held: RefCell::new(None),
                refuse_publish: Cell::new(false),
                refuse_for_good: RefCell::new(None),
                refuse_cosign: Cell::new(false),
                publishes: Cell::new(0),
                calls: Cell::new(0),
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

    #[test]
    fn an_offer_link_becomes_a_qr_code() {
        let svg = qr_svg("https://coasys.id/o#coasys:offer:1:abc");
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
                store_url: None,
                store_trusted: true,
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

    #[tokio::test]
    async fn a_build_with_no_store_key_refuses_every_step_before_words_are_made() {
        let pending = PendingIncepts::memory();
        let vault = DesktopVault::new(Box::new(crate::store::MemoryStore::new()), pending);
        let handle = spawn(
            vault,
            ExecutorAddress {
                url: "http://127.0.0.1:9".into(),
                admin_credential: Arc::from("x"),
                store_url: Some("https://store.example".into()),
                store_trusted: false,
            },
        );
        let no_store = Screen::Failed {
            message: NO_STORE.into(),
        };
        // The refusal comes before the executor is asked anything: port 9 would answer
        // "Coasys is starting" instead.
        for step in [
            IdentityStep::Create,
            IdentityStep::AddDevice,
            IdentityStep::Revoke {
                key_id: "d2".into(),
            },
        ] {
            assert_eq!(handle.start(step).await.unwrap(), no_store);
        }
        assert_eq!(handle.public_state().await.unwrap().blocked, Some(NO_STORE));
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
            admin_credential: Arc::from("x"),
            store_url: None,
            store_trusted: true,
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
}
