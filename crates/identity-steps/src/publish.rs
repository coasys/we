//! Publishing an identity this device made and could not see published: one at a time, and never
//! again once the store has said it never will.
//!
//! A make keeps its incept in the vault before it publishes, so a publish the store did not answer
//! is finished later: at the next make, and at every read of the identity's state. Two things must
//! hold wherever that runs, and so they live here, once:
//!
//! - **One publish of an incept at a time.** A state read and a step can both find the incept
//!   pending; two publishes of it would make the store answer the second with a conflict. The
//!   caller that finds one running waits for it ([`PublishGate::finish`]), then finds nothing
//!   pending, or skips the publish ([`PublishGate::finish_quietly`]) when it is a read that must
//!   never wait on a step. Calls on the same [`PublishGate`] exclude each other; the gate belongs
//!   to the vault that holds the incept, so two vaults never wait on one another.
//! - **A refusal for good is not retried.** A publish a store refuses because the log can never be
//!   accepted (the key is in another log, the store holds a different one, the events are
//!   malformed) fails the same way each time, and a retry on every read would repeat the work
//!   that came before it, the new log's proof of work among it. The gate remembers the refusal
//!   for the incept ([`Refused`]) and answers it without asking the executor, until the incept is
//!   discarded ([`PublishGate::forget`]). A refusal trying again may fix (the store did not
//!   answer, a rate limit) is never remembered.
//!
//! The memory is the gate's, so it lasts as long as the vault does in the process: a new process
//! tries once more, and remembers what it is told.

use std::collections::HashMap;
use std::sync::Mutex;

use ad4m_identity_client::flows::create::{resume, Created};
use ad4m_identity_client::{ClientError, ExecutorRpc, Vault, ViaExecutor};
use ad4m_identity_core::{did_of, Event, Op};
use futures_util::lock::Mutex as AsyncMutex;

/// Why a store will never take a kept incept, in a sentence a person reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused {
    /// What the store said, and what it means for this identity.
    pub message: String,
    /// Whether this device's own key is the reason (it is already in a key log), in which case new
    /// words made with the same key would be refused the same way.
    pub key_taken: bool,
}

/// What a finish failed with.
#[derive(Debug)]
pub enum PublishError {
    /// The store refuses this incept for good. Trying again is pointless; discarding it is the
    /// way on.
    Refused(Refused),
    /// Anything else: trying again may work.
    Failed(ClientError),
}

impl PublishError {
    /// The refusal for good, when this is one.
    pub fn refused(&self) -> Option<&Refused> {
        match self {
            PublishError::Refused(refused) => Some(refused),
            PublishError::Failed(_) => None,
        }
    }
}

impl std::fmt::Display for PublishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PublishError::Refused(refused) => f.write_str(&refused.message),
            PublishError::Failed(e) => write!(f, "{e}"),
        }
    }
}

/// How a refused publish of a kept incept stands: `None` when trying again may work (the store or
/// the executor did not answer, a rate limit, a head signed by a key this build does not trust);
/// else why it never will, and whether this device's key is the reason.
pub fn refused_for_good(e: &ClientError, did: &str) -> Option<Refused> {
    match e {
        ClientError::Rpc(e) if e.code == 409 && e.message.starts_with("key-taken") => {
            Some(Refused {
                message: format!(
                    "The identity store refused {did}: this device's key is already in a key log, \
                     so publishing it again cannot work."
                ),
                key_taken: true,
            })
        }
        ClientError::Rpc(e) if e.code == 409 && e.message.starts_with("conflict") => {
            Some(Refused {
                message: format!(
                    "The identity store holds a different log for {did}, so publishing this one \
                     cannot work."
                ),
                key_taken: false,
            })
        }
        ClientError::Rpc(e) if e.code == 400 || e.code == 403 => Some(Refused {
            message: format!("The identity store refused {did}: {}", e.message),
            key_taken: false,
        }),
        ClientError::Fold(why) => Some(Refused {
            message: format!("The identity kept here for {did} does not check out ({why})."),
            key_taken: false,
        }),
        ClientError::Protocol(why) => Some(Refused {
            message: format!("{did} cannot be published: {why}"),
            key_taken: false,
        }),
        _ => None,
    }
}

/// The kept incept that lists `device_key`: an identity this device made and has not published.
/// The vault can be shared by other accounts on the device, and another's incept is theirs to
/// finish.
pub fn own_pending(vault: &dyn Vault, device_key: &str) -> Result<Option<Event>, ClientError> {
    Ok(vault.pending_incepts()?.into_iter().find(|incept| {
        matches!(&incept.op, Op::Incept { add, .. } if add.iter().any(|d| d.sign == device_key))
    }))
}

/// One vault's publishes of its kept incepts: one at a time, with what the store refused for good
/// remembered. See the module's docs.
#[derive(Default)]
pub struct PublishGate {
    /// Held across a publish. Waits without a runtime: it runs under any executor.
    one_at_a_time: AsyncMutex<()>,
    /// The refusal for good the store gave each incept (by its identifier).
    refused: Mutex<HashMap<String, Refused>>,
}

impl PublishGate {
    pub fn new() -> Self {
        Self::default()
    }

    /// Publishes the kept incept of this executor's device key. `None` when there is none, or when
    /// one published while this call waited for it. Asks the executor nothing when nothing is kept.
    ///
    /// An incept this device can never publish, because its key already speaks for another
    /// identity, is forgotten. An incept the store has refused for good answers [`Refused`] at
    /// once, with no publish, until [`forget`](Self::forget).
    pub async fn finish<R: ExecutorRpc>(
        &self,
        executor: &ViaExecutor<R>,
        vault: &dyn Vault,
    ) -> Result<Option<Created>, PublishError> {
        let _one = self.one_at_a_time.lock().await;
        self.finish_locked(executor, vault).await
    }

    /// [`finish`](Self::finish) for a read of the identity's state: skipped while a publish is
    /// running, so the read never waits on it, and its failure only logged.
    pub async fn finish_quietly<R: ExecutorRpc>(
        &self,
        executor: &ViaExecutor<R>,
        vault: &dyn Vault,
    ) {
        let Some(_one) = self.one_at_a_time.try_lock() else {
            return;
        };
        if let Err(e) = self.finish_locked(executor, vault).await {
            log::warn!("the pending identity is not finished yet: {e}");
        }
    }

    /// Forgets what the store said about `scid`: the incept is discarded, or is to be tried afresh.
    pub fn forget(&self, scid: &str) {
        self.refused
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(scid);
    }

    /// The refusal for good remembered for `scid`.
    pub fn refusal_of(&self, scid: &str) -> Option<Refused> {
        self.refused
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(scid)
            .cloned()
    }

    fn remember(&self, scid: &str, refused: &Refused) {
        self.refused
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(scid.to_string(), refused.clone());
    }

    async fn finish_locked<R: ExecutorRpc>(
        &self,
        executor: &ViaExecutor<R>,
        vault: &dyn Vault,
    ) -> Result<Option<Created>, PublishError> {
        let kept = vault
            .pending_incepts()
            .map_err(|e| PublishError::Failed(e.into()))?;
        if kept.is_empty() {
            return Ok(None);
        }
        // Remembered for an incept this executor's key lists only: another's is not this call's.
        let status = executor
            .status()
            .await
            .map_err(|e| PublishError::Failed(e.into()))?;
        let own = own_pending(vault, &status.device_key).map_err(PublishError::Failed)?;
        if let Some(incept) = &own {
            if let Some(refused) = self.refusal_of(&incept.scid) {
                return Err(PublishError::Refused(refused));
            }
        }
        log::info!("publishing an identity whose publish was not confirmed");
        match resume(executor, vault).await {
            Err(ClientError::HasIdentity(held)) => {
                if let Some(incept) = own {
                    log::warn!(
                        "this device speaks for {held}; forgetting the incept of {} it can never \
                         publish",
                        did_of(&incept.scid)
                    );
                    vault
                        .incept_published(&incept.scid)
                        .map_err(|e| PublishError::Failed(e.into()))?;
                }
                Ok(None)
            }
            Err(e) => {
                if let Some(incept) = &own {
                    if let Some(refused) = refused_for_good(&e, &did_of(&incept.scid)) {
                        self.remember(&incept.scid, &refused);
                        return Err(PublishError::Refused(refused));
                    }
                }
                Err(PublishError::Failed(e))
            }
            Ok(created) => Ok(created),
        }
    }
}
