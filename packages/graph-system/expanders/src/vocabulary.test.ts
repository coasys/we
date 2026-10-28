/**
 * The vocabulary seed and expander, and a model opened into what it is — each over a fake context.
 */
import type { EntityShape, ExpanderContext } from '@we/graph-protocol';
import { clusterAddress, entityAddress } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

import { INSTANCES_TYPE, SCHEMA_TYPE } from './schema';
import { schemaPropertiesExpander } from './schemaProperties';
import { vocabularyPlugins } from './vocabulary';

const SIGNAL_TYPE: EntityShape = {
  name: 'SignalType',
  properties: [
    { name: 'name', type: 'string', required: true },
    { name: 'slug', type: 'string' },
  ],
  relations: [],
  nameProperty: 'name',
};

const TASK: EntityShape = {
  name: 'TaskBlock',
  properties: [{ name: 'title', type: 'string', required: true }],
  relations: [{ name: 'responses', target: '', cardinality: 'many' }],
};

function context(rows: Record<string, unknown>[] = []): ExpanderContext & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => rows);
  return {
    query,
    defaultDataset: () => 'ds',
    models: () => [SIGNAL_TYPE, TASK],
    warn: vi.fn(),
  } as unknown as ExpanderContext & { query: ReturnType<typeof vi.fn> };
}

const BUCKETS = {
  buckets: [
    { key: 'signals', label: 'Signal types', entity: 'SignalType' },
    { key: 'models', label: 'Models', models: [{ name: 'TaskBlock', label: 'Task' }] },
    {
      key: 'workflows',
      label: 'Workflows',
      workflows: [
        {
          name: 'Review',
          label: 'Review',
          steps: [
            { name: 'draft', label: 'Draft' },
            { name: 'done', label: 'Done', final: true },
          ],
          moves: [{ from: 'draft', to: 'done' }],
        },
      ],
    },
  ],
};

describe('vocabulary', () => {
  it('seeds one bucket per kind of vocabulary, counting what is in each', async () => {
    const { seed } = vocabularyPlugins();
    const result = await seed.seed(BUCKETS, context());
    expect(result.nodes.map((n) => [n.label, n.data?.count])).toEqual([
      ['Signal types', 0],
      ['Models', 1],
      ['Workflows', 1],
    ]);
    expect(result.nodes[0]).toMatchObject({ id: clusterAddress('vocabulary', 'signals'), kind: 'cluster' });
  });

  // An empty category offered a caret that opened nothing, and sat among the full ones.
  it('marks an empty bucket as having nothing to open, and ranks the fullest first', async () => {
    const { seed } = vocabularyPlugins();
    const result = await seed.seed(BUCKETS, context());
    const byLabel = Object.fromEntries(result.nodes.map((n) => [n.label, n]));
    expect(byLabel['Signal types']).toMatchObject({ leaf: true, data: { order: 2 } });
    // Equal counts keep the order given.
    expect(byLabel['Models']).toMatchObject({ data: { order: 0 } });
    expect(byLabel['Models'].leaf).toBeUndefined();
    expect(byLabel['Workflows']).toMatchObject({ data: { order: 1 } });
  });

  it('opens a bucket of records by asking for them, each held by the bucket', async () => {
    const { seed, expander } = vocabularyPlugins();
    const ctx = context([{ id: 'like', name: 'Like', slug: 'like' }]);
    await seed.seed(BUCKETS, ctx);
    const result = await expander.expand({ id: clusterAddress('vocabulary', 'signals'), direction: 'out' }, ctx);
    expect(ctx.query).toHaveBeenCalledWith(expect.objectContaining({ entity: 'SignalType', limit: 200 }));
    expect(result.nodes).toMatchObject([{ id: entityAddress('ds', 'SignalType', 'like'), label: 'Like' }]);
    expect(result.edges[0]).toMatchObject({ source: clusterAddress('vocabulary', 'signals'), type: 'contains' });
  });

  /*
    A space's policy is a list of rules, neither records of one type nor models. And whatever a bucket
    holds says which bucket, so a style rule can light one kind of word and what is in it.
  */
  it('opens a bucket of items into one node each, and marks what every bucket holds with its key', async () => {
    const { seed, expander } = vocabularyPlugins();
    const ctx = context([{ id: 'like', name: 'Like', slug: 'like' }]);
    const policy = { key: 'policy', label: 'Policy', items: [{ id: 'r1', label: 'Members can make anything.' }] };
    const seeded = await seed.seed({ buckets: [...BUCKETS.buckets, policy] }, ctx);
    expect(seeded.nodes.find((n) => n.label === 'Policy')?.data?.count).toBe(1);

    const items = await expander.expand({ id: clusterAddress('vocabulary', 'policy'), direction: 'out' }, ctx);
    expect(items.nodes).toMatchObject([
      { kind: 'cluster', type: 'vocabulary-item', label: 'Members can make anything.', leaf: true },
    ]);
    expect(items.nodes[0].data).toMatchObject({ bucket: 'policy', item: 'r1' });

    const signals = await expander.expand({ id: clusterAddress('vocabulary', 'signals'), direction: 'out' }, ctx);
    // And a record's own id, which a style rule can match where its node's address is out of reach.
    expect(signals.nodes[0].data).toMatchObject({ bucket: 'signals', recordId: 'like' });
  });

  it('opens models into type nodes and workflows into their steps, with a line for each move', async () => {
    const { seed, expander } = vocabularyPlugins();
    const ctx = context();
    await seed.seed(BUCKETS, ctx);
    // The seed reads the record buckets to count them; opening these two reads nothing.
    ctx.query.mockClear();
    const models = await expander.expand({ id: clusterAddress('vocabulary', 'models'), direction: 'out' }, ctx);
    expect(models.nodes).toMatchObject([{ id: entityAddress('ds', SCHEMA_TYPE, 'TaskBlock'), label: 'Task' }]);

    const workflows = await expander.expand({ id: clusterAddress('vocabulary', 'workflows'), direction: 'out' }, ctx);
    const workflowNode = workflows.nodes[0];
    expect(workflowNode).toMatchObject({ kind: 'cluster', type: 'workflow', label: 'Review' });

    const steps = await expander.expand({ id: workflowNode.id, direction: 'out' }, ctx);
    expect(steps.nodes.map((n) => [n.label, n.data?.final])).toEqual([
      ['Draft', false],
      ['Done', true],
    ]);
    expect(steps.edges.map((e) => e.type)).toEqual(['contains', 'contains', 'move']);
    expect(ctx.query).not.toHaveBeenCalled();
  });

  it('keeps two graphs’ buckets apart: each pair answers from what its own seed was told', async () => {
    const a = vocabularyPlugins();
    const b = vocabularyPlugins();
    await a.seed.seed(BUCKETS, context());
    const ctx = context();
    expect(await b.expander.expand({ id: clusterAddress('vocabulary', 'models'), direction: 'out' }, ctx)).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

describe('schemaPropertiesExpander', () => {
  it('opens a type into its fields and relations, and a Records node for its instances', async () => {
    const result = await schemaPropertiesExpander().expand(
      { id: entityAddress('ds', SCHEMA_TYPE, 'TaskBlock'), direction: 'out' },
      context(),
    );
    expect(result.nodes.map((n) => n.label)).toEqual(['title · string', 'responses → anything (many)', 'Records']);
    const records = result.nodes.at(-1)!;
    expect(records).toMatchObject({
      kind: 'entity',
      type: INSTANCES_TYPE,
      id: entityAddress('ds', INSTANCES_TYPE, 'TaskBlock'),
    });
    expect(result.edges.map((e) => e.type)).toEqual(['property', 'property', 'instance']);
  });

  it('opens a word into the records that use it — a task state into its tasks', async () => {
    const { seed, records: expander } = vocabularyPlugins();
    const states = {
      buckets: [
        {
          key: 'states',
          label: 'Task states',
          entity: 'TaskState',
          opens: { entity: 'TaskBlock', field: 'status', key: 'slug' },
        },
      ],
    };
    const ctx = context();
    await seed.seed(states, ctx);
    ctx.query.mockImplementation(async (q: { entity: string }) =>
      q.entity === 'TaskState' ? [{ id: 's1', slug: 'todo' }] : [{ id: 't1', title: 'Write it' }],
    );

    const result = await expander.expand(
      { id: entityAddress('ds', 'TaskState', 's1'), direction: 'out' } as never,
      ctx,
    );

    expect(ctx.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ entity: 'TaskBlock', where: { status: 'todo' } }),
    );
    expect(result.nodes.map((n) => n.id)).toEqual([entityAddress('ds', 'TaskBlock', 't1')]);
    expect(result.edges[0]).toMatchObject({ type: 'instance', target: entityAddress('ds', 'TaskBlock', 't1') });
  });

  it('opens nothing for a record whose bucket says nothing about what it opens into', async () => {
    const { seed, records: expander } = vocabularyPlugins();
    const ctx = context();
    await seed.seed(BUCKETS, ctx);
    const result = await expander.expand(
      { id: entityAddress('ds', 'SignalType', 'x'), direction: 'out' } as never,
      ctx,
    );
    expect(result.nodes).toEqual([]);
  });

  // A caret is offered wherever an expander claims a node, and one claiming every cluster put a caret
  // on each of a workflow's steps that opened nothing.
  it("claims only buckets and workflows, not a workflow's steps", () => {
    const { expander, records } = vocabularyPlugins();
    expect(expander.kinds).toEqual(['cluster']);
    expect(expander.types).toEqual(['vocabulary', 'workflow']);
    expect(records.kinds).toEqual(['entity']);
  });
});
