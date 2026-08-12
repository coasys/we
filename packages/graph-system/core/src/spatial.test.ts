import { describe, expect, it } from 'vitest';

import { SpatialIndex } from './spatial';
import { boundsOf, Viewport } from './viewport';

describe('SpatialIndex', () => {
  it('hit-tests circular nodes by radius, nearest centre first', () => {
    const index = new SpatialIndex();
    index.rebuild([
      { id: 'near', x: 0, y: 0, radius: 20 },
      { id: 'far', x: 15, y: 0, radius: 20 },
      { id: 'out-of-range', x: 500, y: 500, radius: 20 },
    ]);

    // Both overlap the point; the one whose centre is closer comes first.
    expect(index.hitTest({ x: 5, y: 0 })).toEqual(['near', 'far']);
    expect(index.hitTest({ x: 400, y: 400 })).toEqual([]);
  });

  it('hit-tests box nodes by half-extents, not by radius', () => {
    const index = new SpatialIndex();
    index.rebuild([{ id: 'card', x: 0, y: 0, radius: 10, halfWidth: 85, halfHeight: 64 }]);

    // A corner of the card, well outside the radius, still hits the box.
    expect(index.hitTest({ x: 80, y: 60 })).toEqual(['card']);
    // Just past the edge misses.
    expect(index.hitTest({ x: 86, y: 0 })).toEqual([]);
  });

  it('cells scale with the largest node so big nodes are not missed', () => {
    const index = new SpatialIndex();
    // A node much larger than the default cell: the 3×3 sweep only works
    // because rebuild grows the cell size to cover it.
    index.rebuild([{ id: 'big', x: 0, y: 0, radius: 400 }]);
    expect(index.hitTest({ x: 390, y: 0 })).toEqual(['big']);
  });

  it('within returns nodes intersecting a rectangle (marquee)', () => {
    const index = new SpatialIndex();
    index.rebuild([
      { id: 'inside', x: 10, y: 10, radius: 5 },
      { id: 'touching', x: 55, y: 10, radius: 5 },
      { id: 'outside', x: 100, y: 100, radius: 5 },
    ]);
    expect(index.within({ minX: 0, minY: 0, maxX: 50, maxY: 50 })).toEqual(['inside', 'touching']);
  });

  it('rebuild replaces the previous contents', () => {
    const index = new SpatialIndex();
    index.rebuild([{ id: 'old', x: 0, y: 0, radius: 10 }]);
    index.rebuild([{ id: 'new', x: 0, y: 0, radius: 10 }]);
    expect(index.hitTest({ x: 0, y: 0 })).toEqual(['new']);
  });
});

describe('Viewport', () => {
  it('round-trips world ↔ screen through pan and zoom', () => {
    const viewport = new Viewport();
    viewport.resize(800, 600);
    viewport.set({ x: 40, y: -20, zoom: 2 });

    const world = { x: 123, y: -45 };
    expect(viewport.toWorld(viewport.toScreen(world))).toEqual(world);
  });

  it('zoomAt keeps the world point under the cursor stationary', () => {
    const viewport = new Viewport();
    viewport.resize(800, 600);
    const cursor = { x: 200, y: 150 };
    const before = viewport.toWorld(cursor);

    viewport.zoomAt(cursor, 2);
    const after = viewport.toWorld(cursor);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(viewport.get().zoom).toBe(2);
  });

  it('clamps zoom and ignores a no-op zoom', () => {
    const viewport = new Viewport();
    viewport.resize(800, 600);
    viewport.zoomAt({ x: 0, y: 0 }, 1000);
    expect(viewport.get().zoom).toBe(8);
    const state = viewport.get();
    viewport.zoomAt({ x: 100, y: 100 }, 2); // already at max — stationary maths must not run
    expect(viewport.get()).toEqual(state);
  });

  it('fit frames bounds centred, capped at actual size', () => {
    const viewport = new Viewport();
    viewport.resize(800, 600);
    viewport.fit({ minX: -50, minY: -50, maxX: 50, maxY: 50 });

    const { zoom } = viewport.get();
    // Framing a small graph must not zoom past 1 ("actual size").
    expect(zoom).toBe(1);
    // The bounds centre lands on the viewport centre.
    expect(viewport.toScreen({ x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
  });

  it('fit does nothing before the viewport has a size', () => {
    const viewport = new Viewport();
    const before = viewport.get();
    viewport.fit({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(viewport.get()).toEqual(before);
  });

  it('visibleBounds inverts the transform with padding', () => {
    const viewport = new Viewport();
    viewport.resize(100, 100);
    viewport.set({ x: 50, y: 50, zoom: 0.5 });
    expect(viewport.visibleBounds(10)).toEqual({ minX: -110, minY: -110, maxX: 110, maxY: 110 });
  });
});

describe('boundsOf', () => {
  it('includes radii and returns null for nothing', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 0, y: 0, radius: 10 },
        { x: 100, y: 50 },
      ]),
    ).toEqual({ minX: -10, minY: -10, maxX: 100, maxY: 50 });
  });
});
