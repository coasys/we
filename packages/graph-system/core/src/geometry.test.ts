/**
 * Edge geometry tests.
 *
 * Both behaviours here are the difference between a graph that looks drawn and one that looks
 * emitted: an arrowhead buried under the node it points at, and two mutual edges rendered exactly on
 * top of each other so the graph understates its own connectivity.
 */
import { describe, expect, it } from 'vitest';

import { bowOffsets, distanceToEdge, groupByEndpoints, normaliseCurve, routeEdge, trimToRadius } from './geometry';

describe('trimToRadius', () => {
  it('stops the segment at the node edge, not its centre', () => {
    expect(trimToRadius({ x: 0, y: 0 }, { x: 100, y: 0 }, 20)).toEqual({ x: 80, y: 0 });
  });

  it('leaves the endpoint alone when the nodes already overlap', () => {
    // Trimming past the start would flip the arrow around.
    expect(trimToRadius({ x: 0, y: 0 }, { x: 10, y: 0 }, 20)).toEqual({ x: 10, y: 0 });
  });

  it('does not divide by zero on a self-loop', () => {
    expect(trimToRadius({ x: 5, y: 5 }, { x: 5, y: 5 }, 20)).toEqual({ x: 5, y: 5 });
  });
});

describe('bowOffsets', () => {
  it('draws a lone edge straight', () => {
    expect(bowOffsets(1)).toEqual([0]);
  });

  it('splits a mutual pair symmetrically', () => {
    // Both bending the same way would still overlap; opposite signs separate them.
    const [first, second] = bowOffsets(2, 20);
    expect(first).toBe(20);
    expect(second).toBe(-20);
  });

  it('fans a bundle of parallel edges outward', () => {
    expect(bowOffsets(4, 10)).toEqual([10, -10, 20, -20]);
  });
});

describe('routeEdge', () => {
  it('draws a straight line when asked and unbowed', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 10, y: 10 }, 'straight');
    expect(route.control).toBeUndefined();
    expect(route.mid).toEqual({ x: 5, y: 5 });
  });

  it('bows a curve to the requested side', () => {
    const left = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', 20);
    const right = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', -20);
    expect(left.control).not.toEqual(right.control);
  });

  it('puts the label on the curve, not on the chord', () => {
    // A quadratic's midpoint is the average of its endpoints and *twice* its control. Using the chord
    // midpoint leaves the label floating off the line it belongs to.
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', 40);
    expect(route.mid.y).not.toBe(0);
    expect(Math.abs(route.mid.y)).toBeLessThan(40);
  });

  it('steps through two corners, turning along the axis it mostly runs on', () => {
    const across = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 50 }, 'step');
    expect(across.elbows).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);

    // Mostly vertical, so it departs vertically instead — a top-to-bottom hierarchy should not leave
    // sideways before it starts descending.
    const down = routeEdge('e', { x: 0, y: 0 }, { x: 50, y: 100 }, 'step');
    expect(down.elbows).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 50 },
    ]);
  });

  it('accepts the previous curve names, so templates written against them keep working', () => {
    expect(normaliseCurve('bezier')).toBe('arc');
    expect(normaliseCurve('orthogonal')).toBe('step');
    expect(normaliseCurve(undefined)).toBe('arc');
    expect(normaliseCurve('nonsense')).toBe('arc');
  });

  it('leaves and arrives along the dominant axis on a smooth curve', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 40 }, 'smooth');
    // Departure tangent is horizontal, so the first control shares the source's y.
    expect(route.control).toEqual({ x: 50, y: 0 });
    // Arrival tangent likewise shares the target's.
    expect(route.control2).toEqual({ x: 50, y: 40 });
  });

  it('gives a self-loop a visible shape rather than a zero-length route', () => {
    const route = routeEdge('e', { x: 10, y: 10 }, { x: 10, y: 10 }, 'arc');
    expect(route.control).toBeDefined();
    expect(route.mid).not.toEqual({ x: 10, y: 10 });
  });
});

describe('distanceToEdge', () => {
  it('measures zero on the line and grows away from it', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'straight');
    expect(distanceToEdge({ x: 50, y: 0 }, route)).toBeCloseTo(0, 5);
    expect(distanceToEdge({ x: 50, y: 20 }, route)).toBeCloseTo(20, 5);
  });

  it('measures against the curve rather than the chord', () => {
    // The whole point of geometric picking: a bowed edge is not where the straight line between its
    // endpoints is, and clicking the chord should not select it.
    const bowed = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'arc', 60);
    expect(distanceToEdge({ x: 50, y: 0 }, bowed)).toBeGreaterThan(20);
    expect(distanceToEdge({ x: 50, y: 30 }, bowed)).toBeLessThan(5);
  });

  it('clamps to the ends rather than extending the line', () => {
    const route = routeEdge('e', { x: 0, y: 0 }, { x: 100, y: 0 }, 'straight');
    expect(distanceToEdge({ x: -30, y: 0 }, route)).toBeCloseTo(30, 5);
  });
});

describe('groupByEndpoints', () => {
  it('groups mutual edges together regardless of direction', () => {
    const groups = groupByEndpoints([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'a', target: 'c' },
    ]);
    expect(groups.size).toBe(2);
    expect([...groups.values()].find((group) => group.length === 2)).toBeDefined();
  });
});
