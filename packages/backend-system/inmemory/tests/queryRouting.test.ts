/**
 * Routing a query through the IR answers the same question as not routing it.
 *
 * This is the Schema Queries test page, automated. That page existed to check one thing against a
 * real backend — flip `seed.features.useQueryIR`, reload, and every section renders identically —
 * and it could only ever be checked by a person looking at two screens. The flag is gone, so the
 * comparison has to live somewhere it can be run, and this is the only backend that can run both
 * sides of it without an executor.
 *
 * **What makes the comparison worth making.** The unrouted path compiles the flat descriptor to IR
 * and executes it. The routed path compiles it to IR, lowers the IR back to a flat descriptor, and
 * this backend compiles *that* to IR and executes it. So every shape here is a round trip through
 * `irToFlatQuery`, and anything that does not survive it — a filter that loses a branch, a sort that
 * loses its direction, a projection that loses its `where` — shows up as two different answers to
 * one question. Against the production adapter the lowering is different, but the round trip is the same shape.
 *
 * The shapes are the page's own: filter (eq / contains / OR), sort, pagination, projections, and the
 * drill-down it listed as "check on real screens". What it could not cover here is liveness, which
 * needs a subscription rather than a comparison.
 */
import { type EntityManifest, routeQuery } from '@we/backend-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { compileEntities } from '../src/entities';
import { inMemoryQueryAdapter } from '../src/queryAdapter';

/**
 * The page's own fixture, as a manifest: items with a status, each holding children with an owner.
 *
 * Deliberately not the core vocabulary. What is being tested is the routing, and a fixture with two
 * entities and one relation makes a failing assertion legible — where a failure over `CollectionBlock`
 * would first have to be untangled from everything that entity carries.
 */
const TEST_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    TestItem: {
      properties: {
        name: { type: 'string', required: true },
        status: { type: 'string', default: 'active' },
      },
      relations: {
        children: { target: 'TestChild', cardinality: 'many' },
      },
    },
    TestChild: {
      properties: {
        label: { type: 'string', required: true },
        owner: { type: 'string' },
      },
      relations: {},
    },
  },
};

const ME = 'did:test:me';
const SOMEONE_ELSE = 'did:test:other';

const entities = compileEntities(TEST_MANIFEST, { selfId: () => ME });
const TestItem = entities.TestItem;
const TestChild = entities.TestChild;

let dataset: { id: string; tables: Record<string, unknown[]> };

/** Alpha (2 children, 1 mine) · Beta (0, draft) · Gamma (1, mine) — the page's seed, exactly. */
beforeEach(async () => {
  dataset = { id: 'ds-routing', tables: {} };

  const alpha = await TestItem.create(dataset, { name: 'Alpha', status: 'active' });
  const beta = await TestItem.create(dataset, { name: 'Beta', status: 'draft' });
  const gamma = await TestItem.create(dataset, { name: 'Gamma', status: 'active' });
  void beta;

  const alphaMine = await TestChild.create(dataset, { label: 'a1', owner: ME });
  const alphaTheirs = await TestChild.create(dataset, { label: 'a2', owner: SOMEONE_ELSE });
  const gammaMine = await TestChild.create(dataset, { label: 'g1', owner: ME });

  await (alpha as unknown as WithChildren).addChildren(alphaMine);
  await (alpha as unknown as WithChildren).addChildren(alphaTheirs);
  await (gamma as unknown as WithChildren).addChildren(gammaMine);
});

/**
 * Run one descriptor both ways and hand back both answers.
 *
 * Rows are reduced to the fields an assertion is about — hydrated instances carry ids and timestamps
 * that differ per run, and comparing them whole would make every failure a wall of noise.
 */
async function bothWays(descriptor: Record<string, unknown>, project: (row: Record<string, unknown>) => unknown) {
  const routed = routeQuery({ entity: 'TestItem', ...descriptor }, inMemoryQueryAdapter);
  if (!routed.ok) throw new Error(`routing refused a query the page runs: ${routed.error}`);

  const direct = await TestItem.findAll(dataset, descriptor);
  const viaIR = await TestItem.findAll(dataset, routed.options as Record<string, unknown>);

  return {
    direct: direct.map((row) => project(row as unknown as Record<string, unknown>)),
    viaIR: viaIR.map((row) => project(row as unknown as Record<string, unknown>)),
  };
}

const byName = (row: Record<string, unknown>) => row.name;

/** Both answers agree, and they are the answer the page says to expect. */
async function expectBothToBe(
  descriptor: Record<string, unknown>,
  expected: unknown[],
  project: (row: Record<string, unknown>) => unknown = byName,
) {
  const { direct, viaIR } = await bothWays(descriptor, project);
  expect(viaIR).toEqual(direct);
  expect(viaIR).toEqual(expected);
}

/**
 * The relation accessor a model grows at runtime.
 *
 * `add<RelationName>` is generated from the declared relation, so it is not on the static type — which is
 * also why this file reads an id through a cast. Named once here rather than cast at each call.
 */
type WithChildren = { addChildren: (child: unknown) => Promise<unknown> };

describe('filter', () => {
  it('matches on equality', async () => {
    await expectBothToBe({ where: { status: 'active' }, order: { name: 'asc' } }, ['Alpha', 'Gamma']);
  });

  it('matches on contains', async () => {
    await expectBothToBe({ where: { name: { contains: 'et' } } }, ['Beta']);
  });

  it('keeps both branches of an OR', async () => {
    await expectBothToBe(
      { where: { OR: [{ status: 'draft' }, { name: { contains: 'lph' } }] }, order: { name: 'asc' } },
      ['Alpha', 'Beta'],
    );
  });

  it('keeps sibling conditions ANDed', async () => {
    await expectBothToBe({ where: { status: 'active', name: { contains: 'amm' } } }, ['Gamma']);
  });
});

describe('sort', () => {
  it('keeps ascending', async () => {
    await expectBothToBe({ order: { name: 'asc' } }, ['Alpha', 'Beta', 'Gamma']);
  });

  it('keeps descending — the direction is the half a round trip can drop', async () => {
    await expectBothToBe({ order: { name: 'desc' } }, ['Gamma', 'Beta', 'Alpha']);
  });
});

describe('pagination', () => {
  it('keeps a limit', async () => {
    await expectBothToBe({ order: { name: 'asc' }, limit: 2 }, ['Alpha', 'Beta']);
  });

  it('keeps an offset alongside it', async () => {
    await expectBothToBe({ order: { name: 'asc' }, limit: 2, offset: 1 }, ['Beta', 'Gamma']);
  });
});

describe('projections', () => {
  it('counts a relation', async () => {
    await expectBothToBe(
      { order: { name: 'asc' }, include: { $childCount: { from: 'children', count: true } } },
      [
        ['Alpha', 2],
        ['Beta', 0],
        ['Gamma', 1],
      ],
      (row) => [row.name, row.$childCount ?? 0],
    );
  });

  it('carries a projection’s own where and limit across the round trip', async () => {
    await expectBothToBe(
      {
        order: { name: 'asc' },
        include: { $myChild: { from: 'children', where: { owner: ME }, limit: 1 } },
      },
      [
        ['Alpha', 'a1'],
        ['Beta', null],
        ['Gamma', 'g1'],
      ],
      (row) => [row.name, (row.$myChild as { label?: string } | null)?.label ?? null],
    );
  });

  it('hydrates a plain include', async () => {
    await expectBothToBe(
      { order: { name: 'asc' }, include: { children: true } },
      [
        ['Alpha', 2],
        ['Beta', 0],
        ['Gamma', 1],
      ],
      (row) => [row.name, (row.children as unknown[] | undefined)?.length ?? 0],
    );
  });
});

describe('drill-down', () => {
  it('narrows to one container’s children rather than answering with every row', async () => {
    const alpha = await TestItem.findOne(dataset, { where: { name: 'Alpha' } });
    const descriptor = {
      scope: { anchor: 'TestItem', via: 'children', anchorId: (alpha as unknown as { id: string }).id },
      order: { label: 'asc' as const },
    };

    const routed = routeQuery({ entity: 'TestChild', ...descriptor }, inMemoryQueryAdapter);
    expect(routed.ok).toBe(true);

    const direct = await TestChild.findAll(dataset, descriptor);
    const viaIR = await TestChild.findAll(dataset, (routed as { options: Record<string, unknown> }).options);

    const labels = (rows: unknown[]) => rows.map((r) => (r as { label: string }).label);
    expect(labels(viaIR)).toEqual(labels(direct));
    expect(labels(viaIR)).toEqual(['a1', 'a2']);
  });
});
