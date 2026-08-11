/**
 * Metric tests.
 *
 * Both metrics feed *styling*, so the property that matters most is determinism: label propagation
 * with random tie-breaking recolours the same graph differently on every run, which reads as the data
 * having changed. The rest is normalisation, since a rule's `range` maps from 0..1 and a metric
 * returning raw counts would make every rule depend on the size of the dataset.
 */
import { describe, expect, it } from 'vitest';

import { communityMetric, degreeMetric } from './metrics';

const graph = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  edges: [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
    { source: 'a', target: 'd' },
  ],
};

describe('degree', () => {
  it('normalises the most connected to 1 and the least to 0', () => {
    const values = degreeMetric.compute(graph);
    expect(values.get('a')).toBe(1);
    expect(values.get('b')).toBe(0);
  });

  it('returns 0 rather than NaN when every node is equal', () => {
    // An all-equal graph has no span; dividing by it is the obvious bug.
    const values = degreeMetric.compute({
      nodes: [{ id: 'x' }, { id: 'y' }],
      edges: [{ source: 'x', target: 'y' }],
    });
    expect([...values.values()]).toEqual([0, 0]);
  });

  it('counts an edge once from either end', () => {
    const values = degreeMetric.compute({ nodes: [{ id: 'x' }], edges: [] });
    expect(values.get('x')).toBe(0);
  });
});

describe('community', () => {
  const twoClusters = {
    nodes: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => ({ id })),
    edges: [
      { source: 'a1', target: 'a2' },
      { source: 'a2', target: 'a3' },
      { source: 'a3', target: 'a1' },
      { source: 'b1', target: 'b2' },
      { source: 'b2', target: 'b3' },
      { source: 'b3', target: 'b1' },
    ],
  };

  it('separates two disconnected triangles', () => {
    const values = communityMetric.compute(twoClusters);
    expect(values.get('a1')).toBe(values.get('a2'));
    expect(values.get('b1')).toBe(values.get('b2'));
    expect(values.get('a1')).not.toBe(values.get('b1'));
  });

  it('gives the same answer every time', () => {
    // Ties break on node id rather than at random, so a map does not recolour itself on reload.
    const first = communityMetric.compute(twoClusters);
    for (let run = 0; run < 5; run += 1) {
      const again = communityMetric.compute(twoClusters);
      for (const [id, value] of first) expect(again.get(id)).toBe(value);
    }
  });

  it('handles a graph with no edges without dividing by zero', () => {
    const values = communityMetric.compute({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect([...values.values()].every((v) => Number.isFinite(v))).toBe(true);
  });
});
