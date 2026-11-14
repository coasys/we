//! `ThemeState` — which theme is shown, and an edit fork if one is in the
//! naming dialog. Ids only: the theme's colours are E4's problem.
use crate::Changed;

/// A theme id — `light`, `dark`, an agent's saved theme.
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct ThemeId(pub String);

impl ThemeId {
    /// The id text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for ThemeId {
    fn from(s: &str) -> ThemeId {
        ThemeId(s.to_string())
    }
}

impl From<String> for ThemeId {
    fn from(s: String) -> ThemeId {
        ThemeId(s)
    }
}

/// The naming dialog for a new theme or a fork of one, while it is open
/// (`themeFork` in `ThemeStore.tsx:1361`): the theme forked (empty for a new
/// one) and what the copy starts as.
#[derive(Clone, Debug, PartialEq)]
pub struct ThemeFork {
    /// The forked theme's id — `""` when this is a new theme, not a fork.
    pub source: String,
    /// The name the copy starts with.
    pub name: String,
    /// Its icon.
    pub icon: String,
}

/// Which theme is shown, and the fork dialog's state.
#[derive(Clone, Debug, Default)]
pub struct ThemeState {
    /// `currentThemeId`.
    pub current: ThemeId,
    /// The open fork dialog, if any.
    pub editing: Option<ThemeFork>,
}

impl ThemeState {
    /// `setCurrentTheme(themeId)`.
    pub fn set_current_theme(&mut self, id: &str) -> Changed {
        if self.current.as_str() == id {
            return Changed::No;
        }
        self.current = ThemeId(id.to_string());
        Changed::Yes
    }

    /// `startThemeFork(sourceId?)` — only a name is a theme: the caller has
    /// already resolved the source against the registry and passes what the
    /// dialog starts as; an absent source is a new theme.
    pub fn start_theme_fork(&mut self, fork: ThemeFork) -> Changed {
        self.editing = Some(fork);
        Changed::Yes
    }

    /// `cancelThemeFork()`.
    pub fn cancel_theme_fork(&mut self) -> Changed {
        if self.editing.take().is_some() {
            Changed::Yes
        } else {
            Changed::No
        }
    }
}
