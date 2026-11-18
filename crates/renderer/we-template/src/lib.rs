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
mod chat_permit;
mod gate;
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
mod screen_view;
mod surface;

pub use bindings::{
    root_domain, BagBindings, BindingSource, Bound, DataRevision, Invalidator, MemberRule,
    MemberTiers, RootDomain,
};
pub use bundle::{
    Bundle, BundleAuthor, BundleBrand, BundleDisplay, BundleRecordType, BundleTemplate,
    BundleTheme, DisplaySpaces, BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION,
};
pub use chat_permit::{
    bind_chat_mount, chat_mount, chat_origin, clear_chat_origins, issue_chat_permit,
    publish_chat_origins, stamp_chat_origin, ChatIntent, ChatMount, ChatOrigin, ChatPermit,
};
pub use gate::{screen_tiers, Declared, FilteredNs, Frame, Gate, MemberVerdict, Permit, Verdict};
pub use handler::{CallId, HandlerToken};
pub use handlers::{run as run_handler, HandlerCx, PendingCall, PendingMap};
pub use host::{Action, ActionRequest, CallBook, Completer, Host, Invoked, MountId, Origin};
pub use inbox::{Inbox, Waker};
pub use local::LocalState;
pub use node::{RouteNode, SchemaChild, SchemaNode};
pub use query::{
    compile_query, compile_request, prune_where, query_descriptor, scope_anchored, CompileCx,
    Compiled, DatasetHandle, DatasetSel, HubCell, QueryEvent, QueryHub, QueryIr, QueryKey,
    QueryRequest, QuerySink, QuerySlot, QuerySource, SiteId, SiteSlot, SlotRef, SlotView,
    SubTicket, RESERVED_IR_KEYS, RETRY_COOLDOWN,
};
pub use resolve::{
    inert, resolve, strip_authority, taint_handles, NoParts, PartDef, PartSource, ResolveCx,
};
pub use resolved::{
    normal_form, HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope, Transition,
    TransitionEffect, TransitionKind,
};
pub use runtime::{AppSpec, RootSpec, Runtime, StaticHost, Stats, ORPHANED_CAP};
pub use scope::{
    content_eq, FieldMeta, LocalDecl, LocalNs, LocalScope, RootLayer, Roots, ScopeEnv, StoreBag,
};
pub use screen_view::ScreenView;
pub use surface::{SurfaceKey, SurfaceTag};
/// The mount-identity family lives in `we-expr` (a `Namespace::as_handle`
/// must name a type from below `we-template`; E3c-7, R4). Re-exported so
/// frontends and tests need no extra dependency for `MountCx`.
pub use we_expr::{
    BundleSlot, HandleKind, HandleRef, HandleTable, MountCx, Provenance, SpaceHandle, Tier,
};
