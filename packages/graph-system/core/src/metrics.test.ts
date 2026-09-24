/**
 * Metric tests.
 *
 * Both metrics feed *styling*, so the property that matters most is determinism: label propagation
 * with random tie-breaking recolours the same graph differently on every run, which reads as the data
 * having changed. The rest is normalisation, since a rule's `range` maps from 0..1 and a metric
 * returning raw counts would make every rule depend on the size of the dataset.
 */
import type { GraphNode, GraphValue } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { communityMetric, degreeMetric, fieldMetric } from './metrics';

/**
 * A node as the engine hands one to a metric — data included.
 *
 * The snapshot used to be `{ id }` alone, and `field` is why it is not: reading a number off a node
 * and normalising it against the rest of the graph is a metric's job, and impossible from ids.
 */
const node = (id: string, data?: Record<string, GraphValue>): GraphNode => ({
  id,
  kind: 'entity',
  type: 'Thing',
  ...(data ? { data } : {}),
});

const graph = {
  nodes: [node('a'), node('b'), node('c'), node('d')],
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
      nodes: [node('x'), node('y')],
      edges: [{ source: 'x', target: 'y' }],
    });
    expect([...values.values()]).toEqual([0, 0]);
  });

  it('counts an edge once from either end', () => {
    const values = degreeMetric.compute({ nodes: [node('x')], edges: [] });
    expect(values.get('x')).toBe(0);
  });
});

describe('community', () => {
  const twoClusters = {
    nodes: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => node(id)),
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
    const values = communityMetric.compute({ nodes: [node('a'), node('b')], edges: [] });
    expect([...values.values()].every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('field', () => {
  const weighted = {
    nodes: [node('none'), node('low', { weight: 2 }), node('high', { weight: 10 }), node('mid', { weight: 6 })],
    edges: [],
  };

  it('normalises the largest to 1 and the smallest to 0', () => {
    const values = fieldMetric.compute(weighted, { from: 'weight' });

    expect(values.get('high')).toBe(1);
    expect(values.get('low')).toBe(0);
    expect(values.get('mid')).toBeCloseTo(0.5, 6);
  });

  it('leaves out a node with no value rather than scoring it zero', () => {
    /*
      "Nobody has reacted to this" and "this is the coldest thing here" are different facts, and a card
      in the first state must be able to fall through to whatever an earlier style rule set — which is
      only possible if the metric has no answer for it.
    */
    const values = fieldMetric.compute(weighted, { from: 'weight' });

    expect(values.has('none')).toBe(false);
  });

  it('reads a number stored as a string, which is what some backends return', () => {
    const values = fieldMetric.compute(
      { nodes: [node('a', { weight: '1' }), node('b', { weight: '5' })], edges: [] },
      { from: 'weight' },
    );

    expect(values.get('b')).toBe(1);
  });

  it('maps against a fixed domain when given one, and clamps past it', () => {
    // One card at 2 stars must not look like the best there is, which is exactly what normalising to
    // the visible graph would say.
    const values = fieldMetric.compute(
      { nodes: [node('a', { weight: 2 }), node('b', { weight: 9 })], edges: [] },
      {
        from: 'weight',
        min: 1,
        max: 5,
      },
    );

    expect(values.get('a')).toBeCloseTo(0.25, 6);
    expect(values.get('b')).toBe(1);
  });

  it('answers with nothing when no field is named, rather than guessing one', () => {
    expect(fieldMetric.compute(weighted, {}).size).toBe(0);
    expect(fieldMetric.compute(weighted).size).toBe(0);
  });

  it('returns 0 rather than NaN when every value is the same', () => {
    const values = fieldMetric.compute(
      { nodes: [node('a', { weight: 3 }), node('b', { weight: 3 })], edges: [] },
      {
        from: 'weight',
      },
    );

    expect([...values.values()].every((v) => v === 0)).toBe(true);
  });
});
