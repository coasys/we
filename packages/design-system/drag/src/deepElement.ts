/**
 * The element actually under a point, through shadow roots.
 *
 * `document.elementFromPoint` stops at the outermost custom element: over a `we-scroll-area` it
 * returns the host, never the scroller inside it. Two things in this package were wrong because of
 * that, and neither looked like a hit-testing bug:
 *
 * - **Autoscroll never found `we-scroll-area`'s scroller.** It walked up from the host looking for
 *   an ancestor with `overflow: auto`, and the scroller is *below* the host, not above it — so
 *   dragging to the edge of any scroll area did nothing, and a list taller than its box could only
 *   be dropped into wherever it happened to be scrolled.
 * - **Drop zones resolved by registration order** when two overlapped without nesting. A floating
 *   Pocket over a page zone contains the pointer in both rectangles and neither element contains
 *   the other, so "innermost by containment" had nothing to say and whichever registered first won.
 *   Which of two overlapping panels is *in front* is a question only hit-testing can answer.
 *
 * `elementFromPoint` exists on `ShadowRoot` as well as on `Document`, so descending is a loop. The
 * guard against `inner === el` is what stops a root whose only content is its host from spinning.
 */

/** How many shadow boundaries to descend. Deeper than any real component stack. */
const MAX_DEPTH = 32;

export function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint?.(x, y) ?? null;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const root = el?.shadowRoot;
    if (!root?.elementFromPoint) return el;
    const inner = root.elementFromPoint(x, y);
    if (!inner || inner === el) return el;
    el = inner;
  }
  return el;
}

/**
 * Whether `ancestor` contains `node`, crossing shadow boundaries the way the composed tree does.
 *
 * `Node.contains` stops at a shadow root, so a zone whose element hosts the element under the
 * pointer answers `false` — which is the whole point of asking.
 */
export function composedContains(ancestor: Element, node: Element | null): boolean {
  let current: Node | null = node;
  for (let depth = 0; current && depth < MAX_DEPTH * 4; depth++) {
    if (current === ancestor) return true;
    const parent: Node | null =
      (current as Element).parentElement ?? ((current.getRootNode() as ShadowRoot).host as Node | undefined) ?? null;
    if (parent === current) return false;
    current = parent;
  }
  return false;
}
