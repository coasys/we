/**
 * A card's placement as plain rules: which row a write lands on, the baseline an undo records, and
 * when a replay still finds what it left.
 */
import { PLACEMENT_UNSET } from '@we/graph-expanders';
import { describe, expect, it } from 'vitest';

import {
  cardStyleValue,
  colorValue,
  drawnAmong,
  placementFieldsOf,
  sameSpot,
  sameStored,
  spotOf,
  stillHolds,
  styleBaseline,
} from '../src/shared/canvas/placements';

describe('drawnAmong', () => {
  it('takes the row the canvas draws, and the others at its tier as duplicates', () => {
    const rows = [
      { id: 'old', node: 'n', updatedAt: 1 },
      { id: 'new', node: 'n', updatedAt: 5 },
      { id: 'wide', node: 'n', tier: 'lg', updatedAt: 9 },
      { id: 'other', node: 'm', updatedAt: 9 },
    ];
    expect(drawnAmong(rows, 'n')).toEqual({ drawn: rows[1], duplicates: ['old'] });
    expect(drawnAmong(rows, 'nobody')).toEqual({ duplicates: [] });
  });
});

describe('spots', () => {
  it('reads a missing coordinate as 0, and forgives under a pixel', () => {
    expect(spotOf({ x: '12' })).toEqual({ x: 12, y: 0 });
    expect(sameSpot({ x: 400.00000000000006, y: 1 }, { x: 400, y: 1.4 })).toBe(true);
    expect(sameSpot({ x: 401, y: 1 }, { x: 400, y: 1 })).toBe(false);
  });
});

describe('the baseline an undo puts back', () => {
  it('records every field of the patch, an unset one as what reads as absent', () => {
    expect(styleBaseline({ width: 300, color: '' }, { width: 10, color: 'red', height: 5, cardShape: 'pill' })).toEqual(
      {
        width: 300,
        color: PLACEMENT_UNSET,
        height: 0,
        cardShape: PLACEMENT_UNSET,
      },
    );
  });

  it('matches a row whose field is missing against "it was unset"', () => {
    expect(sameStored(undefined, PLACEMENT_UNSET)).toBe(true);
    expect(sameStored('', 0)).toBe(true);
    expect(sameStored(300.4, 300)).toBe(true);
    expect(sameStored('red', 'blue')).toBe(false);
    expect(stillHolds({ width: 300, x: 10 }, { width: 300, x: 10 })).toBe(true);
    expect(stillHolds({ width: 300, x: 50 }, { width: 300, x: 10 })).toBe(false);
  });

  it('puts a card back with what describes it, not what identifies the row', () => {
    expect(
      placementFieldsOf({
        id: 'p',
        node: 'n',
        author: 'a',
        createdAt: 1,
        updatedAt: 2,
        timestamp: 3,
        x: 1,
        color: 'red',
      }),
    ).toEqual({ x: 1, color: 'red' });
  });
});

describe('presentation values', () => {
  it('reads an event or a value, and an empty one as the clear', () => {
    expect(cardStyleValue('color', { detail: 'red' })).toBe('red');
    expect(cardStyleValue('width', 120)).toBe(120);
    expect(cardStyleValue('color', '')).toBe(PLACEMENT_UNSET);
    expect(cardStyleValue('title', 'x')).toBeUndefined();
    expect(colorValue({ detail: '' })).toBe(PLACEMENT_UNSET);
    expect(colorValue('#fff')).toBe('#fff');
  });
});
