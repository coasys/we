/**
 * Reaching an endpoint grip that sits inside a card.
 *
 * Hover picks a node before an edge — right almost everywhere, since a node is a shape you can see
 * and an edge is a two-pixel line. It is wrong for the grip on an edge's end, because an end can be
 * *inside* the node's box: a card is drawn clipped to an outline, so an edge anchored to a
 * triangle's left side ends a quarter of the card's width in from that box's left edge.
 *
 * The grips only show while the edge is hovered, so the pointer crossed into the box, the hover
 * cleared, and the handle disappeared before the pointer reached it — an anchor could be set once
 * and never changed again. Asserted as geometry rather than through the DOM: what went wrong is
 * which of two things claims a point, and that is a question with an answer.
 */
import { describe, expect, it } from 'vitest';

import { edgeEndAt } from './GraphView.solid';

const edge = (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => ({
  edge: { id },
  route: { from, to },
});

/** One edge, anchored to the left side of a 180×135 triangle card centred at (400, 0). */
const anchored = [edge('e1', { x: 0, y: 0 }, { x: 355, y: 0 })];

describe('the grip on an edge’s end', () => {
  it('is found where it is drawn, inside the card’s box', () => {
    // The box's left edge is at 310; the triangle's side, and the grip, are at 355.
    expect(edgeEndAt({ x: 355, y: 0 }, anchored, 12)).toBe('e1');
  });

  it('is found from a little off, since a grip is a target rather than a point', () => {
    expect(edgeEndAt({ x: 347, y: 5 }, anchored, 12)).toBe('e1');
  });

  it('is not found from outside its reach, so the card keeps everything else', () => {
    // Deep inside the triangle, where somebody is aiming at the card rather than at the line.
    expect(edgeEndAt({ x: 400, y: 0 }, anchored, 12)).toBeNull();
    // And out on the line, where the ordinary edge hit-test answers instead.
    expect(edgeEndAt({ x: 200, y: 0 }, anchored, 12)).toBeNull();
  });

  it('answers for either end', () => {
    expect(edgeEndAt({ x: 0, y: 0 }, anchored, 12)).toBe('e1');
  });

  it('scales with the camera, since the grip is drawn at a constant size on screen', () => {
    // Zoomed in, the same screen distance is fewer world units — and a reach that did not shrink
    // would swallow presses meant for the card.
    expect(edgeEndAt({ x: 347, y: 0 }, anchored, 12 / 4)).toBeNull();
    expect(edgeEndAt({ x: 353, y: 0 }, anchored, 12 / 4)).toBe('e1');
  });

  it('hands a point between two ends to the nearer one', () => {
    // Two cards close together: the press belongs to the end being aimed at, not to whichever edge
    // happens to be first in the list.
    const pair = [edge('e1', { x: 0, y: 0 }, { x: 100, y: 0 }), edge('e2', { x: 108, y: 0 }, { x: 400, y: 0 })];

    expect(edgeEndAt({ x: 102, y: 0 }, pair, 12)).toBe('e1');
    expect(edgeEndAt({ x: 106, y: 0 }, pair, 12)).toBe('e2');
  });

  it('answers nothing when there is nothing on screen', () => {
    expect(edgeEndAt({ x: 0, y: 0 }, [], 12)).toBeNull();
  });
});
