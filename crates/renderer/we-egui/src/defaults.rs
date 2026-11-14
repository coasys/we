//! The egui-side style plumbing — the frame's `ViewportCx` stash on the egui
//! `Context`. Style resolution itself (`style_of`, `StyleCx`, the per-type
//! default bags) moved to `we_layout::defaults`; re-exported so widget code
//! keeps calling `crate::defaults::*`.
pub use we_layout::defaults::{style_of, StyleCx};
pub(crate) use we_layout::defaults::{FONT_PX, ROOT_PX};

/// The frame-time unit context widgets get outside `style_of`: the viewport
/// (for `vw`/`radius %`) and the tier's container width. `PaintCx`/`MeasureCx`
/// are frozen, so `paint()`/`layout()` stash it on the egui `Context` once a
/// frame — two numbers, no state.
#[derive(Clone, Copy, Default)]
#[allow(dead_code)]
pub(crate) struct ViewportCx {
    pub viewport: we_style::Size,
    pub container_width: f32,
}

const VIEW_KEY: &str = "we-egui::viewport";

/// Stash the frame's style context on the ctx (called by `layout`/`paint`).
pub(crate) fn store_view(ctx: &egui::Context, scx: &StyleCx) {
    ctx.data_mut(|d| {
        d.insert_temp(
            egui::Id::unique(VIEW_KEY),
            (scx.viewport.width, scx.viewport.height, scx.container_width),
        )
    });
}

/// The stashed view — an empty context before the first `layout`/`paint`.
pub(crate) fn view_of(ctx: &egui::Context) -> ViewportCx {
    ctx.data_mut(|d| d.get_temp::<(f32, f32, f32)>(egui::Id::unique(VIEW_KEY)))
        .map(|(w, h, c)| ViewportCx {
            viewport: we_style::Size::new(w, h),
            container_width: c,
        })
        .unwrap_or_default()
}
