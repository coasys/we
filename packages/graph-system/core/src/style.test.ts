/**
 * Style-rule tests.
 *
 * The behaviour worth pinning is the cascade — rules apply in order and merge per property — because
 * that is what lets an author write "everything grey, beliefs purple, unresolved outlined" as three
 * readable rules instead of one nested condition. Get the merge wrong and the last rule silently wins
 * everything.
 */
import type { GraphNode } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { edgeVisual, matches, nodeVisual, resolveColor, resolveNumber, resolveStyle } from './style';

const belief: GraphNode = {
  id: 'a',
  kind: 'entity',
  type: 'Belief',
  label: 'The error rate doubled',
  data: { confidence: 0.8, author: 'james' },
};

const NO_METRICS = new Map<string, ReadonlyMap<string, number>>();

describe('match clauses', () => {
  it('matches on a plain field', () => {
    expect(matches(belief, { type: 'Belief' })).toBe(true);
    expect(matches(belief, { type: 'Task' })).toBe(false);
  });

  it('ANDs sibling keys', () => {
    expect(matches(belief, { type: 'Belief', kind: 'entity' })).toBe(true);
    expect(matches(belief, { type: 'Belief', kind: 'literal' })).toBe(false);
  });

  it('reaches into the data bag', () => {
    expect(matches(belief, { 'data.author': 'james' })).toBe(true);
    expect(matches(belief, { 'data.confidence': { gt: 0.5 } })).toBe(true);
    expect(matches(belief, { 'data.confidence': { gt: 0.9 } })).toBe(false);
  });

  it('supports the same operators as $filter', () => {
    expect(matches(belief, { label: { contains: 'error' } })).toBe(true);
    expect(matches(belief, { label: { contains: 'ERROR' } })).toBe(true);
    expect(matches(belief, { type: { in: ['Belief', 'Task'] } })).toBe(true);
    expect(matches(belief, { type: { not: 'Belief' } })).toBe(false);
    expect(matches(belief, { 'data.missing': { exists: false } })).toBe(true);
    expect(matches(belief, { 'data.author': { exists: true } })).toBe(true);
  });

  it('treats an absent clause as matching everything', () => {
    expect(matches(belief, undefined)).toBe(true);
  });
});

describe('style resolution', () => {
  it('merges matching rules in order, last wins per property', () => {
    const style = resolveStyle(belief, [
      { style: { size: 10, color: 'neutral-400' } },
      { when: { type: 'Belief' }, style: { color: 'primary-500' } },
    ]);

    // size survives from the base rule; colour is overridden by the later one.
    expect(style).toEqual({ size: 10, color: 'primary-500' });
  });

  it('skips rules that do not match', () => {
    const style = resolveStyle(belief, [{ style: { size: 10 } }, { when: { type: 'Task' }, style: { size: 99 } }]);
    expect(style.size).toBe(10);
  });

  it('marks an unresolved node as a placeholder', () => {
    const visual = nodeVisual({ ...belief, unresolved: true }, {}, NO_METRICS);
    // Not-here-yet has to look different from empty, or a P2P graph lies about what it knows.
    expect(visual.opacity).toBeLessThan(1);
    expect(visual.borderColor).toBeDefined();
  });

  it('falls back to the type when a node has no label', () => {
    const visual = nodeVisual({ id: 'x', kind: 'entity', type: 'Task' }, {}, NO_METRICS);
    expect(visual.label).toBe('Task');
  });
});

describe('metric references', () => {
  const metrics = new Map([['degree', new Map([['a', 0.5]])]]);

  it('maps a metric onto a numeric range', () => {
    expect(resolveNumber({ metric: 'degree', range: [10, 30] }, 'a', metrics, 12)).toBe(20);
  });

  it('maps a metric onto a named colour scale', () => {
    expect(resolveColor({ metric: 'degree', scale: 'heat' }, 'a', metrics, 'neutral-500')).toBe('primary-500');
  });

  it('falls back when the metric has not been computed', () => {
    // Metrics run on user action, so a rule referencing one is legitimately unresolved until then —
    // drawing plainly beats refusing to draw.
    expect(resolveNumber({ metric: 'betweenness' }, 'a', metrics, 14)).toBe(14);
    expect(resolveColor({ metric: 'betweenness' }, 'a', metrics, 'neutral-500')).toBe('neutral-500');
  });
});

describe('card content', () => {
  const card = { id: 'c1', kind: 'entity' as const, type: 'CollectionBlock', label: 'Idea' };

  it('carries a named content renderer through to the visual', () => {
    const visual = nodeVisual(card, { shape: 'card', content: 'block', contentMinZoom: 0.5 }, NO_METRICS);

    expect(visual.content).toBe('block');
    expect(visual.contentMinZoom).toBe(0.5);
  });

  it('ignores it on anything that is not a card', () => {
    // A dot has nowhere to put content, and passing the name through anyway would have a renderer
    // looking up a component it has no room to draw.
    const visual = nodeVisual(card, { shape: 'circle', content: 'block' }, NO_METRICS);

    expect(visual.content).toBeUndefined();
  });
});

describe('rule lists built from data', () => {
  it('flattens a nested group so a mapped rule sits among hand-written ones', () => {
    // A schema cannot merge two arrays — `$concat` joins strings — so a template that wants a base
    // rule plus one rule per row of data has no way to write the combined list. Nesting is how a
    // `$map` over a community's own vocabulary contributes rules alongside the authored ones.
    const style = resolveStyle(belief, [
      { style: { size: 10 } },
      [
        { when: { type: 'Belief' }, style: { color: 'primary-500' } },
        { when: { type: 'Task' }, style: { color: 'danger-500' } },
      ],
    ]);

    expect(style).toEqual({ size: 10, color: 'primary-500' });
  });

  it('applies a nested group in the position it occupies, not last', () => {
    // Precedence has to read exactly as written, or a template author cannot reason about which
    // rule wins by looking at the list.
    const style = resolveStyle(belief, [[{ style: { color: 'neutral-500' } }], { style: { color: 'primary-700' } }]);

    expect(style).toEqual({ color: 'primary-700' });
  });

  it('treats an empty group as no rules at all', () => {
    // A `$map` over a space that has named nothing yet. It must leave the hand-written rules alone
    // rather than resolving to something that overrides them.
    const style = resolveStyle(belief, [{ style: { size: 12 } }, []]);

    expect(style).toEqual({ size: 12 });
  });
});

describe('defaults', () => {
  it('scales labels and edges with the camera unless told otherwise', () => {
    // The intuition people arrive with is a board, where zoom magnifies the whole drawing. Constant
    // on-screen size is the specialist choice, so it is the one you ask for.
    expect(nodeVisual(belief, {}, NO_METRICS).scaleLabelWithZoom).toBe(true);
    expect(edgeVisual({ id: 'e', source: 'a', target: 'b', type: 'rel' }, {}, NO_METRICS).scaleWithZoom).toBe(true);
  });

  it('treats an omitted option as the default, never as off', () => {
    // `undefined` and `false` must not collapse into each other — an author who said nothing has not
    // asked for the opposite, which is how a graph ends up with no arrows because nobody mentioned
    // arrows.
    const edge = edgeVisual({ id: 'e', source: 'a', target: 'b', type: 'rel' }, {}, NO_METRICS);
    expect(edge.arrow).toBe('target');
    expect(edge.curve).toBe('smooth');

    const off = edgeVisual({ id: 'e', source: 'a', target: 'b', type: 'rel' }, { scaleWithZoom: false }, NO_METRICS);
    expect(off.scaleWithZoom).toBe(false);
  });

  it('derives a card height from its width, so widening keeps the shape', () => {
    const visual = nodeVisual(belief, { shape: 'card', width: 200 }, NO_METRICS);
    expect(visual.height).toBe(150);
    // `size` becomes the half-extent, which is what hit-testing reads.
    expect(visual.size).toBe(100);
  });
});
