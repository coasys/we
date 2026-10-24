//! `we-custody`: the desktop app's master-key custody.
//!
//! - [`vault::DesktopVault`] keeps master keys in this computer's store ([`store`]): the macOS
//!   keychain behind Touch ID, or on Linux sealed under a passphrase ([`seal`]) in the Secret
//!   Service, or in a 0600 file where there is none.
//! - [`service`] runs the identity client's flows — create, add a device, revoke — for the identity
//!   window, and reaches the executor only over its RPC with the admin credential.
//! - [`window`] says which window may call which command.
//!
//! No Windows: the desktop app does not ship there. Nothing here links the executor;
//! `tests/boundary.rs` keeps it so.

pub mod seal;
pub mod service;
pub mod store;
pub mod vault;
pub mod window;

pub use service::{
    spawn, CustodyError, CustodyHandle, CustodyPublic, ExecutorAddress, IdentityStep, Screen,
    StepInput, StepOutcome,
};
pub use vault::DesktopVault;
