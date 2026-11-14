//! `ShellState` — the shell chrome a template reads and writes: overlay
//! views, the space-settings dock, panels, lanes, dialogs. Deliberately no
//! address (rule 10): overlays live in a separate in-memory router, so Back
//! does not close them and a reload does not reopen them.
use std::collections::{BTreeMap, HashMap};

use crate::Changed;

/// A full-screen host overlay — `landing-page`, `settings`, `profile` —
/// with the sub-path its own memory router is on.
#[derive(Clone, Debug, PartialEq)]
pub struct ShellOverlay {
    /// The view id.
    pub id: String,
    /// The path the overlay's router mounts at (`pendingPath` in the TS —
    /// explicit, or where this view was last left).
    pub path: Option<String>,
}

/// The space-settings dock when open (`None` = closed).
#[derive(Clone, Debug, PartialEq)]
pub struct SpaceSettingsDock {
    /// `about`, `vocabulary`, …
    pub tab: String,
    /// A row to scroll to (`vocab-<focus>`), empty for none.
    pub focus: String,
}

/// One template panel's layout state.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PanelState {
    /// On screen.
    pub open: bool,
    /// Filling the space.
    pub maximised: bool,
    /// The width it was dragged to, if moved.
    pub width: Option<u32>,
}

/// One home lane's layout state.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LaneState {
    /// Folded away (`tree` is the lane the bundle folds).
    pub collapsed: bool,
    /// The width it was dragged to, if moved.
    pub width: Option<u32>,
}

/// The host dialogs a template may open — `create_space`, `join_space`.
/// Kept as a small map so a new dialog needs no struct change.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Dialogs {
    open: BTreeMap<String, bool>,
}

/// The dialogs a template can name.
pub const DIALOG_IDS: &[&str] = &["create_space", "join_space"];

impl Dialogs {
    /// Whether the named dialog is open.
    pub fn is_open(&self, name: &str) -> bool {
        self.open.get(name).copied().unwrap_or(false)
    }

    /// Every dialog's flag, for the bag's snapshot.
    pub fn all(&self) -> BTreeMap<String, bool> {
        self.open.clone()
    }

    /// Open or close a named dialog. An unknown name is refused (warned)
    /// rather than stored — the bag would never read it back.
    pub fn set(&mut self, name: &str, open: bool) -> Changed {
        if !DIALOG_IDS.contains(&name) {
            log::warn!("we-screen: setDialog on unknown dialog {name:?}; ignored");
            return Changed::No;
        }
        if self.is_open(name) == open {
            return Changed::No;
        }
        self.open.insert(name.to_string(), open);
        Changed::Yes
    }
}

/// Everything the shell owns that has no address (rule 10).
#[derive(Clone, Debug, Default)]
pub struct ShellState {
    /// The open overlay, if any — separate from `nav`, by design.
    pub overlay: Option<ShellOverlay>,
    /// The space-settings dock when open.
    pub space_settings: Option<SpaceSettingsDock>,
    /// Panel id → layout state.
    pub panels: BTreeMap<String, PanelState>,
    /// Lane id → layout state.
    pub lanes: BTreeMap<String, LaneState>,
    /// The dialogs.
    pub dialogs: Dialogs,
    /// Panels dragged, lanes folded: the layout no longer matches the
    /// template's declaration, so the reset affordance shows.
    pub layout_dirty: bool,
    /// Every panel put away on purpose (`panelsHiddenByUser` in the TS).
    pub panels_hidden: bool,
    /// The view each overlay id was last left on — `lastShellPath` in the
    /// TS, so reopening a view lands where it was left.
    last_paths: HashMap<String, String>,
}

impl ShellState {
    /// `openShellView(id, path?)`: an explicit path wins; otherwise the view
    /// reopens where it was last left (`ShellStore.tsx:3338`).
    pub fn open_shell_view(&mut self, id: &str, path: Option<&str>) -> Changed {
        let path = path
            .map(str::to_string)
            .or_else(|| self.last_paths.get(id).cloned());
        let next = ShellOverlay {
            id: id.to_string(),
            path,
        };
        if self.overlay.as_ref() == Some(&next) {
            return Changed::No;
        }
        self.overlay = Some(next);
        Changed::Yes
    }

    /// `closeShellView()`.
    pub fn close_shell_view(&mut self) -> Changed {
        if self.overlay.take().is_some() {
            Changed::Yes
        } else {
            Changed::No
        }
    }

    /// `rememberShellPath(path)` — the overlay's router reporting where it
    /// went, kept for the next `open_shell_view`.
    pub fn remember_shell_path(&mut self, path: &str) {
        if let Some(id) = self.overlay.as_ref().map(|o| o.id.clone()) {
            self.last_paths.insert(id, path.to_string());
            if let Some(o) = self.overlay.as_mut() {
                o.path = Some(path.to_string());
            }
        }
    }

    /// `openSpaceSettings(tab?, focus?)` — only a name is a tab: an empty or
    /// absent one opens `about` (`ShellStore.tsx:3422`).
    pub fn open_space_settings(&mut self, tab: Option<&str>, focus: Option<&str>) -> Changed {
        let tab = match tab {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => "about".to_string(),
        };
        let focus = focus.unwrap_or_default().to_string();
        let next = SpaceSettingsDock { tab, focus };
        if self.space_settings.as_ref() == Some(&next) {
            return Changed::No;
        }
        self.space_settings = Some(next);
        Changed::Yes
    }

    /// `closeSpaceSettings()`.
    pub fn close_space_settings(&mut self) -> Changed {
        if self.space_settings.take().is_some() {
            Changed::Yes
        } else {
            Changed::No
        }
    }

    /// `toggleSpaceSettings()` — the focus does not survive the toggle
    /// (`ShellStore.tsx:3418`).
    pub fn toggle_space_settings(&mut self) -> Changed {
        if self.space_settings.is_some() {
            self.close_space_settings()
        } else {
            self.open_space_settings(None, None)
        }
    }

    /// `openTemplatePanel(id)` — opened on purpose, so in sight: the panel is
    /// marked open and the reveal un-hides the panels and closes any overlay
    /// (`revealDock`, `ShellStore.tsx:4675,4974`).
    pub fn open_template_panel(&mut self, id: &str) -> Changed {
        let mut changed = Changed::No;
        let panel = self.panels.entry(id.to_string()).or_default();
        if !panel.open {
            panel.open = true;
            changed = Changed::Yes;
        }
        if self.panels_hidden {
            self.panels_hidden = false;
            changed = Changed::Yes;
        }
        if self.overlay.is_some() {
            self.overlay = None;
            changed = Changed::Yes;
        }
        changed
    }

    /// `closeTemplatePanel(id)`.
    pub fn close_template_panel(&mut self, id: &str) -> Changed {
        let panel = self.panels.entry(id.to_string()).or_default();
        if panel.open {
            panel.open = false;
            self.layout_dirty = true;
            Changed::Yes
        } else {
            Changed::No
        }
    }

    /// `setLaneCollapsed(lane, collapsed)` (`ShellStore.tsx:4849`).
    pub fn set_lane_collapsed(&mut self, lane: &str, collapsed: bool) -> Changed {
        let state = self.lanes.entry(lane.to_string()).or_default();
        if state.collapsed == collapsed {
            return Changed::No;
        }
        state.collapsed = collapsed;
        self.layout_dirty = true;
        Changed::Yes
    }

    /// `resetTemplateLayout()` — panels and lanes back to the template's
    /// declaration (`ShellStore.tsx:4803`).
    pub fn reset_template_layout(&mut self) -> Changed {
        if !self.layout_dirty
            && self.panels.values().all(|p| p == &PanelState::default())
            && self.lanes.is_empty()
        {
            return Changed::No;
        }
        self.panels.retain(|_, p| *p != PanelState::default());
        self.lanes.clear();
        self.layout_dirty = false;
        Changed::Yes
    }
}
