/**
 * Resize geometry — which edge stays put.
 *
 * The first version of this gesture had one handle and grew the card in every direction at once,
 * because it changed the size and left the centre alone. That reads as the card sliding out from
 * under the pointer: you pull the right edge and the left edge comes with it.
 *
 * Every case here is that bug, from a different handle.
 */
import { describe, expect, it } from 'vitest';

import { HANDLES, resizeBox } from './resize';

/** A 200×100 card centred at the origin: edges at ±100 and ±50. */
const card = { at: { x: 0, y: 0 }, width: 200, height: 100 };
const grip = (id: string) => HANDLES.find((handle) => handle.id === id)!.grip;

describe('resizeBox', () => {
  it('grows to the right without moving the left edge', () => {
    const next = resizeBox(card, grip('e'), { x: 40, y: 0 }, 40);

    expect(next.width).toBe(240);
    // The left edge is what must not move; the centre moves half the growth to keep it there.
    expect(next.at.x - next.width / 2).toBe(-100);
    expect(next.at.x).toBe(20);
  });

  it('grows to the left without moving the right edge', () => {
    // Dragging left is a negative delta on a handle that pulls negative — the card gets bigger.
    const next = resizeBox(card, grip('w'), { x: -40, y: 0 }, 40);

    expect(next.width).toBe(240);
    expect(next.at.x + next.width / 2).toBe(100);
  });

  it('leaves the other dimension alone on an edge handle', () => {
    // The whole reason edge handles exist: a pointer never moves in one axis only, so a handle that
    // read both would change the height of a card somebody was only widening.
    const next = resizeBox(card, grip('e'), { x: 40, y: 60 }, 40);

    expect(next.height).toBe(100);
    expect(next.at.y).toBe(0);
  });

  it('anchors the opposite corner on a corner handle', () => {
    const next = resizeBox(card, grip('se'), { x: 40, y: 20 }, 40);

    expect([next.width, next.height]).toEqual([240, 120]);
    // Top-left stays exactly where it was.
    expect([next.at.x - next.width / 2, next.at.y - next.height / 2]).toEqual([-100, -50]);
  });

  it('anchors the bottom-right when dragged from the top-left', () => {
    const next = resizeBox(card, grip('nw'), { x: -40, y: -20 }, 40);

    expect([next.width, next.height]).toEqual([240, 120]);
    expect([next.at.x + next.width / 2, next.at.y + next.height / 2]).toEqual([100, 50]);
  });

  it('stops moving when it stops shrinking', () => {
    // Clamping in the caller instead would hold the size at the floor and keep moving the centre, so
    // a card squashed against the limit would crawl sideways for as long as the drag continued.
    const far = resizeBox(card, grip('e'), { x: -400, y: 0 }, 40);
    const further = resizeBox(card, grip('e'), { x: -900, y: 0 }, 40);

    expect(far.width).toBe(40);
    expect(further).toEqual(far);
    // Still anchored: the left edge has not moved even at the floor.
    expect(far.at.x - far.width / 2).toBe(-100);
  });

  it('offers a handle for every edge and corner', () => {
    expect(HANDLES.map((handle) => handle.id).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    // Exactly four corners (both axes) and four edges (one axis).
    expect(HANDLES.filter((handle) => handle.grip.x && handle.grip.y)).toHaveLength(4);
    expect(HANDLES.filter((handle) => !handle.grip.x !== !handle.grip.y)).toHaveLength(4);
  });
});
