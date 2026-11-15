//! `we-metrics`: the numbers every frontend resolves the same way.
//!
//! A leaf crate — no dependencies, no I/O, no egui — sitting below
//! `we-style`, `we-template` and `we-layout`, so the surface table in
//! `we-template` and the layout in `we-layout` share one tier rule without
//! a crate cycle.
//!
//! - [`UnitMetrics`] — what `rem`, `em`, `lh`, `ch` and `ex` resolve
//!   against: the font metrics `we-layout`'s `FONT_PX`/`ROOT_PX` constants
//!   and `we-style`'s fixed `0.5`/`1.4` ratios used to bake in.
//! - [`SizeTier`], [`Breakpoints`], [`tier_for_width`] — the responsive
//!   tier (`base`/`sm`/`md`/`lg`, the `TIERS` of
//!   `1-tokens/src/breakpoint.ts`). The responsive tier, not the
//!   capability tier — that one keeps the name `Tier`.
//! - [`CellProjection`], [`CellRect`] — a terminal's projection of the px
//!   layout onto character cells: a per-axis cell size and one snapping
//!   rule.
#![forbid(unsafe_code)]

/// What `rem`, `em`, `lh`, `ch` and `ex` resolve against — the font
/// metrics `we-layout/src/defaults.rs`'s `FONT_PX`/`ROOT_PX` constants and
/// `we-style/src/style.rs`'s `0.5`/`1.4` ratios used to bake in. One value
/// for every frontend: a theme that moves the base font size moves every
/// derived length with it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UnitMetrics {
    /// `1rem` — the recorded scale's root step (16px on most themes).
    pub root_px: f32,
    /// `1em` — the base font size unstyled text inherits.
    pub font_px: f32,
    /// `1ch` as a fraction of `font_px` (the `0`-advance approximation).
    pub ch_em: f32,
    /// `1ex` as a fraction of `font_px`.
    pub ex_em: f32,
    /// `1lh` as a fraction of `font_px` — the default line height.
    pub lh_em: f32,
}

impl Default for UnitMetrics {
    /// Today's numbers, unchanged: `root` 16, `font` 14, `ch`/`ex` half an
    /// em, `lh` 1.4em.
    fn default() -> Self {
        Self {
            root_px: 16.0,
            font_px: 14.0,
            ch_em: 0.5,
            ex_em: 0.5,
            lh_em: 1.4,
        }
    }
}

/// The responsive size tier — `base`/`sm`/`md`/`lg`, ordered by
/// precedence: a tier applies when the width clears its breakpoint (the
/// `TIERS` of `1-tokens/src/breakpoint.ts`). `Ord` is precedence order:
/// `Lg` covers every width `Sm` does. Renamed from `we-style`'s `Tier` so
/// it cannot be confused with the capability tier.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SizeTier {
    Base,
    Sm,
    Md,
    Lg,
}

impl SizeTier {
    /// `sm`–`lg` ascending — `TIERS.slice(1)`.
    pub const UPPER: [SizeTier; 3] = [SizeTier::Sm, SizeTier::Md, SizeTier::Lg];

    /// The tier a content-box width resolves to under the token
    /// breakpoints — [`tier_for_width`] against [`Breakpoints::default`].
    pub fn for_width(px: f32) -> SizeTier {
        tier_for_width(px, &Breakpoints::default())
    }

    /// The prop key a tier's bag lives under — `TIER_PROP_KEYS`
    /// (`design-system/utils/src/index.ts`). `base` has none: the
    /// unqualified props are its bag.
    pub fn prop_key(self) -> Option<&'static str> {
        match self {
            SizeTier::Base => None,
            SizeTier::Sm => Some("smUpProps"),
            SizeTier::Md => Some("mdUpProps"),
            SizeTier::Lg => Some("lgUpProps"),
        }
    }
}

/// The widths at which a layout is allowed to change its mind —
/// `breakpoint` in `1-tokens/src/breakpoint.ts`. `base` is not in the
/// table: it is the unqualified value, so it has no threshold.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Breakpoints {
    pub sm: f32,
    pub md: f32,
    pub lg: f32,
}

impl Default for Breakpoints {
    /// The token breakpoints — 640, 900, 1200
    /// (`1-tokens/src/breakpoint.ts:46-48`). Baked literals, the same ones
    /// the generated container queries carry: a deployment cannot move
    /// them, because portable templates are authored against what
    /// `mdUpProps` means.
    fn default() -> Self {
        Self {
            sm: 640.0,
            md: 900.0,
            lg: 1200.0,
        }
    }
}

/// `base` | `sm` | `md` | `lg` from a content-box width in px — the last
/// breakpoint the width clears, so a width equal to a breakpoint is the
/// higher tier (the generated queries are `min-width:`). Every frontend
/// and the surface table call this; none decides tiers itself.
pub fn tier_for_width(width_px: f32, bp: &Breakpoints) -> SizeTier {
    if width_px >= bp.lg {
        SizeTier::Lg
    } else if width_px >= bp.md {
        SizeTier::Md
    } else if width_px >= bp.sm {
        SizeTier::Sm
    } else {
        SizeTier::Base
    }
}

/// A terminal's cell size in logical px, per axis — the grid a px
/// `we_layout::Layout` projects onto. `8 × 16` is the default cell.
///
/// Precondition: both sizes are finite and positive. A zero, negative or
/// NaN size is a caller bug — `col`/`row` still answer (float-to-int
/// saturates, NaN becomes 0), and `we_layout::cells::project` clamps the
/// reversed spans a bad size produces, but the grid itself means nothing.
#[derive(Clone, Copy, Debug)]
pub struct CellProjection {
    pub cell_w: f32,
    pub cell_h: f32,
}

impl CellProjection {
    /// Viewport in px for a terminal of `cols`×`rows`.
    pub fn viewport(&self, cols: u16, rows: u16) -> (f32, f32) {
        (cols as f32 * self.cell_w, rows as f32 * self.cell_h)
    }

    /// Snap one px edge to a cell column: round half up
    /// (`floor(x / cell_w + 0.5)`). Each edge snaps on its own, so two
    /// siblings sharing a px edge share a column.
    pub fn col(&self, x: f32) -> i32 {
        (x / self.cell_w + 0.5).floor() as i32
    }

    /// Snap one px edge to a cell row — [`col`](Self::col) on the y axis.
    pub fn row(&self, y: f32) -> i32 {
        (y / self.cell_h + 0.5).floor() as i32
    }

    /// The px extent of a text run `cols` cells wide and `rows` high — a
    /// terminal `Measure`'s fixed-advance answer.
    pub fn text_extent(&self, cols: usize, rows: usize) -> (f32, f32) {
        (cols as f32 * self.cell_w, rows as f32 * self.cell_h)
    }
}

/// A rect in terminal cells — the projection of a px box:
/// `[col, col + cols)` × `[row, row + rows)`. Zero `cols`/`rows` is a box
/// under half a cell; the painter does not draw it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellRect {
    pub col: i32,
    pub row: i32,
    pub cols: u16,
    pub rows: u16,
}
