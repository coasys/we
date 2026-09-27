/**
 * Canvas seed tests.
 *
 * The failures here are the quiet kind. A placement that does not reach its node leaves a card at
 * the origin, which looks like a layout that ignored the data rather than a lookup that missed. A
 * placed type nobody listed is simply never queried, so a community's own model is absent from a
 * canvas with nothing to say it was skipped. And a `Placement` drawn as a node puts a dot on the
 * canvas for every card, which reads as duplicate content.
 */
import type { EntityShape, ExpanderContext, ExpanderQuery } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { canvasSeed, PLACEMENT_UNSET, weighSignals } from './canvas';

const SHAPES: EntityShape[] = [
  {
    name: 'CollectionBlock',
    identityProperty: 'title',
    properties: [{ name: 'title', type: 'string' }],
    // The `WeNode` relations, untyped: what `counts` is asked over. `Sighting` below deliberately
    // has none, which is the case that must not take a type off the canvas.
    relations: [
      { name: 'signals', target: 'Signal', cardinality: 'many' },
      { name: 'comments', target: '', cardinality: 'many' },
    ],
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
    name: 'TypeStyle',
    identityProperty: 'nodeType',
    properties: [
      { name: 'nodeType', type: 'string' },
      { name: 'color', type: 'string' },
    ],
    relations: [],
  },
  {
    name: 'ImageBlock',
    identityProperty: 'src',
    properties: [
      { name: 'src', type: 'string' },
      // The picture's own pixel size, which is exactly what a placement's `width` must not collide
      // with — see the namespacing test below.
      { name: 'width', type: 'number' },
      { name: 'height', type: 'number' },
    ],
    relations: [],
  },
  {
    name: 'Relationship',
    identityProperty: 'label',
    properties: [
      { name: 'label', type: 'string' },
      { name: 'sourceType', type: 'string' },
      { name: 'targetType', type: 'string' },
    ],
    relations: [
      { name: 'source', target: '', cardinality: 'one' },
      { name: 'target', target: '', cardinality: 'one' },
      { name: 'signals', target: 'Signal', cardinality: 'many' },
      { name: 'comments', target: '', cardinality: 'many' },
    ],
  },
  {
    name: 'EdgeRoute',
    properties: [
      { name: 'sourceAnchor', type: 'string' },
      { name: 'targetAnchor', type: 'string' },
      { name: 'points', type: 'string' },
    ],
    relations: [{ name: 'connection', target: '', cardinality: 'one' }],
  },
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
 * Rows by entity, answered the two ways a canvas asks for them.
 *
 * A drill-down is answered only for the canvas being asked about; a `where: { id: [...] }` is
 * answered by set membership, which is what the backend does with a bare array. The fake has to know
 * both, because the canvas's whole design is that placement and containment are different questions —
 * one that only answered drill-downs would make a placed-but-unowned record look unreachable when it
 * is precisely the case the split exists for.
 */
function context(tables: Record<string, Record<string, unknown>[]>, rounds?: string[][], canvas = 'b1') {
  const asked: string[] = [];
  const warnings: string[] = [];
  /*
    Queries issued in one synchronous burst are one round.

    Answering on a macrotask is what makes that observable: everything a `Promise.all` issues lands
    before the first answer does, so the burst closes exactly when the seed next has to wait. Without
    it a sequential seed and a batched one look identical from here, which is the difference this is
    measuring.
  */
  let round: string[] | null = null;
  const openRound = (entity: string) => {
    if (!rounds) return;
    if (!round) {
      round = [];
      rounds.push(round);
      setTimeout(() => {
        round = null;
      }, 0);
    }
    round.push(entity);
  };

  return {
    asked,
    warnings,
    context: {
      query: async (request: ExpanderQuery) => {
        asked.push(request.entity);
        openRound(request.entity);
        if (rounds) await new Promise((resolve) => setTimeout(resolve, 0));
        const rows = tables[request.entity] ?? [];
        const where = request.where as Record<string, unknown> | undefined;
        if (where) {
          // A bare array is set membership, on a relation field as much as on `id` — the backend
          // emits a SPARQL `VALUES` clause either way.
          return rows.filter((row) =>
            Object.entries(where).every(([field, expected]) =>
              Array.isArray(expected) ? expected.includes(row[field]) : row[field] === expected,
            ),
          );
        }
        if (request.scope?.anchorId !== canvas) return [];
        return rows;
      },
      defaultDataset: () => 'ds',
      models: () => SHAPES,
      warn: (m: string) => warnings.push(m),
    } as ExpanderContext,
  };
}

describe('canvasSeed', () => {
  it('places a card at the coordinate recorded against the canvas', async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 120, y: 40 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);
    const card = nodes.find((n) => n.type === 'CollectionBlock');

    // Coordinates land in `data`, which is where the `manual` layout reads them — a seed that
    // returned them anywhere else would only work with a layout written to expect it.
    expect(card?.data).toMatchObject({ x: 120, y: 40 });
  });

  it('returns a contained card that has never been placed, with no coordinate', async () => {
    // A card composed onto a canvas has containment and no placement yet. It must appear — the
    // layout parks it — rather than waiting for somebody to drag it before it exists.
    const { context: ctx } = context({ CollectionBlock: [{ id: 'c1', title: 'Fresh' }] });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.x).toBeUndefined();
  });

  it('loads a placed type nobody listed, so a canvas can hold a model the template never heard of', async () => {
    // The whole reason placements are read first: they *are* the membership, and a community's own
    // models are not in any list a template could have written.
    const { context: ctx, asked } = context({
      Placement: [{ id: 'p1', node: 's1', nodeType: 'Sighting', x: 10, y: 20 }],
      Sighting: [{ id: 's1', name: 'Heron' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(asked).toContain('Sighting');
    expect(nodes.find((n) => n.type === 'Sighting')?.data).toMatchObject({ x: 10, y: 20 });
  });

  it('counts what people made of a card, in the read that was happening anyway', async () => {
    // One more projection on a query the seed already makes, rather than a subscription per card —
    // which is the difference between a canvas of three hundred cards loading and not.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea', $signalsCount: 3, $commentsCount: 2 }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', counts: ['signals', 'comments'] }, ctx);

    expect(nodes[0].data).toMatchObject({ signalsCount: 3, commentsCount: 2 });
  });

  it('counts what people made of a connection too, so a gesture can tell a discussed line from a bare one', async () => {
    const { context: ctx } = context({
      Placement: [
        { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
        { id: 'p2', node: 'c2', nodeType: 'CollectionBlock', x: 200, y: 0 },
      ],
      CollectionBlock: [
        { id: 'c1', title: 'One' },
        { id: 'c2', title: 'Two' },
      ],
      Relationship: [
        {
          id: 'r1',
          source: 'c1',
          sourceType: 'CollectionBlock',
          target: 'c2',
          targetType: 'CollectionBlock',
          $commentsCount: 2,
          $signalsCount: 0,
        },
      ],
    });

    const { edges } = await canvasSeed().seed(
      { canvas: 'b1', connections: 'Relationship', counts: ['signals', 'comments'] },
      ctx,
    );

    expect(edges[0].data).toMatchObject({ commentsCount: 2 });
    expect(edges[0].data?.signalsCount).toBeUndefined();
  });

  it('leaves a zero out, so a card can ask whether the field is there', async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea', $signalsCount: 0, $commentsCount: 0 }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', counts: ['signals', 'comments'] }, ctx);

    expect(nodes[0].data?.signalsCount).toBeUndefined();
    expect(nodes[0].data?.commentsCount).toBeUndefined();
  });

  it('asks a type for no count it cannot answer, rather than losing the type to a refused query', async () => {
    // A count over a relation an entity does not declare is a refused read, and the refusal would
    // take every card of that type off the canvas — cards, lines and all — to save a number.
    const asked: ExpanderQuery[] = [];
    const { context: ctx } = context({
      Placement: [
        { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
        { id: 'p2', node: 's1', nodeType: 'Sighting', x: 10, y: 10 },
      ],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
      Sighting: [{ id: 's1', name: 'Heron' }],
    });
    const query = ctx.query;
    ctx.query = async (request: ExpanderQuery) => {
      asked.push(request);
      return query(request);
    };

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', counts: ['signals', 'comments'] }, ctx);

    expect(asked.find((q) => q.entity === 'CollectionBlock')?.include).toMatchObject({
      $signalsCount: { from: 'signals', count: true },
    });
    expect(asked.find((q) => q.entity === 'Sighting')?.include).toBeUndefined();
    expect(nodes.find((n) => n.type === 'Sighting')).toBeDefined();
  });

  it('never draws a placement as a node', async () => {
    // A dot per card, saying nothing and doubling the node count.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', contains: ['CollectionBlock', 'Placement'] }, ctx);

    expect(nodes.every((n) => n.type !== 'Placement')).toBe(true);
  });

  it('draws no edges — a canvas is a surface, not a hierarchy', async () => {
    // Containment is how a canvas holds things, not what it is about. Edges would make it a
    // hub-and-spoke diagram around a parent that is not even on the canvas.
    const { context: ctx } = context({ CollectionBlock: [{ id: 'c1', title: 'Idea' }] });

    expect((await canvasSeed().seed({ canvas: 'b1' }, ctx)).edges).toEqual([]);
  });

  it('loads nothing at all until a canvas is chosen', async () => {
    // A picker whose `$local` is still empty. Loading the types wholesale would fill the canvas
    // with every card in the space, which is worse than an empty one.
    const { context: ctx, asked } = context({ CollectionBlock: [{ id: 'c1', title: 'Idea' }] });

    const result = await canvasSeed().seed({ canvas: '' }, ctx);

    expect(result.nodes).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('asks for nothing but collections when no placement names anything else', async () => {
    // There is exactly one way onto a canvas that leaves no placement: a card composed straight onto
    // it. Everything else arrives placed, so its type is already named — and listing more types
    // would cost a drill-down each, on every load, looking for what cannot be there.
    const { context: ctx, asked } = context({ CollectionBlock: [{ id: 'c1', title: 'Idea' }] });

    await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(asked).toEqual(['Placement', 'CollectionBlock']);
  });

  it('finds a placed record the canvas does not own, without it being reparented', async () => {
    // The case containment could never express: a task owned by a call, put on a canvas. Asking for
    // the canvas's children would never return it, and making it a child to fix that would move it
    // out of the call it came from.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 't1', nodeType: 'TaskBlock', x: 30, y: 60 }],
      // Deliberately answers no drill-down for this canvas — it is not a child of it.
      TaskBlock: [{ id: 't1', title: 'Ship the docs' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(nodes.find((n) => n.type === 'TaskBlock')?.data).toMatchObject({ x: 30, y: 60 });
  });

  it('counts a record once when it is both placed and owned', async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 10, y: 20 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].data).toMatchObject({ x: 10, y: 20 });
  });

  it('skips a placement whose node never linked, rather than half-drawing it', async () => {
    // It names a type and points at nothing, so the record it meant is not knowable from here.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', nodeType: 'CodeBlock', x: 30, y: 60 }],
      CodeBlock: [{ id: 'k1', title: 'Snippet' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(nodes.find((n) => n.type === 'CodeBlock')).toBeUndefined();
  });

  it('reads the whole canvas in three rounds, whatever it holds', async () => {
    /*
      What decides how long a canvas takes to appear is the number of *sequential* rounds, not the
      number of queries: every read is a round trip to a peer-to-peer data layer. Five kinds of thing
      on a canvas used to be five queries deep before anything was drawn.

      Three is the floor, and each genuinely waits on the one before: what is placed, then the
      records it names, then the connections between them.
    */
    const rounds: string[][] = [];
    const { context: ctx } = context(
      {
        Placement: [
          { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
          { id: 'p2', node: 't1', nodeType: 'TaskBlock', x: 100, y: 0 },
          { id: 'p3', node: 'k1', nodeType: 'CodeBlock', x: 200, y: 0 },
        ],
        CollectionBlock: [{ id: 'c1', title: 'One' }],
        TaskBlock: [{ id: 't1', title: 'Two' }],
        CodeBlock: [{ id: 'k1', title: 'Three' }],
        TypeStyle: [{ id: 's1', nodeType: 'TaskBlock', color: 'warning-200' }],
        Relationship: [],
      },
      rounds,
    );

    await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship', typeStyles: 'TypeStyle' }, ctx);

    // Placements and the key together; then every record type together — including the second
    // `CollectionBlock` read, which is the tray, asked by containment rather than by id; then the
    // connections, which could not be asked for until the ends were known.
    expect(rounds).toEqual([
      ['Placement', 'TypeStyle'],
      ['CollectionBlock', 'TaskBlock', 'CodeBlock', 'CollectionBlock'],
      ['Relationship'],
    ]);
  });

  it("colours a node by its type, from the canvas's own key", async () => {
    const { context: ctx } = context({
      Placement: [
        { id: 'p1', node: 't1', nodeType: 'TaskBlock', x: 0, y: 0 },
        { id: 'p2', node: 'c1', nodeType: 'CollectionBlock', x: 40, y: 0 },
      ],
      TaskBlock: [{ id: 't1', title: 'Ship it' }],
      CollectionBlock: [{ id: 'c1', title: 'A note' }],
      TypeStyle: [{ id: 's1', nodeType: 'TaskBlock', color: 'warning-200' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', typeStyles: 'TypeStyle', contains: [] }, ctx);

    const task = nodes.find((node) => node.type === 'TaskBlock');
    const note = nodes.find((node) => node.type === 'CollectionBlock');
    expect(task?.data?.canvasTypeColor).toBe('warning-200');
    // Untouched, so the rule reading it defers and the note keeps whatever the canvas's own rules say.
    expect(note?.data).not.toHaveProperty('canvasTypeColor');
  });

  it("lets a card's own colour sit in front of its type's", async () => {
    // Two layers rather than one, because they answer different questions: "tasks are amber here" is
    // a fact about the canvas, "this one is red" is a fact about the card. Both are on the node, and
    // the style rules decide which wins.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 't1', nodeType: 'TaskBlock', x: 0, y: 0, color: 'danger-200' }],
      TaskBlock: [{ id: 't1', title: 'Ship it' }],
      TypeStyle: [{ id: 's1', nodeType: 'TaskBlock', color: 'warning-200' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', typeStyles: 'TypeStyle', contains: [] }, ctx);

    expect(nodes[0].data).toMatchObject({ canvasTypeColor: 'warning-200', canvasColor: 'danger-200' });
  });

  it("carries the placement's own presentation onto the node, namespaced", async () => {
    const { context: ctx } = context({
      Placement: [
        {
          id: 'p1',
          node: 'i1',
          nodeType: 'ImageBlock',
          x: 10,
          y: 20,
          width: 320,
          height: 200,
          contentScale: 0.5,
          color: '#ffcc00',
          cardShape: 'round',
        },
      ],
      // The picture is 4000px wide. Unprefixed, that would become the card's width on any canvas
      // where nobody had chosen one — which is why these are namespaced rather than merged bare.
      ImageBlock: [{ id: 'i1', src: 'x.png', width: 4000, height: 3000 }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', contains: [] }, ctx);

    expect(nodes[0].data).toMatchObject({
      x: 10,
      y: 20,
      canvasWidth: 320,
      canvasHeight: 200,
      canvasContentScale: 0.5,
      canvasColor: '#ffcc00',
      canvasCardShape: 'round',
      width: 4000,
    });
  });

  it('reads the unset sentinel as no value, so an override can be taken away', async () => {
    /*
      An empty string cannot be *stored* — `Ad4mModel`'s update skips `''` exactly as it skips
      `undefined` — so "no colour of its own" has to be written as something. A named value the seed
      drops is the same trick `SpacePreference` uses for its two sentinels, and without it a card
      could be given a colour and never have it taken away.
    */
    const { context: ctx } = context({
      Placement: [
        { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0, color: PLACEMENT_UNSET },
        { id: 'p2', node: 'c2', nodeType: 'CollectionBlock', x: 50, y: 0, color: 'danger-100' },
      ],
      CollectionBlock: [
        { id: 'c1', title: 'One' },
        { id: 'c2', title: 'Two' },
      ],
      TypeStyle: [{ id: 's1', nodeType: 'CollectionBlock', color: 'success-100' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', typeStyles: 'TypeStyle', contains: [] }, ctx);

    const cleared = nodes.find((node) => node.label === 'One');
    const overridden = nodes.find((node) => node.label === 'Two');
    // Cleared: nothing of its own, so the style rule defers and it takes its type's colour.
    expect(cleared?.data).not.toHaveProperty('canvasColor');
    expect(cleared?.data?.canvasTypeColor).toBe('success-100');
    expect(overridden?.data?.canvasColor).toBe('danger-100');
  });

  it("reads the sentinel as no value in the canvas's key too", async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'One' }],
      TypeStyle: [{ id: 's1', nodeType: 'CollectionBlock', color: PLACEMENT_UNSET }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', typeStyles: 'TypeStyle', contains: [] }, ctx);

    expect(nodes[0].data).not.toHaveProperty('canvasTypeColor');
  });

  it('omits presentation the placement does not carry', async () => {
    // A style rule reading an absent field defers to the rule above it, which is what lets a card
    // with no colour of its own take the one its type was given. A zero would override that.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0, width: 0, color: '' }],
      CollectionBlock: [{ id: 'c1', title: 'One' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(nodes[0].data).not.toHaveProperty('canvasWidth');
    expect(nodes[0].data).not.toHaveProperty('canvasColor');
  });

  it('draws a connection whose two ends are both on the canvas', async () => {
    const { context: ctx } = context({
      Placement: [
        { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
        { id: 'p2', node: 'c2', nodeType: 'CollectionBlock', x: 200, y: 0 },
      ],
      CollectionBlock: [
        { id: 'c1', title: 'One' },
        { id: 'c2', title: 'Two' },
      ],
      Relationship: [
        {
          id: 'r1',
          label: 'contradicts',
          source: 'c1',
          sourceType: 'CollectionBlock',
          target: 'c2',
          targetType: 'CollectionBlock',
        },
      ],
    });

    const { edges } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship' }, ctx);

    expect(edges).toHaveLength(1);
    expect(edges[0].label).toBe('contradicts');
    // Clicking the line has to be able to open the claim it stands for.
    expect(edges[0].reifiedAs).toContain('Relationship');
  });

  it('drops a connection whose far end is not on the canvas', async () => {
    // A canvas is a closed surface. A line to a record that is not on it would leave the canvas and
    // end nowhere, and pulling the far end in to fix that would put things on the canvas nobody
    // placed.
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'One' }],
      Relationship: [
        {
          id: 'r1',
          label: 'contradicts',
          source: 'c1',
          sourceType: 'CollectionBlock',
          target: 'elsewhere',
          targetType: 'TaskBlock',
        },
      ],
    });

    const { edges, nodes } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship' }, ctx);

    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(1);
  });

  it('asks for no connections when nothing is placed', async () => {
    // Nothing to connect, and the query would be `source: []` — which matches nothing, so asking is
    // a round trip for a known answer.
    const { context: ctx, asked } = context({ CollectionBlock: [{ id: 'c1', title: 'One' }] });

    await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship' }, ctx);

    expect(asked).not.toContain('Relationship');
  });

  it('skips a placed type the dataset does not declare rather than querying it', async () => {
    const { context: ctx, asked } = context({
      Placement: [{ id: 'p1', node: 'g1', nodeType: 'Ghost', x: 1, y: 2 }],
    });

    await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(asked).not.toContain('Ghost');
  });
});

/**
 * Cards that stand for a suggestion nobody has agreed to yet.
 *
 * An extraction pass can stage a whole record rather than writing it, and a staged record is in the
 * graph: it answers this seed's query exactly as an accepted one does. So a canvas drew a card for
 * something nobody had said yes to, identical to the cards for everything they had. Only the
 * capability that staged it knows which those are, which is why this arrives as ids.
 */
describe('the canvas seed — pending records', () => {
  it('marks the named records and leaves the rest alone', async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'task-1', nodeType: 'TaskBlock', x: 10, y: 20 }],
      TaskBlock: [
        { id: 'task-1', title: 'Agreed' },
        { id: 'task-2', title: 'Suggested' },
      ],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', contains: ['TaskBlock'], pending: ['task-2'] }, ctx);

    expect(nodes.find((n) => n.id.endsWith('task-2'))?.data?.pending).toBe(true);
    // Absent, not false: a rule matching `{ pending: true }` and one matching nothing are the two
    // states, and an explicit false is a third value a rule could accidentally match on.
    expect(nodes.find((n) => n.id.endsWith('task-1'))?.data).not.toHaveProperty('pending');
  });

  it('costs nothing when no ids are given', async () => {
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'task-1', nodeType: 'TaskBlock', x: 0, y: 0 }],
      TaskBlock: [{ id: 'task-1', title: 'Agreed' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', contains: ['TaskBlock'] }, ctx);

    expect(nodes[0]?.data).not.toHaveProperty('pending');
  });
});

/**
 * A suggested change to an agreed record is told apart from a suggested record, and a reader can
 * leave suggestions off the canvas altogether.
 *
 * The two used to be one list, so an accepted task a pass merely had an opinion about was faded like
 * a draft — and a "hide suggestions" built on that list would have hidden agreed work.
 */
describe('the canvas seed — changed and hidden records', () => {
  const twoCards = {
    Placement: [
      { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
      { id: 'p2', node: 'c2', nodeType: 'CollectionBlock', x: 200, y: 0 },
    ],
    CollectionBlock: [
      { id: 'c1', title: 'Agreed' },
      { id: 'c2', title: 'Suggested' },
    ],
    Relationship: [
      { id: 'r1', source: 'c1', sourceType: 'CollectionBlock', target: 'c2', targetType: 'CollectionBlock' },
    ],
  };

  it('marks a changed record apart from a pending one', async () => {
    const { context: ctx } = context(twoCards);
    const { nodes } = await canvasSeed().seed({ canvas: 'b1', pending: ['c2'], changed: ['c1'] }, ctx);

    const agreed = nodes.find((n) => n.id.endsWith('c1'));
    expect(agreed?.data?.changed).toBe(true);
    expect(agreed?.data).not.toHaveProperty('pending');
    expect(nodes.find((n) => n.id.endsWith('c2'))?.data).not.toHaveProperty('changed');
  });

  it('leaves a hidden record off, with the connections that reach it', async () => {
    const { context: ctx } = context(twoCards);
    const { nodes, edges } = await canvasSeed().seed(
      { canvas: 'b1', connections: 'Relationship', hidden: ['c2'] },
      ctx,
    );

    expect(nodes.map((n) => n.id.split(/[/:]/).pop())).toEqual(['c1']);
    expect(edges).toHaveLength(0);
  });

  it('leaves a whole type off, with the connections that reach it, and reads nothing of it', async () => {
    const mixed = {
      ...twoCards,
      Placement: [...twoCards.Placement, { id: 'p3', node: 'i1', nodeType: 'ImageBlock', x: 400, y: 0 }],
      ImageBlock: [{ id: 'i1', src: 'x.png' }],
      Relationship: [
        ...twoCards.Relationship,
        { id: 'r2', source: 'c1', sourceType: 'CollectionBlock', target: 'i1', targetType: 'ImageBlock' },
      ],
    };
    const { context: ctx } = context(mixed);
    const { nodes, edges } = await canvasSeed().seed(
      { canvas: 'b1', connections: 'Relationship', hiddenTypes: ['ImageBlock'] },
      ctx,
    );

    expect(nodes.map((n) => n.id.split(/[/:]/).pop()).sort()).toEqual(['c1', 'c2']);
    expect(edges.map((e) => e.id)).toEqual(['canvas-connection|r1']);
  });
});

/**
 * How a canvas draws its connections — which side of a card each line leaves and arrives on.
 *
 * The same shape as the type key above and quiet in the same way: a route that does not reach its
 * edge leaves the line attaching wherever the geometry decides, which looks like an anchor that was
 * never saved rather than one that was saved and never read.
 */
describe('canvas connection routes', () => {
  const twoCards = {
    Placement: [
      { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
      { id: 'p2', node: 'c2', nodeType: 'CollectionBlock', x: 200, y: 0 },
    ],
    CollectionBlock: [
      { id: 'c1', title: 'One' },
      { id: 'c2', title: 'Two' },
    ],
    Relationship: [
      {
        id: 'r1',
        label: 'contradicts',
        source: 'c1',
        sourceType: 'CollectionBlock',
        target: 'c2',
        targetType: 'CollectionBlock',
      },
    ],
  };

  it('reads anchors onto the edge, under the names the router reads', async () => {
    const { context: ctx } = context({
      ...twoCards,
      EdgeRoute: [{ id: 'e1', connection: 'r1', sourceAnchor: 'n', targetAnchor: 'w' }],
    });

    const { edges } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship', routes: 'EdgeRoute' }, ctx);

    expect(edges[0].data).toMatchObject({ sourceAnchor: 'n', targetAnchor: 'w' });
  });

  it('carries an end that was never pinned as absent rather than empty', async () => {
    // The router drops anything that is not a side, so an empty string would route identically —
    // but it would also be a value a style rule could match on, asserting a side nobody chose.
    const { context: ctx } = context({
      ...twoCards,
      EdgeRoute: [{ id: 'e1', connection: 'r1', sourceAnchor: 'e', targetAnchor: '' }],
    });

    const { edges } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship', routes: 'EdgeRoute' }, ctx);

    expect(edges[0].data?.sourceAnchor).toBe('e');
    expect(edges[0].data).not.toHaveProperty('targetAnchor');
  });

  it('leaves a connection nobody has routed alone', async () => {
    const { context: ctx } = context({ ...twoCards, EdgeRoute: [] });

    const { edges } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship', routes: 'EdgeRoute' }, ctx);

    expect(edges[0].data).not.toHaveProperty('sourceAnchor');
  });

  it('costs no extra round trip, being keyed by a record id rather than by what is on the canvas', async () => {
    /*
      What decides how long a canvas takes to appear is the number of *sequential* rounds. A route
      names its connection by id, so it can be read in round one beside the placements — waiting for
      the connections it describes would add a fourth round to every canvas that has any.
    */
    const rounds: string[][] = [];
    const { context: ctx } = context(
      { ...twoCards, EdgeRoute: [{ id: 'e1', connection: 'r1', sourceAnchor: 'n' }], TypeStyle: [] },
      rounds,
    );

    await canvasSeed().seed(
      { canvas: 'b1', connections: 'Relationship', typeStyles: 'TypeStyle', routes: 'EdgeRoute' },
      ctx,
    );

    expect(rounds[0]).toEqual(['Placement', 'TypeStyle', 'EdgeRoute']);
    expect(rounds).toHaveLength(3);
  });

  it('is not drawn as a node, being bookkeeping rather than content', async () => {
    // The same trap a `Placement` is: it is parented to the canvas, so anything reading the canvas's
    // children by containment would put a dot on the canvas for every routed line.
    const { context: ctx } = context({
      ...twoCards,
      EdgeRoute: [{ id: 'e1', connection: 'r1', sourceAnchor: 'n' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship', routes: 'EdgeRoute' }, ctx);

    expect(nodes.map((node) => node.id).some((id) => id.includes('EdgeRoute'))).toBe(false);
  });
});

describe('canvas connection waypoints', () => {
  const twoCards = {
    Placement: [
      { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
      { id: 'p2', node: 'c2', nodeType: 'CollectionBlock', x: 200, y: 0 },
    ],
    CollectionBlock: [
      { id: 'c1', title: 'One' },
      { id: 'c2', title: 'Two' },
    ],
    Relationship: [
      {
        id: 'r1',
        label: 'contradicts',
        source: 'c1',
        sourceType: 'CollectionBlock',
        target: 'c2',
        targetType: 'CollectionBlock',
      },
    ],
  };

  it('carries the stored blob through untouched', async () => {
    // Passed on as the string it was stored as rather than parsed here: a data bag holds scalars, and
    // parsing at the seed only to re-serialise for the router would be the same work done twice.
    const points = '[{"along":0.5,"across":0.3}]';
    const { context: ctx } = context({ ...twoCards, EdgeRoute: [{ id: 'e1', connection: 'r1', points }] });

    const { edges } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship', routes: 'EdgeRoute' }, ctx);

    expect(edges[0].data?.waypoints).toBe(points);
  });

  it('leaves a route carrying only anchors without a waypoints field', async () => {
    const { context: ctx } = context({
      ...twoCards,
      EdgeRoute: [{ id: 'e1', connection: 'r1', sourceAnchor: 'n', points: '' }],
    });

    const { edges } = await canvasSeed().seed({ canvas: 'b1', connections: 'Relationship', routes: 'EdgeRoute' }, ctx);

    expect(edges[0].data?.sourceAnchor).toBe('n');
    expect(edges[0].data).not.toHaveProperty('waypoints');
  });
});

/**
 * What the canvas asks for, and what it says when it cannot ask for everything.
 *
 * Both of these are about cost and about honesty rather than about what ends up on screen — which is
 * why neither was noticed: the canvas looked right in every case below.
 */
describe('the canvas seed’s reads', () => {
  it('asks one question once, however many times it was listed', async () => {
    /*
      `contains` is a caller's list — on the workshop's canvas it is the call's stored extraction
      targets — so a repeated entry is a thing that happens, and each repeat cost a round trip and a
      standing subscription, since the engine keys its watches on the read.
    */
    const { context: ctx, asked } = context({
      Placement: [],
      TaskBlock: [{ id: 't1', title: 'One' }],
    });

    await canvasSeed().seed({ canvas: 'b1', contains: ['TaskBlock', 'TaskBlock', 'TaskBlock'] }, ctx);

    expect(asked.filter((entity) => entity === 'TaskBlock')).toHaveLength(1);
  });

  it('still asks twice for a type that is both placed and owned, which is two questions', async () => {
    /*
      The dedup is exact repeats only, and this is why. "The ones positioned here", by id, and "the
      ones this canvas owns", by containment, are different questions — the second is what finds a
      card nobody has placed yet. They cannot be merged into one query either: one is a `where` and
      the other a `scope`, and the grammar has no union of the two.
    */
    const { context: ctx, asked } = context({
      Placement: [{ id: 'p1', node: 't1', nodeType: 'TaskBlock', x: 0, y: 0 }],
      TaskBlock: [{ id: 't1', title: 'One' }],
    });

    await canvasSeed().seed({ canvas: 'b1', contains: ['TaskBlock'] }, ctx);

    expect(asked.filter((entity) => entity === 'TaskBlock')).toHaveLength(2);
  });

  it('says so when there are more placed cards than it is allowed to read', async () => {
    /*
      The placements read is not like the others. Every read here is bounded, and for most of them
      hitting the bound means some cards of that kind are missing — visible, and obviously a
      truncation. This one decides which records round two asks for, so exceeding it does not drop
      the overflow cards, it makes them invisible to the rest of the load entirely. Nothing else ever
      learns they exist, and what a person sees is a canvas that silently stops.
    */
    const { context: ctx, warnings } = context({
      Placement: [
        { id: 'p1', node: 't1', nodeType: 'TaskBlock', x: 0, y: 0 },
        { id: 'p2', node: 't2', nodeType: 'TaskBlock', x: 1, y: 1 },
      ],
      TaskBlock: [
        { id: 't1', title: 'One' },
        { id: 't2', title: 'Two' },
      ],
    });

    await canvasSeed().seed({ canvas: 'b1', limit: 2 }, ctx);

    expect(warnings.some((w) => w.includes('stopped at 2 placed cards'))).toBe(true);
  });

  it('says nothing about a cap it did not reach', async () => {
    // A warning on every ordinary canvas would be worth nothing on the one that is truncated.
    const { context: ctx, warnings } = context({
      Placement: [{ id: 'p1', node: 't1', nodeType: 'TaskBlock', x: 0, y: 0 }],
      TaskBlock: [{ id: 't1', title: 'One' }],
    });

    await canvasSeed().seed({ canvas: 'b1', limit: 200 }, ctx);

    expect(warnings.filter((w) => w.includes('placed cards'))).toEqual([]);
  });
});

/**
 * Weighing a card by the reactions on it.
 *
 * The aggregate is arithmetic and would be dull to test if the two rules around it were not both
 * silent when wrong: a card that gained weight because somebody was offline, and a card nobody has
 * answered about sitting where the least-liked card belongs.
 */
describe('weighSignals', () => {
  const type = 'sig-like';
  const signal = (author: string, value: number, createdAt = '2026-01-01') => ({
    signalTypeId: type,
    value,
    author,
    createdAt,
  });

  it('counts how many people reacted, by default', () => {
    const data = weighSignals([signal('did:a', 1), signal('did:b', 1)], { signalTypeId: type });

    // And says what produced it, for a card's own mark to read.
    expect(data).toEqual({ weight: 2, weightCount: 2, weightType: type, weightAggregate: 'count' });
  });

  it('nets a vote out, averages a rating, and takes a median when asked', () => {
    const rows = [signal('did:a', 5), signal('did:b', 1), signal('did:c', 3)];

    expect(weighSignals(rows, { signalTypeId: type, aggregate: 'sum' }).weight).toBe(9);
    expect(weighSignals(rows, { signalTypeId: type, aggregate: 'mean' }).weight).toBe(3);
    expect(weighSignals(rows, { signalTypeId: type, aggregate: 'median' }).weight).toBe(3);
  });

  it('takes the median between the middle pair when there is an even number', () => {
    const rows = [signal('did:a', 1), signal('did:b', 2), signal('did:c', 8), signal('did:d', 10)];

    expect(weighSignals(rows, { signalTypeId: type, aggregate: 'median' }).weight).toBe(5);
  });

  it('gives one person one voice, however many records they hold', () => {
    /*
      A shared perspective is last-write-wins and writable by every member, so one agent can end up
      holding two reactions of a kind on one record — two devices, or a write either side of a
      partition. Counting both lets a card gain weight from somebody having been offline.
    */
    const rows = [signal('did:a', 1, '2026-01-01'), signal('did:a', 5, '2026-02-01'), signal('did:b', 1)];
    const data = weighSignals(rows, { signalTypeId: type, aggregate: 'sum' });

    // The newer of the two, and one voice from that author.
    expect(data).toMatchObject({ weight: 6, weightCount: 2 });
  });

  it('answers with no weight when nobody has voted or rated, and with zero when nobody has liked', () => {
    /*
      Absent, not zero, for a vote or a rating. A card nobody has answered about sorts last whichever way
      the order runs and leaves a heat rule falling through to the plain colour — where a zero would claim
      the coldest colour. A count is the exception: no likes is a score, and belongs at the cold end.
    */
    expect(weighSignals([], { signalTypeId: type, mode: 'rating' }).weight).toBeUndefined();
    expect(weighSignals([], { signalTypeId: type, mode: 'vote' }).weight).toBeUndefined();
    expect(weighSignals([], { signalTypeId: type })).toMatchObject({ weight: 0, weightCount: 0 });
    expect(weighSignals([signal('did:a', 1)], { signalTypeId: 'other', mode: 'toggle' })).toMatchObject({ weight: 0 });
  });

  it('reads a rating as its average even when its type still says count', () => {
    // The manifest's default `count` is on every type nobody set an aggregate for, whatever its mode.
    const rows = [signal('did:a', 5), signal('did:b', 1), signal('did:c', 3), signal('did:d', 3)];
    expect(weighSignals(rows, { signalTypeId: type, aggregate: 'count', mode: 'rating' })).toMatchObject({
      weight: 3,
      weightAggregate: 'mean',
    });
    expect(weighSignals(rows, { signalTypeId: type, aggregate: 'count', mode: 'vote' }).weight).toBe(12);
  });

  it('says what the reader gave, when they gave anything', () => {
    const rows = [signal('did:a', 4), signal('did:me', 2)];
    expect(weighSignals(rows, { signalTypeId: type, mode: 'rating', me: 'did:me' }).weightMine).toBe(2);
    expect(weighSignals(rows, { signalTypeId: type, mode: 'rating', me: 'did:other' }).weightMine).toBeUndefined();
  });

  it('writes a zero that is a real answer', () => {
    // A vote that netted out is not the same as a card nobody voted on.
    const data = weighSignals([signal('did:a', 1), signal('did:b', -1)], {
      signalTypeId: type,
      aggregate: 'sum',
    });

    expect(data).toMatchObject({ weight: 0, weightCount: 2 });
  });

  it('leaves out a muted author, so a weight agrees with every other reaction surface', () => {
    const data = weighSignals([signal('did:a', 1), signal('did:muted', 1)], {
      signalTypeId: type,
      excludeAuthors: ['did:muted'],
    });

    expect(data).toMatchObject({ weight: 1, weightCount: 1 });
  });

  it('ignores an unattributed reaction rather than counting it as a stranger', () => {
    // Nothing can be said about it: not whose it is, not whether it is muted, not whether it is a
    // duplicate of one already counted.
    const data = weighSignals([{ signalTypeId: type, value: 1 }, signal('did:a', 1)], { signalTypeId: type });

    expect(data).toMatchObject({ weight: 1, weightCount: 1 });
  });

  it('survives rubbish rather than taking the canvas down with it', () => {
    expect(weighSignals(undefined, { signalTypeId: type })).toEqual({});
    expect(weighSignals([null, 'nope', 7], { signalTypeId: type, mode: 'rating' }).weight).toBeUndefined();
    expect(
      weighSignals([{ ...signal('did:a', 1), value: 'many' }], { signalTypeId: type, aggregate: 'sum' }),
    ).toMatchObject({ weight: 0, weightCount: 1 });
  });

  it('weighs nothing without a type, which is what lets a picker start empty', () => {
    expect(weighSignals([signal('did:a', 1)], { signalTypeId: '' })).toEqual({});
  });
});

describe('canvas seed — weighing', () => {
  it('reads the reactions in the query it was already making, and puts the weight on the card', async () => {
    const asked: ExpanderQuery[] = [];
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [
        {
          id: 'c1',
          title: 'Idea',
          signals: [
            { signalTypeId: 'sig-like', value: 1, author: 'did:a', createdAt: '2026-01-01' },
            { signalTypeId: 'sig-like', value: 1, author: 'did:b', createdAt: '2026-01-01' },
            { signalTypeId: 'sig-star', value: 5, author: 'did:a', createdAt: '2026-01-01' },
          ],
        },
      ],
    });
    const query = ctx.query;
    ctx.query = async (request: ExpanderQuery) => {
      asked.push(request);
      return query(request);
    };

    const { nodes } = await canvasSeed().seed(
      { canvas: 'b1', weigh: { signalTypeId: 'sig-like', aggregate: 'count' } },
      ctx,
    );

    /*
      A projection on the reads the seed already makes — not a query per card. Two of them for this type
      rather than one, which is the pair the seed always issues for it: the cards positioned here, by
      id, and the ones this canvas owns and nobody has placed. Both carry the projection, so a card in
      the tray is weighed exactly like a card on the board.
    */
    const reads = asked.filter((q) => q.entity === 'CollectionBlock');
    expect(reads).toHaveLength(2);
    expect(reads.every((q) => (q.include as Record<string, unknown> | undefined)?.signals === true)).toBe(true);
    expect(nodes[0].data).toMatchObject({ weight: 2, weightCount: 2 });
  });

  it('asks a type that declares no reactions for none, rather than losing it to a refused read', async () => {
    const asked: ExpanderQuery[] = [];
    const { context: ctx } = context({
      Placement: [
        { id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 },
        { id: 'p2', node: 's1', nodeType: 'Sighting', x: 10, y: 10 },
      ],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
      Sighting: [{ id: 's1', name: 'Heron' }],
    });
    const query = ctx.query;
    ctx.query = async (request: ExpanderQuery) => {
      asked.push(request);
      return query(request);
    };

    const { nodes } = await canvasSeed().seed({ canvas: 'b1', weigh: { signalTypeId: 'sig-like' } }, ctx);

    expect(asked.find((q) => q.entity === 'Sighting')?.include).toBeUndefined();
    // Present, and simply unweighed — which a sort reads as "no answer" and puts last.
    const sighting = nodes.find((n) => n.type === 'Sighting');
    expect(sighting).toBeDefined();
    expect(sighting?.data?.weight).toBeUndefined();
  });

  it('asks for no reactions at all when nothing is being weighed', async () => {
    const asked: ExpanderQuery[] = [];
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea' }],
    });
    const query = ctx.query;
    ctx.query = async (request: ExpanderQuery) => {
      asked.push(request);
      return query(request);
    };

    await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(asked.find((q) => q.entity === 'CollectionBlock')?.include).toBeUndefined();
  });
});

describe('canvas seed — what a card carries for ordering', () => {
  it('lets a record\'s own timestamp reach the card, so "oldest first" has something to order by', async () => {
    /*
      `createdAt` lives on the record rather than in any model's declared properties, so the scalar
      allowlist dropped it — and a layout told to order siblings by it fell silently back to sorting by
      address, which is stable, meaningless, and indistinguishable from working.
    */
    const { context: ctx } = context({
      Placement: [{ id: 'p1', node: 'c1', nodeType: 'CollectionBlock', x: 0, y: 0 }],
      CollectionBlock: [{ id: 'c1', title: 'Idea', createdAt: '2026-03-04T10:00:00Z' }],
    });

    const { nodes } = await canvasSeed().seed({ canvas: 'b1' }, ctx);

    expect(nodes[0].data?.createdAt).toBe('2026-03-04T10:00:00Z');
  });
});
