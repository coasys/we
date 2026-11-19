//! The way back from a lost custody epoch: a device that lost its count of the changes to the
//! master key it keeps (a file of its custody folder gone) will not change or remove that key on
//! its own. The 12 words, once checked to make the identity's current master, start the count
//! again — taken by "Replace my master key" before it rotates, and by a restore before its
//! rotation stages and before each try at enrolling after it.

use ad4m_identity_client::{ClientError, ExecutorRpc, VaultError, ViaExecutor};
use ad4m_identity_core::words::{self, Words};

/// A vault's custody epochs, as far as the recovery needs them. Each surface's vault says which
/// of its errors is a lost epoch, and recovers one its own way (a fresh incarnation).
pub trait EpochRecovery {
    /// The custody epoch of `scid`'s kept key ([`ad4m_identity_client::Vault::custody_epoch`]).
    fn custody_epoch(&self, scid: &str) -> Result<u64, VaultError>;
    /// Starts `scid`'s count again, under a fresh incarnation; answers the new epoch.
    fn recover_custody_epoch(&self, scid: &str) -> Result<u64, VaultError>;
    /// Whether `error` says the epoch was written here and is gone.
    fn is_lost_epoch(&self, error: &VaultError) -> bool;
}

/// Recovers the custody epoch of `did`'s key here when, and only when, it is lost and `words`
/// make the identity's current master ([`words_make_current_master`]). Words that are not the
/// identity's recover nothing ([`ClientError::NotTheseWords`]); a rotation that follows moves the
/// recovered epoch as any change of the kept key does.
pub async fn recover_lost_epoch<R: ExecutorRpc>(
    executor: &ViaExecutor<R>,
    vault: &dyn EpochRecovery,
    did: &str,
    words: &Words,
) -> Result<(), ClientError> {
    let Some(scid) = ad4m_identity_core::scid_of(did) else {
        return Ok(());
    };
    match vault.custody_epoch(scid) {
        Ok(_) => return Ok(()),
        Err(e) if vault.is_lost_epoch(&e) => {}
        Err(e) => return Err(e.into()),
    }
    words_make_current_master(executor, did, words).await?;
    log::info!("identity: the words make the current master key; recover its custody epoch");
    vault.recover_custody_epoch(scid)?;
    Ok(())
}

/// Whether `words` make `did`'s current master key, as the key log the executor serves says it
/// (the rule of `ad4m_identity_client::flows::rotate`, whose `current_index` is not public):
/// master *n* of the words, *n* the current master's index, signs as the log's current master.
/// [`ClientError::NotTheseWords`] when they do not.
pub async fn words_make_current_master<R: ExecutorRpc>(
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
    let key = words::master_key(&words::seed(words), index)?;
    if ad4m_identity_core::build::Signer::key(&key) != current.sign {
        return Err(ClientError::NotTheseWords(
            "they do not derive the current master key".into(),
        ));
    }
    Ok(())
}
