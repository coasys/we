//! `ScreenBag` — the template-visible names of screen-state.md §4.4 as a
//! [`we_expr::Namespace`], the read half of the contract (the write half is
//! [`ScreenOp`](crate::ScreenOp)). A snapshot: the resolver re-resolves when
//! `version` moves, so it wants one consistent picture, not a live handle —
//! which is also why this is data and not `&ScreenState`.
use std::collections::BTreeMap;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::{MapNamespace, Namespace, Value};

use crate::{Route, ScreenState};

/// One consistent picture of the names §4.4 lets a template read.
#[derive(Debug)]
pub struct ScreenBag {
    nav: NavBag,
    shell: ShellBag,
    theme: ThemeBag,
}

impl ScreenBag {
    /// Snapshot `state` — call it when `version` moves.
    pub fn snapshot(state: &ScreenState) -> ScreenBag {
        let nav = &state.nav;
        let location = nav.location();
        let space_path = match nav.route() {
            Route::Space { space_id, .. } => Value::Str(format!("/space/{space_id}").into()),
            _ => Value::Null,
        };
        ScreenBag {
            nav: NavBag {
                params: location
                    .params
                    .iter()
                    .map(|(k, v)| (k.as_str().into(), Value::Str(v.as_str().into())))
                    .collect(),
                segments: strings(&location.segments),
                template_segments: strings(location.template_segments()),
                current_path: location.pathname().into(),
                page: nav.page_identity().into(),
                href: location.href().into(),
                space_path,
            },
            shell: ShellBag {
                active_view: state
                    .shell
                    .overlay
                    .as_ref()
                    .map(|o| Value::Str(o.id.as_str().into()))
                    .unwrap_or(Value::Null),
                space_settings_open: state.shell.space_settings.is_some(),
                space_settings_tab: state
                    .shell
                    .space_settings
                    .as_ref()
                    .map(|d| Value::Str(d.tab.as_str().into()))
                    .unwrap_or(Value::Null),
                collapsed_lanes: strings(
                    &state
                        .shell
                        .lanes
                        .iter()
                        .filter(|(_, l)| l.collapsed)
                        .map(|(k, _)| k.clone())
                        .collect::<Vec<_>>(),
                ),
                layout_dirty: state.shell.layout_dirty,
                panels_hidden: state.shell.panels_hidden,
                panel_maximised: state.shell.panels.values().any(|p| p.maximised),
                dialogs: state
                    .shell
                    .dialogs
                    .all()
                    .into_iter()
                    .map(|(k, v)| (k.into(), Value::Bool(v)))
                    .collect(),
                panels_open: state
                    .shell
                    .panels
                    .iter()
                    .map(|(k, p)| (k.as_str().into(), Value::Bool(p.open)))
                    .collect(),
            },
            theme: ThemeBag {
                // An unset theme is no answer — `""` must not shadow the
                // store's own `currentThemeId`; the merged namespace falls
                // through to it until `setCurrentTheme` lands.
                current_id: if state.theme.current.as_str().is_empty() {
                    Value::Undefined
                } else {
                    Value::Str(state.theme.current.as_str().into())
                },
                fork: state
                    .theme
                    .editing
                    .as_ref()
                    .map(|f| {
                        let mut o = IndexMap::new();
                        o.insert("source".into(), Value::Str(f.source.as_str().into()));
                        o.insert("name".into(), Value::Str(f.name.as_str().into()));
                        o.insert("icon".into(), Value::Str(f.icon.as_str().into()));
                        Value::Obj(Arc::new(o))
                    })
                    .unwrap_or(Value::Null),
            },
        }
    }
}

impl Namespace for ScreenBag {
    fn get(&self, key: &str) -> Value {
        match key {
            "nav" => Value::namespace(NavBag {
                params: self.nav.params.clone(),
                segments: self.nav.segments.clone(),
                template_segments: self.nav.template_segments.clone(),
                current_path: self.nav.current_path.clone(),
                page: self.nav.page.clone(),
                href: self.nav.href.clone(),
                space_path: self.nav.space_path.clone(),
            }),
            "shell" => Value::namespace(ShellBag {
                active_view: self.shell.active_view.clone(),
                space_settings_open: self.shell.space_settings_open,
                space_settings_tab: self.shell.space_settings_tab.clone(),
                collapsed_lanes: self.shell.collapsed_lanes.clone(),
                layout_dirty: self.shell.layout_dirty,
                panels_hidden: self.shell.panels_hidden,
                panel_maximised: self.shell.panel_maximised,
                dialogs: self.shell.dialogs.clone(),
                panels_open: self.shell.panels_open.clone(),
            }),
            "theme" => Value::namespace(ThemeBag {
                current_id: self.theme.current_id.clone(),
                fork: self.theme.fork.clone(),
            }),
            _ => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        vec!["nav".into(), "shell".into(), "theme".into()]
    }
}

#[derive(Debug)]
struct NavBag {
    params: IndexMap<Arc<str>, Value>,
    segments: Vec<Arc<str>>,
    template_segments: Vec<Arc<str>>,
    current_path: Arc<str>,
    page: Arc<str>,
    href: Arc<str>,
    space_path: Value,
}

impl Namespace for NavBag {
    fn get(&self, key: &str) -> Value {
        match key {
            // `routeStore.params.<x>` — always the string the URL carries;
            // typed values are for Rust callers, not the template (§4.4).
            "params" => Value::namespace(MapNamespace::new(self.params.clone())),
            "templateSegments" => Value::List(Arc::new(
                self.template_segments
                    .iter()
                    .map(|s| Value::Str(s.as_ref().into()))
                    .collect(),
            )),
            "segments" => Value::List(Arc::new(
                self.segments
                    .iter()
                    .map(|s| Value::Str(s.as_ref().into()))
                    .collect(),
            )),
            "currentPath" => Value::Str(self.current_path.clone()),
            "page" => Value::Str(self.page.clone()),
            "href" => Value::Str(self.href.clone()),
            // `spaceStore.spacePath` — `"/space/<id>"` in a space, null
            // outside one.
            "spacePath" => self.space_path.clone(),
            _ => Value::Undefined,
        }
    }

    fn keys(&self) -> Vec<Arc<str>> {
        vec![
            "params".into(),
            "templateSegments".into(),
            "segments".into(),
            "currentPath".into(),
            "page".into(),
            "href".into(),
            "spacePath".into(),
        ]
    }
}

#[derive(Debug)]
struct ShellBag {
    active_view: Value,
    space_settings_open: bool,
    space_settings_tab: Value,
    collapsed_lanes: Vec<Arc<str>>,
    layout_dirty: bool,
    panels_hidden: bool,
    panel_maximised: bool,
    dialogs: BTreeMap<Arc<str>, Value>,
    panels_open: IndexMap<Arc<str>, Value>,
}

impl Namespace for ShellBag {
    fn get(&self, key: &str) -> Value {
        match key {
            "activeShellView" => self.active_view.clone(),
            "spaceSettingsOpen" => Value::Bool(self.space_settings_open),
            "spaceSettingsTab" => self.space_settings_tab.clone(),
            "collapsedLanes" => Value::List(Arc::new(
                self.collapsed_lanes
                    .iter()
                    .map(|s| Value::Str(s.as_ref().into()))
                    .collect(),
            )),
            "layoutDirty" => Value::Bool(self.layout_dirty),
            "panelsHidden" => Value::Bool(self.panels_hidden),
            "panelMaximised" => Value::Bool(self.panel_maximised),
            // The dialogs by their accessor names (`createSpaceOpen`, …).
            "createSpaceOpen" => self
                .dialogs
                .get("create_space")
                .cloned()
                .unwrap_or(Value::Bool(false)),
            "joinSpaceOpen" => self
                .dialogs
                .get("join_space")
                .cloned()
                .unwrap_or(Value::Bool(false)),
            "panels" => Value::namespace(MapNamespace::new(self.panels_open.clone())),
            _ => Value::Undefined,
        }
    }
}

#[derive(Debug)]
struct ThemeBag {
    current_id: Value,
    fork: Value,
}

impl Namespace for ThemeBag {
    fn get(&self, key: &str) -> Value {
        match key {
            "currentThemeId" => self.current_id.clone(),
            "themeFork" => self.fork.clone(),
            _ => Value::Undefined,
        }
    }
}

fn strings(list: &[String]) -> Vec<Arc<str>> {
    list.iter().map(|s| s.as_str().into()).collect()
}
