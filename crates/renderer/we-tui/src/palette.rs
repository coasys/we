//! The theme's colour roles → terminal colours.
//!
//! `Palette` reads the recorded token table's `--we-role-*` entries (via
//! [`we_style::eval_color`]) once per theme — the same names `bg`/`color`/
//! `tone` resolve through — and holds them as [`ratatui::style::Color`].
//! Truecolor terminals get `Color::Rgb`; the rest get the nearest entry of
//! the xterm-256 palette (nearest by squared sRGB distance over the cube
//! and grey ramps — the standard approximation).
use std::path::PathBuf;

use we_style::{eval_color, Color as WColor, Polarity, Theme, ThemeSet};

/// The six themes the conformance tables record, in display order — the
/// same list `we-app`'s gallery uses.
pub const THEME_ORDER: &[&str] = &["light", "dark", "black", "retro", "cyberpunk", "glow"];

/// The polarity each preset declares (`glow` is dark) — mirrors
/// `we_app::gallery::polarity_for`, kept here so we-tui never imports the
/// egui crates.
pub fn polarity_for(id: &str) -> Polarity {
    match id {
        "light" | "retro" | "twitter" => Polarity::Light,
        _ => Polarity::Dark,
    }
}

/// The recorded token tables ship with the repo — `tokens/<theme>.json`
/// beside `crates/`, the same layout `we-cli`'s `DEFAULT_BUNDLE` assumes.
pub fn tokens_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors/tokens")
}

/// Every theme with a recorded table, in `THEME_ORDER`.
pub fn load_theme_set() -> ThemeSet {
    let mut set = ThemeSet::new();
    for id in THEME_ORDER {
        let Ok(text) = std::fs::read_to_string(tokens_dir().join(format!("{id}.json"))) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if let Ok(theme) = Theme::from_recorded(*id, polarity_for(id), &json) {
            set.push(theme);
        }
    }
    set
}

/// The roles a frame actually paints with, resolved once per theme.
/// `Option` keeps "the table did not declare it" honest — the caller falls
/// back to polarity defaults, never to a guessed colour.
#[derive(Debug, Clone, Copy, Default)]
pub struct Palette {
    /// `--we-role-text` — body foreground.
    pub text: Option<WColor>,
    /// `--we-role-text-muted`.
    pub muted: Option<WColor>,
    /// `--we-role-text-faint`.
    pub faint: Option<WColor>,
    /// `--we-role-surface` — base background.
    pub surface: Option<WColor>,
    /// `--we-role-surface-sunken`.
    pub sunken: Option<WColor>,
    /// `--we-role-surface-raised`.
    pub raised: Option<WColor>,
    /// `--we-role-accent`.
    pub accent: Option<WColor>,
    /// `--we-role-accent-text`.
    pub accent_text: Option<WColor>,
    /// `--we-role-accent-soft` — selection/focus fills.
    pub accent_soft: Option<WColor>,
    /// `--we-role-on-accent` — text on accent fills.
    pub on_accent: Option<WColor>,
    /// `--we-role-border`.
    pub border: Option<WColor>,
    /// `--we-role-field` — input surfaces.
    pub field: Option<WColor>,
    /// `--we-role-danger` — errors, unknown-widget boxes.
    pub danger: Option<WColor>,
}

impl Palette {
    /// Pull the roles out of a theme's token table; undeclared names stay
    /// `None`.
    pub fn of(theme: &Theme) -> Self {
        let role = |name: &str| {
            theme
                .tokens
                .get(&format!("--we-role-{name}"))
                .and_then(eval_color)
        };
        Palette {
            text: role("text"),
            muted: role("text-muted"),
            faint: role("text-faint"),
            surface: role("surface"),
            sunken: role("surface-sunken"),
            raised: role("surface-raised"),
            accent: role("accent"),
            accent_text: role("accent-text"),
            accent_soft: role("accent-soft"),
            on_accent: role("on-accent"),
            border: role("border"),
            field: role("field"),
            danger: role("danger"),
        }
    }

    /// The frame's default foreground: the role, else polarity white/black.
    pub fn fg(&self, theme: &Theme) -> WColor {
        self.text.unwrap_or(match theme.polarity {
            Polarity::Dark => WColor::WHITE,
            Polarity::Light => WColor::BLACK,
        })
    }

    /// The frame's default background: `surface`, else polarity-appropriate.
    pub fn bg(&self, theme: &Theme) -> WColor {
        self.surface.unwrap_or(match theme.polarity {
            Polarity::Dark => WColor::BLACK,
            Polarity::Light => WColor::WHITE,
        })
    }
}

/// Whether to emit truecolour. `COLORTERM=truecolor|24bit` is the de-facto
/// signal; tests and `--dump` pass `true` for deterministic `Rgb` cells.
pub fn truecolor_env() -> bool {
    match std::env::var("COLORTERM") {
        Ok(v) => matches!(v.as_str(), "truecolor" | "24bit"),
        Err(_) => false,
    }
}

/// A resolved `we_style::Color` → the terminal colour, honouring the
/// truecolor capability flag. Fully transparent reads as "no colour" and
/// answers `None`.
pub fn tui_color(c: WColor, truecolor: bool) -> Option<ratatui::style::Color> {
    if c.a <= 0.0 {
        return None;
    }
    let [r, g, b, _] = c.to_srgb8();
    Some(if truecolor {
        ratatui::style::Color::Rgb(r, g, b)
    } else {
        ratatui::style::Color::Indexed(xterm256(r, g, b))
    })
}

/// Nearest xterm-256 index by squared sRGB distance across the 6×6×6 cube
/// (16–231) and the grey ramp (232–255), plus the 16 system colours. An
/// exhaustive nearest-search — 256 candidates is nothing per frame.
pub fn xterm256(r: u8, g: u8, b: u8) -> u8 {
    let mut best = 0u8;
    let mut best_d = u32::MAX;
    for i in 0..=255u8 {
        let (pr, pg, pb) = xterm_rgb(i);
        let d = sq_dist(r, g, b, pr, pg, pb);
        if d < best_d {
            best_d = d;
            best = i;
        }
    }
    best
}

fn sq_dist(r: u8, g: u8, b: u8, pr: u8, pg: u8, pb: u8) -> u32 {
    let (r, g, b, pr, pg, pb) = (
        r as i32, g as i32, b as i32, pr as i32, pg as i32, pb as i32,
    );
    ((r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb)) as u32
}

/// The sRGB value an xterm-256 index stands for.
fn xterm_rgb(i: u8) -> (u8, u8, u8) {
    const SYSTEM: [(u8, u8, u8); 16] = [
        (0, 0, 0),
        (128, 0, 0),
        (0, 128, 0),
        (128, 128, 0),
        (0, 0, 128),
        (128, 0, 128),
        (0, 128, 128),
        (192, 192, 192),
        (128, 128, 128),
        (255, 0, 0),
        (0, 255, 0),
        (255, 255, 0),
        (0, 0, 255),
        (255, 0, 255),
        (0, 255, 255),
        (255, 255, 255),
    ];
    match i {
        0..=15 => SYSTEM[i as usize],
        16..=231 => {
            let n = i - 16;
            let v = |c: u8| if c == 0 { 0 } else { 55 + c * 40 };
            (v(n / 36), v((n % 36) / 6), v(n % 6))
        }
        _ => {
            let g = 8 + (i - 232) * 10;
            (g, g, g)
        }
    }
}
