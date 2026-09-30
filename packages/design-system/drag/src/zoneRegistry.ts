/**
 * Every registered zone, and which one is under a point.
 *
 * Module-level rather than passed in, because the whole point is that a drag crosses elements that
 * do not know about each other: a card leaving a feed has no reference to the panel it lands in,
 * and threading one through every template that composes a page would defeat the purpose.
 *
 * Generic over what a zone *is* so the two consumers can keep their own record shape: `we-sortable`
 * registers itself (the zone is the element), the session registers a `DragZone` object. Both need
 * the same two things — membership tied to connect/disconnect, and innermost-wins hit-testing.
 */
export interface ZoneRegistry<T> {
  add(zone: T): void;
  remove(zone: T): void;
  /** Registration order — the order zones connected, which for a board is the order of its columns. */
  list(): T[];
  /**
   * The innermost accepting zone whose rectangle contains the point, or `null`.
   *
   * Innermost matters for nesting: a nested list sits inside its parent's rectangle, so both contain
   * the pointer and only the deeper one is the intended target.
   */
  at(x: number, y: number, accepts: (zone: T) => boolean): T | null;
}

import { composedContains, deepElementFromPoint } from './deepElement';

export function createZoneRegistry<T>(elementOf: (zone: T) => Element): ZoneRegistry<T> {
  const zones = new Set<T>();

  return {
    add: (zone) => void zones.add(zone),
    remove: (zone) => void zones.delete(zone),
    list: () => [...zones],
    at(x, y, accepts) {
      /*
        What is actually painted at that point, so overlap is decided by what is in front.

        Containment answers nesting and nothing else: two zones that overlap *without* one being
        inside the other — a floating Pocket over a page's drop area — both contain the pointer, and
        `bestEl.contains(el)` is false either way, so whichever the `Set` yielded first won. Which is
        to say: by registration order, which is not a property anybody chose or can see.

        Hit-testing knows. The ghost is `pointer-events: none`, so it is never what comes back.
      */
      const under = deepElementFromPoint(x, y);

      let best: T | null = null;
      let bestEl: Element | null = null;
      /** A candidate the pointer is painted over beats one it is merely inside the rectangle of. */
      let bestHit = false;

      for (const zone of zones) {
        const el = elementOf(zone);
        // A zone removed mid-drag stops being a candidate rather than leaving a stale rectangle.
        if (!el.isConnected || !accepts(zone)) continue;
        const rect = el.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

        const hit = composedContains(el, under);
        if (best && bestHit !== hit) {
          // One of the two is in front. Take it, whatever the nesting says.
          if (!hit) continue;
        } else if (best && !bestEl!.contains(el)) {
          // Neither is in front, or both are, and neither is inside the other: keep the incumbent
          // rather than letting iteration order decide.
          continue;
        }
        best = zone;
        bestEl = el;
        bestHit = hit;
      }
      return best;
    },
  };
}
