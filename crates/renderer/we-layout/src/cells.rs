//! The projection of a px [`Layout`] onto a terminal's cell grid — the
//! one place a `Layout` and a [`CellProjection`] meet (the projection
//! itself is `we-metrics`'s; this file only walks the rects).
//!
//! Each edge snaps on its own — [`CellProjection::col`],
//! [`CellProjection::row`] — and a rect is `[col(left), col(right))` ×
//! `[row(top), row(bottom))`. Siblings that share a px edge share a cell
//! boundary, so the projection invents no overlap and no gap the layout
//! did not have; a parent's snapped span is the sum of what its padding,
//! borders, children and gaps snap to. A box narrower than half a cell
//! can come out zero wide or tall — its [`CellRect`] says so and the
//! painter does not draw it.
use std::collections::HashMap;

use we_metrics::{CellProjection, CellRect};
use we_template::NodeId;

use crate::Layout;

/// Snap every laid-out node's border-box rect to `proj`'s grid.
pub fn project(layout: &Layout, proj: &CellProjection) -> HashMap<NodeId, CellRect> {
    layout
        .rects
        .iter()
        .map(|(id, r)| {
            let (c0, c1) = (proj.col(r.min.x), proj.col(r.max.x));
            let (r0, r1) = (proj.row(r.min.y), proj.row(r.max.y));
            (
                id.clone(),
                CellRect {
                    col: c0,
                    row: r0,
                    cols: u16::try_from(c1.saturating_sub(c0)).unwrap_or(u16::MAX),
                    rows: u16::try_from(r1.saturating_sub(r0)).unwrap_or(u16::MAX),
                },
            )
        })
        .collect()
}
