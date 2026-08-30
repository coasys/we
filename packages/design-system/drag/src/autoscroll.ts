/**
 * Scrolling the thing under the pointer when a drag reaches its edge.
 *
 * Without it a list taller than its box can only be dropped into where it already happens to be
 * scrolled, which is the difference between "drag a card to the bottom of the board" working and
 * not existing.
 *
 * Deliberately dumb: a fixed band and a fixed step, applied on every pointer move. A drag is
 * already producing a move event per frame, so there is nothing to schedule; and a velocity ramp
 * would be a feel decision made in a package that cannot see the surface.
 */

import { deepElementFromPoint } from './deepElement';

/** How close to an edge, in pixels, before it starts scrolling. */
const EDGE_BAND = 48;
/** Pixels per move event at the very edge. */
const MAX_STEP = 18;

function scrollableAncestor(from: Element | null): Element | null {
  let el: Element | null = from;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const scrollsY = /auto|scroll|overlay/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const scrollsX = /auto|scroll|overlay/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (scrollsY || scrollsX) return el;
    el = el.parentElement ?? (el.getRootNode() as ShadowRoot).host ?? null;
  }
  return document.scrollingElement;
}

/** How far to move along one axis, given where in the band the pointer is. */
function step(position: number, low: number, high: number): number {
  if (position - low < EDGE_BAND) return -Math.round(MAX_STEP * (1 - Math.max(position - low, 0) / EDGE_BAND));
  if (high - position < EDGE_BAND) return Math.round(MAX_STEP * (1 - Math.max(high - position, 0) / EDGE_BAND));
  return 0;
}

/**
 * Scroll whatever is under the pointer, if the pointer is near one of its edges.
 *
 * Note the ghost must not be hit-testable for this to find anything — it is `pointer-events:none`,
 * which is also why it never blocks a drop.
 */
export function autoscroll(x: number, y: number): void {
  // Through shadow roots: the scroller inside a `we-scroll-area` is *below* its host, so walking up
  // from the host could never reach it. See `deepElementFromPoint`.
  const under = deepElementFromPoint(x, y);
  const box = scrollableAncestor(under);
  if (!box) return;

  const rect =
    box === document.scrollingElement
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : box.getBoundingClientRect();

  const dx = step(x, rect.left, rect.right);
  const dy = step(y, rect.top, rect.bottom);
  if (dx || dy) box.scrollBy?.(dx, dy);
}
