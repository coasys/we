//! `we-template`: a WE app as data.
//!
//! Two halves, one on each side of the resolver:
//!
//! - **Authored** — [`Bundle`], [`BundleTemplate`], [`SchemaNode`],
//!   [`SchemaChild`], [`RouteNode`]: the serde types a bundle file parses into
//!   and serializes back out of without losing a field. Structure ops
//!   (`$if`, `$each`, …) and their arguments are kept as raw
//!   [`serde_json::Value`] inside `props` — the resolver, not the parser,
//!   knows what they mean.
//! - **Resolved** — [`ResolvedNode`], [`ResolvedChild`], [`NodeId`],
//!   [`HandlerRef`], [`Scope`], [`Transition`], [`normal_form`]: the tree a
//!   frame paints, plus [`Host`], [`Invoked`], [`CallId`] and
//!   [`HandlerToken`], the contract between the tree and the app it runs in.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
#![forbid(unsafe_code)]

mod bindings;
mod bundle;
mod handler;
mod handlers;
mod host;
mod inbox;
mod local;
mod node;
mod order;
mod query;
mod resolve;
mod resolved;
mod runtime;
mod scope;

pub use bindings::{DataRevision, Invalidator};
pub use bundle::{
    Bundle, BundleAuthor, BundleBrand, BundleDisplay, BundleRecordType, BundleTemplate,
    BundleTheme, DisplaySpaces, BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION,
};
pub use handler::{CallId, HandlerToken};
pub use handlers::{run as run_handler, HandlerCx, PendingCall, PendingMap};
pub use host::{Action, ActionRequest, CallBook, Completer, Host, Invoked, MountId, Origin};
pub use inbox::{Inbox, Waker};
pub use local::LocalState;
pub use node::{RouteNode, SchemaChild, SchemaNode};
pub use query::{
    compile_query, compile_request, compiled_to_cell, prune_where, query_descriptor,
    scope_anchored, CompileCx, Compiled, CompiledQuery, DatasetHandle, DatasetSel, QueryCell,
    QueryIr, QueryKey, QueryPool, QueryRequest, QuerySource, QueryState, SlotRef, RESERVED_IR_KEYS,
};
pub use resolve::{resolve, NoParts, PartSource, ResolveCx};
pub use resolved::{
    normal_form, HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope, Transition,
    TransitionEffect, TransitionKind,
};
pub use runtime::{AppSpec, RootSpec, Runtime, StaticHost, Stats, ORPHANED_CAP};
pub use scope::{bind_screen, FieldMeta, LocalDecl, LocalNs, LocalScope, ScopeEnv, StoreBag};
/// The mount-identity family lives in `we-expr` (a `Namespace::as_handle`
/// must name a type from below `we-template`; E3c-7, R4). Re-exported so
/// frontends and tests need no extra dependency for `MountCx`.
pub use we_expr::{
    BundleSlot, HandleKind, HandleRef, HandleTable, MountCx, Provenance, SpaceHandle, Tier,
};
