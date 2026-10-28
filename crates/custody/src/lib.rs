//! `we-custody`: the desktop app's master-key custody.
//!
//! - [`vault::DesktopVault`] keeps master keys in this computer's store ([`store`]): the macOS
//!   keychain behind Touch ID, or sealed under a passphrase ([`seal`]) in the Linux Secret
//!   Service, or in a 0600 file — on Linux where there is no Secret Service, and on macOS where
//!   the build lacks the keychain entitlement.
//! - [`pending`] keeps the incept of an identity made here until its publish is confirmed, so a
//!   create the app did not see finish is completed on the next start rather than stranded.
//! - [`service`] runs the identity client's flows — create, add a device, revoke — for the identity
//!   window, and reaches the executor only over its RPC with the admin credential.
//! - [`window`] says which Tauri window may call which command.
//! - [`host`] is what every desktop host starts the service with: the custody folder and the
//!   identity store settings.
//! - [`sidecar`] serves the service over stdin and stdout, as the `we-custody` binary, for the
//!   Electron app.
//!
//! No Windows: the desktop app does not ship there. Nothing here links the executor;
//! `tests/boundary.rs` keeps it so.

pub mod host;
pub mod pending;
pub mod seal;
pub mod service;
pub mod sidecar;
pub mod store;
pub mod vault;
pub mod window;

pub use pending::PendingIncepts;
pub use service::{
    spawn, CustodyError, CustodyHandle, CustodyPublic, ExecutorAddress, IdentityStep, Screen,
    StepInput, StepOutcome,
};
pub use vault::DesktopVault;
