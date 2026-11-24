/**
 * Declared operations, run on every backend: the same definitions, the same invocations, the same
 * records afterwards.
 *
 * The cases are written here; what each one produces is recorded once, on the in-memory backend
 * (`pnpm --filter @we/backend-conformance record:operations`), into
 * `vectors/operations/operations.json`, and every backend's suite runs each case and compares with
 * what was recorded. So the JSON file is the contract, in a form another implementation can run
 * without reading TypeScript: a manifest's operations, the records the dataset starts with, an
 * invocation, and then either the result or the error's class and code, and the records the dataset
 * ends with.
 *
 * Records are compared on the fields a case observes, not on who wrote them or when — those are each
 * backend's to stamp. Ids are compared exactly: a created record's id is derived from the invocation,
 * so every backend must arrive at the same one.
 */
import { readFileSync } from 'node:fs';

import type { DatasetHandle, OperationDefinition } from '@we/backend-shared';
import { getEntity, isOperationError, registerOperations, runOperation, unregisterOperations } from '@we/entities';
import { CORE_OPERATIONS } from '@we/entities/manifest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

/** The namespace the cases' operations are registered under. */
export const VECTOR_NAMESPACE = 'conformance';

/** Who every case invokes as. A literal, so a result that names the invoker reads the same everywhere. */
export const VECTOR_INVOKER = 'did:example:invoker';

/** A record the dataset starts with. */
export interface SeedRecord {
  entity: string;
  id: string;
  fields: Record<string, unknown>;
  /** Relations to set once every seed record exists, by name, as ids in order. */
  relations?: Record<string, string[]>;
}

/** What is read back after the operation: these fields and relations of every record of the entity. */
export interface Observation {
  entity: string;
  fields: string[];
  relations: string[];
}

export interface OperationCase {
  id: string;
  note: string;
  operations: Record<string, OperationDefinition>;
  dataset: SeedRecord[];
  /** The bare name; it runs as `conformance.<name>`. */
  operation: string;
  args: Record<string, unknown>;
  invocationId: string;
  invokedAt: string;
  observe: Observation[];
}

/** One recorded case: the case as data, and what running it produced. */
export interface OperationVector {
  id: string;
  note: string;
  manifest: { version: string; entities: Record<string, never>; operations: Record<string, OperationDefinition> };
  dataset: SeedRecord[];
  operation: string;
  args: Record<string, unknown>;
  invoker: string;
  invocationId: string;
  invokedAt: string;
  observe: Observation[];
  outcome: { result: unknown } | { error: { class: string; code: string } };
  records: Record<string, ObservedRecord[]>;
}

export type ObservedRecord = Record<string, unknown> & { id: string };

const COLLECTIONS: Observation = {
  entity: 'CollectionBlock',
  fields: ['kind', 'title', 'slug'],
  relations: ['children'],
};

const link = (of: string, target: string) => ({
  link: { entity: 'CollectionBlock', id: { $: of }, relation: 'children', target: { $: target } },
});

const OPERATIONS: Record<string, OperationDefinition> = {
  makeBoard: {
    description: 'A board and a column under it for each column given.',
    params: { title: { type: 'string', required: true }, columns: { type: 'list', required: true } },
    steps: [
      { create: { as: 'board', entity: 'CollectionBlock', fields: { kind: 'board', title: { $: 'title' } } } },
      {
        forEach: {
          in: { $: 'columns' },
          as: 'col',
          steps: [
            {
              create: {
                as: 'column',
                entity: 'CollectionBlock',
                fields: { kind: 'column', title: { $: 'col.title' } },
              },
            },
            link('board.id', 'column.id'),
          ],
        },
      },
    ],
    returns: { $: 'board.id' },
  },
  ensureTag: {
    description: 'The tag with this slug, made when there is none.',
    params: { slug: { type: 'string', required: true } },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { kind: 'tag', slug: { $: 'slug' } } } },
      {
        create: { as: 'made', entity: 'CollectionBlock', fields: { kind: 'tag', slug: { $: 'slug' } } },
        when: { $: 'count(found) == 0' },
      },
    ],
    returns: { $: 'count(found) ? first(found).id : made.id' },
  },
  guarded: {
    description: 'Makes a note, checks, and makes another — so a failed check must take the first back.',
    params: { n: { type: 'number', required: true } },
    errors: { tooBig: 'The number is too big.' },
    steps: [
      { create: { entity: 'CollectionBlock', fields: { kind: 'note', title: 'before' } } },
      { check: { condition: { $: 'n < 10' }, error: 'tooBig' } },
      { create: { entity: 'CollectionBlock', fields: { kind: 'note', title: 'after' } } },
    ],
  },
  writeTwice: {
    description: 'Makes a note and retitles it in the same operation.',
    steps: [
      { create: { as: 'note', entity: 'CollectionBlock', fields: { kind: 'note', title: 'first' } } },
      { update: { entity: 'CollectionBlock', id: { $: 'note.id' }, fields: { title: 'second' } } },
    ],
    returns: { $: 'note.id' },
  },
  adopt: {
    description: 'Puts a record under another, strictly: refused when it is there already.',
    params: { parent: { type: 'string', required: true }, child: { type: 'string', required: true } },
    steps: [
      {
        link: {
          entity: 'CollectionBlock',
          id: { $: 'parent' },
          relation: 'children',
          target: { $: 'child' },
          strict: true,
        },
      },
    ],
  },
};

const AT = '2026-11-24T00:00:00.000Z';
const board = (id: string, invocationId: string, columns: unknown[], note: string): OperationCase => ({
  id,
  note,
  operations: OPERATIONS,
  dataset: [],
  operation: 'makeBoard',
  args: { title: 'Plan', columns },
  invocationId,
  invokedAt: AT,
  observe: [COLLECTIONS],
});
const TODO = { key: 'todo', title: 'To do' };
const DONE = { key: 'done', title: 'Done' };
const TAG = { entity: 'CollectionBlock', id: 'urn:example:tag-garden', fields: { kind: 'tag', slug: 'garden' } };

const CASES: OperationCase[] = [
  board(
    'create-and-link',
    '00000000-0000-4000-8000-000000000001',
    [TODO, DONE],
    'creates a board and its columns, and links each column under it',
  ),
  board(
    'forEach-keys',
    '00000000-0000-4000-8000-000000000001',
    [DONE, TODO],
    'the same invocation with the columns reordered: every record gets the id it got in create-and-link',
  ),
  {
    id: 'upsert-existing',
    note: 'a find that matches skips the guarded create, and the operation returns what it found',
    operations: OPERATIONS,
    dataset: [TAG],
    operation: 'ensureTag',
    args: { slug: 'garden' },
    invocationId: '00000000-0000-4000-8000-000000000002',
    invokedAt: AT,
    observe: [COLLECTIONS],
  },
  {
    id: 'upsert-missing',
    note: 'a find that matches nothing lets the guarded create run, and the operation returns what it made',
    operations: OPERATIONS,
    dataset: [TAG],
    operation: 'ensureTag',
    args: { slug: 'weeds' },
    invocationId: '00000000-0000-4000-8000-000000000003',
    invokedAt: AT,
    observe: [COLLECTIONS],
  },
  {
    id: 'rollback-on-check',
    note: 'a failed check fails the operation with its named error, and the record made before it does not land',
    operations: OPERATIONS,
    dataset: [],
    operation: 'guarded',
    args: { n: 12 },
    invocationId: '00000000-0000-4000-8000-000000000004',
    invokedAt: AT,
    observe: [COLLECTIONS],
  },
  {
    id: 'second-write',
    note: 'a write to a record created earlier in the same operation lands on it',
    operations: OPERATIONS,
    dataset: [],
    operation: 'writeTwice',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000005',
    invokedAt: AT,
    observe: [COLLECTIONS],
  },
  {
    id: 'strict-link',
    note: 'a strict link to a record already linked fails as alreadyLinked and changes nothing',
    operations: OPERATIONS,
    dataset: [
      { entity: 'CollectionBlock', id: 'urn:example:child', fields: { kind: 'card' } },
      {
        entity: 'CollectionBlock',
        id: 'urn:example:parent',
        fields: { kind: 'board' },
        relations: { children: ['urn:example:child'] },
      },
    ],
    operation: 'adopt',
    args: { parent: 'urn:example:parent', child: 'urn:example:child' },
    invocationId: '00000000-0000-4000-8000-000000000006',
    invokedAt: AT,
    observe: [COLLECTIONS],
  },
  /*
    WE's own operations, run under this namespace: what a second implementation must produce for a
    reaction, an answer and a reply, the shapes a community's data is mostly made of.
  */
  {
    id: 'core-upsert-signal',
    note: 'core.upsertSignal with no reaction yet makes one under the record, and answers with its id',
    operations: CORE_OPERATIONS,
    dataset: [{ entity: 'CollectionBlock', id: 'urn:example:post', fields: { kind: 'post' } }],
    operation: 'upsertSignal',
    args: { node: 'urn:example:post', signalType: 'urn:example:like', value: 0 },
    invocationId: '00000000-0000-4000-8000-000000000007',
    invokedAt: AT,
    observe: [
      { entity: 'CollectionBlock', fields: ['kind'], relations: ['signals'] },
      { entity: 'Signal', fields: ['signalTypeId', 'value'], relations: [] },
    ],
  },
  {
    id: 'core-respond-replaces',
    note: 'core.respond removes the answer the invoker gave before, on this record only, and makes the new one',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'InvolvementType', id: 'urn:example:going', fields: { name: 'Going', slug: 'going', reflexive: true } },
      { entity: 'InvolvementType', id: 'urn:example:maybe', fields: { name: 'Maybe', slug: 'maybe', reflexive: true } },
      {
        entity: 'Involvement',
        id: 'urn:example:said-maybe',
        fields: { agent: VECTOR_INVOKER, kind: 'maybe', node: ['urn:example:event'] },
      },
      {
        entity: 'Involvement',
        id: 'urn:example:other-event',
        fields: { agent: VECTOR_INVOKER, kind: 'maybe', node: ['urn:example:elsewhere'] },
      },
    ],
    operation: 'respond',
    args: { node: 'urn:example:event', kind: 'going' },
    invocationId: '00000000-0000-4000-8000-000000000008',
    invokedAt: AT,
    observe: [{ entity: 'Involvement', fields: ['agent', 'kind'], relations: [] }],
  },
  {
    id: 'core-create-post-reply',
    note: 'core.createPost as a reply: in its subject’s responses and thread, a child of nothing, its block under it',
    operations: CORE_OPERATIONS,
    dataset: [{ entity: 'CollectionBlock', id: 'urn:example:post', fields: { kind: 'post' } }],
    operation: 'createPost',
    args: {
      root: { kind: 'reply', mode: 'document', textContent: 'agreed' },
      blocks: [{ key: '0', entity: 'TextBlock', fields: { text: 'agreed' } }],
      respondsTo: 'urn:example:post',
      thread: 'urn:example:post',
      threadEntity: 'CollectionBlock',
    },
    invocationId: '00000000-0000-4000-8000-000000000009',
    invokedAt: AT,
    observe: [
      { entity: 'CollectionBlock', fields: ['kind', 'textContent'], relations: ['children', 'responses', 'thread'] },
      { entity: 'TextBlock', fields: ['text'], relations: [] },
    ],
  },
  /*
    A board and a canvas: a drop that moves a card and takes its column's state, a column removed
    without losing its cards, and a card's placement written once with a duplicate cleared.
  */
  {
    id: 'core-move-card',
    note: 'core.moveCard leaves one column, joins the other where it was dropped, and takes a bound column’s state',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'TaskBlock', id: 'urn:example:a', fields: { title: 'A', status: 'todo' } },
      { entity: 'TaskBlock', id: 'urn:example:b', fields: { title: 'B', status: 'done' } },
      {
        entity: 'CollectionBlock',
        id: 'urn:example:todo',
        fields: { kind: 'column', slug: 'todo' },
        relations: { arranges: ['urn:example:a'] },
      },
      {
        entity: 'CollectionBlock',
        id: 'urn:example:done',
        fields: { kind: 'column', slug: 'done' },
        relations: { arranges: ['urn:example:b'] },
      },
    ],
    operation: 'moveCard',
    args: {
      from: 'urn:example:todo',
      to: 'urn:example:done',
      card: 'urn:example:a',
      ids: ['urn:example:a', 'urn:example:b'],
    },
    invocationId: '00000000-0000-4000-8000-000000000010',
    invokedAt: AT,
    observe: [
      { entity: 'CollectionBlock', fields: ['kind', 'slug'], relations: ['arranges'] },
      { entity: 'TaskBlock', fields: ['title', 'status'], relations: [] },
    ],
  },
  {
    id: 'core-remove-board-column',
    note: 'core.removeBoardColumn hands the column’s cards to the board and deletes the column, never a card',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'TaskBlock', id: 'urn:example:a', fields: { title: 'A', status: 'todo' } },
      {
        entity: 'CollectionBlock',
        id: 'urn:example:lane',
        fields: { kind: 'column', title: 'Thursday' },
        relations: { arranges: ['urn:example:a'] },
      },
      {
        entity: 'CollectionBlock',
        id: 'urn:example:board',
        fields: { kind: 'board', title: 'Week' },
        relations: { children: ['urn:example:lane'] },
      },
    ],
    operation: 'removeBoardColumn',
    args: { board: 'urn:example:board', column: 'urn:example:lane' },
    invocationId: '00000000-0000-4000-8000-000000000011',
    invokedAt: AT,
    observe: [
      { entity: 'CollectionBlock', fields: ['kind', 'title'], relations: ['children', 'arranges'] },
      { entity: 'TaskBlock', fields: ['title'], relations: [] },
    ],
  },
  {
    id: 'core-place-card',
    note: 'core.placeCard edits the placement a canvas draws, removes the duplicate it outranks, and answers with what it held',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'Placement', id: 'urn:example:drawn', fields: { nodeType: 'TaskBlock', x: 10, y: 20 } },
      { entity: 'Placement', id: 'urn:example:stray', fields: { nodeType: 'TaskBlock', x: 90, y: 90 } },
    ],
    operation: 'placeCard',
    args: {
      canvas: 'urn:example:canvas',
      node: 'urn:example:card',
      fields: { x: 300, y: 400 },
      placement: 'urn:example:drawn',
      duplicates: ['urn:example:stray'],
    },
    invocationId: '00000000-0000-4000-8000-000000000012',
    invokedAt: AT,
    observe: [{ entity: 'Placement', fields: ['nodeType', 'x', 'y'], relations: [] }],
  },
  /*
    The slug rule every vocabulary create follows: derived from the name, and refused when the space
    already holds it — a retired record included, since it still names the work sitting in it.
  */
  {
    id: 'core-create-task-state-taken',
    note: 'core.createTaskState refuses a name whose slug a retired state still holds, and writes nothing',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'TaskState', id: 'urn:example:blocked', fields: { name: 'Blocked', slug: 'blocked', retired: true } },
    ],
    operation: 'createTaskState',
    args: { name: ' BLOCKED ' },
    invocationId: '00000000-0000-4000-8000-000000000020',
    invokedAt: AT,
    observe: [{ entity: 'TaskState', fields: ['name', 'slug', 'retired'], relations: [] }],
  },
  {
    id: 'core-mark-read-heals',
    note: 'core.markRead moves the oldest marker for a record to the invocation’s time and removes a doubled one',
    operations: CORE_OPERATIONS,
    dataset: [
      {
        entity: 'ReadMarker',
        id: 'urn:example:marker',
        fields: { nodeId: 'urn:example:channel', spaceUuid: 'space', lastReadAt: '2026-01-01T00:00:00.000Z' },
      },
      {
        entity: 'ReadMarker',
        id: 'urn:example:doubled',
        fields: { nodeId: 'urn:example:channel', spaceUuid: 'space', lastReadAt: '2026-01-02T00:00:00.000Z' },
      },
    ],
    operation: 'markRead',
    args: { node: 'urn:example:channel', space: 'space' },
    invocationId: '00000000-0000-4000-8000-000000000021',
    invokedAt: AT,
    observe: [{ entity: 'ReadMarker', fields: ['nodeId', 'spaceUuid', 'lastReadAt'], relations: [] }],
  },
];

/** Each case carries only the operation it runs, so its vector reads on its own. */
export const OPERATION_CASES: OperationCase[] = CASES.map((c) => ({
  ...c,
  operations: { [c.operation]: c.operations[c.operation] },
}));

export const OPERATION_CONFORMANCE_CASES = OPERATION_CASES.map((c) => `operations.${c.id}` as const);
export type OperationConformanceCase = `operations.${string}`;

interface Model {
  create(dataset: DatasetHandle, data: Record<string, unknown>, options?: { id?: string }): Promise<{ id: string }>;
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  setRelation(dataset: DatasetHandle, id: string, relation: string, ids: readonly string[]): Promise<void>;
}

const model = (entity: string) => getEntity(entity) as unknown as Model;

/** Absent and empty read alike on every backend: the contract never stores ''. */
const present = (value: unknown) => value !== undefined && value !== null && value !== '';

const idsIn = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === 'string' ? entry : String((entry as { id?: unknown }).id)))
    : [];

async function observe(dataset: DatasetHandle, observations: Observation[]) {
  const records: Record<string, ObservedRecord[]> = {};
  for (const { entity, fields, relations } of observations) {
    const include = Object.fromEntries(relations.map((relation) => [relation, true]));
    const rows = await model(entity).findAll(dataset, relations.length ? { include } : {});
    records[entity] = rows
      .map((row) => {
        const out: ObservedRecord = { id: row.id as string };
        for (const field of fields) if (present(row[field])) out[field] = row[field];
        for (const relation of relations) {
          const ids = idsIn(row[relation]);
          if (ids.length) out[relation] = ids;
        }
        return out;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return records;
}

/** Run one case on a fresh subject and say what it produced, in the vector's terms. */
export async function runOperationCase(
  subject: ConformanceSubject,
  c: OperationCase,
): Promise<Pick<OperationVector, 'outcome' | 'records'>> {
  for (const seed of c.dataset) await model(seed.entity).create(subject.dataset, seed.fields, { id: seed.id });
  for (const seed of c.dataset)
    for (const [relation, ids] of Object.entries(seed.relations ?? {}))
      await model(seed.entity).setRelation(subject.dataset, seed.id, relation, ids);

  registerOperations(VECTOR_NAMESPACE, c.operations);
  let outcome: OperationVector['outcome'];
  try {
    const result = await runOperation(`${VECTOR_NAMESPACE}.${c.operation}`, c.args, {
      dataset: subject.dataset,
      invoker: VECTOR_INVOKER,
      invocationId: c.invocationId,
      invokedAt: c.invokedAt,
    });
    outcome = { result: result === undefined ? null : result };
  } catch (error) {
    if (!isOperationError(error)) throw error;
    outcome = { error: { class: error.class, code: error.code } };
  } finally {
    unregisterOperations(VECTOR_NAMESPACE);
  }
  return { outcome, records: await observe(subject.dataset, c.observe) };
}

/** A case as its vector records it: everything another implementation needs to run it. */
export function vectorOf(c: OperationCase, produced: Pick<OperationVector, 'outcome' | 'records'>): OperationVector {
  return {
    id: c.id,
    note: c.note,
    manifest: { version: '1', entities: {}, operations: c.operations },
    dataset: c.dataset,
    operation: c.operation,
    args: c.args,
    invoker: VECTOR_INVOKER,
    invocationId: c.invocationId,
    invokedAt: c.invokedAt,
    observe: c.observe,
    ...produced,
  };
}

export const OPERATION_VECTORS_FILE = new URL('../vectors/operations/operations.json', import.meta.url);

/** The recorded vectors, as committed. */
export function readOperationVectors(): { version: 1; cases: OperationVector[] } {
  return JSON.parse(readFileSync(OPERATION_VECTORS_FILE, 'utf8')) as { version: 1; cases: OperationVector[] };
}

export function describeOperations(name: string, harness: ConformanceHarness, timeout: number): void {
  describe(`backend conformance: ${name} — declared operations`, () => {
    let subject: ConformanceSubject;

    beforeEach(async () => {
      subject = await harness.setup();
      return () => harness.teardown?.(subject);
    }, timeout);

    const recorded = new Map(readOperationVectors().cases.map((vector) => [vector.id, vector]));

    it('has a recorded vector for every case, and no vector without one', () => {
      expect([...recorded.keys()].sort()).toEqual(OPERATION_CASES.map((c) => c.id).sort());
    });

    for (const c of OPERATION_CASES) {
      const id: OperationConformanceCase = `operations.${c.id}`;
      const body = async () => {
        const vector = recorded.get(c.id);
        expect(vector, `no vector recorded for ${c.id}`).toBeDefined();
        // The case as written must still be the case as recorded, or the vector is stale.
        expect(vectorOf(c, { outcome: vector!.outcome, records: vector!.records })).toEqual(vector);
        expect(await runOperationCase(subject, c)).toEqual({ outcome: vector!.outcome, records: vector!.records });
      };
      // Typed by the suite's case list, which names no operation case yet; read by name.
      const gap = (harness.knownGaps as Partial<Record<string, string>> | undefined)?.[id];
      if (gap) it.fails(`${c.note} [known gap: ${gap}]`, body, timeout);
      else it(c.note, body, timeout);
    }
  });
}
