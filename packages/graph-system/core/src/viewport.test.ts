/**
 * The camera, and the part of it something else is standing in front of.
 *
 * `setObscured` exists for one situation: a host that floats panels over the graph without shrinking
 * its box. The canvas is the full region and every pixel of it renders, so nothing about panning,
 * zooming or hit-testing changes — but "what can the reader see" stops being the same rectangle, and
 * a layout placing a node where nobody has placed one is asking exactly that question. The workshop
 * canvas asked it, got the whole region, and parked every freshly extracted card underneath the
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

describe('the region two agents share', () => {
  it('reports what the reader can see, not what the box spans', () => {
    const vp = new Viewport();
    vp.resize(400, 200);
    // A panel over the left half: the covered pixels are still canvas, so `visibleBounds` includes
    // them and this must not.
    vp.setObscured({ left: 200 });
    const region = vp.visibleWorldRect();
    expect(region.x).toBe(200);
    expect(region.width).toBe(200);
  });

  it('round-trips through fit, so following somebody lands on what they could see', () => {
    const driver = new Viewport();
    driver.resize(800, 600);
    driver.set({ x: -100, y: -50, zoom: 2 });
    const region = driver.visibleWorldRect();

    // The follower's box is a different shape — the case a camera cannot survive.
    const follower = new Viewport();
    follower.resize(400, 600);
    follower.frameRegion(region);

    const seen = follower.visibleWorldRect();
    // Everything the driver could see is visible to the follower; the narrower box means more of the
    // other axis, never less of this one.
    expect(seen.x).toBeLessThanOrEqual(region.x + 0.001);
    expect(seen.y).toBeLessThanOrEqual(region.y + 0.001);
    expect(seen.x + seen.width).toBeGreaterThanOrEqual(region.x + region.width - 0.001);
    expect(seen.y + seen.height).toBeGreaterThanOrEqual(region.y + region.height - 0.001);
  });
});

describe('framing a region', () => {
  it('frames what was asked for, with no margin of its own', () => {
    const vp = new Viewport();
    vp.resize(400, 400);
    vp.frameRegion({ x: 0, y: 0, width: 200, height: 200 });
    // A margin here would show a follower slightly less than the driver at every hop, and the region
    // already describes what somebody could see rather than the extent of any content.
    expect(vp.visibleWorldRect()).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });
});

describe('framing a region past zoom 1', () => {
  it('matches a driver who is zoomed in, where fit would clamp to actual size', () => {
    const driver = new Viewport();
    driver.resize(400, 400);
    driver.set({ zoom: 3, x: 0, y: 0 });
    const region = driver.visibleWorldRect();

    const follower = new Viewport();
    follower.resize(400, 400);
    follower.frameRegion(region);
    // Same box, same region: the follower should be at the driver's zoom, not at fit's ceiling of 1.
    expect(follower.get().zoom).toBeCloseTo(3, 5);

    follower.fit({ minX: region.x, minY: region.y, maxX: region.x + region.width, maxY: region.y + region.height }, 0);
    // What `fit` would have done instead, and why following could not use it.
    expect(follower.get().zoom).toBe(1);
  });
});
