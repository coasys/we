//! The holder's side of a link on the phone: the person scanned another device's
//! `coasys:device:1:` code, the phone puts a ticket for it in the device's pre-join inbox, waits
//! for the device's claim, shows the match code, and on the person's confirm adds the device to
//! the log (and sends it the master key when they chose to).
//!
//! `LinkFlow` borrows its executor and vault for the whole link, and the wait for a claim is a
//! long poll, so a link runs on a thread of its own with its own executor; the app talks to it
//! through [`HolderLink`]: [`HolderLink::next`] blocks until the next step, [`HolderLink::confirm`]
//! answers the match, [`HolderLink::cancel`] stops it at its next request to the store.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use ad4m_identity_client::flows::link::LinkFlow;
use ad4m_identity_client::{Clock, MasterUse, OsRandom, SystemClock};
use ad4m_identity_core::link::{DeviceString, OfferKind};
use ad4m_identity_core::record::{DeviceEntry, DeviceKind, HoldsMaster, Place};
use futures_executor::block_on;

use crate::identity::{phone_error, Parts};
use crate::vault::PhoneVault;
use crate::PhoneKeyError;

/// Where a holder's link is.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum LinkStep {
    /// The ticket is in the device's inbox; the device claims it until `expires`.
    TicketSent { expires: u64 },
    /// The device claimed: the person compares `code` with the one the device shows.
    /// `can_keep_master`: the card offers "Keep my master key on this device too".
    Claimed {
        code: String,
        hint: Option<String>,
        can_keep_master: bool,
    },
    /// The device is in the log as `key_id`, added at `seq`.
    Linked {
        key_id: String,
        seq: u64,
        master_sent: bool,
        /// A step after the add that did not pass (the master key's push, the record write),
        /// which the add stands without.
        note: Option<String>,
    },
}

enum Command {
    Confirm {
        name: Option<String>,
        keep_master: bool,
    },
}

/// One link the phone runs as the holder.
#[derive(uniffi::Object)]
pub struct HolderLink {
    steps: Mutex<Receiver<Result<LinkStep, PhoneKeyError>>>,
    commands: Mutex<Option<Sender<Command>>>,
    cancelled: Arc<AtomicBool>,
    /// Set when the link's thread ends — linked, expired, errored, cancelled, or unwound —
    /// so the app can drop the handle whether or not a `next` is ever polled again.
    ended: Arc<AtomicBool>,
}

/// Sets the flag when the link's thread exits, whatever way it went.
struct SetOnDrop(Arc<AtomicBool>);

impl Drop for SetOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

impl HolderLink {
    /// Checks the code against the clock and the store, then starts the link's thread.
    pub(crate) fn start(
        parts: Parts,
        vault: Arc<PhoneVault>,
        did: String,
        device: DeviceString,
    ) -> Result<Arc<HolderLink>, PhoneKeyError> {
        let store_url = parts.store_url();
        if SystemClock.now() >= device.exp {
            return Err(PhoneKeyError::Ended {
                reason: "that code has expired; show a new one on the new device".into(),
            });
        }
        if device.store.trim_end_matches('/') != store_url {
            return Err(PhoneKeyError::Refused {
                reason: format!(
                    "that device uses another identity store ({}); both devices must use the same one",
                    device.store
                ),
            });
        }
        let (step_tx, step_rx) = channel();
        let (command_tx, command_rx) = channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let ended = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        let terminal = ended.clone();
        std::thread::Builder::new()
            .name("phone-holder-link".into())
            .spawn(move || {
                // `ended` on every way out — the link finished, an error, an unwind.
                let _ended = SetOnDrop(terminal);
                let result = run(
                    &parts,
                    &vault,
                    &did,
                    &device,
                    &store_url,
                    &flag,
                    &step_tx,
                    &command_rx,
                );
                if let Err(e) = result {
                    let _ = step_tx.send(Err(e));
                }
            })
            .map_err(|e| PhoneKeyError::Io {
                reason: format!("the link's thread did not start: {e}"),
            })?;
        Ok(Arc::new(HolderLink {
            steps: Mutex::new(step_rx),
            commands: Mutex::new(Some(command_tx)),
            cancelled,
            ended,
        }))
    }
}

/// The person's answer to a claimed link, waited for until `deadline` (unix seconds): the
/// flow's unlock — and the decrypted master key it holds. When the deadline passes the link
/// ends here and the flow drops with it; the page cannot leave it open forever.
fn await_command(
    commands: &Receiver<Command>,
    deadline: u64,
    now: u64,
) -> Result<Command, PhoneKeyError> {
    use std::sync::mpsc::RecvTimeoutError;
    match commands.recv_timeout(std::time::Duration::from_secs(deadline.saturating_sub(now))) {
        Ok(command) => Ok(command),
        Err(RecvTimeoutError::Timeout) => Err(PhoneKeyError::Ended {
            reason: "the time to confirm the link ran out".into(),
        }),
        Err(RecvTimeoutError::Disconnected) => Err(PhoneKeyError::Cancelled),
    }
}

#[allow(clippy::too_many_arguments)]
fn run(
    parts: &Parts,
    vault: &PhoneVault,
    did: &str,
    device: &DeviceString,
    store_url: &str,
    cancelled: &Arc<AtomicBool>,
    steps: &Sender<Result<LinkStep, PhoneKeyError>>,
    commands: &Receiver<Command>,
) -> Result<(), PhoneKeyError> {
    let exec = parts.executor(Some(cancelled.clone()))?;
    let clock = SystemClock;
    let random = OsRandom;
    block_on(async {
        // The flow's unlock is made inside `scan` (at or after this `now`) and lasts
        // `MasterUse::Link`'s ttl — the offer's life plus the store's confirm grace. The
        // confirm's wait ends at the same time at the latest: waiting longer would keep the
        // decrypted master in memory past the unlock the person allowed.
        let unlocked_until = clock.now() + MasterUse::Link.ttl_s();
        let flow = LinkFlow::scan(
            &exec,
            vault,
            did,
            OfferKind::Device,
            device,
            store_url,
            &clock,
            &random,
        )
        .await
        .map_err(phone_error)?;
        let _ = steps.send(Ok(LinkStep::TicketSent {
            expires: device.exp,
        }));
        let claimed = flow.wait_for_claim().await.map_err(phone_error)?;
        let can_keep = flow.may_keep(&claimed);
        let _ = steps.send(Ok(LinkStep::Claimed {
            code: claimed.match_code.clone(),
            hint: claimed.hint.clone(),
            can_keep_master: can_keep,
        }));
        let Command::Confirm { name, keep_master } =
            await_command(commands, unlocked_until, clock.now())?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(PhoneKeyError::Cancelled);
        }
        let entry = DeviceEntry {
            name: name
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty())
                .or_else(|| claimed.hint.clone())
                .unwrap_or_else(|| "Another device".into()),
            kind: if can_keep {
                DeviceKind::DesktopApp
            } else {
                DeviceKind::Server
            },
            place: Some(if can_keep {
                Place::Computer
            } else {
                Place::Server
            }),
            address: None,
            runs_executor: true,
            holds_master: HoldsMaster::No,
            master_index: None,
            vault: None,
            operator: None,
        };
        let linked = flow
            .confirm(&claimed, entry, keep_master && can_keep)
            .await
            .map_err(phone_error)?;
        let mut notes = Vec::new();
        let master_sent = match linked.master {
            Some(Ok(_)) => true,
            Some(Err(e)) => {
                notes.push(format!(
                    "the master key was not sent yet ({e}); it is sent again later"
                ));
                false
            }
            None => false,
        };
        if let Err(e) = linked.record {
            notes.push(format!("the device list was not updated ({e})"));
        }
        let _ = steps.send(Ok(LinkStep::Linked {
            key_id: linked.key_id,
            seq: linked.head.seq,
            master_sent,
            note: (!notes.is_empty())
                .then(|| format!("The device was added, but {}.", notes.join(" and "))),
        }));
        Ok(())
    })
}

#[uniffi::export]
impl HolderLink {
    /// The link's next step; blocks until there is one. After `Linked`, or an error, the link is
    /// over and `next` answers `Ended`.
    pub fn next(&self) -> Result<LinkStep, PhoneKeyError> {
        let steps = self
            .steps
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        steps.recv().unwrap_or_else(|_| {
            Err(PhoneKeyError::Ended {
                reason: "the link is over".into(),
            })
        })
    }

    /// The person saw the same code on both devices: add it, named `name` (else its hint), and
    /// with `keep_master` send it the master key. The answer is the next `Linked`.
    pub fn confirm(&self, name: Option<String>, keep_master: bool) -> Result<(), PhoneKeyError> {
        let commands = self
            .commands
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        commands
            .as_ref()
            .and_then(|c| c.send(Command::Confirm { name, keep_master }).ok())
            .ok_or_else(|| PhoneKeyError::Ended {
                reason: "the link is over".into(),
            })
    }

    /// Stops the link: a wait for the claim ends at its next request, and a link waiting for the
    /// confirm ends now. The ticket expires with the device's code.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.commands
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }

    /// Whether the link's thread ended — expired, errored, cancelled or linked — so the app
    /// can drop its handle without a `next` ever being polled again.
    pub fn ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The confirm wait ends with the flow's unlock: past the deadline the link is `Ended` and
    /// the `LinkFlow` — the unlocked master it holds — is dropped with it, never kept until
    /// the page remembers it. A sender gone (`cancel`) is `Cancelled`, and a command in time
    /// passes.
    #[test]
    fn a_confirm_wait_ends_at_the_unlocks_deadline() {
        let (_tx, rx) = channel::<Command>();
        assert!(matches!(
            await_command(&rx, 100, 100),
            Err(PhoneKeyError::Ended { .. })
        ));
        // Even with the deadline far away, a wait with nothing coming ends by itself.
        let (_tx, rx) = channel::<Command>();
        assert!(matches!(
            await_command(&rx, u64::MAX, u64::MAX - 1),
            Err(PhoneKeyError::Ended { .. })
        ));

        let (tx, rx) = channel::<Command>();
        drop(tx);
        assert!(matches!(
            await_command(&rx, u64::MAX, 0),
            Err(PhoneKeyError::Cancelled)
        ));

        let (tx, rx) = channel();
        tx.send(Command::Confirm {
            name: Some("Laptop".into()),
            keep_master: false,
        })
        .unwrap();
        assert!(matches!(
            await_command(&rx, u64::MAX, 0),
            Ok(Command::Confirm {
                keep_master: false,
                ..
            })
        ));
    }
}
