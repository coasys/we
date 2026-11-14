//! The egui-side style plumbing — the frame's `ViewportCx` + base-family
//! stash on the egui `Context`. Style resolution itself (`style_of`,
//! `StyleCx`, the per-type default bags) moved to `we_layout::defaults`;
//! re-exported so widget code keeps calling `crate::defaults::*`.
use std::sync::Arc;

pub(crate) use we_layout::defaults::{font_px, root_px, FONT_PX, ROOT_PX};
pub use we_layout::defaults::{style_of, StyleCx};

/// The frame-time unit context widgets get outside `style_of`: the viewport
/// (for `vw`/`radius %`), the tier's container width, and the theme's font
/// metrics — `font_px` is the `em`/`ch`/`ex`/`lh` basis and the size
/// unstyled text falls back to, `root_px` the `rem` basis
/// (`--we-font-size-300` feeds both on the recorded themes: 16px most,
/// 13 cyberpunk). `PaintCx`/`MeasureCx` are frozen, so `paint()`/`layout()`
/// stash it on the egui `Context` once a frame — numbers only, no state.
#[derive(Clone, Copy)]
#[allow(dead_code)]
pub(crate) struct ViewportCx {
    pub viewport: we_style::Size,
    pub container_width: f32,
    pub font_px: f32,
    pub root_px: f32,
}

/// The unthemed answer before the first `layout`/`paint` — WE's body
/// defaults, so an early `view_of` never reads a zero font metric.
impl Default for ViewportCx {
    fn default() -> Self {
        Self {
            viewport: we_style::Size::new(0.0, 0.0),
            container_width: 0.0,
            font_px: FONT_PX,
            root_px: ROOT_PX,
        }
    }
}

const VIEW_KEY: &str = "we-egui::viewport";
const FAMILY_KEY: &str = "we-egui::base-family";

/// Stash the frame's style context on the ctx (called by `layout`/`paint`).
pub(crate) fn store_view(ctx: &egui::Context, scx: &StyleCx) {
    ctx.data_mut(|d| {
        d.insert_temp(
            egui::Id::unique(VIEW_KEY),
            (
                scx.viewport.width,
                scx.viewport.height,
                scx.container_width,
                font_px(scx),
                root_px(scx),
            ),
        );
        // The theme's `--we-font-family` — the family body text inherits on
        // the web side (`font-family` on the app host). A separate key so
        // `ViewportCx` stays `Copy`; an explicit `font-family` on the node
        // beats it. `insert_temp` clears each frame, so a theme swap can
        // only remove the family by not writing it — correct by frame.
        if let Some(f) = scx.tokens.get("--we-font-family") {
            d.insert_temp(egui::Id::unique(FAMILY_KEY), Arc::<str>::from(f));
        }
    });
}

/// The stashed view — the unthemed defaults before the first
/// `layout`/`paint`.
pub(crate) fn view_of(ctx: &egui::Context) -> ViewportCx {
    ctx.data_mut(|d| d.get_temp::<(f32, f32, f32, f32, f32)>(egui::Id::unique(VIEW_KEY)))
        .map(|(w, h, c, fp, rp)| ViewportCx {
            viewport: we_style::Size::new(w, h),
            container_width: c,
            font_px: fp,
            root_px: rp,
        })
        .unwrap_or_default()
}

/// The stashed base-family stack — `None` before the first frame and on a
/// theme that records no `--we-font-family`.
pub(crate) fn base_family_of(ctx: &egui::Context) -> Option<Arc<str>> {
    ctx.data_mut(|d| d.get_temp::<Arc<str>>(egui::Id::unique(FAMILY_KEY)))
}
