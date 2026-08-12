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
    await collectionExpander({ children: ['NotAModel', 'TextBlock'] }).expand(
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
    const first = await expander.expand({ id: entityAddress('ds', 'Task', 'a') }, context);
    const second = await expander.expand({ id: entityAddress('ds', 'Task', 'b') }, context);

    const literalOf = (r: typeof first) => r.nodes.find((n) => n.kind === 'literal')!.id;
    // The literal address is deliberately not instance-scoped — that convergence
    // is the entire reason to promote values to nodes.
    expect(literalOf(first)).toBe(literalOf(second));
  });

  it('hides empty values by default', async () => {
    const { context } = contextWith(() => [{ id: 'task-1', status: '', notes: null }]);
    const result = await propertyExpander({ properties: ['status', 'notes'] }).expand({ id: TASK }, context);
    expect(result.nodes).toEqual([]);
  });

  it('valueNodes: false collapses to leaf labels', async () => {
    const { context } = contextWith(() => [{ id: 'task-1', status: 'open' }]);
    const result = await propertyExpander({ properties: ['status'], valueNodes: false }).expand({ id: TASK }, context);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].label).toBe('status: open');
  });
});
