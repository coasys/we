//! `we-data`: the store map's runtime and the executor boundary.
//!
//! §6 of the plan: every read or write the store bag answers goes through
//! [`Executor`]. `we-ad4m` implements it over `ad4m-client`; [`FakeExecutor`]
//! answers from memory for tests and the offline stage. Nothing above
//! `we-ad4m` knows about WebSockets.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
//! `StoreMap::load` is the only filesystem helper and it is compiled out on
//! wasm — file reads live in tests and examples.
#![forbid(unsafe_code)]

mod executor;
mod fake;
mod natives;
mod provenance;
mod query_source;
mod storemap;

pub use executor::{
    ClassSel, ClassShape, Executor, ExecutorError, FlowCall, LiveQuery, LiveQueryId, QueryIr,
    Result, SpaceId, Write, WriteOp,
};
pub use fake::FakeExecutor;
pub use natives::run_host_function;
pub use provenance::{Provenance, ProvenanceReport};
pub use query_source::SnapshotQuerySource;
pub use storemap::{MemberKind, MemberRow, StoreMap};
pub use we_template::StoreBag;
