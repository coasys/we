//! `we-screen`: everything about "what is on screen" that is not model data —
//! `ScreenState`, the `Navigator`, the back stack. The design is written in
//! the plan (`plan/screen-state.md`); E2 builds it here against the
//! `paths.json` and `navigation.json` vectors.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
#![forbid(unsafe_code)]

mod history;
mod js;
mod location;
mod navigator;
mod path;
mod query;
mod schema;

pub use history::{HistoryBackend, MemoryHistory};
pub use js::{js_json_eq, js_json_stringify, param_text, plain_value};
pub use location::{Location, Route};
pub use navigator::{Changed, NavigateOptions, Navigator};
pub use path::{is_relative_path, resolve_path, template_root_depth, PathBase, SPACE_ROUTE_DEPTH};
pub use query::{encode_pair, parse_query, query_string, query_string_pairs};
pub use schema::{ParamDecl, ParamType, ParamValue, ScreenSchema};
