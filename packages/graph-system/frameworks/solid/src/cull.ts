/**
 * What the canvas draws of a graph larger than its screen — see the culling section of `GraphView`.
 */

/** How far past the view, as a share of its size on each side, cards are still drawn. */
export const NODE_CULL_MARGIN = 0.5;

/** How far past the view a card's content is mounted. Small: content is the expensive part. */
export const CONTENT_CULL_MARGIN = 0.1;

/** How long a frame may spend mounting card content before the rest waits for the next one. */
export const CONTENT_FRAME_BUDGET_MS = 8;

/** How many cards are granted content between checks of the frame budget. */
export const CONTENT_GRANT_CHUNK = 8;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Whether two sets hold the same members. */
export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** Whether two boxes overlap, touching included. */
export function boxMeets(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
