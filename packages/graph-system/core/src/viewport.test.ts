/**
 * The camera, and the part of it something else is standing in front of.
 *
 * `setObscured` exists for one situation: a host that floats panels over the graph without shrinking
 * its box. The canvas is the full region and every pixel of it renders, so nothing about panning,
 * zooming or hit-testing changes — but "what can the reader see" stops being the same rectangle, and
 * a layout placing a node where nobody has placed one is asking exactly that question. The workshop
 * board asked it, got the whole region, and parked every freshly extracted card underneath the
 * transcript panel.
 */
import { describe, expect, it } from 'vitest';

import { Viewport } from './viewport';

const sized = (width = 1000, height = 800) => {
  const viewport = new Viewport();
  viewport.resize(width, height);
  return viewport;
};

describe('Viewport.visibleRect', () => {
  it('is the whole viewport when nothing is over it', () => {
    expect(sized().visibleRect()).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it('moves its origin past what covers the leading edges and shrinks by both', () => {
    const viewport = sized();
    viewport.setObscured({ left: 300, right: 100, top: 50, bottom: 0 });

    // x/y are where the clear region *starts*; width/height give up both edges, not just the one
    // the origin moved past.
    expect(viewport.visibleRect()).toEqual({ x: 300, y: 50, width: 600, height: 750 });
  });

  it('takes a partial inset, leaving the unnamed edges clear', () => {
    const viewport = sized();
    viewport.setObscured({ left: 300 });

    expect(viewport.visibleRect()).toEqual({ x: 300, y: 0, width: 700, height: 800 });
  });

  it('clears back to the whole viewport when given nothing', () => {
    const viewport = sized();
    viewport.setObscured({ left: 300 });
    viewport.setObscured(undefined);

    expect(viewport.visibleRect()).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it('gives an empty rect rather than a negative one when everything is covered', () => {
    /*
      A panel maximised over a narrow window genuinely does cover everything, so this is reachable
      rather than defensive. A negative width propagates into world coordinates as a rectangle inside
      out, and a layout handed one places nodes at coordinates that are somehow both past each edge.
    */
    const viewport = sized(400, 300);
    viewport.setObscured({ left: 500, top: 400 });

    expect(viewport.visibleRect()).toEqual({ x: 400, y: 300, width: 0, height: 0 });
  });

  it('does not move the camera', () => {
    // The covered pixels are still canvas: they render, they can be panned to, and a click on one
    // still hits whatever is under it. Only questions about visibility change.
    const viewport = sized();
    const before = { ...viewport.get() };
    viewport.setObscured({ left: 300 });

    expect(viewport.get()).toEqual(before);
    expect(viewport.toWorld({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
