//! `we-data`: the store map's runtime and the executor boundary.
//!
//! §6 of the plan: every read or write the store bag answers goes through
//! [`Executor`]. `we-ad4m` implements it over `ad4m-client`; [`FakeExecutor`]
//! answers from memory for tests and the offline stage. Nothing above
//! `we-ad4m` knows about WebSockets.
//!
//! E6 adds the offline stage itself: [`OfflineData::from_snapshot`] turns a
//! recorded snapshot — plus an optional [`StoreMap`] saying which members a
//! native answers — into the `Arc<StoreBag>` a `Session` resolves against and
//! the [`Provenance`] recording who served each member. The nine host
//! functions the Coasys bundle calls are registered on the bag
//! (`we_data::natives` is `pub` only so the conformance test can reach one
//! function by name — the real surface is the bag).
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
//! `StoreMap::load` is the only filesystem helper and it is compiled out on
//! wasm — file reads live in tests and examples.
//!
//! E18's agent chat is a second port, [`chat`], over the executor's AI
//! sessions. Those rows are not perspective records, so [`Executor`] does
//! not grow an AI-session method.
#![forbid(unsafe_code)]

pub mod chat;
mod executor;
mod fake;
mod natives;
mod offline;
mod provenance;
mod query_source;
mod route;
mod storemap;
pub mod writes;

pub use executor::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write, WriteOp,
};
pub use fake::FakeExecutor;
pub use natives::run_host_function;
pub use offline::OfflineData;
pub use provenance::{Provenance, ProvenanceReport};
pub use query_source::SnapshotQuerySource;
pub use route::{RouteCaptures, RouteQuerySource};
pub use storemap::{MemberKind, MemberRow, StoreMap};
pub use we_template::StoreBag;
