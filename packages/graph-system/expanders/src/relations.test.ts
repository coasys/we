/**
 * The one reader of a record's declared relations — what the entity expander walks one record at a
 * time and the canvas seed walks a level at a time.
 *
 * Two questions, kept apart because they fail apart: *which* relations a graph follows (a rule the
 * spine picker, the seed and the drag must agree on), and *how* a level of them is read (one query
 * per relation per level, never one per record).
 */
import type { EntityShape, ExpanderContext, ExpanderQuery } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

import { followedRelations, readRelations } from './relations';

const SHAPES: EntityShape[] = [
  {
    name: 'Topic',
    properties: [{ name: 'title', type: 'string' }],
    relations: [
      { name: 'subTopicOf', target: 'Topic', cardinality: 'one' },
      { name: 'signals', target: 'Signal', cardinality: 'many' },
      // Untyped: could point at anything, so never a spine.
      { name: 'responses', target: '', cardinality: 'many' },
    ],
  },
  {
    name: 'Position',
    properties: [{ name: 'text', type: 'string' }],
    relations: [{ name: 'about', target: 'Topic', cardinality: 'one' }],
  },
  {
    name: 'Agenda',
    properties: [{ name: 'title', type: 'string' }],
    relations: [{ name: 'items', target: 'Topic', cardinality: 'many' }],
  },
  { name: 'Signal', properties: [{ name: 'value', type: 'number' }], relations: [], bookkeeping: true },
  {
    name: 'Placement',
    properties: [{ name: 'x', type: 'number' }],
    relations: [{ name: 'node', target: 'Topic', cardinality: 'one' }],
  },
  // A reified connection: its ends are untyped, and it is the one place an untyped relation is read.
  {
    name: 'Link',
    properties: [{ name: 'label', type: 'string' }],
    relations: [
      { name: 'source', target: '', cardinality: 'one' },
      { name: 'target', target: '', cardinality: 'one' },
    ],
  },
];

const names = (list: { holder: string; name: string }[]) => list.map((r) => `${r.holder}.${r.name}`).sort();

describe('followedRelations — which relations a graph follows', () => {
  it('takes the typed ones, and none to or from a bookkeeping class', () => {
    expect(names(followedRelations(SHAPES))).toEqual([
      'Agenda.items',
      'Placement.node',
      'Position.about',
      'Topic.subTopicOf',
    ]);
  });

  it('leaves out the classes a caller names as furniture, from either end', () => {
    expect(names(followedRelations(SHAPES, { skipClasses: ['Placement'] }))).not.toContain('Placement.node');
  });

  it('narrows to the names asked for, and drops the names excluded', () => {
    expect(names(followedRelations(SHAPES, { relations: ['about', 'items'], exclude: ['items'] }))).toEqual([
      'Position.about',
    ]);
  });
});

function contextOver(tables: Record<string, Record<string, unknown>[]>) {
  const query = vi.fn(async (request: ExpanderQuery) => {
    const entity = request.entity as string;
    let rows = tables[entity] ?? [];
    if (request.where) {
      const ids = request.where.id as string[];
      rows = rows.filter((row) => ids.includes(row.id as string));
      // Forward includes hydrate what each named relation points at.
      for (const name of Object.keys(request.include ?? {})) {
        rows = rows.map((row) => {
          const value = row[name];
          const lookup = (id: unknown) =>
            Object.values(tables)
              .flat()
              .find((r) => r.id === id) ?? id;
          return { ...row, [name]: Array.isArray(value) ? value.map(lookup) : value ? lookup(value) : value };
        });
      }
    } else if (request.scope) {
      const anchors = ([] as string[]).concat(request.scope.anchorId);
      rows = rows.filter((row) =>
        ([] as unknown[]).concat(row[request.scope!.via]).some((v) => anchors.includes(v as string)),
      );
    }
    return rows;
  });
  const context: ExpanderContext = { query, defaultDataset: () => 'ds', models: () => SHAPES, warn: () => {} };
  return { context, query };
}

describe('readRelations — a level of a walk, in one query per relation', () => {
  const tables = {
    Topic: [
      { id: 't1', title: 'Roadmap' },
      { id: 't2', title: 'Q3', subTopicOf: 't1' },
      { id: 't3', title: 'Q4', subTopicOf: 't1' },
    ],
    Position: [
      { id: 'p1', text: 'Ship it', about: 't2' },
      { id: 'p2', text: 'Wait', about: 't3' },
    ],
    Agenda: [{ id: 'a1', title: 'Monday', items: ['t2', 't3'] }],
  };
  const followed = followedRelations(SHAPES, { skipClasses: ['Placement'] });

  it('reads backward for the whole list of ids, one scope read per relation', async () => {
    const { context, query } = contextOver(tables);
    const { rows, links } = await readRelations({
      context,
      dataset: 'ds',
      type: 'Topic',
      ids: ['t2', 't3'],
      backward: followed.filter((r) => r.target === 'Topic'),
    });

    // One read per relation pointing at Topic — not one per topic.
    expect(query.mock.calls.map(([q]) => `${q.entity as string}:${q.scope?.via}`).sort()).toEqual([
      'Agenda:items',
      'Position:about',
      'Topic:subTopicOf',
    ]);
    expect(query.mock.calls.every(([q]) => q.scope?.direction === 'in')).toBe(true);
    expect(query.mock.calls.find(([q]) => q.entity === 'Position')![0].scope?.anchorId).toEqual(['t2', 't3']);

    expect(rows.map((r) => `${r.entity}/${r.row.id as string}`).sort()).toEqual([
      'Agenda/a1',
      'Position/p1',
      'Position/p2',
    ]);
    // Each link says which of the asked-for ids the row points at, holder first.
    expect(links.map((l) => `${l.holder}-${l.relation.name}->${l.value}`).sort()).toEqual([
      'a1-items->t2',
      'a1-items->t3',
      'p1-about->t2',
      'p2-about->t3',
    ]);
  });

  it('reads forward with include, one read for every relation the type holds', async () => {
    const { context, query } = contextOver(tables);
    const { rows, links } = await readRelations({
      context,
      dataset: 'ds',
      type: 'Agenda',
      ids: ['a1'],
      forward: followed.filter((r) => r.holder === 'Agenda'),
      include: () => ({ title: true }),
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatchObject({
      entity: 'Agenda',
      where: { id: ['a1'] },
      include: { items: { include: { title: true } } },
    });
    expect(rows.map((r) => `${r.entity}/${r.row.id as string}`)).toEqual(['Topic/t2', 'Topic/t3']);
    expect(links.map((l) => `${l.holder}-${l.relation.name}->${l.value}`)).toEqual(['a1-items->t2', 'a1-items->t3']);
  });

  it('keeps a link whose value did not hydrate, so the edge can still be drawn', async () => {
    const { context } = contextOver({ Position: [{ id: 'p1', about: 'gone' }] });
    const { rows, links } = await readRelations({
      context,
      dataset: 'ds',
      type: 'Position',
      ids: ['p1'],
      forward: followed.filter((r) => r.holder === 'Position'),
    });
    expect(rows).toEqual([]);
    expect(links).toEqual([expect.objectContaining({ holder: 'p1', value: 'gone' })]);
  });

  it('attributes a backward row to the one id asked about when the row does not spell the field', async () => {
    const { context } = contextOver({});
    (context.query as ReturnType<typeof vi.fn>).mockImplementation(async (q: ExpanderQuery) =>
      q.entity === 'Position' ? [{ id: 'p1', text: 'Ship it' }] : [],
    );
    const { links } = await readRelations({
      context,
      dataset: 'ds',
      type: 'Topic',
      ids: ['t2'],
      backward: followed.filter((r) => r.holder === 'Position'),
    });
    expect(links).toEqual([expect.objectContaining({ holder: 'p1', value: 't2' })]);
  });

  it('reports a read that failed and carries on with the rest', async () => {
    const warn = vi.fn();
    const { context } = contextOver(tables);
    const failing = {
      ...context,
      warn,
      query: async (q: ExpanderQuery) => {
        if (q.entity === 'Agenda') throw new Error('no such relation');
        return context.query(q);
      },
    } as ExpanderContext;
    const { rows } = await readRelations({
      context: failing,
      dataset: 'ds',
      type: 'Topic',
      ids: ['t2'],
      backward: followed.filter((r) => r.target === 'Topic'),
    });
    expect(rows.map((r) => r.row.id)).toEqual(['p1']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no such relation'));
  });
});
