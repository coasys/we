/**
 * Board seed tests.
 *
 * The failures here are the quiet kind. A placement that does not reach its node leaves a card at
 * the origin, which looks like a layout that ignored the data rather than a lookup that missed. A
 * placed type nobody listed is simply never queried, so a community's own model is absent from a
 * board with nothing to say it was skipped. And a `Placement` drawn as a node puts a dot on the
 * canvas for every card, which reads as duplicate content.
 */
import type { EntityShape, ExpanderContext, ExpanderQuery } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { boardSeed } from './board';

const SHAPES: EntityShape[] = [
  {
    name: 'CollectionBlock',
    identityProperty: 'title',
    properties: [{ name: 'title', type: 'string' }],
    relations: [],
  },
  { name: 'TaskBlock', identityProperty: 'title', properties: [{ name: 'title', type: 'string' }], relations: [] },
  {
    name: 'Sighting',
    identityProperty: 'name',
    properties: [{ name: 'name', type: 'string' }],
    relations: [],
  },
  { name: 'CodeBlock', identityProperty: 'title', properties: [{ name: 'title', type: 'string' }], relations: [] },
  {
    name: 'Placement',
    properties: [
      { name: 'nodeType', type: 'string' },
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
    ],
    relations: [{ name: 'node', target: '', cardinality: 'one' }],
  },
];

/**
 * Rows by entity, answered the two ways a board asks for them.
 *
 * A drill-down is answered only for the board being asked about; a `where: { id: [...] }` is
 * answered by set membership, which is what the backend does with a bare array. The fake has to know
 * both, because the board's whole design is that placement and containment are different questions —
 * one that only answered drill-downs would make a placed-but-unowned record look unreachable when it
 * is precisely the case the split exists for.
 */
function context(tables: Record<string, Record<string, unknown>[]>, board = 'b1') {
  const asked: string[] = [];
  const warnings: string[] = [];
  return {
    asked,
    warnings,
    context: {
      query: async (request: ExpanderQuery) => {
        asked.push(request.entity);
        const rows = tables[request.entity] ?? [];
        const ids = (request.where as { id?: unknown } | undefined)?.id;
        if (Array.isArray(ids)) return rows.filter((row) => ids.includes(row.id));
        if (request.scope?.anchorId !== board) return [];
        return rows;
      },
      defaultDataset: () => 'ds',
      models: () => SHAPES,
      warn: (m: string) => warnings.push(m),
    } as ExpanderContext,
  };
}

describe('boardSeed', () => {
  it('places a card at the coordinate recorded against the board', async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 120, y: 40 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
    });

    const { nodes } = await boardSeed().seed({ board: 'b1' }, ctx);
    const card = nodes.find((n) => n.type === 'CollectionBlock');

    // Coordinates land in `data`, which is where the `manual` layout reads them — a seed that
    // returned them anywhere else would only work with a layout written to expect it.
    expect(card?.data).toMatchObject({ x: 120, y: 40 });
  });

  it('returns a contained card that has never been placed, with no coordinate', async () => {
    // A card composed onto a board has containment and no placement yet. It must appear — the
    // layout parks it — rather than waiting for somebody to drag it before it exists.
    const { context: ctx } = context({ CollectionBlock: [{ id: 'c1', title: 'Fresh' }] });

    const { nodes } = await boardSeed().seed({ board: 'b1' }, ctx);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.x).toBeUndefined();
  });

  it('loads a placed type nobody listed, so a board can hold a model the template never heard of', async () => {
    // The whole reason placements are read first: they *are* the membership, and a community's own
    // models are not in any list a template could have written.
    const { context: ctx, asked } = context({
      Placement: [{ id: 'p1', node: 's1', nodeType: 'Sighting', x: 10, y: 20 }],
      Sighting: [{ id: 's1', name: 'Heron' }],
    });

    const { nodes } = await boardSeed().seed({ board: 'b1' }, ctx);

    expect(asked).toContain('Sighting');
    expect(nodes.find((n) => n.type === 'Sighting')?.data).toMatchObject({ x: 10, y: 20 });
  });

  it('never draws a placement as a node', async () => {
    // A dot per card, saying nothing and doubling the node count.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
    });

    const { nodes } = await boardSeed().seed({ board: 'b1', contains: ['CollectionBlock', 'Placement'] }, ctx);

    expect(nodes.every((n) => n.type !== 'Placement')).toBe(true);
  });

  it('draws no edges — a board is a surface, not a hierarchy', async () => {
    // Containment is how a board holds things, not what it is about. Edges would make it a
    // hub-and-spoke diagram around a parent that is not even on the canvas.
    const { context: ctx } = context({ CollectionBlock: [{ id: 'c1', title: 'Idea' }] });

    expect((await boardSeed().seed({ board: 'b1' }, ctx)).edges).toEqual([]);
  });

  it('loads nothing at all until a board is chosen', async () => {
    // A picker whose `$local` is still empty. Loading the types wholesale would fill the canvas
    // with every card in the space, which is worse than an empty one.
    const { context: ctx, asked } = context({ CollectionBlock: [{ id: 'c1', title: 'Idea' }] });

    const result = await boardSeed().seed({ board: '' }, ctx);

    expect(result.nodes).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('asks for nothing but collections when no placement names anything else', async () => {
    // There is exactly one way onto a board that leaves no placement: a card composed straight onto
    // it. Everything else arrives placed, so its type is already named — and listing more types
    // would cost a drill-down each, on every load, looking for what cannot be there.
    const { context: ctx, asked } = context({ CollectionBlock: [{ id: 'c1', title: 'Idea' }] });

    await boardSeed().seed({ board: 'b1' }, ctx);

    expect(asked).toEqual(['Placement', 'CollectionBlock']);
  });

  it('finds a placed record the board does not own, without it being reparented', async () => {
    // The case containment could never express: a task owned by a call, put on a board. Asking for
    // the board's children would never return it, and making it a child to fix that would move it
    // out of the call it came from.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 't1', nodeType: 'TaskBlock', x: 30, y: 60 }],
      // Deliberately answers no drill-down for this board — it is not a child of it.
      TaskBlock: [{ id: 't1', title: 'Ship the docs' }],
    });

    const { nodes } = await boardSeed().seed({ board: 'b1' }, ctx);

    expect(nodes.find((n) => n.type === 'TaskBlock')?.data).toMatchObject({ x: 30, y: 60 });
  });

  it('counts a record once when it is both placed and owned', async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 10, y: 20 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
    });

    const { nodes } = await boardSeed().seed({ board: 'b1' }, ctx);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].data).toMatchObject({ x: 10, y: 20 });
  });

  it('skips a placement whose node never linked, rather than half-drawing it', async () => {
    // It names a type and points at nothing, so the record it meant is not knowable from here.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', nodeType: 'CodeBlock', x: 30, y: 60 }],
      CodeBlock: [{ id: 'k1', title: 'Snippet' }],
    });

    const { nodes } = await boardSeed().seed({ board: 'b1' }, ctx);

    expect(nodes.find((n) => n.type === 'CodeBlock')).toBeUndefined();
  });

  it('skips a placed type the dataset does not declare rather than querying it', async () => {
    const { context: ctx, asked } = context({
      Placement: [{ id: 'p1', node: 'g1', nodeType: 'Ghost', x: 1, y: 2 }],
    });

    await boardSeed().seed({ board: 'b1' }, ctx);

    expect(asked).not.toContain('Ghost');
  });
});
