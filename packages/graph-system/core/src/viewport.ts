/**
 * The camera — world ↔ screen, owned by the core rather than expressed as a CSS transform.
 *
 * The temptation with DOM nodes is to pan and zoom by transforming a container and letting the
 * browser do the maths. It works, and it is a trap: hit-testing, culling, edge routing and a future
 * canvas renderer all need world coordinates, and if the only source of truth is a CSS string then
 * each of them re-derives it slightly differently. One matrix here, everything else reads it.
 */
import type { Point } from '@we/graph-protocol';

export interface ViewportState {
  /** Screen-space translation. */
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;

export class Viewport {
  private state: ViewportState = { x: 0, y: 0, zoom: 1, width: 0, height: 0 };

  get(): Readonly<ViewportState> {
    return this.state;
  }

  resize(width: number, height: number): void {
    this.state = { ...this.state, width, height };
  }

  set(next: Partial<ViewportState>): void {
    const zoom = next.zoom === undefined ? this.state.zoom : clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
    this.state = { ...this.state, ...next, zoom };
  }

  pan(dx: number, dy: number): void {
    this.state = { ...this.state, x: this.state.x + dx, y: this.state.y + dy };
  }

  /**
   * Zoom about a screen point, keeping the world position under the cursor stationary.
   *
   * The stationary-point property is the whole feel of a zoomable canvas — zoom about the centre
   * instead and the thing you were looking at slides away as you scroll into it.
   */
  zoomAt(screen: Point, factor: number): void {
    const { x, y, zoom } = this.state;
    const next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === zoom) return;
    const world = { x: (screen.x - x) / zoom, y: (screen.y - y) / zoom };
    this.state = { ...this.state, zoom: next, x: screen.x - world.x * next, y: screen.y - world.y * next };
  }

  toWorld(screen: Point): Point {
    const { x, y, zoom } = this.state;
    return { x: (screen.x - x) / zoom, y: (screen.y - y) / zoom };
  }

  toScreen(world: Point): Point {
    const { x, y, zoom } = this.state;
    return { x: world.x * zoom + x, y: world.y * zoom + y };
  }

  /** The world rectangle currently visible — what culling tests against. */
  visibleBounds(padding = 0): Bounds {
    const { x, y, zoom, width, height } = this.state;
    return {
      minX: (0 - x) / zoom - padding,
      minY: (0 - y) / zoom - padding,
      maxX: (width - x) / zoom + padding,
      maxY: (height - y) / zoom + padding,
    };
  }

  /** Frame a set of world bounds, with a margin so nodes are not flush against the edge. */
  fit(bounds: Bounds, margin = 60): void {
    const { width, height } = this.state;
    if (!width || !height) return;
    const spanX = Math.max(bounds.maxX - bounds.minX, 1);
    const spanY = Math.max(bounds.maxY - bounds.minY, 1);
    const zoom = clamp(
      Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY),
      MIN_ZOOM,
      // Framing a single node should not zoom to the maximum; 1 reads as "actual size".
      1,
    );
    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreY = (bounds.minY + bounds.maxY) / 2;
    this.state = {
      ...this.state,
      zoom,
      x: width / 2 - centreX * zoom,
      y: height / 2 - centreY * zoom,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Bounds around a set of positioned points, or `null` when there are none. */
export function boundsOf(points: Iterable<Point & { radius?: number }>): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;
  for (const p of points) {
    seen = true;
    const r = p.radius ?? 0;
    if (p.x - r < minX) minX = p.x - r;
    if (p.y - r < minY) minY = p.y - r;
    if (p.x + r > maxX) maxX = p.x + r;
    if (p.y + r > maxY) maxY = p.y + r;
  }
  return seen ? { minX, minY, maxX, maxY } : null;
}
