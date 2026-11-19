//! The identity this computer's executor speaks for, as its public facts:
//! the read behind the base screen's first run (slice 5).
//!
//! Two calls the pinned executor (ad4m 0.13.1-staging.12 and later) serves
//! under the agent-read capability: `identity.status` (the DID, `null`
//! for an agent with no identity yet, and the identity store with whether
//! the executor trusts a key for it) and `identity.devices` (the device
//! keys from the identity's key log). The supervisor makes them with the
//! operator's credential, as the custody service does for the same facts.
//!
//! What is kept is less than what is answered: no device key, enc key,
//! key id, sign key or log head. A device is only whether it is this
//! computer's. An answer that is not the expected shape is an error, never
//! an empty identity.

/// The identity's public facts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Identity {
    /// `None`: the agent speaks for no identity yet.
    pub did: Option<String>,
    /// The executor has an identity store and trusts a key for it.
    pub store_trusted: bool,
    /// The devices in force (not revoked, not bots), from the key log.
    pub devices: Vec<KeyDevice>,
}

/// One device of the identity: only whether it is this computer's.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyDevice {
    pub this_device: bool,
}

/// [`Identity`] from the answers to `identity.status` and
/// `identity.devices`.
pub fn identity_from_answers(
    status: &serde_json::Value,
    devices: &serde_json::Value,
) -> Result<Identity, String> {
    let _ = (status, devices);
    Err("not read yet".into())
}
