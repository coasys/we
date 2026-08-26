/**
 * The filmstrip beside a spotlight: how long each tile is, how thick the band is, and whether it has
 * to scroll to keep them worth looking at.
 *
 * A pure function, and separate from the store for the reason `solveTiling` is separate from `Grid`:
 * it is the only part of the spotlight with arithmetic in it, and the store cannot be driven through
 * the participant counts that make it interesting without a whole call behind it.
 */

/** How small a strip tile may get before the strip scrolls instead, as a width in pixels. */
export const MIN_STRIP_TILE_PX = 120;

/**
 * The most of the stage a strip may take, as a fraction.
 *
 * A cap, not a size. The strip's job is to be glanceable and the spotlight's is to be watched, and
 * with one other participant an uncapped strip is nearly half the stage — the arrangement spotlight
 * exists to get away from.
 */
export const STRIP_MAX = 0.25;

export interface StripLayout {
  /** True when the strip runs down the side; false when it runs underneath. */
  side: boolean;
  /** Tiles in the strip. */
  count: number;
  /** The strip cannot fit them at a readable size, so it scrolls past them instead. */
  scroll: boolean;
  /** Each tile's length along the axis the strip runs, in px. */
  tile: number;
  /** The band's thickness across that axis, in px. */
  thickness: number;
}

/**
 * Which edge the strip runs along.
 *
 * Where the leftover room is. A 16:9 spotlight in a panel wider than 16:9 is limited by the height,
 * so what is spare is horizontal and a strip down the side costs nothing that was being used; in a
 * taller panel the spare room is underneath. Backwards, it takes the axis the spotlight was already
 * short of.
 */
export const stripRunsDownSide = (box: { width: number; height: number }, aspect: number): boolean =>
  box.height > 0 && box.width / box.height > aspect;

/**
 * Solve the strip.
 *
 * Two modes, decided by one comparison. Divide the axis the strip runs along between its tiles: if
 * that leaves them larger than {@link MIN_STRIP_TILE_PX} they take a share each and nothing scrolls,
 * which is the ordinary case. If it does not — a panel docked along an edge with ten other people in
 * it, which reached about thirty pixels a tile — they hold their minimum and the strip scrolls.
 *
 * Scrolling rather than dropping the overflow, because the strip is the only place some participants
 * appear at all and a tile you cannot reach is worse than one you have to scroll to.
 *
 * The thickness follows from the tile: whatever makes it 16:9 across. {@link STRIP_MAX} then caps
 * it, and a cap that forces the tiles below their minimum still wins — the panel is too small for
 * both, and the picture somebody asked to see should not be the one that pays.
 */
export function solveStrip(
  count: number,
  box: { width: number; height: number },
  options: { aspect: number; gap: number },
): StripLayout {
  const { aspect, gap } = options;
  const n = Math.max(1, count);
  const side = stripRunsDownSide(box, aspect);

  const along = side ? box.height : box.width;
  const minAlong = side ? MIN_STRIP_TILE_PX / aspect : MIN_STRIP_TILE_PX;
  const share = (along - (n - 1) * gap) / n;

  const scroll = share < minAlong;
  let tile = scroll ? minAlong : share;
  let thickness = side ? tile * aspect : tile / aspect;

  const cap = (side ? box.width : box.height) * STRIP_MAX;
  if (thickness > cap) {
    thickness = cap;
    tile = side ? cap / aspect : cap * aspect;
  }

  return {
    side,
    count: n,
    scroll,
    tile: Math.max(0, Math.round(tile)),
    thickness: Math.max(0, Math.round(thickness)),
  };
}
