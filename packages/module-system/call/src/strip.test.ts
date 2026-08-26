/**
 * The filmstrip's arithmetic, at the participant counts that make it interesting.
 *
 * Separate from the store's tests because the store cannot be driven through those counts without a
 * whole call behind it — which is exactly why this is a pure function.
 */
import { describe, expect, it } from 'vitest';

import { MIN_STRIP_TILE_PX, solveStrip, STRIP_MAX } from './strip';

const A = 16 / 9;
const solve = (count: number, width: number, height: number) =>
  solveStrip(count, { width, height }, { aspect: A, gap: 12 });

describe('solveStrip', () => {
  it('runs down the side of a panel wider than a tile, and underneath one that is not', () => {
    // Where the leftover room is: a 16:9 spotlight in a wider panel is limited by the height, so
    // what is spare is horizontal. Backwards, the strip takes the axis the spotlight was short of.
    expect(solve(2, 1896, 876).side).toBe(true);
    expect(solve(2, 416, 1176).side).toBe(false);
  });

  it('gives the tiles a share each while they stay worth looking at', () => {
    // The ordinary case, and it must not change: two other people on a full-screen desktop.
    const strip = solve(2, 1896, 876);
    expect(strip.scroll).toBe(false);
    expect(strip.thickness).toBe(Math.round(1896 * STRIP_MAX));
  });

  it('scrolls instead of shrinking past reading', () => {
    /*
      The case this exists for: a panel docked along an edge with ten other people in it. Divided
      between them, the strip's axis gave about thirty pixels a tile — a coloured rectangle rather
      than a person, and the strip is the only place some of them appear at all.
    */
    const wideShort = solve(10, 1576, 276);
    expect(wideShort.scroll).toBe(true);
    expect(wideShort.tile).toBe(Math.round(MIN_STRIP_TILE_PX / A));

    const tallNarrow = solve(10, 416, 876);
    expect(tallNarrow.scroll).toBe(true);
    expect(tallNarrow.tile).toBe(MIN_STRIP_TILE_PX);
  });

  it('never lets the strip take more than its share of the stage', () => {
    // Uncapped, one other participant is nearly half the stage — the arrangement spotlight exists to
    // get away from. Checked across counts rather than at the one that motivated it.
    for (const count of [1, 2, 3, 5, 8, 12]) {
      for (const [w, h] of [
        [1896, 876],
        [1576, 276],
        [416, 1176],
        [416, 876],
      ]) {
        const strip = solve(count, w, h);
        const across = strip.side ? w : h;
        expect(strip.thickness).toBeLessThanOrEqual(Math.round(across * STRIP_MAX) + 1);
      }
    }
  });

  it('lets the cap win when the panel is too small for both', () => {
    // A cap that forces the tiles below their minimum still applies: the picture somebody asked to
    // see should not be the one that pays for a panel with no room in it.
    const strip = solve(6, 300, 200);
    expect(strip.thickness).toBeLessThanOrEqual(Math.round(300 * STRIP_MAX) + 1);
  });

  it('answers something usable before anything has been measured', () => {
    const strip = solve(3, 0, 0);
    expect(strip.tile).toBeGreaterThanOrEqual(0);
    expect(strip.thickness).toBeGreaterThanOrEqual(0);
  });
});
