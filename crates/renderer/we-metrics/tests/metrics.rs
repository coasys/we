//! `tier_for_width` at the breakpoint edges and the cell-snapping rule —
//! the two places an off-by-one hides. Expected tiers are the TS rule's:
//! `@container (min-width: <bp>)` matches at exactly the breakpoint
//! (`design-system/utils/src/surface.ts`'s `tierQuery`), so a width equal
//! to a breakpoint is the higher tier.

use we_metrics::{tier_for_width, Breakpoints, CellProjection, SizeTier};

/// Every breakpoint edge on both sides and exactly at it.
#[test]
fn threshold_edges() {
    let bp = Breakpoints::default();
    // The token breakpoints — `1-tokens/src/breakpoint.ts:46-48`.
    assert_eq!(
        (bp.sm, bp.md, bp.lg),
        (640.0, 900.0, 1200.0),
        "token breakpoints"
    );

    // Below every edge, the lower tier.
    assert_eq!(tier_for_width(0.0, &bp), SizeTier::Base);
    assert_eq!(tier_for_width(639.5, &bp), SizeTier::Base);
    assert_eq!(tier_for_width(899.5, &bp), SizeTier::Sm);
    assert_eq!(tier_for_width(1199.5, &bp), SizeTier::Md);

    // Exactly at an edge, the higher tier.
    assert_eq!(tier_for_width(640.0, &bp), SizeTier::Sm);
    assert_eq!(tier_for_width(900.0, &bp), SizeTier::Md);
    assert_eq!(tier_for_width(1200.0, &bp), SizeTier::Lg);

    // Just past every edge, still the higher tier.
    assert_eq!(tier_for_width(640.5, &bp), SizeTier::Sm);
    assert_eq!(tier_for_width(900.5, &bp), SizeTier::Md);
    assert_eq!(tier_for_width(1200.5, &bp), SizeTier::Lg);

    // Well inside each band.
    assert_eq!(tier_for_width(500.0, &bp), SizeTier::Base);
    assert_eq!(tier_for_width(700.0, &bp), SizeTier::Sm);
    assert_eq!(tier_for_width(1000.0, &bp), SizeTier::Md);
    assert_eq!(tier_for_width(1500.0, &bp), SizeTier::Lg);

    // The moved type's compat path uses the same default table.
    assert_eq!(SizeTier::for_width(640.0), SizeTier::Sm);
}

/// `col(x) = floor(x / cell_w + 0.5)` — round half up, each edge on its own.
#[test]
fn cell_snapping_rounds_half_up() {
    let p = CellProjection {
        cell_w: 8.0,
        cell_h: 16.0,
    };
    assert_eq!(p.viewport(80, 24), (640.0, 384.0));

    // On a boundary is that boundary.
    assert_eq!(p.col(0.0), 0);
    assert_eq!(p.col(8.0), 1);
    assert_eq!(p.row(16.0), 1);

    // Under half a cell snaps down; exactly half snaps up.
    assert_eq!(p.col(3.99), 0);
    assert_eq!(p.col(4.0), 1);
    assert_eq!(p.row(7.99), 0);
    assert_eq!(p.row(8.0), 1);

    // The example's edges.
    assert_eq!(p.col(17.0), 2);
    assert_eq!(p.col(161.8333), 20);
    assert_eq!(p.col(623.0), 78);
    assert_eq!(p.row(50.0), 3);

    // A terminal Measure's fixed advance: px extent of a cell run.
    assert_eq!(p.text_extent(3, 1), (24.0, 16.0));
}
