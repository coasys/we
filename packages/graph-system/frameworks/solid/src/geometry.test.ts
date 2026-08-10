/**
 * Edge geometry tests.
 *
 * Both behaviours here are the difference between a graph that looks drawn and one that looks
 * emitted: an arrowhead buried under the node it points at, and two mutual edges rendered exactly on
 * top of each other so the graph understates its own connectivity.
 */
import { describe, expect, it } from 'vitest';

import { bowOffsets, edgePath, groupByEndpoints, trimToRadius } from './geometry';

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

describe('edgePath', () => {
  it('draws a straight line when asked and unbowed', () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 10, y: 10 }, 'straight')).toBe('M 0 0 L 10 10');
  });

  it('bows a curve to the requested side', () => {
    const left = edgePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 'bezier', 20);
    const right = edgePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 'bezier', -20);
    expect(left).not.toBe(right);
    expect(left).toContain('Q');
  });

  it('routes orthogonally through a midpoint', () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 100, y: 50 }, 'orthogonal')).toBe('M 0 0 L 50 0 L 50 50 L 100 50');
  });

  it('gives a self-loop a visible shape rather than a zero-length path', () => {
    const path = edgePath({ x: 10, y: 10 }, { x: 10, y: 10 }, 'bezier');
    expect(path).toContain('C');
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
