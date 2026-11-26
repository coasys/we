/**
 * What a query returns, as language-neutral vectors: a dataset, a query, and the rows that come back.
 *
 * `vectors/query/query.json` is the contract. It is written by hand rather than recorded, because it
 * is the query semantics written down: each case is a query in the where-object JSON a template
 * writes, run against the file's own dataset, with the rows it must answer with. Nothing in it names
 * WE's vocabulary: the entity schemas it runs on are in the file, so another implementation can run
 * it without reading any TypeScript.
 *
 * Each case carries the level of the query semantics it belongs to (`core`, `traversal`,
 * `aggregates`, `live`, `provenance`), so a backend can say which levels it implements. A case that
 * pins a question the semantics have not settled carries `pending`, naming the question; it records
 * what WE does today and runs like any other, so a change to that behaviour is seen.
 *
 * ## Running a case
 *
 * Seed the file's `dataset` (each record created with its id, then its to-many relations set), then
 * ask `query` as a host asks a template's query: a falsy `when` is a query not asked; a list of
 * entities is asked of each and combined (each row naming its entity under `__subjectClass`, a record
 * listed once, `order` and `limit` applied to the whole list, `offset` refused); one entity is
 * compiled, planned and lowered for the backend, which may refuse it. Then compare with `expect`:
 *
 * - `{ refused: true }`: the host refuses the query.
 * - `{ notAsked: true }`: the query is not asked.
 * - `{ count, contains? }`: how many rows, and ids that must be among them.
 * - `{ rows, ordered?, inOrder? }`: the rows, by `id`, in the order given when `ordered`, as a set
 *   otherwise. Each expected row names only the fields it checks. A field expected `null` has no value
 *   (missing, `null` or `''`). A nested object is an included record, checked the same way; a nested
 *   list is compared as a set by id, or in order when its key is in `inOrder`. A string where a
 *   record could stand is the record's id.
 *
 * A `live` case also carries `then`: writes made after the query opened, and what it then answers.
 * Its query is opened live (unless `subscribe` is `false`, when it is read once); the first snapshot
 * is the `expect` rows and is flagged initial, and after the writes the query's latest snapshot is the
 * `then.expect` rows and is not.
 *
 * The file's `invoker` is the agent that writes the dataset: it is put wherever a query names it, as
 * the agent the backend runs as, so a condition on `author` reads the same on every backend.
 */
import { readFileSync } from 'node:fs';

import {
  combineEntityRows,
  type DatasetHandle,
  type EntityClass,
  type EntityManifest,
  type EntitySchema,
  type FlatQuery,
  isAbsent,
  type LivePage as Page,
  type LiveQuery,
  manifestEntries,
  type RendererDataBindings,
  routeQuery,
} from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject, QueryVectorCase } from './index';

/** The levels of the query semantics a case can belong to. */
export const QUERY_LEVELS = ['core', 'traversal', 'aggregates', 'live', 'provenance'] as const;
export type QueryLevel = (typeof QUERY_LEVELS)[number];

/** A record the dataset starts with. To-one relations are fields holding the target's id. */
export interface QuerySeedRecord {
  entity: string;
  id: string;
  fields: Record<string, unknown>;
  relations?: Record<string, string[]>;
}

/** A write a live case makes once its query has opened. */
export type QueryWrite =
  | { op: 'create'; entity: string; id: string; fields: Record<string, unknown> }
  | { op: 'update'; entity: string; id: string; fields: Record<string, unknown> }
  | { op: 'delete'; entity: string; id: string }
  | { op: 'add'; entity: string; id: string; relation: string; target: string };

export type QueryExpectation =
  | { refused: true }
  | { notAsked: true }
  | { count: number; contains?: string[] }
  | { rows: Record<string, unknown>[]; ordered?: boolean; inOrder?: string[] };

export interface QueryVector {
  id: string;
  level: QueryLevel;
  note: string;
  /** A template's `$query` with every expression already a value; `entity` may be a list. */
  query: Omit<FlatQuery, 'entity'> & { entity: string | string[]; when?: unknown };
  expect: QueryExpectation;
  /** The open question this case records WE's current answer to. */
  pending?: string;
  then?: { writes: QueryWrite[]; expect: QueryExpectation };
}

export interface QueryVectorFile {
  version: 1;
  /** Who wrote the dataset, as a query names them. */
  invoker: string;
  entities: Record<string, EntitySchema>;
  dataset: QuerySeedRecord[];
  cases: QueryVector[];
}

export const QUERY_VECTORS_FILE = new URL('../vectors/query/query.json', import.meta.url);

/** The vectors, as committed. */
export function readQueryVectors(): QueryVectorFile {
  return JSON.parse(readFileSync(QUERY_VECTORS_FILE, 'utf8')) as QueryVectorFile;
}

/** The file's schemas as a manifest, for a backend that installs entities from one. */
export function queryVectorManifest(file: QueryVectorFile): EntityManifest {
  return { version: '1', entities: file.entities };
}

/** What a case runs against: a dataset holding the file's records, read through a host's bindings. */
export interface QueryVectorEnv {
  bindings: RendererDataBindings;
  dataset: DatasetHandle;
  /** The id the backend's own agent has, put wherever the file names its invoker. */
  agent: string;
  /** How long a live case waits for a write to come back through its query. */
  settle: number;
}

interface WriteModel {
  create(dataset: DatasetHandle, data: Record<string, unknown>, options: { id: string }): Promise<unknown>;
  update(dataset: DatasetHandle, id: string, data: Record<string, unknown>): Promise<unknown>;
  delete(dataset: DatasetHandle, id: string): Promise<void>;
  setRelation(dataset: DatasetHandle, id: string, relation: string, ids: readonly string[]): Promise<void>;
  addRelation(dataset: DatasetHandle, id: string, relation: string, target: string): Promise<void>;
}

const writer = (entity: string) => getEntity(entity) as unknown as WriteModel;

/** Create the file's records, then set their to-many relations, so every target exists first. */
export async function seedQueryDataset(dataset: DatasetHandle, records: readonly QuerySeedRecord[]): Promise<void> {
  for (const record of records) await writer(record.entity).create(dataset, record.fields, { id: record.id });
  for (const record of records)
    for (const [relation, ids] of Object.entries(record.relations ?? {}))
      await writer(record.entity).setRelation(dataset, record.id, relation, ids);
}

async function write(dataset: DatasetHandle, change: QueryWrite): Promise<void> {
  const model = writer(change.entity);
  if (change.op === 'create') await model.create(dataset, change.fields, { id: change.id });
  else if (change.op === 'update') await model.update(dataset, change.id, change.fields);
  else if (change.op === 'delete') await model.delete(dataset, change.id);
  else await model.addRelation(dataset, change.id, change.relation, change.target);
}

/** Every occurrence of the string `from` in a JSON value, replaced by `to`. */
function swap<T>(value: T, from: string, to: string): T {
  if (value === from) return to as T;
  if (Array.isArray(value)) return value.map((entry: unknown) => swap(entry, from, to)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, swap(entry, from, to)])) as T;
  }
  return value;
}

// ── Asking ──────────────────────────────────────────────────────────────────

type Asked =
  | { refused: string }
  | { notAsked: true }
  | { rows: Record<string, unknown>[] }
  | { live: LiveQuery<Page<Record<string, unknown>>> };

function modelFor(env: QueryVectorEnv, entity: string): EntityClass {
  const scoped = env.bindings.$getEntityForDataset?.(entity, env.dataset);
  return scoped ?? env.bindings.$getEntity!(entity);
}

/**
 * Ask a case's query the way a host asks a template's: `when` first, then one entity routed through
 * the backend's adapter, or several asked one by one and combined.
 */
async function ask(env: QueryVectorEnv, file: QueryVectorFile, vector: QueryVector, live: boolean): Promise<Asked> {
  const { when, entity, ...query } = swap(vector.query, file.invoker, env.agent);
  if ('when' in vector.query && !when) return { notAsked: true };

  const names = Array.isArray(entity) ? [...new Set(entity)] : [entity];
  const union = Array.isArray(entity);
  if (union && query.offset != null) return { refused: 'an offset over several entities' };

  const routed: { entity: string; model: EntityClass; options: Record<string, unknown> }[] = [];
  for (const name of names) {
    const route = routeQuery({ ...query, entity: name }, env.bindings.$queryAdapter!);
    // One entity of several that cannot be read counts as having no rows; the others still answer.
    if (!route.ok) {
      if (union) continue;
      return { refused: route.error };
    }
    routed.push({ entity: name, model: modelFor(env, name), options: route.options });
  }

  if (live && !union && query.subscribe !== false) {
    const [one] = routed;
    return { live: one.model.query(env.dataset, one.options) as LiveQuery<Page<Record<string, unknown>>> };
  }
  const answers = await Promise.all(routed.map((r) => r.model.findAll(env.dataset, r.options)));
  if (!union) return { rows: answers[0] as Record<string, unknown>[] };
  return {
    rows: combineEntityRows(
      routed.map((r, i) => ({ entity: r.entity, rows: answers[i] })),
      { order: query.order as Record<string, unknown> | undefined, limit: query.limit },
    ),
  };
}

// ── Comparing ───────────────────────────────────────────────────────────────

const compareCodePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A record's id, read explicitly: an instance may hold it on a getter a spread does not copy. */
function idOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

const byId = (a: unknown, b: unknown) => compareCodePoints(idOf(a) ?? '', idOf(b) ?? '');

/** A value as a diff should show it when it is not what was expected: a record as its id. */
function summary(value: unknown): unknown {
  if (isAbsent(value)) return null;
  if (Array.isArray(value)) return value.map(summary);
  if (value && typeof value === 'object') return idOf(value) !== undefined ? { id: idOf(value) } : value;
  return value;
}

/** The expected value with every list it does not check the order of sorted by id. */
function canonical(expected: unknown, inOrder: ReadonlySet<string>, key?: string): unknown {
  if (Array.isArray(expected)) {
    const entries = expected.map((entry: unknown) => canonical(entry, inOrder));
    return key !== undefined && inOrder.has(key) ? entries : entries.sort(byId);
  }
  if (expected && typeof expected === 'object') {
    return Object.fromEntries(
      Object.entries(expected).map(([field, value]) => [field, canonical(value, inOrder, field)]),
    );
  }
  return expected;
}

/** What `actual` holds of the fields `expected` names, in the shape `canonical` gives `expected`. */
function project(actual: unknown, expected: unknown, inOrder: ReadonlySet<string>, key?: string): unknown {
  if (expected === null) return isAbsent(actual) ? null : summary(actual);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return summary(actual);
    const list = actual as unknown[];
    const entries = key !== undefined && inOrder.has(key) ? [...list] : [...list].sort(byId);
    const sortedExpected = canonical(expected, inOrder, key) as unknown[];
    return entries.map((entry, i) => project(entry, sortedExpected[i] ?? { id: '' }, inOrder));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return summary(actual);
    const record = actual as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(expected).map(([field, value]) => [
        field,
        project(field === 'id' ? idOf(record) : record[field], value, inOrder, field),
      ]),
    );
  }
  // A record where its id was expected is not the id: an included relation is the record.
  if (actual && typeof actual === 'object') return summary(actual);
  return isAbsent(actual) ? null : actual;
}

/** Compare rows with an expectation, as the file's comparing rules say. */
export function expectRows(rows: readonly unknown[], expectation: QueryExpectation, label: string): void {
  if ('count' in expectation) {
    const ids = new Set(rows.map(idOf));
    const produced = {
      count: rows.length,
      ...(expectation.contains ? { contains: expectation.contains.filter((id) => ids.has(id)) } : {}),
    };
    expect(produced, label).toEqual({
      count: expectation.count,
      ...(expectation.contains ? { contains: expectation.contains } : {}),
    });
    return;
  }
  if (!('rows' in expectation)) throw new Error(`${label}: expected ${JSON.stringify(expectation)}, which has no rows`);
  const inOrder = new Set(expectation.inOrder ?? []);
  const expectedRows = expectation.rows.map((row) => canonical(row, inOrder));
  const actualRows = expectation.ordered ? [...rows] : [...rows].sort(byId);
  if (!expectation.ordered) expectedRows.sort(byId);
  const produced = actualRows.map((row, i) => project(row, expectedRows[i] ?? { id: '' }, inOrder));
  expect(produced, label).toEqual(expectedRows);
}

// ── Running ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(assertion: () => void, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(25);
    }
  }
}

/**
 * Run one case against a dataset that already holds the file's records, and assert what it answers.
 * A live case writes into the dataset, so it needs one of its own.
 */
export async function runQueryVector(env: QueryVectorEnv, file: QueryVectorFile, vector: QueryVector): Promise<void> {
  const expected = swap(vector.expect, file.invoker, env.agent);
  const asked = await ask(env, file, vector, vector.then !== undefined);

  if ('refused' in expected) {
    expect('refused' in asked ? 'refused' : 'answered', `${vector.id}: whether the query is refused`).toBe('refused');
    return;
  }
  if ('refused' in asked) expect.fail(`${vector.id}: the backend refuses the query: ${asked.refused}`);
  if ('notAsked' in expected) {
    expect('notAsked' in asked ? 'not asked' : 'asked', `${vector.id}: whether the query is asked`).toBe('not asked');
    return;
  }
  if ('notAsked' in asked) expect.fail(`${vector.id}: the query was not asked`);

  if (!('live' in asked)) {
    expectRows(asked.rows, expected, vector.id);
    if (vector.then) {
      // Read once: the answer it gave is the one it keeps, whatever is written after it.
      for (const change of vector.then.writes) await write(env.dataset, change);
      expectRows(asked.rows, vector.then.expect, `${vector.id}, after the writes`);
    }
    return;
  }

  const handle = asked.live;
  try {
    const first = await handle.first;
    expect(handle.getSnapshot().initial, `${vector.id}: the opening snapshot is flagged initial`).toBe(true);
    expectRows(first.results, expected, `${vector.id}, as opened`);
    for (const change of vector.then!.writes) await write(env.dataset, change);
    const then = swap(vector.then!.expect, file.invoker, env.agent);
    await eventually(() => {
      const snapshot = handle.getSnapshot();
      expectRows(snapshot.data?.results ?? [], then, `${vector.id}, after the writes`);
      expect(snapshot.initial, `${vector.id}: a later snapshot is not initial`).toBe(false);
    }, env.settle);
  } finally {
    handle.dispose();
  }
}

/** The title a case runs under: its note, and the open question it records an answer to. */
export function queryVectorTitle(vector: QueryVector): string {
  return `${vector.id.slice('query.'.length)}: ${vector.note}${vector.pending ? ` [pending: ${vector.pending}]` : ''}`;
}

// ── In a backend's suite ────────────────────────────────────────────────────

/** The module the file's entities are declared under, on a backend that installs them from a manifest. */
const MODULE_ID = 'query-vectors';

/**
 * A subject with the file's entities installed and its records written, read through bindings that
 * know the entities, so a `scope` along one of their relations resolves.
 */
async function prepare(
  harness: ConformanceHarness,
  file: QueryVectorFile,
): Promise<{ subject: ConformanceSubject; env: Omit<QueryVectorEnv, 'settle'> }> {
  const subject = await harness.setup();
  const manifest = queryVectorManifest(file);
  const compiled = subject.ports.schemas.declare(manifest, { moduleId: MODULE_ID });
  await subject.ports.schemas.installModules(subject.dataset, Object.values(compiled));
  const entries = [
    ...manifestEntries(CORE_MANIFEST),
    ...subject.ports.schemas.entries(manifest, { moduleId: MODULE_ID }),
  ];
  const bindings = subject.ports.dataBindings({
    currentDataset: () => subject.dataset,
    currentDatasetEntities: () => entries,
    profiles: () => [],
    fetchProfile: () => {},
    ephemeral: subject.ports.ephemeral,
  });
  await seedQueryDataset(subject.dataset, file.dataset);
  return { subject, env: { bindings, dataset: subject.dataset, agent: subject.agent } };
}

/**
 * The query vectors on a backend's suite. The cases that only read share one dataset, seeded once:
 * on a backend where every write is a round trip, seeding per case would cost more than the cases.
 * A live case writes, so each gets a dataset of its own.
 */
export function describeQueryVectors(name: string, harness: ConformanceHarness, timeout: number, settle: number): void {
  const file = readQueryVectors();
  describe(`query vectors: ${name}`, () => {
    let shared: Awaited<ReturnType<typeof prepare>> | undefined;

    beforeAll(async () => {
      shared = await prepare(harness, file);
    }, timeout * 6);

    afterAll(async () => {
      if (shared) await harness.teardown?.(shared.subject);
    }, timeout);

    for (const vector of file.cases) {
      const body = async () => {
        if (!vector.then) return runQueryVector({ ...shared!.env, settle }, file, vector);
        const own = await prepare(harness, file);
        try {
          await runQueryVector({ ...own.env, settle }, file, vector);
        } finally {
          await harness.teardown?.(own.subject);
        }
      };
      const gap: string | undefined = harness.knownGaps?.[vector.id as QueryVectorCase];
      const title = queryVectorTitle(vector);
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, vector.then ? timeout * 4 : timeout);
      else it(title, body, vector.then ? timeout * 4 : timeout);
    }
  });
}
