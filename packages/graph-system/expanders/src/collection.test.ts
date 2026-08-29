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
  it('drills down through the untyped relation, one scoped query per child type', async () => {
    const { context, query } = contextWith((request) =>
      request.entity === 'TextBlock' ? [{ id: 't1', text: 'hello' }] : [],
    );

    const result = await collectionExpander({ children: ['TextBlock'] }).expand(
      { id: COLLECTION, direction: 'out' },
      context,
    );

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'TextBlock',
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: 'c1' },
      }),
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: COLLECTION, type: 'contains' });
  });

  it('containment runs one way — an inward request returns nothing', async () => {
    const { context, query } = contextWith(() => [{ id: 't1', text: 'x' }]);
    const result = await collectionExpander().expand({ id: COLLECTION, direction: 'in' }, context);
    expect(result.nodes).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('skips child types the dataset does not declare', async () => {
    const { context, query } = contextWith(() => []);
    await collectionExpander({ children: ['NotARecord', 'TextBlock'] }).expand(
      { id: COLLECTION, direction: 'out' },
      context,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ entity: 'TextBlock' }));
  });

  it('a failing child query warns and contributes nothing instead of throwing', async () => {
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

    const result = await collectionExpander({ children: ['TextBlock'] }).expand(
      { id: COLLECTION, direction: 'out' },
      context,
    );
    expect(result.nodes).toEqual([]);
    expect(warnings[0]).toContain('TextBlock');
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
  it('looks for the block types interpretation writes, not only composed ones', async () => {
    // A call's collection acquires tasks and events without anyone composing them — the extraction
    // pass parents them straight onto it. Before these were in the default list the records existed
    // and the one view built to show a collection's contents did not draw them, so a successful
    // extraction was indistinguishable from one that found nothing.
    const { context, query } = contextWith(() => []);

    await collectionExpander().expand({ id: COLLECTION, direction: 'out' }, context);

    const asked = query.mock.calls.map(([request]) => (request as ExpanderQuery).entity);
    expect(asked).toContain('TaskBlock');
    expect(asked).toContain('EventBlock');
  });

  it('skips a type this dataset has never installed rather than querying it', async () => {
    // The default list is shared across every space, so it names types a given space may not have.
    // Each entry costs a drill-down query, and asking for a shape that is not there would spend one
    // to get an error back.
    const { context, query } = contextWith(() => []);

    await collectionExpander({ children: ['TaskBlock', 'NotInstalledBlock'] }).expand(
      { id: COLLECTION, direction: 'out' },
      context,
    );

    const asked = query.mock.calls.map(([request]) => (request as ExpanderQuery).entity);
    expect(asked).toEqual(['TaskBlock']);
  });

  it('never opens a collection into its placements, even when told to', async () => {
    // A board keeps its coordinates as `Placement` records parented alongside its cards — the
    // cheapest place for them, since a board's children are a mixed bag anyway. Drawn as
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
