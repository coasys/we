/**
 * Entity expander tests, against a fake data layer.
 *
 * Two behaviours are worth pinning because both are invisible when wrong: a relation that comes back
 * as a bare id must still produce an edge (to a placeholder), and the backward pass must actually be
 * asked for — a map that silently walks one way looks like a map with fewer relationships.
 */
import type { EntityShape, ExpanderContext, ExpanderQuery } from '@we/graph-protocol';
import { entityAddress, parseAddress } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

import { entityExpander } from './entity';
import { labelProperty } from './nodes';
import { SCHEMA_TYPE, schemaExpander } from './schema';

const SHAPES: EntityShape[] = [
  {
    name: 'Post',
    properties: [
      { name: 'title', type: 'string', required: true },
      { name: 'body', type: 'string' },
    ],
    relations: [{ name: 'author', target: 'Agent', cardinality: 'one' }],
  },
  {
    name: 'Agent',
    properties: [{ name: 'name', type: 'string', required: true }],
    relations: [],
    identityProperty: 'name',
  },
  {
    name: 'Comment',
    properties: [{ name: 'text', type: 'string' }],
    relations: [{ name: 'post', target: 'Post', cardinality: 'one' }],
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

const POST = entityAddress('ds', 'Post', 'p1');

describe('entityExpander', () => {
  it('follows a hydrated relation into a real node', async () => {
    const { context } = contextWith(() => [{ id: 'p1', title: 'Hello', author: { id: 'a1', name: 'James' } }]);

    const result = await entityExpander().expand({ id: POST, direction: 'out' }, context);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ type: 'Agent', label: 'James' });
    expect(result.edges[0]).toMatchObject({ source: POST, type: 'author' });
  });

  it('turns a bare relation id into a placeholder rather than dropping the edge', async () => {
    // The normal case in a P2P system: the target has not synced, or `include` did not hydrate it.
    const { context } = contextWith(() => [{ id: 'p1', title: 'Hello', author: 'a1' }]);

    const result = await entityExpander().expand({ id: POST, direction: 'out' }, context);

    expect(result.nodes[0]).toMatchObject({ type: 'Agent', unresolved: true });
    expect(result.edges).toHaveLength(1);
  });

  it('asks for what points at the node when walking backwards', async () => {
    const { context, query } = contextWith((request) =>
      request.entity === 'Comment' ? [{ id: 'c1', text: 'Nice' }] : [],
    );

    const result = await entityExpander().expand({ id: POST, direction: 'in' }, context);

    // Comment.post targets Post, so Comment is the candidate — asked through the drill-down path
    // with an inward direction, not by scanning every entity in the space.
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'Comment',
        scope: expect.objectContaining({ anchor: 'Post', via: 'post', anchorId: 'p1', direction: 'in' }),
      }),
    );
    expect(result.edges[0]).toMatchObject({ target: POST, type: 'post' });
  });

  it('honours an edge-type filter', async () => {
    const { context, query } = contextWith(() => [{ id: 'p1', title: 'Hello' }]);

    await entityExpander().expand({ id: POST, direction: 'out', edgeTypes: ['nothing'] }, context);

    expect(query).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when the type has no shape', async () => {
    const { context, warnings } = contextWith(() => []);

    const result = await entityExpander().expand(
      { id: entityAddress('ds', 'Unknown', 'x'), direction: 'both' },
      context,
    );

    expect(result.nodes).toEqual([]);
    expect(warnings.join(' ')).toContain('Unknown');
  });

  it('addresses nodes so the same instance from two expansions is one node', async () => {
    const { context } = contextWith(() => [{ id: 'p1', title: 'Hello', author: { id: 'a1', name: 'James' } }]);

    const first = await entityExpander().expand({ id: POST, direction: 'out' }, context);
    const second = await entityExpander().expand({ id: POST, direction: 'out' }, context);

    expect(first.nodes[0].id).toBe(second.nodes[0].id);
    expect(parseAddress(first.nodes[0].id)).toMatchObject({ type: 'Agent', id: 'a1' });
  });
});

describe('labelProperty', () => {
  it('prefers what the backend declares as the identity', () => {
    // Interpretation classes mark one property as the dedup identity, which is by construction the
    // title-like field — better than any guess this file could make.
    expect(labelProperty(SHAPES[1])).toBe('name');
  });

  it('falls back to a conventional name', () => {
    expect(labelProperty({ name: 'X', properties: [{ name: 'title', type: 'string' }], relations: [] })).toBe('title');
  });

  it('falls back to the first required string', () => {
    expect(
      labelProperty({
        name: 'X',
        properties: [
          { name: 'weight', type: 'number' },
          { name: 'summary', type: 'string', required: true },
        ],
        relations: [],
      }),
    ).toBe('summary');
  });
});

describe('schemaExpander', () => {
  it('opens a type node into instances of that type', async () => {
    const { context } = contextWith((request) =>
      request.entity === 'Agent'
        ? [
            { id: 'a1', name: 'James' },
            { id: 'a2', name: 'Nico' },
          ]
        : [],
    );

    const result = await schemaExpander().expand(
      { id: entityAddress('ds', SCHEMA_TYPE, 'Agent'), direction: 'out' },
      context,
    );

    expect(result.nodes.map((n) => n.label)).toEqual(['James', 'Nico']);
    // Instances address as ordinary entities, so the entity expander takes over from here and the
    // schema map and a knowledge map become one continuous gesture.
    expect(parseAddress(result.nodes[0].id)).toMatchObject({ kind: 'entity', type: 'Agent', id: 'a1' });
  });

  it('reports a cursor when a full page came back, without inventing a total', async () => {
    const { context } = contextWith(() => [{ id: 'a1', name: 'James' }]);

    const result = await schemaExpander({ limit: 1 }).expand(
      { id: entityAddress('ds', SCHEMA_TYPE, 'Agent'), direction: 'out', limit: 1 },
      context,
    );

    expect(result.cursor).toBe('1');
    expect(result.total).toBeUndefined();
  });

  it('warns rather than throwing for a type the dataset does not declare', async () => {
    const { context, warnings } = contextWith(() => []);

    const result = await schemaExpander().expand(
      { id: entityAddress('ds', SCHEMA_TYPE, 'Ghost'), direction: 'out' },
      context,
    );

    expect(result.nodes).toEqual([]);
    expect(warnings.join(' ')).toContain('Ghost');
  });
});
