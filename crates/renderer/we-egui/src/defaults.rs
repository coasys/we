//! The egui-side style plumbing — the frame's `ViewportCx` + base-family
//! stash on the egui `Context`. Style resolution itself (`style_of`,
//! `StyleCx`, the per-type default bags) moved to `we_layout::defaults`;
//! re-exported so widget code keeps calling `crate::defaults::*`.
use std::sync::Arc;

pub(crate) use we_layout::defaults::unit_metrics;
pub use we_layout::defaults::{effective, style_of, StyleCx};

/// The frame-time unit context widgets get outside `style_of`: the viewport
/// (for `vw`/`radius %`), the tier's container width, and the theme's unit
/// metrics — `metrics.font_px` is the `em`/`ch`/`ex`/`lh` basis and the
/// size unstyled text falls back to, `metrics.root_px` the `rem` basis
/// (`--we-font-size-300` feeds both on the recorded themes: 16px most,
/// 13 cyberpunk). `PaintCx`/`MeasureCx` are frozen, so `paint()`/`layout()`
/// stash it on the egui `Context` once a frame — numbers only, no state.
#[derive(Clone, Copy)]
#[allow(dead_code)]
pub(crate) struct ViewportCx {
    pub viewport: we_style::Size,
    pub container_width: f32,
    pub metrics: we_metrics::UnitMetrics,
}

/// The unthemed answer before the first `layout`/`paint` — the default
/// unit metrics, so an early `view_of` never reads a zero font metric.
impl Default for ViewportCx {
    fn default() -> Self {
        Self {
            viewport: we_style::Size::new(0.0, 0.0),
            container_width: 0.0,
            metrics: we_metrics::UnitMetrics::default(),
        }
    }
}

const VIEW_KEY: &str = "we-egui::viewport";
const FAMILY_KEY: &str = "we-egui::base-family";
const THEME_KEY: &str = "we-egui::theme-id";
const TOKENS_KEY: &str = "we-egui::tokens";

/// Stash the frame's style context on the ctx (called by `layout`/`paint`).
/// The token table rides along — `PaintCx`/`MeasureCx` are frozen, so a
/// widget that must resolve `var(--we-*)` inside a prop (an avatar's
/// `ringColor`, the generated fill's ramp) reads it back with `tokens_of`.
pub(crate) fn store_view(ctx: &egui::Context, scx: &StyleCx) {
    ctx.data_mut(|d| {
        d.insert_temp(
            egui::Id::unique(VIEW_KEY),
            (
                scx.viewport.width,
                scx.viewport.height,
                scx.container_width,
                unit_metrics(scx),
            ),
        );
        // Shared, and copied in only when the table changed: every token a
        // widget reads at paint goes through `tokens_of`, and handing out a
        // copy of a theme's whole table per read cost a fifth of paint.
        let key = egui::Id::unique(TOKENS_KEY);
        let held = d
            .get_temp::<Arc<we_style::TokenTable>>(key)
            .is_some_and(|t| t.fingerprint() == scx.tokens.fingerprint());
        if !held {
            d.insert_temp(key, Arc::new(scx.tokens.clone()));
        }
        // The theme's `--we-font-family` — the family body text inherits on
        // the web side (`font-family` on the app host). A separate key so
        // `ViewportCx` stays `Copy`; an explicit `font-family` on the node
        // beats it. Temp data outlives the frame, so a view without one
        // must remove the last view's, or a theme swap keeps its face.
        let family = egui::Id::unique(FAMILY_KEY);
        match scx.tokens.get("--we-font-family") {
            Some(f) => {
                d.insert_temp(family, Arc::<str>::from(f));
            }
            None => d.remove::<Arc<str>>(family),
        }
        // The theme id for part-level rules that address parts the element
        // does not expose as nodes (the switch's track/thumb) — the
        // `data-we-theme` selector read at paint time. Removed for a
        // theme-less view, as above.
        let theme = egui::Id::unique(THEME_KEY);
        if scx.theme.is_empty() {
            d.remove::<Arc<str>>(theme);
        } else {
            d.insert_temp(theme, Arc::<str>::from(scx.theme));
        }
    });
}

/// The stashed token table — `None` before the first `layout`/`paint`.
pub(crate) fn tokens_of(ctx: &egui::Context) -> Option<Arc<we_style::TokenTable>> {
    ctx.data_mut(|d| d.get_temp::<Arc<we_style::TokenTable>>(egui::Id::unique(TOKENS_KEY)))
}

/// The stashed view — the unthemed defaults before the first
/// `layout`/`paint`.
pub(crate) fn view_of(ctx: &egui::Context) -> ViewportCx {
    ctx.data_mut(|d| {
        d.get_temp::<(f32, f32, f32, we_metrics::UnitMetrics)>(egui::Id::unique(VIEW_KEY))
    })
    .map(|(w, h, c, metrics)| ViewportCx {
        viewport: we_style::Size::new(w, h),
        container_width: c,
        metrics,
    })
    .unwrap_or_default()
}

/// The stashed base-family stack — `None` before the first frame and on a
/// theme that records no `--we-font-family`.
pub(crate) fn base_family_of(ctx: &egui::Context) -> Option<Arc<str>> {
    ctx.data_mut(|d| d.get_temp::<Arc<str>>(egui::Id::unique(FAMILY_KEY)))
}

/// The stashed theme id — `None` before the first frame and on a theme-
/// less context. Widgets that paint parts the node tree cannot address
/// read it to apply the theme's part rules (`theme_css`).
pub(crate) fn theme_of(ctx: &egui::Context) -> Option<Arc<str>> {
    ctx.data_mut(|d| d.get_temp::<Arc<str>>(egui::Id::unique(THEME_KEY)))
}

/// What the theme's stylesheet says about a part `node` does not expose
/// as a node (the switch's `thumb`/`track`) — the same matcher
/// [`style_of`] uses, asked at paint time from the stashed theme, tokens
/// and viewport. `None` before the first frame, on a theme-less view, or
/// where no rule matches.
pub(crate) fn part_patch(
    ctx: &egui::Context,
    node: &we_template::ResolvedNode,
    part: &str,
) -> Option<we_style::StylePatch> {
    let theme = theme_of(ctx)?;
    let tokens = tokens_of(ctx).unwrap_or_default();
    let view = view_of(ctx);
    let scope = indexmap::IndexMap::new();
    let scx = StyleCx {
        tokens: &tokens,
        theme: &theme,
        viewport: view.viewport,
        container_width: view.container_width,
        metrics: view.metrics,
        scope: &scope,
    };
    we_layout::theme_css::part_style(&scx, node, part, None)
}

const MOTION_KEY: &str = "we-egui::reduced-motion";

/// Ask for less motion: theme animations hold still (the resting frame)
/// while it is set. A host wires it to the OS setting or the agent's
/// `displayPreferences.motion`; nothing sets it by default.
pub fn set_reduced_motion(ctx: &egui::Context, reduced: bool) {
    ctx.data_mut(|d| d.insert_temp(egui::Id::unique(MOTION_KEY), reduced));
}

/// Whether [`set_reduced_motion`] asked for less motion.
pub(crate) fn reduced_motion(ctx: &egui::Context) -> bool {
    ctx.data_mut(|d| d.get_temp::<bool>(egui::Id::unique(MOTION_KEY)))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(value: &str) -> we_style::TokenTable {
        we_style::TokenTable::new(
            [(Arc::from("--we-role-text"), Arc::from(value))]
                .into_iter()
                .collect(),
        )
    }

    /// Every token a widget paints with is read through `tokens_of`; a
    /// read hands out the one stashed table, and a frame that stashes an
    /// unchanged table keeps it rather than copying it in again.
    #[test]
    fn the_stashed_table_is_shared_and_replaced_only_when_it_changes() {
        let ctx = egui::Context::default();
        let a = table("red");
        store_view(
            &ctx,
            &StyleCx {
                tokens: &a,
                ..StyleCx::empty()
            },
        );
        let first = tokens_of(&ctx).unwrap();
        assert!(
            Arc::ptr_eq(&first, &tokens_of(&ctx).unwrap()),
            "a read shares it"
        );

        let same = table("red");
        store_view(
            &ctx,
            &StyleCx {
                tokens: &same,
                ..StyleCx::empty()
            },
        );
        assert!(
            Arc::ptr_eq(&first, &tokens_of(&ctx).unwrap()),
            "unchanged: kept"
        );

        let other = table("blue");
        store_view(
            &ctx,
            &StyleCx {
                tokens: &other,
                ..StyleCx::empty()
            },
        );
        assert_eq!(tokens_of(&ctx).unwrap().get("--we-role-text"), Some("blue"));
    }
}
