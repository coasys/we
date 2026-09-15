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

import { canvasSeed, PLACEMENT_UNSET } from './canvas';

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
