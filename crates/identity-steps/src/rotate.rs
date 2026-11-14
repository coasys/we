//! Replace the master key with the next one the 12 words make. Any device of the identity may:
//! the words, not a kept key, sign the rotation, and the device keeps the new key. The other
//! apps that kept the old key are sent the new one; a push that fails stays on the retry list.

use ad4m_identity_client::flows::rotate::{rotate, Rotated};
use ad4m_identity_client::{ClientError, Clock, ExecutorRpc, Random, Vault, ViaExecutor};
use ad4m_identity_core::words::Words;

use crate::epoch::{recover_lost_epoch, EpochRecovery};

/// Rotates `did`'s master key with `words`, revoking nothing, after recovering a lost custody
/// epoch with them ([`recover_lost_epoch`]). `vault` keeps the new key (the desktop passes its
/// unlocking, the phone its vault); `epochs` is the vault whose epoch is checked.
/// [`ClientError::NotTheseWords`] when the words are not the identity's: nothing changed, and
/// the surface asks again.
pub async fn rotate_with_words<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &dyn Vault,
    epochs: &dyn EpochRecovery,
    did: &str,
    words: &Words,
    clock: &dyn Clock,
    random: &dyn Random,
) -> Result<Rotated, ClientError> {
    recover_lost_epoch(executor, epochs, did, words).await?;
    rotate(executor, vault, did, words, &[], clock, random).await
}
