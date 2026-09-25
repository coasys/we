/**
 * The synthetic cursors, which exist to be looked at — so what is worth asserting is the two things a
 * person looking at them cannot check.
 *
 * That they *move*, and move independently: a set travelling in step would hide the failure most likely
 * to be there, which is one mark's transform being applied to another. And that they land in the frame
 * this agent is actually on, since a world point drawn as a fraction is off screen and a fraction drawn
 * as a world point is a thousand units away.
 */
import { describe, expect, it } from 'vitest';

import { devCursorAnchors, devCursorMarks } from './devCursors';

describe('synthetic cursors', () => {
  it('takes world units on a canvas and fractions anywhere else', () => {
    const [world] = devCursorAnchors(1, 'canvas:c1', 'world', 0);
    expect(world).toMatchObject({ surface: 'canvas:c1', kind: 'world' });

    const [box] = devCursorAnchors(1, 'route:/kanban', 'viewport', 0);
    expect(box.kind).toBe('viewport');
    // Kept clear of the edges, so none of them sits under the chrome at one.
    expect(box.x).toBeGreaterThan(0.05);
    expect(box.x).toBeLessThan(0.95);
    expect(box.y).toBeGreaterThan(0.05);
    expect(box.y).toBeLessThan(0.95);
  });

  it('moves, and moves each one at its own rate', () => {
    const before = devCursorAnchors(3, 'canvas:c1', 'world', 0);
    const after = devCursorAnchors(3, 'canvas:c1', 'world', 500);
    for (let index = 0; index < 3; index++) {
      expect(after[index]).not.toEqual(before[index]);
    }
    // Different periods, so they visibly separate rather than travelling in formation — which is what
    // would hide one mark's transform being applied to another.
    const travelled = before.map((at, index) => Math.abs(after[index].x - at.x));
    expect(new Set(travelled.map((d) => d.toFixed(3))).size).toBe(3);
  });

  it('draws the same node a real cursor gets, with a colour instead of a face', () => {
    const [mark] = devCursorMarks(devCursorAnchors(1, 'canvas:c1', 'world', 0));
    expect(mark.node.type).toBe('we-live-cursor');
    expect(mark.ease).toBe(true);
    // An explicit colour is what the primitive offers for a mark standing for something other than a
    // person, which a fake cursor is.
    expect(mark.node.props?.color).toBeTruthy();
  });

  it('is nothing at all at zero', () => {
    expect(devCursorAnchors(0, 'canvas:c1', 'world', 0)).toEqual([]);
  });
});
