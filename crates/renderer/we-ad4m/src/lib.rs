//! `we-ad4m`: the renderer against a live AD4M executor, over `ad4m-client`.
//! Nothing above this crate knows about WebSockets.
//!
//! - [`Ad4mQuerySource`] answers the template's `$queries`:
//!   `perspective.modelSubscribe` pushes into the session inbox, so a record
//!   created anywhere reaches the resolved tree without polling.
//! - [`Ad4mExecutor`] is [`we_data::Executor`] over the same socket —
//!   read-only (writes are E11).
//! - [`connect::ConnectFlow`] runs `ad4m-connect` for the connect screen;
//!   [`list_spaces`] lists what the picker offers.
//! - [`live::LiveMembers`] serves the store map's `modelRead` rows (M2)
//!   from executor reads; members without a row stay on the snapshot.
//! - [`translate`] lowers a compiled `$query` to `modelQuery`'s options, as
//!   the TS adapter does.
//!
//! Native only: on wasm32 the crate is empty (the connected web build is
//! E10), so the workspace's wasm check never compiles tokio.
#![forbid(unsafe_code)]

#[cfg(not(target_arch = "wasm32"))]
pub mod connect;
#[cfg(not(target_arch = "wasm32"))]
mod connection;
#[cfg(not(target_arch = "wasm32"))]
mod executor;
#[cfg(not(target_arch = "wasm32"))]
pub mod live;
#[cfg(not(target_arch = "wasm32"))]
pub mod relations;
#[cfg(not(target_arch = "wasm32"))]
mod source;
#[cfg(not(target_arch = "wasm32"))]
mod spaces;
#[cfg(all(not(target_arch = "wasm32"), feature = "testkit"))]
pub mod testkit;
#[cfg(not(target_arch = "wasm32"))]
pub mod translate;

#[cfg(not(target_arch = "wasm32"))]
pub use connection::{Connection, Runtime};
#[cfg(not(target_arch = "wasm32"))]
pub use executor::Ad4mExecutor;
#[cfg(not(target_arch = "wasm32"))]
pub use relations::Relations;
#[cfg(not(target_arch = "wasm32"))]
pub use source::{Ad4mQuerySource, SourceStats, SpaceBinding};
#[cfg(not(target_arch = "wasm32"))]
pub use spaces::{list_spaces, SpaceRow};
