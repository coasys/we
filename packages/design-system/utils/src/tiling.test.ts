import { describe, expect, it } from 'vitest';

import { parseAspect, solveTiling } from './tiling';

const video = { aspect: 16 / 9 };
const solve = (count: number, width: number, height: number, extra = {}) =>
  solveTiling(count, { width, height }, { ...video, ...extra });

describe('solveTiling', () => {
  it('stacks vertically in a tall box and horizontally in a wide one', () => {
    // The whole point. Two people in a square panel want one column; drag it wide and they want
    // two. A column count derived from the participant count alone — which is what the call stage
    // did — answers 2 in both cases, and letterboxes badly in the first.
    expect(solve(2, 600, 600)).toEqual({ columns: 1, rows: 2 });
    expect(solve(2, 1800, 600)).toEqual({ columns: 2, rows: 1 });
  });

  it('picks a square-ish grid for four in a square box, and one row when it is wide enough', () => {
    expect(solve(4, 800, 800)).toEqual({ columns: 2, rows: 2 });
    expect(solve(4, 3200, 500)).toEqual({ columns: 4, rows: 1 });
  });

  it('stacks a tall narrow panel into a single column', () => {
    // A 440x900 side dock: three 16:9 tiles across it would be thumbnails.
    expect(solve(3, 440, 900)).toEqual({ columns: 1, rows: 3 });
  });

  it('never leaves a tile smaller than some other arrangement would', () => {
    // The property that matters, checked exhaustively rather than case by case.
    const sizeAt = (count: number, columns: number, w: number, h: number) => {
      const rows = Math.ceil(count / columns);
      return Math.min(w / columns, (h / rows) * (16 / 9));
    };
    for (const count of [2, 3, 5, 6, 7, 9, 12]) {
      for (const [w, h] of [
        [1600, 900],
        [900, 1600],
        [1000, 1000],
        [2400, 400],
        [400, 2400],
      ]) {
        const { columns } = solve(count, w, h);
        const chosen = sizeAt(count, columns, w, h);
        for (let c = 1; c <= count; c++) {
          expect(chosen).toBeGreaterThanOrEqual(sizeAt(count, c, w, h) - 1e-9);
        }
      }
    }
  });

  it('leaves the tiles fitting inside the box, gaps included', () => {
    // The invariant that makes "one participant never scrolls" a property of the arrangement rather
    // than something to test for. Gaps are part of it: solved without them, the tiles come out a
    // little too big and the last row is clipped.
    for (const count of [1, 2, 3, 4, 5, 8, 11]) {
      for (const gap of [0, 12, 48]) {
        for (const [w, h] of [
          [1600, 900],
          [900, 1600],
          [1000, 1000],
          [440, 900],
        ]) {
          const { columns, rows } = solve(count, w, h, { gap });
          const tileW = Math.min((w - (columns - 1) * gap) / columns, ((h - (rows - 1) * gap) / rows) * (16 / 9));
          const tileH = tileW / (16 / 9);
          expect(columns * tileW + (columns - 1) * gap).toBeLessThanOrEqual(w + 1e-9);
          expect(rows * tileH + (rows - 1) * gap).toBeLessThanOrEqual(h + 1e-9);
        }
      }
    }
  });

  it('holds the current arrangement until a challenger is meaningfully better', () => {
    // Dragging a panel across a threshold otherwise flickers between two arrangements — which are,
    // exactly there, almost equally good.
    const atThreshold = { width: 1067, height: 600 };
    const free = solveTiling(2, atThreshold, video);
    const held = solveTiling(2, atThreshold, { ...video, current: { columns: 1, rows: 2 } });
    expect(held).toEqual({ columns: 1, rows: 2 });
    // …but a decisive change still switches.
    expect(solveTiling(2, { width: 2400, height: 400 }, { ...video, current: { columns: 1, rows: 2 } })).toEqual({
      columns: 2,
      rows: 1,
    });
    expect(free.columns).toBeGreaterThanOrEqual(1);
  });

  it('answers something usable before anything has been measured', () => {
    expect(solve(4, 0, 0)).toEqual({ columns: 4, rows: 1 });
    expect(solveTiling(4, { width: 0, height: 0 }, { ...video, current: { columns: 2, rows: 2 } })).toEqual({
      columns: 2,
      rows: 2,
    });
    expect(solve(1, 800, 600)).toEqual({ columns: 1, rows: 1 });
    expect(solve(0, 800, 600)).toEqual({ columns: 1, rows: 1 });
  });
});

describe('parseAspect', () => {
  it('takes the CSS spellings', () => {
    expect(parseAspect('16 / 9')).toBeCloseTo(16 / 9);
    expect(parseAspect('16/9')).toBeCloseTo(16 / 9);
    expect(parseAspect('1.5')).toBeCloseTo(1.5);
    expect(parseAspect(4 / 3)).toBeCloseTo(4 / 3);
  });

  it('falls back rather than producing NaN tracks', () => {
    expect(parseAspect(undefined)).toBeCloseTo(16 / 9);
    expect(parseAspect('nonsense')).toBeCloseTo(16 / 9);
    expect(parseAspect('16 / 0')).toBeCloseTo(16 / 9);
  });
});
