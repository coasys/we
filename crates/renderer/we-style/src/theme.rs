//! `Theme` and `ThemeSet`: an id, a polarity, and the recorded token table the
//! theme computes in a browser. This crate does not generate themes — it
//! consumes the tables C1 records (`tokens/<theme>.json`). A theme with no
//! recorded table falls back to `dark`, the known limit listed in the brief.

use std::sync::Arc;

use crate::tokens::{TokenTable, TokenTableError};

/// The side of the lightness ramp a theme sits on — `light` or `dark`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Polarity {
    Light,
    Dark,
}

/// One theme: what it is called, which polarity it declares, and the computed
/// custom properties a browser recorded for it.
#[derive(Debug, Clone)]
pub struct Theme {
    pub id: Arc<str>,
    pub polarity: Polarity,
    pub tokens: Arc<TokenTable>,
}

impl Theme {
    /// From a recorded `tokens/<id>.json` value: `{ "theme": id, "vars": {} }`.
    pub fn from_recorded(
        id: impl Into<Arc<str>>,
        polarity: Polarity,
        json: &serde_json::Value,
    ) -> Result<Self, TokenTableError> {
        Ok(Self {
            id: id.into(),
            polarity,
            tokens: Arc::new(TokenTable::from_json(json)?),
        })
    }

    /// An empty table — every `var(--we-*)` is undeclared, every field stays
    /// unset. Useful for tests that only exercise emission.
    pub fn empty(id: impl Into<Arc<str>>, polarity: Polarity) -> Self {
        Self {
            id: id.into(),
            polarity,
            tokens: Arc::new(TokenTable::default()),
        }
    }
}

/// The polarity a built-in preset declares, from `2-themes/src/presets.ts`.
/// `glow` — the bundle's own theme — declares `polarity: 'dark'` in its
/// overrides; bundle themes not listed fall back per `ThemeSet`.
pub fn preset_polarity(id: &str) -> Polarity {
    match id {
        "light" | "retro" | "twitter" => Polarity::Light,
        _ => Polarity::Dark,
    }
}

/// The themes a deployment can switch among. `get` returns `None` for an id
/// nothing declared; `theme` falls back to `dark` — the brief's documented
/// behaviour until a Rust theme generator exists.
#[derive(Debug, Clone, Default)]
pub struct ThemeSet {
    themes: Vec<Theme>,
    /// Index of the fallback theme (`dark` when present, else the first).
    fallback: usize,
}

impl ThemeSet {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a theme; the first `dark` registered becomes the fallback.
    pub fn push(&mut self, theme: Theme) -> &mut Self {
        if theme.id.as_ref() == "dark" {
            self.fallback = self.themes.len();
        }
        self.themes.push(theme);
        self
    }

    /// The named theme, if it has a recorded table.
    pub fn get(&self, id: &str) -> Option<&Theme> {
        self.themes.iter().find(|t| t.id.as_ref() == id)
    }

    /// The named theme or the `dark` fallback — with a flag saying whether the
    /// fallback fired, so the caller can warn once.
    pub fn theme(&self, id: &str) -> (&Theme, bool) {
        match self.get(id) {
            Some(t) => (t, false),
            None => (self.fallback_theme(), true),
        }
    }

    /// The table used when the asked-for theme has no record — `dark` if any
    /// was registered, else the first theme, else an empty synthetic one.
    pub fn fallback_theme(&self) -> &Theme {
        static EMPTY: std::sync::OnceLock<Theme> = std::sync::OnceLock::new();
        self.themes
            .get(self.fallback)
            .unwrap_or_else(|| EMPTY.get_or_init(|| Theme::empty("", Polarity::Dark)))
    }

    pub fn iter(&self) -> impl Iterator<Item = &Theme> {
        self.themes.iter()
    }

    pub fn len(&self) -> usize {
        self.themes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.themes.is_empty()
    }
}
