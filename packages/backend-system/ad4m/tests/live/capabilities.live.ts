/**
 * `ad4mCapabilities`, checked against a real executor.
 *
 * Every entry in `ad4mCapabilities` is a claim about the executor, and the planner believes it: a
 * claimed feature is pushed down, and if the executor answers it wrongly the result is wrong rows
 * with no error. The unit tests cannot catch that, because they only exercise the planner.
 *
 * So this seeds one small tree of records into a perspective, and the same records into the
 * reference engine (`executeQueryIR`, WE's in-memory implementation of the query IR), runs one query
 * per capability against both, and compares:
 *
 *   holds                   claimed, and the executor agrees with the reference
 *   claimed but fails       claimed, and it does not — the test fails. Do not merge the bump.
 *   not claimed, works      the executor could do more than WE asks of it. Consider claiming it.
 *   not claimed             not claimed, and it does not work. Nothing to do.
 *
 * Only the second fails a test. The third is reported, not failed: claiming more is a decision for
 * a PR of its own, never a reason to hold a bump. The table prints after the last case.
 *
 * Run with `pnpm verify:ad4m`, against an executor built from the commit the pinned `@coasys/ad4m`
 * was published from (`npm view @coasys/ad4m@<pin> gitHead`). Live queries are not checked here;
 * `conformance.live.ts` covers those.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Ad4mClient, type Ad4mModel, type PerspectiveProxy } from '@coasys/ad4m';
import { executeQueryIR, type InMemoryDataset, planQuery, type QueryIR, type Row } from '@we/backend-shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  ad4mCapabilities,
  buildEntityFromEntry,
  createAd4mQueryAdapter,
  type EntityManifestEntry,
} from '../../src/index';

// ── The records ────────────────────────────────────────────────────────────
//
//   A ─┬─ C ─┬─ E        B ── G        H
//      │     └─ F
//      └─ D
//
// Ranks are distinct so every sorted answer has exactly one right order. Two groups give a
// relation to sort by; `note` is set on only two items so `exists` has something to tell apart.

const P = 'we-verify://';
const ENTRIES: EntityManifestEntry[] = [
  {
    name: 'VerifyGroup',
    targetClass: `${P}group`,
    properties: [
      { name: 'name', predicate: `${P}name`, type: 'string', isCollection: false, required: true, writable: true },
    ],
  },
  {
    name: 'VerifyItem',
    targetClass: `${P}item`,
    properties: [
      { name: 'title', predicate: `${P}title`, type: 'string', isCollection: false, required: true, writable: true },
      { name: 'rank', predicate: `${P}rank`, type: 'number', isCollection: false, required: true, writable: true },
      { name: 'tag', predicate: `${P}tag`, type: 'string', isCollection: false, required: false, writable: true },
      { name: 'note', predicate: `${P}note`, type: 'string', isCollection: false, required: false, writable: true },
      {
        name: 'children',
        predicate: `${P}child`,
        type: 'uri',
        isCollection: true,
        required: false,
        writable: true,
        relatedEntity: 'VerifyItem',
      },
      {
        name: 'group',
        predicate: `${P}in_group`,
        type: 'uri',
        isCollection: false,
        required: false,
        writable: true,
        relatedEntity: 'VerifyGroup',
      },
    ],
  },
];

type Seed = {
  key: string;
  title: string;
  rank: number;
  tag: string;
  group: 'alpha' | 'beta';
  parent?: string;
  note?: string;
};
const ITEMS: Seed[] = [
  { key: 'A', title: 'apple', rank: 1, tag: 'red', group: 'beta', note: 'first' },
  { key: 'B', title: 'banana', rank: 2, tag: 'yellow', group: 'alpha', note: 'second' },
  { key: 'C', title: 'cherry', rank: 3, tag: 'red', group: 'alpha', parent: 'A' },
  { key: 'D', title: 'date', rank: 4, tag: 'brown', group: 'beta', parent: 'A' },
  { key: 'E', title: 'elder', rank: 5, tag: 'red', group: 'alpha', parent: 'C' },
  { key: 'F', title: 'fig', rank: 6, tag: 'green', group: 'beta', parent: 'C' },
  { key: 'G', title: 'grape', rank: 7, tag: 'green', group: 'alpha', parent: 'B' },
  { key: 'H', title: 'guava', rank: 8, tag: 'red', group: 'beta' },
];

// ── The cases ──────────────────────────────────────────────────────────────
//
// `compare` says what must agree: the ids as a set, the ids in order, or one field per row in
// order (for sorts whose ties make the order of ids legitimately unspecified).

type Compare = 'set' | 'order' | { field: string } | { counts: string } | { children: true };
interface Case {
  name: string;
  ir: (k: Record<string, string>) => Omit<QueryIR, 'irVersion' | 'entity'>;
  compare: Compare;
}

const byRank = [{ by: 'rank', dir: 'asc' as const }];
const CASES: Case[] = [
  { name: 'operator: eq', ir: () => ({ filter: { field: 'tag', op: 'eq', value: 'red' } }), compare: 'set' },
  { name: 'operator: ne', ir: () => ({ filter: { field: 'tag', op: 'ne', value: 'red' } }), compare: 'set' },
  { name: 'operator: lt (number)', ir: () => ({ filter: { field: 'rank', op: 'lt', value: 4 } }), compare: 'set' },
  { name: 'operator: lte (number)', ir: () => ({ filter: { field: 'rank', op: 'lte', value: 4 } }), compare: 'set' },
  { name: 'operator: gt (number)', ir: () => ({ filter: { field: 'rank', op: 'gt', value: 4 } }), compare: 'set' },
  { name: 'operator: gte (number)', ir: () => ({ filter: { field: 'rank', op: 'gte', value: 4 } }), compare: 'set' },
  {
    name: 'operator: in',
    ir: () => ({ filter: { field: 'tag', op: 'in', value: ['green', 'brown'] } }),
    compare: 'set',
  },
  {
    name: 'operator: nin',
    ir: () => ({ filter: { field: 'tag', op: 'nin', value: ['green', 'brown'] } }),
    compare: 'set',
  },
  {
    name: 'operator: contains (ignores case)',
    ir: () => ({ filter: { field: 'title', op: 'contains', value: 'AN' } }),
    compare: 'set',
  },
  {
    name: 'operator: startsWith',
    ir: () => ({ filter: { field: 'title', op: 'startsWith', value: 'gu' } }),
    compare: 'set',
  },
  {
    name: 'operator: endsWith',
    ir: () => ({ filter: { field: 'title', op: 'endsWith', value: 'e' } }),
    compare: 'set',
  },
  {
    name: 'operator: exists',
    ir: () => ({ filter: { field: 'note', op: 'exists', value: true } }),
    compare: 'set',
  },
  {
    name: 'range bound: string',
    ir: () => ({ filter: { field: 'title', op: 'gte', value: 'd' } }),
    compare: 'set',
  },
  {
    name: 'booleans: or',
    ir: () => ({
      filter: {
        or: [
          { field: 'tag', op: 'eq', value: 'green' },
          { field: 'rank', op: 'lt', value: 2 },
        ],
      },
    }),
    compare: 'set',
  },
  {
    name: 'booleans: and',
    ir: () => ({
      filter: {
        and: [
          { field: 'tag', op: 'eq', value: 'red' },
          { field: 'rank', op: 'gt', value: 2 },
        ],
      },
    }),
    compare: 'set',
  },
  {
    name: 'booleans: not',
    ir: () => ({ filter: { not: { field: 'tag', op: 'eq', value: 'red' } } }),
    compare: 'set',
  },
  {
    name: 'relation filter: some',
    ir: () => ({ filter: { rel: 'children', op: 'some', where: { field: 'tag', op: 'eq', value: 'red' } } }),
    compare: 'set',
  },
  {
    name: 'relation filter: none',
    ir: () => ({ filter: { rel: 'children', op: 'none' } }),
    compare: 'set',
  },
  {
    name: 'scope: one anchor',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.A } }),
    compare: 'set',
  },
  {
    name: 'traversal: several anchors',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: [k.A, k.B] } }),
    compare: 'set',
  },
  {
    name: 'traversal: transitive',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.A, transitive: true } }),
    compare: 'set',
  },
  {
    name: 'traversal: inbound',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.C, direction: 'in' } }),
    compare: 'set',
  },
  {
    name: 'traversal: limit per anchor',
    ir: (k) => ({
      scope: { anchor: 'VerifyItem', via: 'children', anchorId: [k.A, k.C], limitPerAnchor: 1 },
      sort: byRank,
    }),
    compare: 'set',
  },
  {
    name: 'traversal: level walk',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.A, levels: [1, 1] }, sort: byRank }),
    compare: 'set',
  },
  { name: 'include', ir: () => ({ include: { children: true } }), compare: { children: true } },
  {
    name: 'aggregate: count',
    ir: () => ({ aggregate: [{ as: '$childCount', over: 'children', fn: 'count' }] }),
    compare: { counts: '$childCount' },
  },
  {
    name: 'aggregate: sum',
    ir: () => ({ aggregate: [{ as: '$rankSum', over: 'children', fn: 'sum', field: 'rank' }] }),
    compare: { counts: '$rankSum' },
  },
  { name: 'sort: one key', ir: () => ({ sort: [{ by: 'rank', dir: 'desc' }] }), compare: 'order' },
  {
    name: 'sort: several keys',
    ir: () => ({
      sort: [
        { by: 'tag', dir: 'asc' },
        { by: 'rank', dir: 'desc' },
      ],
    }),
    compare: 'order',
  },
  {
    name: 'sort: by relation path',
    ir: () => ({ sort: [{ by: 'group.name', dir: 'desc' }], page: { limit: 8 } }),
    compare: { field: 'groupName' },
  },
  {
    name: 'sort: by aggregate',
    ir: () => ({
      aggregate: [{ as: '$childCount', over: 'children', fn: 'count' }],
      sort: [{ by: '$childCount', dir: 'desc' }],
      page: { limit: 8 },
    }),
    compare: { field: '$childCount' },
  },
  {
    name: 'pagination: offset',
    ir: () => ({ sort: byRank, page: { limit: 3, offset: 2 } }),
    compare: 'order',
  },
];

// ── Comparing ──────────────────────────────────────────────────────────────

type Outcome = 'holds' | 'claimed but fails' | 'not claimed, works' | 'not claimed';

const idOf = (row: unknown) => String((row as { id?: unknown }).id ?? row);

function project(rows: Row[], compare: Compare, groupNames: Map<string, string>): unknown {
  if (compare === 'set') return rows.map(idOf).sort();
  if (compare === 'order') return rows.map(idOf);
  if ('children' in compare) {
    return Object.fromEntries(rows.map((r) => [idOf(r), ((r.children as unknown[]) ?? []).map(idOf).sort()]).sort());
  }
  if ('counts' in compare) {
    return Object.fromEntries(rows.map((r) => [idOf(r), Number(r[compare.counts] ?? 0)]).sort());
  }
  if (compare.field === 'groupName') {
    return rows.map((r) => groupNames.get(String(r.group ?? r.groupId)) ?? null);
  }
  return rows.map((r) => r[compare.field] ?? null);
}

// ── Seeding ────────────────────────────────────────────────────────────────

type ModelClass = typeof Ad4mModel & {
  create(p: PerspectiveProxy, data: Record<string, unknown>, opts?: unknown): Promise<{ id: string }>;
  findAll(p: PerspectiveProxy, opts?: unknown): Promise<Row[]>;
};

async function seed(perspective: PerspectiveProxy, Group: ModelClass, Item: ModelClass) {
  const groups: Record<string, string> = {};
  for (const name of ['alpha', 'beta']) groups[name] = (await Group.create(perspective, { name })).id;

  const keys: Record<string, string> = {};
  for (const s of ITEMS) {
    const data: Record<string, unknown> = { title: s.title, rank: s.rank, tag: s.tag, group: groups[s.group] };
    if (s.note) data.note = s.note;
    // ITEMS lists every parent before its children, so the parent's id is already known.
    const opts = s.parent ? { parent: { id: keys[s.parent], predicate: `${P}child` } } : undefined;
    keys[s.key] = (await Item.create(perspective, data, opts)).id;
  }

  // The same records, for the reference engine. A to-many relation is a foreign key on the child
  // there, and a to-one relation a foreign key on the row itself.
  const dataset: InMemoryDataset = {
    tables: {
      VerifyGroup: Object.entries(groups).map(([name, id]) => ({ id, name })),
      VerifyItem: ITEMS.map((s) => ({
        id: keys[s.key],
        title: s.title,
        rank: s.rank,
        tag: s.tag,
        groupId: groups[s.group],
        parentId: s.parent ? keys[s.parent] : null,
        ...(s.note ? { note: s.note } : {}),
      })),
    },
    relations: {
      VerifyItem: {
        children: { target: 'VerifyItem', cardinality: 'many', foreignKey: 'parentId' },
        group: { target: 'VerifyGroup', cardinality: 'one', foreignKey: 'groupId' },
      },
    },
  };
  const groupNames = new Map(Object.entries(groups).map(([name, id]) => [id, name]));
  return { keys, dataset, groupNames };
}

// ── Run ────────────────────────────────────────────────────────────────────

const MARK: Record<Outcome, string> = {
  holds: '✓',
  'claimed but fails': '✗',
  'not claimed, works': '+',
  'not claimed': '·',
};

describe('ad4mCapabilities against the executor', () => {
  let client: Ad4mClient;
  let perspective: PerspectiveProxy | undefined;
  let Item: ModelClass;
  let seeded: Awaited<ReturnType<typeof seed>>;
  const results: { name: string; outcome: Outcome }[] = [];
  const adapter = createAd4mQueryAdapter(() => ENTRIES);

  beforeAll(async () => {
    const { url, token } = inject('ad4mExecutor');
    client = new Ad4mClient(url, token);
    perspective = await client.perspective.add(`we-verify-${Date.now()}`);

    const flag = (value: string) => ({ through: 'ad4m://type', value });
    const classes: Record<string, ModelClass> = {};
    classes.VerifyGroup = buildEntityFromEntry(ENTRIES[0], { flag: flag(`${P}group`) }) as ModelClass;
    classes.VerifyItem = buildEntityFromEntry(ENTRIES[1], {
      flag: flag(`${P}item`),
      classResolver: (name: string) => classes[name],
    }) as ModelClass;
    await perspective.ensureSDNASubjectClass(classes.VerifyGroup);
    await perspective.ensureSDNASubjectClass(classes.VerifyItem);
    Item = classes.VerifyItem;
    seeded = await seed(perspective, classes.VerifyGroup, Item);
  }, 180_000);

  afterAll(async () => {
    // The pins and the four-way table — what a person reading a bump wants, in one place.
    const pins = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../package.json'), 'utf8')).pnpm
      ?.overrides as Record<string, string> | undefined;
    const info = (await client?.runtime.info().catch(() => null)) as { ad4mExecutorVersion?: string } | null;
    const width = Math.max(...results.map((r) => r.name.length));
    const lines = [
      `Pinned: @coasys/ad4m ${pins?.['@coasys/ad4m']}, @coasys/ad4m-connect ${pins?.['@coasys/ad4m-connect']}`,
      `Executor: ${info?.ad4mExecutorVersion ?? 'unknown version'}`,
      '',
      ...results.map((r) => `${MARK[r.outcome]} ${r.name.padEnd(width)}  ${r.outcome}`),
    ];
    const extra = results.filter((r) => r.outcome === 'not claimed, works').length;
    if (extra) lines.push('', `${extra} not claimed but working: consider claiming them, in a PR of their own.`);
    console.log(lines.join('\n'));

    if (perspective) await client.perspective.remove(perspective.uuid).catch(() => undefined);
    client?.close();
  });

  for (const c of CASES) {
    it(
      c.name,
      async () => {
        const ir: QueryIR = { irVersion: 1, entity: 'VerifyItem', ...c.ir(seeded.keys) };
        const claimed = planQuery(ir, ad4mCapabilities).gaps.length === 0;
        const expected = project(executeQueryIR(ir, seeded.dataset) as Row[], c.compare, seeded.groupNames);

        let actual: unknown;
        let error: string | undefined;
        try {
          actual = project(await Item.findAll(perspective!, adapter.lower(ir)), c.compare, seeded.groupNames);
        } catch (e) {
          error = e instanceof Error ? e.message.split('\n')[0] : String(e);
        }

        const agrees = !error && JSON.stringify(actual) === JSON.stringify(expected);
        const outcome: Outcome = claimed
          ? agrees
            ? 'holds'
            : 'claimed but fails'
          : agrees
            ? 'not claimed, works'
            : 'not claimed';
        results.push({ name: c.name, outcome });

        if (outcome !== 'claimed but fails') return;
        // Ids back to the letters in the diagram above, so a failure can be read.
        const letters = (value: unknown) =>
          Object.entries(seeded.keys).reduce((text, [key, id]) => text.split(id).join(key), JSON.stringify(value));
        expect.fail(
          `claimed in ad4mCapabilities, and the executor disagrees — do not merge the bump. ` +
            (error ? `error: ${error}` : `expected ${letters(expected)}, got ${letters(actual)}`),
        );
      },
      30_000,
    );
  }
});
