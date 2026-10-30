/**
 * A focus on a canvas: the rules it becomes, evaluated by the expression engine the renderer uses, and
 * then applied to nodes by the graph's own style resolver — so what is checked is what is dimmed, not
 * only the shape of the rules. Checking the shape alone passed a focus whose rules the graph could not
 * read, and the space's template failed as soon as a definition was chosen.
 */
import { resolveStyle } from '@we/graph-core';
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { FOCUS_DIM, focusDim, focusDimWhere } from './canvas.ts';

/** A graph's node, as the style resolver reads one. */
type GraphNode = Extract<Parameters<typeof resolveStyle>[0], { kind: string }>;

const run = (prop: unknown, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression((prop as { $: string }).$), {
    root: (name) => ({ bound: name in roots, value: roots[name] }),
    call: (name, args) =>
      listFunctions()
        .find((f) => f.name === name)
        ?.impl(args, { context: {}, stores: {} }),
  });

const node = (id: string, data: Record<string, string>, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind: 'entity',
  type: 'TaskBlock',
  data,
  ...extra,
});

/** Each node's opacity under a base rule and the focus's rules, as a graph would resolve them. */
const opacities = (nodes: GraphNode[], focus: unknown[], roots: Record<string, unknown>) => {
  const rules = [{ style: { opacity: 1 } }, ...focus.map((rule) => run(rule, roots))];
  return Object.fromEntries(
    nodes.map((n) => [n.id, (resolveStyle(n, rules as never) as { opacity?: number }).opacity]),
  );
};

describe('a focus on a canvas', () => {
  const cards = [
    node('a', { origin: 'call-1', author: 'did:ada', recordId: 'a' }),
    node('b', { origin: 'call-2', author: 'did:bo', recordId: 'b' }),
  ];

  it('dims every card whose field is not the focus, and nothing while there is no focus', () => {
    const rule = focusDim('on', 'data.origin', 'call');
    expect(opacities(cards, [rule], { on: true, call: 'call-1' })).toEqual({ a: 1, b: FOCUS_DIM });
    expect(opacities(cards, [rule], { on: false, call: 'call-1' })).toEqual({ a: 1, b: 1 });
  });

  it('takes a list of values, for the records in a workflow', () => {
    const rule = focusDim('on', 'data.recordId', 'ids');
    expect(opacities(cards, [rule], { on: true, ids: ['b'] })).toEqual({ a: FOCUS_DIM, b: 1 });
  });

  /*
    A map where one word is chosen: the other kinds and what they hold dimmed, and the word's siblings —
    while what the chosen word opened into (a field, in no bucket) stays whole.
  */
  it('dims whatever a clause names, leaving what it does not mention — the fields a chosen word opened into', () => {
    const map = [
      node('signals', { bucket: 'signals' }, { kind: 'cluster', type: 'vocabulary' }),
      node('like', { bucket: 'signals', recordId: 'like' }),
      node('rating', { bucket: 'signals', recordId: 'rating' }),
      node('like-mode', {}, { kind: 'property', type: 'mode' }),
      node('states', { bucket: 'states' }, { kind: 'cluster', type: 'vocabulary' }),
    ];
    const rules = [
      focusDimWhere('on', "{ 'data.bucket': { exists: true, not: 'signals' } }"),
      focusDimWhere(
        'on',
        "{ 'data.bucket': 'signals', type: { not: 'vocabulary' }, 'data.recordId': { not: 'like' } }",
      ),
    ];
    expect(opacities(map, rules, { on: true })).toEqual({
      signals: 1,
      like: 1,
      rating: FOCUS_DIM,
      'like-mode': 1,
      states: FOCUS_DIM,
    });
    expect(Object.values(opacities(map, rules, { on: false }))).toEqual([1, 1, 1, 1, 1]);
  });
});
