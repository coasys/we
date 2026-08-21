import type { Point } from '@we/graph-protocol';

/**
 * The geometry of a resize handle, kept apart from the gesture that drives it.
 *
 * Which edge stays put is the whole of what makes resizing feel right, and it is the part that was
 * wrong first: a handle that grew the card in all four directions at once, whichever one you pulled.
 * A pure function is also the only way to have an opinion about it that a test can check — the
 * gesture around it is pointer capture and DOM listeners.
 */

/** Which way a handle pulls, per axis. `0` leaves that dimension alone, which is what an edge does. */
export interface Grip {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

export interface Box {
  /** Centre, because that is where a node is drawn from. */
  at: Point;
  width: number;
  height: number;
}

/**
 * Where a card ends up when one of its handles is dragged by `delta` world units.
 *
 * The rule in one line: the edge the handle is *not* pulling does not move. A card is drawn from its
 * centre, so holding an edge still means moving the centre by half of whatever the size changed by —
 * which is why this returns a position as well as a size, and why a consumer that stores only the
 * size will watch its cards drift sideways.
 *
 * `min` is a floor on both dimensions. Clamping here rather than in the caller keeps the anchor
 * correct at the limit: a card squashed against the floor must stop growing *and* stop moving, and
 * clamping afterwards would leave the centre where the unclamped size had put it.
 */
export function resizeBox(box: Box, grip: Grip, delta: Point, min: number): Box {
  const left = box.at.x - box.width / 2;
  const right = box.at.x + box.width / 2;
  const top = box.at.y - box.height / 2;
  const bottom = box.at.y + box.height / 2;

  const next: Box = { at: { x: box.at.x, y: box.at.y }, width: box.width, height: box.height };
  if (grip.x) {
    next.width = Math.max(min, box.width + delta.x * grip.x);
    next.at.x = grip.x === 1 ? left + next.width / 2 : right - next.width / 2;
  }
  if (grip.y) {
    next.height = Math.max(min, box.height + delta.y * grip.y);
    next.at.y = grip.y === 1 ? top + next.height / 2 : bottom - next.height / 2;
  }
  return next;
}

/**
 * The eight handles: four corners, four edges.
 *
 * A corner pulls both axes, an edge pulls one and leaves the other at zero — which is what makes
 * dragging the right edge change the width and nothing else. The sign says which edge is anchored:
 * `1` grows right or down, holding the left or top edge still.
 */
export const HANDLES: readonly { id: string; grip: Grip }[] = [
  { id: 'nw', grip: { x: -1, y: -1 } },
  { id: 'n', grip: { x: 0, y: -1 } },
  { id: 'ne', grip: { x: 1, y: -1 } },
  { id: 'e', grip: { x: 1, y: 0 } },
  { id: 'se', grip: { x: 1, y: 1 } },
  { id: 's', grip: { x: 0, y: 1 } },
  { id: 'sw', grip: { x: -1, y: 1 } },
  { id: 'w', grip: { x: -1, y: 0 } },
];
