/**
 * The editing surface's coordinate contract.
 *
 * `EditorOverlay` calls `getBoundingClientRect` twelve times, which reads as viewport coupling and
 * was twice reported as such — including by the commit that introduced container positioning, which
 * listed the overlay as unfinished work it was not. Eleven of those calls are inputs to a
 * subtraction that cancels the viewport out; the twelfth is a cursor-tracking ghost that is supposed
 * to be in viewport coordinates.
 *
 * These tests pin that down so the next person to grep for it gets an answer rather than an
 * inference.
 */
import { describe, expect, it } from 'vitest';

/**
 * The overlay's normalisation, extracted verbatim from `EditorOverlay.toRelative`.
 *
 * Duplicated rather than imported because the original closes over a component-scoped ref. If the
 * two ever diverge this test stops describing the code — so it is written to fail loudly on the one
 * property that matters, rather than to mirror the implementation line by line.
 */
function toRelative(rect: DOMRect, base: DOMRect) {
  return {
    top: `${rect.top - base.top}px`,
    left: `${rect.left - base.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

const rect = (top: number, left: number, width = 100, height = 40) =>
  ({ top, left, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

describe('overlay highlight coordinates', () => {
  it('are relative to the overlay, not the viewport', () => {
    // The same element, under an overlay that sits at two different places on screen. A highlight
    // drawn inside the overlay must land in the same spot both times — that is what makes the
    // surface embeddable in a panel without any container-offset maths of its own.
    const element = rect(300, 500);

    const atOrigin = toRelative(element, rect(0, 0, 1200, 800));
    const inAPanel = toRelative(element, rect(200, 400, 600, 500));

    expect(atOrigin).toEqual({ top: '300px', left: '500px', width: '100px', height: '40px' });
    expect(inAPanel).toEqual({ top: '100px', left: '100px', width: '100px', height: '40px' });
  });

  it('shift with the overlay when the page scrolls', () => {
    // `getBoundingClientRect` is viewport-relative, so both rects move together under scroll and the
    // difference is unchanged. This is why the overlay needs no scroll listener.
    const scrolled = (dy: number) => toRelative(rect(300 - dy, 500), rect(0 - dy, 0, 1200, 800));

    expect(scrolled(0)).toEqual(scrolled(250));
  });

  it('do not depend on the overlay filling the window', () => {
    // The overlay root is `position: absolute; width: 100%; height: 100%` — it fills its parent,
    // whatever that is. A narrower parent must not distort the highlight.
    const element = rect(150, 250, 80, 20);
    const wide = toRelative(element, rect(100, 100, 1000, 700));
    const narrow = toRelative(element, rect(100, 100, 320, 240));

    expect(wide).toEqual(narrow);
  });
});
