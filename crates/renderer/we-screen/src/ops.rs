//! `ScreenOp` — the single write entry point for screen state (the data
//! flow in E2: handler → `apply` → `Changed` + `version += 1`). The store
//! map's `screen` rows name these ops (`"op": "nav.setParam"`), so each
//! variant has a stable string name — see [`OP_NAMES`].
use indexmap::IndexMap;
use we_expr::Value;

use crate::{Changed, NavigateOptions, ScreenState};

/// Every way a template (or the host) can write screen state.
#[derive(Clone, Debug)]
pub enum ScreenOp {
    /// `routeStore.navigate` — `to` resolved as `navigate` resolves it.
    Navigate {
        /// The path — absolute, relative, `?query`, `#fragment`, `~/from-root`.
        to: String,
        /// Query values written for the target (`NavigateOptions.query`).
        query: Option<IndexMap<String, Value>>,
        /// The depth a relative `to` is from (`NavigateOptions.base_depth`).
        base_depth: Option<usize>,
        /// Replace the current entry rather than push.
        replace: bool,
    },
    /// `routeStore.setParam` — `value` `None` or `""` deletes the param.
    SetParam {
        /// The param name.
        name: String,
        /// Its new text — `None` deletes.
        value: Option<String>,
        /// Explicit history policy; `None` follows the declared param's
        /// `push` default (`push: true` adds a Back entry).
        push: Option<bool>,
    },
    /// `routeStore.back`.
    Back,
    /// `routeStore.forward`.
    Forward,
    /// A deep link, first load or `popstate`: land on `href`, replacing the
    /// current entry.
    Open {
        /// The address reported.
        href: String,
    },
    /// `shellStore.openShellView` — an explicit `path` wins, else the view
    /// reopens where it was last left.
    OpenShellView {
        /// `landing-page`, `settings`, `profile`, …
        id: String,
        /// The overlay router's mount path.
        path: Option<String>,
    },
    /// `shellStore.closeShellView`.
    CloseShellView,
    /// `shellStore.openSpaceSettings` — `tab` defaults to `about`.
    OpenSpaceSettings {
        /// The dock's tab.
        tab: Option<String>,
        /// A row to scroll to.
        focus: Option<String>,
    },
    /// `shellStore.toggleSpaceSettings`.
    ToggleSpaceSettings,
    /// `shellStore.openTemplatePanel` — in sight, so panels un-hide and any
    /// overlay closes (`revealDock`).
    OpenTemplatePanel {
        /// The panel id (`inspector`, …).
        id: String,
    },
    /// `shellStore.closeTemplatePanel`.
    CloseTemplatePanel {
        /// The panel id.
        id: String,
    },
    /// `shellStore.setLaneCollapsed`.
    SetLaneCollapsed {
        /// The lane (`tree`, …).
        lane: String,
        /// Folded or not.
        collapsed: bool,
    },
    /// `shellStore.setCreateSpaceOpen` / `setJoinSpaceOpen` — one op, the
    /// dialog's name (`create_space`, `join_space`).
    SetDialog {
        /// The dialog name.
        name: String,
        /// Open or closed.
        open: bool,
    },
    /// `themeStore.setCurrentTheme`.
    SetCurrentTheme {
        /// The theme id.
        theme: String,
    },
    /// `shellStore.resetTemplateLayout`.
    ResetTemplateLayout,
    /// A device-preference write (`prefs.set`) — `value` `None` removes the
    /// key.
    SetPref {
        /// The preference key — `we-local:<persist>` for a synced field.
        key: String,
        /// The value as JSON — `None` removes the entry.
        value: Option<serde_json::Value>,
    },
}

/// The op names the store map's `screen` rows write — one table, so the map
/// and this enum cannot drift (`"op": "nav.setParam"`). The test
/// `op_names_table_is_complete` proves the count; the match in
/// [`ScreenOp::name`] proves the coverage.
pub const OP_NAMES: &[&str] = &[
    "nav.navigate",
    "nav.setParam",
    "nav.back",
    "nav.forward",
    "nav.open",
    "shell.openShellView",
    "shell.closeShellView",
    "shell.openSpaceSettings",
    "shell.toggleSpaceSettings",
    "shell.openTemplatePanel",
    "shell.closeTemplatePanel",
    "shell.setLaneCollapsed",
    "shell.setDialog",
    "theme.setCurrentTheme",
    "shell.resetTemplateLayout",
    "prefs.set",
];

impl ScreenOp {
    /// The op's stable store-map name — a member of [`OP_NAMES`]. The match
    /// is exhaustive: a new variant does not compile until it is named.
    pub fn name(&self) -> &'static str {
        match self {
            ScreenOp::Navigate { .. } => "nav.navigate",
            ScreenOp::SetParam { .. } => "nav.setParam",
            ScreenOp::Back => "nav.back",
            ScreenOp::Forward => "nav.forward",
            ScreenOp::Open { .. } => "nav.open",
            ScreenOp::OpenShellView { .. } => "shell.openShellView",
            ScreenOp::CloseShellView => "shell.closeShellView",
            ScreenOp::OpenSpaceSettings { .. } => "shell.openSpaceSettings",
            ScreenOp::ToggleSpaceSettings => "shell.toggleSpaceSettings",
            ScreenOp::OpenTemplatePanel { .. } => "shell.openTemplatePanel",
            ScreenOp::CloseTemplatePanel { .. } => "shell.closeTemplatePanel",
            ScreenOp::SetLaneCollapsed { .. } => "shell.setLaneCollapsed",
            ScreenOp::SetDialog { .. } => "shell.setDialog",
            ScreenOp::SetCurrentTheme { .. } => "theme.setCurrentTheme",
            ScreenOp::ResetTemplateLayout => "shell.resetTemplateLayout",
            ScreenOp::SetPref { .. } => "prefs.set",
        }
    }
}

impl ScreenState {
    /// The single write entry point: apply `op`, and bump `version` by one
    /// when — and only when — something changed (screen-state.md §4.6).
    pub fn apply(&mut self, op: ScreenOp) -> Changed {
        let changed = match op {
            ScreenOp::Navigate {
                to,
                query,
                base_depth,
                replace,
            } => self.nav.navigate(
                &to,
                NavigateOptions {
                    query,
                    base_depth,
                    replace,
                },
            ),
            ScreenOp::SetParam { name, value, push } => {
                let push = push.unwrap_or_else(|| self.nav.declared_push(&name));
                self.nav.set_param(&name, value.as_deref(), push)
            }
            ScreenOp::Back => self.nav.back(),
            ScreenOp::Forward => self.nav.forward(),
            ScreenOp::Open { href } => self.nav.open(&href),
            ScreenOp::OpenShellView { id, path } => {
                self.shell.open_shell_view(&id, path.as_deref())
            }
            ScreenOp::CloseShellView => self.shell.close_shell_view(),
            ScreenOp::OpenSpaceSettings { tab, focus } => self
                .shell
                .open_space_settings(tab.as_deref(), focus.as_deref()),
            ScreenOp::ToggleSpaceSettings => self.shell.toggle_space_settings(),
            ScreenOp::OpenTemplatePanel { id } => self.shell.open_template_panel(&id),
            ScreenOp::CloseTemplatePanel { id } => self.shell.close_template_panel(&id),
            ScreenOp::SetLaneCollapsed { lane, collapsed } => {
                self.shell.set_lane_collapsed(&lane, collapsed)
            }
            ScreenOp::SetDialog { name, open } => self.shell.dialogs.set(&name, open),
            ScreenOp::SetCurrentTheme { theme } => self.theme.set_current_theme(&theme),
            ScreenOp::ResetTemplateLayout => self.shell.reset_template_layout(),
            ScreenOp::SetPref { key, value } => self.prefs.set(&key, value.as_ref()),
        };
        if changed.changed() {
            self.version += 1;
        }
        changed
    }
}
