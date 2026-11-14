//! `we-screen` — the typed screen state of the egui renderer: the address
//! on screen and the back stack behind it (`Navigator`), the shell chrome
//! with no address (`ShellState`), the theme, and this device's
//! preferences. `ScreenOp` is the single write entry point; `ScreenBag` is
//! the template-visible read side. See `plan/screen-state.md`.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
#![forbid(unsafe_code)]

mod bag;
mod history;
mod js;
mod location;
mod navigator;
mod ops;
mod path;
mod prefs;
mod query;
mod schema;
mod shell;
mod sync_param;
mod theme;

pub use bag::ScreenBag;
pub use history::{HistoryBackend, MemoryHistory};
pub use js::{js_json_eq, js_json_stringify, param_text, plain_value};
pub use location::{Location, Route};
pub use navigator::{Changed, NavigateOptions, Navigator};
pub use ops::{ScreenOp, OP_NAMES};
pub use path::{is_relative_path, resolve_path, template_root_depth, PathBase, SPACE_ROUTE_DEPTH};
pub use prefs::{DevicePrefs, FilePrefs, MemoryPrefs, PrefStore};
pub use query::{encode_pair, parse_query, query_string, query_string_pairs};
pub use schema::{ParamDecl, ParamType, ParamValue, ScreenSchema};
pub use shell::{
    Dialogs, LaneState, PanelState, ShellOverlay, ShellState, SpaceSettingsDock, DIALOG_IDS,
};
pub use sync_param::{
    decode_local_param, encode_local_param, local_param_text, local_persist_key, local_sync_spec,
    local_write_mirror, resolve_local_initial, LocalParamWrite, LocalWriteMirror,
};
pub use theme::{ThemeFork, ThemeId, ThemeState};

#[cfg(target_arch = "wasm32")]
mod history_web;
#[cfg(target_arch = "wasm32")]
pub use history_web::BrowserHistory;
#[cfg(target_arch = "wasm32")]
pub use prefs::LocalStoragePrefs;

/// Everything about "what is on screen" that is not model data
/// (screen-state.md §4.1). Writes go through [`ScreenState::apply`] with a
/// [`ScreenOp`]; reads go through [`ScreenBag`] or the fields' accessors.
pub struct ScreenState {
    /// Tiers 1 and 2, with history.
    pub nav: Navigator,
    /// Overlay, dock, panels, lanes, dialogs — no address.
    pub shell: ShellState,
    /// Which theme is shown, and an edit fork if any.
    pub theme: ThemeState,
    /// Tier 3, persisted per device.
    pub prefs: DevicePrefs,
    /// Bumped on every change; the renderer re-resolves when it moves.
    pub version: u64,
}

impl ScreenState {
    /// Screen state from its parts.
    pub fn new(nav: Navigator, prefs: DevicePrefs) -> ScreenState {
        ScreenState {
            nav,
            shell: ShellState::default(),
            theme: ThemeState::default(),
            prefs,
            version: 0,
        }
    }

    /// The desktop construction: `MemoryHistory` starting at `start_href`,
    /// `MemoryPrefs`.
    pub fn desktop(schema: ScreenSchema, start_href: &str) -> ScreenState {
        ScreenState::new(
            Navigator::new(schema, Box::new(MemoryHistory::new(start_href))),
            DevicePrefs::new(Box::new(MemoryPrefs::default())),
        )
    }

    /// The template-visible bag — one consistent picture (§4.4).
    pub fn bag(&self) -> ScreenBag {
        ScreenBag::snapshot(self)
    }
}
