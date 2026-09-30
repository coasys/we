/**
 * Collection and property expanders, against the same fake data layer the
 * entity expander tests use. What is worth pinning: the drill-down scope the
 * collection expander issues (the untyped relation the schema cannot see),
 * and the literal-node convergence that makes the property view a graph
 * rather than a starburst.
 */
import type { EntityShape, ExpanderContext, ExpanderQuery } from '@we/graph-protocol';
import { entityAddress } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

import { collectionExpander } from './collection';
import { propertyExpander } from './property';

const SHAPES: EntityShape[] = [
  {
    name: 'CollectionBlock',
    properties: [{ name: 'title', type: 'string' }],
    relations: [],
  },
  {
    name: 'TextBlock',
    properties: [{ name: 'text', type: 'string' }],
    relations: [],
  },
  {
    name: 'Task',
    properties: [
      { name: 'title', type: 'string', required: true },
      { name: 'status', type: 'string' },
      { name: 'notes', type: 'string' },
    ],
    relations: [],
    identityProperty: 'title',
  },
  {
    name: 'TaskBlock',
    properties: [{ name: 'title', type: 'string' }],
    relations: [],
  },
  {
    name: 'EventBlock',
    properties: [{ name: 'title', type: 'string' }],
    relations: [],
  },
  {
    name: 'Placement',
    properties: [{ name: 'nodeType', type: 'string' }],
    relations: [],
  },
];

function contextWith(rows: (query: ExpanderQuery) => Record<string, unknown>[]) {
  const warnings: string[] = [];
  const query = vi.fn(async (request: ExpanderQuery) => rows(request));
  const context: ExpanderContext = {
    query,
    defaultDataset: () => 'ds',
    models: () => SHAPES,
    warn: (message) => warnings.push(message),
  };
  return { context, query, warnings };
}

const COLLECTION = entityAddress('ds', 'CollectionBlock', 'c1');

describe('collectionExpander', () => {
  const withMembers = (members: Record<string, unknown>[]) => contextWith(() => [{ id: 'c1', children: members }]);
  const typed = (type: string, row: Record<string, unknown>) => ({ ...row, __subjectClass: type });

  it('reads the whole collection once and draws each member as the class it came back as', async () => {
    const { context, query } = withMembers([
      typed('TextBlock', { id: 't1', text: 'hello' }),
      typed('ImageBlock', { id: 'i1' }),
    ]);

    const result = await collectionExpander().expand({ id: COLLECTION, direction: 'out' }, context);

    // One read of the parent, not one per candidate type — and no list of types in it.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'CollectionBlock', where: { id: 'c1' }, include: { children: true } }),
    );
    expect(result.nodes.map((n) => n.type)).toEqual(['TextBlock', 'ImageBlock']);
    expect(result.edges[0]).toMatchObject({ source: COLLECTION, type: 'contains' });
  });

  it('draws a member of a type nobody configured — the defect the old work list had', async () => {
    // A configured list is a list somebody has to keep current, and a type missing from it was
    // indistinguishable from a record that did not exist. `Sighting` is a model a community defined
    // this morning; no constant in this repo mentions it.
    const { context } = withMembers([typed('Sighting', { id: 's1', name: 'heron' })]);
    const result = await collectionExpander().expand({ id: COLLECTION, direction: 'out' }, context);
    expect(result.nodes.map((n) => n.type)).toEqual(['Sighting']);
  });

  it('narrows to the named types when a template asks for a partial view', async () => {
    const { context } = withMembers([typed('TextBlock', { id: 't1' }), typed('ImageBlock', { id: 'i1' })]);
    const result = await collectionExpander({ children: ['ImageBlock'] }).expand(
      { id: COLLECTION, direction: 'out' },
      context,
    );
    expect(result.nodes.map((n) => n.type)).toEqual(['ImageBlock']);
  });

  it('counts and reports members that came back without a type instead of dropping them quietly', async () => {
    // An unclassified member means the read did not do what it was asked — a relation not declared
    // polymorphic, or an executor that cannot. The symptom is a container that opens onto nothing,
    // which looks exactly like an empty one.
    const { context, warnings } = withMembers([{ id: 'x1' }, typed('TextBlock', { id: 't1' })]);
    const result = await collectionExpander().expand({ id: COLLECTION, direction: 'out' }, context);
    expect(result.nodes).toHaveLength(1);
    expect(warnings[0]).toContain('1 of 2');
    expect(warnings[0]).toContain('polymorphic');
  });

  it('a failing read warns and contributes nothing instead of throwing', async () => {
    const query = vi.fn(async () => {
      throw new Error('offline');
    });
    const warnings: string[] = [];
    const context = {
      query,
      defaultDataset: () => 'ds',
      models: () => SHAPES,
      warn: (message: string) => warnings.push(message),
    } as unknown as ExpanderContext;

    const result = await collectionExpander().expand({ id: COLLECTION, direction: 'out' }, context);
    expect(result.nodes).toEqual([]);
    expect(warnings[0]).toContain('offline');
  });

  it('containment runs one way — an inward request returns nothing', async () => {
    const { context, query } = contextWith(() => [{ id: 't1', text: 'x' }]);
    const result = await collectionExpander().expand({ id: COLLECTION, direction: 'in' }, context);
    expect(result.nodes).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('propertyExpander', () => {
  const TASK = entityAddress('ds', 'Task', 'task-1');

  it('opens an instance into property nodes with shared literal values', async () => {
    const { context } = contextWith(() => [{ id: 'task-1', title: 'Ship it', status: 'blocked' }]);

    const result = await propertyExpander().expand({ id: TASK, direction: 'out' }, context);

    // `title` is the label property — already on the instance node, not repeated.
    const propertyNodes = result.nodes.filter((n) => n.kind === 'property');
    expect(propertyNodes.map((n) => n.type)).toEqual(['status']);

    const literals = result.nodes.filter((n) => n.kind === 'literal');
    expect(literals).toHaveLength(1);
    expect(literals[0].label).toBe('blocked');
  });

  it('two instances converge on one literal node for the same value', async () => {
    const { context } = contextWith((request) => [{ id: String(request.where?.id), status: 'blocked' }]);

    const expander = propertyExpander({ properties: ['status'] });
    const first = await expander.expand({ id: entityAddress('ds', 'Task', 'a'), direction: 'out' }, context);
    const second = await expander.expand({ id: entityAddress('ds', 'Task', 'b'), direction: 'out' }, context);

    const literalOf = (r: typeof first) => r.nodes.find((n) => n.kind === 'literal')!.id;
    // The literal address is deliberately not instance-scoped — that convergence
    // is the entire reason to promote values to nodes.
    expect(literalOf(first)).toBe(literalOf(second));
  });

  it('hides empty values by default', async () => {
    const { context } = contextWith(() => [{ id: 'task-1', status: '', notes: null }]);
    const result = await propertyExpander({ properties: ['status', 'notes'] }).expand(
      { id: TASK, direction: 'out' },
      context,
    );
    expect(result.nodes).toEqual([]);
  });

  it('valueNodes: false collapses to leaf labels', async () => {
    const { context } = contextWith(() => [{ id: 'task-1', status: 'open' }]);
    const result = await propertyExpander({ properties: ['status'], valueNodes: false }).expand(
      { id: TASK, direction: 'out' },
      context,
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].label).toBe('status: open');
  });
});

describe('what a collection is opened into by default', () => {
  it('draws the block types interpretation writes, without being told they exist', async () => {
    // A call's collection acquires tasks and events without anyone composing them — the extraction
    // pass parents them straight onto it. They used to have to be named in a default list, and
    // before they were, a successful extraction was indistinguishable from one that found nothing.
    const { context } = contextWith(() => [
      {
        id: 'c1',
        children: [
          { id: 'k1', __subjectClass: 'TaskBlock' },
          { id: 'e1', __subjectClass: 'EventBlock' },
        ],
      },
    ]);

    const result = await collectionExpander().expand({ id: COLLECTION, direction: 'out' }, context);

    expect(result.nodes.map((n) => n.type)).toEqual(['TaskBlock', 'EventBlock']);
  });

  it('never opens a collection into its placements, even when told to', async () => {
    // A canvas keeps its coordinates as `Placement` records parented alongside its cards — the
    // cheapest place for them, since a canvas's children are a mixed bag anyway. Drawn as
    // containment they would put a dot on the canvas for every card, saying nothing and doubling
    // the node count. The refusal is unconditional because it is not a preference: a placement is
    // never what anybody means by "what is in here".
    const { context, query } = contextWith(() => []);

    await collectionExpander({ children: ['CollectionBlock', 'Placement'] }).expand(
      { id: COLLECTION, direction: 'out' },
      context,
    );

    const asked = query.mock.calls.map(([request]) => (request as ExpanderQuery).entity);
    expect(asked).toEqual(['CollectionBlock']);
  });

  it('honours a template excluding a type it would otherwise open into', async () => {
    const { context, query } = contextWith(() => []);

    await collectionExpander({ exclude: ['TextBlock'] }).expand({ id: COLLECTION, direction: 'out' }, context);

    const asked = query.mock.calls.map(([request]) => (request as ExpanderQuery).entity);
    expect(asked).not.toContain('TextBlock');
    expect(asked).toContain('CollectionBlock');
  });
});
