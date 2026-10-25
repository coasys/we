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
}

impl std::fmt::Debug for ExecutorAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExecutorAddress")
            .field("url", &self.url)
            .field("store_url", &self.store_url)
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

/// Words a person reads, for each way a flow stops.
fn failed(e: &ClientError) -> Screen {
    let message = match e {
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
/// `None` when nothing is pending. Asks the executor nothing when nothing is kept.
async fn finish_pending<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
) -> Result<Option<Created>, ClientError> {
    if vault.pending_incepts()?.is_empty() {
        return Ok(None);
    }
    log::info!("custody: finishing an identity whose publish was not confirmed");
    resume(executor, &vault.unlocking(None)).await
}

/// [`finish_pending`] where a step does not depend on it: a failure is logged, and the next
/// attempt (any step, or the main window asking for the state) tries again.
async fn finish_pending_quietly<R: ExecutorRpc>(executor: &ViaExecutor<R>, vault: &DesktopVault) {
    if let Err(e) = finish_pending(executor, vault).await {
        log::warn!("custody: the pending identity is not finished yet: {e}");
    }
}

async fn public_state(vault: &DesktopVault, address: &ExecutorAddress) -> CustodyPublic {
    let unlock = if vault.needs_passphrase() {
        "passphrase"
    } else {
        "touch-id-or-password"
    };
    let did = match connect(address).await {
        Ok(executor) => {
            finish_pending_quietly(&executor, vault).await;
            executor.status().await.ok().and_then(|s| s.did)
        }
        Err(_) => None,
    };
    let holds_master = did
        .as_deref()
        .and_then(ad4m_identity_core::scid_of)
        .and_then(|scid| match vault.holds(scid) {
            Ok(held) => Some(held),
            // The store could not be asked (no Secret Service, a keychain error): reported as not
            // known to hold one, and logged so the cause is not lost.
            Err(e) => {
                log::warn!("custody: cannot tell whether the master key is held here: {e}");
                None
            }
        })
        .filter(|held| *held)
        // The index sits inside the sealed item; only master #0 is held for now (no rotation yet).
        .map(|_| HoldsMaster { index: 0 });
    CustodyPublic {
        did,
        holds_master,
        unlock,
    }
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
    // An identity made here earlier whose publish was not confirmed is finished, never replaced:
    // its master key is already kept, and its words are the ones the person wrote down.
    match finish_pending(&executor, vault).await {
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
        Err(e) => return answer(reply, Ok(unfinished(&e))),
    }
    // Refuse before showing words that would make nothing: this device speaks for someone already.
    match executor.status().await {
        Ok(status) if status.did.is_some() => {
            return answer(
                reply,
                Ok(failed(&ClientError::HasIdentity(
                    status.did.unwrap_or_default(),
                ))),
            )
        }
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
        Ok(_) => {}
    }
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

    // The macOS keychain asks when the item is written. A sealed item: the passphrase comes first.
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
    let screen = match flow.finish(&executor, &unlocking).await {
        Ok(created) => Screen::IdentityReady {
            did: created.did,
            key_id: created.device_key_id,
        },
        // Custody came first, so a publish that failed left an identity to finish, not a loss.
        Err(e) if !vault.pending_incepts().unwrap_or_default().is_empty() => unfinished(&e),
        Err(e) => failed(&e),
    };
    answer(reply, Ok(screen));
}

// ─── link (the holder's side) ───────────────────────────────────────────────────

async fn run_link(vault: &DesktopVault, address: &ExecutorAddress, rx: &mut Rx, reply: &mut Reply) {
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

    // The one unlock of the flow — a flow asks the person to unlock once, not per signature: on
    // Linux, after the passphrase.
    let mut passphrase: Option<Secret<String>> = None;
    if vault.needs_passphrase() {
        answer(reply, Ok(Screen::EnterPassphrase { error: None }));
    }
    let flow = loop {
        if vault.needs_passphrase() {
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
            Err(ClientError::Vault(VaultError::Cancelled)) if vault.needs_passphrase() => {
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
    let needs = vault.needs_passphrase();
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
        publishes: Cell<u32>,
        calls: Cell<u32>,
    }

    impl FakeExecutor {
        fn new() -> Self {
            FakeExecutor {
                device: KeySigner::new(&[5u8; 32], 0),
                held: RefCell::new(None),
                refuse_publish: Cell::new(false),
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
                    let mut event = Event::from_json(&p["event"]).unwrap();
                    cosign(&mut event, "d1", &self.device).unwrap();
                    Ok(serde_json::to_value(&event).unwrap())
                }
                "identity.publish" => {
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
        })
        .unwrap();
        assert_eq!(public["holdsMaster"]["index"], 0);
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
            (public.did, public.holds_master, public.unlock),
            (None, None, "passphrase")
        );
    }
}
