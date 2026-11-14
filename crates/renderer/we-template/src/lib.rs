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

mod bundle;
mod handler;
mod node;
mod resolved;

pub use bundle::{
    Bundle, BundleAuthor, BundleBrand, BundleDisplay, BundleRecordType, BundleTemplate,
    BundleTheme, DisplaySpaces, BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION,
};
pub use handler::{CallId, HandlerToken, Host, Invoked};
pub use node::{RouteNode, SchemaChild, SchemaNode};
pub use resolved::{
    normal_form, HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope, Transition,
    TransitionEffect, TransitionKind,
};
