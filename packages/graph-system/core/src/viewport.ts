/**
 * The camera — world ↔ screen, owned by the core rather than expressed as a CSS transform.
 *
 * The temptation with DOM nodes is to pan and zoom by transforming a container and letting the
 * browser do the maths. It works, and it is a trap: hit-testing, culling, edge routing and a future
 * canvas renderer all need world coordinates, and if the only source of truth is a CSS string then
 * each of them re-derives it slightly differently. One matrix here, everything else reads it.
 */
import type { Bounds, Point } from '@we/graph-protocol';

export interface ViewportState {
  /** Screen-space translation. */
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

/**
 * Re-exported rather than declared here.
 *
 * It lived in this file until a behaviour needed to ask about a rectangle, and `BehaviourContext` is
 * declared in `@we/graph-protocol` — which cannot import the core. So the type moved down beside
 * `Point`, where the rest of the shared geometry already is, and this keeps `import { Bounds } from
 * '@we/graph-core'` working for everything that already had it.
 */
export type { Bounds };

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;

/** Screen-space pixels along each edge that something is drawn over — see `Viewport.setObscured`. */
export interface ScreenInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSET: ScreenInset = { top: 0, right: 0, bottom: 0, left: 0 };

export class Viewport {
  private state: ViewportState = { x: 0, y: 0, zoom: 1, width: 0, height: 0 };

  /**
   * The parts of the canvas something else is covering, in screen pixels per edge.
   *
   * The graph fills its box; the host may float panels over that box without shrinking it. The
   * camera is unaffected — the covered pixels are still canvas, still rendered, still pannable —
   * but anything asking "what can the reader see" wants this subtracted. Zero unless a host says
   * otherwise, so nothing outside an app shell has to know the concept exists.
   */
  private obscured: ScreenInset = NO_INSET;

  get(): Readonly<ViewportState> {
    return this.state;
  }

  setObscured(inset: Partial<ScreenInset> | null | undefined): void {
    this.obscured = inset ? { ...NO_INSET, ...inset } : NO_INSET;
  }

  /**
   * The screen rectangle a reader can actually see, which is the whole viewport minus what is
   * covering it.
   *
   * Clamped so an inset wider than the viewport gives an empty rect at the origin rather than a
   * negative one — a panel maximised over a narrow window can genuinely cover everything, and a
   * negative width propagates into world coordinates as a rectangle inside out.
   */
  visibleRect(): { x: number; y: number; width: number; height: number } {
    const { width, height } = this.state;
    const { top, right, bottom, left } = this.obscured;
    return {
      x: Math.min(left, width),
      y: Math.min(top, height),
      width: Math.max(0, width - left - right),
      height: Math.max(0, height - top - bottom),
    };
  }

  /**
   * The world rectangle a reader can actually see — `visibleRect` in world units.
   *
   * **What the reader can see, not what the canvas spans**, which is the whole reason it is not
   * `visibleBounds`: a host may float a panel over the graph without shrinking its box, so the canvas
   * the engine believes is on screen and the canvas somebody is looking at are different rectangles.
   *
   * This is the shape one agent hands another to say "look at what I am looking at". A camera —
   * `{ x, y, zoom }` — is the wrong thing to send, because the receiver's box is a different shape:
   * the same zoom shows them a different amount of the canvas, and the same centre plus the same zoom
   * puts whatever is being pointed at off their screen. A region is fittable into whatever box they
   * have, and then both of them are looking at the same content.
   */
  visibleWorldRect(): { x: number; y: number; width: number; height: number } {
    const rect = this.visibleRect();
    const topLeft = this.toWorld({ x: rect.x, y: rect.y });
    const bottomRight = this.toWorld({ x: rect.x + rect.width, y: rect.y + rect.height });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
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
    // Framing a single node should not zoom to the maximum; 1 reads as "actual size".
    this.frameBounds(bounds, margin, 1);
  }

  /**
   * Frame exactly the region somebody else can see — what following their view does.
   *
   * Two differences from {@link fit}, and both are about it being a *region somebody chose* rather
   * than the extent of some content.
   *
   * **No margin.** The region already describes what a reader could see, so padding it would show a
   * follower slightly less than the driver, and slightly less again if they passed it on.
   *
   * **No ceiling at zoom 1.** `fit`'s clamp is right for content — framing one node should not fill
   * the screen with it — and wrong here: a driver examining detail at zoom 3 has a follower clamped to
   * 1, looking at nine times the area at a third of the detail, which is not the same view in any
   * useful sense. The camera's own maximum still applies.
   */
  frameRegion(region: { x: number; y: number; width: number; height: number }): void {
    this.frameBounds(
      { minX: region.x, minY: region.y, maxX: region.x + region.width, maxY: region.y + region.height },
      0,
      MAX_ZOOM,
    );
  }

  private frameBounds(bounds: Bounds, margin: number, ceiling: number): void {
    const { width, height } = this.state;
    if (!width || !height) return;
    const spanX = Math.max(bounds.maxX - bounds.minX, 1);
    const spanY = Math.max(bounds.maxY - bounds.minY, 1);
    const zoom = clamp(Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY), MIN_ZOOM, ceiling);
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

/**
 * The rectangle two corners describe, in either order.
 *
 * Normalising is the whole of it, and it is the step a marquee cannot skip: a sweep up and to the
 * left produces a corner pair whose "min" is larger than its "max", and every overlap test in the
 * system reads `minX <= maxX` as a precondition rather than checking it. Without this, dragging in
 * two of the four directions selects nothing at all — which looks like the gesture working in some
 * places and not others.
 */
export function boundsFromPoints(a: Point, b: Point): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
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
