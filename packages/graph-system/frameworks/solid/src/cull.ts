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

/** The points a route is drawn from — its ends and every control, elbow and segment end. */
interface RoutePoints {
  from: { x: number; y: number };
  to: { x: number; y: number };
  control?: { x: number; y: number };
  control2?: { x: number; y: number };
  elbows?: { x: number; y: number }[];
  segments?: {
    control?: { x: number; y: number };
    control2?: { x: number; y: number };
    to: { x: number; y: number };
  }[];
}

/**
 * The box around a route's points.
 *
 * A Bézier curve never leaves the hull of its control points, so this bounds the drawn line without
 * sampling it — which matters, because it is asked of every line whenever the layout moves.
 */
export function routeBox(route: RoutePoints): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p?: { x: number; y: number }) => {
    if (!p) return;
    if (p.x < box.minX) box.minX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y > box.maxY) box.maxY = p.y;
  };
  add(route.from);
  add(route.to);
  add(route.control);
  add(route.control2);
  for (const p of route.elbows ?? []) add(p);
  for (const segment of route.segments ?? []) {
    add(segment.control);
    add(segment.control2);
    add(segment.to);
  }
  return box;
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
