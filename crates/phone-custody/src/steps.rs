//! Make, restore and replace the master key on the phone, with no computer: the step machines the
//! phone's identity screens run, over `ViaStore` (the identity store's HTTPS) and the phone's
//! vault. The steps themselves are `we-identity-steps`, the crate the desktop's custody service
//! runs too, so both say the same things and take the same decisions.
//!
//! - **Make** ([`PhoneIdentity::start_make`]): [`PhoneScreen::ShowWords`] →
//!   [`PhoneInput::WordsWritten`] → [`PhoneScreen::ConfirmWords`] → [`PhoneInput::ConfirmWords`]
//!   → [`PhoneScreen::NameDevice`] → [`PhoneInput::NameDevice`] → [`PhoneScreen::IdentityReady`].
//! - **Restore** ([`PhoneIdentity::start_restore`]): [`PhoneScreen::EnterWords`] →
//!   [`PhoneInput::TwelveWords`] → [`PhoneScreen::RestoreDevices`] → [`PhoneInput::LockOut`] →
//!   [`PhoneScreen::Restored`].
//! - **Replace the master key** ([`PhoneIdentity::start_rotate`]): [`PhoneScreen::EnterWords`] →
//!   [`PhoneInput::TwelveWords`] → [`PhoneScreen::MasterReplaced`].
//!
//! A flow runs on a thread of its own (a restore's `RestoreFlow` borrows its executor and vault
//! for the whole conversation), and the app talks to it through [`IdentitySteps`]: [`IdentitySteps::next`]
//! answers the first screen, [`IdentitySteps::step`] answers each input with exactly one screen,
//! or an error. [`PhoneKeyError::WrongInput`] is the one error that leaves the flow where it was;
//! every other error ends it.
//!
//! **The words.** The 12 words a make shows exist in this crate's memory only, in types that zero
//! their bytes when they drop: they cross to the app once, in [`PhoneScreen::ShowWords`], to be
//! written down. They are wiped once two of them are typed back right, and when the flow ends
//! any other way (cancelled, an error, the handle dropped). Typed words are moved into a
//! zeroizing string the moment they arrive and wiped when the step that read them is done; a
//! restore keeps them for its enrolment's retry, until the flow ends. The app's own copies (the
//! strings on screen, the text field) are the app's: it shows them with the window marked secure
//! (`DeviceKeyPlugin.setSecure`), never puts them on the clipboard, and drops them with the screen.
//!
//! **The master key** goes into the phone's vault behind the biometric prompt, under the same
//! rule as [`PhoneIdentity::take_master`]: not in software-only protection unless the person
//! agreed (`allow_weak_protection`). That is checked before the words are made or asked for.
//!
//! **An identity not published.** A make keeps master #0 and the co-signed incept in the vault
//! before it publishes; a publish that does not land (offline, the store busy) leaves the incept
//! pending. [`PhoneScreen::MakeStopped`] says so, and [`PhoneInput::TryAgain`] publishes it again
//! with the same words. Once the flow is gone, [`PhoneIdentity::finish_pending`] publishes it
//! without them, and [`PhoneIdentity::start_make`] does so before it makes anything new.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ad4m_identity_client::flows::create::{resume, Created};
use ad4m_identity_client::flows::master;
use ad4m_identity_client::flows::restore::{Enrolled, RestoreFlow};
use ad4m_identity_client::flows::rotate::Rotated;
use ad4m_identity_client::{ClientError, OsRandom, SystemClock, Vault, VaultError};
use ad4m_identity_core::record::{DeviceEntry, DeviceKind, HoldsMaster};
use ad4m_identity_core::words::{self, Words};
use ad4m_identity_core::{did_of, scid_of, Event, Op};
use futures_executor::block_on;
use we_identity_steps::{
    enrol_again, finish_restore, handed_over, joined, key_ids, listed, lock_out_of, record_note,
    rotate_with_words, words_refused, MakeWords, RestoreDevice, NOT_THESE_WORDS, WRONG_CONFIRM,
};
use zeroize::Zeroizing;

use crate::identity::{
    kind_name, phone_error, rejoin, rpc, vault_error, Executor, Parts, PhoneIdentity,
};
use crate::vault::PhoneVault;
use crate::PhoneKeyError;

/// What a hand-over note says about a push that did not reach a device yet.
const AGAIN: &str = "send it again from this phone with \"Send the master key again\".";

/// How long a flow waits for the person's next input before it ends, and wipes what it holds.
/// Long enough to write 12 words down by hand.
const IDLE: Duration = Duration::from_secs(30 * 60);

/// The name a phone gets when the person gives none.
const DEFAULT_NAME: &str = "Phone";

/// One device on a restore's lock-out list.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct RestoreDeviceView {
    pub key_id: String,
    /// The record's name; `None` when the record does not name it or could not be read.
    pub name: Option<String>,
    /// `phone-app`, `desktop-app`, `server`, …; `None` when the record does not say.
    pub kind: Option<String>,
    /// Ticked by default: apps, and a device the record does not name.
    pub lock_out: bool,
}

/// What the phone's identity screen shows next.
#[derive(Clone, PartialEq, Eq, uniffi::Enum)]
pub enum PhoneScreen {
    /// The 12 new words, to write down on paper. Shown once: the app marks the window secure
    /// while they are on screen, and drops its copy when it leaves this screen.
    ShowWords { words: Vec<String> },
    /// Two of the words, asked back at `positions` (counted from 1, the smaller first). `error`
    /// when the last answer did not match: the same places are asked again.
    ConfirmWords {
        positions: Vec<u32>,
        error: Option<String>,
    },
    /// The words are confirmed and wiped: the person names this phone (empty for "Phone").
    NameDevice,
    /// Type the 12 words. `purpose`: `restore` or `replace`. `error` says why the last ones were
    /// refused, naming a word only by its place (`position`, counted from 1).
    EnterWords {
        purpose: String,
        error: Option<String>,
        position: Option<u32>,
    },
    /// The identity the words make and its devices, those to lock out ticked. `note` when the
    /// device list could not be read (devices show by key id).
    RestoreDevices {
        did: String,
        devices: Vec<RestoreDeviceView>,
        note: Option<String>,
    },
    /// The identity is made and published; this phone is `key_id` in its log and keeps master
    /// #0. `note`: a step after the publish that did not pass (the device list).
    IdentityReady {
        did: String,
        key_id: String,
        note: Option<String>,
    },
    /// The make stopped before the identity was published: `reason` says why. `pending`: the
    /// phone already keeps master #0 and the identity, which [`PhoneInput::TryAgain`] (or, once
    /// the flow is gone, [`PhoneIdentity::finish_pending`]) publishes; otherwise TryAgain makes
    /// it from the same words.
    MakeStopped {
        did: Option<String>,
        reason: String,
        pending: bool,
    },
    /// Restored: this phone is `key_id`, named `name`, keeps the new master key, and the devices
    /// `revoked` are locked out. `note`: what the hand-over left undone.
    Restored {
        did: String,
        name: String,
        key_id: String,
        revoked: Vec<String>,
        note: Option<String>,
    },
    /// The restore's rotation is published (the identity is restored, `revoked` locked out) and
    /// this phone is not in the log yet: `reason`. [`PhoneInput::TryAgain`] joins it again
    /// without the words being typed again.
    RestoreNotLinked {
        did: String,
        revoked: Vec<String>,
        reason: String,
    },
    /// The master key is replaced; this phone keeps master `index`.
    MasterReplaced {
        index: u32,
        revoked: Vec<String>,
        note: Option<String>,
    },
    /// Master `index` is current and this phone could not keep it: `reason`. The rotation stands.
    /// [`PhoneInput::TryAgain`] asks for the words again, to replace it once more and keep that.
    MasterNotKept {
        index: u32,
        revoked: Vec<String>,
        reason: String,
        note: Option<String>,
    },
}

/// Never the words: a screen logged or in a crash report shows how many, not which.
impl std::fmt::Debug for PhoneScreen {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PhoneScreen::ShowWords { words } => f
                .debug_struct("ShowWords")
                .field("words", &format_args!("<{} redacted>", words.len()))
                .finish(),
            PhoneScreen::ConfirmWords { positions, error } => f
                .debug_struct("ConfirmWords")
                .field("positions", positions)
                .field("error", error)
                .finish(),
            PhoneScreen::NameDevice => f.write_str("NameDevice"),
            PhoneScreen::EnterWords {
                purpose,
                error,
                position,
            } => f
                .debug_struct("EnterWords")
                .field("purpose", purpose)
                .field("error", error)
                .field("position", position)
                .finish(),
            PhoneScreen::RestoreDevices { did, devices, note } => f
                .debug_struct("RestoreDevices")
                .field("did", did)
                .field("devices", devices)
                .field("note", note)
                .finish(),
            PhoneScreen::IdentityReady { did, key_id, note } => f
                .debug_struct("IdentityReady")
                .field("did", did)
                .field("key_id", key_id)
                .field("note", note)
                .finish(),
            PhoneScreen::MakeStopped {
                did,
                reason,
                pending,
            } => f
                .debug_struct("MakeStopped")
                .field("did", did)
                .field("reason", reason)
                .field("pending", pending)
                .finish(),
            PhoneScreen::Restored {
                did,
                name,
                key_id,
                revoked,
                note,
            } => f
                .debug_struct("Restored")
                .field("did", did)
                .field("name", name)
                .field("key_id", key_id)
                .field("revoked", revoked)
                .field("note", note)
                .finish(),
            PhoneScreen::RestoreNotLinked {
                did,
                revoked,
                reason,
            } => f
                .debug_struct("RestoreNotLinked")
                .field("did", did)
                .field("revoked", revoked)
                .field("reason", reason)
                .finish(),
            PhoneScreen::MasterReplaced {
                index,
                revoked,
                note,
            } => f
                .debug_struct("MasterReplaced")
                .field("index", index)
                .field("revoked", revoked)
                .field("note", note)
                .finish(),
            PhoneScreen::MasterNotKept {
                index,
                revoked,
                reason,
                note,
            } => f
                .debug_struct("MasterNotKept")
                .field("index", index)
                .field("revoked", revoked)
                .field("reason", reason)
                .field("note", note)
                .finish(),
        }
    }
}

/// The person's answer to a screen.
#[derive(Clone, PartialEq, Eq, uniffi::Enum)]
pub enum PhoneInput {
    /// To [`PhoneScreen::ShowWords`]: the words are written down.
    WordsWritten,
    /// To [`PhoneScreen::ConfirmWords`]: the words at the two places asked, in their order.
    ConfirmWords { first: String, second: String },
    /// To [`PhoneScreen::NameDevice`]: this phone's name in the device list.
    NameDevice { name: Option<String> },
    /// To [`PhoneScreen::EnterWords`]: the 12 words, separated by spaces.
    TwelveWords { words: String },
    /// To [`PhoneScreen::RestoreDevices`]: the key ids to lock out (each one listed), and this
    /// phone's name.
    LockOut {
        key_ids: Vec<String>,
        name: Option<String>,
    },
    /// To [`PhoneScreen::MakeStopped`], [`PhoneScreen::RestoreNotLinked`] and
    /// [`PhoneScreen::MasterNotKept`].
    TryAgain,
}

/// Never the words: an input logged or in a crash report must not carry them.
impl std::fmt::Debug for PhoneInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            PhoneInput::WordsWritten => "WordsWritten",
            PhoneInput::ConfirmWords { .. } => "ConfirmWords",
            PhoneInput::NameDevice { .. } => "NameDevice",
            PhoneInput::TwelveWords { .. } => "TwelveWords",
            PhoneInput::LockOut { .. } => "LockOut",
            PhoneInput::TryAgain => "TryAgain",
        })
    }
}

/// An input on its way to the flow's thread: words already in zeroizing strings.
enum Command {
    WordsWritten,
    ConfirmWords([Zeroizing<String>; 2]),
    NameDevice(Option<String>),
    TwelveWords(Zeroizing<String>),
    LockOut(Vec<String>, Option<String>),
    TryAgain,
}

impl From<PhoneInput> for Command {
    fn from(input: PhoneInput) -> Self {
        match input {
            PhoneInput::WordsWritten => Command::WordsWritten,
            PhoneInput::ConfirmWords { first, second } => {
                Command::ConfirmWords([Zeroizing::new(first), Zeroizing::new(second)])
            }
            PhoneInput::NameDevice { name } => Command::NameDevice(name),
            PhoneInput::TwelveWords { words } => Command::TwelveWords(Zeroizing::new(words)),
            PhoneInput::LockOut { key_ids, name } => Command::LockOut(key_ids, name),
            PhoneInput::TryAgain => Command::TryAgain,
        }
    }
}

type Answer = Result<PhoneScreen, PhoneKeyError>;

/// One make, restore or rotation the phone runs.
#[derive(uniffi::Object)]
pub struct IdentitySteps {
    screens: Mutex<Receiver<Answer>>,
    inputs: Mutex<Option<Sender<Command>>>,
    cancelled: Arc<AtomicBool>,
    /// Set when the flow's thread is done — before its last screen or error is sent, so an app
    /// that reads that answer sees [`IdentitySteps::ended`] true.
    ended: Arc<AtomicBool>,
}

/// Sets the flag when the flow's thread exits, whatever way it went (an unwind too).
struct SetOnDrop(Arc<AtomicBool>);

impl Drop for SetOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[derive(Clone, Copy)]
enum Kind {
    Make,
    Restore,
    Rotate,
}

impl IdentitySteps {
    fn start(
        kind: Kind,
        parts: Parts,
        vault: Arc<PhoneVault>,
    ) -> Result<Arc<IdentitySteps>, PhoneKeyError> {
        let (screen_tx, screen_rx) = channel();
        let (input_tx, input_rx) = channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let ended = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        let done = ended.clone();
        std::thread::Builder::new()
            .name("phone-identity-steps".into())
            .spawn(move || {
                let _ended = SetOnDrop(done.clone());
                let talk = Talk {
                    screens: &screen_tx,
                    inputs: &input_rx,
                    cancelled: &flag,
                };
                let last = run(kind, &parts, &vault, &talk);
                // Everything the flow held (the words, a seed, an unlocked key) is dropped by
                // now: `run` returned. Ended first, so the app reading the last answer sees it.
                done.store(true, Ordering::SeqCst);
                let _ = screen_tx.send(last);
            })
            .map_err(|e| PhoneKeyError::Io {
                reason: format!("the identity steps' thread did not start: {e}"),
            })?;
        Ok(Arc::new(IdentitySteps {
            screens: Mutex::new(screen_rx),
            inputs: Mutex::new(Some(input_tx)),
            cancelled,
            ended,
        }))
    }

    fn over() -> PhoneKeyError {
        PhoneKeyError::Ended {
            reason: "these steps are over".into(),
        }
    }
}

#[uniffi::export]
impl IdentitySteps {
    /// The flow's first screen; blocks until it is there (a make first finishes an identity
    /// still pending, which reads the store). After the flow ends, `Ended`.
    pub fn next(&self) -> Result<PhoneScreen, PhoneKeyError> {
        let screens = self
            .screens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        screens.recv().unwrap_or_else(|_| Err(Self::over()))
    }

    /// Answers the screen shown with `input`, and blocks until the next screen. `WrongInput`
    /// when the input does not answer the screen shown: the flow stays where it was. Any other
    /// error ends the flow.
    pub fn step(&self, input: PhoneInput) -> Result<PhoneScreen, PhoneKeyError> {
        let command = Command::from(input);
        let screens = self
            .screens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let sent = self
            .inputs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|inputs| inputs.send(command).is_ok());
        if !sent {
            return Err(Self::over());
        }
        screens.recv().unwrap_or_else(|_| Err(Self::over()))
    }

    /// Stops the flow: a wait for input ends now, a request to the store at its next try, and
    /// the words, the seed and anything unlocked are wiped as the thread ends. An identity the
    /// make kept and did not publish stays pending ([`PhoneIdentity::finish_pending`]).
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.inputs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }

    /// Whether the flow's thread is done — finished, failed or cancelled.
    pub fn ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }
}

impl Drop for IdentitySteps {
    /// The app dropped its handle: the thread ends at its next wait and wipes what it holds.
    fn drop(&mut self) {
        self.cancel();
    }
}

/// The flow's side of the conversation.
struct Talk<'t> {
    screens: &'t Sender<Answer>,
    inputs: &'t Receiver<Command>,
    cancelled: &'t Arc<AtomicBool>,
}

impl Talk<'_> {
    fn show(&self, screen: PhoneScreen) {
        let _ = self.screens.send(Ok(screen));
    }

    fn wrong(&self) {
        let _ = self.screens.send(Err(PhoneKeyError::WrongInput));
    }

    /// The next input: `Cancelled` when the app cancelled or dropped the flow, `Ended` after
    /// [`IDLE`] with none.
    fn input(&self) -> Result<Command, PhoneKeyError> {
        let command = match self.inputs.recv_timeout(IDLE) {
            Ok(command) => command,
            Err(RecvTimeoutError::Timeout) => {
                return Err(PhoneKeyError::Ended {
                    reason: "nothing was typed for too long; start again".into(),
                })
            }
            Err(RecvTimeoutError::Disconnected) => return Err(PhoneKeyError::Cancelled),
        };
        if self.cancelled.load(Ordering::SeqCst) {
            return Err(PhoneKeyError::Cancelled);
        }
        Ok(command)
    }

    /// `Cancelled` once the app cancelled: checked before each step that talks to the store.
    fn check(&self) -> Result<(), PhoneKeyError> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err(PhoneKeyError::Cancelled);
        }
        Ok(())
    }

    fn was_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

fn run(kind: Kind, parts: &Parts, vault: &PhoneVault, talk: &Talk<'_>) -> Answer {
    // The app's cancel reaches the transport too: a request to the store stops at its next try.
    let exec = parts.executor(Some(talk.cancelled.clone()))?;
    match kind {
        Kind::Make => make(parts, vault, &exec, talk),
        Kind::Restore => restore(parts, vault, &exec, talk),
        Kind::Rotate => rotate(parts, vault, &exec, talk),
    }
}

/// This phone's entry in the record: a phone app, which runs no executor, holding the master key
/// (a make's and a restore's hand-over set the index and the vault).
pub(crate) fn this_phone(name: Option<String>) -> DeviceEntry {
    DeviceEntry {
        name: name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| DEFAULT_NAME.into()),
        kind: DeviceKind::PhoneApp,
        place: None,
        address: None,
        runs_executor: false,
        holds_master: HoldsMaster::Yes,
        master_index: None,
        vault: None,
        operator: None,
    }
}

/// Why a step that published left this part undone, in a sentence the person reads. Never says
/// nothing changed: the publish stands.
fn after_publish(e: ClientError) -> String {
    match e {
        ClientError::NotTheseWords(_) => {
            "These words do not make your identity's master key.".into()
        }
        ClientError::LogBusy => "Your key log kept changing on another device.".into(),
        e => phone_error(e).to_string(),
    }
}

/// The kept incept that lists `device_key`: an identity this phone made and has not published.
fn own_pending(vault: &PhoneVault, device_key: &str) -> Result<Option<Event>, VaultError> {
    Ok(vault.pending_incepts()?.into_iter().find(|incept| {
        matches!(&incept.op, Op::Incept { add, .. } if add.iter().any(|d| d.sign == device_key))
    }))
}

/// Publishes an identity this phone made and has not published yet, and records it in the key
/// file. `None` when there is none. An incept kept for a key that speaks for another identity
/// now can never be published, and is dropped. No prompt: the incept is signed already.
pub(crate) fn finish_pending(
    parts: &Parts,
    vault: &PhoneVault,
    exec: &Executor,
) -> Result<Option<Created>, PhoneKeyError> {
    if vault.pending_incepts().map_err(vault_error)?.is_empty() {
        return Ok(None);
    }
    log::info!("phone: publishing an identity this phone made and did not publish");
    match block_on(resume(exec, vault)) {
        Ok(Some(created)) => {
            parts.keys.record_identity(
                &created.scid,
                Some(created.head.seq),
                &parts.store_url(),
            )?;
            Ok(Some(created))
        }
        Ok(None) => Ok(None),
        Err(ClientError::HasIdentity(held)) => {
            let status = block_on(exec.status()).map_err(rpc)?;
            if let Some(incept) = own_pending(vault, &status.device_key).map_err(vault_error)? {
                log::warn!(
                    "phone: this phone speaks for {held}; dropping the incept of {} it can never \
                     publish",
                    did_of(&incept.scid)
                );
                vault.incept_published(&incept.scid).map_err(vault_error)?;
            }
            Ok(None)
        }
        Err(e) => Err(phone_error(e)),
    }
}

/// The did of the identity this phone made and has not published; `None` when there is none.
pub(crate) fn pending_did(
    vault: &PhoneVault,
    device_key: &str,
) -> Result<Option<String>, PhoneKeyError> {
    Ok(own_pending(vault, device_key)
        .map_err(vault_error)?
        .map(|incept| did_of(&incept.scid)))
}

/// A phone of no identity: the key file names none, no claim waits, and the store's key index
/// puts this phone's key in no log. One the key index puts in a log is recorded as this phone's
/// ([`rejoin`]) before it is refused: a make or a restore that published and stopped before the
/// key file recorded it.
fn no_identity_yet(parts: &Parts, exec: &Executor) -> Result<(), PhoneKeyError> {
    let status = parts.keys.status();
    if status.keys.is_none() {
        return Err(PhoneKeyError::NoKeys);
    }
    if let Some(member) = status.identity {
        return Err(PhoneKeyError::AlreadyJoined { did: member.did });
    }
    if let Some(pending) = status.pending {
        return Err(PhoneKeyError::Refused {
            reason: format!(
                "this phone is joining {} already; finish or cancel that first",
                pending.did
            ),
        });
    }
    if let Some(did) = rejoin(parts, exec)? {
        return Err(PhoneKeyError::AlreadyJoined { did });
    }
    Ok(())
}

// ─── make ────────────────────────────────────────────────────────────────────────

fn make(parts: &Parts, vault: &PhoneVault, exec: &Executor, talk: &Talk<'_>) -> Answer {
    // An identity made before and not published is finished first: making another would leave
    // master #0 of the first kept for an identity nobody can see.
    if let Some(created) = finish_pending(parts, vault, exec)? {
        return Ok(PhoneScreen::IdentityReady {
            did: created.did,
            key_id: created.device_key_id,
            note: Some("The identity made on this phone before is published now.".into()),
        });
    }
    no_identity_yet(parts, exec)?;
    let mut flow = MakeWords::start(&OsRandom);
    let shown = flow.words().ok_or_else(|| PhoneKeyError::Refused {
        reason: "the new words are not there to show".into(),
    })?;
    talk.show(PhoneScreen::ShowWords {
        words: shown.expose().clone(),
    });
    drop(shown);
    loop {
        match talk.input()? {
            Command::WordsWritten => break,
            _ => talk.wrong(),
        }
    }
    let positions = flow.words_written(&OsRandom).map_err(phone_error)?;
    let positions: Vec<u32> = positions.iter().map(|p| *p as u32).collect();
    talk.show(PhoneScreen::ConfirmWords {
        positions: positions.clone(),
        error: None,
    });
    loop {
        match talk.input()? {
            Command::ConfirmWords(answers) => {
                match flow.confirm([answers[0].as_str(), answers[1].as_str()]) {
                    Ok(()) => break,
                    Err(ClientError::WrongWords) => talk.show(PhoneScreen::ConfirmWords {
                        positions: positions.clone(),
                        error: Some(WRONG_CONFIRM.into()),
                    }),
                    Err(e) => return Err(phone_error(e)),
                }
            }
            _ => talk.wrong(),
        }
    }
    // The words are wiped; the seed stays for the tries below until the flow ends.
    talk.show(PhoneScreen::NameDevice);
    let name = loop {
        match talk.input()? {
            Command::NameDevice(name) => break name,
            _ => talk.wrong(),
        }
    };
    let entry = this_phone(name);
    loop {
        talk.check()?;
        let made = block_on(flow.finish(exec, vault, entry.clone(), &SystemClock, &OsRandom));
        match made {
            Ok(created) => {
                parts.keys.record_identity(
                    &created.scid,
                    Some(created.head.seq),
                    &parts.store_url(),
                )?;
                let note = match created.record {
                    Some(Err(e)) => {
                        log::warn!("phone: the record was not written after the make: {e}");
                        Some(
                            "Your device list does not show this phone yet: it is written the \
                             next time a device changes it."
                                .into(),
                        )
                    }
                    _ => None,
                };
                return Ok(PhoneScreen::IdentityReady {
                    did: created.did,
                    key_id: created.device_key_id,
                    note,
                });
            }
            Err(ClientError::HasIdentity(did)) => return Err(PhoneKeyError::AlreadyJoined { did }),
            Err(e) => {
                let e = phone_error(e);
                if matches!(
                    e,
                    PhoneKeyError::WeakProtection { .. } | PhoneKeyError::NoBiometrics
                ) {
                    return Err(e);
                }
                if matches!(e, PhoneKeyError::Cancelled) && talk.was_cancelled() {
                    return Err(e);
                }
                let device_key = block_on(exec.status()).map(|s| s.device_key).map_err(rpc)?;
                let pending = pending_did(vault, &device_key)?;
                log::warn!("phone: the make stopped before its publish: {e}");
                let reason = match &pending {
                    Some(_) => format!(
                        "Your identity is made on this phone and not published yet: {e}. Try \
                         again: the same identity is published."
                    ),
                    None => format!(
                        "Your identity is not made yet: {e}. Try again: the words you wrote \
                         down are used."
                    ),
                };
                talk.show(PhoneScreen::MakeStopped {
                    pending: pending.is_some(),
                    did: pending,
                    reason,
                });
                loop {
                    match talk.input()? {
                        Command::TryAgain => break,
                        _ => talk.wrong(),
                    }
                }
            }
        }
    }
}

// ─── the 12 words typed ──────────────────────────────────────────────────────────

/// Asks for the 12 words until they parse, showing why the last ones did not. `first` is the
/// screen already shown. The typed text is wiped when this returns.
fn typed_words(
    talk: &Talk<'_>,
    purpose: &str,
    refused: Option<(String, Option<usize>)>,
) -> Result<(Words, Zeroizing<String>), PhoneKeyError> {
    let ask = |error: Option<(String, Option<usize>)>| {
        let (error, position) = match error {
            Some((message, position)) => (Some(message), position.map(|p| p as u32)),
            None => (None, None),
        };
        talk.show(PhoneScreen::EnterWords {
            purpose: purpose.into(),
            error,
            position,
        });
    };
    ask(refused);
    loop {
        match talk.input()? {
            Command::TwelveWords(typed) => match words::parse(&typed) {
                Ok(parsed) => return Ok((parsed, typed)),
                Err(e) => ask(Some(words_refused(&e))),
            },
            _ => talk.wrong(),
        }
    }
}

fn not_these_words() -> Option<(String, Option<usize>)> {
    Some((NOT_THESE_WORDS.to_string(), None))
}

// ─── restore ─────────────────────────────────────────────────────────────────────

fn restore(parts: &Parts, vault: &PhoneVault, exec: &Executor, talk: &Talk<'_>) -> Answer {
    no_identity_yet(parts, exec)?;
    let clock = SystemClock;
    let random = OsRandom;
    let mut refused = None;
    let (mut flow, words) = loop {
        let (words, typed) = typed_words(talk, "restore", refused.take())?;
        talk.check()?;
        match block_on(RestoreFlow::start(exec, vault, &typed, &clock, &random)) {
            Ok(flow) => break (flow, words),
            Err(ClientError::NotTheseWords(why)) => {
                log::info!("phone: the restore's words name no identity: {why}");
                refused = not_these_words();
            }
            Err(ClientError::Words(e)) => refused = Some(words_refused(&e)),
            Err(e) => return Err(phone_error(e)),
        }
    };
    let did = flow.did().to_string();
    let devices: Vec<RestoreDevice> = listed(&flow);
    talk.show(PhoneScreen::RestoreDevices {
        did: did.clone(),
        devices: devices
            .iter()
            .map(|d| RestoreDeviceView {
                key_id: d.key_id.clone(),
                name: d.name.clone(),
                kind: d.kind.map(kind_name),
                lock_out: d.lock_out,
            })
            .collect(),
        note: record_note(&flow),
    });
    let (lock_out, name) = loop {
        match talk.input()? {
            Command::LockOut(key_ids, name) => match lock_out_of(&devices, &key_ids) {
                Some(lock_out) => break (lock_out, name),
                None => talk.wrong(),
            },
            _ => talk.wrong(),
        }
    };
    let entry = this_phone(name);
    let name = entry.name.clone();
    talk.check()?;
    let restored = block_on(finish_restore(
        &mut flow,
        exec,
        vault,
        &words,
        &lock_out,
        entry.clone(),
    ))
    .map_err(phone_error)?;
    // Published from here: the identity is restored and the lock-out stands, whatever follows.
    let revoked = key_ids(&restored.revoked);
    let mut enrolled: Result<Enrolled, ClientError> = restored.enrolled;
    loop {
        match enrolled {
            Ok(enrolled) => {
                let scid = scid_of(&did).ok_or_else(|| PhoneKeyError::Refused {
                    reason: format!("{did} is not a did:scid:coasys:1"),
                })?;
                parts.keys.record_identity(scid, None, &parts.store_url())?;
                return Ok(PhoneScreen::Restored {
                    note: handed_over(&enrolled.pushes, &enrolled.record, AGAIN),
                    did,
                    name,
                    key_id: enrolled.key_id.as_str().to_string(),
                    revoked,
                });
            }
            Err(e) => {
                log::warn!("phone: restored, and this phone is not in the log yet: {e}");
                talk.show(PhoneScreen::RestoreNotLinked {
                    did: did.clone(),
                    revoked: revoked.clone(),
                    reason: after_publish(e),
                });
            }
        }
        loop {
            match talk.input()? {
                Command::TryAgain => break,
                _ => talk.wrong(),
            }
        }
        talk.check()?;
        // The same flow: it holds the words, which are not asked again, and refuses a second
        // rotation. The same words, checked again, recover an epoch lost since.
        enrolled = block_on(enrol_again(&flow, exec, vault, &words, entry.clone()));
    }
}

// ─── replace the master key ──────────────────────────────────────────────────────

/// The last screen of a rotation that was published.
fn replaced(rotated: Rotated) -> PhoneScreen {
    let revoked = key_ids(&rotated.revoked);
    let note = joined(None, handed_over(&rotated.pushes, &rotated.record, AGAIN));
    match rotated.kept {
        Ok(index) => PhoneScreen::MasterReplaced {
            index,
            revoked,
            note,
        },
        Err(e) => {
            log::warn!(
                "phone: master #{} is current, and this phone did not keep it: {e}",
                rotated.index
            );
            PhoneScreen::MasterNotKept {
                index: rotated.index,
                revoked,
                reason: after_publish(e),
                note,
            }
        }
    }
}

fn rotate(parts: &Parts, vault: &PhoneVault, exec: &Executor, talk: &Talk<'_>) -> Answer {
    let (_, did) = parts.member()?;
    let mut refused = None;
    loop {
        let (words, typed) = typed_words(talk, "replace", refused.take())?;
        drop(typed);
        talk.check()?;
        let rotated = block_on(rotate_with_words(
            exec,
            vault,
            vault,
            &did,
            &words,
            &SystemClock,
            &OsRandom,
        ));
        drop(words);
        match rotated {
            Ok(rotated) => match replaced(rotated) {
                screen @ PhoneScreen::MasterNotKept { .. } => {
                    talk.show(screen);
                    loop {
                        match talk.input()? {
                            Command::TryAgain => break,
                            _ => talk.wrong(),
                        }
                    }
                }
                screen => return Ok(screen),
            },
            Err(ClientError::NotTheseWords(why)) => {
                log::info!("phone: the words are not the identity's: {why}");
                refused = not_these_words();
            }
            Err(ClientError::Words(e)) => refused = Some(words_refused(&e)),
            Err(e) => return Err(phone_error(e)),
        }
    }
}

// ─── the phone's identity, extended ──────────────────────────────────────────────

/// Applies the person's answer about weak protection, then refuses before anything is made when
/// the master key could not be kept here.
fn protected(vault: &PhoneVault, allow_weak_protection: bool) -> Result<(), PhoneKeyError> {
    vault.allow_weak_protection(allow_weak_protection);
    vault.check_protection().map_err(vault_error)
}

impl PhoneIdentity {
    fn steps(
        &self,
        kind: Kind,
        allow_weak_protection: bool,
    ) -> Result<Arc<IdentitySteps>, PhoneKeyError> {
        let (parts, vault) = self.inner();
        if parts.keys.status().keys.is_none() {
            return Err(PhoneKeyError::NoKeys);
        }
        if matches!(kind, Kind::Rotate) {
            parts.member()?;
        }
        protected(&vault, allow_weak_protection)?;
        IdentitySteps::start(kind, parts, vault)
    }
}

#[uniffi::export]
impl PhoneIdentity {
    /// Makes a new identity on this phone: 12 new words, two asked back, this phone named, then
    /// master #0 kept here behind the biometric prompt and the identity published to the store.
    /// The first screen ([`IdentitySteps::next`]) is [`PhoneScreen::ShowWords`], or
    /// [`PhoneScreen::IdentityReady`] when an identity this phone made before was not published
    /// and is now. `NoKeys` before the device key is made; `AlreadyJoined` when this phone is in
    /// an identity; `WeakProtection` (before any words) when the key store is not secure
    /// hardware and `allow_weak_protection` is not set.
    pub fn start_make(
        &self,
        allow_weak_protection: bool,
    ) -> Result<Arc<IdentitySteps>, PhoneKeyError> {
        self.steps(Kind::Make, allow_weak_protection)
    }

    /// Restores an identity on this phone from its 12 words: the identity they make, its devices
    /// with the apps to lock out ticked, then one rotation that revokes the ticked ones and keeps
    /// the new master key here, and this phone joined as a device. The first screen is
    /// [`PhoneScreen::EnterWords`] with purpose `restore`. Refused as [`Self::start_make`] is.
    pub fn start_restore(
        &self,
        allow_weak_protection: bool,
    ) -> Result<Arc<IdentitySteps>, PhoneKeyError> {
        self.steps(Kind::Restore, allow_weak_protection)
    }

    /// Replaces the identity's master key with the next one its 12 words make, kept on this
    /// phone; the other apps that keep the master key are sent the new one. The first screen is
    /// [`PhoneScreen::EnterWords`] with purpose `replace`. `NoIdentity` when this phone is in
    /// none; `WeakProtection` as for [`Self::start_make`].
    pub fn start_rotate(
        &self,
        allow_weak_protection: bool,
    ) -> Result<Arc<IdentitySteps>, PhoneKeyError> {
        self.steps(Kind::Rotate, allow_weak_protection)
    }

    /// The did of an identity this phone made and has not published yet (no network, no
    /// prompt); `None` when there is none.
    pub fn pending_identity(&self) -> Result<Option<String>, PhoneKeyError> {
        let (parts, vault) = self.inner();
        let Some(keys) = parts.keys.status().keys else {
            return Ok(None);
        };
        pending_did(&vault, &keys.sign)
    }

    /// Publishes an identity this phone made and has not published yet, and records it as this
    /// phone's: its did, or `None` when there was none to publish. No prompt and no words. The
    /// app calls it when it opens and when it is online again. `Unavailable` while the store
    /// does not answer: the identity stays pending.
    pub fn finish_pending(&self) -> Result<Option<String>, PhoneKeyError> {
        let (parts, vault) = self.inner();
        if parts.keys.status().keys.is_none() {
            return Err(PhoneKeyError::NoKeys);
        }
        let exec = parts.executor(None)?;
        Ok(finish_pending(&parts, &vault, &exec)?.map(|created| created.did))
    }

    /// Sends the new master key again to the apps a replace or a restore did not reach (one
    /// biometric prompt when any is left). What is still left, as a note; `None` when every app
    /// has it.
    pub fn retry_master_pushes(&self) -> Result<Option<String>, PhoneKeyError> {
        let (parts, vault) = self.inner();
        let (_, did) = parts.member()?;
        let exec = parts.executor(None)?;
        let retried = block_on(master::retry_pushes(
            &exec,
            vault.as_ref(),
            &did,
            &SystemClock,
            &OsRandom,
        ))
        .map_err(phone_error)?;
        let note = match &retried.record {
            Some(record) => handed_over(&retried.pushes, record, AGAIN),
            None => handed_over(&retried.pushes, &Ok(0), AGAIN),
        };
        Ok(note)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_input_never_prints_the_words() {
        let typed = PhoneInput::TwelveWords {
            words: "abandon ability able".into(),
        };
        assert_eq!(format!("{typed:?}"), "TwelveWords");
        let confirm = PhoneInput::ConfirmWords {
            first: "zoo".into(),
            second: "abandon".into(),
        };
        assert_eq!(format!("{confirm:?}"), "ConfirmWords");
        let shown = PhoneScreen::ShowWords {
            words: vec!["abandon".into(), "zoo".into()],
        };
        assert_eq!(format!("{shown:?}"), "ShowWords { words: <2 redacted> }");
        assert!(!format!("{shown:#?}").contains("zoo"));
    }

    #[test]
    fn a_phone_is_named_and_listed_as_a_phone_app() {
        let entry = this_phone(Some("  ".into()));
        assert_eq!(entry.name, DEFAULT_NAME);
        assert_eq!(entry.kind, DeviceKind::PhoneApp);
        assert!(!entry.runs_executor && entry.place.is_none());
        assert_eq!(entry.holds_master, HoldsMaster::Yes);
        assert_eq!(this_phone(Some(" Pixel ".into())).name, "Pixel");
    }

    #[test]
    fn a_wait_for_input_ends_on_a_cancel() {
        let (screens, _rx) = channel();
        let (tx, inputs) = channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let talk = Talk {
            screens: &screens,
            inputs: &inputs,
            cancelled: &cancelled,
        };
        tx.send(Command::TryAgain).unwrap();
        assert!(matches!(talk.input(), Ok(Command::TryAgain)));
        // An input sent after a cancel is not taken.
        tx.send(Command::WordsWritten).unwrap();
        cancelled.store(true, Ordering::SeqCst);
        assert!(matches!(talk.input(), Err(PhoneKeyError::Cancelled)));
        drop(tx);
        assert!(matches!(talk.input(), Err(PhoneKeyError::Cancelled)));
    }
}
