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
use ad4m_identity_client::executor::{IdentityStatus, RpcError};
use ad4m_identity_client::flows::create::{resume, CreateFlow, CreateScreen, Created};
use ad4m_identity_client::flows::link::{Claimed, LinkFlow};
use ad4m_identity_client::flows::master::{
    complete_pending_mark, refresh_master, remove_master, retry_pushes, take_master, Refreshed,
    Taken,
};
use ad4m_identity_client::flows::requests::{self, Answered};
use ad4m_identity_client::flows::restore::RestoreFlow;
use ad4m_identity_client::flows::revoke::{revoke, revoke_and_rotate};
use ad4m_identity_client::flows::rotate::{rotate, Rotated};
use ad4m_identity_client::record::{self, Change};
use ad4m_identity_client::vault::{MasterUse, Vault};
use ad4m_identity_client::{
    ClientError, Clock, ExecutorRpc, OsRandom, Secret, Standing, SystemClock, VaultError, VaultId,
    ViaExecutor, WithEncKey,
};
use ad4m_identity_core::link::{DeviceString, OfferKind, CONFIRM_GRACE_S, OFFER_TTL_S};
use ad4m_identity_core::record::{DeviceEntry, DeviceKind, HoldsMaster as Holds, Place};
use ad4m_identity_core::words::{self, Words};
use ad4m_identity_core::{BotScope, Event, Op, BOT_ACTIONS};
use ad4m_ldk::identity::DeviceRequestBody;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot};
use zeroize::Zeroizing;

use crate::enc::CustodyEncKey;
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
    /// The holder adds a device by the code that device shows ("Enter code").
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
    /// Replaces the master key with the next one the 12 words make; this computer keeps it, and
    /// every other app that kept the old one is sent the new one.
    ReplaceMaster,
    /// On a computer of no identity: the 12 words give the identity back here, and lock out the
    /// devices the person ticks ("Restore with recovery phrase").
    Restore,
    /// Forgets this computer's copy of the master key ("Remove master key from this computer?",
    /// on sign out). Refused while it is the only copy.
    RemoveMaster,
    /// The holder adds a bot: picks what its key may ever do and until when, opens a bot offer
    /// for the executor that runs the bot to claim (`bot.createAgent`), and confirms the match
    /// code. The key joins the log with the bot mark and that scope; it never speaks for the person.
    AddBot,
    /// Checks an email address with the platform (`crate::platform`), and attaches the vouch note
    /// the platform's token gives to the identity (`identity.attachNote`). Offered while
    /// `identity.status` says `vouched: false`; the person can skip it.
    CheckEmail,
    /// The holder adds a host (Coasys cloud, or one by its address) as a device: the host's
    /// managed agent claims an offer, the person confirms the match code, and the key log lists the
    /// host's key (AR-05 4.5). Asks for an invite where the host wants one, and for the email
    /// check where the host needs it.
    AddCloudDevice {
        host: crate::cloud::CloudHost,
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
    /// The words are confirmed and the identity is being made: the proof of work the store asks of
    /// a new identity (`bits`, from `identity.powParams`) is solved here, then the identity is
    /// published. Not a last screen: [`StepInput::WaitCreated`] answers with the screen that
    /// follows, once the publish is done.
    Preparing { bits: u8 },
    /// The identity exists, and this computer is its first device. `vouched`: the store keeps a
    /// vouch note for it (`identity.status`); when it does not, the email check is offered.
    IdentityReady {
        did: String,
        #[serde(rename = "keyId")]
        key_id: String,
        vouched: bool,
    },
    /// The email check: type an email address, to get a code at it. `error`: why the last one
    /// did not go.
    EnterEmail { error: Option<String> },
    /// The code the platform sent to `email`. `error`: why the last code was refused.
    EnterEmailCode {
        email: String,
        error: Option<String>,
    },
    /// The store keeps a vouch note for `did` now.
    EmailChecked { did: String },
    /// The host asks for an invite. `error`: why the last one did not work.
    CloudInvite { host: String, error: Option<String> },
    /// Nothing to ask: the window sends `WaitClaim`, and the host is asked to claim the offer.
    CloudJoining { host: String },
    /// The host claimed the offer. Both show this code; the person confirms when they match.
    CloudMatch { code: String, host: String },
    /// The key log lists the host's key. `active`: the host serves the person now; false while it
    /// is still setting up, which the Devices page shows too.
    CloudAdded { host: String, active: bool },
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
        /// Whether "Also replace master key" starts ticked: when the device may hold a copy.
        rotate: bool,
        passphrase: bool,
        error: Option<String>,
    },
    /// Type the 12 words, for `purpose`: `replace`, `restore`, `revoke` (a revoke that also
    /// replaces the master key) or `answer` (a request that asks for that). `error`: why the
    /// words typed last were refused; `position`: the word it names, from 1. The words typed are
    /// never sent back, on this screen or any later one.
    EnterWords {
        purpose: &'static str,
        error: Option<String>,
        position: Option<usize>,
    },
    /// The devices of the identity the words restore, to pick the ones to lock out (`lockOut`
    /// ticked by default for apps). `note`: why they show by key id only, when they do.
    RestoreDevices {
        did: String,
        devices: Vec<RestoreDevice>,
        note: Option<String>,
    },
    /// The master key was replaced (`rotate` published): `index` is the new master's,
    /// `revoked` the keys the same event revoked. `note`: what did not happen yet.
    MasterReplaced {
        index: u32,
        revoked: Vec<String>,
        note: Option<String>,
    },
    /// The master key WAS replaced (`rotate` published: master `index` is current, and every
    /// copy of the one before it stopped working), but this computer could not keep the new one
    /// (`reason`). Not a last screen: [`StepInput::TryAgain`] asks for the 12 words again and
    /// replaces the master key once more, with a key this computer keeps. `note`: what else did
    /// not happen yet.
    MasterNotKept {
        index: u32,
        revoked: Vec<String>,
        reason: String,
        note: Option<String>,
    },
    /// A restore's rotation is published (the identity `did` is restored and `revoked` are locked
    /// out), but this computer is not linked to it yet (`reason`). Not a last screen:
    /// [`StepInput::TryAgain`] links it again, without the words.
    RestoreNotLinked {
        did: String,
        revoked: Vec<String>,
        reason: String,
    },
    /// The identity is back on this computer, which signs as `key_id` and keeps the new master.
    Restored {
        did: String,
        name: String,
        #[serde(rename = "keyId")]
        key_id: String,
        revoked: Vec<String>,
        note: Option<String>,
    },
    /// What removing the master key from this computer does, before it is done.
    RemoveMaster { error: Option<String> },
    /// This computer no longer keeps the master key.
    MasterRemoved,
    /// The key was revoked (`revoke` published).
    Revoked {
        #[serde(rename = "keyId")]
        key_id: String,
        seq: u64,
    },
    /// An identity made here earlier that the store refused for good: why, and the way out —
    /// discard it ([`StepInput::Discard`]) or cancel.
    PendingRefused { did: String, message: String },
    /// What the bot's key may ever do (`read`, `write`, `join`) and for how many days, before the
    /// offer is opened. `error`: why the last choice was refused.
    BotScope { error: Option<String> },
    /// The bot offer, as a string to paste where the bot runs (Settings → Bots on that computer,
    /// or `bot.createAgent`). It works once, until `expires`.
    BotOffer {
        offer: String,
        can: Vec<String>,
        #[serde(rename = "keyExpires")]
        key_expires: u64,
        expires: u64,
    },
    /// The bot's executor claimed the offer: it shows this code too. `name`: what it was called
    /// there.
    BotMatch { code: String, name: Option<String> },
    /// The bot's key is in the log (`add` published) as `key_id`, with the bot mark and its scope.
    /// `note`: what did not happen yet (its name in the record), in words.
    BotAdded {
        seq: u64,
        #[serde(rename = "keyId")]
        key_id: String,
        name: String,
        note: Option<String>,
    },
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
            | Screen::Renamed { .. }
            | Screen::MasterReplaced { .. }
            | Screen::Restored { .. }
            | Screen::MasterRemoved
            | Screen::BotAdded { .. }
            | Screen::EmailChecked { .. }
            | Screen::CloudAdded { .. } => Some(StepOutcome::Done),
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

/// A secret the identity window typed (a word, the 12 words, a passphrase), as a [`StepInput`]
/// carries it: wiped when it is dropped, so an input that is refused, cancelled or never read is
/// wiped too. [`TypedSecret::take`] moves the text into the `Secret` a flow holds, without a copy.
pub struct TypedSecret(Zeroizing<String>);

impl TypedSecret {
    /// The text, moved out: the caller wipes it (a `Secret` does).
    pub fn take(mut self) -> String {
        std::mem::take(&mut *self.0)
    }

    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Moved into the `Secret` a flow takes.
    pub fn into_secret(self) -> Secret<String> {
        Secret::new(self.take())
    }
}

impl From<String> for TypedSecret {
    fn from(text: String) -> Self {
        TypedSecret(Zeroizing::new(text))
    }
}

impl From<&str> for TypedSecret {
    fn from(text: &str) -> Self {
        TypedSecret::from(text.to_string())
    }
}

impl<'de> Deserialize<'de> for TypedSecret {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(TypedSecret::from)
    }
}

/// One input from the identity window.
///
/// Words and passphrases arrive as [`TypedSecret`]s, wiped when dropped, whether the step reads them,
/// refuses them or is cancelled first. The copies before them are not this crate's to wipe: the
/// window's fields, the host's IPC message, the JSON line (which the sidecar reads into a buffer it
/// wipes, `sidecar::serve`), and what serde buffers to find `kind` and to unescape a string that
/// has escapes (the 12 words never do). See `crates/custody/README.md`.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StepInput {
    WordsWritten,
    Words {
        answers: [TypedSecret; 2],
    },
    Passphrase {
        passphrase: TypedSecret,
        confirm: Option<TypedSecret>,
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
        passphrase: Option<TypedSecret>,
    },
    /// The device's new name.
    Name {
        name: String,
    },
    /// Revoke, with the passphrase where the computer needs one; `rotate`: also replace the
    /// master key, which asks for the 12 words next.
    Revoke {
        passphrase: Option<TypedSecret>,
        #[serde(default)]
        rotate: bool,
    },
    /// The 12 words, as typed: one string, the words separated by spaces.
    TwelveWords {
        words: TypedSecret,
    },
    /// The devices to lock out of a restore (key ids of `RestoreDevices`), and this computer's
    /// name.
    #[serde(rename_all = "camelCase")]
    LockOut {
        key_ids: Vec<String>,
        #[serde(default)]
        name: Option<String>,
    },
    /// Yes on `RemoveMaster`.
    Remove,
    /// Forget the identity on `PendingRefused`, which can never be published.
    Discard,
    /// On `MasterNotKept` (type the 12 words again) or `RestoreNotLinked` (link this computer
    /// again).
    TryAgain,
    /// On `BotScope`: the actions the bot's key may ever take, and for how many days.
    BotScope {
        can: Vec<String>,
        days: u32,
    },
    /// On `Preparing`: wait for the identity to be made (resolves with `IdentityReady`, or with
    /// `Failed`).
    WaitCreated,
    /// On `EnterEmail`: the address to send a code to.
    Email {
        email: String,
    },
    /// On `EnterEmailCode`: the code from the email.
    EmailCode {
        code: String,
    },
    /// On `EnterEmailCode`: send a new code to the same address.
    NewCode,
    /// On `EnterEmailCode`: go back to `EnterEmail`, to type another address.
    ChangeEmail,
    /// On `CloudInvite`: the invite link, or its secret alone.
    Invite {
        code: String,
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
            StepInput::Confirm { .. } => "confirm",
            StepInput::Code { .. } => "code",
            StepInput::WaitLink => "wait-link",
            StepInput::WaitJoin => "wait-join",
            StepInput::Accept => "accept",
            StepInput::Answer { .. } => "answer",
            StepInput::Name { .. } => "name",
            StepInput::Revoke { .. } => "revoke",
            StepInput::TwelveWords { .. } => "twelve-words",
            StepInput::LockOut { .. } => "lock-out",
            StepInput::Remove => "remove",
            StepInput::Discard => "discard",
            StepInput::TryAgain => "try-again",
            StepInput::BotScope { .. } => "bot-scope",
            StepInput::WaitCreated => "wait-created",
            StepInput::Email { .. } => "email",
            StepInput::EmailCode { .. } => "email-code",
            StepInput::NewCode => "new-code",
            StepInput::ChangeEmail => "change-email",
            StepInput::Invite { .. } => "invite",
        };
        f.write_str(name)
    }
}

/// What the main window may know: public facts about the identity, never a secret.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustodyPublic {
    pub did: Option<String>,
    /// An identity made on this computer whose publish did not go through yet, by its DID: its
    /// master key and incept are kept here, and it is published again whenever the state is asked
    /// or a step runs. `None` once it is published, when there is none, and while the executor does
    /// not answer (whose it is cannot be told then).
    pub pending: Option<String>,
    pub holds_master: Option<HoldsMaster>,
    pub unlock: &'static str,
    /// Why no identity step can run on this computer, in words a person reads; `None` when they
    /// can. Set when the executor answers `identity.status` with no identity store, or with one it
    /// trusts no key for, so nothing it publishes could take ([`NO_STORE`]); and when the executor
    /// answers but this computer's store cannot keep or read the key that opens what is sent to it
    /// ([`enc_key_unkept`]). `None` while the executor does not answer, since nothing is known
    /// then (a step asks again).
    pub blocked: Option<String>,
    /// The devices the private record names, by key id. Empty before the first record write, or
    /// when the record cannot be read now.
    pub devices: Vec<DeviceName>,
    /// The revoked keys that may still hold a valid master key, from the key log
    /// ([`crate::keylog::revoked_holders`]): the record drops a key's entry when it is revoked, and a
    /// revoke does not replace the master key. Empty when the log cannot be read now.
    pub revoked_holders: Vec<String>,
    /// The requests of other devices waiting in the identity's box.
    pub requests: Vec<RequestView>,
    /// A master key waits in this computer's inbox ("Accept master key").
    pub master_waiting: bool,
    /// The key log lets this computer keep the master key but lists an enc key for it that is not
    /// the one kept here ([`CustodyEncKey`]): lost or replaced. Nothing sealed to this computer
    /// opens any more — no master key it is sent, no device list — and that key cannot be made
    /// again, so the person revokes this computer from a device that holds the master key and
    /// links it again ([`ENC_MISMATCH`]).
    pub enc_mismatch: bool,
    /// Coasys cloud's address ([`crate::cloud::coasys_url`]), for the window's tenant view of it.
    pub cloud_url: String,
}

/// What the person reads when [`CustodyPublic::enc_mismatch`] is set.
pub const ENC_MISMATCH: &str =
    "This computer has lost the key that opens your master key and your device list, so it can \
     no longer receive either. On a device that holds your master key, revoke this computer, then \
     link it again.";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HoldsMaster {
    /// The index the kept item carries (`Vault::master_index`); `None` when it does not say
    /// (an item kept before the index was kept with it).
    pub index: Option<u32>,
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

/// One device on the restore's lock-out list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDevice {
    pub key_id: String,
    /// The record's name; `None` when the record does not name it or could not be read.
    pub name: Option<String>,
    pub kind: Option<DeviceKind>,
    pub lock_out: bool,
}

/// Where the executor's RPC is, and the admin credential for it. Nothing else of the executor: the
/// identity store it uses, and whether it trusts it, are asked of it (`identity.status`).
#[derive(Clone)]
pub struct ExecutorAddress {
    /// `http://127.0.0.1:<port>`
    pub url: String,
    /// The credential custody calls the executor with: the custody credential the executor's custody
    /// channel admits (the sidecar's on Electron, `with_custody_channel`'s on Tauri), never the admin
    /// credential the main window holds.
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

/// Where the main window's state request is answered ([`CustodyHandle::public_state`]).
type PublicReply = oneshot::Sender<CustodyPublic>;

enum Request {
    Start(IdentityStep, oneshot::Sender<Result<Screen, CustodyError>>),
    Step(StepInput, oneshot::Sender<Result<Screen, CustodyError>>),
    Cancel(CancelReply),
    Public(PublicReply),
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
    /// `Joined`, and one whose cancel the executor did not confirm says so ([`cancel_join`]). A
    /// cancel sent while another is still waiting on the executor gets that one's answer
    /// ([`cancel_claim`]).
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

/// The executor, with every call that needs this computer's enc key answered here
/// ([`WithEncKey`] over [`CustodyEncKey`]): the master key waiting, the inbox's kinds, the record
/// key, and the `enc` a claim, a device or an incept names. The executor's device key, which the
/// key is kept for, is asked first.
async fn connect(
    address: &ExecutorAddress,
    vault: &DesktopVault,
) -> Result<ViaExecutor<WithEncKey<WsRpcClient>>, String> {
    let (rpc, device_key) = reach(address).await?;
    with_enc_key(rpc, &device_key, vault)
}

/// What a step says while the executor does not answer.
const STARTING: &str =
    "The identity service on this computer is still starting. Try again in a moment.";

/// The executor's RPC and the device key it reports; [`STARTING`] while it does not answer.
async fn reach(address: &ExecutorAddress) -> Result<(WsRpcClient, String), String> {
    let rpc = WsRpcClient::connect(&address.url, &address.credential)
        .await
        .map_err(|_| STARTING.to_string())?;
    let status: Value = ExecutorRpc::call(&rpc, "identity.status", json!({}))
        .await
        .map_err(|_| STARTING.to_string())?;
    let device_key = status["deviceKey"]
        .as_str()
        .ok_or_else(|| STARTING.to_string())?
        .to_string();
    Ok((rpc, device_key))
}

/// `rpc` behind this computer's enc key for `device_key`, kept in the vault's store; the words of
/// [`enc_key_unkept`] when the store cannot keep or read it.
fn with_enc_key<R: ExecutorRpc>(
    rpc: R,
    device_key: &str,
    vault: &DesktopVault,
) -> Result<ViaExecutor<WithEncKey<R>>, String> {
    let enc = CustodyEncKey::for_device(vault.shared_store(), device_key)
        .map_err(|e| enc_key_unkept(&e))?;
    Ok(ViaExecutor::new(WithEncKey::new(
        rpc,
        Box::new(enc),
        Box::new(SystemClock),
    )))
}

/// What the person reads when this computer's store cannot keep or read its enc key: every step
/// stops there, and the main window says so rather than calling the executor offline.
fn enc_key_unkept(e: &VaultError) -> String {
    format!("This computer could not keep the key that opens your master key: {e}")
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

/// Words that are all on the list and pass the checksum, yet make no master key of the identity.
const NOT_THESE_WORDS: &str = "This recovery phrase doesn't match your identity. Check the \
     spelling and order of each word. Nothing changed.";

/// A step stopped because this computer lost its count of the changes to the master key it keeps
/// (`custody-epochs.json`, or an identity's entry in it, gone from the custody folder). The way
/// back is the words-gated recovery ([`recover_lost_epoch`]): in "Replace master key"
/// ([`rotate_with_words`]) on a linked computer, in "Restore with recovery phrase"
/// ([`restore_on`]) on one not linked yet.
const LOST_EPOCH: &str = "This computer lost track of changes to its master key, so it won't \
     change or remove the key. Your master key is still here. To fix this, go to Settings > \
     Devices and choose Replace master key, or Restore with recovery phrase if this computer \
     isn't linked.";

/// A step stopped because the keyring this computer keeps keys in is locked
/// ([`crate::store::is_keyring_locked`]): it asked to be unlocked and nobody answered in time, or
/// the person dismissed the prompt. The store stops waiting, so custody is never held by a prompt.
const KEYRING_LOCKED_WORDS: &str = "Your keyring is locked. Unlock it when your desktop asks \
     for its password, or in Passwords and Keys, then try again. Nothing was changed.";

/// Why a master key is not removed from this computer.
const ONLY_COPY: &str = "This computer has the only copy of your master key. Send it to another \
     device before you remove it here. Nothing was removed.";

/// Why the 12 words typed were refused, and the word it names (from 1). Names a word by its
/// place only: the word typed, or the list word nearest it, may be one of the 12.
fn words_refused(e: &ad4m_identity_core::words::WordsError) -> (String, Option<usize>) {
    use ad4m_identity_core::words::WordsError;
    match e {
        WordsError::Count(n) => {
            let noun = if *n == 1 { "word" } else { "words" };
            (
                format!("That's {n} {noun}. Enter all 12 words in order."),
                None,
            )
        }
        WordsError::UnknownWord { position, .. } => (
            format!("Word {position} isn't a recovery phrase word. Check its spelling."),
            Some(*position),
        ),
        WordsError::Checksum => (
            "One or more words are wrong. Check the spelling and order of each word.".into(),
            None,
        ),
        WordsError::Index(_) => (
            "Your master key can't be replaced again with this recovery phrase.".into(),
            None,
        ),
    }
}

/// A refusal the flow acts on, read from an executor answer.
///
/// The identity client's `RpcError` carries the executor's `error.data` beside the code and the
/// message, and `refusal` reads only that and the code, never the message's words:
/// `{error: "rate-limited", scope, retryAfter}` on `429`, `{error: "forbidden", reason: "pow"}` on
/// `403`, `{error: "already-vouched"}` and `{error: "no-identity"}` on `409`. An answer without
/// that data is no refusal this flow acts on; it is quoted as the executor says it.
#[derive(Debug, PartialEq, Eq)]
enum Refusal {
    /// `429`: the wait in seconds.
    Wait(u64),
    /// `403 forbidden: "pow"`: the store refused the proof of work sent with a new identity (its
    /// cost went up after the proof was solved, or the proof is wrong). A new proof can pass.
    Proof,
    /// `409`: the store keeps a vouch note for the identity already.
    AlreadyVouched,
    /// `409`: the agent speaks for no identity.
    NoIdentity,
}

fn refusal(e: &RpcError) -> Option<Refusal> {
    let data = e.data.as_ref()?;
    match (e.code, data["error"].as_str()?) {
        (429, "rate-limited") => data["retryAfter"].as_u64().map(Refusal::Wait),
        (403, "forbidden") if data["reason"].as_str() == Some("pow") => Some(Refusal::Proof),
        (409, "already-vouched") => Some(Refusal::AlreadyVouched),
        (409, "no-identity") => Some(Refusal::NoIdentity),
        _ => None,
    }
}

/// The wait in seconds a `429` of the executor names.
fn retry_after(e: &ClientError) -> Option<u64> {
    match e {
        ClientError::Rpc(e) => match refusal(e)? {
            Refusal::Wait(seconds) => Some(seconds),
            _ => None,
        },
        _ => None,
    }
}

/// `seconds` as a person reads a wait: in minutes up to an hour, else in hours, rounded up.
fn a_wait(seconds: u64) -> String {
    let count = |n: u64, unit: &str| {
        if n == 1 {
            format!("1 {unit}")
        } else {
            format!("{n} {unit}s")
        }
    };
    if seconds <= 3600 {
        count(seconds.div_ceil(60).max(1), "minute")
    } else {
        count(seconds.div_ceil(3600), "hour")
    }
}

/// The store refused the proof of work sent with a new identity (`403 forbidden: "pow"`): its
/// cost went up after the proof was solved, or the proof is wrong. A new proof can pass.
fn refused_the_proof(e: &ClientError) -> bool {
    matches!(e, ClientError::Rpc(e) if refusal(e) == Some(Refusal::Proof))
}

/// Words a person reads, for each way a flow stops.
fn failed(e: &ClientError) -> Screen {
    Screen::Failed {
        message: failure_message(e),
    }
}

/// The sentence of `failed`, for a flow that says more around it.
fn failure_message(e: &ClientError) -> String {
    let message = match e {
        e if names_no_store(e) => NO_STORE.into(),
        ClientError::Vault(VaultError::Cancelled) => {
            "The unlock was cancelled. Nothing changed.".into()
        }
        ClientError::Vault(VaultError::NotFound) => {
            "This computer does not keep your master key.".into()
        }
        ClientError::Vault(e) if crate::pending::is_lost_epoch(e) => LOST_EPOCH.into(),
        ClientError::Vault(e) if crate::store::is_keyring_locked(e) => KEYRING_LOCKED_WORDS.into(),
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
        ClientError::NotAKeeper(_) => "That device can't have the master key. Only the app on \
                                       a computer or phone can. Nothing was sent."
            .into(),
        ClientError::Poster(why) => {
            log::warn!("custody: the request does not check out: {why}");
            "This request couldn't be verified. Nothing changed.".into()
        }
        ClientError::NeedsWords => {
            "This also replaces your master key, which needs your recovery phrase.".into()
        }
        // Never the word itself, nor the list word nearest it: either may be one of the 12.
        ClientError::Words(e) => words_refused(e).0,
        ClientError::NotTheseWords(_) => NOT_THESE_WORDS.into(),
        ClientError::LogBusy => "Another device kept changing your key log. Nothing was \
                                 replaced. Try again in a moment."
            .into(),
        ClientError::OnlyCopy => ONLY_COPY.into(),
        ClientError::RecordBusy => {
            "Another device is changing your device list. Try again in a moment.".into()
        }
        ClientError::PowTooCostly(bits) => format!(
            "The identity store asks for more work than this app does to make an identity ({bits} \
             bits; at most {}). Try again later",
            ad4m_identity_client::pow::MAX_POW_BITS
        ),
        e if retry_after(e).is_some() => format!(
            "The identity store has had too many requests. Try again in {}",
            a_wait(retry_after(e).unwrap_or_default())
        ),
        e if refused_the_proof(e) => {
            "The identity store did not accept the proof of work. Try again".into()
        }
        ClientError::Rpc(e) => format!(
            "The identity service on this computer answered: {}",
            e.message
        ),
        other => other.to_string(),
    };
    a_sentence(message)
}

/// `message`, ending as a sentence: the executor's and the vault's own answers are quoted as they
/// come, without a stop, and another sentence may follow (`unfinished`).
fn a_sentence(mut message: String) -> String {
    let trimmed = message.trim_end().len();
    message.truncate(trimmed);
    if !message.ends_with(['.', '!', '?']) {
        message.push('.');
    }
    message
}

/// The custody thread: one step at a time, and the main window's state read beside whatever runs
/// ([`StateReads`]). The reads outlive the flow that took them: one still under way when a step
/// ends is kept here and polled beside the next request, so a stalled read holds no later request,
/// and every state request is answered once its read ends.
async fn serve(vault: DesktopVault, address: ExecutorAddress, mut rx: Rx) {
    let mut reads = StateReads::new(&vault, &address);
    while let Some((step, reply)) = idle(&mut reads, &mut rx).await {
        run_step(step, &mut reads, &mut rx, &mut Some(reply)).await;
    }
    reads.finish().await;
}

/// Runs `step` to its end. The show-code flow takes its state requests into `reads`; every other
/// flow answers its own, and a read a step before it left under way goes on beside it ([`beside`]).
async fn run_step(step: IdentityStep, reads: &mut StateReads<'_>, rx: &mut Rx, reply: &mut Reply) {
    let (vault, address) = (reads.vault, reads.address);
    match step {
        IdentityStep::ShowCode => run_show_code(reads, rx, reply).await,
        IdentityStep::Create => beside(reads, run_create(vault, address, rx, reply)).await,
        IdentityStep::AddDevice => beside(reads, run_link(vault, address, rx, reply, None)).await,
        IdentityStep::AddCloudDevice { host } => {
            beside(reads, run_link(vault, address, rx, reply, Some(&host))).await
        }
        IdentityStep::ScanDevice => beside(reads, run_scan(vault, address, rx, reply)).await,
        IdentityStep::TakeMaster => beside(reads, run_take_master(vault, address, rx, reply)).await,
        IdentityStep::AskMaster => beside(reads, run_ask_master(vault, address, reply)).await,
        IdentityStep::AnswerRequest { id } => {
            beside(reads, run_answer(vault, address, rx, reply, id)).await
        }
        IdentityStep::Rename { key_id } => {
            beside(reads, run_rename(vault, address, rx, reply, key_id)).await
        }
        IdentityStep::Revoke { key_id } => {
            beside(reads, run_revoke(vault, address, rx, reply, key_id)).await
        }
        IdentityStep::ReplaceMaster => {
            beside(reads, run_replace_master(vault, address, rx, reply)).await
        }
        IdentityStep::Restore => beside(reads, run_restore(vault, address, rx, reply)).await,
        IdentityStep::RemoveMaster => {
            beside(reads, run_remove_master(vault, address, rx, reply)).await
        }
        IdentityStep::AddBot => beside(reads, run_add_bot(vault, address, rx, reply)).await,
        IdentityStep::CheckEmail => beside(reads, run_check_email(vault, address, rx, reply)).await,
    }
}

/// Runs `flow` with the reads already under way going on beside it ([`StateReads::drive`]), so
/// their requests are answered as each read ends rather than after the flow.
async fn beside(reads: &mut StateReads<'_>, flow: impl std::future::Future<Output = ()>) {
    tokio::select! {
        () = flow => {}
        never = reads.drive() => match never {},
    }
}

/// The custody thread between steps: the next `Start` and its reply, the state read beside the wait
/// ([`StateReads`]); `None` once the app is gone. A step input or a cancel with no step open is
/// answered at once, never held by a read under way.
async fn idle(
    reads: &mut StateReads<'_>,
    rx: &mut Rx,
) -> Option<(IdentityStep, oneshot::Sender<Result<Screen, CustodyError>>)> {
    loop {
        match reads.recv(rx).await? {
            Request::Start(step, reply) => return Some((step, reply)),
            Request::Step(_, reply) => {
                let _ = reply.send(Err(CustodyError::NoStep));
            }
            Request::Cancel(reply) => {
                let _ = reply.send(None);
            }
            Request::Public(reply) => reads.ask(reply),
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
    let _one = FINISHING.lock().await;
    finish_pending_locked(executor, vault).await
}

/// One publish of a kept incept at a time: a state read left running beside a step and the step
/// (Create, a restore) can both finish it, and two publishes of the same incept would make the
/// store answer the second with a conflict. The later caller finds nothing pending.
static FINISHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn finish_pending_locked<R: ExecutorRpc>(
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
        e if refused_the_proof(e) => None,
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

/// [`finish_pending`] for a state read: skipped while a step is finishing the incept itself, so the
/// read never waits on the step.
async fn finish_pending_quietly<R: ExecutorRpc>(executor: &ViaExecutor<R>, vault: &DesktopVault) {
    let Ok(_one) = FINISHING.try_lock() else {
        return;
    };
    if let Err(e) = finish_pending_locked(executor, vault).await {
        log::warn!("custody: the pending identity is not finished yet: {e}");
    }
}

async fn public_state(vault: &DesktopVault, address: &ExecutorAddress) -> CustodyPublic {
    match reach(address).await {
        Ok((rpc, device_key)) => public_state_reached(rpc, &device_key, vault).await,
        // Not answering: nothing is known, and a step asks again.
        Err(_) => public_state_on::<WithEncKey<WsRpcClient>>(None, vault).await,
    }
}

/// [`public_state`] once the executor answers. A store that cannot keep this computer's enc key
/// is not an executor offline: every step would stop on it, so the person is told why
/// ([`CustodyPublic::blocked`]) in the words a step would show.
async fn public_state_reached<R: ExecutorRpc>(
    rpc: R,
    device_key: &str,
    vault: &DesktopVault,
) -> CustodyPublic {
    match with_enc_key(rpc, device_key, vault) {
        Ok(executor) => public_state_on(Some(&executor), vault).await,
        Err(message) => {
            log::warn!("custody: {message}");
            CustodyPublic {
                blocked: Some(message),
                ..public_state_on::<WithEncKey<R>>(None, vault).await
            }
        }
    }
}

/// [`public_state`] with the executor, when it answers.
async fn public_state_on<R: ExecutorRpc>(
    executor: Option<&ViaExecutor<R>>,
    vault: &DesktopVault,
) -> CustodyPublic {
    let status = match executor {
        Some(executor) => {
            finish_pending_quietly(executor, vault).await;
            executor.status().await.ok()
        }
        None => None,
    };
    let did = status.as_ref().and_then(|s| s.did.clone());
    let own_key = status.as_ref().and_then(|s| s.key_id.clone());
    let blocked = status
        .as_ref()
        .and_then(|s| (!s.store.as_ref().is_some_and(|s| s.trusted)).then(|| NO_STORE.into()));
    // Still kept after the attempt above: made here, and not published yet.
    let pending = status.as_ref().filter(|s| s.did.is_none()).and_then(|s| {
        match own_pending(vault, &s.device_key) {
            Ok(incept) => incept.map(|i| ad4m_identity_core::did_of(&i.scid)),
            Err(e) => {
                log::warn!("custody: the pending identity cannot be read: {e}");
                None
            }
        }
    });
    let mut master_waiting = false;
    let mut devices = Vec::new();
    let mut requests = Vec::new();
    let mut revoked_holders = Vec::new();
    let mut enc_mismatch = false;
    if let (Some(executor), Some(did)) = (executor, did.as_deref()) {
        master_waiting = master_waits(executor).await;
        // Where the operating system unlocks a new item, the master key waiting is taken as the
        // app starts and whenever the main window asks: the keychain's own unlock guards it, as
        // it guards the key made here. A sealed item needs the passphrase, so the person takes
        // it in the identity window ("Accept master key").
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
            let unlocking = vault.unlocking(None);
            match take_master(executor, &unlocking, &RANDOM).await {
                Ok(Some(taken)) => {
                    let taken = complete_take(executor, &unlocking, taken).await;
                    if let Err(e) = &taken.record {
                        log::warn!("custody: the record does not mark this computer yet: {e}");
                    }
                    log::info!("custody: took master #{} of the identity", taken.index);
                    master_waiting = master_waits(executor).await;
                }
                Ok(None) => master_waiting = false,
                Err(e) => log::warn!("custody: the waiting master key was not taken: {e}"),
            }
        }
        refresh_stale(
            executor,
            vault,
            did,
            own_key.as_deref(),
            master_waiting && !os_unlocks,
        )
        .await;
        // A mark still owed after that refresh (a sealed item, whose passphrase only the person
        // gives; or a record write that failed again) is offered as "Take the master key", which
        // makes it ([`repair_mark_on`]).
        if !master_waiting {
            master_waiting = ad4m_identity_core::scid_of(did)
                .is_some_and(|scid| receipt_owed(vault, scid, own_key.as_deref()));
        }
        devices = match record::read(executor, &vault.unlocking(None), did).await {
            Ok(opened) => opened.map(|o| device_names(&o.record)).unwrap_or_default(),
            Err(e) => {
                log::warn!("custody: the device list cannot be read now: {e}");
                Vec::new()
            }
        };
        match executor.events(did).await {
            Ok(events) => {
                revoked_holders = crate::keylog::revoked_holders(&events);
                enc_mismatch = status
                    .as_ref()
                    .is_some_and(|status| enc_lost(&events, status));
            }
            Err(e) => log::warn!("custody: the key log cannot be read now: {e}"),
        }
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
    // The index of the key held, from the item itself (no unlock); unknown for an item that does
    // not carry it.
    let holds_master = sealed.map(|_| HoldsMaster {
        index: did
            .as_deref()
            .and_then(ad4m_identity_core::scid_of)
            .and_then(|scid| vault.master_index(scid).ok().flatten()),
    });
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
        pending,
        holds_master,
        unlock,
        blocked,
        devices,
        revoked_holders,
        requests,
        master_waiting,
        enc_mismatch,
        // Empty when the override is not an address: the window then offers no Coasys cloud view.
        cloud_url: crate::cloud::coasys_url().unwrap_or_default(),
    }
}

/// [`CustodyPublic::enc_mismatch`] for this computer's device key, from the identity's log.
/// `status` is the executor's answer through the adapter, whose `deviceEnc` is the custody enc key.
fn enc_lost(events: &[Event], status: &IdentityStatus) -> bool {
    crate::keylog::enc_mismatch(events, status.key_id.as_deref(), &status.device_enc)
}

/// Whether the log lists another enc key for this computer than the one kept here; false when it
/// cannot be asked.
async fn enc_lost_now<R: ExecutorRpc>(executor: &ViaExecutor<R>) -> bool {
    let Ok(status) = executor.status().await else {
        return false;
    };
    let Some(did) = status.did.as_deref() else {
        return false;
    };
    match executor.events(did).await {
        Ok(events) => enc_lost(&events, &status),
        Err(_) => false,
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

/// Where this computer keeps a master key of `did` that a rotation on another device replaced:
/// takes the current one from the inbox, or forgets the replaced one and asks a holder for the
/// current one ([`refresh_master`]). Only when the log, read fresh, lists a master after the one
/// kept here, so a log read behind can never make it forget a current key. `sealed_waits`: the
/// current key waits in the inbox and needs the passphrase of a sealed item, so "Take the master
/// key" takes it rather than this. And whenever this computer's custody note (`own_key`'s)
/// owes the record its mark, so the mark a take or promote left owed is made from the note.
async fn refresh_stale<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    did: &str,
    own_key: Option<&str>,
    sealed_waits: bool,
) {
    let Some(scid) = ad4m_identity_core::scid_of(did) else {
        return;
    };
    // A key a rotation staged and did not promote (cut off between its publish and the promote,
    // or with its publish still on its way, here or in another app sharing this folder) is
    // handed to `refresh_master` first, whatever the kept index says: it promotes the key when
    // the log's current index is the staged one, leaves it while the staged index is ahead of
    // the log, and discards it only once the log is past it. Nothing here discards a staged key.
    let staged = vault.staged_index(scid).ok().flatten();
    let kept = vault.master_index(scid).ok().flatten();
    // This computer's custody note, when it owes the record something (a take or promote here
    // kept the key and its mark has not landed, or an intent was left open): `refresh_master`
    // marks it or clears it ([`Refreshed::Repaired`]) even while the kept key is current. A
    // release owes nothing, and is never re-marked.
    let owes = own_key.is_some_and(|key_id| {
        matches!(
            vault.unlocking(None).custody_note(scid, key_id),
            Ok(Some(note)) if note.standing() != Standing::Released
        )
    });
    if staged.is_none() {
        // Nothing to bring forward without a kept index that is known: an unknown one is never
        // taken for a replaced key.
        let Some(kept) = kept else {
            return;
        };
        let current = match executor.events(did).await {
            Ok(events) => match ad4m_identity_core::fold(&events) {
                Ok(chain) => chain.state().masters.len().saturating_sub(1),
                Err(e) => return log::warn!("custody: the key log does not fold: {e}"),
            },
            Err(e) => return log::warn!("custody: the key log cannot be read now: {e}"),
        };
        if (kept as usize >= current && !owes) || sealed_waits {
            return;
        }
    }
    let kept = kept.map_or_else(|| "unknown".to_string(), |k| format!("#{k}"));
    match refresh_master(executor, &vault.unlocking(None), did, &CLOCK, &RANDOM).await {
        Ok(Refreshed::Current) => {}
        Ok(Refreshed::Promoted { index, record }) => {
            log::info!("custody: kept master #{index}, which a rotation here had staged");
            if let Err(e) = record {
                log::warn!("custody: the record does not yet say this computer holds it: {e}");
            }
        }
        Ok(Refreshed::Taken(taken)) => {
            log::info!("custody: took master #{} in place of {kept}", taken.index);
            if let Err(e) = &taken.record {
                log::warn!("custody: the record does not mark this computer yet: {e}");
            }
        }
        Ok(Refreshed::Repaired { index, record }) => match record {
            Ok(version) => log::info!(
                "custody: the record now marks this computer holding master #{index} \
                 (version {version}), a mark a take or promote here still owed"
            ),
            Err(e) => log::warn!(
                "custody: the record still does not mark this computer holding master \
                 #{index}; the next refresh tries again: {e}"
            ),
        },
        Ok(Refreshed::Asked(id)) => log::info!(
            "custody: forgot the replaced master {kept}, and asked for the current one ({id})"
        ),
        // The vault cannot tell which master it keeps, or keeps none: nothing forgotten.
        Ok(Refreshed::Unknown) => {
            log::debug!("custody: the kept master's index is unknown; nothing refreshed")
        }
        Err(e) => log::warn!("custody: the master key kept here was not refreshed: {e}"),
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
    let message = failure_message(e);
    if names_no_store(e) {
        return Screen::Failed { message };
    }
    // A message that names when to try again says it once.
    let then = if retry_after(e).is_some() || matches!(e, ClientError::PowTooCostly(_)) {
        "Then the same identity will be finished."
    } else {
        "Try again in a moment: the same identity will be finished."
    };
    Screen::Failed {
        message: format!(
            "Your identity was made on this computer but is not published yet. {message} {then}"
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
    let executor = match connect(address, vault).await {
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
            return answer(reply, Ok(resumed_identity_ready(executor, created).await))
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
                // Each answer wipes itself when this step ends, read or refused.
                let [first, second] = answers;
                match flow.confirm([first.expose(), second.expose()]) {
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

    // The store's cost for a new identity, before anything is kept: a cost this app does not solve
    // ends the step here, with nothing made.
    let bits = match executor.pow_params().await {
        Ok(params) if params.bits > ad4m_identity_client::pow::MAX_POW_BITS => {
            let message = failure_message(&ClientError::PowTooCostly(params.bits));
            return answer(
                reply,
                Ok(Screen::Failed {
                    message: format!("{message} Nothing was made."),
                }),
            );
        }
        Ok(params) => params.bits,
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    };
    // The proof of work runs on this thread and does not yield, which is why custody has a thread
    // of its own: the window and the host stay responsive. Requests that come meanwhile wait.
    answer(reply, Ok(Screen::Preparing { bits }));

    // incept, the executor's co-signature, the vault keeps master #0 and the incept, the proof of
    // work, publish.
    let unlocking = vault.unlocking(passphrase);
    // The record lists this computer from the start, as the one that holds master #0.
    // The create flow names the vault beside master #0 (`Vault::vault_id`) once the identity has
    // its scid; nothing is known of it here.
    let this = this_computer(None, true, None);
    let screen = match flow
        .finish(executor, &unlocking, this, &CLOCK, &RANDOM)
        .await
    {
        Ok(created) => {
            if let Some(Err(e)) = &created.record {
                log::warn!("custody: the record does not list this computer yet: {e}");
            }
            // A new identity is published with a proof and no note, and only `attachNote` turns
            // `vouched` true: there is nothing to ask.
            identity_ready(created, false)
        }
        // Custody came first, so a publish that failed left an identity to finish, not a loss —
        // when the incept kept is this executor's. Another account's is not this step's.
        Err(e) if own_pending(vault, &device_key).ok().flatten().is_some() => unfinished(&e),
        Err(e) => failed(&e),
    };
    give_created(vault, address, rx, reply, screen).await;
}

/// `IdentityReady` for `created`. `vouched` is whether the store keeps a vouch note for it.
fn identity_ready(created: Created, vouched: bool) -> Screen {
    Screen::IdentityReady {
        did: created.did,
        key_id: created.device_key_id,
        vouched,
    }
}

/// `identity_ready` for an identity finished from an earlier run, whose note the executor may
/// already hold: asks it (`false` when it does not say).
async fn resumed_identity_ready<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    created: Created,
) -> Screen {
    let vouched = match executor.status().await {
        Ok(status) => status.vouched,
        Err(e) => {
            log::warn!(
                "custody: whether the new identity is vouched is not known: {}",
                e.message
            );
            false
        }
    };
    identity_ready(created, vouched)
}

/// After `Preparing`: answers `screen`, the create's end, to the window's `WaitCreated`. A cancel
/// that comes while the identity is made cannot stop it, so it is answered with `screen` too and
/// the window shows how the create ended.
async fn give_created(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    screen: Screen,
) {
    loop {
        match next_input_or_cancel(vault, address, rx, reply).await {
            Ok(StepInput::WaitCreated) => return answer(reply, Ok(screen)),
            Ok(_) => answer(reply, Err(CustodyError::WrongInput)),
            Err(Some(cancel)) => {
                let _ = cancel.send(Some(screen));
                return;
            }
            Err(None) => return,
        }
    }
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

/// The holder adds a device by an offer it gives: shown as a link for a server's operator
/// (`host` is `None`), or handed to a host the person chose, whose managed agent claims it
/// ([`follow_cloud`]).
async fn run_link(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    host: Option<&crate::cloud::CloudHost>,
) {
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    let target = match host {
        Some(host) => match connect_host(host).await {
            Ok(target) => Some(target),
            Err(message) => return answer(reply, Ok(Screen::Failed { message })),
        },
        None => None,
    };
    link_on(&executor, target, vault, address, rx, reply).await
}

/// The host a person chose, reached with no credential: `host.info`, `host.join` and
/// `host.joinStatus` are open to anyone and carry their own proof.
struct CloudTarget<H> {
    rpc: H,
    url: String,
    coasys: bool,
}

/// Reaches the host at its address (Coasys cloud's is [`crate::cloud::DEFAULT_CLOUD_URL`]).
async fn connect_host(host: &crate::cloud::CloudHost) -> Result<CloudTarget<WsRpcClient>, String> {
    let url = match host {
        crate::cloud::CloudHost::Coasys => crate::cloud::coasys_url()?,
        address => address.url(None)?,
    };
    let rpc = WsRpcClient::connect(&url, "").await.map_err(|e| {
        log::warn!("custody: the host at {url} did not answer: {e}");
        crate::cloud::UNREACHABLE.to_string()
    })?;
    Ok(CloudTarget {
        rpc,
        url,
        coasys: matches!(host, crate::cloud::CloudHost::Coasys),
    })
}

async fn link_on<R: ExecutorRpc, H: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    target: Option<CloudTarget<H>>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    // The offer names the store the executor uses, and the claiming device publishes through it.
    let store_url = match trusted_store(executor).await {
        Ok(url) => url,
        Err(refused) => return answer(reply, Ok(refused)),
    };
    let (did, own_key) = match holder_of(executor, vault).await {
        Ok(holder) => holder,
        Err(screen) => return answer(reply, Ok(screen)),
    };
    // A host is asked before the person unlocks anything: one that is closed, full or not a host
    // costs no passphrase.
    let cloud = match target {
        Some(target) => match cloud_prelude(target, executor, vault, address, rx, reply).await {
            Some(cloud) => Some(cloud),
            None => return,
        },
        None => None,
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
            unlocking = vault.unlocking(Some(p.into_secret()));
        }
        match LinkFlow::open(
            executor,
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
    if let Some(cloud) = cloud {
        return follow_cloud(
            &flow, executor, &unlocking, &did, cloud, vault, address, rx, reply,
        )
        .await;
    }
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
        executor,
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

/// The host a person adds, asked what anyone may ask before the flow goes on.
struct CloudJoin<H> {
    target: CloudTarget<H>,
    name: String,
    needs_invite: bool,
}

/// Reads what the host says of itself (`host.info`) and runs the email check it needs. `None` when
/// the step ended (a screen said why, or the step was cancelled).
async fn cloud_prelude<R: ExecutorRpc, H: ExecutorRpc>(
    target: CloudTarget<H>,
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Option<CloudJoin<H>> {
    let info = match crate::cloud::info(&target.rpc).await {
        Ok(info) => info,
        Err(message) => {
            answer(reply, Ok(Screen::Failed { message }));
            return None;
        }
    };
    if let Some(message) = info.refuses() {
        answer(reply, Ok(Screen::Failed { message }));
        return None;
    }
    let platform = crate::platform::Platform::from_env();
    match email_check(executor, &platform, vault, address, rx, reply).await? {
        Screen::EmailChecked { .. } => {}
        failed => {
            answer(reply, Ok(failed));
            return None;
        }
    }
    Some(CloudJoin {
        target,
        name: info.name,
        needs_invite: info.signup == crate::cloud::Signup::ByInvite,
    })
}

/// The link to a host after its offer is open: the invite where it is asked, then `host.join`
/// (the host's managed agent claims the offer), the match code, and the holder's confirm, which
/// publishes the add. Ends when the host serves the person, or says it is still setting up.
#[allow(clippy::too_many_arguments)]
async fn follow_cloud<R: ExecutorRpc, H: ExecutorRpc>(
    flow: &LinkFlow<'_, R>,
    executor: &ViaExecutor<R>,
    unlocking: &Unlocking<'_>,
    did: &str,
    cloud: CloudJoin<H>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    use crate::cloud::{self, JoinRefused};
    let host = cloud.name.clone();
    let mut invite: Option<String> = None;
    let ask_invite = |error: Option<&str>| Screen::CloudInvite {
        host: host.clone(),
        error: error.map(str::to_string),
    };
    answer(
        reply,
        Ok(if cloud.needs_invite {
            ask_invite(None)
        } else {
            Screen::CloudJoining { host: host.clone() }
        }),
    );
    let mut claimed: Option<(Claimed, String)> = None;
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        match input {
            StepInput::Invite { code } if cloud.needs_invite && claimed.is_none() => {
                match cloud::invite_secret(&code) {
                    Some(secret) => {
                        invite = Some(secret);
                        answer(reply, Ok(Screen::CloudJoining { host: host.clone() }));
                    }
                    None => answer(
                        reply,
                        Ok(ask_invite(Some(
                            "That is not an invite. Check it and try again.",
                        ))),
                    ),
                }
            }
            StepInput::WaitClaim
                if claimed.is_none() && (invite.is_some() || !cloud.needs_invite) =>
            {
                let joined = match cloud::join(
                    &cloud.target.rpc,
                    did,
                    &flow.offer_string(),
                    invite.as_deref(),
                )
                .await
                {
                    Ok(joined) => joined,
                    Err(e) => match cloud::join_refused(&e) {
                        JoinRefused::Invite => {
                            invite = None;
                            answer(
                                reply,
                                Ok(ask_invite(Some(
                                    "That invite does not work. Ask for a new one.",
                                ))),
                            );
                            continue;
                        }
                        JoinRefused::Stopped(message) => {
                            return answer(reply, Ok(Screen::Failed { message }))
                        }
                    },
                };
                let outcome = tokio::select! {
                    claim = flow.wait_for_claim() => Some(claim),
                    () = wait_cancel(vault, address, rx) => None,
                };
                match outcome {
                    Some(Ok(claim)) => {
                        let screen = Screen::CloudMatch {
                            code: claim.match_code.clone(),
                            host: host.clone(),
                        };
                        claimed = Some((claim, joined.join_handle));
                        answer(reply, Ok(screen));
                    }
                    Some(Err(e)) => return answer(reply, Ok(failed(&e))),
                    None => return answer(reply, Err(CustodyError::NoStep)),
                }
            }
            StepInput::Confirm { name, .. } if claimed.is_some() => {
                let (claim, handle) = claimed.take().expect("checked above");
                let (kind, place) = if cloud.target.coasys {
                    (DeviceKind::CoasysCloud, Place::CoasysCloud)
                } else {
                    (DeviceKind::CommunityHost, Place::CommunityHost)
                };
                let entry = DeviceEntry {
                    name: given_name(name).unwrap_or_else(|| host.clone()),
                    kind,
                    place: Some(place),
                    address: Some(cloud.target.url.clone()),
                    runs_executor: true,
                    holds_master: Holds::No,
                    master_index: None,
                    vault: None,
                    operator: None,
                };
                // A host never keeps the master key: it serves the person with its own agent.
                if let Err(e) = flow.confirm(&claim, entry, false).await {
                    return answer(reply, Ok(failed(&e)));
                }
                retry_quietly(executor, unlocking, did).await;
                let active = cloud::until_active(
                    &cloud.target.rpc,
                    &handle,
                    std::time::Duration::from_secs(2),
                    cloud::ACTIVATION_WAIT,
                )
                .await
                .unwrap_or_else(|why| {
                    log::warn!("custody: the host's join was not followed to its end: {why}");
                    false
                });
                return answer(reply, Ok(Screen::CloudAdded { host, active }));
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    }
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
///
/// Its kind is a guess: ad4m's claim carries a name hint and whether the device may keep the
/// master key, never what the device is. One that may keep it is written as a computer, any other
/// as a server; a phone writes its own entry as a phone app once it reads its devices
/// (`crates/phone-custody`, `PhoneIdentity::devices`).
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
                    master_index: None,
                    vault: None,
                    operator: None,
                };
                let linked = match flow.confirm(&claim, entry, keep_master && app).await {
                    Ok(linked) => linked,
                    Err(e) => return answer(reply, Ok(failed(&e))),
                };
                let mut notes = Vec::new();
                if let (false, Some(own)) = (own_listed, own_key) {
                    let own_entry =
                        this_computer(given_name(this_name), true, kept_index(vault, did));
                    let change = Change::Device {
                        key_id: own.to_string(),
                        entry: own_entry,
                    };
                    if let Err(e) =
                        record::write(executor, unlocking, did, &[change], &RANDOM).await
                    {
                        log::warn!("custody: this computer was not listed in the record: {e}");
                        notes.push(
                            "This computer's name wasn't saved. Rename it in Settings > Devices.",
                        );
                    }
                }
                if let Err(e) = &linked.record {
                    log::warn!("custody: the linked device was not listed in the record: {e}");
                    notes.push("Its name wasn't saved. Rename it in Settings > Devices.");
                }
                if let Some(Err(e)) = &linked.master {
                    log::warn!("custody: the master key was not put in its inbox: {e}");
                    notes.push(
                        "The master key wasn't sent yet. It's sent again the next time this \
                         computer unlocks.",
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

/// This computer's entry in the record: the desktop app, holding the master key or not, with the
/// index of the one it keeps and the id of the vault it keeps it in when both are known (`None`:
/// unknown, or none held — a `true` without them proves no copy). Unnamed, it is
/// [`computer_name`]: the record is read by every device, and "This computer" is only true on this
/// one, whose own Settings say so beside its row.
fn this_computer(name: Option<String>, holds: bool, kept: Option<(u32, VaultId)>) -> DeviceEntry {
    DeviceEntry {
        name: name.unwrap_or_else(|| computer_name(std::env::consts::OS).into()),
        kind: DeviceKind::DesktopApp,
        place: Some(Place::Computer),
        address: None,
        runs_executor: true,
        holds_master: if holds { Holds::Yes } else { Holds::No },
        master_index: kept.filter(|_| holds).map(|(index, _)| index),
        vault: kept.filter(|_| holds).map(|(_, vault)| vault),
        operator: None,
    }
}

/// The name a computer the person did not name goes by on every device: what it is, by the system
/// it runs (`std::env::consts::OS`). Not its host name, which can carry a person's name to devices
/// and screens it was never chosen for.
fn computer_name(os: &str) -> &'static str {
    match os {
        "macos" => "Mac",
        "windows" => "Windows PC",
        "linux" => "Linux computer",
        _ => "Computer",
    }
}

/// The index the vault's master item for `did` carries, with this vault's id for `did`, when it
/// carries one and the id reads: the pair a holding names in the record ([`DeviceEntry::vault`]).
/// Either unknown is `None`, never a fresh guess.
fn kept_index(vault: &DesktopVault, did: &str) -> Option<(u32, VaultId)> {
    let scid = ad4m_identity_core::scid_of(did)?;
    let index = vault.master_index(scid).ok().flatten()?;
    let id = vault.vault_id(scid).ok()?;
    Some((index, id))
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
    let executor = match connect(address, vault).await {
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
            unlocking = vault.unlocking(Some(p.into_secret()));
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
        "That isn't a device code. Copy the whole code from the new device.".to_string()
    })?;
    if now >= device.exp {
        return Err("That code expired. Show a new code on the new device.".into());
    }
    if device.store.trim_end_matches('/') != store_url.trim_end_matches('/') {
        return Err(format!(
            "That device uses a different identity store ({}). Both devices need the same one.",
            device.store
        ));
    }
    Ok(device)
}

// ─── show my code (the new device's side) ────────────────────────────────────────

/// The new device shows its code; a holder scans it, the executor claims the ticket the holder
/// put for it (`link-ticket`), the person compares the match code, and the device follows the
/// claim until the holder confirms. The main window's state is read beside it into `reads`, which
/// the service keeps polling once the flow ends.
async fn run_show_code(reads: &mut StateReads<'_>, rx: &mut Rx, reply: &mut Reply) {
    let executor = match connect(reads.address, reads.vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    // Subscribed before the code exists, so a claim made at once is not missed.
    let events = match executor
        .rpc()
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
    show_code_on(&executor, events, reads, rx, reply).await
}

/// [`run_show_code`] once the executor answers and its `link-ticket` events are watched.
async fn show_code_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    mut events: broadcast::Receiver<Value>,
    reads: &mut StateReads<'_>,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    if let Err(refused) = trusted_store(executor).await {
        return answer(reply, Ok(refused));
    }
    match executor.status().await {
        Ok(status) => {
            if status.did.is_some() {
                return answer(
                    reply,
                    Ok(Screen::Failed {
                        message: "This computer already has an identity, so it can't link to \
                                  another."
                            .into(),
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
                message: "Couldn't make a code. Try again.".into(),
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

    // The main window's state is read beside the steps, never in their way: a slow read holds
    // neither a cancel nor the claim's deadline. A read still under way when the step's own
    // answer went out stays in `reads`, which the service goes on polling beside what comes next.
    follow_code(executor, &mut events, code, expires, reads, rx, reply).await;
}

/// [`show_code_on`] once the code is shown: the window's steps until the link ends or the window
/// cancels. Any cancel ends the code `device` (its ticket read and every claim from it) and the
/// claim seen here ([`cancel_claim`]).
async fn follow_code<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    events: &mut broadcast::Receiver<Value>,
    device: &str,
    expires: u64,
    reads: &mut StateReads<'_>,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let mut claim: Option<Claim> = None;
    loop {
        let input = match next_input_beside(reads, rx, reply).await {
            Ok(input) => input,
            Err(cancel) => {
                // A ticket already in before the window waited for it is ended with the cancel.
                let ready = match claim {
                    Some(_) => None,
                    None => ticket_ready(events).map(Claim::from_ticket),
                };
                return cancel_claim(
                    executor,
                    device,
                    claim.as_ref().or(ready.as_ref()),
                    Cancelled {
                        cancel,
                        ..Default::default()
                    },
                    reads,
                    rx,
                    reply,
                )
                .await;
            }
        };
        match input {
            StepInput::WaitLink if claim.is_none() => {
                let wait = Duration::from_secs(expires.saturating_sub(CLOCK.now()));
                // A ticket in beside a cancel is taken first, so the cancel ends its claim. The
                // state requests taken meanwhile stay with `reads`, whichever side wins.
                let outcome = tokio::select! {
                    biased;
                    claimed = tokio::time::timeout(wait, next_ticket(events)) => Ok(claimed),
                    cancel = next_cancel_beside(reads, rx) => Err(cancel),
                };
                match outcome {
                    Err(cancel) => {
                        // A ticket that came in as the cancel was taken is ended with it.
                        let claim = ticket_ready(events).map(Claim::from_ticket);
                        return cancel_claim(
                            executor,
                            device,
                            claim.as_ref(),
                            Cancelled {
                                cancel,
                                ..Default::default()
                            },
                            reads,
                            rx,
                            reply,
                        )
                        .await;
                    }
                    Ok(Err(_)) => {
                        return answer(
                            reply,
                            Ok(Screen::Failed {
                                message: "The code expired. Show a new code to try again.".into(),
                            }),
                        )
                    }
                    Ok(Ok(None)) => {
                        return answer(
                            reply,
                            Ok(Screen::Failed {
                                message: "The app stopped responding. Try again in a moment."
                                    .into(),
                            }),
                        )
                    }
                    Ok(Ok(Some(claimed))) => {
                        let claimed = Claim::from_ticket(claimed);
                        answer(reply, Ok(claimed.screen()));
                        claim = Some(claimed);
                    }
                }
            }
            StepInput::WaitJoin if claim.is_some() => {
                let claim = claim.as_mut().expect("checked above");
                match follow_claim(executor, claim, reads, rx, reply).await {
                    Err(cancel) => {
                        return cancel_claim(
                            executor,
                            device,
                            Some(claim),
                            cancel,
                            reads,
                            rx,
                            reply,
                        )
                        .await
                    }
                    // The other device confirmed; the person has yet to accept here.
                    Ok(screen @ Screen::DeviceMatch { .. }) => answer(reply, Ok(screen)),
                    Ok(screen) => return answer(reply, Ok(screen)),
                }
            }
            StepInput::Accept if claim.as_ref().is_some_and(Claim::awaits_accept) => {
                let claim = claim.as_mut().expect("checked above");
                match accept_or_cancel(executor, claim, reads, rx).await {
                    Err(cancel) => {
                        return cancel_claim(
                            executor,
                            device,
                            Some(claim),
                            Cancelled {
                                cancel,
                                waiting: None,
                            },
                            reads,
                            rx,
                            reply,
                        )
                        .await
                    }
                    Ok(Err(screen)) => return answer(reply, Ok(screen)),
                    Ok(Ok(())) => {}
                }
                let screen = match follow_claim(executor, claim, reads, rx, reply).await {
                    Err(cancel) => {
                        return cancel_claim(
                            executor,
                            device,
                            Some(claim),
                            cancel,
                            reads,
                            rx,
                            reply,
                        )
                        .await
                    }
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

    /// The claim `ticket` made, from now.
    fn from_ticket(ticket: TicketClaimed) -> Claim {
        Claim {
            offer_id: ticket.offer_id,
            did: ticket.did,
            code: ticket.match_code,
            needs_accept: ticket.needs_accept,
            // The offer lives at most `OFFER_TTL_S` from its claim, and the holder's confirm may
            // land in the store's grace after it.
            deadline: CLOCK.now() + OFFER_TTL_S + CONFIRM_GRACE_S,
            accepted: false,
            confirmed: false,
        }
    }
}

/// The next `link-ticket` event; `None` once the connection closed.
async fn next_ticket(events: &mut broadcast::Receiver<Value>) -> Option<TicketClaimed> {
    loop {
        match events.recv().await {
            Ok(event) => {
                if let Some(ticket) = ticket_of(&event) {
                    return Some(ticket);
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return None,
        }
    }
}

/// A `link-ticket` event already received, without waiting for one.
fn ticket_ready(events: &mut broadcast::Receiver<Value>) -> Option<TicketClaimed> {
    loop {
        match events.try_recv() {
            Ok(event) => {
                if let Some(ticket) = ticket_of(&event) {
                    return Some(ticket);
                }
            }
            Err(broadcast::error::TryRecvError::Lagged(_)) => {}
            Err(_) => return None,
        }
    }
}

/// The ticket `event` is, if it is a `link-ticket` with its fields.
fn ticket_of(event: &Value) -> Option<TicketClaimed> {
    if event["type"] != "link-ticket" {
        return None;
    }
    let text = |key: &str| event[key].as_str().map(str::to_string);
    match (text("did"), text("offerId"), text("matchCode")) {
        (Some(did), Some(offer_id), Some(match_code)) => Some(TicketClaimed {
            did,
            offer_id,
            match_code,
            needs_accept: event["needsAccept"].as_bool().unwrap_or(false),
        }),
        _ => {
            log::warn!("custody: a link-ticket event without its fields");
            None
        }
    }
}

/// Follows this executor's claim (`identity.joinStatus`) every [`JOIN_POLL`] until the holder
/// confirms it (`Joined`), the offer ends, or the claim's deadline passes — each call and each wait
/// cut off there. While it waits it answers the window: a cancel ends it (`Err`, with the cancel's
/// reply for [`cancel_claim`]), and an [`StepInput::Accept`] accepts the identity, answers the
/// waiting request with the accepted `DeviceMatch` and becomes the request this answers. A claim
/// the holder confirmed but the person has not accepted (`awaiting-accept`) answers `DeviceMatch`
/// once, so the window asks. The main window's state is read beside it ([`StateReads`]), so a slow
/// read holds neither a cancel nor the deadline.
async fn follow_claim<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    claim: &mut Claim,
    reads: &mut StateReads<'_>,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Result<Screen, Cancelled> {
    let closed = claim_closed;
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
            request = reads.recv(rx) => {
                match request {
                    None => return Err(Cancelled::default()),
                    Some(Request::Cancel(r)) => {
                        return Err(Cancelled {
                            cancel: Some(r),
                            ..Default::default()
                        })
                    }
                    Some(Request::Public(r)) => reads.ask(r),
                    Some(Request::Start(_, r)) => {
                        let _ = r.send(Err(CustodyError::Busy));
                    }
                    Some(Request::Step(StepInput::Accept, r)) if claim.awaits_accept() => {
                        match accept_or_cancel(executor, claim, reads, rx).await {
                            // The wait and the accept are both cut short: the cancel answers both.
                            Err(cancel) => {
                                let waiting = reply.replace(r);
                                return Err(Cancelled { cancel, waiting });
                            }
                            Ok(Err(screen)) => {
                                answer(reply, Ok(screen.clone()));
                                *reply = Some(r);
                                return Ok(screen);
                            }
                            Ok(Ok(())) => {}
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
                        message: "The link was confirmed, but this computer isn't in your key \
                                  log. Show a new code to try again."
                            .into(),
                    },
                })
            }
            other => {
                log::warn!(
                    "custody: the link ended unconfirmed ({})",
                    other.unwrap_or("unknown")
                );
                return Ok(Screen::Failed {
                    message: "The link wasn't confirmed. Show a new code to try again.".into(),
                });
            }
        }
        next_poll = tokio::time::Instant::now()
            + JOIN_POLL.min(Duration::from_secs(
                claim.deadline.saturating_sub(CLOCK.now()),
            ));
    }
}

/// The person accepts the identity of `offer_id` here: the executor may record it as its operator
/// once the holder confirms. `identity.acceptJoin` `{ offerId }` → `{ accepted: true }` is new in
/// coasys/ad4m#1635 and not in the client this crate pins yet, so it is called by name.
async fn accept_join<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    offer_id: &str,
) -> Result<(), Screen> {
    match executor
        .rpc()
        .call("identity.acceptJoin", json!({ "offerId": offer_id }))
        .await
    {
        Ok(_) => Ok(()),
        Err(e) if e.code == 409 && e.message.starts_with("cancelled") => Err(cancelled_here()),
        Err(e) if e.code == 404 => Err(Screen::Failed {
            message: "This link has closed. Show a new code to try again.".into(),
        }),
        Err(e) => Err(failed(&ClientError::Rpc(e))),
    }
}

/// [`accept_join`] while the window can still cancel: the accept is cut off at the claim's
/// deadline, and a cancel that arrives meanwhile ends the wait (`Err`, with the cancel's reply for
/// [`cancel_claim`], which ends the executor's claim before it answers). The main window's state is
/// read beside the accept ([`StateReads`]): its lookup is several calls to the executor, which
/// would otherwise hold a cancel past the claim's deadline. Anything else is refused. `Ok` holds
/// what the accept came to; accepted, the claim says so.
async fn accept_or_cancel<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    claim: &mut Claim,
    reads: &mut StateReads<'_>,
    rx: &mut Rx,
) -> Result<Result<(), Screen>, Option<CancelReply>> {
    let offer_id = claim.offer_id.clone();
    let left = Duration::from_secs(claim.deadline.saturating_sub(CLOCK.now()));
    let accepting = tokio::time::timeout(left, accept_join(executor, &offer_id));
    tokio::pin!(accepting);
    loop {
        tokio::select! {
            accepted = &mut accepting => {
                return Ok(match accepted {
                    Ok(Ok(())) => {
                        claim.accepted = true;
                        Ok(())
                    }
                    Ok(Err(screen)) => Err(screen),
                    Err(_) => Err(claim_closed()),
                });
            }
            request = reads.recv(rx) => match request {
                None => return Err(None),
                Some(Request::Cancel(r)) => return Err(Some(r)),
                Some(Request::Public(r)) => reads.ask(r),
                Some(Request::Start(_, r) | Request::Step(_, r)) => {
                    let _ = r.send(Err(CustodyError::Busy));
                }
            },
        }
    }
}

/// What a claim the holder did not confirm before its deadline ends with.
fn claim_closed() -> Screen {
    Screen::Failed {
        message: "The other device didn't confirm in time. Show a new code to try again.".into(),
    }
}

/// Ends this executor's claim of `offer_id` when the person cancels, so a confirm that lands later
/// does not join this computer: the fallback of [`end_code`] when the code's own end did not
/// cancel the claim seen here. `identity.cancelJoin` `{ offerId }` → `{ cancelled: true }` is new
/// in coasys/ad4m#1635, called by name until the pinned client has it. `None` once the executor
/// confirms the claim ended (or was cancelled already, 409 `cancelled`); else the screen to show
/// instead of a cancel. A claim that already bound (409 `already-joined`) is not undone, so this
/// computer did join. Any other answer, or none by `deadline` (an executor without `cancelJoin`
/// keeps the claim until the offer expires), leaves the claim standing: a confirm may still join
/// this computer, and the screen says so. The join's lookup is cut off at `deadline` too: the
/// custody thread answers nothing else meanwhile.
async fn cancel_join<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    offer_id: &str,
    deadline: tokio::time::Instant,
) -> Option<Screen> {
    let cancelled = tokio::time::timeout_at(
        deadline,
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
            Some(already_joined(executor, offer_id, deadline).await)
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

/// Ends the shown code `device` when the person cancels, so neither a ticket read later nor a claim
/// already made joins this computer. `identity.endPrepared` `{ device }` (new in coasys/ad4m#1635,
/// called by name until the pinned client has it) stops the code's ticket read, waits for a ticket
/// it is taking, and cancels every claim the read made: `{ state: "ended", cancelled: [offerId] }`,
/// or `{ state: "already-joined", offerId, did }` when one had bound. `None` once the code ended
/// (the window closes as any cancel), with `claim`, the one seen here, among the cancelled or then
/// ended by [`cancel_join`]. An already joined claim shows the join ([`already_joined`]). An
/// executor that refuses the call (one without it, or restarted since the code was made) leaves the
/// claim seen here to [`cancel_join`]; with none seen, the code may still link: the cancel says it
/// was not confirmed. All of it is cut off at [`CANCEL_WAIT`].
async fn end_code<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    device: &str,
    claim: Option<&Claim>,
) -> Option<Screen> {
    let deadline = tokio::time::Instant::now() + CANCEL_WAIT;
    let ended = tokio::time::timeout_at(
        deadline,
        executor
            .rpc()
            .call("identity.endPrepared", json!({ "device": device })),
    )
    .await;
    let answer = match ended {
        Ok(Ok(answer)) => answer,
        Ok(Err(e)) => {
            log::warn!("custody: the code was not ended: {e}");
            return match claim {
                Some(claim) => cancel_join(executor, &claim.offer_id, deadline).await,
                None => Some(cancel_unconfirmed()),
            };
        }
        Err(_) => {
            log::warn!("custody: the executor did not answer the end of the code");
            return Some(cancel_unconfirmed());
        }
    };
    match answer["state"].as_str() {
        Some("ended") => {
            let cancelled = |offer_id: &str| {
                answer["cancelled"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(offer_id)))
            };
            match claim {
                Some(claim) if !cancelled(&claim.offer_id) => {
                    cancel_join(executor, &claim.offer_id, deadline).await
                }
                _ => None,
            }
        }
        Some("already-joined") => {
            let offer_id = answer["offerId"]
                .as_str()
                .or(claim.map(|c| c.offer_id.as_str()));
            log::info!("custody: a claim of the code had already joined; not cancelled");
            Some(match offer_id {
                Some(offer_id) => already_joined(executor, offer_id, deadline).await,
                None => Screen::Failed {
                    message: ALREADY_JOINED.into(),
                },
            })
        }
        _ => {
            log::warn!("custody: the end of the code answered {answer}");
            match claim {
                Some(claim) => cancel_join(executor, &claim.offer_id, deadline).await,
                None => Some(cancel_unconfirmed()),
            }
        }
    }
}

/// How long a cancel waits for the executor to end the claim before saying it could not.
const CANCEL_WAIT: Duration = Duration::from_secs(10);

/// Ends the code `device` and `claim` when the window cancels the step, before the cancel is
/// answered, so the window closes only once the executor confirmed it ([`end_code`]). The cancel
/// and a request still waiting on the claim are answered alike: `None`/`NoStep` once it ended, else
/// the screen to show. A claim whose `link-ticket` is still on the way is ended with the code, so
/// a cancel with no claim seen here closes the window too. A cancel that arrives while the executor is
/// asked, or is queued when the answer is known (with a claim or without), is the same cancel and
/// gets the same answer: answered later by the idle service, its `None` would close a window that
/// should show the join or the warning. The main window's state is read beside the cancel
/// ([`StateReads`]), and a read still under way once the cancel is answered stays there for the
/// service: its lookup is several calls to the executor, which would otherwise hold the cancel
/// past [`CANCEL_WAIT`].
async fn cancel_claim<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    device: &str,
    claim: Option<&Claim>,
    cancelled: Cancelled,
    reads: &mut StateReads<'_>,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let Cancelled {
        cancel,
        mut waiting,
    } = cancelled;
    let mut cancels: Vec<CancelReply> = cancel.into_iter().collect();
    let mut taken = |request, reads: &mut StateReads<'_>| match request {
        Request::Cancel(r) => cancels.push(r),
        Request::Public(r) => reads.ask(r),
        Request::Start(_, r) | Request::Step(_, r) => {
            let _ = r.send(Err(CustodyError::Busy));
        }
    };
    let ending = end_code(executor, device, claim);
    tokio::pin!(ending);
    let instead = loop {
        tokio::select! {
            instead = &mut ending => break instead,
            Some(request) = reads.recv(rx) => taken(request, reads),
        }
    };
    // Requests queued by the time the cancel is decided are this cancel's too, with or without a
    // claim: a second cancel left to the idle service would close the window over the answer.
    while let Ok(request) = rx.try_recv() {
        taken(request, reads);
    }
    answer(reply, instead.clone().ok_or(CustodyError::NoStep));
    answer(&mut waiting, instead.clone().ok_or(CustodyError::NoStep));
    for cancel in cancels {
        let _ = cancel.send(instead.clone());
    }
}

/// The main window's state requests, read beside whatever the service does: one read of the state
/// at a time answers every request that came before it started, and the next answers those that
/// came while it ran. A wait that selects on [`StateReads::recv`] keeps the read going; the read
/// lives here, not in the wait, so a wait that loses its select drops no request and no read part
/// way. The service owns it across steps ([`serve`]): a read a flow left under way when its step
/// was answered goes on beside the next request ([`idle`]) or the next flow ([`beside`]), so it
/// never holds them, and [`StateReads::finish`] answers whatever is left once the app is gone.
struct StateReads<'a> {
    vault: &'a DesktopVault,
    address: &'a ExecutorAddress,
    /// The read under way and the requests it answers.
    reading: Option<Reading<'a>>,
    /// Requests that came while a read was under way: the next read answers them.
    queued: Vec<PublicReply>,
}

type Reading<'a> = (
    std::pin::Pin<Box<dyn std::future::Future<Output = CustodyPublic> + 'a>>,
    Vec<PublicReply>,
);

impl<'a> StateReads<'a> {
    fn new(vault: &'a DesktopVault, address: &'a ExecutorAddress) -> Self {
        StateReads {
            vault,
            address,
            reading: None,
            queued: Vec::new(),
        }
    }

    /// Takes a state request: read now when no read is under way, else by the next.
    fn ask(&mut self, r: PublicReply) {
        self.queued.push(r);
        self.start();
    }

    fn start(&mut self) {
        if self.reading.is_none() && !self.queued.is_empty() {
            let read = Box::pin(public_state(self.vault, self.address));
            self.reading = Some((read, std::mem::take(&mut self.queued)));
        }
    }

    /// Answers the read under way once it ends, and starts the next; never ends with none under
    /// way. Safe to drop part way: the read stays here.
    async fn answer_one(&mut self) {
        let Some((read, _)) = self.reading.as_mut() else {
            return std::future::pending().await;
        };
        let state = read.await;
        if let Some((_, waiting)) = self.reading.take() {
            for r in waiting {
                let _ = r.send(state.clone());
            }
        }
        self.start();
    }

    /// The window's next request, the state read going on beside the wait. A state request is
    /// taken here and never returned. Safe to drop part way, as `rx.recv` is.
    async fn recv(&mut self, rx: &mut Rx) -> Option<Request> {
        loop {
            tokio::select! {
                request = rx.recv() => match request {
                    Some(Request::Public(r)) => self.ask(r),
                    other => return other,
                },
                () = self.answer_one() => {}
            }
        }
    }

    /// Answers every request taken, the read under way finished rather than dropped: once the app
    /// is gone, so no state request is left unanswered.
    async fn finish(&mut self) {
        while self.reading.is_some() {
            self.answer_one().await;
        }
    }

    /// Answers every read under way and starts each next one, forever: beside a flow that answers
    /// its own state requests, so the reads a step before it left are not held until it ends.
    async fn drive(&mut self) -> std::convert::Infallible {
        loop {
            self.answer_one().await;
        }
    }
}

/// [`next_input_or_cancel`] with the state read beside the wait ([`StateReads`]).
async fn next_input_beside(
    reads: &mut StateReads<'_>,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Result<StepInput, Option<CancelReply>> {
    loop {
        match reads.recv(rx).await {
            None => return Err(None),
            Some(Request::Step(input, r)) => {
                *reply = Some(r);
                return Ok(input);
            }
            Some(Request::Cancel(r)) => return Err(Some(r)),
            Some(Request::Start(_, r)) => {
                let _ = r.send(Err(CustodyError::Busy));
            }
            Some(Request::Public(r)) => reads.ask(r),
        }
    }
}

/// [`next_cancel`] with the state read beside the wait ([`StateReads`]): a wait that loses its
/// select drops no state request.
async fn next_cancel_beside(reads: &mut StateReads<'_>, rx: &mut Rx) -> Option<CancelReply> {
    loop {
        match reads.recv(rx).await {
            None => return None,
            Some(Request::Cancel(r)) => return Some(r),
            Some(Request::Public(r)) => reads.ask(r),
            Some(Request::Start(_, r) | Request::Step(_, r)) => {
                let _ = r.send(Err(CustodyError::Busy));
            }
        }
    }
}

/// A cancel of a claim, for [`cancel_claim`]: the cancel's own reply (`None` once the window
/// closed), and a request it cut short beside the step's own (the wait for the join an accept
/// arrived beside), answered the same.
#[derive(Default)]
struct Cancelled {
    cancel: Option<CancelReply>,
    waiting: Reply,
}

/// What a cancel that came too late shows: `Joined`, from the claim's `identity.joinStatus`, or in
/// words when that does not name the key this computer joined as, or does not answer by `deadline`.
async fn already_joined<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    offer_id: &str,
    deadline: tokio::time::Instant,
) -> Screen {
    let status = tokio::time::timeout_at(
        deadline,
        executor
            .rpc()
            .call("identity.joinStatus", json!({ "offerId": offer_id })),
    )
    .await;
    match &status {
        Ok(Ok(join)) => {
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
        Ok(Err(_)) => {}
        Err(_) => log::warn!("custody: the executor did not say how offer {offer_id} joined"),
    }
    Screen::Failed {
        message: ALREADY_JOINED.into(),
    }
}

/// A cancel that reached the executor after this computer joined, when the join's key is unknown.
const ALREADY_JOINED: &str =
    "This computer was already linked when you cancelled, so it stays linked.";

/// A cancel the executor did not confirm: the claim may stand, and a confirm still join.
fn cancel_unconfirmed() -> Screen {
    Screen::Failed {
        message: CANCEL_UNCONFIRMED.into(),
    }
}

const CANCEL_UNCONFIRMED: &str =
    "The cancel wasn't confirmed. This computer is still linked if your other device \
     confirms.";

/// The claim was cancelled on this computer (`identity.acceptJoin` 409 `cancelled`, or a
/// `cancelled` `identity.joinStatus`).
fn cancelled_here() -> Screen {
    Screen::Failed {
        message: "This link was cancelled. Show a new code to try again.".into(),
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
                let p = p.into_secret();
                let confirm = confirm
                    .as_ref()
                    .map(TypedSecret::expose)
                    .unwrap_or_default();
                match seal::check_new(p.expose(), confirm) {
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

/// A take whose `holdsMaster` write was refused because the record's recovery key waits for the
/// new master's attestation ([`Taken::record_pending`]): the master just taken signs the mark
/// itself, re-attesting the recovery key ([`complete_pending_mark`], one more unlock for
/// [`MasterUse::Record`]). Completed here, at once, rather than left to the next
/// `refresh_master` that repairs it from this computer's custody note
/// ([`Refreshed::Repaired`]), so the person sees the record list this computer holding the key
/// now. As `refresh_master` completes its own take; any other take is answered as it is.
async fn complete_take<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &dyn Vault,
    mut taken: Taken,
) -> Taken {
    if taken.record_pending {
        taken.record = complete_pending_mark(executor, vault, &taken.did, &CLOCK, &RANDOM).await;
        taken.record_pending = taken.record.is_err();
    }
    taken
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
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    take_master_on(&executor, vault, address, rx, reply).await
}

const NO_MASTER_WAITING: &str = "No master key was sent to this computer. Ask for it, then \
     send it from a device that has it.";

/// [`run_take_master`] once the executor answers.
async fn take_master_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let status = match executor.status().await {
        Ok(status) => status,
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    };
    let Some(did) = status.did.clone() else {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: "This computer isn't linked yet.".into(),
            }),
        );
    };
    if !master_waits(executor).await {
        // A key sealed to an enc key this computer no longer keeps never shows as waiting, and no
        // mark repair helps a computer that cannot open its record.
        if enc_lost_now(executor).await {
            return answer(
                reply,
                Ok(Screen::Failed {
                    message: ENC_MISMATCH.into(),
                }),
            );
        }
        return repair_mark_on(executor, vault, &status, &did, address, rx, reply).await;
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
            unlocking = vault.unlocking(Some(p.into_secret()));
        }
        let taken = match take_master(executor, &unlocking, &RANDOM).await {
            Ok(Some(taken)) => Ok(Some(complete_take(executor, &unlocking, taken).await)),
            other => other,
        };
        let screen = match taken {
            Ok(Some(taken)) => Screen::MasterTaken {
                note: taken.record.err().map(not_listed_yet),
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

/// Whether this computer owes the record its mark for the master key it keeps: its custody note
/// (`own_key`'s) is a receipt for the index the vault keeps ([`CustodyNote::landed`]), so a take
/// or promote here kept the key and its record write was cancelled or failed. No unlock.
fn receipt_owed(vault: &DesktopVault, scid: &str, own_key: Option<&str>) -> bool {
    let Some(key_id) = own_key else {
        return false;
    };
    let unlocking = vault.unlocking(None);
    match unlocking.custody_note(scid, key_id) {
        Ok(Some(note)) => note.landed(&unlocking, scid).unwrap_or_else(|e| {
            log::warn!("custody: cannot tell whether the custody note has landed: {e}");
            false
        }),
        Ok(None) => false,
        Err(e) => {
            log::warn!("custody: the custody note cannot be read: {e}");
            false
        }
    }
}

/// "Take the master key" with no master key waiting: the mark this computer still owes the
/// record for the key it keeps ([`receipt_owed`]) is made now ([`refresh_master`]), the click
/// being the consent its unlock needs. A sealed item asks for its passphrase first, which the
/// refresh that runs as the app starts ([`refresh_stale`]) cannot. Nothing owed:
/// [`NO_MASTER_WAITING`].
#[allow(clippy::too_many_arguments)]
async fn repair_mark_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    status: &IdentityStatus,
    did: &str,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let owed = ad4m_identity_core::scid_of(did)
        .filter(|scid| receipt_owed(vault, scid, status.key_id.as_deref()));
    let Some(scid) = owed else {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: NO_MASTER_WAITING.into(),
            }),
        );
    };
    let sealed = match held_sealed(vault, scid) {
        Ok(sealed) => sealed == Some(true),
        Err(e) => return answer(reply, Ok(failed(&ClientError::Vault(e)))),
    };
    if sealed {
        answer(reply, Ok(Screen::EnterPassphrase { error: None }));
    }
    let mut unlocking = vault.unlocking(None);
    loop {
        if sealed {
            let Some(input) = next_input(vault, address, rx, reply).await else {
                return;
            };
            let StepInput::Passphrase { passphrase: p, .. } = input else {
                answer(reply, Err(CustodyError::WrongInput));
                continue;
            };
            unlocking = vault.unlocking(Some(p.into_secret()));
        }
        let screen = match refresh_master(executor, &unlocking, did, &CLOCK, &RANDOM).await {
            // The mark is signed by the master, opened for it: a wrong passphrase leaves the
            // mark owed, and is asked again.
            Ok(
                Refreshed::Repaired {
                    record: Err(ClientError::Vault(VaultError::Cancelled)),
                    ..
                }
                | Refreshed::Promoted {
                    record: Err(ClientError::Vault(VaultError::Cancelled)),
                    ..
                },
            )
            | Err(ClientError::Vault(VaultError::Cancelled))
                if sealed =>
            {
                answer(reply, Ok(wrong_passphrase()));
                continue;
            }
            Ok(Refreshed::Repaired { record, .. } | Refreshed::Promoted { record, .. }) => {
                Screen::MasterTaken {
                    did: did.to_string(),
                    note: record.err().map(not_listed_yet),
                }
            }
            Ok(Refreshed::Taken(taken)) => Screen::MasterTaken {
                did: taken.did,
                note: taken.record.err().map(not_listed_yet),
            },
            Ok(Refreshed::Asked(id)) => Screen::Asked {
                key_id: status.key_id.clone().unwrap_or_default(),
                fingerprint: crate::keylog::fingerprint(&status.device_key),
                code: ad4m_identity_core::link::match_code(scid, &id, &status.device_key),
            },
            Ok(Refreshed::Current | Refreshed::Unknown) => Screen::Failed {
                message: NO_MASTER_WAITING.into(),
            },
            Err(e) => failed(&e),
        };
        return answer(reply, Ok(screen));
    }
}

/// The note of a key kept here whose record write failed: the record is marked later.
fn not_listed_yet(e: ClientError) -> String {
    log::warn!("custody: the record does not mark this computer yet: {e}");
    "Your device list shows this after its next change.".to_string()
}

/// A linked app without the master key asks the identity's other devices for it: a
/// `send-master` request in the identity's box, which a holder answers.
async fn run_ask_master(vault: &DesktopVault, address: &ExecutorAddress, reply: &mut Reply) {
    let executor = match connect(address, vault).await {
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
            message: "This computer isn't linked yet.".into(),
        };
    };
    let Some(scid) = ad4m_identity_core::scid_of(&did) else {
        return Screen::Failed {
            message: "This computer isn't linked yet.".into(),
        };
    };
    if matches!(vault.holds(scid), Ok(true)) {
        return Screen::Failed {
            message: "This computer already has the master key.".into(),
        };
    }
    // The holder would seal it to the enc key the log lists, which this computer cannot open.
    if enc_lost_now(executor).await {
        return Screen::Failed {
            message: ENC_MISMATCH.into(),
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
    let executor = match connect(address, vault).await {
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
                message: "This request is no longer open.".into(),
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
                                "This request asks to remove {key_id}, which isn't in your key log."
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
                message: "The device asking isn't in your key log.".into(),
            }),
        );
    };
    let fingerprint = crate::keylog::fingerprint(&logged.sign);
    if kind == "send-master" && !logged.may_keep_master {
        return answer(
            reply,
            Ok(Screen::Failed {
                message: format!(
                    "Device {} (key {fingerprint}) was linked as a device that can't have the \
                     master key. Nothing was sent.",
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
        let unlocking = vault.unlocking(passphrase.map(TypedSecret::into_secret));
        let answered_screen = |answered: Answered, stopped: bool| {
            let note = match answered {
                Answered::MasterSent(sent) => handed_over(&[], &sent.record, false),
                Answered::Revoked(revoked) => handed_over(&[], &revoked.record, false),
                Answered::Rotated { rotated, deleted } => {
                    // The rotation is published: a request left in the box is a note.
                    let left = deleted.err().map(|e| {
                        log::warn!("custody: the answered request was not deleted: {e}");
                        "The request was answered, but it may still show in Requests.".to_string()
                    });
                    if rotated.kept.is_err() {
                        let answered = format!("The request from {device} was answered.");
                        return replaced(rotated, joined(Some(answered), left), stopped);
                    }
                    joined(handed_over(&rotated.pushes, &rotated.record, stopped), left)
                }
            };
            Screen::RequestAnswered {
                kind,
                device: device.clone(),
                note,
            }
        };
        match requests::answer(executor, &unlocking, &did, &request, &CLOCK, &RANDOM).await {
            Ok(answered) => {
                let stopped = rotation_stopped(executor, &answered).await;
                let screen = answered_screen(answered, stopped);
                return after_rotation(
                    executor, vault, address, rx, reply, &unlocking, &did, screen,
                )
                .await;
            }
            // The request also asks to replace the master key: the words sign that rotation.
            // The passphrase seals the new key where the old one rests, so it is checked first.
            Err(ClientError::NeedsWords) if needs && !opens(&unlocking, &did) => answer(
                reply,
                Ok(card(Some(
                    "That passphrase does not open your master key.".into(),
                ))),
            ),
            Err(ClientError::NeedsWords) => {
                let mut error = None;
                let screen = loop {
                    let Some((_typed, words)) =
                        ask_words(vault, address, rx, reply, "answer", error.take()).await
                    else {
                        return;
                    };
                    match requests::answer_with_words(
                        executor, &unlocking, &did, &request, &words, &CLOCK, &RANDOM,
                    )
                    .await
                    {
                        Ok(answered) => {
                            let stopped = rotation_stopped(executor, &answered).await;
                            break answered_screen(answered, stopped);
                        }
                        Err(ClientError::NotTheseWords(_)) => {
                            error = Some((NOT_THESE_WORDS.into(), None))
                        }
                        Err(e) => break failed(&e),
                    }
                };
                return after_rotation(
                    executor, vault, address, rx, reply, &unlocking, &did, screen,
                )
                .await;
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
    let executor = match connect(address, vault).await {
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
                message: "Only a device with the master key can rename other devices.".into(),
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
                    error: Some("Enter a name.".into()),
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
                entry: this_computer(Some(name.clone()), holds, kept_index(vault, &did)),
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
                    master_index: None,
                    vault: None,
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
    if let Some(cancel) = next_cancel(vault, address, rx).await {
        let _ = cancel.send(None);
    }
}

/// [`wait_cancel`], for a flow that must end something before the cancel is answered: the
/// cancel's reply, `None` when the window went away.
async fn next_cancel(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
) -> Option<CancelReply> {
    loop {
        match rx.recv().await {
            None => return None,
            Some(Request::Cancel(r)) => return Some(r),
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

// ─── add a bot ─────────────────────────────────────────────────────────────────────

/// The longest a bot's key may live, in days. The key's scope is the ceiling of every grant the
/// person gives the bot later, and a bot that should run longer is added again.
pub const BOT_DAYS_MAX: u32 = 365;

/// The scope a [`StepInput::BotScope`] asks for: its actions, each one a bot may take and each
/// once, in the order read, write, join; and an expiry `days` after `now`. Why not, in words a
/// person reads, when it is refused.
pub fn bot_scope(can: &[String], days: u32, now: u64) -> Result<BotScope, String> {
    if can.iter().any(|a| !BOT_ACTIONS.contains(&a.as_str())) {
        return Err("A bot can read, write or join, and nothing else.".into());
    }
    let can: Vec<String> = BOT_ACTIONS
        .iter()
        .filter(|a| can.iter().any(|c| c == *a))
        .map(|a| a.to_string())
        .collect();
    if can.is_empty() {
        return Err("Choose at least one thing the bot may do.".into());
    }
    if days == 0 || days > BOT_DAYS_MAX {
        return Err(format!("Choose from 1 to {BOT_DAYS_MAX} days."));
    }
    Ok(BotScope {
        can,
        expires: now + u64::from(days) * 86_400,
    })
}

async fn run_add_bot(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    add_bot_on(&executor, vault, address, rx, reply).await
}

/// Adds a bot. The person picks its scope first, so nothing is unlocked for a choice that is
/// refused; then the one unlock of the step, the bot offer (`LinkFlow::open_bot`), the claim of
/// the executor that runs the bot, the match code, and the `add`. Only the computer that keeps
/// the master key can: the add is signed by it.
async fn add_bot_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let store_url = match trusted_store(executor).await {
        Ok(url) => url,
        Err(refused) => return answer(reply, Ok(refused)),
    };
    let (did, _) = match holder_of(executor, vault).await {
        Ok(holder) => holder,
        Err(screen) => return answer(reply, Ok(screen)),
    };
    // Only the master key signs a bot's key into the log: say so before asking anything.
    let Some(scid) = ad4m_identity_core::scid_of(&did) else {
        return answer(reply, Ok(failed(&ClientError::Vault(VaultError::NotFound))));
    };
    match vault.holds(scid) {
        Ok(true) => {}
        Err(e) => return answer(reply, Ok(failed(&ClientError::Vault(e)))),
        Ok(false) => return answer(reply, Ok(failed(&ClientError::Vault(VaultError::NotFound)))),
    }
    let needs = match passphrase_for(vault, &did) {
        Ok(needs) => needs,
        Err(e) => return answer(reply, Ok(failed(&e))),
    };
    answer(reply, Ok(Screen::BotScope { error: None }));
    let scope = loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        let StepInput::BotScope { can, days } = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        match bot_scope(&can, days, CLOCK.now()) {
            Ok(scope) => break scope,
            Err(error) => answer(reply, Ok(Screen::BotScope { error: Some(error) })),
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
            unlocking = vault.unlocking(Some(p.into_secret()));
        }
        match LinkFlow::open_bot(
            executor,
            &unlocking,
            &did,
            scope.clone(),
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
        Ok(Screen::BotOffer {
            offer: flow.offer_string(),
            can: scope.can.clone(),
            key_expires: scope.expires,
            expires: offer_expiry(),
        }),
    );
    follow_bot(&flow, vault, address, rx, reply).await
}

/// The bot offer after it is out: waits for the bot's executor to claim it, shows the match code
/// that executor shows too, and on the person's yes publishes the `add`. The key's bot mark and
/// scope are the offer's, which the claim cannot change (`link::verify_claim_view`); the record
/// lists it as a bot under the name the person gives (else the name it was made with).
async fn follow_bot<R: ExecutorRpc>(
    flow: &LinkFlow<'_, R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let mut claimed: Option<Claimed> = None;
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        match input {
            StepInput::WaitClaim if claimed.is_none() => {
                let outcome = tokio::select! {
                    claim = flow.wait_for_claim() => Some(claim),
                    () = wait_cancel(vault, address, rx) => None,
                };
                match outcome {
                    Some(Ok(claim)) => {
                        let screen = Screen::BotMatch {
                            code: claim.match_code.clone(),
                            name: claim.hint.clone(),
                        };
                        claimed = Some(claim);
                        answer(reply, Ok(screen));
                    }
                    Some(Err(e)) => return answer(reply, Ok(failed(&e))),
                    None => return answer(reply, Err(CustodyError::NoStep)),
                }
            }
            StepInput::Confirm { name, .. } if claimed.is_some() => {
                let claim = claimed.take().expect("checked above");
                let name = given_name(name)
                    .or_else(|| given_name(claim.hint.clone()))
                    .unwrap_or_else(|| "A bot".into());
                let entry = DeviceEntry {
                    name: name.clone(),
                    kind: DeviceKind::Bot,
                    place: None,
                    address: None,
                    runs_executor: false,
                    holds_master: Holds::No,
                    master_index: None,
                    vault: None,
                    operator: None,
                };
                let linked = match flow.confirm(&claim, entry, false).await {
                    Ok(linked) => linked,
                    Err(e) => return answer(reply, Ok(failed(&e))),
                };
                let note = linked.record.as_ref().err().map(|e| {
                    log::warn!("custody: the bot was not listed in the record: {e}");
                    "Its name was not saved: your devices show it by its key id.".to_string()
                });
                return answer(
                    reply,
                    Ok(Screen::BotAdded {
                        seq: linked.head.seq,
                        key_id: linked.key_id.as_str().to_string(),
                        name,
                        note,
                    }),
                );
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    }
}

async fn run_revoke(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    key_id: String,
) {
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    revoke_on(&executor, vault, address, rx, reply, key_id).await
}

/// [`run_revoke`] once the executor answers. With "Also replace master key" ticked (by
/// default when the key log says the device may hold a copy, [`may_hold_master`]), the 12 words
/// are asked next and the revoke is one rotation to a new master key: the revoked device's copy
/// stops acting with it.
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
    let confirm = |error: Option<String>| Screen::RevokeConfirm {
        key_id: key_id.clone(),
        may_hold_master,
        rotate: may_hold_master,
        passphrase: needs,
        error,
    };
    answer(reply, Ok(confirm(None)));
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        let StepInput::Revoke { passphrase, rotate } = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        let unlocking = vault.unlocking(passphrase.map(TypedSecret::into_secret));
        if rotate {
            // The words sign the rotation; the passphrase seals the new key where the old one
            // rests, so it is checked before any word is asked.
            if needs && !opens(&unlocking, &did) {
                answer(
                    reply,
                    Ok(confirm(Some(
                        "That passphrase does not open your master key.".into(),
                    ))),
                );
                continue;
            }
            let revoke = [ad4m_identity_core::KeyId::from(key_id.as_str())];
            let mut error = None;
            let screen = loop {
                let Some((_typed, words)) =
                    ask_words(vault, address, rx, reply, "revoke", error.take()).await
                else {
                    return;
                };
                match revoke_and_rotate(
                    executor, &unlocking, &did, &revoke, &words, &CLOCK, &RANDOM,
                )
                .await
                {
                    Ok(rotated) => {
                        let stopped = stopped_at_record(executor, &rotated.record).await;
                        break replaced(rotated, None, stopped);
                    }
                    Err(ClientError::NotTheseWords(_)) => {
                        error = Some((NOT_THESE_WORDS.into(), None))
                    }
                    Err(e) => break failed(&e),
                }
            };
            return after_rotation(
                executor, vault, address, rx, reply, &unlocking, &did, screen,
            )
            .await;
        }
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
                // The main window's refreshes cannot unlock a sealed key; this unlock can.
                retry_quietly(executor, &unlocking, &did).await;
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
                Ok(confirm(Some(
                    "That passphrase does not open your master key.".into(),
                ))),
            ),
            Err(e) => return answer(reply, Ok(failed(&e))),
        }
    }
}

/// Whether `unlocking` opens the master key of `did` kept here: a passphrase checked before a step
/// that publishes, so a wrong one cannot leave a new key published and not kept.
fn opens(unlocking: &Unlocking<'_>, did: &str) -> bool {
    let Some(scid) = ad4m_identity_core::scid_of(did) else {
        return false;
    };
    Vault::unlock(unlocking, scid, MasterUse::Revoke, CLOCK.now()).is_ok()
}

// ─── the 12 words: replace the master key, restore ──────────────────────────────────

/// Asks for the 12 words until they parse, saying why each refused set was (a word by its place,
/// never by what was typed). `None` when the window cancels. The typed string is wiped on drop.
async fn ask_words(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    purpose: &'static str,
    mut error: Option<(String, Option<usize>)>,
) -> Option<(Secret<String>, Words)> {
    loop {
        let (message, position) = error.take().map_or((None, None), |(m, p)| (Some(m), p));
        answer(
            reply,
            Ok(Screen::EnterWords {
                purpose,
                error: message,
                position,
            }),
        );
        let typed = loop {
            match next_input(vault, address, rx, reply).await? {
                StepInput::TwelveWords { words } => break words.into_secret(),
                _ => answer(reply, Err(CustodyError::WrongInput)),
            }
        };
        match words::parse(typed.expose()) {
            Ok(parsed) => return Some((typed, parsed)),
            Err(e) => error = Some(words_refused(&e)),
        }
    }
}

/// The last screen of a rotation that was published, saying what did not happen yet (`extra`
/// first). When this computer could not keep the new key, [`Screen::MasterNotKept`]: the rotation
/// stands either way, so neither screen says nothing changed.
fn replaced(rotated: Rotated, extra: Option<String>, stopped: bool) -> Screen {
    let revoked: Vec<String> = rotated
        .revoked
        .iter()
        .map(|k| k.as_str().to_string())
        .collect();
    let note = joined(
        extra,
        handed_over(&rotated.pushes, &rotated.record, stopped),
    );
    match rotated.kept {
        // The index this computer keeps: the rotation's, or a later one another app on this
        // computer kept first (the vault never goes back a generation).
        Ok(kept) => Screen::MasterReplaced {
            index: kept,
            revoked,
            note,
        },
        Err(e) => {
            log::warn!(
                "custody: master #{} is current, and this computer did not keep it: {e}",
                rotated.index
            );
            Screen::MasterNotKept {
                index: rotated.index,
                revoked,
                reason: after_publish(&e),
                note,
            }
        }
    }
}

/// Two notes as one, either or both absent.
fn joined(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(a), Some(b)) => Some(format!("{a} {b}")),
        (a, b) => a.or(b),
    }
}

/// Why a part of a step after its publish did not happen, in words a person reads. Never says that
/// nothing changed, as [`failed`] does for a step that stopped before its publish: the publish
/// stands.
fn after_publish(e: &ClientError) -> String {
    match e {
        e if names_no_store(e) => {
            "This network has no identity store this computer can use.".into()
        }
        ClientError::Vault(VaultError::Cancelled) => "The unlock was cancelled.".into(),
        ClientError::Vault(VaultError::NotFound) => {
            "The new master key went missing on this computer.".into()
        }
        ClientError::Vault(e) if crate::pending::is_lost_epoch(e) => LOST_EPOCH.into(),
        ClientError::Vault(e) if crate::store::is_keyring_locked(e) => {
            "Your keyring is locked. Unlock it when your desktop asks for its password.".into()
        }
        ClientError::Vault(VaultError::Unavailable(why)) => format!("Key storage error: {why}"),
        ClientError::LogBusy => "Another device kept changing your key log.".into(),
        ClientError::OfferEnded(state) => {
            log::warn!("custody: linking this computer ended unconfirmed ({state})");
            "Linking this computer wasn't confirmed.".into()
        }
        ClientError::NotAKeeper(_) => "That device can't have the master key.".into(),
        ClientError::Poster(why) => {
            log::warn!("custody: the request does not check out: {why}");
            "This request couldn't be verified.".into()
        }
        ClientError::NotTheseWords(_) => "This recovery phrase doesn't match your identity.".into(),
        e => match failed(e) {
            Screen::Failed { message } => message,
            _ => unreachable!("failed() answers Failed"),
        },
    }
}

/// Asks for the 12 words (unless `first` holds them) and replaces the master key with them,
/// asking again for words that are not the identity's. The screen it ends on; `None` when the
/// window cancels.
#[allow(clippy::too_many_arguments)]
async fn rotate_with_words<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    unlocking: &Unlocking<'_>,
    did: &str,
    mut first: Option<Words>,
) -> Option<Result<Screen, ClientError>> {
    let mut error = None;
    loop {
        let words = match first.take() {
            Some(words) => words,
            None => {
                ask_words(vault, address, rx, reply, "replace", error.take())
                    .await?
                    .1
            }
        };
        let rotated = match recover_lost_epoch(executor, vault, did, &words).await {
            Ok(()) => rotate(executor, unlocking, did, &words, &[], &CLOCK, &RANDOM).await,
            Err(e) => Err(e),
        };
        match rotated {
            Ok(rotated) => {
                let stopped = stopped_at_record(executor, &rotated.record).await;
                return Some(Ok(replaced(rotated, None, stopped)));
            }
            Err(ClientError::NotTheseWords(_)) => error = Some((NOT_THESE_WORDS.into(), None)),
            Err(e) => return Some(Err(e)),
        }
    }
}

/// The way back from a lost custody epoch ([`LOST_EPOCH`]), taken by "Replace master key"
/// before it rotates, and by "Restore with recovery phrase" on a computer not linked yet before its rotation
/// stages and before each try at linking after it ([`restore_on`]). Only when the epoch of `did`'s key here is lost, and only once `words` are
/// checked to make the identity's current master — the check `rotate` makes before it publishes
/// ([`words_make_current_master`]) — is the epoch recovered
/// ([`DesktopVault::recover_custody_epoch`], a fresh incarnation). Words that are not the
/// identity's recover nothing ([`ClientError::NotTheseWords`]); the rotation that follows moves
/// the recovered epoch as any change of the kept key does.
async fn recover_lost_epoch<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    did: &str,
    words: &Words,
) -> Result<(), ClientError> {
    let Some(scid) = ad4m_identity_core::scid_of(did) else {
        return Ok(());
    };
    match vault.custody_epoch(scid) {
        Ok(_) => return Ok(()),
        Err(e) if crate::pending::is_lost_epoch(&e) => {}
        Err(e) => return Err(e.into()),
    }
    words_make_current_master(executor, did, words).await?;
    log::info!("custody: the words make the current master key; recover its custody epoch");
    vault.recover_custody_epoch(scid)?;
    Ok(())
}

/// Whether `words` make `did`'s current master key, as the key log the executor serves says it
/// (the rule of `ad4m_identity_client::flows::rotate`, whose `current_index` is not public):
/// master *n* of the words, *n* the current master's index, signs as the log's current master.
/// [`ClientError::NotTheseWords`] when they do not.
async fn words_make_current_master<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    did: &str,
    words: &Words,
) -> Result<(), ClientError> {
    let events = executor.events(did).await?;
    let chain =
        ad4m_identity_core::fold(&events).map_err(|e| ClientError::Protocol(e.to_string()))?;
    let state = chain.state();
    let current = state
        .current_master()
        .ok_or_else(|| ClientError::Protocol("the identity has ended".into()))?;
    let index = u32::try_from(state.masters.len() - 1)
        .map_err(|_| ClientError::Protocol("the log lists too many masters".into()))?;
    let key =
        ad4m_identity_core::words::master_key(&ad4m_identity_core::words::seed(words), index)?;
    if ad4m_identity_core::build::Signer::key(&key) != current.sign {
        return Err(ClientError::NotTheseWords(
            "they do not derive the current master key".into(),
        ));
    }
    Ok(())
}

/// Answers the screen a published rotation ended on, after the retry list is pushed again. On
/// [`Screen::MasterNotKept`] the step stays open: [`StepInput::TryAgain`] asks for the 12 words
/// and replaces the master key once more, with a key this computer keeps. A second attempt that
/// fails shows `MasterNotKept` again, with why: the first rotation stands, so the step never says
/// that nothing changed.
#[allow(clippy::too_many_arguments)]
async fn after_rotation<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
    unlocking: &Unlocking<'_>,
    did: &str,
    mut screen: Screen,
) {
    loop {
        retry_quietly(executor, unlocking, did).await;
        let Screen::MasterNotKept { index, .. } = screen else {
            return answer(reply, Ok(screen));
        };
        answer(reply, Ok(screen));
        loop {
            match next_input(vault, address, rx, reply).await {
                None => return,
                Some(StepInput::TryAgain) => break,
                Some(_) => answer(reply, Err(CustodyError::WrongInput)),
            }
        }
        screen = match rotate_with_words(executor, vault, address, rx, reply, unlocking, did, None)
            .await
        {
            None => return,
            Some(Ok(next)) => next,
            Some(Err(e)) => {
                log::warn!("custody: replacing master #{index} again did not work: {e}");
                Screen::MasterNotKept {
                    index,
                    revoked: Vec::new(),
                    reason: after_publish(&e),
                    note: None,
                }
            }
        };
    }
}

/// What the hand-over of a new master key left undone, in words: the apps it has not reached yet
/// (the retry list sends it again at each unlock), and the device list not updated yet. `stopped`
/// ([`stopped_at_record`]): the hand-over stopped before any push because this computer cannot
/// open the record, so no other device was sent the key and nothing writes the list here.
fn handed_over(
    pushes: &[(ad4m_identity_core::KeyId, Result<String, ClientError>)],
    record: &Result<u64, ClientError>,
    stopped: bool,
) -> Option<String> {
    let mut note = Vec::new();
    let late: Vec<&str> = pushes
        .iter()
        .filter(|(_, pushed)| pushed.is_err())
        .map(|(key_id, _)| key_id.as_str())
        .collect();
    for (key_id, pushed) in pushes {
        if let Err(e) = pushed {
            log::warn!("custody: the new master key did not reach {key_id} yet: {e}");
        }
    }
    if !late.is_empty() {
        note.push(format!(
            "The new master key wasn't sent to {} yet. It's sent again the next time this \
             computer unlocks.",
            late.join(", ")
        ));
    }
    if let Err(e) = record {
        log::warn!("custody: the record was not written after the rotation: {e}");
        note.push(if stopped {
            NOT_HANDED_OVER.into()
        } else {
            "Your device list shows this after its next change.".into()
        });
    }
    (!note.is_empty()).then(|| note.join(" "))
}

/// The note of a rotation whose hand-over stopped at the record ([`stopped_at_record`]): the key
/// log lists an enc key for this computer it no longer keeps ([`ENC_MISMATCH`]), so no other
/// device was sent the new master key. A device that asks for it is sent it from here all the
/// same (a push seals to that device's enc key), and holding it, that device revokes this one.
pub const NOT_HANDED_OVER: &str =
    "Your other devices weren't sent the new master key, because this computer has lost the key \
     that opens your device list. When one of them asks for it, review the request in Settings > \
     Devices here to send it. Then, on that device, revoke this computer and link it again.";

/// Whether the hand-over of a new master key stopped at the record, before any push, because this
/// computer cannot open it. ad4m's hand-over reads the record as `Reader::Recovery`:
/// the words' `"recovery"` entry opens it, and a record without one opens only through this
/// computer's own entry, whose failure it answers as `NoEntry("recovery")` with no push made. That
/// error alone also covers a read that failed for a passing reason, so the log is asked too: the
/// enc key it lists for this computer is one it no longer keeps ([`enc_lost_now`]), and that
/// entry will not open again.
async fn stopped_at_record<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    record: &Result<u64, ClientError>,
) -> bool {
    use ad4m_identity_core::record::{RecordError, RECOVERY_ENTRY};
    matches!(
        record,
        Err(ClientError::Record(RecordError::NoEntry(entry))) if entry == RECOVERY_ENTRY
    ) && enc_lost_now(executor).await
}

/// [`stopped_at_record`] for an answered request: only a rotation hands a new master key over.
async fn rotation_stopped<R: ExecutorRpc>(executor: &ViaExecutor<R>, answered: &Answered) -> bool {
    match answered {
        Answered::Rotated { rotated, .. } => stopped_at_record(executor, &rotated.record).await,
        Answered::MasterSent(_) | Answered::Revoked(_) => false,
    }
}

/// The executor's identity, or the screen saying it has none.
async fn identity_of<R: ExecutorRpc>(executor: &ViaExecutor<R>) -> Result<String, Screen> {
    match executor.status().await {
        Ok(IdentityStatus { did: Some(did), .. }) => Ok(did),
        Ok(_) => Err(Screen::Failed {
            message: "This computer isn't linked yet.".into(),
        }),
        Err(e) => Err(failed(&ClientError::Rpc(e))),
    }
}

/// The vault for a step that keeps a new master key of `scid` here: with the passphrase of the key
/// kept here, checked by opening it; with a new one where none is kept and a new item is sealed;
/// else with none. `None` when the window cancels.
async fn unlocking_to_keep<'v>(
    vault: &'v DesktopVault,
    did: &str,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Option<Result<Unlocking<'v>, Screen>> {
    let scid = ad4m_identity_core::scid_of(did)?;
    match held_sealed(vault, scid) {
        Err(e) => Some(Err(failed(&ClientError::Vault(e)))),
        Ok(None) if vault.needs_passphrase() => {
            let p = new_passphrase(vault, address, rx, reply).await?;
            Some(Ok(vault.unlocking(Some(p))))
        }
        Ok(None) | Ok(Some(false)) => Some(Ok(vault.unlocking(None))),
        Ok(Some(true)) => {
            answer(reply, Ok(Screen::EnterPassphrase { error: None }));
            loop {
                let StepInput::Passphrase { passphrase, .. } =
                    next_input(vault, address, rx, reply).await?
                else {
                    answer(reply, Err(CustodyError::WrongInput));
                    continue;
                };
                let unlocking = vault.unlocking(Some(passphrase.into_secret()));
                if opens(&unlocking, did) {
                    return Some(Ok(unlocking));
                }
                answer(reply, Ok(wrong_passphrase()));
            }
        }
    }
}

async fn run_replace_master(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    replace_master_on(&executor, vault, address, rx, reply).await
}

/// Replaces the master key with the next one the 12 words make. Any device of the identity may:
/// the words, not a kept key, sign the rotation, and this computer keeps the new key — behind its
/// passphrase where it keeps the old one sealed, or a new one where a new item is sealed. The
/// other apps that kept the old key are sent the new one; a push that fails stays on the retry
/// list.
async fn replace_master_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    if let Err(refused) = trusted_store(executor).await {
        return answer(reply, Ok(refused));
    }
    finish_pending_quietly(executor, vault).await;
    let did = match identity_of(executor).await {
        Ok(did) => did,
        Err(screen) => return answer(reply, Ok(screen)),
    };
    // Words first, so a typo is caught before a passphrase is asked.
    let Some((typed, words)) = ask_words(vault, address, rx, reply, "replace", None).await else {
        return;
    };
    let unlocking = match unlocking_to_keep(vault, &did, address, rx, reply).await {
        None => return,
        Some(Err(screen)) => return answer(reply, Ok(screen)),
        Some(Ok(unlocking)) => unlocking,
    };
    drop(typed);
    let screen = match rotate_with_words(
        executor,
        vault,
        address,
        rx,
        reply,
        &unlocking,
        &did,
        Some(words),
    )
    .await
    {
        None => return,
        Some(Ok(screen)) => screen,
        Some(Err(e)) => {
            retry_quietly(executor, &unlocking, &did).await;
            return answer(reply, Ok(failed(&e)));
        }
    };
    after_rotation(
        executor, vault, address, rx, reply, &unlocking, &did, screen,
    )
    .await
}

async fn run_restore(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    restore_on(&executor, vault, address, rx, reply).await
}

/// "Restore with recovery phrase" on a computer of no identity: the words name the identity (the store's key
/// index knows whose master #0 they make), its devices are listed with the apps ticked to lock out,
/// and one rotation revokes the ticked ones and gives this computer the new master key; then
/// this computer joins as a device, and the apps not locked out are sent the new key.
async fn restore_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    if let Err(refused) = trusted_store(executor).await {
        return answer(reply, Ok(refused));
    }
    match executor.status().await {
        Ok(IdentityStatus { did: Some(did), .. }) => {
            return answer(reply, Ok(failed(&ClientError::HasIdentity(did))))
        }
        Ok(_) => {}
        Err(e) => return answer(reply, Ok(failed(&ClientError::Rpc(e)))),
    }
    // The parsed words are kept past the flow's start: they are what recovers a lost custody
    // epoch of the identity they name (`recover_lost_epoch`), once checked against its log.
    let Some((mut typed, mut words)) = ask_words(vault, address, rx, reply, "restore", None).await
    else {
        return;
    };
    // Where a new item is sealed, its passphrase now: the flow keeps the new key with it.
    let mut passphrase = None;
    if vault.needs_passphrase() {
        let Some(p) = new_passphrase(vault, address, rx, reply).await else {
            return;
        };
        passphrase = Some(p);
    }
    let unlocking = vault.unlocking(passphrase);
    let mut flow = loop {
        match RestoreFlow::start(executor, &unlocking, typed.expose(), &CLOCK, &RANDOM).await {
            Ok(flow) => break flow,
            Err(ClientError::NotTheseWords(_)) => {
                match ask_words(
                    vault,
                    address,
                    rx,
                    reply,
                    "restore",
                    Some((NOT_THESE_WORDS.into(), None)),
                )
                .await
                {
                    Some((again, parsed)) => {
                        typed = again;
                        words = parsed;
                    }
                    None => return,
                }
            }
            Err(e) => return answer(reply, Ok(failed(&e))),
        }
    };
    drop(typed);
    let did = flow.did().to_string();
    // A key of this identity already kept here sealed: the new one goes where it rests, so the
    // passphrase must open it.
    if let Some(scid) = ad4m_identity_core::scid_of(&did) {
        if matches!(held_sealed(vault, scid), Ok(Some(true))) && !opens(&unlocking, &did) {
            return answer(
                reply,
                Ok(Screen::Failed {
                    message: "This computer has a master key for this identity with a \
                              different passphrase. Nothing changed."
                        .into(),
                }),
            );
        }
    }
    let devices: Vec<RestoreDevice> = flow
        .devices()
        .iter()
        .map(|d| RestoreDevice {
            key_id: d.key_id.as_str().to_string(),
            name: d.name.clone(),
            kind: d.kind,
            lock_out: d.lock_out,
        })
        .collect();
    let note = flow.record_error().map(|e| {
        log::warn!("custody: the record could not be read for the restore: {e}");
        "Couldn't read your device list, so devices show without names.".to_string()
    });
    answer(
        reply,
        Ok(Screen::RestoreDevices {
            did: did.clone(),
            devices: devices.clone(),
            note,
        }),
    );
    let (lock_out, name) = loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        match input {
            StepInput::LockOut { key_ids, name }
                if key_ids
                    .iter()
                    .all(|k| devices.iter().any(|d| &d.key_id == k)) =>
            {
                break (key_ids, name)
            }
            _ => answer(reply, Err(CustodyError::WrongInput)),
        }
    };
    // The vault's item carries the index; the record's comes from the hand-over that keeps it.
    let entry = this_computer(given_name(name), true, None);
    let name = entry.name.clone();
    let lock_out: Vec<ad4m_identity_core::KeyId> = lock_out
        .iter()
        .map(|k| ad4m_identity_core::KeyId::from(k.as_str()))
        .collect();
    // Before the stage the rotation makes: a custody epoch of this identity this computer lost
    // (a first restore stopped, a file of the custody folder gone) is recovered here, the words
    // checked first to make the identity's current master. "Replace master key", the way back
    // on a linked computer, refuses this one: it is not linked yet.
    let finished = match recover_lost_epoch(executor, vault, &did, &words).await {
        Ok(()) => flow.finish(&lock_out, entry.clone()).await,
        Err(e) => Err(e),
    };
    let restored = match finished {
        Ok(restored) => restored,
        Err(e) => return answer(reply, Ok(failed(&e))),
    };
    // Published from here: the identity is restored and the lock-out stands, whatever follows.
    let revoked: Vec<String> = restored
        .revoked
        .iter()
        .map(|k| k.as_str().to_string())
        .collect();
    let mut enrolled = restored.enrolled;
    loop {
        match enrolled {
            Ok(enrolled) => {
                retry_quietly(executor, &unlocking, &did).await;
                let stopped = stopped_at_record(executor, &enrolled.record).await;
                return answer(
                    reply,
                    Ok(Screen::Restored {
                        note: handed_over(&enrolled.pushes, &enrolled.record, stopped),
                        did: restored.did,
                        name,
                        key_id: enrolled.key_id.as_str().to_string(),
                        revoked,
                    }),
                );
            }
            Err(e) => {
                log::warn!("custody: restored, and this computer is not linked yet: {e}");
                answer(
                    reply,
                    Ok(Screen::RestoreNotLinked {
                        did: did.clone(),
                        revoked: revoked.clone(),
                        reason: after_publish(&e),
                    }),
                );
            }
        }
        // The same flow links this computer again: it holds the words, which are not asked
        // again, and refuses a second rotation.
        loop {
            match next_input(vault, address, rx, reply).await {
                None => return,
                Some(StepInput::TryAgain) => break,
                Some(_) => answer(reply, Err(CustodyError::WrongInput)),
            }
        }
        // The same words, checked again, recover an epoch lost since the rotation.
        enrolled = match recover_lost_epoch(executor, vault, &did, &words).await {
            Ok(()) => flow.enrol(entry.clone()).await,
            Err(e) => Err(e),
        };
    }
}

// ─── remove the master key from this computer ────────────────────────────────────

async fn run_remove_master(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    remove_master_on(&executor, vault, address, rx, reply).await
}

/// Forgets this computer's copy of the master key, once the record no longer lists it as
/// holding one. Refused, with the key left where it is, while no other computer or phone of the
/// identity keeps a copy. No unlock: forgetting a key needs none.
async fn remove_master_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let did = match identity_of(executor).await {
        Ok(did) => did,
        Err(screen) => return answer(reply, Ok(screen)),
    };
    let Some(scid) = ad4m_identity_core::scid_of(&did) else {
        return answer(reply, Ok(failed(&ClientError::Vault(VaultError::NotFound))));
    };
    match vault.holds(scid) {
        Ok(true) => {}
        Err(e) => return answer(reply, Ok(failed(&ClientError::Vault(e)))),
        Ok(false) => return answer(reply, Ok(failed(&ClientError::Vault(VaultError::NotFound)))),
    }
    answer(reply, Ok(Screen::RemoveMaster { error: None }));
    loop {
        let Some(input) = next_input(vault, address, rx, reply).await else {
            return;
        };
        let StepInput::Remove = input else {
            answer(reply, Err(CustodyError::WrongInput));
            continue;
        };
        // The client forgets the kept key and owns the staged slot: a stage at or behind the log
        // goes, one ahead of it (another app's rotation in flight) stays.
        let screen = match remove_master(executor, &vault.unlocking(None), &did, &RANDOM).await {
            Ok(_) => Screen::MasterRemoved,
            Err(e) => failed(&e),
        };
        return answer(reply, Ok(screen));
    }
}

// ─── the email check ─────────────────────────────────────────────────────────────

/// Why the email check cannot run: the executor speaks for no identity.
const NO_IDENTITY_TO_CHECK: &str =
    "This computer has no identity yet, so there is nothing to check. Make your identity first.";

/// What the code screen says when the platform's vouching service or the store's does not answer.
const CHECKS_UNAVAILABLE: &str = "Email checks are not available now. Try again later.";

async fn run_check_email(
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    let executor = match connect(address, vault).await {
        Ok(e) => e,
        Err(message) => return answer(reply, Ok(Screen::Failed { message })),
    };
    let platform = crate::platform::Platform::from_env();
    check_email_on(&executor, &platform, vault, address, rx, reply).await
}

/// Why `email` is not an address to send a code to, or `None`. Only its form: the platform says
/// nothing of whether an address exists.
fn email_problem(email: &str) -> Option<&'static str> {
    let well_formed = email.len() <= 254
        && !email.chars().any(char::is_whitespace)
        && email.split_once('@').is_some_and(|(name, domain)| {
            !name.is_empty()
                && !domain.contains('@')
                && domain.split('.').count() >= 2
                && domain.split('.').all(|part| !part.is_empty())
        });
    (!well_formed).then_some("That is not an email address. Check it and try again.")
}

/// The code as the person typed it, without spaces or dashes; `None` when it is not 6 digits.
fn email_code(typed: &str) -> Option<String> {
    let code: String = typed
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    (code.len() == 6 && code.chars().all(|c| c.is_ascii_digit())).then_some(code)
}

/// Words a person reads for a platform answer that is not one of the code's own refusals.
fn platform_problem(e: &crate::platform::PlatformError) -> String {
    use crate::platform::PlatformError;
    match e {
        PlatformError::Unreachable(why) => {
            log::warn!("custody: the platform did not answer: {why}");
            "Could not reach the email check service. Check your connection and try again.".into()
        }
        PlatformError::Refused { status: 400, .. } => {
            "The email check service did not take that email address. Check it and try again."
                .into()
        }
        PlatformError::Refused { status: 429, .. } => {
            "Too many tries. Wait a few minutes and try again.".into()
        }
        PlatformError::Refused { status, error } => {
            log::warn!("custody: the platform answered {status} {error:?}");
            CHECKS_UNAVAILABLE.into()
        }
        PlatformError::WrongCode { .. }
        | PlatformError::TooManyTries
        | PlatformError::Expired
        | PlatformError::AlreadyVouched => {
            unreachable!("the code's own refusals are worded where verify is called")
        }
    }
}

/// The email check: an address, then the code the platform sends to it, then the platform's token
/// to the executor (`identity.attachNote`), which has the store keep a vouch note for the
/// identity. A cancel ("Not now") ends it with nothing changed. The token is redeemed once, by the
/// store; it goes nowhere else.
async fn check_email_on<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    platform: &crate::platform::Platform,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) {
    if let Some(last) = email_check(executor, platform, vault, address, rx, reply).await {
        answer(reply, Ok(last));
    }
}

/// The email check from the start: `EmailChecked` at once when the store already keeps a vouch
/// note, else the screens of [`ask_email`]. The last screen, which the caller answers with, or
/// `None` when the step ended first (a cancel). The cloud-device step runs it too, then goes on.
async fn email_check<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    platform: &crate::platform::Platform,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Option<Screen> {
    let did = match executor.status().await {
        Ok(IdentityStatus {
            did: Some(did),
            vouched: true,
            ..
        }) => return Some(Screen::EmailChecked { did }),
        Ok(IdentityStatus { did: Some(did), .. }) => did,
        Ok(_) => {
            return Some(Screen::Failed {
                message: NO_IDENTITY_TO_CHECK.into(),
            })
        }
        Err(e) => return Some(failed(&ClientError::Rpc(e))),
    };
    ask_email(executor, platform, did, vault, address, rx, reply).await
}

/// The email check's screens for the identity `did`, from the address to the platform's token
/// attached: the last screen (`EmailChecked`, or `Failed`), which the caller answers with, or
/// `None` when the step ended first (a cancel). The cloud-device step runs it too, then goes on.
async fn ask_email<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    platform: &crate::platform::Platform,
    did: String,
    vault: &DesktopVault,
    address: &ExecutorAddress,
    rx: &mut Rx,
    reply: &mut Reply,
) -> Option<Screen> {
    use crate::platform::PlatformError;
    answer(reply, Ok(Screen::EnterEmail { error: None }));

    // The address the last code went to; `None` on `EnterEmail`.
    let mut sent: Option<String> = None;
    loop {
        let input = next_input(vault, address, rx, reply).await?;
        let screen = match (input, sent.clone()) {
            (StepInput::Email { email }, None) => {
                let email = email.trim().to_string();
                if let Some(problem) = email_problem(&email) {
                    Screen::EnterEmail {
                        error: Some(problem.into()),
                    }
                } else {
                    match platform.start(&email, &did).await {
                        Ok(()) => {
                            sent = Some(email.clone());
                            Screen::EnterEmailCode { email, error: None }
                        }
                        Err(e) => Screen::EnterEmail {
                            error: Some(platform_problem(&e)),
                        },
                    }
                }
            }
            (StepInput::ChangeEmail, Some(_)) => {
                sent = None;
                Screen::EnterEmail { error: None }
            }
            (StepInput::NewCode, Some(email)) => {
                let error = platform.start(&email, &did).await.err();
                Screen::EnterEmailCode {
                    email,
                    error: error.map(|e| platform_problem(&e)),
                }
            }
            (StepInput::EmailCode { code }, Some(email)) => {
                let Some(code) = email_code(&code) else {
                    answer(
                        reply,
                        Ok(Screen::EnterEmailCode {
                            email,
                            error: Some(
                                "The code has 6 digits. Check the email and try again.".into(),
                            ),
                        }),
                    );
                    continue;
                };
                let refused = |error: String| Screen::EnterEmailCode {
                    email: email.clone(),
                    error: Some(error),
                };
                match platform.verify(&email, &did, &code).await {
                    Ok(token) => match executor.attach_note(&token).await {
                        Ok(_) => return Some(Screen::EmailChecked { did }),
                        // Another app of this identity attached a note first: the check is done.
                        Err(e) if refusal(&e) == Some(Refusal::AlreadyVouched) => {
                            return Some(Screen::EmailChecked { did })
                        }
                        Err(e) if refusal(&e) == Some(Refusal::NoIdentity) => {
                            return Some(Screen::Failed {
                                message: NO_IDENTITY_TO_CHECK.into(),
                            })
                        }
                        // The store's vouching check refused the token (spent, or not known).
                        Err(e) if e.code == 403 => {
                            refused("That code cannot be used now. Send a new code.".into())
                        }
                        Err(e) if e.code == 503 => {
                            log::warn!("custody: the note was not attached: {}", e.message);
                            refused(CHECKS_UNAVAILABLE.into())
                        }
                        Err(e) => refused(failure_message(&ClientError::Rpc(e))),
                    },
                    Err(PlatformError::WrongCode { tries_left: 0 })
                    | Err(PlatformError::TooManyTries) => {
                        refused("Too many wrong codes. Send a new code.".into())
                    }
                    Err(PlatformError::WrongCode { tries_left: 1 }) => {
                        refused("That code is wrong. 1 try left.".into())
                    }
                    Err(PlatformError::WrongCode { tries_left }) => {
                        refused(format!("That code is wrong. {tries_left} tries left."))
                    }
                    Err(PlatformError::Expired) => {
                        refused("That code has expired. Send a new code.".into())
                    }
                    Err(PlatformError::AlreadyVouched) => {
                        sent = None;
                        Screen::EnterEmail {
                            error: Some(
                                "This email address already checks another identity. Use another address."
                                    .into(),
                            ),
                        }
                    }
                    Err(e) => refused(platform_problem(&e)),
                }
            }
            _ => {
                answer(reply, Err(CustodyError::WrongInput));
                continue;
            }
        };
        answer(reply, Ok(screen));
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
    use std::rc::Rc;

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
        /// The log whose identity's record a `identity.recordPut` keeps: the record put is what
        /// `identity.record` answers next, with the store's receipt
        /// ([`FakeExecutor::keep_puts`]). `None`: a put answers 404.
        keeps_record: RefCell<Option<Vec<Event>>>,
        /// Once the key's method is called, the method named beside it answers its value.
        then: RefCell<std::collections::HashMap<&'static str, (&'static str, Value)>>,
        /// What a method refuses with, by name, ahead of anything it would answer.
        refusals: RefCell<std::collections::HashMap<&'static str, (u16, &'static str)>>,
        /// How long a method takes to answer, by name.
        delays: RefCell<std::collections::HashMap<&'static str, Duration>>,
        /// What `identity.status` answers as `vouched`; an `identity.attachNote` sets it.
        vouched: Cell<bool>,
        /// The proof of work's cost `identity.powParams` answers, and a publish of a new log
        /// checks, as the store does (`403 forbidden: "pow"`). Low, so a test solves it at once.
        pow_bits: Cell<u8>,
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
                keeps_record: RefCell::new(None),
                then: RefCell::new(Default::default()),
                refusals: RefCell::new(Default::default()),
                delays: RefCell::new(Default::default()),
                vouched: Cell::new(false),
                pow_bits: Cell::new(8),
            }
        }

        /// `method` answers `value` from now on.
        fn answer(&self, method: &'static str, value: Value) {
            self.canned.borrow_mut().insert(method, value);
        }

        /// A `identity.recordPut` of the record of `events`' identity is kept, as the executor
        /// and the store keep it: an envelope sent with an empty `sig` is signed by `d1`, the
        /// executor's device key in [`executor_with`]'s log; `identity.record` answers it from
        /// then on, its receipt signed by [`store_key`] at the log's head; the put answers its
        /// version. So a flow that writes twice reads its own first write.
        fn keep_puts(&self, events: &[Event]) {
            *self.keeps_record.borrow_mut() = Some(events.to_vec());
            // A record key the client drew opens only with `d1`'s secret, not a fixed answer.
            self.canned.borrow_mut().remove("identity.unwrapRecordKey");
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
                return Err(answered(*code, message));
            }
            if let Some(value) = self.canned.borrow().get(method) {
                return Ok(value.clone());
            }
            match method {
                "identity.status" => {
                    let held = self.held.borrow().clone();
                    // An executor that keeps the record unwraps its key with `d1`'s enc secret,
                    // the enc key the log lists for `d1`, so it answers that one.
                    let enc = match self.keeps_record.borrow().is_some() {
                        true => ad4m_identity_core::x25519_multikey_of(
                            &ad4m_identity_core::X25519Secret::from(
                                crate::keylog::tests::D1_ENC_SECRET,
                            ),
                        ),
                        false => ad4m_identity_core::encode_x25519_multikey(&[6u8; 32]),
                    };
                    Ok(json!({
                        "did": held.as_deref().map(did_of),
                        "deviceKey": Signer::key(&self.device),
                        "deviceEnc": enc,
                        "keyId": held.map(|_| "d1"),
                        "revoked": null,
                        "head": null,
                        "fork": null,
                        "store": self.store.borrow().clone(),
                        "vouched": self.vouched.get(),
                    }))
                }
                "identity.powParams" => Ok(json!({
                    "bits": self.pow_bits.get(),
                    "challenge": { "nonce": "test-challenge", "expires": 4_000_000_000u64 },
                })),
                "identity.attachNote" => {
                    if self.held.borrow().is_none() {
                        return Err(answered(
                            409,
                            "no-identity: the agent speaks for no identity",
                        ));
                    }
                    if self.vouched.replace(true) {
                        return Err(answered(
                            409,
                            "already-vouched: the store keeps a note for it already",
                        ));
                    }
                    let held = self.held.borrow().clone().unwrap_or_default();
                    Ok(json!({
                        "did": did_of(&held), "method": "email", "time": 0,
                        "voucher": "did:key:zVoucher", "sig": "s",
                    }))
                }
                "identity.cosignIncept" => {
                    if self.refuse_cosign.get() {
                        return Err(RpcError {
                            code: 500,
                            message: "the keystore is locked".into(),
                            data: None,
                        });
                    }
                    let mut event = Event::from_json(&p["event"]).unwrap();
                    cosign(&mut event, "d1", &self.device).unwrap();
                    Ok(serde_json::to_value(&event).unwrap())
                }
                // The store takes any offer, answering its id as it does.
                "identity.openOffer" => Ok(json!({
                    "offerId": p["signedOffer"]["offer"]["offerId"].clone(),
                })),
                "identity.unwrapRecordKey" if self.keeps_record.borrow().is_some() => {
                    let events = self.keeps_record.borrow().clone().unwrap();
                    let secret =
                        ad4m_identity_core::X25519Secret::from(crate::keylog::tests::D1_ENC_SECRET);
                    let key = ad4m_identity_core::record::unwrap_key(
                        p["wrapped"].as_str().unwrap(),
                        &events[0].scid,
                        &secret,
                    )
                    .unwrap();
                    Ok(json!({ "key": bs58::encode(*key).into_string() }))
                }
                "identity.recordPut" if self.keeps_record.borrow().is_some() => {
                    let events = self.keeps_record.borrow().clone().unwrap();
                    let chain = ad4m_identity_core::fold(&events).unwrap();
                    let mut sealed: ad4m_identity_core::record::SealedRecord =
                        serde_json::from_value(p["record"].clone()).unwrap();
                    if sealed.sig.is_empty() {
                        let d1 = KeySigner::new(&[2u8; 32], 0);
                        ad4m_identity_core::record::sign_envelope(&chain, &mut sealed, &d1)
                            .unwrap();
                    }
                    let receipt = ad4m_identity_core::record::sign_receipt(
                        chain.id(),
                        &sealed,
                        chain.head().seq,
                        &store_key(),
                    )
                    .unwrap();
                    self.answer(
                        "identity.record",
                        json!({ "record": sealed, "receipt": receipt }),
                    );
                    Ok(json!({ "version": sealed.version }))
                }
                "identity.publish" => {
                    if let Some((code, message)) = self.refuse_for_good.borrow().clone() {
                        return Err(answered(code, &message));
                    }
                    if self.refuse_publish.replace(false) {
                        return Err(RpcError {
                            code: 503,
                            message: "the store did not answer".into(),
                            data: None,
                        });
                    }
                    let event = Event::from_json(&p["events"][0]).unwrap();
                    // The store's brake: a new log (#0) carries a proof of work at its cost.
                    if event.seq == 0 {
                        let pow: Option<ad4m_identity_core::pow::Pow> =
                            serde_json::from_value(p["pow"].clone()).ok();
                        let passes = pow.is_some_and(|pow| {
                            pow.bits >= self.pow_bits.get()
                                && ad4m_identity_core::pow::check(
                                    &event.scid,
                                    &pow,
                                    self.pow_bits.get(),
                                )
                        });
                        if !passes {
                            return Err(answered(403, "forbidden: \"pow\""));
                        }
                    }
                    self.publishes.set(self.publishes.get() + 1);
                    *self.held.borrow_mut() = Some(event.scid.clone());
                    Ok(json!({
                        "scid": event.scid, "seq": 0, "hash": "h", "time": 0,
                        "store": "did:key:zStore", "sig": "s",
                    }))
                }
                // Ends the code `identity.prepareDevice` gave, with no claim of it: a test that
                // sees a claim cancelled by the end answers it.
                "identity.endPrepared"
                    if self
                        .canned
                        .borrow()
                        .get("identity.prepareDevice")
                        .is_some_and(|prepared| prepared["device"] == p["device"]) =>
                {
                    Ok(json!({ "state": "ended", "cancelled": [] }))
                }
                other => Err(RpcError {
                    code: 404,
                    message: format!("no {other}"),
                    data: None,
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
            .finish(
                &executor,
                &vault.unlocking(pass()),
                this_computer(None, true, Some((0, VaultId([1; 16])))),
                &CLOCK,
                &RANDOM,
            )
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
            .finish(
                &executor,
                &vault.unlocking(pass()),
                this_computer(None, true, Some((0, VaultId([1; 16])))),
                &CLOCK,
                &RANDOM,
            )
            .await;
        let Err(e @ ClientError::CreatePending(did)) = &other else {
            panic!("{other:?}");
        };
        assert_eq!(*did, did_of(&scid));
        let Screen::Failed { message } = failed(e) else {
            unreachable!()
        };
        assert!(message.contains(did.as_str()), "{message}");

        // Finishing it publishes the same incept, with no unlock, and forgets it. A state read and a
        // step that finish it at the same time publish it once.
        executor
            .rpc()
            .delay("identity.publish", Duration::from_millis(50));
        let (created, also, ()) = tokio::join!(
            finish_pending(&executor, &vault),
            finish_pending(&executor, &vault),
            finish_pending_quietly(&executor, &vault),
        );
        executor.rpc().delays.borrow_mut().clear();
        assert!(also.unwrap().is_none(), "the second finish found it done");
        let created = created.unwrap().expect("a pending identity");
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
    async fn the_public_state_names_an_identity_made_here_and_not_published_yet() {
        let dir = tempfile::tempdir().unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().refuse_publish.set(true);
        let vault = open_vault(dir.path());
        let failed_create = confirmed(24)
            .finish(
                &executor,
                &vault.unlocking(pass()),
                this_computer(None, true, Some((0, VaultId([1; 16])))),
                &CLOCK,
                &RANDOM,
            )
            .await;
        assert!(failed_create.is_err(), "{failed_create:?}");
        let scid = vault.pending_incepts().unwrap()[0].scid.clone();

        // The publish is still refused: no identity yet, but the one made here is named, so the
        // main window can say it was made rather than that nothing changed.
        executor.rpc().refuse_publish.set(true);
        let public = public_state_on(Some(&executor), &vault).await;
        assert_eq!(public.did, None);
        assert_eq!(public.pending.as_deref(), Some(did_of(&scid).as_str()));
        let wire = serde_json::to_value(&public).unwrap();
        assert_eq!(wire["pending"], json!(did_of(&scid)));

        // With no executor nothing is known, so nothing is claimed.
        let unknown = public_state_on::<FakeExecutor>(None, &vault).await;
        assert_eq!(unknown.pending, None);

        // Once the store takes it, the state asking finishes it: published, nothing pending.
        let public = public_state_on(Some(&executor), &vault).await;
        assert_eq!(public.did.as_deref(), Some(did_of(&scid).as_str()));
        assert_eq!(public.pending, None);
    }

    #[tokio::test]
    async fn a_create_that_publishes_leaves_nothing_pending() {
        let dir = tempfile::tempdir().unwrap();
        let executor = ViaExecutor::new(FakeExecutor::new());
        let vault = open_vault(dir.path());
        let created = confirmed(23)
            .finish(
                &executor,
                &vault.unlocking(pass()),
                this_computer(None, true, Some((0, VaultId([1; 16])))),
                &CLOCK,
                &RANDOM,
            )
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
            pending: None,
            holds_master: Some(HoldsMaster { index: Some(0) }),
            unlock: "passphrase",
            blocked: Some(NO_STORE.into()),
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
            enc_mismatch: true,
            cloud_url: "https://cloud.example.org".into(),
        })
        .unwrap();
        assert_eq!(public["devices"][0]["keyId"], "d1");
        assert_eq!(public["devices"][0]["kind"], "desktop-app");
        assert_eq!(public["devices"][0]["holdsMaster"], "offered");
        assert_eq!(public["requests"][0]["kind"], "send-master");
        assert_eq!(public["requests"][0]["keyIds"], json!([]));
        assert_eq!(public["masterWaiting"], true);
        assert_eq!(public["encMismatch"], true);
        assert_eq!(public["cloudUrl"], "https://cloud.example.org");
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
        let input: StepInput =
            serde_json::from_str(r#"{"kind":"email","email":"a@example.org"}"#).unwrap();
        assert_eq!(format!("{input:?}"), "email");
        let input: StepInput =
            serde_json::from_str(r#"{"kind":"email-code","code":"123456"}"#).unwrap();
        assert_eq!(format!("{input:?}"), "email-code");
    }

    // ─── the proof of work ───

    #[test]
    fn the_new_screens_and_inputs_cross_ipc_in_the_shapes_the_window_expects() {
        let step: IdentityStep = serde_json::from_str(r#"{"kind":"check-email"}"#).unwrap();
        assert_eq!(step, IdentityStep::CheckEmail);
        assert_eq!(
            serde_json::to_value(Screen::Preparing { bits: 22 }).unwrap(),
            json!({ "screen": "preparing", "bits": 22 })
        );
        assert_eq!(
            serde_json::to_value(Screen::IdentityReady {
                did: "did:scid:coasys:1:Qm".into(),
                key_id: "d1".into(),
                vouched: false,
            })
            .unwrap(),
            json!({ "screen": "identity-ready", "did": "did:scid:coasys:1:Qm", "keyId": "d1", "vouched": false })
        );
        assert_eq!(
            serde_json::to_value(Screen::EnterEmailCode {
                email: "a@example.org".into(),
                error: None,
            })
            .unwrap(),
            json!({ "screen": "enter-email-code", "email": "a@example.org", "error": null })
        );
        assert_eq!(
            serde_json::to_value(Screen::EnterEmail { error: None }).unwrap()["screen"],
            "enter-email"
        );
        let checked = Screen::EmailChecked {
            did: "did:scid:coasys:1:Qm".into(),
        };
        assert_eq!(
            serde_json::to_value(&checked).unwrap()["screen"],
            "email-checked"
        );
        assert_eq!(checked.outcome(), Some(StepOutcome::Done));
        assert_eq!(Screen::Preparing { bits: 22 }.outcome(), None);
        for (text, name) in [
            (r#"{"kind":"wait-created"}"#, "wait-created"),
            (r#"{"kind":"new-code"}"#, "new-code"),
            (r#"{"kind":"change-email"}"#, "change-email"),
        ] {
            let input: StepInput = serde_json::from_str(text).unwrap();
            assert_eq!(format!("{input:?}"), name);
        }
    }

    /// A first run: the words, the passphrase, then `Preparing` at the store's cost while the
    /// proof is solved, and the incept is published with that proof.
    #[tokio::test]
    async fn a_create_publishes_its_incept_with_a_proof_at_the_stores_cost() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().pow_bits.set(10);
        let vault = memory_vault(crate::store::StoreKind::File);
        let screens = run_create_on(&executor, &vault, |window, first| async move {
            let preparing = to_the_passphrase(&window, first).await;
            let ready = window.step(StepInput::WaitCreated).await;
            vec![preparing, ready]
        })
        .await;
        assert_eq!(screens[0], Screen::Preparing { bits: 10 });
        let Screen::IdentityReady { did, vouched, .. } = &screens[1] else {
            panic!("{screens:?}");
        };
        assert!(!vouched, "a new identity has no vouch note");
        // No `identity.status` follows the publish: a new identity has no note to ask after.
        let seen = executor.rpc().seen.borrow();
        let published = seen
            .iter()
            .position(|(m, _)| m == "identity.publish")
            .expect("the identity was published");
        assert!(
            seen[published..]
                .iter()
                .all(|(m, _)| m != "identity.status"),
            "{seen:?}"
        );
        drop(seen);
        assert_eq!(executor.rpc().publishes.get(), 1);
        let publish = &executor.rpc().called("identity.publish")[0];
        let pow: ad4m_identity_core::pow::Pow =
            serde_json::from_value(publish["pow"].clone()).unwrap();
        let scid = ad4m_identity_core::scid_of(did).unwrap();
        assert_eq!(pow.bits, 10);
        assert!(ad4m_identity_core::pow::check(scid, &pow, 10));
        assert!(vault.pending_incepts().unwrap().is_empty());
    }

    /// A cost above what the app solves ends the create before the executor co-signs or the vault
    /// keeps anything: there is no identity left to finish.
    #[tokio::test]
    async fn a_cost_above_what_the_app_solves_is_refused_before_anything_is_kept() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        let too_many = ad4m_identity_client::pow::MAX_POW_BITS + 1;
        executor.rpc().pow_bits.set(too_many);
        let vault = memory_vault(crate::store::StoreKind::File);
        let screens = run_create_on(&executor, &vault, |window, first| async move {
            vec![to_the_passphrase(&window, first).await]
        })
        .await;
        let Screen::Failed { message } = &screens[0] else {
            panic!("{screens:?}");
        };
        assert!(message.contains(&format!("{too_many} bits")), "{message}");
        assert!(message.ends_with("Nothing was made."), "{message}");
        assert!(executor.rpc().called("identity.cosignIncept").is_empty());
        assert!(vault.pending_incepts().unwrap().is_empty());
        assert_eq!(executor.rpc().publishes.get(), 0);
    }

    /// A store that refuses the proof (its cost went up meanwhile) leaves an identity to finish,
    /// not one refused for good: the next create solves a new proof and publishes it.
    #[tokio::test]
    async fn a_refused_proof_is_finished_with_a_new_one_on_the_next_try() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor
            .rpc()
            .refuse("identity.publish", 403, "forbidden: \"pow\"");
        let vault = memory_vault(crate::store::StoreKind::File);
        let screens = run_create_on(&executor, &vault, |window, first| async move {
            vec![write_down(&window, first).await]
        })
        .await;
        let Screen::Failed { message } = &screens[0] else {
            panic!("{screens:?}");
        };
        assert!(
            message.contains("did not accept the proof of work"),
            "{message}"
        );
        assert!(
            message.contains("the same identity will be finished"),
            "{message}"
        );
        assert_eq!(vault.pending_incepts().unwrap().len(), 1);

        executor.rpc().refusals.borrow_mut().clear();
        let screens = run_create_on(&executor, &vault, |_, first| async move { vec![first] }).await;
        assert!(
            matches!(&screens[0], Screen::IdentityReady { vouched: false, .. }),
            "{screens:?}"
        );
        assert_eq!(executor.rpc().publishes.get(), 1);
        assert!(vault.pending_incepts().unwrap().is_empty());
    }

    /// A cancel while the identity is made cannot stop it: the window is told how it ended.
    #[tokio::test]
    async fn a_cancel_while_the_identity_is_made_shows_how_it_ended() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        let vault = memory_vault(crate::store::StoreKind::File);
        let screens = run_create_on(&executor, &vault, |window, first| async move {
            let preparing = to_the_passphrase(&window, first).await;
            let (tx, rx) = oneshot::channel();
            window.tx.send(Request::Cancel(tx)).unwrap();
            let shown = rx
                .await
                .unwrap()
                .expect("the cancel answers the screen to show");
            vec![preparing, shown]
        })
        .await;
        assert!(matches!(screens[0], Screen::Preparing { .. }));
        assert!(
            matches!(screens[1], Screen::IdentityReady { .. }),
            "{screens:?}"
        );
        assert_eq!(executor.rpc().publishes.get(), 1);
    }

    /// The four answers of the executor this flow acts on are read in `refusal`, and nowhere else.
    #[test]
    fn a_refusal_is_read_from_the_executors_answer_in_one_place() {
        let rpc = |code: u16, data: Value| RpcError {
            code,
            message: "the words do not matter".into(),
            data: Some(data),
        };
        assert_eq!(
            refusal(&rpc(
                429,
                json!({ "error": "rate-limited", "scope": "address", "retryAfter": 3600 })
            )),
            Some(Refusal::Wait(3600))
        );
        // A rate limit that names no wait is none this flow can act on.
        assert_eq!(refusal(&rpc(429, json!({ "error": "rate-limited" }))), None);
        assert_eq!(
            refusal(&rpc(403, json!({ "error": "forbidden", "reason": "pow" }))),
            Some(Refusal::Proof)
        );
        assert_eq!(
            refusal(&rpc(
                403,
                json!({ "error": "forbidden", "reason": "vouch" })
            )),
            None
        );
        assert_eq!(
            refusal(&rpc(409, json!({ "error": "already-vouched" }))),
            Some(Refusal::AlreadyVouched)
        );
        assert_eq!(
            refusal(&rpc(409, json!({ "error": "no-identity" }))),
            Some(Refusal::NoIdentity)
        );
        // The same data under another code is another refusal.
        assert_eq!(
            refusal(&rpc(500, json!({ "error": "already-vouched" }))),
            None
        );
    }

    /// The English message alone is no refusal: an answer without `error.data` (an executor from
    /// before the data was sent) is quoted, never parsed.
    #[test]
    fn the_english_message_alone_is_no_refusal() {
        for (code, message) in [
            (429, "rate-limited: Address, retry after 3600 s"),
            (403, "forbidden: \"pow\""),
            (409, "already-vouched: the store keeps a note for x already"),
            (409, "no-identity: the agent speaks for no identity"),
        ] {
            let bare = RpcError {
                code,
                message: message.into(),
                data: None,
            };
            assert_eq!(refusal(&bare), None, "{message}");
        }
    }

    #[test]
    fn a_rate_limit_says_how_long_to_wait_and_once() {
        let limited = |seconds: u64| {
            ClientError::Rpc(answered(
                429,
                &format!("rate-limited: Address, retry after {seconds} s"),
            ))
        };
        for (seconds, wait) in [
            (20, "1 minute"),
            (90, "2 minutes"),
            (3600, "60 minutes"),
            (3601, "2 hours"),
            (86_400, "24 hours"),
        ] {
            let Screen::Failed { message } = failed(&limited(seconds)) else {
                unreachable!()
            };
            assert_eq!(
                message,
                format!("The identity store has had too many requests. Try again in {wait}.")
            );
        }
        let Screen::Failed { message } = unfinished(&limited(600)) else {
            unreachable!()
        };
        assert!(message.contains("Try again in 10 minutes."), "{message}");
        assert!(!message.contains("in a moment"), "{message}");
        // A 429 that names no wait is quoted as the executor says it.
        let Screen::Failed { message } = failed(&ClientError::Rpc(answered(429, "too many")))
        else {
            unreachable!()
        };
        assert!(message.ends_with("answered: too many."), "{message}");
    }

    #[test]
    fn a_cost_too_high_and_a_refused_proof_read_as_sentences() {
        let Screen::Failed { message } = failed(&ClientError::PowTooCostly(30)) else {
            unreachable!()
        };
        assert_eq!(
            message,
            "The identity store asks for more work than this app does to make an identity (30 \
             bits; at most 28). Try again later."
        );
        let Screen::Failed { message } = unfinished(&ClientError::PowTooCostly(30)) else {
            unreachable!()
        };
        assert!(!message.contains("in a moment"), "{message}");
        let Screen::Failed { message } =
            failed(&ClientError::Rpc(answered(403, "forbidden: \"pow\"")))
        else {
            unreachable!()
        };
        assert_eq!(
            message,
            "The identity store did not accept the proof of work. Try again."
        );
    }

    // ─── the email check ───

    /// Runs [`check_email_on`] with the fake executor and `platform`, `window` driving it.
    async fn run_check_email_on<F, Fut>(
        executor: &ViaExecutor<FakeExecutor>,
        platform: &crate::platform::Platform,
        window: F,
    ) -> Vec<Screen>
    where
        F: FnOnce(Window, Screen) -> Fut,
        Fut: std::future::Future<Output = Vec<Screen>>,
    {
        let vault = memory_vault(crate::store::StoreKind::File);
        let (address, mut rx, mut reply, window_side, first) = opened();
        let ((), screens) = tokio::join!(
            check_email_on(executor, platform, &vault, &address, &mut rx, &mut reply),
            async move {
                let first = first.await.unwrap().unwrap();
                window(window_side, first).await
            }
        );
        screens
    }

    fn code_error(screen: &Screen) -> Option<&str> {
        match screen {
            Screen::EnterEmailCode { error, .. } | Screen::EnterEmail { error } => error.as_deref(),
            _ => None,
        }
    }

    #[tokio::test]
    async fn the_email_check_attaches_the_note_the_platforms_token_gives() {
        let executor = linked_executor();
        let did = did_of(LINKED_SCID);
        let (platform, taken) = crate::platform::tests::fake_platform(vec![
            (202, json!({})),
            (200, json!({ "token": "vouch-token-1" })),
        ])
        .await;
        let screens = run_check_email_on(&executor, &platform, |window, first| async move {
            let bad = window
                .step(StepInput::Email {
                    email: "not an address".into(),
                })
                .await;
            let code = window
                .step(StepInput::Email {
                    email: " a@example.org ".into(),
                })
                .await;
            let short = window
                .step(StepInput::EmailCode { code: "123".into() })
                .await;
            let done = window
                .step(StepInput::EmailCode {
                    code: "123 456".into(),
                })
                .await;
            vec![first, bad, code, short, done]
        })
        .await;
        assert_eq!(screens[0], Screen::EnterEmail { error: None });
        assert!(code_error(&screens[1]).is_some_and(|e| e.contains("not an email address")));
        assert_eq!(
            screens[2],
            Screen::EnterEmailCode {
                email: "a@example.org".into(),
                error: None
            }
        );
        assert!(code_error(&screens[3]).is_some_and(|e| e.contains("6 digits")));
        assert_eq!(screens[4], Screen::EmailChecked { did: did.clone() });
        // The platform saw the address and the identity, then the code without its space.
        assert_eq!(
            *taken.lock().unwrap(),
            vec![
                (
                    "/api/vouch/email/start".to_string(),
                    json!({ "email": "a@example.org", "did": did })
                ),
                (
                    "/api/vouch/email/verify".to_string(),
                    json!({ "email": "a@example.org", "did": did, "code": "123456" })
                ),
            ]
        );
        // The token went to the executor, and nowhere else.
        assert_eq!(
            executor.rpc().called("identity.attachNote"),
            vec![json!({ "token": "vouch-token-1" })]
        );
        assert!(executor.rpc().vouched.get());
    }

    #[tokio::test]
    async fn each_refusal_of_a_code_is_said_and_the_check_goes_on() {
        let executor = linked_executor();
        let (platform, taken) = crate::platform::tests::fake_platform(vec![
            (202, json!({})),
            (400, json!({ "error": "code", "triesLeft": 2 })),
            (400, json!({ "error": "code", "triesLeft": 1 })),
            (429, json!({ "error": "tries" })),
            (202, json!({})),
            (410, json!({ "error": "expired" })),
            (409, json!({ "error": "already-vouched" })),
            (202, json!({})),
        ])
        .await;
        let screens = run_check_email_on(&executor, &platform, |window, _| async move {
            let mut shown = vec![];
            let code = || StepInput::EmailCode {
                code: "000000".into(),
            };
            window
                .step(StepInput::Email {
                    email: "a@example.org".into(),
                })
                .await;
            shown.push(window.step(code()).await);
            shown.push(window.step(code()).await);
            shown.push(window.step(code()).await);
            shown.push(window.step(StepInput::NewCode).await);
            shown.push(window.step(code()).await);
            shown.push(window.step(code()).await);
            shown.push(
                window
                    .step(StepInput::Email {
                        email: "b@example.org".into(),
                    })
                    .await,
            );
            shown.push(window.step(StepInput::ChangeEmail).await);
            shown
        })
        .await;
        let errors: Vec<Option<&str>> = screens.iter().map(code_error).collect();
        assert_eq!(
            errors,
            vec![
                Some("That code is wrong. 2 tries left."),
                Some("That code is wrong. 1 try left."),
                Some("Too many wrong codes. Send a new code."),
                None,
                Some("That code has expired. Send a new code."),
                Some("This email address already checks another identity. Use another address."),
                None,
                None,
            ]
        );
        assert!(
            matches!(&screens[3], Screen::EnterEmailCode { email, .. } if email == "a@example.org")
        );
        assert!(matches!(screens[5], Screen::EnterEmail { .. }));
        assert!(
            matches!(&screens[6], Screen::EnterEmailCode { email, .. } if email == "b@example.org")
        );
        assert_eq!(screens[7], Screen::EnterEmail { error: None });
        assert_eq!(taken.lock().unwrap().len(), 8);
        assert!(executor.rpc().called("identity.attachNote").is_empty());
    }

    #[tokio::test]
    async fn each_refusal_of_the_note_is_said() {
        let did = did_of(LINKED_SCID);
        for (code, message, expected) in [
            (
                403,
                "forbidden: \"vouch\"",
                Some("That code cannot be used now. Send a new code."),
            ),
            (
                503,
                "unavailable: no vouching service answers",
                Some(CHECKS_UNAVAILABLE),
            ),
            (400, "invalid: a bad token", None),
        ] {
            let executor = linked_executor();
            executor.rpc().refuse("identity.attachNote", code, message);
            let (platform, _) = crate::platform::tests::fake_platform(vec![
                (202, json!({})),
                (200, json!({ "token": "t" })),
            ])
            .await;
            let screens = run_check_email_on(&executor, &platform, |window, _| async move {
                window
                    .step(StepInput::Email {
                        email: "a@example.org".into(),
                    })
                    .await;
                vec![
                    window
                        .step(StepInput::EmailCode {
                            code: "123456".into(),
                        })
                        .await,
                ]
            })
            .await;
            let Screen::EnterEmailCode {
                error: Some(error), ..
            } = &screens[0]
            else {
                panic!("{screens:?}");
            };
            match expected {
                Some(expected) => assert_eq!(error, expected),
                None => assert!(error.contains("invalid: a bad token"), "{error}"),
            }
        }

        // A note another app attached first: the check is done.
        for (code, message, ends) in [
            (
                409,
                "already-vouched: the store keeps a note already",
                Screen::EmailChecked { did: did.clone() },
            ),
            (
                409,
                "no-identity: the agent speaks for no identity",
                Screen::Failed {
                    message: NO_IDENTITY_TO_CHECK.into(),
                },
            ),
        ] {
            let executor = linked_executor();
            executor.rpc().refuse("identity.attachNote", code, message);
            let (platform, _) = crate::platform::tests::fake_platform(vec![
                (202, json!({})),
                (200, json!({ "token": "t" })),
            ])
            .await;
            let screens = run_check_email_on(&executor, &platform, |window, _| async move {
                window
                    .step(StepInput::Email {
                        email: "a@example.org".into(),
                    })
                    .await;
                vec![
                    window
                        .step(StepInput::EmailCode {
                            code: "123456".into(),
                        })
                        .await,
                ]
            })
            .await;
            assert_eq!(screens[0], ends);
        }
    }

    #[tokio::test]
    async fn an_identity_already_vouched_or_none_asks_for_no_email() {
        let (platform, taken) = crate::platform::tests::fake_platform(vec![]).await;
        let executor = linked_executor();
        executor.rpc().vouched.set(true);
        let screens =
            run_check_email_on(&executor, &platform, |_, first| async move { vec![first] }).await;
        assert_eq!(
            screens,
            vec![Screen::EmailChecked {
                did: did_of(LINKED_SCID)
            }]
        );
        let executor = ViaExecutor::new(FakeExecutor::new());
        let screens =
            run_check_email_on(&executor, &platform, |_, first| async move { vec![first] }).await;
        assert_eq!(
            screens,
            vec![Screen::Failed {
                message: NO_IDENTITY_TO_CHECK.into()
            }]
        );
        assert!(taken.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_platform_that_does_not_answer_is_said_and_not_now_ends_the_check() {
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let platform = crate::platform::Platform::new(&format!("http://127.0.0.1:{port}"));
        let executor = linked_executor();
        let screens = run_check_email_on(&executor, &platform, |window, _| async move {
            let unreachable = window
                .step(StepInput::Email {
                    email: "a@example.org".into(),
                })
                .await;
            // "Not now": the check ends with nothing changed.
            let (tx, rx) = oneshot::channel();
            window.tx.send(Request::Cancel(tx)).unwrap();
            assert_eq!(rx.await.unwrap(), None);
            vec![unreachable]
        })
        .await;
        assert_eq!(
            screens,
            vec![Screen::EnterEmail {
                error: Some(
                    "Could not reach the email check service. Check your connection and try again."
                        .into()
                )
            }]
        );
        assert!(!executor.rpc().vouched.get());
    }

    #[test]
    fn an_email_and_a_code_are_checked_for_their_form_only() {
        for good in ["a@example.org", "first.last+tag@mail.example.co.uk"] {
            assert_eq!(email_problem(good), None, "{good}");
        }
        for bad in [
            "",
            "a",
            "a@",
            "@example.org",
            "a@example",
            "a b@example.org",
            "a@@example.org",
            "a@example..org",
        ] {
            assert!(email_problem(bad).is_some(), "{bad}");
        }
        assert_eq!(email_code(" 123-456 ").as_deref(), Some("123456"));
        assert_eq!(email_code("12345"), None);
        assert_eq!(email_code("12345a"), None);
    }

    // Every device reads the record, so an unnamed computer is written by what it is: "This
    // computer" on the phone's Devices page named the phone's host as the phone itself.
    #[test]
    fn an_unnamed_computer_is_written_by_what_it_is_never_as_this_computer() {
        assert_eq!(computer_name("macos"), "Mac");
        assert_eq!(computer_name("windows"), "Windows PC");
        assert_eq!(computer_name("linux"), "Linux computer");
        assert_eq!(computer_name("freebsd"), "Computer");
        let entry = this_computer(None, true, Some((0, VaultId([1; 16]))));
        assert_eq!(entry.name, computer_name(std::env::consts::OS));
        assert_ne!(entry.name, "This computer");
        assert_eq!(entry.kind, DeviceKind::DesktopApp);
        assert_eq!(
            this_computer(Some("Studio".into()), false, None).name,
            "Studio"
        );
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

    /// The executor's error answer as ad4m sends it: the code and the message, and, for the four
    /// refusals the flow acts on, `error.data` (`IdentityService`'s `refusal` data). The message
    /// here only chooses which refusal; `refusal` itself never reads it.
    fn answered(code: u16, message: &str) -> RpcError {
        let data = match (code, message) {
            (429, m) => m
                .split_once("retry after ")
                .and_then(|(_, after)| after.split_whitespace().next()?.parse::<u64>().ok())
                .map(|seconds| {
                    json!({ "error": "rate-limited", "scope": "address", "retryAfter": seconds })
                }),
            (403, "forbidden: \"pow\"") => Some(json!({ "error": "forbidden", "reason": "pow" })),
            (409, m) if m.starts_with("already-vouched") => {
                Some(json!({ "error": "already-vouched" }))
            }
            (409, m) if m.starts_with("no-identity") => Some(json!({ "error": "no-identity" })),
            _ => None,
        };
        RpcError {
            code,
            message: message.into(),
            data,
        }
    }

    #[async_trait::async_trait(?Send)]
    impl ExecutorRpc for OldExecutor {
        async fn call(&self, _: &str, _: Value) -> Result<Value, RpcError> {
            Ok(json!({ "did": null, "deviceKey": "z6Mk", "deviceEnc": "z6LS", "vouched": false }))
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
                Some(NO_STORE.into())
            );
        }
        assert_eq!(
            public_state_on::<FakeExecutor>(None, &vault).await.blocked,
            None
        );
    }

    /// A store that answers everything but the enc key's claim: a Secret Service whose collection
    /// will not unlock, say.
    struct NoClaims(crate::store::MemoryStore);

    impl crate::store::SecretStore for NoClaims {
        fn kind(&self) -> crate::store::StoreKind {
            self.0.kind()
        }
        fn kind_of(&self, n: &str) -> Result<crate::store::StoreKind, VaultError> {
            self.0.kind_of(n)
        }
        fn put(&self, n: &str, b: &[u8]) -> Result<(), VaultError> {
            self.0.put(n, b)
        }
        fn get(&self, n: &str) -> Result<Option<Vec<u8>>, VaultError> {
            self.0.get(n)
        }
        fn contains(&self, n: &str) -> Result<bool, VaultError> {
            self.0.contains(n)
        }
        fn delete(&self, n: &str) -> Result<(), VaultError> {
            self.0.delete(n)
        }
        fn claim_public(&self, n: &str, b: &[u8]) -> Result<bool, VaultError> {
            self.0.claim_public(n, b)
        }
        fn claim_secret(
            &self,
            _: &str,
            _: &[u8],
        ) -> Result<zeroize::Zeroizing<Vec<u8>>, VaultError> {
            Err(VaultError::Unavailable(
                "Secret Service: the collection would not unlock".into(),
            ))
        }
    }

    /// An executor that answers while the store cannot keep this computer's enc key is not
    /// offline: the main window is told why nothing can be done, in a step's own words.
    #[tokio::test]
    async fn a_store_that_cannot_keep_the_enc_key_reaches_the_person_not_offline() {
        let vault = DesktopVault::new(
            Box::new(NoClaims(crate::store::MemoryStore::new())),
            PendingIncepts::memory(),
        );
        let fake = FakeExecutor::new();
        let device_key = Signer::key(&fake.device).as_str().to_string();
        let public = public_state_reached(fake, &device_key, &vault).await;
        let blocked = public.blocked.expect("the person is told");
        assert_eq!(
            blocked,
            "This computer could not keep the key that opens your master key: the vault is \
             unavailable: Secret Service: the collection would not unlock"
        );
        // The step's own refusal is the same words.
        assert_eq!(
            with_enc_key(FakeExecutor::new(), &device_key, &vault).err(),
            Some(blocked.clone())
        );
        // And it crosses to the main window as the reason, where `NO_STORE` does.
        let json = serde_json::to_value(CustodyPublic {
            blocked: Some(blocked.clone()),
            ..public_state_on::<FakeExecutor>(None, &vault).await
        })
        .unwrap();
        assert_eq!(json["blocked"], blocked);

        // A store that keeps it: not blocked, and the executor's state is read.
        let vault = DesktopVault::new(
            Box::new(crate::store::MemoryStore::new()),
            PendingIncepts::memory(),
        );
        let public = public_state_reached(FakeExecutor::new(), &device_key, &vault).await;
        assert_eq!(public.blocked, None);
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
            data: None,
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
        let rpc = |code, message: &str| ClientError::Rpc(answered(code, message));
        let did = "did:scid:coasys:1:Qm";
        for transient in [
            rpc(503, "unavailable: the store did not answer"),
            rpc(429, "rate-limited: Ip, retry after 30 s"),
            rpc(502, "bad-head-signature: the store's head is not signed"),
            // The store's cost went up after the proof was solved: a new proof can pass.
            rpc(403, "forbidden: \"pow\""),
            ClientError::Vault(VaultError::Unavailable("locked".into())),
        ] {
            assert!(refused_for_good(&transient, did).is_none(), "{transient:?}");
        }
        let (_, key) = refused_for_good(&rpc(409, "key-taken: z6Mk sits in a log"), did).unwrap();
        assert!(key);
        for permanent in [
            rpc(409, "conflict: the store's head is seq 3 (h)"),
            rpc(400, "invalid: bad proof"),
            rpc(403, "forbidden: \"cosig\""),
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
            .finish(
                &executor,
                &vault.unlocking(pass()),
                this_computer(None, true, Some((0, VaultId([1; 16])))),
                &CLOCK,
                &RANDOM,
            )
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
            .finish(
                &executor,
                &vault.unlocking(pass()),
                this_computer(None, true, Some((0, VaultId([1; 16])))),
                &CLOCK,
                &RANDOM,
            )
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
            .finish(
                &executor,
                &vault.unlocking(pass()),
                this_computer(None, true, Some((0, VaultId([1; 16])))),
                &CLOCK,
                &RANDOM,
            )
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

    /// From the words to the passphrase, as a person does it: the screen after the passphrase, and
    /// past `Preparing` the screen the create ends on, as the window waits for it.
    async fn write_down(window: &Window, first: Screen) -> Screen {
        let next = to_the_passphrase(window, first).await;
        match next {
            Screen::Preparing { .. } => window.step(StepInput::WaitCreated).await,
            other => other,
        }
    }

    /// [`write_down`] up to the screen after the passphrase.
    async fn to_the_passphrase(window: &Window, first: Screen) -> Screen {
        let Screen::ShowWords { words } = first else {
            panic!("{first:?}");
        };
        let Screen::ConfirmWords { positions, .. } = window.step(StepInput::WordsWritten).await
        else {
            panic!("expected the confirm screen");
        };
        let answers = [
            words[positions[0] - 1].clone().into(),
            words[positions[1] - 1].clone().into(),
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

    /// [`show_code_on`] on its own, without the service around it: its state reads its own, every
    /// one answered once the flow ends.
    async fn show_code_alone(
        executor: &ViaExecutor<FakeExecutor>,
        events: broadcast::Receiver<Value>,
        vault: &DesktopVault,
        address: &ExecutorAddress,
        rx: &mut Rx,
        reply: &mut Reply,
    ) {
        let mut reads = StateReads::new(vault, address);
        show_code_on(executor, events, &mut reads, rx, reply).await;
        reads.finish().await;
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

    /// The device `d2` of `keylog::tests::log_with_d2_enc`'s identity, which may keep the master
    /// key, its executor behind the custody enc adapter as [`connect`] puts it. The log lists `d2`
    /// with `listed` (this vault's custody enc key when `None`), and the executor's sealed inbox
    /// holds master #0 sealed to that key, as `m1`. Answers the identity's SCID.
    fn joined_executor(
        vault: &DesktopVault,
        listed: Option<String>,
    ) -> (ViaExecutor<WithEncKey<FakeExecutor>>, String) {
        use ad4m_identity_client::EncKey;
        use ad4m_identity_core::inbox::{seal, sign_payload, InboxAddress, InboxBody};
        use ad4m_identity_core::link::SignedBy;
        let d2 = KeySigner::new(&[4u8; 32], 0);
        let device_key = Signer::key(&d2);
        let custody = CustodyEncKey::for_device(vault.shared_store(), device_key.as_str()).unwrap();
        let enc = listed.unwrap_or_else(|| custody.enc().as_str().to_string());
        let (events, _) = crate::keylog::tests::log_with_d2_enc(true, enc.clone());
        let chain = ad4m_identity_core::fold(&events).unwrap();
        let scid = events[0].scid.clone();
        let fake = FakeExecutor {
            device: d2,
            ..FakeExecutor::new()
        };
        fake.answer(
            "identity.status",
            json!({
                "did": did_of(&scid),
                "deviceKey": device_key,
                // The executor's wallet key: the adapter answers the custody enc key instead.
                "deviceEnc": ad4m_identity_core::encode_x25519_multikey(&[6u8; 32]),
                "keyId": "d2",
                "revoked": null,
                "head": null,
                "fork": null,
                "store": { "url": "https://store.example", "trusted": true },
                "vouched": false,
            }),
        );
        fake.answer("identity.log", log_answer(&events));
        let master = words::master_key(&words::seed(&words::from_entropy(&[41u8; 16])), 0).unwrap();
        let payload = sign_payload(
            device_key,
            InboxBody::Master {
                did: did_of(&scid),
                index: 0,
                secret: bs58::encode(master.to_bytes()).into_string(),
            },
            CLOCK.now(),
            SignedBy {
                key_id: "m0".into(),
                kel_seq: 0,
                kel_hash: chain.hash_at(0).unwrap().clone(),
            },
            &master,
        )
        .unwrap();
        let address = InboxAddress::Joined {
            scid: scid.clone(),
            key_id: "d2".into(),
        };
        let sealed = seal(
            &ad4m_identity_core::Multikey::from(enc.as_str()),
            &address,
            &payload,
            &mut rand_core::OsRng,
        )
        .unwrap();
        fake.answer(
            "identity.inboxSealed",
            json!([{
                "id": "m1", "sealed": sealed, "scid": scid, "keyId": "d2",
                "storedAt": 0, "expires": CLOCK.now() + 300,
            }]),
        );
        // An acknowledged message is gone from the store.
        fake.answer("identity.inboxAck", json!({}));
        fake.answer_after("identity.inboxAck", "identity.inboxSealed", json!([]));
        let adapter = WithEncKey::new(fake, Box::new(custody), Box::new(SystemClock));
        (ViaExecutor::new(adapter), scid)
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async move {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                window.step(StepInput::WaitJoin).await
            }
        );
        assert!(
            matches!(&last, Screen::Failed { message } if message.contains("wasn't confirmed")),
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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
                matches!(screen, Screen::Failed { message } if message.contains("has closed")),
                "{screen:?}"
            );
        }
    }

    /// An accept the executor does not answer leaves the window able to cancel: the cancel ends
    /// the executor's claim and is answered, and the accept with it, without waiting on the accept.
    #[tokio::test]
    async fn a_cancel_while_the_accept_stalls_ends_the_claim() {
        tokio::time::pause();
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor
            .rpc()
            .delay("identity.acceptJoin", Duration::from_secs(3600));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(7200),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(7200), async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, accepted) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::Accept, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let asked = tokio::time::Instant::now();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let cancelled = cancelled.await.unwrap();
                (asked.elapsed(), cancelled, accepted.await.unwrap())
            })
        );
        let (took, cancelled, accepted) = answered.expect("the cancel was answered");
        assert!(took < CANCEL_WAIT, "{took:?}");
        assert_eq!(cancelled, None);
        assert!(
            matches!(accepted, Err(CustodyError::NoStep)),
            "{accepted:?}"
        );
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// The same, for an accept sent while a wait for the join is out: the cancel answers both.
    #[tokio::test]
    async fn a_cancel_while_an_accept_beside_a_wait_stalls_answers_both() {
        tokio::time::pause();
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor
            .rpc()
            .delay("identity.acceptJoin", Duration::from_secs(3600));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(7200),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(7200), async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitJoin, tx))
                    .unwrap();
                let (tx, accepted) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::Accept, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let asked = tokio::time::Instant::now();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let cancelled = cancelled.await.unwrap();
                (
                    asked.elapsed(),
                    cancelled,
                    waited.await.unwrap(),
                    accepted.await.unwrap(),
                )
            })
        );
        let (took, cancelled, waited, accepted) = answered.expect("the cancel was answered");
        assert!(took < CANCEL_WAIT, "{took:?}");
        assert_eq!(cancelled, None);
        assert!(matches!(waited, Err(CustodyError::NoStep)), "{waited:?}");
        assert!(
            matches!(accepted, Err(CustodyError::NoStep)),
            "{accepted:?}"
        );
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// An accept that never answers ends with the claim's deadline, saying the link closed.
    #[tokio::test]
    async fn an_accept_that_stalls_ends_at_the_claims_deadline() {
        tokio::time::pause();
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor
            .rpc()
            .delay("identity.acceptJoin", Duration::from_secs(100_000));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let asked = tokio::time::Instant::now();
        let ((), accepted) = tokio::join!(
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                window.step(StepInput::Accept).await
            }
        );
        let took = asked.elapsed();
        assert!(
            took <= Duration::from_secs(OFFER_TTL_S + CONFIRM_GRACE_S + 1),
            "{took:?}"
        );
        assert!(
            matches!(&accepted, Screen::Failed { message } if message.contains("didn't confirm in time")),
            "{accepted:?}"
        );
    }

    /// The main window asking for the state while a cancel waits on the executor does not hold
    /// the cancel: one whose executor connection stalls is answered once the cancel was.
    #[tokio::test]
    async fn a_state_request_during_a_cancel_does_not_hold_the_cancel() {
        // Accepts connections and never answers the WebSocket handshake.
        let stalled = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = ExecutorAddress {
            url: format!("http://{}", stalled.local_addr().unwrap()),
            credential: Arc::from("x"),
        };
        // On the real clock: the stalled handshake is real I/O, which a paused clock does not
        // advance past.
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        executor
            .rpc()
            .delay("identity.cancelJoin", Duration::from_millis(200));
        let claim = Claim {
            offer_id: "o1".into(),
            did: "did:scid:x".into(),
            code: "AAA BBB".into(),
            needs_accept: true,
            deadline: CLOCK.now() + 300,
            accepted: false,
            confirmed: false,
        };
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (waiting_tx, waiting) = oneshot::channel();
        let mut reply: Reply = Some(waiting_tx);
        let (public_tx, _public) = oneshot::channel();
        tx.send(Request::Public(public_tx)).unwrap();
        let mut reads = StateReads::new(&vault, &address);
        // The state request is answered after the cancel, so the step itself is cut off here.
        let (_, waited) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(3),
                cancel_claim(
                    &executor,
                    "coasys:device:1:abc",
                    Some(&claim),
                    Cancelled::default(),
                    &mut reads,
                    &mut rx,
                    &mut reply,
                )
            ),
            tokio::time::timeout(Duration::from_secs(2), waiting)
        );
        let waited = waited
            .expect("the cancel was answered while the state request stalled")
            .unwrap();
        assert!(matches!(waited, Err(CustodyError::NoStep)), "{waited:?}");
        drop(stalled);
    }

    /// The main window asking for the state while an accept is out does not hold a cancel that
    /// follows: the state, whose executor connection stalls here as an unlock prompt would, is
    /// answered once the accept or the cancel ended. `beside_wait`: the accept arrived beside a
    /// wait for the join (`follow_claim`), else straight after the code.
    async fn a_state_request_during_an_accept_does_not_hold_a_cancel(beside_wait: bool) {
        // Accepts connections and never answers the WebSocket handshake; on the real clock, as
        // the stalled handshake is real I/O.
        let stalled = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = ExecutorAddress {
            url: format!("http://{}", stalled.local_addr().unwrap()),
            credential: Arc::from("x"),
        };
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor
            .rpc()
            .delay("identity.acceptJoin", Duration::from_secs(3600));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (_, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(3),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(2), async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let waited = beside_wait.then(|| {
                    let (tx, waited) = oneshot::channel();
                    window
                        .tx
                        .send(Request::Step(StepInput::WaitJoin, tx))
                        .unwrap();
                    waited
                });
                let (tx, accepted) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::Accept, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (tx, _public) = oneshot::channel();
                window.tx.send(Request::Public(tx)).unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let cancelled = cancelled.await.unwrap();
                let waited = match waited {
                    Some(waited) => Some(waited.await.unwrap()),
                    None => None,
                };
                (cancelled, accepted.await.unwrap(), waited)
            })
        );
        let (cancelled, accepted, waited) =
            answered.expect("the cancel was answered while the state request stalled");
        assert_eq!(cancelled, None);
        assert!(
            matches!(accepted, Err(CustodyError::NoStep)),
            "{accepted:?}"
        );
        if let Some(waited) = waited {
            assert!(matches!(waited, Err(CustodyError::NoStep)), "{waited:?}");
        }
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
        drop(stalled);
    }

    #[tokio::test]
    async fn a_state_request_during_an_accept_does_not_hold_the_cancel() {
        a_state_request_during_an_accept_does_not_hold_a_cancel(false).await;
    }

    #[tokio::test]
    async fn a_state_request_during_an_accept_beside_a_wait_does_not_hold_the_cancel() {
        a_state_request_during_an_accept_does_not_hold_a_cancel(true).await;
    }

    /// A state request put off while an accept was out is answered once the accept is, on both
    /// paths to the accept.
    async fn a_state_request_during_an_accept_is_answered_after_it(beside_wait: bool) {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor
            .rpc()
            .delay("identity.acceptJoin", Duration::from_millis(200));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        // No executor answers on this address: the state is read without one, at once.
        let (address, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(3),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(2), async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let _waited = beside_wait.then(|| {
                    let (tx, waited) = oneshot::channel();
                    window
                        .tx
                        .send(Request::Step(StepInput::WaitJoin, tx))
                        .unwrap();
                    waited
                });
                let (tx, _accepted) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::Accept, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (tx, public) = oneshot::channel();
                window.tx.send(Request::Public(tx)).unwrap();
                let public = public.await;
                // Closed: the flow ends with the window.
                drop(window);
                public
            })
        );
        let public = answered.expect("the state request was answered");
        assert!(public.is_ok(), "the state request was dropped unanswered");
        assert_eq!(executor.rpc().called("identity.acceptJoin").len(), 1);
    }

    #[tokio::test]
    async fn a_state_request_during_an_accept_is_answered_after_the_accept() {
        a_state_request_during_an_accept_is_answered_after_it(false).await;
    }

    #[tokio::test]
    async fn a_state_request_during_an_accept_beside_a_wait_is_answered_after_the_accept() {
        a_state_request_during_an_accept_is_answered_after_it(true).await;
    }

    /// A cancel that arrives with the `link-ticket` already in ends the claim the ticket made:
    /// left unclaimed here, a holder's confirm of a claim that needs no accept would still join
    /// this computer after its window closed. Repeated, as which of the two is seen first was
    /// left to chance.
    #[tokio::test]
    async fn a_cancel_beside_a_ticket_ends_the_claim_the_ticket_made() {
        for _ in 0..32 {
            let (executor, events) = claiming_device(Some(false));
            executor
                .rpc()
                .answer("identity.cancelJoin", json!({ "cancelled": true }));
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let (address, mut rx, mut reply, window, first) = opened();
            let ((), cancelled) = tokio::join!(
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
                async {
                    first.await.unwrap().unwrap();
                    let (tx, _waited) = oneshot::channel();
                    window
                        .tx
                        .send(Request::Step(StepInput::WaitLink, tx))
                        .unwrap();
                    let (tx, cancelled) = oneshot::channel();
                    window.tx.send(Request::Cancel(tx)).unwrap();
                    cancelled.await.unwrap()
                }
            );
            assert_eq!(cancelled, None);
            assert_eq!(
                executor.rpc().called("identity.cancelJoin"),
                vec![json!({ "offerId": "o1" })]
            );
        }
    }

    /// A cancel sent before the window waits for the ticket, with the ticket already in, ends the
    /// claim the ticket made, as one beside the wait does.
    #[tokio::test]
    async fn a_cancel_before_the_wait_ends_the_claim_a_ticket_already_made() {
        let (executor, events) = claiming_device(Some(false));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), cancelled) = tokio::join!(
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                cancelled.await.unwrap()
            }
        );
        assert_eq!(cancelled, None);
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// A cancel with no ticket seen ends the code: the executor stops reading for tickets and cancels
    /// a claim whose `link-ticket` is still on its way (`identity.endPrepared`), so the window closes.
    /// `during_wait`: sent while the window waits for the ticket, else before.
    async fn a_cancel_with_no_ticket_seen_ends_the_code(during_wait: bool) {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
        );
        let (_events_tx, events) = broadcast::channel(8);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (cancelled, waited)) = tokio::join!(
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                let waited = during_wait.then(|| {
                    let (tx, waited) = oneshot::channel();
                    window
                        .tx
                        .send(Request::Step(StepInput::WaitLink, tx))
                        .unwrap();
                    waited
                });
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let cancelled = cancelled.await.unwrap();
                let waited = match waited {
                    Some(waited) => Some(waited.await.unwrap()),
                    None => None,
                };
                (cancelled, waited)
            }
        );
        assert_eq!(cancelled, None);
        if let Some(waited) = waited {
            assert!(matches!(waited, Err(CustodyError::NoStep)), "{waited:?}");
        }
        assert_eq!(
            executor.rpc().called("identity.endPrepared"),
            vec![json!({ "device": "coasys:device:1:abc" })]
        );
        assert!(executor.rpc().called("identity.cancelJoin").is_empty());
    }

    #[tokio::test]
    async fn a_cancel_before_the_wait_with_no_ticket_seen_ends_the_code() {
        a_cancel_with_no_ticket_seen_ends_the_code(false).await;
    }

    #[tokio::test]
    async fn a_cancel_during_the_wait_with_no_ticket_seen_ends_the_code() {
        a_cancel_with_no_ticket_seen_ends_the_code(true).await;
    }

    /// The service around a show-code flow as [`serve`] runs it: the flow, then the idle service
    /// over the same state reads. A `Start` [`idle`] hands back is answered `started`, standing in
    /// for the step [`serve`] would run.
    async fn show_code_served(
        executor: &ViaExecutor<FakeExecutor>,
        events: broadcast::Receiver<Value>,
        vault: &DesktopVault,
        address: &ExecutorAddress,
        rx: &mut Rx,
        reply: &mut Reply,
    ) {
        let mut reads = StateReads::new(vault, address);
        show_code_on(executor, events, &mut reads, rx, reply).await;
        while let Some((_, start)) = idle(&mut reads, rx).await {
            let _ = start.send(Ok(Screen::Failed {
                message: "started".into(),
            }));
        }
        reads.finish().await;
    }

    /// A state read a show-code flow took and left stalled when its claim ended holds no request
    /// after it: a retried `Start` and a later cancel are answered at once, and the state request
    /// once its read ends. `by_cancel`: the claim ends with a cancel, else it fails.
    async fn a_state_read_left_stalled_holds_nothing_after_the_claim(by_cancel: bool) {
        // On the real clock: the slow read is real I/O.
        let address = slow_executor(Duration::from_millis(1500));
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
        );
        let (events_tx, events) = broadcast::channel::<Value>(8);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (_, mut rx, mut reply, window, first) = opened();
        let prompt = Duration::from_millis(500);
        let ((), (ended, started, cancelled, early, public)) = tokio::join!(
            show_code_served(&executor, events, &vault, &address, &mut rx, &mut reply),
            async move {
                first.await.unwrap().unwrap();
                let (tx, mut public) = oneshot::channel();
                window.tx.send(Request::Public(tx)).unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let ended = if by_cancel {
                    let (tx, cancelled) = oneshot::channel();
                    window.tx.send(Request::Cancel(tx)).unwrap();
                    tokio::time::timeout(prompt, cancelled)
                        .await
                        .expect("the cancel was answered")
                        .unwrap()
                } else {
                    // The executor's events end: the wait for the ticket fails.
                    drop(events_tx);
                    let (tx, waited) = oneshot::channel();
                    window
                        .tx
                        .send(Request::Step(StepInput::WaitLink, tx))
                        .unwrap();
                    Some(
                        tokio::time::timeout(prompt, waited)
                            .await
                            .expect("the step was answered")
                            .unwrap()
                            .unwrap(),
                    )
                };
                let (tx, started) = oneshot::channel();
                window
                    .tx
                    .send(Request::Start(IdentityStep::ShowCode, tx))
                    .unwrap();
                let started = tokio::time::timeout(prompt, started)
                    .await
                    .expect("a retried start was held by the stalled read")
                    .unwrap();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let cancelled = tokio::time::timeout(prompt, cancelled)
                    .await
                    .expect("a later cancel was held by the stalled read")
                    .unwrap();
                // The read is still under way: its request is answered when it ends.
                let early = public.try_recv().is_ok();
                let public = tokio::time::timeout(Duration::from_secs(5), public).await;
                drop(window);
                (ended, started, cancelled, early, public)
            }
        );
        if by_cancel {
            // The code ended: the window closes.
            assert_eq!(ended, None);
        } else {
            let ended = ended.expect("the claim's end shows a screen");
            assert!(
                matches!(&ended, Screen::Failed { message } if message.contains("stopped responding")),
                "{ended:?}"
            );
        }
        assert!(
            matches!(&started, Ok(Screen::Failed { message }) if message == "started"),
            "{started:?}"
        );
        assert_eq!(cancelled, None);
        assert!(!early, "the stalled read answered before it ended");
        let public = public.expect("the state request was answered once its read ended");
        assert!(public.is_ok(), "the state request was dropped unanswered");
    }

    #[tokio::test]
    async fn a_state_read_left_stalled_by_a_cancelled_claim_holds_no_later_request() {
        a_state_read_left_stalled_holds_nothing_after_the_claim(true).await;
    }

    #[tokio::test]
    async fn a_state_read_left_stalled_by_a_failed_claim_holds_no_later_request() {
        a_state_read_left_stalled_holds_nothing_after_the_claim(false).await;
    }

    /// With the service idle, a state read that stalls holds no step input and no cancel.
    #[tokio::test]
    async fn an_idle_state_read_that_stalls_holds_no_other_request() {
        let address = slow_executor(Duration::from_millis(1500));
        let handle = spawn(memory_vault(crate::store::StoreKind::Keychain), address);
        let prompt = Duration::from_millis(500);
        let reading = handle.public_state();
        tokio::pin!(reading);
        // Started, so the service has taken it before the requests after it.
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut reading)
                .await
                .is_err()
        );
        let step = tokio::time::timeout(prompt, handle.step(StepInput::WaitLink))
            .await
            .expect("a step input was held by the stalled read");
        assert_eq!(step, Err(CustodyError::NoStep));
        let cancelled = tokio::time::timeout(prompt, handle.cancel())
            .await
            .expect("a cancel was held by the stalled read");
        assert_eq!(cancelled, None);
        let public = tokio::time::timeout(Duration::from_secs(5), reading)
            .await
            .expect("the state request was answered once its read ended");
        assert!(public.is_ok(), "{public:?}");
    }

    /// Cancels queued together are one cancel: the code is ended once, and each cancel answers what
    /// that end said. Here the executor refuses it (one without `identity.endPrepared`), so each says
    /// the cancel was not confirmed, rather than the second closing the window from the idle service.
    #[tokio::test]
    async fn queued_cancels_are_one_end_of_the_code_and_answer_alike() {
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
        );
        executor
            .rpc()
            .refuse("identity.endPrepared", 404, "no identity.endPrepared");
        let (_events_tx, events) = broadcast::channel(8);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (a, b)) = tokio::join!(
            show_code_served(&executor, events, &vault, &address, &mut rx, &mut reply),
            async move {
                first.await.unwrap().unwrap();
                // Both sent before the flow runs again, so both are queued when it takes the first.
                let (tx, a) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let (tx, b) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let answered = (a.await.unwrap(), b.await.unwrap());
                drop(window);
                answered
            }
        );
        let unconfirmed = |screen: &Option<Screen>| matches!(screen, Some(Screen::Failed { message }) if message == CANCEL_UNCONFIRMED);
        assert!(unconfirmed(&a), "{a:?}");
        assert!(unconfirmed(&b), "{b:?}");
        assert_eq!(executor.rpc().called("identity.endPrepared").len(), 1);
        assert!(executor.rpc().called("identity.cancelJoin").is_empty());
    }

    /// An executor address whose state reads take `hold`: each connection is accepted, held
    /// unanswered that long, then closed, so the read ends as one with no executor would.
    fn slow_executor(hold: Duration) -> ExecutorAddress {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = ExecutorAddress {
            url: format!("http://{}", listener.local_addr().unwrap()),
            credential: Arc::from("x"),
        };
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                std::thread::spawn(move || {
                    std::thread::sleep(hold);
                    drop(stream);
                });
            }
        });
        address
    }

    /// A state request taken while the window waits for the ticket is answered even when the
    /// ticket comes in during its read: the read is not dropped with the wait for a cancel.
    #[tokio::test]
    async fn a_state_request_during_the_wait_for_a_ticket_is_answered_when_the_ticket_comes() {
        // On the real clock: the slow read is real I/O.
        let address = slow_executor(Duration::from_millis(300));
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
        );
        let (events_tx, events) = broadcast::channel(8);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (_, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(3),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(2), async {
                first.await.unwrap().unwrap();
                let (tx, waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitLink, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
                let (tx, public) = oneshot::channel();
                window.tx.send(Request::Public(tx)).unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                events_tx
                    .send(json!({ "type": "link-ticket", "did": "did:scid:x", "offerId": "o1", "matchCode": "AAA BBB" }))
                    .unwrap();
                let waited = waited.await.unwrap();
                let public = public.await;
                drop(window);
                (waited, public)
            })
        );
        let (waited, public) = answered.expect("the state request was answered");
        assert_eq!(waited.unwrap(), device_match(false, false, false));
        assert!(public.is_ok(), "the state request was dropped unanswered");
    }

    /// A cancel after an accept went through is not held by a state read that stalls (as a slow
    /// executor would): the read runs beside the wait for the join. `beside_wait`: the accept
    /// arrived beside a wait for the join (`follow_claim`), else straight after the code.
    async fn a_cancel_after_an_accept_is_not_held_by_a_stalled_state_read(beside_wait: bool) {
        // Accepts connections and never answers the WebSocket handshake; on the real clock, as
        // the stalled handshake is real I/O.
        let stalled = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = ExecutorAddress {
            url: format!("http://{}", stalled.local_addr().unwrap()),
            credential: Arc::from("x"),
        };
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .answer("identity.acceptJoin", json!({ "accepted": true }));
        executor
            .rpc()
            .delay("identity.acceptJoin", Duration::from_millis(200));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (_, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(3),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(2), async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let waited = beside_wait.then(|| {
                    let (tx, waited) = oneshot::channel();
                    window
                        .tx
                        .send(Request::Step(StepInput::WaitJoin, tx))
                        .unwrap();
                    waited
                });
                let (tx, accepted) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::Accept, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (tx, _public) = oneshot::channel();
                window.tx.send(Request::Public(tx)).unwrap();
                // The accept is through by now, and the state read it put off has started.
                tokio::time::sleep(Duration::from_millis(400)).await;
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                let cancelled = cancelled.await.unwrap();
                let waited = match waited {
                    Some(waited) => Some(waited.await.unwrap()),
                    None => None,
                };
                (cancelled, accepted.await.unwrap(), waited)
            })
        );
        let (cancelled, accepted, waited) =
            answered.expect("the cancel was answered while the state read stalled");
        assert_eq!(cancelled, None);
        assert!(
            matches!(accepted, Err(CustodyError::NoStep)),
            "{accepted:?}"
        );
        if let Some(waited) = waited {
            assert_eq!(waited.unwrap(), device_match(true, true, false));
        }
        assert_eq!(
            executor.rpc().called("identity.acceptJoin"),
            vec![json!({ "offerId": "o1" })]
        );
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
        drop(stalled);
    }

    #[tokio::test]
    async fn a_cancel_after_an_accept_is_not_held_by_a_stalled_state_read_after_it() {
        a_cancel_after_an_accept_is_not_held_by_a_stalled_state_read(false).await;
    }

    #[tokio::test]
    async fn a_cancel_after_an_accept_beside_a_wait_is_not_held_by_a_stalled_state_read() {
        a_cancel_after_an_accept_is_not_held_by_a_stalled_state_read(true).await;
    }

    /// An accept beside a wait for the join that fails answers both at once, though a state read
    /// it put off stalls.
    #[tokio::test]
    async fn a_failed_accept_beside_a_wait_is_answered_while_a_state_read_stalls() {
        let stalled = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = ExecutorAddress {
            url: format!("http://{}", stalled.local_addr().unwrap()),
            credential: Arc::from("x"),
        };
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .refuse("identity.acceptJoin", 404, "not-found: no claim");
        executor
            .rpc()
            .delay("identity.acceptJoin", Duration::from_millis(200));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (_, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(3),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(2), async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitJoin, tx))
                    .unwrap();
                let (tx, accepted) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::Accept, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (tx, _public) = oneshot::channel();
                window.tx.send(Request::Public(tx)).unwrap();
                (waited.await.unwrap(), accepted.await.unwrap())
            })
        );
        let (waited, accepted) =
            answered.expect("the accept was answered while the state read stalled");
        let closed = |screen: &Result<Screen, CustodyError>| matches!(screen, Ok(Screen::Failed { message }) if message.contains("link has closed"));
        assert!(closed(&waited), "{waited:?}");
        assert!(closed(&accepted), "{accepted:?}");
        drop(stalled);
    }

    /// A state request while the window waits for the join does not hold a cancel that follows:
    /// its read, stalled here, runs beside the wait.
    #[tokio::test]
    async fn a_cancel_during_a_wait_for_the_join_is_not_held_by_a_stalled_state_read() {
        let stalled = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = ExecutorAddress {
            url: format!("http://{}", stalled.local_addr().unwrap()),
            credential: Arc::from("x"),
        };
        let (executor, events) = claiming_device(Some(false));
        executor
            .rpc()
            .answer("identity.joinStatus", json!({ "state": "claimed" }));
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (_, mut rx, mut reply, window, first) = opened();
        let (_, answered) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(3),
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply)
            ),
            tokio::time::timeout(Duration::from_secs(2), async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitJoin, tx))
                    .unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (tx, _public) = oneshot::channel();
                window.tx.send(Request::Public(tx)).unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                (cancelled.await.unwrap(), waited.await.unwrap())
            })
        );
        let (cancelled, waited) =
            answered.expect("the cancel was answered while the state read stalled");
        assert_eq!(cancelled, None);
        assert!(matches!(waited, Err(CustodyError::NoStep)), "{waited:?}");
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
        drop(stalled);
    }

    /// Cancels already queued when the executor's answer to the first is in are the same cancel:
    /// each shows the join. Left for the idle service, a `None` would close the window over it.
    /// Repeated, as which of the two is seen first was left to chance.
    #[tokio::test]
    async fn cancels_queued_as_the_cancel_ends_show_the_join_too() {
        for _ in 0..32 {
            let executor = ViaExecutor::new(FakeExecutor::new());
            executor.rpc().refuse(
                "identity.cancelJoin",
                409,
                "already-joined: the main agent speaks for this claim's identity",
            );
            executor.rpc().answer(
                "identity.joinStatus",
                json!({ "state": "spent", "did": "did:scid:x", "keyId": "d2", "seq": 1 }),
            );
            let claim = Claim {
                offer_id: "o1".into(),
                did: "did:scid:x".into(),
                code: "AAA BBB".into(),
                needs_accept: false,
                deadline: CLOCK.now() + 300,
                accepted: false,
                confirmed: false,
            };
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let (address, mut rx, mut reply, window, mut waited) = opened();
            let (tx, mut first) = oneshot::channel();
            let (queued_tx, mut queued) = oneshot::channel();
            window.tx.send(Request::Cancel(queued_tx)).unwrap();
            cancel_claim(
                &executor,
                "coasys:device:1:abc",
                Some(&claim),
                Cancelled {
                    cancel: Some(tx),
                    ..Default::default()
                },
                &mut StateReads::new(&vault, &address),
                &mut rx,
                &mut reply,
            )
            .await;
            let joined = |screen: Option<&Screen>| matches!(screen, Some(Screen::Joined { did, key_id }) if did == "did:scid:x" && key_id == "d2");
            let first = first.try_recv().expect("the first cancel was answered");
            let queued = queued.try_recv().expect("the queued cancel was answered");
            let waited = waited.try_recv().expect("the step was answered");
            assert!(joined(first.as_ref()), "{first:?}");
            assert!(joined(queued.as_ref()), "{queued:?}");
            assert!(joined(waited.as_ref().ok()), "{waited:?}");
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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

    /// A second cancel sent while the first waits on the executor (a double click, two hosts) is
    /// the same cancel: both show the join. Left for the idle service, the second's `None` would
    /// close the window before the person saw that this computer joined.
    #[tokio::test]
    async fn two_overlapping_cancels_both_show_the_join() {
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
        let ((), (first_cancel, second_cancel)) = tokio::join!(
            async {
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply).await;
                // The step is over: what is still queued meets the idle service, as `serve` does.
                while let Ok(request) = rx.try_recv() {
                    if let Request::Cancel(r) = request {
                        let _ = r.send(None);
                    }
                }
            },
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, _waited) = oneshot::channel();
                window
                    .tx
                    .send(Request::Step(StepInput::WaitJoin, tx))
                    .unwrap();
                let (tx, first_cancel) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (tx, second_cancel) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                (first_cancel.await.unwrap(), second_cancel.await.unwrap())
            }
        );
        let joined = |screen: Option<&Screen>| matches!(screen, Some(Screen::Joined { did, key_id }) if did == "did:scid:x" && key_id == "d2");
        assert!(joined(first_cancel.as_ref()), "{first_cancel:?}");
        assert!(joined(second_cancel.as_ref()), "{second_cancel:?}");
        // One cancel reached the executor.
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// A join lookup that does not answer leaves the cancel inside the same [`CANCEL_WAIT`]: the
    /// claim had joined, said in words, and custody is free for the next request.
    #[tokio::test]
    async fn a_late_cancel_whose_join_lookup_stalls_answers_within_the_wait() {
        tokio::time::pause();
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().refuse(
            "identity.cancelJoin",
            409,
            "already-joined: the main agent speaks for this claim's identity",
        );
        executor
            .rpc()
            .delay("identity.cancelJoin", CANCEL_WAIT - Duration::from_secs(1));
        executor.rpc().answer(
            "identity.joinStatus",
            json!({ "state": "spent", "did": "did:scid:x", "keyId": "d2", "seq": 1 }),
        );
        executor
            .rpc()
            .delay("identity.joinStatus", Duration::from_secs(3600));
        let asked = tokio::time::Instant::now();
        let screen = cancel_join(&executor, "o1", tokio::time::Instant::now() + CANCEL_WAIT).await;
        assert!(
            matches!(&screen, Some(Screen::Failed { message }) if message == ALREADY_JOINED),
            "{screen:?}"
        );
        // The timer's millisecond tick aside, the lookup had only what the cancel left of the wait.
        let took = asked.elapsed();
        assert!(took < CANCEL_WAIT + Duration::from_millis(10), "{took:?}");
        assert_eq!(
            executor.rpc().called("identity.joinStatus"),
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
        let screen = cancel_join(&executor, "o1", tokio::time::Instant::now() + CANCEL_WAIT).await;
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
        assert!(
            cancel_join(&executor, "o1", tokio::time::Instant::now() + CANCEL_WAIT)
                .await
                .is_none()
        );
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
            cancel_join(&executor, "o1", tokio::time::Instant::now() + CANCEL_WAIT).await,
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
            cancel_join(&executor, "o1", tokio::time::Instant::now() + CANCEL_WAIT).await,
            Some(cancel_unconfirmed())
        );
    }

    /// A cancel with a claim seen, whose end of the code cancelled that claim: the window closes, and
    /// no `identity.cancelJoin` follows.
    #[tokio::test]
    async fn a_cancel_whose_end_of_the_code_cancelled_the_claim_closes_the_window() {
        let (executor, events) = claiming_device(Some(true));
        executor.rpc().answer(
            "identity.endPrepared",
            json!({ "state": "ended", "cancelled": ["o1"] }),
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (matched, cancelled)) = tokio::join!(
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                let matched = window.step(StepInput::WaitLink).await;
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                (matched, cancelled.await.unwrap())
            }
        );
        assert_eq!(matched, device_match(true, false, false));
        assert_eq!(cancelled, None);
        assert_eq!(
            executor.rpc().called("identity.endPrepared"),
            vec![json!({ "device": "coasys:device:1:abc" })]
        );
        assert!(executor.rpc().called("identity.cancelJoin").is_empty());
    }

    /// A cancel whose code had a claim bind already, its `link-ticket` not seen here: the executor
    /// answers `already-joined`, and the step shows the join, as a late `identity.cancelJoin` does;
    /// in words when the join's key is not known.
    #[tokio::test]
    async fn a_cancel_whose_code_already_joined_shows_the_join() {
        for knows_key in [true, false] {
            let executor = ViaExecutor::new(FakeExecutor::new());
            executor.rpc().answer(
                "identity.prepareDevice",
                json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
            );
            executor.rpc().answer(
                "identity.endPrepared",
                json!({ "state": "already-joined", "offerId": "o1", "did": "did:scid:x" }),
            );
            if knows_key {
                executor.rpc().answer(
                    "identity.joinStatus",
                    json!({ "state": "spent", "did": "did:scid:x", "keyId": "d2", "seq": 1 }),
                );
            }
            let (_events_tx, events) = broadcast::channel(8);
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let (address, mut rx, mut reply, window, first) = opened();
            let ((), cancelled) = tokio::join!(
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
                async {
                    first.await.unwrap().unwrap();
                    let (tx, cancelled) = oneshot::channel();
                    window.tx.send(Request::Cancel(tx)).unwrap();
                    cancelled.await.unwrap()
                }
            );
            if knows_key {
                assert!(
                    matches!(&cancelled, Some(Screen::Joined { did, key_id }) if did == "did:scid:x" && key_id == "d2"),
                    "{cancelled:?}"
                );
            } else {
                assert!(
                    matches!(&cancelled, Some(Screen::Failed { message }) if message == ALREADY_JOINED),
                    "{cancelled:?}"
                );
            }
            assert_eq!(
                executor.rpc().called("identity.joinStatus"),
                vec![json!({ "offerId": "o1" })]
            );
            assert!(executor.rpc().called("identity.cancelJoin").is_empty());
        }
    }

    /// An executor that refuses the end of the code (one without `identity.endPrepared`, or one
    /// restarted since it made the code) still has the claim seen here cancelled by its offer.
    #[tokio::test]
    async fn a_refused_end_of_the_code_cancels_the_claim_seen_here() {
        let (executor, events) = claiming_device(Some(true));
        executor
            .rpc()
            .refuse("identity.endPrepared", 404, "no identity.endPrepared");
        executor
            .rpc()
            .answer("identity.cancelJoin", json!({ "cancelled": true }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), cancelled) = tokio::join!(
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                cancelled.await.unwrap()
            }
        );
        assert_eq!(cancelled, None);
        assert_eq!(
            executor.rpc().called("identity.cancelJoin"),
            vec![json!({ "offerId": "o1" })]
        );
    }

    /// An end of the code the executor does not answer within [`CANCEL_WAIT`] is not confirmed: the
    /// step says so, and custody is free again inside the wait.
    #[tokio::test]
    async fn an_end_of_the_code_the_executor_does_not_answer_says_the_cancel_is_unconfirmed() {
        tokio::time::pause();
        let executor = ViaExecutor::new(FakeExecutor::new());
        executor.rpc().answer(
            "identity.prepareDevice",
            json!({ "device": "coasys:device:1:abc", "expires": CLOCK.now() + 300 }),
        );
        executor
            .rpc()
            .delay("identity.endPrepared", CANCEL_WAIT + Duration::from_secs(1));
        let (_events_tx, events) = broadcast::channel(8);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (cancelled, took)) = tokio::join!(
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                let asked = tokio::time::Instant::now();
                let (tx, cancelled) = oneshot::channel();
                window.tx.send(Request::Cancel(tx)).unwrap();
                (cancelled.await.unwrap(), asked.elapsed())
            }
        );
        assert_eq!(cancelled, Some(cancel_unconfirmed()));
        assert!(took < CANCEL_WAIT + Duration::from_millis(10), "{took:?}");
    }

    /// An end of the code that did not list the claim seen here (it was cancelled before, or the
    /// answer is odd) leaves that claim to `identity.cancelJoin`; an answer this custody does not
    /// read does too.
    #[tokio::test]
    async fn an_end_that_does_not_list_the_claim_seen_here_cancels_it_by_its_offer() {
        for ended in [
            json!({ "state": "ended", "cancelled": ["o2"] }),
            json!({ "state": "something-else" }),
        ] {
            let (executor, events) = claiming_device(Some(true));
            executor.rpc().answer("identity.endPrepared", ended);
            executor
                .rpc()
                .answer("identity.cancelJoin", json!({ "cancelled": true }));
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let (address, mut rx, mut reply, window, first) = opened();
            let ((), cancelled) = tokio::join!(
                show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
                async {
                    first.await.unwrap().unwrap();
                    window.step(StepInput::WaitLink).await;
                    let (tx, cancelled) = oneshot::channel();
                    window.tx.send(Request::Cancel(tx)).unwrap();
                    cancelled.await.unwrap()
                }
            );
            assert_eq!(cancelled, None);
            assert_eq!(
                executor.rpc().called("identity.cancelJoin"),
                vec![json!({ "offerId": "o1" })]
            );
        }
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
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
            show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply),
            async {
                first.await.unwrap().unwrap();
                window.step(StepInput::WaitLink).await;
                window.step(StepInput::WaitJoin).await
            }
        );
        assert!(
            matches!(&last, Screen::Failed { message } if message == "This link was cancelled. Show a new code to try again."),
            "{last:?}"
        );
    }

    #[tokio::test]
    async fn a_computer_that_speaks_for_an_identity_shows_no_code() {
        let executor = linked_executor();
        let (_events_tx, events) = broadcast::channel(1);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, _window, first) = opened();
        show_code_alone(&executor, events, &vault, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message.contains("already has an identity")),
            "{screen:?}"
        );
        assert!(executor.rpc().called("identity.prepareDevice").is_empty());
    }

    #[tokio::test]
    async fn with_no_master_key_waiting_nothing_is_taken() {
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (executor, scid) = joined_executor(&vault, None);
        executor
            .rpc()
            .rpc()
            .answer("identity.inboxSealed", json!([]));
        let (address, mut rx, mut reply, _window, first) = opened();
        take_master_on(&executor, &vault, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message == NO_MASTER_WAITING),
            "{screen:?}"
        );
        assert!(!vault.holds(&scid).unwrap());
    }

    #[tokio::test]
    async fn a_master_key_taken_into_a_sealed_store_gets_a_passphrase_first() {
        let dir = tempfile::tempdir().unwrap();
        let vault = open_vault(dir.path());
        let (executor, scid) = joined_executor(&vault, None);
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
            matches!(&screens[2], Screen::MasterTaken { did, .. } if *did == did_of(&scid)),
            "{screens:?}"
        );
        // Taken once the passphrase is set, and kept under it.
        assert_eq!(held_sealed(&vault, &scid).unwrap(), Some(true));
        assert_eq!(
            executor.rpc().rpc().called("identity.inboxAck"),
            vec![json!({ "id": "m1" })]
        );
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
            matches!(&screen, Screen::Failed { message } if message.contains("no longer open")),
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
                        if message.contains("can't have the master key")),
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

    /// The store's head key in [`log_answer`], which signs the record's receipts.
    fn store_key() -> KeySigner {
        KeySigner::new(&[9u8; 32], 0)
    }

    /// `identity.log`'s answer for the identity `events` make, its head signed by
    /// [`store_key`]: the reader trusts it for the record's receipt as for the head.
    fn log_answer(events: &[Event]) -> Value {
        let scid = &events[0].scid;
        let json_events: Vec<Value> = events
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect();
        let seq = ad4m_identity_core::fold(events).unwrap().head().seq;
        let store = store_key();
        json!({
            "did": did_of(scid), "events": json_events, "fork": null,
            "head": {
                "scid": scid, "seq": seq, "hash": "h", "time": 0,
                "store": format!("did:key:{}", Signer::key(&store)), "sig": "s",
            },
        })
    }

    /// An executor that is device `d1` of the identity `events` make (a log of
    /// [`crate::keylog::tests::log_with_d2`]), answering its log with the store's signed head and
    /// `record` sealed to the log's readers and signed by `d1`, with the store's receipt, as the
    /// store would.
    fn executor_with(
        events: &[Event],
        record: &ad4m_identity_core::record::PrivateRecord,
    ) -> (ViaExecutor<FakeExecutor>, String) {
        let scid = events[0].scid.clone();
        let executor = ViaExecutor::new(FakeExecutor::new());
        *executor.rpc().held.borrow_mut() = Some(scid.clone());
        let chain = ad4m_identity_core::fold(events).unwrap();
        let store = store_key();
        let seq = chain.head().seq;
        executor.rpc().answer("identity.log", log_answer(events));
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
            master_index: None,
            vault: None,
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
                && message.contains("isn't in your key log")),
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
            rotate: true,
            passphrase: false,
            error: None,
        })
        .unwrap();
        assert_eq!(confirm["mayHoldMaster"], true);
        assert_eq!(confirm["rotate"], true);
    }

    /// A revoke unlocked with the passphrase pushes again a master key whose delivery failed: the
    /// main window's refreshes cannot, without the passphrase, so this unlock is the retry's.
    #[tokio::test]
    async fn a_revoke_under_the_passphrase_retries_a_master_key_push() {
        let (mut events, _) = crate::keylog::tests::log_with_d2(true);
        crate::keylog::tests::add_d3(&mut events, false);
        let scid = events[0].scid.clone();
        let (executor, _) = executor_with(&events, &lying_record());
        let dir = tempfile::tempdir().unwrap();
        let vault = open_vault(dir.path());
        let master = words::master_key(&words::seed(&words::from_entropy(&[41u8; 16])), 0).unwrap();
        vault
            .unlocking(pass())
            .store_master(&scid, 0, Secret::new(master.to_bytes()))
            .unwrap();
        // The push to `d2` failed earlier: it waits on the retry list.
        vault
            .unlocking(None)
            .keep_push(&ad4m_identity_client::PendingPush {
                scid: scid.clone(),
                key_id: "d2".into(),
            })
            .unwrap();
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), revoked) = tokio::join!(
            revoke_on(
                &executor,
                &vault,
                &address,
                &mut rx,
                &mut reply,
                "d3".into()
            ),
            async {
                let confirm = first.await.unwrap().unwrap();
                assert!(
                    matches!(
                        &confirm,
                        Screen::RevokeConfirm {
                            passphrase: true,
                            ..
                        }
                    ),
                    "{confirm:?}"
                );
                window
                    .step(StepInput::Revoke {
                        passphrase: Some(PASSPHRASE.into()),
                        rotate: false,
                    })
                    .await
            }
        );
        assert!(
            matches!(&revoked, Screen::Revoked { key_id, .. } if key_id == "d3"),
            "{revoked:?}"
        );
        let put = executor.rpc().called("identity.inboxPut");
        assert_eq!(put.len(), 1, "the push to d2 was not tried again");
        assert_eq!(put[0]["address"]["keyId"], "d2");
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
            matches!(&screen, Screen::Failed { message } if message.contains("Only a device with the master key")),
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
            !matches!(&screen, Screen::Failed { message } if message.contains("Only a device with the master key")),
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
            .contains("different identity store"));
        assert!(
            check_code("coasys:offer:1:zzz", "https://store.example", 999)
                .unwrap_err()
                .contains("isn't a device code")
        );
    }

    #[tokio::test]
    async fn the_public_state_lists_requests_and_a_waiting_master_key() {
        let requests = json!([{
            "id": "r1",
            "body": { "kind": "confirm-revoke", "keyIds": ["d3"], "rotate": false },
            "by": "d2", "created": 0, "expires": 99, "signed": {},
        }]);
        // A sealed store: the waiting key is shown, never taken without the passphrase.
        let dir = tempfile::tempdir().unwrap();
        let vault = open_vault(dir.path());
        let (executor, scid) = joined_executor(&vault, None);
        executor.rpc().rpc().answer("identity.requests", requests);
        let public = public_state_on(Some(&executor), &vault).await;
        assert!(public.master_waiting);
        assert!(!public.enc_mismatch);
        assert!(!vault.holds(&scid).unwrap());
        assert!(executor.rpc().rpc().called("identity.inboxAck").is_empty());
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
    }

    #[tokio::test]
    async fn where_the_os_unlocks_a_new_item_the_state_takes_a_master_key_sealed_to_this_computer()
    {
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (executor, scid) = joined_executor(&vault, None);
        let public = public_state_on(Some(&executor), &vault).await;
        assert_eq!(public.holds_master, Some(HoldsMaster { index: Some(0) }));
        assert_eq!(held_sealed(&vault, &scid).unwrap(), Some(false));
        // Nothing waits in the inbox now. This executor keeps no record, so the take's mark is
        // owed, and "Take the master key" is still offered for it ([`repair_mark_on`]).
        assert!(!master_waits(&executor).await);
        assert!(receipt_owed(&vault, &scid, Some("d2")));
        assert!(public.master_waiting);
        assert!(!public.enc_mismatch);
        // Opened here: the executor was asked only for the sealed text, and to forget it.
        let fake = executor.rpc().rpc();
        assert!(fake.called("identity.takeMaster").is_empty());
        assert!(fake.called("identity.inbox").is_empty());
        assert!(!fake.called("identity.inboxSealed").is_empty());
        assert_eq!(
            fake.called("identity.inboxAck"),
            vec![json!({ "id": "m1" })]
        );
    }

    #[tokio::test]
    async fn a_log_listing_an_enc_key_this_computer_lost_says_to_revoke_and_link_again() {
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let lost = ad4m_identity_core::encode_x25519_multikey(&[5u8; 32]);
        let (executor, scid) = joined_executor(&vault, Some(lost));
        let public = public_state_on(Some(&executor), &vault).await;
        assert!(public.enc_mismatch);
        // The key sealed to the lost enc key does not open here, so it is not shown as waiting.
        assert!(!public.master_waiting);
        assert_eq!(public.holds_master, None);

        // Taking it, or asking for it again, says what to do instead.
        let (address, mut rx, mut reply, _window, first) = opened();
        take_master_on(&executor, &vault, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message == ENC_MISMATCH),
            "{screen:?}"
        );
        let screen = ask_master_on(&executor, &vault).await;
        assert!(
            matches!(&screen, Screen::Failed { message } if message == ENC_MISMATCH),
            "{screen:?}"
        );
        assert!(executor
            .rpc()
            .rpc()
            .called("identity.postRequest")
            .is_empty());
        assert!(!vault.holds(&scid).unwrap());
    }

    /// A computer that lost its enc key and also owes the record a mark for the key it keeps: a
    /// mark it makes cannot help a computer that cannot open its record, so "Take the master key"
    /// says to revoke and link again rather than repair the mark ([`repair_mark_on`]).
    #[tokio::test]
    async fn a_lost_enc_key_is_said_before_an_owed_mark_is_repaired() {
        use ad4m_identity_client::{CustodyNote, NoteToken};
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let lost = ad4m_identity_core::encode_x25519_multikey(&[5u8; 32]);
        let (executor, scid) = joined_executor(&vault, Some(lost));
        let flow = vault.unlocking(None);
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        flow.store_master(
            &scid,
            0,
            Secret::new(words::master_key(&seed, 0).unwrap().to_bytes()),
        )
        .unwrap();
        let owed = CustodyNote::MarkOwed {
            index: 0,
            epoch: flow.custody_epoch(&scid).unwrap(),
            token: NoteToken([7; 16]),
            acquired: true,
            restores: None,
        };
        assert!(flow
            .swap_custody_note(&scid, "d2", None, Some(&owed))
            .unwrap());
        drop(flow);
        assert!(receipt_owed(&vault, &scid, Some("d2")));

        let (address, mut rx, mut reply, _window, first) = opened();
        take_master_on(&executor, &vault, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(
            matches!(&screen, Screen::Failed { message } if message == ENC_MISMATCH),
            "{screen:?}"
        );
        let fake = executor.rpc().rpc();
        assert!(fake.called("identity.recordPut").is_empty());
        assert!(receipt_owed(&vault, &scid, Some("d2")));
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

    #[test]
    fn the_word_steps_cross_ipc_in_their_wire_form_and_never_print_the_words() {
        for (text, step) in [
            (r#"{"kind":"replace-master"}"#, IdentityStep::ReplaceMaster),
            (r#"{"kind":"restore"}"#, IdentityStep::Restore),
            (r#"{"kind":"remove-master"}"#, IdentityStep::RemoveMaster),
        ] {
            assert_eq!(serde_json::from_str::<IdentityStep>(text).unwrap(), step);
        }
        let phrase = phrase_of(41);
        for (text, debug) in [
            (
                json!({ "kind": "twelve-words", "words": phrase }).to_string(),
                "twelve-words",
            ),
            (
                r#"{"kind":"lock-out","keyIds":["d2"],"name":"Laptop"}"#.into(),
                "lock-out",
            ),
            (r#"{"kind":"remove"}"#.into(), "remove"),
        ] {
            let input: StepInput = serde_json::from_str(&text).unwrap();
            let printed = format!("{input:?}");
            assert!(printed.contains(debug), "{printed}");
            for word in phrase.split(' ') {
                assert!(!printed.contains(word), "{printed}");
            }
        }
        let StepInput::LockOut { key_ids, name } =
            serde_json::from_str(r#"{"kind":"lock-out","keyIds":["d2"],"name":"Laptop"}"#).unwrap()
        else {
            panic!("expected lock-out");
        };
        assert_eq!(
            (key_ids, name),
            (vec!["d2".to_string()], Some("Laptop".into()))
        );
        // A revoke from a window that offers no choice replaces nothing.
        let input: StepInput = serde_json::from_str(r#"{"kind":"revoke"}"#).unwrap();
        assert!(matches!(input, StepInput::Revoke { rotate: false, .. }));
        let input: StepInput = serde_json::from_str(r#"{"kind":"revoke","rotate":true}"#).unwrap();
        assert!(matches!(input, StepInput::Revoke { rotate: true, .. }));
        let screen = serde_json::to_value(Screen::RestoreDevices {
            did: "did:scid:x".into(),
            devices: vec![RestoreDevice {
                key_id: "d2".into(),
                name: Some("Phone".into()),
                kind: None,
                lock_out: true,
            }],
            note: None,
        })
        .unwrap();
        assert_eq!(screen["screen"], "restore-devices");
        assert_eq!(
            (
                &screen["devices"][0]["keyId"],
                &screen["devices"][0]["lockOut"]
            ),
            (&json!("d2"), &json!(true))
        );
        let screen = serde_json::to_value(Screen::EnterWords {
            purpose: "replace",
            error: None,
            position: None,
        })
        .unwrap();
        assert_eq!(
            (&screen["screen"], &screen["purpose"]),
            (&json!("enter-words"), &json!("replace"))
        );
        let restored = Screen::Restored {
            did: "did:scid:x".into(),
            name: "Laptop".into(),
            key_id: "d3".into(),
            revoked: vec!["d1".into()],
            note: None,
        };
        let screen = serde_json::to_value(&restored).unwrap();
        assert_eq!(
            (&screen["screen"], &screen["keyId"]),
            (&json!("restored"), &json!("d3"))
        );
        assert_eq!(
            serde_json::to_value(Screen::MasterRemoved).unwrap()["screen"],
            "master-removed"
        );
        let replaced = Screen::MasterReplaced {
            index: 1,
            revoked: vec![],
            note: None,
        };
        assert_eq!(
            serde_json::to_value(&replaced).unwrap()["screen"],
            "master-replaced"
        );
        for done in [replaced, restored, Screen::MasterRemoved] {
            assert_eq!(done.outcome(), Some(StepOutcome::Done), "{done:?}");
        }
        for open in [
            Screen::EnterWords {
                purpose: "replace",
                error: None,
                position: None,
            },
            Screen::RemoveMaster { error: None },
        ] {
            assert_eq!(open.outcome(), None, "{open:?}");
        }
    }

    #[test]
    fn a_refused_word_is_named_by_its_place_and_never_by_what_was_typed() {
        let phrase = phrase_of(41);
        let mut typed: Vec<String> = phrase.split(' ').map(str::to_string).collect();
        let real = typed[2].clone();
        // One letter off: the word list's nearest word is the real one.
        typed[2] = format!("{}q", &real[..real.len() - 1]);
        let e = words::parse(&typed.join(" ")).unwrap_err();
        let (message, position) = words_refused(&e);
        assert_eq!(position, Some(3));
        assert!(message.contains("Word 3"), "{message}");
        assert!(
            !message.contains(&typed[2]) && !message.contains(&real),
            "{message}"
        );
        let Screen::Failed { message } = failed(&ClientError::Words(e)) else {
            panic!("expected a failure");
        };
        assert!(
            !message.contains(&typed[2]) && !message.contains(&real),
            "{message}"
        );
        let short = words::parse("abandon ability").unwrap_err();
        assert!(words_refused(&short).0.contains("2 words"));
    }

    #[test]
    fn a_foreign_answer_ends_its_sentence_before_the_next_one() {
        // As the executor answers an agent language with no identity log (seen on a real computer).
        let answer = ClientError::Rpc(RpcError {
            code: 503,
            message: "unavailable: the agent language does not serve identity-append".into(),
            data: None,
        });
        let Screen::Failed { message } = unfinished(&answer) else {
            unreachable!()
        };
        assert!(
            message.contains("does not serve identity-append. Try again in a moment"),
            "{message}"
        );
        let Screen::Failed { message } = failed(&answer) else {
            unreachable!()
        };
        assert!(message.ends_with("identity-append."), "{message}");

        // An answer that ends its own sentence keeps the one stop it has.
        let stopped = ClientError::Rpc(RpcError {
            code: 500,
            message: "The log is full!".into(),
            data: None,
        });
        let Screen::Failed { message } = failed(&stopped) else {
            unreachable!()
        };
        assert!(message.ends_with("answered: The log is full!"), "{message}");
    }

    #[test]
    fn a_count_refusal_says_word_for_one_and_words_for_more() {
        let count = |typed: &str| words_refused(&words::parse(typed).unwrap_err()).0;
        assert_eq!(
            count("abandon"),
            "That's 1 word. Enter all 12 words in order."
        );
        assert_eq!(
            count("abandon ability"),
            "That's 2 words. Enter all 12 words in order."
        );
        assert_eq!(
            count(&["abandon"; 13].join(" ")),
            "That's 13 words. Enter all 12 words in order."
        );
    }

    /// The 12 words of `entropy`, as a person types them.
    fn phrase_of(entropy: u8) -> String {
        words::from_entropy(&[entropy; 16]).words().join(" ")
    }

    /// A fake executor behind the custody enc adapter, as [`connect`] puts it.
    type Adapted = ViaExecutor<WithEncKey<FakeExecutor>>;

    /// `fake` behind the custody enc adapter, with an enc key of its own and nothing in its
    /// sealed inbox: the adapter answers the master key waiting and the inbox from that.
    fn adapted(fake: FakeExecutor) -> Adapted {
        fake.answer("identity.inboxSealed", json!([]));
        let enc = ad4m_identity_client::SoftEncKey::new(ad4m_identity_core::X25519Secret::from(
            [8u8; 32],
        ));
        ViaExecutor::new(WithEncKey::new(fake, Box::new(enc), Box::new(SystemClock)))
    }

    /// An executor that speaks for the identity `events` make (this computer its `d1`) and serves
    /// that log, with no record, no request and nothing in the inbox.
    fn executor_of(events: &[Event]) -> Adapted {
        let fake = FakeExecutor::new();
        let scid = events[0].scid.clone();
        fake.answer(
            "identity.log",
            json!({ "did": did_of(&scid), "events": events, "head": null, "fork": null }),
        );
        fake.answer("identity.record", Value::Null);
        fake.answer("identity.requests", json!([]));
        *fake.held.borrow_mut() = Some(scid);
        adapted(fake)
    }

    /// Master `index` of the words of `log_with_d2`, kept in `vault`.
    fn keep_master(vault: &DesktopVault, scid: &str, index: u32) {
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let key = words::master_key(&seed, index).unwrap();
        Vault::store_master(
            &vault.unlocking(None),
            scid,
            index,
            Secret::new(key.to_bytes()),
        )
        .unwrap();
    }

    /// A take whose `holdsMaster` mark is owed ([`Taken::record_pending`]) is completed by the
    /// master just taken: the executor names this computer's key, the vault opens that master
    /// for [`MasterUse::Record`], and the write goes on to the log (which this fake does not
    /// serve, so it answers the executor's refusal). With no master kept, the unlock is what
    /// refuses. A take whose mark landed is answered as it is, with no call made.
    #[tokio::test]
    async fn a_take_whose_record_mark_is_owed_is_completed_by_the_master() {
        let did = did_of(LINKED_SCID);
        let owed = || Taken {
            did: did.clone(),
            index: 1,
            record: Err(ClientError::RecoveryNeedsReattest),
            record_pending: true,
        };

        let executor = linked_executor();
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let landed = Taken {
            did: did.clone(),
            index: 1,
            record: Ok(7),
            record_pending: false,
        };
        let answered = complete_take(&executor, &vault.unlocking(None), landed).await;
        assert!(matches!(answered.record, Ok(7)) && !answered.record_pending);
        assert_eq!(executor.rpc().calls.get(), 0);

        // No master kept: the completion reaches the unlock, which finds none.
        let completed = complete_take(&executor, &vault.unlocking(None), owed()).await;
        assert!(
            matches!(
                completed.record,
                Err(ClientError::Vault(VaultError::NotFound))
            ),
            "{:?}",
            completed.record
        );
        assert!(completed.record_pending);
        assert_eq!(executor.rpc().called("identity.status").len(), 1);

        // The master kept: past the unlock, the write asks the executor for the log.
        keep_master(&vault, LINKED_SCID, 1);
        let completed = complete_take(&executor, &vault.unlocking(None), owed()).await;
        assert!(
            matches!(&completed.record, Err(ClientError::Rpc(e)) if e.code == 404),
            "{:?}",
            completed.record
        );
        assert!(completed.record_pending);
        assert_eq!(executor.rpc().called("identity.status").len(), 2);
    }

    /// The event each `identity.publish` carried.
    fn published(executor: &Adapted) -> Vec<Event> {
        executor
            .rpc()
            .rpc()
            .called("identity.publish")
            .iter()
            .map(|p| Event::from_json(&p["events"][0]).unwrap())
            .collect()
    }

    /// Every string a screen carries, keys left out.
    fn strings_of(value: &Value, into: &mut Vec<String>) {
        match value {
            Value::String(s) => into.push(s.clone()),
            Value::Array(items) => items.iter().for_each(|v| strings_of(v, into)),
            Value::Object(fields) => fields.values().for_each(|v| strings_of(v, into)),
            _ => {}
        }
    }

    /// No screen carries a word of the phrase, two of its words together, or what was `typed` in
    /// a word's place.
    fn shows_no_word(screens: &[Screen], phrase: &str, typed: &[&str]) {
        let words: Vec<&str> = phrase.split(' ').collect();
        for screen in screens {
            let mut strings = Vec::new();
            strings_of(&serde_json::to_value(screen).unwrap(), &mut strings);
            for s in strings {
                assert!(!words.contains(&s.as_str()), "{s}");
                for pair in words.windows(2) {
                    assert!(!s.contains(&pair.join(" ")), "{s}");
                }
                for t in typed {
                    assert!(!s.contains(t), "{s}");
                }
            }
        }
    }

    #[tokio::test]
    async fn replacing_the_master_key_asks_again_for_words_that_are_not_the_identitys() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        keep_master(&vault, &scid, 0);
        let (address, mut rx, mut reply, window, first) = opened();
        let phrase = phrase_of(41);
        let mut typo: Vec<String> = phrase.split(' ').map(str::to_string).collect();
        typo[2] = "zzzq".into();
        let typo = typo.join(" ");
        let other = phrase_of(9);
        let ex = &executor;
        let ((), screens) = tokio::join!(
            replace_master_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                for words in [&typo, &other] {
                    shown.push(
                        window
                            .step(StepInput::TwelveWords {
                                words: words.clone().into(),
                            })
                            .await,
                    );
                }
                // Nothing is published for words that are not the identity's.
                assert_eq!(ex.rpc().rpc().publishes.get(), 0);
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.clone().into(),
                        })
                        .await,
                );
                shown
            }
        );
        assert!(
            matches!(
                &screens[0],
                Screen::EnterWords {
                    purpose: "replace",
                    error: None,
                    ..
                }
            ),
            "{:?}",
            screens[0]
        );
        assert!(
            matches!(&screens[1], Screen::EnterWords { position: Some(3), error: Some(m), .. } if m.contains("Word 3")),
            "{:?}",
            screens[1]
        );
        assert!(
            matches!(&screens[2], Screen::EnterWords { position: None, error: Some(m), .. } if m == NOT_THESE_WORDS),
            "{:?}",
            screens[2]
        );
        assert!(
            matches!(&screens[3], Screen::MasterReplaced { index: 1, revoked, .. } if revoked.is_empty()),
            "{:?}",
            screens[3]
        );
        // One rotation, to master #1, which this computer keeps now.
        let rotations = published(&executor);
        assert_eq!(rotations.len(), 1);
        assert!(matches!(rotations[0].op, Op::Rotate { .. }));
        let mut log = events.clone();
        log.extend(rotations);
        ad4m_identity_core::fold(&log).unwrap();
        assert_eq!(vault.master_index(&scid).unwrap(), Some(1));
        shows_no_word(&screens, &phrase, &["zzzq"]);
    }

    #[test]
    fn a_bot_scope_is_the_actions_a_bot_can_take_once_each_until_a_day_in_range() {
        let can = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        let scope = bot_scope(&can(&["join", "read", "join"]), 30, 1_000).unwrap();
        assert_eq!(scope.can, can(&["read", "join"]));
        assert_eq!(scope.expires, 1_000 + 30 * 86_400);
        assert_eq!(
            bot_scope(&can(&["write"]), BOT_DAYS_MAX, 0)
                .unwrap()
                .expires,
            u64::from(BOT_DAYS_MAX) * 86_400
        );
        for (list, days, says) in [
            (can(&[]), 30, "at least one"),
            (can(&["read", "admin"]), 30, "nothing else"),
            (can(&["read"]), 0, "from 1 to 365"),
            (can(&["read"]), BOT_DAYS_MAX + 1, "from 1 to 365"),
        ] {
            let refused = bot_scope(&list, days, 0).unwrap_err();
            assert!(refused.contains(says), "{list:?} {days}: {refused}");
        }
    }

    #[test]
    fn the_add_bot_step_and_its_screens_cross_ipc_in_the_windows_shapes() {
        let step: IdentityStep = serde_json::from_value(json!({ "kind": "add-bot" })).unwrap();
        assert!(matches!(step, IdentityStep::AddBot));
        let input: StepInput =
            serde_json::from_value(json!({ "kind": "bot-scope", "can": ["read"], "days": 30 }))
                .unwrap();
        assert!(matches!(&input, StepInput::BotScope { can, days: 30 } if can == &["read"]));
        assert_eq!(format!("{input:?}"), "bot-scope");
        let offer = Screen::BotOffer {
            offer: "coasys:offer:1:x".into(),
            can: vec!["read".into()],
            key_expires: 9,
            expires: 8,
        };
        assert_eq!(
            serde_json::to_value(&offer).unwrap(),
            json!({ "screen": "bot-offer", "offer": "coasys:offer:1:x", "can": ["read"], "keyExpires": 9, "expires": 8 })
        );
        let added = Screen::BotAdded {
            seq: 3,
            key_id: "d3".into(),
            name: "Test bot".into(),
            note: None,
        };
        assert_eq!(
            serde_json::to_value(&added).unwrap(),
            json!({ "screen": "bot-added", "seq": 3, "keyId": "d3", "name": "Test bot", "note": null })
        );
        assert_eq!(
            serde_json::to_value(Screen::BotScope { error: None }).unwrap(),
            json!({ "screen": "bot-scope", "error": null })
        );
        assert_eq!(
            serde_json::to_value(Screen::BotMatch {
                code: "123456".into(),
                name: None
            })
            .unwrap(),
            json!({ "screen": "bot-match", "code": "123456", "name": null })
        );
        assert_eq!(added.outcome(), Some(StepOutcome::Done));
        for open in [offer, Screen::BotScope { error: None }] {
            assert_eq!(open.outcome(), None, "{open:?}");
        }
    }

    /// An executor that speaks for the identity of `log_with_d2`, whose master key this vault
    /// keeps, with a head from its store: one that can open an offer.
    fn holder_with_head() -> (Adapted, DesktopVault) {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        executor.rpc().rpc().answer(
            "identity.log",
            json!({
                "did": did_of(&scid),
                "events": events,
                "head": { "scid": scid, "seq": events.len() - 1, "hash": "h", "time": 0, "store": "did:key:zStore", "sig": "s" },
                "fork": null,
            }),
        );
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        keep_master(&vault, &scid, 0);
        (executor, vault)
    }

    #[tokio::test]
    async fn adding_a_bot_opens_a_bot_offer_of_the_scope_picked_and_nothing_before() {
        let (executor, vault) = holder_with_head();
        // The store lists no offer: the wait ends as the offer did.
        executor.rpc().rpc().answer("identity.offers", json!([]));
        let (address, mut rx, mut reply, window, first) = opened();
        let ex = &executor;
        let ((), screens) = tokio::join!(
            add_bot_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                for (can, days) in [(vec![], 30), (vec!["read".to_string()], 0)] {
                    shown.push(window.step(StepInput::BotScope { can, days }).await);
                }
                // Nothing is opened for a scope refused.
                assert!(ex.rpc().rpc().called("identity.openOffer").is_empty());
                shown.push(
                    window
                        .step(StepInput::BotScope {
                            can: vec!["write".into(), "read".into()],
                            days: 30,
                        })
                        .await,
                );
                shown.push(window.step(StepInput::WaitClaim).await);
                shown
            }
        );
        assert!(
            matches!(&screens[0], Screen::BotScope { error: None }),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[1], Screen::BotScope { error: Some(m) } if m.contains("at least one")),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[2], Screen::BotScope { error: Some(m) } if m.contains("days")),
            "{screens:?}"
        );
        let Screen::BotOffer {
            offer,
            can,
            key_expires,
            ..
        } = &screens[3]
        else {
            panic!("{screens:?}");
        };
        assert!(offer.starts_with("coasys:offer:1:"), "{offer}");
        assert_eq!(can, &["read", "write"]);
        let opened = executor.rpc().rpc().called("identity.openOffer");
        assert_eq!(opened.len(), 1);
        let sent = &opened[0]["signedOffer"]["offer"];
        assert_eq!(sent["kind"], "bot", "{sent}");
        assert_eq!(sent["bot"]["can"], json!(["read", "write"]), "{sent}");
        assert_eq!(sent["bot"]["expires"], json!(key_expires), "{sent}");
        let Screen::Failed { message } = &screens[4] else {
            panic!("{screens:?}");
        };
        assert!(message.to_lowercase().contains("offer"), "{message}");
        assert_eq!(executor.rpc().rpc().publishes.get(), 0);
    }

    #[tokio::test]
    async fn only_the_computer_that_keeps_the_master_key_adds_a_bot() {
        let executor = linked_executor();
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, _window, first) = opened();
        let ((), shown) = tokio::join!(
            add_bot_on(&executor, &vault, &address, &mut rx, &mut reply),
            async { first.await.unwrap().unwrap() }
        );
        assert!(
            matches!(&shown, Screen::Failed { message } if message.contains("does not keep your master key")),
            "{shown:?}"
        );
        assert!(executor.rpc().called("identity.openOffer").is_empty());
    }

    #[test]
    fn the_add_cloud_device_step_and_its_screens_cross_ipc_in_the_windows_shapes() {
        let step: IdentityStep = serde_json::from_value(
            json!({ "kind": "add-cloud-device", "host": { "kind": "address", "url": "h.example.org" } }),
        )
        .unwrap();
        assert!(matches!(
            &step,
            IdentityStep::AddCloudDevice { host: crate::cloud::CloudHost::Address { url } } if url == "h.example.org"
        ));
        let coasys: IdentityStep = serde_json::from_value(
            json!({ "kind": "add-cloud-device", "host": { "kind": "coasys" } }),
        )
        .unwrap();
        assert!(matches!(
            coasys,
            IdentityStep::AddCloudDevice {
                host: crate::cloud::CloudHost::Coasys
            }
        ));
        let input: StepInput =
            serde_json::from_value(json!({ "kind": "invite", "code": "https://x#abc" })).unwrap();
        assert!(matches!(&input, StepInput::Invite { code } if code == "https://x#abc"));
        // The invite is a credential: the debug form never prints it.
        assert_eq!(format!("{input:?}"), "invite");
        assert_eq!(
            serde_json::to_value(Screen::CloudInvite {
                host: "Coasys cloud".into(),
                error: None
            })
            .unwrap(),
            json!({ "screen": "cloud-invite", "host": "Coasys cloud", "error": null })
        );
        assert_eq!(
            serde_json::to_value(Screen::CloudJoining { host: "H".into() }).unwrap(),
            json!({ "screen": "cloud-joining", "host": "H" })
        );
        assert_eq!(
            serde_json::to_value(Screen::CloudMatch {
                code: "R7K Q2M".into(),
                host: "H".into()
            })
            .unwrap(),
            json!({ "screen": "cloud-match", "code": "R7K Q2M", "host": "H" })
        );
        let added = Screen::CloudAdded {
            host: "H".into(),
            active: true,
        };
        assert_eq!(
            serde_json::to_value(&added).unwrap(),
            json!({ "screen": "cloud-added", "host": "H", "active": true })
        );
        assert_eq!(added.outcome(), Some(StepOutcome::Done));
        for open in [
            Screen::CloudInvite {
                host: "H".into(),
                error: None,
            },
            Screen::CloudJoining { host: "H".into() },
            Screen::CloudMatch {
                code: "c".into(),
                host: "H".into(),
            },
        ] {
            assert_eq!(open.outcome(), None, "{open:?}");
        }
    }

    /// A host the test keeps a hand on while the flow holds it.
    struct SharedHost(Rc<FakeExecutor>);

    #[async_trait::async_trait(?Send)]
    impl ExecutorRpc for SharedHost {
        async fn call(&self, method: &str, p: Value) -> Result<Value, RpcError> {
            self.0.call(method, p).await
        }
    }

    /// A host that answers `host.info` as `signup` says.
    fn host_with(signup: &'static str, full: bool) -> (CloudTarget<SharedHost>, Rc<FakeExecutor>) {
        let host = Rc::new(FakeExecutor::new());
        host.answer(
            "host.info",
            json!({ "multiUser": true, "signup": signup, "name": "Garden host",
                    "runByCoasys": false, "full": full }),
        );
        let target = CloudTarget {
            rpc: SharedHost(host.clone()),
            url: "https://garden.example".into(),
            coasys: false,
        };
        (target, host)
    }

    #[tokio::test]
    async fn a_host_that_is_full_is_refused_before_anything_is_opened() {
        let (executor, vault) = holder_with_head();
        executor.rpc().rpc().vouched.set(true);
        let (target, _host) = host_with("anyone", true);
        let (address, mut rx, mut reply, _window, first) = opened();
        let ((), shown) = tokio::join!(
            link_on(
                &executor,
                Some(target),
                &vault,
                &address,
                &mut rx,
                &mut reply
            ),
            async { first.await.unwrap().unwrap() }
        );
        assert!(
            matches!(&shown, Screen::Failed { message } if message.contains("is full")),
            "{shown:?}"
        );
        assert!(executor.rpc().rpc().called("identity.openOffer").is_empty());
        assert_eq!(executor.rpc().rpc().publishes.get(), 0);
    }

    #[tokio::test]
    async fn a_host_that_wants_an_invite_asks_for_it_and_asks_again_when_it_does_not_work() {
        let (executor, vault) = holder_with_head();
        executor.rpc().rpc().vouched.set(true);
        let (target, host) = host_with("by_invite", false);
        host.refuse("host.join", 403, "invite-invalid: no such invite");
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            link_on(
                &executor,
                Some(target),
                &vault,
                &address,
                &mut rx,
                &mut reply
            ),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::Invite {
                            code: "not an invite".into(),
                        })
                        .await,
                );
                assert!(host.called("host.join").is_empty());
                shown.push(
                    window
                        .step(StepInput::Invite {
                            code: "https://coasys.id/i#abc-123".into(),
                        })
                        .await,
                );
                shown.push(window.step(StepInput::WaitClaim).await);
                // A refusal other than the invite ends the step.
                host.refuse("host.join", 403, "host-full: no room");
                shown.push(
                    window
                        .step(StepInput::Invite {
                            code: "abc-123".into(),
                        })
                        .await,
                );
                shown.push(window.step(StepInput::WaitClaim).await);
                shown
            }
        );
        assert!(
            matches!(&screens[0], Screen::CloudInvite { host, error: None } if host == "Garden host"),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[1], Screen::CloudInvite { error: Some(m), .. } if m.contains("not an invite")),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[2], Screen::CloudJoining { .. }),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[3], Screen::CloudInvite { error: Some(m), .. } if m.contains("does not work")),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[4], Screen::CloudJoining { .. }),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[5], Screen::Failed { message } if message.contains("full")),
            "{screens:?}"
        );
        let joins = host.called("host.join");
        assert_eq!(joins.len(), 2);
        assert_eq!(joins[0]["inviteSecret"], "abc-123");
        assert!(
            joins[0]["offer"]
                .as_str()
                .unwrap()
                .starts_with("coasys:offer:1:"),
            "{}",
            joins[0]
        );
        assert!(joins[0]["didScid"]
            .as_str()
            .unwrap()
            .starts_with("did:scid:"));
        assert_eq!(executor.rpc().rpc().publishes.get(), 0);
    }

    #[tokio::test]
    async fn a_host_that_asks_for_no_invite_is_asked_to_claim_the_offer_with_none() {
        let (executor, vault) = holder_with_head();
        executor.rpc().rpc().vouched.set(true);
        // No claim ever reaches the store: the wait ends as the offer did.
        executor.rpc().rpc().answer("identity.offers", json!([]));
        let (target, host) = host_with("anyone", false);
        host.answer(
            "host.join",
            json!({ "joinHandle": "h1", "tenantId": "t1", "deviceDid": "did:key:zD", "rejoin": false }),
        );
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), (first_screen, last)) = tokio::join!(
            link_on(
                &executor,
                Some(target),
                &vault,
                &address,
                &mut rx,
                &mut reply
            ),
            async {
                (
                    first.await.unwrap().unwrap(),
                    window.step(StepInput::WaitClaim).await,
                )
            }
        );
        assert!(
            matches!(&first_screen, Screen::CloudJoining { host } if host == "Garden host"),
            "{first_screen:?}"
        );
        assert!(matches!(last, Screen::Failed { .. }), "{last:?}");
        assert_eq!(host.called("host.join")[0]["inviteSecret"], Value::Null);
        assert_eq!(executor.rpc().rpc().called("identity.openOffer").len(), 1);
    }

    /// A vault in the keychain (no passphrase) with its custody lists in `dir`, where a file can
    /// go missing as it does on a disk.
    fn keychain_vault_in(dir: &std::path::Path) -> DesktopVault {
        DesktopVault::new(
            Box::new(crate::store::MemoryStore::as_kind(
                crate::store::StoreKind::Keychain,
            )),
            PendingIncepts::file(dir),
        )
    }

    /// Lal's review of we#431 at 0d4501589: a custody folder that lost its epochs file refuses
    /// to change the kept key, and "Replace master key" is the way back. The words are
    /// checked against the log's current master first; then the identity's epoch is recovered,
    /// and the rotation goes on.
    #[tokio::test]
    async fn replacing_the_master_key_recovers_a_lost_custody_epoch_with_the_right_words() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let dir = tempfile::tempdir().unwrap();
        let vault = keychain_vault_in(dir.path());
        keep_master(&vault, &scid, 0);
        let read = vault.custody_epoch(&scid).unwrap();
        std::fs::remove_file(dir.path().join(crate::pending::EPOCHS_FILE_NAME)).unwrap();
        assert!(vault.custody_epoch(&scid).is_err());

        let (address, mut rx, mut reply, window, first) = opened();
        let phrase = phrase_of(41);
        let ((), screens) = tokio::join!(
            replace_master_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.clone().into(),
                        })
                        .await,
                );
                shown
            }
        );
        assert!(
            matches!(&screens[1], Screen::MasterReplaced { index: 1, .. }),
            "{:?}",
            screens[1]
        );
        assert_eq!(published(&executor).len(), 1);
        assert_eq!(vault.master_index(&scid).unwrap(), Some(1));
        let now = vault.custody_epoch(&scid).unwrap();
        assert_ne!(now, read);
        // A removal paused across the loss keeps the key.
        assert_eq!(
            Vault::forget_master_at(&vault.unlocking(None), &scid, read).unwrap(),
            ad4m_identity_client::vault::Forgot::Kept(1)
        );
    }

    /// The same with words that are not the identity's: nothing is recovered, nothing published,
    /// and the epoch read is still the error it was.
    #[tokio::test]
    async fn words_that_are_not_the_identitys_recover_no_lost_custody_epoch() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let dir = tempfile::tempdir().unwrap();
        let vault = keychain_vault_in(dir.path());
        keep_master(&vault, &scid, 0);
        std::fs::remove_file(dir.path().join(crate::pending::EPOCHS_FILE_NAME)).unwrap();

        let (address, mut rx, mut reply, window, first) = opened();
        let other = phrase_of(9);
        let ex = &executor;
        let ((), screens) = tokio::join!(
            replace_master_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: other.clone().into(),
                        })
                        .await,
                );
                assert_eq!(ex.rpc().rpc().publishes.get(), 0);
                // The window closes: the step ends.
                drop(window);
                shown
            }
        );
        assert!(
            matches!(&screens[1], Screen::EnterWords { error: Some(m), .. } if m == NOT_THESE_WORDS),
            "{:?}",
            screens[1]
        );
        assert_eq!(executor.rpc().rpc().publishes.get(), 0);
        assert!(!dir.path().join(crate::pending::EPOCHS_FILE_NAME).exists());
        let still = vault.custody_epoch(&scid);
        assert!(
            still.as_ref().is_err_and(crate::pending::is_lost_epoch),
            "{still:?}"
        );
        assert_eq!(vault.master_index(&scid).unwrap(), Some(0));
    }

    /// A step that stops on a lost custody epoch says what happened and which step goes on.
    #[test]
    fn a_lost_custody_epoch_names_the_step_that_recovers_it() {
        let dir = tempfile::tempdir().unwrap();
        let vault = keychain_vault_in(dir.path());
        Vault::store_master(
            &vault.unlocking(None),
            LINKED_SCID,
            0,
            Secret::new([3u8; 32]),
        )
        .unwrap();
        std::fs::remove_file(dir.path().join(crate::pending::EPOCHS_FILE_NAME)).unwrap();
        let lost = vault.custody_epoch(LINKED_SCID).unwrap_err();
        for message in [
            match failed(&ClientError::Vault(lost.clone())) {
                Screen::Failed { message } => message,
                other => panic!("{other:?}"),
            },
            after_publish(&ClientError::Vault(lost)),
        ] {
            assert_eq!(message, LOST_EPOCH);
            assert!(message.contains("Replace master key"), "{message}");
        }
    }

    /// A store that refuses its next rename, as a keychain that refuses an update: the vault
    /// cannot promote the key a rotation staged, once.
    struct RefusesRename {
        items: crate::store::MemoryStore,
        refuse: std::sync::atomic::AtomicBool,
    }

    impl RefusesRename {
        fn once() -> DesktopVault {
            DesktopVault::new(
                Box::new(RefusesRename {
                    items: crate::store::MemoryStore::as_kind(crate::store::StoreKind::Keychain),
                    refuse: std::sync::atomic::AtomicBool::new(true),
                }),
                PendingIncepts::memory(),
            )
        }
    }

    impl crate::store::SecretStore for RefusesRename {
        fn kind(&self) -> crate::store::StoreKind {
            self.items.kind()
        }
        fn kind_of(&self, name: &str) -> Result<crate::store::StoreKind, VaultError> {
            self.items.kind_of(name)
        }
        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            self.items.put(name, bytes)
        }
        fn claim_public(&self, name: &str, bytes: &[u8]) -> Result<bool, VaultError> {
            self.items.claim_public(name, bytes)
        }
        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            self.items.get(name)
        }
        fn contains(&self, name: &str) -> Result<bool, VaultError> {
            self.items.contains(name)
        }
        fn delete(&self, name: &str) -> Result<(), VaultError> {
            self.items.delete(name)
        }
        fn put_tagged(
            &self,
            name: &str,
            bytes: &[u8],
            tag: &crate::store::ItemTag,
        ) -> Result<(), VaultError> {
            self.items.put_tagged(name, bytes, tag)
        }
        fn tag_of(&self, name: &str) -> Result<Option<crate::store::ItemTag>, VaultError> {
            self.items.tag_of(name)
        }
        fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
            if self.refuse.swap(false, std::sync::atomic::Ordering::SeqCst) {
                return Err(VaultError::Unavailable(
                    "the keychain refused the update".into(),
                ));
            }
            self.items.rename(from, to)
        }
        fn claim_secret(
            &self,
            name: &str,
            bytes: &[u8],
        ) -> Result<zeroize::Zeroizing<Vec<u8>>, VaultError> {
            self.items.claim_secret(name, bytes)
        }
    }

    /// No string of `screens` says that nothing changed: each follows a published rotation.
    fn says_nothing_changed(screens: &[Screen]) -> Option<String> {
        let mut strings = Vec::new();
        for screen in screens {
            strings_of(&serde_json::to_value(screen).unwrap(), &mut strings);
        }
        strings
            .into_iter()
            .find(|s| s.contains("Nothing") || s.contains("nothing changed"))
    }

    /// The log `events` serves, as `executor_of` answers it.
    fn serve_log(executor: &Adapted, events: &[Event]) {
        executor.rpc().rpc().answer(
            "identity.log",
            json!({ "did": did_of(&events[0].scid), "events": events, "head": null, "fork": null }),
        );
    }

    #[tokio::test]
    async fn a_rotation_this_computer_could_not_keep_says_the_key_was_replaced_and_tries_again() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let vault = RefusesRename::once();
        keep_master(&vault, &scid, 0);
        let (address, mut rx, mut reply, window, first) = opened();
        let phrase = phrase_of(41);
        let ex = &executor;
        let log = events.clone();
        let ((), screens) = tokio::join!(
            replace_master_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.clone().into(),
                        })
                        .await,
                );
                // The store serves the rotation that landed.
                let mut log = log.clone();
                log.extend(published(ex));
                serve_log(ex, &log);
                shown.push(window.step(StepInput::TryAgain).await);
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.clone().into(),
                        })
                        .await,
                );
                shown
            }
        );
        assert!(
            matches!(&screens[1], Screen::MasterNotKept { index: 1, reason, .. }
                if reason.contains("the keychain refused the update")),
            "{:?}",
            screens[1]
        );
        assert!(
            matches!(
                &screens[2],
                Screen::EnterWords {
                    purpose: "replace",
                    error: None,
                    ..
                }
            ),
            "{:?}",
            screens[2]
        );
        assert!(
            matches!(&screens[3], Screen::MasterReplaced { index: 2, .. }),
            "{:?}",
            screens[3]
        );
        assert_eq!(says_nothing_changed(&screens[1..]), None);
        // Two rotations landed; this computer keeps the second, and nothing is left staged.
        let mut log = events.clone();
        log.extend(published(&executor));
        assert_eq!(log.len(), 4);
        ad4m_identity_core::fold(&log).unwrap();
        assert_eq!(vault.master_index(&scid).unwrap(), Some(2));
        assert_eq!(vault.staged_index(&scid).unwrap(), None);
        shows_no_word(&screens, &phrase, &[]);
    }

    #[tokio::test]
    async fn a_restore_whose_enrolment_failed_is_restored_and_links_this_computer_on_try_again() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let did = did_of(&scid);
        // The executor whose device key is d1's: a computer the identity listed before.
        let executor = unlinked_executor(&events);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let phrase = phrase_of(41);
        let ex = &executor;
        let log = events.clone();
        let ((), screens) = tokio::join!(
            restore_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.clone().into(),
                        })
                        .await,
                );
                // The log still served is the one before the rotation, so the enrolment
                // after it fails.
                shown.push(
                    window
                        .step(StepInput::LockOut {
                            key_ids: vec!["d2".into()],
                            name: Some("Desk".into()),
                        })
                        .await,
                );
                let mut log = log.clone();
                log.extend(published(ex));
                serve_log(ex, &log);
                shown.push(window.step(StepInput::TryAgain).await);
                shown
            }
        );
        assert!(
            matches!(&screens[1], Screen::RestoreDevices { .. }),
            "{:?}",
            screens[1]
        );
        assert!(
            matches!(&screens[2], Screen::RestoreNotLinked { did: d, revoked, .. }
                if d == &did && revoked == &["d2".to_string()]),
            "{:?}",
            screens[2]
        );
        assert!(
            matches!(&screens[3], Screen::Restored { key_id, name, revoked, .. }
                if key_id == "d1" && name == "Desk" && revoked == &["d2".to_string()]),
            "{:?}",
            screens[3]
        );
        assert_eq!(says_nothing_changed(&screens[2..]), None);
        // One rotation: "Try again" published nothing and asked for no words; the vault keeps
        // the key the rotation staged.
        assert_eq!(executor.rpc().rpc().publishes.get(), 1);
        assert_eq!(vault.master_index(&scid).unwrap(), Some(1));
        assert_eq!(vault.staged_index(&scid).unwrap(), None);
        shows_no_word(&screens, &phrase, &[]);
    }

    /// An executor of no identity yet whose device key is d1's, serving `events` and naming
    /// their identity as the owner of any words: a computer a first restore runs on.
    fn unlinked_executor(events: &[Event]) -> Adapted {
        let executor = adapted(FakeExecutor {
            device: KeySigner::new(&[2u8; 32], 0),
            ..FakeExecutor::new()
        });
        serve_log(&executor, events);
        let fake = executor.rpc().rpc();
        fake.answer("identity.record", Value::Null);
        fake.answer("identity.requests", json!([]));
        fake.answer(
            "identity.keyOwner",
            json!({ "did": did_of(&events[0].scid), "keyId": "m0", "added": 0, "revoked": null }),
        );
        executor
    }

    /// "Restore with recovery phrase" with `phrase` on `executor`, every other device locked out, as far as
    /// it goes: its screens. Where the rotation published and the log served is still the one
    /// before it, the log is served again with it and "Try again" links this computer, so a
    /// restore that went through ends on [`Screen::Restored`].
    async fn restore_with(
        executor: &Adapted,
        vault: &DesktopVault,
        events: &[Event],
        phrase: &str,
    ) -> Vec<Screen> {
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            restore_on(executor, vault, &address, &mut rx, &mut reply),
            async move {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.to_string().into(),
                        })
                        .await,
                );
                if !matches!(shown.last(), Some(Screen::RestoreDevices { .. })) {
                    return shown;
                }
                shown.push(
                    window
                        .step(StepInput::LockOut {
                            key_ids: vec!["d2".into()],
                            name: Some("Desk".into()),
                        })
                        .await,
                );
                if matches!(shown.last(), Some(Screen::RestoreNotLinked { .. })) {
                    let mut log = events.to_vec();
                    log.extend(published(executor));
                    serve_log(executor, &log);
                    shown.push(window.step(StepInput::TryAgain).await);
                }
                shown
            }
        );
        screens
    }

    /// Lal's review of we#431 at 564d9aaa0: on a computer not linked to an identity yet, a lost
    /// custody epoch of the identity the words name is recovered by "Restore with recovery phrase" — the way
    /// back the lost-epoch screen names there, "Replace master key" refusing an unlinked
    /// computer. The words are checked against the log's current master first. Both losses: the
    /// whole epochs file, and the identity's entry in a file that is there. Another identity
    /// noted and lost stays lost.
    #[tokio::test]
    async fn a_restore_on_an_unlinked_computer_recovers_a_lost_custody_epoch_with_the_right_words()
    {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        for whole_file in [true, false] {
            let dir = tempfile::tempdir().unwrap();
            let folder = PendingIncepts::file(dir.path());
            for s in [scid.as_str(), "QmOther"] {
                folder.exclusive().unwrap().establish_epoch(s).unwrap();
            }
            std::fs::remove_file(dir.path().join(crate::pending::EPOCHS_FILE_NAME)).unwrap();
            if !whole_file {
                // The file there again, holding a third identity's entry only.
                folder
                    .exclusive()
                    .unwrap()
                    .recover_epoch("QmThird")
                    .unwrap();
            }
            let vault = keychain_vault_in(dir.path());
            assert!(vault
                .custody_epoch(&scid)
                .as_ref()
                .is_err_and(crate::pending::is_lost_epoch));
            let executor = unlinked_executor(&events);

            let screens = restore_with(&executor, &vault, &events, &phrase_of(41)).await;
            assert!(
                matches!(screens.last(), Some(Screen::Restored { key_id, revoked, .. })
                    if key_id == "d1" && revoked == &["d2".to_string()]),
                "whole file {whole_file}: {screens:?}"
            );
            assert_eq!(executor.rpc().rpc().publishes.get(), 1);
            assert_eq!(vault.master_index(&scid).unwrap(), Some(1));
            assert_ne!(vault.custody_epoch(&scid).unwrap(), 0);
            assert!(vault
                .custody_epoch("QmOther")
                .as_ref()
                .is_err_and(crate::pending::is_lost_epoch));
            shows_no_word(&screens, &phrase_of(41), &[]);
        }
    }

    /// The same lost epoch, and words that are not the identity's: nothing is recovered — the
    /// custody folder's files are as they were — and nothing is published.
    #[tokio::test]
    async fn a_restore_with_the_wrong_words_recovers_no_lost_custody_epoch() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let dir = tempfile::tempdir().unwrap();
        PendingIncepts::file(dir.path())
            .exclusive()
            .unwrap()
            .establish_epoch(&scid)
            .unwrap();
        std::fs::remove_file(dir.path().join(crate::pending::EPOCHS_FILE_NAME)).unwrap();
        let metadata = dir.path().join(crate::pending::METADATA_FILE_NAME);
        let before = std::fs::read(&metadata).unwrap();
        let vault = keychain_vault_in(dir.path());
        let executor = unlinked_executor(&events);

        let screens = restore_with(&executor, &vault, &events, &phrase_of(9)).await;
        assert!(
            matches!(screens.last(), Some(Screen::EnterWords { error: Some(m), .. }) if m == NOT_THESE_WORDS),
            "{screens:?}"
        );
        assert_eq!(executor.rpc().rpc().publishes.get(), 0);
        assert_eq!(std::fs::read(&metadata).unwrap(), before);
        assert!(!dir.path().join(crate::pending::EPOCHS_FILE_NAME).exists());
        assert!(vault
            .custody_epoch(&scid)
            .as_ref()
            .is_err_and(crate::pending::is_lost_epoch));
    }

    /// Lal's review of we#431 at 564d9aaa0, end to end: a first restore on an unlinked computer
    /// stops as a crash would after the identity's first epoch entry and before its note (the
    /// metadata's write fails: its temp name is taken), or before the entry (the epochs file's
    /// write fails). The next start, the same words restore the identity: the epoch read as it
    /// is in the first case, a fresh start in the second.
    #[tokio::test]
    async fn a_first_restore_stopped_around_its_first_epoch_restores_on_the_next_start() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        for stopped in [
            crate::pending::METADATA_FILE_NAME,
            crate::pending::EPOCHS_FILE_NAME,
        ] {
            let dir = tempfile::tempdir().unwrap();
            let blocked = dir
                .path()
                .join(format!("{stopped}.{}.tmp", std::process::id()));
            std::fs::create_dir_all(&blocked).unwrap();
            let executor = unlinked_executor(&events);
            let screens = restore_with(
                &executor,
                &keychain_vault_in(dir.path()),
                &events,
                &phrase_of(41),
            )
            .await;
            assert!(
                matches!(screens.last(), Some(Screen::Failed { .. })),
                "{stopped}: {screens:?}"
            );
            assert_eq!(executor.rpc().rpc().publishes.get(), 0);
            std::fs::remove_dir_all(&blocked).unwrap();

            // The next start: a new vault on the same folder (nothing of the key was kept).
            let vault = keychain_vault_in(dir.path());
            let epoch = vault.custody_epoch(&scid);
            if stopped == crate::pending::METADATA_FILE_NAME {
                assert!(matches!(epoch, Ok(e) if e != 0), "{epoch:?}");
            } else {
                assert!(matches!(epoch, Ok(0)), "{epoch:?}");
            }
            let screens = restore_with(&executor, &vault, &events, &phrase_of(41)).await;
            assert!(
                matches!(screens.last(), Some(Screen::Restored { .. })),
                "{stopped}: {screens:?}"
            );
            assert_eq!(vault.master_index(&scid).unwrap(), Some(1));
        }
    }

    #[test]
    fn what_fails_after_a_publish_never_says_nothing_changed() {
        let errors = [
            ClientError::Vault(VaultError::Cancelled),
            ClientError::Vault(VaultError::NotFound),
            ClientError::Vault(VaultError::Unavailable("locked".into())),
            ClientError::LogBusy,
            ClientError::OfferEnded("expired".into()),
            ClientError::NotAKeeper("d2".into()),
            ClientError::Poster("bad".into()),
            ClientError::NotTheseWords("m1".into()),
            ClientError::Rpc(RpcError {
                code: 503,
                message: "no-store-keys".into(),
                data: None,
            }),
        ];
        for e in &errors {
            let reason = after_publish(e);
            assert!(!reason.contains("Nothing"), "{e:?}: {reason}");
        }
    }

    /*
      Found on a real desktop: a locked login keyring held custody with no limit. The store now
      stops waiting and says the keyring is locked; the person reads what that means and what to
      do, never the store's own words.
    */
    #[test]
    fn a_locked_keyring_says_so_and_what_to_do() {
        let locked = ClientError::Vault(crate::store::keyring_locked());
        let Screen::Failed { message } = failed(&locked) else {
            panic!("failed() answers Failed");
        };
        assert_eq!(message, KEYRING_LOCKED_WORDS);
        assert!(message.contains("keyring is locked") && message.contains("Nothing was changed"));
        assert!(!message.contains("Secret Service"), "{message}");
        let after = after_publish(&locked);
        assert!(
            after.contains("keyring is locked") && !after.contains("Nothing"),
            "{after}"
        );
    }

    #[tokio::test]
    async fn a_revoke_that_also_replaces_the_master_key_leaves_no_holder_to_warn_about() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        keep_master(&vault, &scid, 0);
        let (address, mut rx, mut reply, window, first) = opened();
        let phrase = phrase_of(41);
        let ((), screens) = tokio::join!(
            revoke_on(
                &executor,
                &vault,
                &address,
                &mut rx,
                &mut reply,
                "d2".into()
            ),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::Revoke {
                            passphrase: None,
                            rotate: true,
                        })
                        .await,
                );
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.clone().into(),
                        })
                        .await,
                );
                shown
            }
        );
        // d2 may keep the master key, so the choice starts ticked.
        assert!(
            matches!(
                &screens[0],
                Screen::RevokeConfirm {
                    may_hold_master: true,
                    rotate: true,
                    ..
                }
            ),
            "{:?}",
            screens[0]
        );
        assert!(matches!(
            &screens[1],
            Screen::EnterWords {
                purpose: "revoke",
                ..
            }
        ));
        assert!(
            matches!(&screens[2], Screen::MasterReplaced { index: 1, revoked, .. } if revoked == &["d2".to_string()]),
            "{:?}",
            screens[2]
        );
        // One event revokes d2 and replaces the master key: its copy no longer signs, so the
        // revoked-holder warning has nothing left to say.
        let mut log = events.clone();
        log.extend(published(&executor));
        assert_eq!(log.len(), 3);
        assert!(matches!(&log[2].op, Op::Rotate { .. }));
        assert!(crate::keylog::revoked_holders(&log).is_empty());
        assert_eq!(vault.master_index(&scid).unwrap(), Some(1));
        shows_no_word(&screens, &phrase, &[]);
    }

    #[tokio::test]
    async fn a_revoke_without_the_choice_publishes_a_plain_revoke() {
        let (events, _) = crate::keylog::tests::log_with_d2(false);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        keep_master(&vault, &scid, 0);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            revoke_on(
                &executor,
                &vault,
                &address,
                &mut rx,
                &mut reply,
                "d2".into()
            ),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(
                    window
                        .step(StepInput::Revoke {
                            passphrase: None,
                            rotate: false,
                        })
                        .await,
                );
                shown
            }
        );
        // A device that never could keep the master key: the choice starts unticked.
        assert!(matches!(
            &screens[0],
            Screen::RevokeConfirm {
                may_hold_master: false,
                rotate: false,
                ..
            }
        ));
        assert!(
            matches!(&screens[1], Screen::Revoked { .. }),
            "{:?}",
            screens[1]
        );
        assert!(matches!(&published(&executor)[0].op, Op::Revoke { .. }));
        assert_eq!(vault.master_index(&scid).unwrap(), Some(0));
    }

    #[tokio::test]
    async fn a_restore_finds_the_identity_of_the_words_and_ticks_its_devices_to_lock_out() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let did = did_of(&events[0].scid);
        let executor = executor_of(&events);
        // This computer speaks for no identity yet.
        *executor.rpc().rpc().held.borrow_mut() = None;
        executor
            .rpc()
            .rpc()
            .answer("identity.keyOwner", Value::Null);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        let phrase = phrase_of(41);
        let ex = &executor;
        let owner = json!({ "did": did, "keyId": "m0", "added": 0, "revoked": null });
        let ((), screens) = tokio::join!(
            restore_on(&executor, &vault, &address, &mut rx, &mut reply),
            async move {
                let mut shown = vec![first.await.unwrap().unwrap()];
                // The store knows no identity of these words yet.
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.clone().into(),
                        })
                        .await,
                );
                ex.rpc().rpc().answer("identity.keyOwner", owner);
                shown.push(
                    window
                        .step(StepInput::TwelveWords {
                            words: phrase.into(),
                        })
                        .await,
                );
                // The window closes on the device list.
                shown
            }
        );
        assert!(matches!(
            &screens[0],
            Screen::EnterWords {
                purpose: "restore",
                ..
            }
        ));
        assert!(
            matches!(&screens[1], Screen::EnterWords { error: Some(m), .. } if m == NOT_THESE_WORDS),
            "{:?}",
            screens[1]
        );
        let Screen::RestoreDevices {
            did: shown_did,
            devices,
            note,
        } = &screens[2]
        else {
            panic!("{:?}", screens[2]);
        };
        assert_eq!(shown_did, &did);
        // No record to name them: listed by key, every one ticked, and the screen says why.
        let ids: Vec<(&str, bool)> = devices
            .iter()
            .map(|d| (d.key_id.as_str(), d.lock_out))
            .collect();
        assert_eq!(ids, [("d1", true), ("d2", true)]);
        assert!(note.is_some());
        // Closed before finishing: nothing published, nothing kept.
        assert_eq!(executor.rpc().rpc().publishes.get(), 0);
        assert!(!vault.holds(&events[0].scid).unwrap());
        shows_no_word(&screens, &phrase_of(41), &[]);
    }

    #[tokio::test]
    async fn a_computer_that_speaks_for_an_identity_restores_nothing() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let executor = executor_of(&events);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        drop(window);
        restore_on(&executor, &vault, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(matches!(&screen, Screen::Failed { .. }), "{screen:?}");
        assert!(executor.rpc().rpc().called("identity.keyOwner").is_empty());
    }

    #[tokio::test]
    async fn the_only_copy_of_the_master_key_is_never_removed() {
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        keep_master(&vault, &scid, 0);
        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            remove_master_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                shown.push(window.step(StepInput::Remove).await);
                shown
            }
        );
        assert!(matches!(&screens[0], Screen::RemoveMaster { error: None }));
        // No record lists another copy: refused, with the reason, and the key stays.
        assert!(
            matches!(&screens[1], Screen::Failed { message } if message == ONLY_COPY),
            "{:?}",
            screens[1]
        );
        assert!(vault.holds(&scid).unwrap());

        // A computer that keeps none has nothing to remove.
        let empty = memory_vault(crate::store::StoreKind::Keychain);
        let (address, mut rx, mut reply, window, first) = opened();
        drop(window);
        remove_master_on(&executor, &empty, &address, &mut rx, &mut reply).await;
        let screen = first.await.unwrap().unwrap();
        assert!(matches!(&screen, Screen::Failed { .. }), "{screen:?}");
    }

    /// The logout through the window's remove step, with another device (`d2`) holding the current
    /// master #0. The kept key goes; a stage at or behind the log goes with it (a refresh would
    /// bring the removed key back); a stage ahead of the log is another app's rotation in flight
    /// and stays. One rule, the client's: the service removes nothing after it.
    #[tokio::test]
    async fn a_logout_takes_the_kept_key_and_a_stage_up_to_the_log_but_not_one_ahead() {
        // (staged index, staged index left after the logout)
        for (staged, left) in [(None, None), (Some(0), None), (Some(1), Some(1))] {
            let (events, _) = crate::keylog::tests::log_with_d2(true);
            let scid = events[0].scid.clone();
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let mut record = ad4m_identity_core::record::PrivateRecord::default();
            let here = vault.vault_id(&scid).unwrap();
            record
                .devices
                .insert("d1".into(), this_computer(None, true, Some((0, here))));
            // Another vault's copy: a holding names its vault, or it proves none.
            let mut d2 = named("Phone");
            d2.holds_master = Holds::Yes;
            d2.master_index = Some(0);
            d2.vault = Some(VaultId([2; 16]));
            record.devices.insert("d2".into(), d2);
            let (executor, did) = executor_with(&events, &record);
            executor.rpc().keep_puts(&events);
            keep_master(&vault, &scid, 0);
            if let Some(index) = staged {
                let seed = words::seed(&words::from_entropy(&[41u8; 16]));
                let key = words::master_key(&seed, index).unwrap();
                Vault::stage_master(
                    &vault.unlocking(None),
                    &scid,
                    index,
                    Secret::new(key.to_bytes()),
                    &ad4m_identity_client::StageToken([0xe; 16]),
                )
                .unwrap();
            }
            let (address, mut rx, mut reply, window, first) = opened();
            let ((), screens) = tokio::join!(
                remove_master_on(&executor, &vault, &address, &mut rx, &mut reply),
                async {
                    let mut shown = vec![first.await.unwrap().unwrap()];
                    shown.push(window.step(StepInput::Remove).await);
                    shown
                }
            );
            assert!(matches!(&screens[0], Screen::RemoveMaster { error: None }));
            assert!(
                matches!(&screens[1], Screen::MasterRemoved),
                "staged {staged:?}: {:?}",
                screens[1]
            );
            // The write before the forget, then the holder mark from what the vault keeps after
            // it (ad4m's `remove_master`): both say this computer holds no master key.
            assert_eq!(executor.rpc().called("identity.recordPut").len(), 2);
            let opened = record::read(&executor, &vault.unlocking(None), &did)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(opened.version, 3);
            assert_eq!(opened.record.devices["d1"].holds_master, Holds::No);
            assert_eq!(opened.record.devices["d1"].master_index, None);
            assert!(!vault.holds(&scid).unwrap(), "staged {staged:?}");
            assert_eq!(vault.master_index(&scid).unwrap(), None);
            assert_eq!(
                vault.staged_index(&scid).unwrap(),
                left,
                "staged {staged:?}"
            );
        }
    }

    /// The log of `log_with_d2`, rotated once to master #1 elsewhere.
    fn rotated_log() -> Vec<Event> {
        let (mut events, _) = crate::keylog::tests::log_with_d2(true);
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let chain = ad4m_identity_core::fold(&events).unwrap();
        let m1 = words::master_key(&seed, 1).unwrap();
        let salt = bs58::encode(words::salt(&seed, 1)).into_string();
        let (next, _) = words::next_commitment(&seed, 2).unwrap();
        events
            .push(ad4m_identity_core::build::rotate(&chain, &m1, &salt, Some(next), &[]).unwrap());
        ad4m_identity_core::fold(&events).unwrap();
        events
    }

    /// `at_1` (the log of `rotated_log`) rotated once more, to master #2.
    fn rotated_again(at_1: &[Event]) -> Vec<Event> {
        let mut events = at_1.to_vec();
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let chain = ad4m_identity_core::fold(&events).unwrap();
        let m2 = words::master_key(&seed, 2).unwrap();
        let salt = bs58::encode(words::salt(&seed, 2)).into_string();
        let (next, _) = words::next_commitment(&seed, 3).unwrap();
        events
            .push(ad4m_identity_core::build::rotate(&chain, &m2, &salt, Some(next), &[]).unwrap());
        assert_eq!(
            ad4m_identity_core::fold(&events)
                .unwrap()
                .state()
                .masters
                .len(),
            3
        );
        events
    }

    /// Lal's review case (we#431). This computer keeps master #0; another app here, rebuilding
    /// from the words, staged #2 and its publish is on its way; the log is at #1. A refresh
    /// leaves #2 (ahead of the log), forgets #0 (behind it) and asks for the current key — and
    /// the forget must not take the stage with it. The publish of #2 then lands, the rotating
    /// flow is cut off before its promote, and the next refresh promotes #2.
    async fn a_stage_ahead_of_the_log_outlives_forgetting_the_kept_key(
        vault: &DesktopVault,
        passphrase: Option<&str>,
    ) {
        let at_1 = rotated_log();
        let at_2 = rotated_again(&at_1);
        let scid = at_1[0].scid.clone();
        let did = did_of(&scid);
        let executor = executor_of(&at_1);
        executor
            .rpc()
            .rpc()
            .answer("identity.postRequest", json!({ "id": "r9" }));
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let key = |index| Secret::new(words::master_key(&seed, index).unwrap().to_bytes());
        let flow = vault.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
        flow.store_master(&scid, 0, key(0)).unwrap();
        flow.stage_master(
            &scid,
            2,
            key(2),
            &ad4m_identity_client::StageToken([0xd; 16]),
        )
        .unwrap();

        let refreshed = refresh_master(&executor, &vault.unlocking(None), &did, &CLOCK, &RANDOM)
            .await
            .unwrap();
        assert!(matches!(refreshed, Refreshed::Asked(_)), "{refreshed:?}");
        assert_eq!(executor.rpc().rpc().called("identity.postRequest").len(), 1);
        assert_eq!(vault.master_index(&scid).unwrap(), None);
        assert_eq!(vault.staged_index(&scid).unwrap(), Some(2));

        // The publish of #2 lands; the flow that staged it never promotes.
        serve_log(&executor, &at_2);
        let refreshed = refresh_master(&executor, &vault.unlocking(None), &did, &CLOCK, &RANDOM)
            .await
            .unwrap();
        assert!(
            matches!(refreshed, Refreshed::Promoted { index: 2, .. }),
            "{refreshed:?}"
        );
        assert_eq!(vault.staged_index(&scid).unwrap(), None);
        assert_eq!(vault.master_index(&scid).unwrap(), Some(2));
        let unlocked = flow
            .unlock(&scid, ad4m_identity_client::MasterUse::Link, 0)
            .unwrap();
        assert_eq!(
            Signer::key(unlocked.signer(0).unwrap()),
            Signer::key(&KeySigner::new(key(2).expose(), 2))
        );
    }

    #[tokio::test]
    async fn a_refresh_keeps_a_stage_ahead_of_the_log_in_a_sealed_file() {
        let dir = tempfile::tempdir().unwrap();
        a_stage_ahead_of_the_log_outlives_forgetting_the_kept_key(
            &open_vault(dir.path()),
            Some(PASSPHRASE),
        )
        .await;
    }

    /// A take or promote here kept the current master and its record mark did not land: this
    /// computer's custody note owes it. `refresh_stale` never refreshes a current key on its
    /// own, so the note is what hands it to `refresh_master` ([`Refreshed::Repaired`] makes the
    /// mark from it). A release owes nothing, and no note owes nothing: neither reads past the
    /// log.
    #[tokio::test]
    async fn an_owed_custody_note_is_refreshed_though_the_kept_key_is_current() {
        use ad4m_identity_client::{CustodyNote, NoteToken};
        let events = rotated_log();
        let scid = events[0].scid.clone();
        let did = did_of(&scid);
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let key = |index| Secret::new(words::master_key(&seed, index).unwrap().to_bytes());
        for (note, logs_read) in [(None, 1), (Some(false), 1), (Some(true), 2)] {
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let executor = executor_of(&events);
            let flow = vault.unlocking(None);
            flow.store_master(&scid, 1, key(1)).unwrap();
            let epoch = flow.custody_epoch(&scid).unwrap();
            let note = note.map(|owed| match owed {
                true => CustodyNote::MarkOwed {
                    index: 1,
                    epoch,
                    token: NoteToken([7; 16]),
                    acquired: true,
                    restores: None,
                },
                false => CustodyNote::Released {
                    epoch,
                    token: NoteToken([7; 16]),
                    restores: None,
                },
            });
            if let Some(note) = &note {
                assert!(flow
                    .swap_custody_note(&scid, "d1", None, Some(note))
                    .unwrap());
            }
            refresh_stale(&executor, &vault, &did, Some("d1"), false).await;
            assert_eq!(
                executor.rpc().rpc().called("identity.log").len(),
                logs_read,
                "{note:?}"
            );
            assert_eq!(vault.master_index(&scid).unwrap(), Some(1), "{note:?}");
        }
    }

    /// A take kept master #1 in a sealed file and its record write did not land (the passphrase
    /// was not given, or the put failed), and the app started again: the custody note owes the
    /// mark, no message waits, the record's recovery key waits for m1's re-attestation, and the
    /// refresh as the app starts cannot open a sealed item. "Take the
    /// master key" is offered, asks for the passphrase (again on a wrong one) and makes the mark.
    #[tokio::test]
    async fn an_owed_mark_on_a_sealed_item_is_made_by_take_with_the_passphrase() {
        use ad4m_identity_client::{CustodyNote, NoteToken};
        let dir = tempfile::tempdir().unwrap();
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let master = |index| words::master_key(&seed, index).unwrap().to_bytes();
        // The record as it was before the rotation to #1: its recovery key attested by m0.
        let (at_0, _) = crate::keylog::tests::log_with_d2(true);
        let events = rotated_log();
        let scid = events[0].scid.clone();
        let mut record = ad4m_identity_core::record::PrivateRecord::default();
        record
            .devices
            .insert("d1".into(), this_computer(None, false, None));
        let (executor, did) = executor_with(&events, &record);
        let chain_0 = ad4m_identity_core::fold(&at_0).unwrap();
        let recovery = ad4m_identity_core::record::attest_recovery_key(
            &chain_0,
            ad4m_identity_core::encode_x25519_multikey(&[9u8; 32]),
            &KeySigner::new(&master(0), 0),
        )
        .unwrap();
        let stale = ad4m_identity_core::record::seal_record(
            &chain_0,
            1,
            &record,
            Some(recovery),
            &KeySigner::new(&[2u8; 32], 0),
            &mut Fixed(7),
        )
        .unwrap();
        let receipt = ad4m_identity_core::record::sign_receipt(
            &scid,
            &stale,
            chain_0.head().seq,
            &store_key(),
        )
        .unwrap();
        executor.rpc().answer(
            "identity.record",
            json!({ "record": stale, "receipt": receipt }),
        );
        executor.rpc().keep_puts(&events);
        executor.rpc().answer("identity.inbox", json!([]));
        executor.rpc().answer("identity.requests", json!([]));

        // A take kept #1 here, sealed; its mark is owed.
        let vault = open_vault(dir.path());
        let flow = vault.unlocking(pass());
        flow.store_master(&scid, 1, Secret::new(master(1))).unwrap();
        let epoch = flow.custody_epoch(&scid).unwrap();
        let owed = CustodyNote::MarkOwed {
            index: 1,
            epoch,
            token: NoteToken([7; 16]),
            acquired: true,
            restores: None,
        };
        assert!(flow
            .swap_custody_note(&scid, "d1", None, Some(&owed))
            .unwrap());
        drop(flow);

        // The app starts again: nothing waits in the inbox, and the mark is offered.
        let vault = open_vault(dir.path());
        let public = public_state_on(Some(&executor), &vault).await;
        // The device key alone cannot write it (the recovery key waits for m1), and the
        // refresh as the app starts cannot open a sealed item.
        assert!(public.master_waiting, "the owed mark is offered");
        assert!(receipt_owed(&vault, &scid, Some("d1")));

        let (address, mut rx, mut reply, window, first) = opened();
        let ((), screens) = tokio::join!(
            take_master_on(&executor, &vault, &address, &mut rx, &mut reply),
            async {
                let mut shown = vec![first.await.unwrap().unwrap()];
                if !matches!(shown[0], Screen::EnterPassphrase { error: None }) {
                    return shown;
                }
                for passphrase in ["not the passphrase at all", PASSPHRASE] {
                    // Any other screen ends the step, and a step sent after it would wait forever.
                    if !matches!(shown.last(), Some(Screen::EnterPassphrase { .. })) {
                        break;
                    }
                    shown.push(
                        window
                            .step(StepInput::Passphrase {
                                passphrase: passphrase.into(),
                                confirm: None,
                            })
                            .await,
                    );
                }
                shown
            }
        );
        assert!(
            matches!(screens[0], Screen::EnterPassphrase { error: None }),
            "{screens:?}"
        );
        assert!(
            matches!(screens[1], Screen::EnterPassphrase { error: Some(_) }),
            "{screens:?}"
        );
        assert!(
            matches!(&screens[2], Screen::MasterTaken { did: d, note: None } if *d == did),
            "{screens:?}"
        );

        let opened = record::read(&executor, &vault.unlocking(None), &did)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(opened.record.devices["d1"].holds_master, Holds::Yes);
        assert_eq!(opened.record.devices["d1"].master_index, Some(1));
        assert_eq!(opened.recovery.unwrap().attestation.key_id, "m1");
        assert_eq!(
            opened.record.devices["d1"].vault,
            Some(vault.vault_id(&scid).unwrap())
        );
        let public = public_state_on(Some(&executor), &vault).await;
        assert!(!public.master_waiting, "nothing is owed now");
    }

    #[tokio::test]
    async fn a_refresh_keeps_a_stage_ahead_of_the_log_in_the_keychain() {
        a_stage_ahead_of_the_log_outlives_forgetting_the_kept_key(
            &memory_vault(crate::store::StoreKind::Keychain),
            None,
        )
        .await;
    }

    #[tokio::test]
    async fn a_master_key_a_rotation_replaced_is_forgotten_and_the_current_one_asked_for() {
        let events = rotated_log();
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        executor
            .rpc()
            .rpc()
            .answer("identity.postRequest", json!({ "id": "r9" }));
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        keep_master(&vault, &scid, 0);
        let public = public_state_on(Some(&executor), &vault).await;
        // Master #0 no longer signs: it is gone, and a holder is asked for #1.
        assert!(!vault.holds(&scid).unwrap());
        assert_eq!(public.holds_master, None);
        assert_eq!(executor.rpc().rpc().called("identity.postRequest").len(), 1);
    }

    #[tokio::test]
    async fn a_current_master_key_is_kept_and_reported_with_its_index() {
        let events = rotated_log();
        let scid = events[0].scid.clone();
        let executor = executor_of(&events);
        let vault = memory_vault(crate::store::StoreKind::Keychain);
        keep_master(&vault, &scid, 1);
        let public = public_state_on(Some(&executor), &vault).await;
        assert_eq!(public.holds_master, Some(HoldsMaster { index: Some(1) }));
        assert!(executor
            .rpc()
            .rpc()
            .called("identity.postRequest")
            .is_empty());
        // A log read behind the kept key never makes this computer forget it.
        let (behind, _) = crate::keylog::tests::log_with_d2(true);
        let executor = executor_of(&behind);
        public_state_on(Some(&executor), &vault).await;
        assert_eq!(vault.master_index(&scid).unwrap(), Some(1));
    }

    /// This computer, `d2` of `log_with_d2_enc`, keeping master #0, its log listing `listed` for it
    /// (its own custody enc key when `None`), and the store serving a record in which `d1` holds
    /// master #0, sealed to the log's readers with a `"recovery"` entry or without one.
    fn holder_with_record(
        vault: &DesktopVault,
        listed: Option<String>,
        recovery_entry: bool,
    ) -> (Adapted, String) {
        let (executor, scid) = joined_executor(vault, listed.clone());
        let enc = listed.unwrap_or_else(|| {
            use ad4m_identity_client::EncKey;
            let d2 = Signer::key(&KeySigner::new(&[4u8; 32], 0));
            CustodyEncKey::for_device(vault.shared_store(), d2.as_str())
                .unwrap()
                .enc()
                .as_str()
                .to_string()
        });
        let (events, _) = crate::keylog::tests::log_with_d2_enc(true, enc);
        let chain = ad4m_identity_core::fold(&events).unwrap();
        let mut record = ad4m_identity_core::record::PrivateRecord::default();
        let mut d1 = named("Laptop");
        d1.holds_master = Holds::Yes;
        d1.master_index = Some(0);
        record.devices.insert("d1".into(), d1);
        record.devices.insert(
            "d2".into(),
            this_computer(None, true, Some((0, VaultId([1; 16])))),
        );
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let recovery = recovery_entry.then(|| {
            let key = ad4m_identity_core::x25519_multikey_of(&words::recovery_secret(&seed));
            let master = words::master_key(&seed, 0).unwrap();
            ad4m_identity_core::record::attest_recovery_key(&chain, key, &master).unwrap()
        });
        let d1_signer = KeySigner::new(&[2u8; 32], 0);
        let sealed = ad4m_identity_core::record::seal_record(
            &chain,
            1,
            &record,
            recovery,
            &d1_signer,
            &mut Fixed(7),
        )
        .unwrap();
        let receipt = ad4m_identity_core::record::sign_receipt(
            &scid,
            &sealed,
            chain.head().seq,
            &store_key(),
        )
        .unwrap();
        let fake = executor.rpc().rpc();
        fake.answer(
            "identity.record",
            json!({ "record": sealed, "receipt": receipt }),
        );
        fake.answer("identity.recordPut", json!({ "version": 2 }));
        // The rotation the words make, which the log serves once it is published.
        let mut rotated = events.clone();
        let m1 = words::master_key(&seed, 1).unwrap();
        let salt = bs58::encode(words::salt(&seed, 1)).into_string();
        let (next, _) = words::next_commitment(&seed, 2).unwrap();
        rotated
            .push(ad4m_identity_core::build::rotate(&chain, &m1, &salt, Some(next), &[]).unwrap());
        fake.answer_after("identity.publish", "identity.log", log_answer(&rotated));
        keep_master(vault, &scid, 0);
        (executor, scid)
    }

    /// "Replace master key" on a computer whose log lists an enc key it lost: the words sign the
    /// rotation and this computer keeps the new key. With no `"recovery"` entry in the record, ad4m's
    /// hand-over cannot open it, stops there and pushes to no one, and the screen says so — not that
    /// the device list catches up. The same record with this computer's own key listed opens, `d1` is
    /// pushed the key, and the note is the usual one; so is a lost key with a `"recovery"` entry,
    /// which the words open.
    #[tokio::test]
    async fn replacing_the_master_key_with_a_lost_enc_key_says_no_other_device_was_sent_it() {
        let lost = || Some(ad4m_identity_core::encode_x25519_multikey(&[5u8; 32]));
        for (listed, recovery_entry, stopped) in [
            (lost(), false, true),
            (None, false, false),
            (lost(), true, false),
        ] {
            let case = format!("lost {} recovery {recovery_entry}", listed.is_some());
            let vault = memory_vault(crate::store::StoreKind::Keychain);
            let (executor, scid) = holder_with_record(&vault, listed, recovery_entry);
            let (address, mut rx, mut reply, window, first) = opened();
            let ((), screens) = tokio::join!(
                replace_master_on(&executor, &vault, &address, &mut rx, &mut reply),
                async {
                    let mut shown = vec![first.await.unwrap().unwrap()];
                    shown.push(
                        window
                            .step(StepInput::TwelveWords {
                                words: phrase_of(41).into(),
                            })
                            .await,
                    );
                    shown
                }
            );
            let Screen::MasterReplaced { index: 1, note, .. } = &screens[1] else {
                panic!("{case}: {:?}", screens[1]);
            };
            let note = note.as_deref().unwrap_or_default();
            assert_eq!(note.contains(NOT_HANDED_OVER), stopped, "{case}: {note}");
            assert_eq!(
                note.contains("after its next change"),
                !stopped,
                "{case}: {note}"
            );
            // Stopped at the record, the hand-over pushed to no one; else `d1` was sent the key.
            let pushed = executor.rpc().rpc().called("identity.inboxPut").len();
            assert_eq!(pushed == 0, stopped, "{case}");
            assert_eq!(vault.master_index(&scid).unwrap(), Some(1), "{case}");
        }
    }
}
