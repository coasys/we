/**
 * Declared operations, run on every backend: the same definitions, the same invocations, the same
 * records afterwards.
 *
 * The cases are written here; what each one produces is recorded once, on the in-memory backend
 * (`pnpm --filter @we/backend-conformance record:operations`), into
 * `vectors/operations/operations.json`, and every backend's suite runs each vector and compares with
 * what was recorded. So the JSON file is the contract, in a form another implementation can run
 * without reading TypeScript: the entity schemas the cases write, the policy their writes are judged
 * by, and per case a manifest's operations, the records the dataset starts with, an invocation, and
 * then either the result or the error's class and code, and the records the dataset ends with.
 *
 * The file's invoker is a part whoever runs it plays: every case runs as the backend's own agent,
 * with that agent's id put wherever the file names the invoker and read back as the file's name for
 * it. So a created record's author, which a backend stamps from the agent writing, is observed as the
 * invoker on every backend, as the format says it is.
 *
 * Ids are compared exactly: a created record's id is derived from the invocation, so every backend
 * must arrive at the same one. Records are listed by id in code-point order, and a relation's members
 * are compared in order only where the schema says the relation is ordered.
 */
import { readFileSync } from 'node:fs';

import {
  actionOf,
  type ActionRequest,
  type DatasetHandle,
  type EntitySchema,
  evaluate,
  type OperationDefinition,
  type Policy,
  PolicyRefusal,
  type PropertySchema,
  type RelationSchema,
} from '@we/backend-shared';
import {
  callsOf,
  type EntityWriteCheck,
  getEntityForDataset,
  isOperationError,
  PROTECTED_ENTITIES,
  registerEntityWriteCheck,
  registerOperations,
  runOperation,
  unregisterOperations,
} from '@we/entities';
import { CORE_MANIFEST, CORE_OPERATIONS } from '@we/entities/manifest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

/** The namespace the cases' operations are registered under. */
export const VECTOR_NAMESPACE = 'conformance';

/** Who every case invokes as. A literal, so a result that names the invoker reads the same everywhere. */
export const VECTOR_INVOKER = 'did:example:invoker';

/**
 * The policy the format's cases run under: the narrowest one that gives a refusal and an author
 * something to decide. Anyone may write anything, an item is deleted only by its author, and a label
 * only made by a curator, which the invoker is not. Frozen, since nothing here may change it.
 */
export const VECTOR_POLICY: VectorPolicy = {
  rules: {
    format: 1,
    frozen: true,
    permissions: [
      { action: '*', by: ['anyone'] },
      { action: 'Item.delete', by: ['author'] },
      { action: 'Label.create', by: [{ role: 'curator' }] },
    ],
  },
  invoker: { member: true, roles: [] },
};

/** The policy WE's own operations run under: the same rules, over WE's entities. */
export const CORE_VECTOR_POLICY: VectorPolicy = {
  rules: {
    format: 1,
    frozen: true,
    permissions: [
      { action: '*', by: ['anyone'] },
      { action: 'CollectionBlock.delete', by: ['author'] },
      { action: 'TagBlock.create', by: [{ role: 'curator' }] },
    ],
  },
  invoker: { member: true, roles: [] },
};

/**
 * The entities the format's cases run over: a few neutral ones, so a host passes them without
 * adopting WE's domain. An item is anything that holds others (`children`, ordered; `mentions`, a
 * set); a card is a second record type to collide with; a label is one only a curator makes; a
 * status is keyed by its slug. The access-control entities are the format's, with WE's fields.
 */
export const FORMAT_ENTITIES: Record<string, VectorEntity> = {
  Card: { properties: { status: { type: 'string' }, title: { type: 'string', required: true } }, relations: {} },
  Item: {
    properties: { kind: { type: 'string' }, slug: { type: 'string' }, title: { type: 'string' } },
    relations: {
      children: { target: 'Item', cardinality: 'many', ordered: true },
      mentions: { target: 'Item', cardinality: 'many' },
    },
  },
  Label: { properties: { name: { type: 'string', required: true } }, relations: {} },
  Policy: { properties: { document: { type: 'json', required: true } }, relations: {} },
  Role: {
    properties: {
      description: { type: 'string', default: '' },
      name: { type: 'string', required: true, default: '' },
      slug: { type: 'string', default: '' },
    },
    relations: {},
  },
  RoleGrant: {
    properties: {
      agent: { type: 'string', required: true, default: '' },
      revokedAt: { type: 'string', default: '' },
      role: { type: 'string', required: true, default: '' },
    },
    relations: {},
  },
  Status: { properties: { name: { type: 'string', required: true }, slug: { type: 'string' } }, relations: {} },
};

/** A record the dataset starts with. */
export interface SeedRecord {
  entity: string;
  id: string;
  fields: Record<string, unknown>;
  /** Relations to set once every seed record exists, by name, as ids in order. */
  relations?: Record<string, string[]>;
}

/**
 * What is read back after the operation: these fields and relations of every record of the entity.
 * `fields` may name `author`, the record metadata a backend stamps from the agent writing.
 */
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
  /**
   * Somebody other than the invoker the dataset was seeded by, for a case about what may be done to
   * another person's records. Such a case ends before anything is written: the runner's agent is the
   * only writer there is.
   */
  invoker?: string;
  invocationId: string;
  invokedAt: string;
  /**
   * Records another writer commits while the operation runs: after its first `expect` find has read,
   * and before the operation ends. What an `expect` exists to notice.
   */
  concurrent?: SeedRecord[];
  /**
   * The dataset's identity domain, for a case about a dataset that names itself by a record (a
   * space); `{ arriving: true }` for one naming itself by a record the agent does not hold yet.
   * Absent: none.
   */
  domain?: string | { arriving: true };
  /** The manifest version the caller wrote against, for a case about calling the wrong one. Absent: none given. */
  version?: string;
  /** Entities the host refuses this caller when a step chooses them at call time. Absent: none. */
  deniedChosen?: string[];
  observe: Observation[];
}

/** A property as a vector states it: only what changes what an operation reads or writes. */
export type VectorProperty = Pick<PropertySchema, 'type' | 'required' | 'default'>;

/** A relation as a vector states it. `ordered` is what decides how its members are compared. */
export type VectorRelation = Pick<RelationSchema, 'target' | 'cardinality' | 'ordered' | 'reverseOf'>;

/** An entity schema as a vector states it, in the format's data model. */
export interface VectorEntity {
  properties: Record<string, VectorProperty>;
  relations: Record<string, VectorRelation>;
  abstract?: boolean;
  blockable?: boolean;
}

/**
 * The write check the vectors run under: the dataset's policy, and what is true of the invoker.
 *
 * In WE's policy format, the one the host evaluates: a write is allowed when a permission governing
 * its action reaches the writer. A permission naming an action exactly is the only kind that governs
 * it; otherwise the wildcards do (`*` is every action but the access-control entities'). `anyone` is
 * every writer, `author` the author of the record acted on (for a create, the writer), `{ role }`
 * whoever holds that role.
 */
export interface VectorPolicy {
  rules: Policy;
  invoker: { member: boolean; roles: string[] };
}

/** One recorded case: the case as data, and what running it produced. */
export interface OperationVector {
  id: string;
  note: string;
  /** The case's operation, and any operation of the suite's it calls. Its entities are the file's. */
  manifest: { version: string; operations: Record<string, OperationDefinition> };
  /**
   * WE's own operations the case's operations call, at any depth, by qualified name (`core.thread`)
   * — registered under their own namespaces by whoever runs the vector, as a call names them.
   */
  calls: Record<string, OperationDefinition>;
  dataset: SeedRecord[];
  operation: string;
  args: Record<string, unknown>;
  invoker: string;
  invocationId: string;
  invokedAt: string;
  concurrent?: SeedRecord[];
  domain?: string | { arriving: true };
  version?: string;
  deniedChosen?: string[];
  observe: Observation[];
  outcome: { result: unknown } | { error: { class: string; code: string } };
  records: Record<string, ObservedRecord[]>;
}

/** A vector before it has been run. */
export type VectorInput = Omit<OperationVector, 'outcome' | 'records'>;

/** The whole file: what every case shares, and the cases. */
export interface OperationVectorFile {
  version: 2;
  /** Every entity a case names, and every entity those relate to, by name. */
  entities: Record<string, VectorEntity>;
  /** The access-control entities: no operation may write one. */
  protectedEntities: string[];
  policy: VectorPolicy;
  cases: OperationVector[];
}

/** What a vector runs against, from its file. */
export type VectorContext = Pick<OperationVectorFile, 'entities' | 'policy'>;

export type ObservedRecord = Record<string, unknown> & { id: string };

const ITEMS: Observation = {
  entity: 'Item',
  fields: ['kind', 'title', 'slug'],
  relations: ['children'],
};

const link = (of: string, target: string) => ({
  link: { entity: 'Item', id: { $: of }, relation: 'children', target: { $: target } },
});

const OPERATIONS: Record<string, OperationDefinition> = {
  makeBoard: {
    description: 'A board and a column under it for each column given.',
    params: { title: { type: 'string', required: true }, columns: { type: 'list', required: true } },
    steps: [
      { create: { as: 'board', entity: 'Item', fields: { kind: 'board', title: { $: 'title' } } } },
      {
        forEach: {
          in: { $: 'columns' },
          as: 'col',
          steps: [
            {
              create: {
                as: 'column',
                entity: 'Item',
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
      { find: { as: 'found', entity: 'Item', where: { kind: 'tag', slug: { $: 'slug' } } } },
      {
        create: { as: 'made', entity: 'Item', fields: { kind: 'tag', slug: { $: 'slug' } } },
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
      { create: { entity: 'Item', fields: { kind: 'note', title: 'before' } } },
      { check: { condition: { $: 'n < 10' }, error: 'tooBig' } },
      { create: { entity: 'Item', fields: { kind: 'note', title: 'after' } } },
    ],
  },
  writeTwice: {
    description: 'Makes a note and retitles it in the same operation.',
    steps: [
      { create: { as: 'note', entity: 'Item', fields: { kind: 'note', title: 'first' } } },
      { update: { entity: 'Item', id: { $: 'note.id' }, fields: { title: 'second' } } },
    ],
    returns: { $: 'note.id' },
  },
  touchTags: {
    description: 'Marks every tag as seen, one at a time, and answers with the tags it found.',
    steps: [
      { find: { as: 'tags', entity: 'Item', where: { kind: 'tag' }, order: { slug: 'asc' } } },
      {
        forEach: {
          in: { $: 'tags' },
          as: 'tag',
          steps: [{ update: { entity: 'Item', id: { $: 'tag.id' }, fields: { title: 'seen' } } }],
        },
      },
    ],
    returns: { $: 'tags.map(t, t.id)' },
  },
  adopt: {
    description: 'Puts a record under another, strictly: refused when it is there already.',
    params: { parent: { type: 'string', required: true }, child: { type: 'string', required: true } },
    steps: [
      {
        link: {
          entity: 'Item',
          id: { $: 'parent' },
          relation: 'children',
          target: { $: 'child' },
          strict: true,
        },
      },
    ],
  },
  expecting: {
    description: 'Reads the notes, expecting them to stay as read, and makes a tag.',
    steps: [
      { find: { as: 'notes', entity: 'Item', where: { kind: 'note' }, expect: true } },
      { create: { entity: 'Item', fields: { kind: 'tag', slug: 'seen' } } },
    ],
    returns: { $: 'count(notes)' },
  },
  walkTwoDeep: {
    description: 'The titles of what is under a record, two levels down.',
    params: { root: { type: 'string', required: true } },
    steps: [
      {
        find: {
          as: 'found',
          entity: 'Item',
          scope: { anchor: 'Item', via: 'children', anchorId: { $: 'root' }, levels: [10, 10] },
          order: { title: 'asc' },
        },
      },
    ],
    returns: { $: 'found.map(r, r.title)' },
  },
  walkAll: {
    description: 'The titles of everything under a record, however deep.',
    params: { root: { type: 'string', required: true } },
    steps: [
      {
        find: {
          as: 'found',
          entity: 'Item',
          scope: { anchor: 'Item', via: 'children', anchorId: { $: 'root' }, transitive: true },
          order: { title: 'asc' },
        },
      },
    ],
    returns: { $: 'found.map(r, r.title)' },
  },
  otherTags: {
    description: 'The tags whose slug is not garden, a tag with no slug among them.',
    steps: [
      {
        find: {
          as: 'found',
          entity: 'Item',
          where: { kind: 'tag', NOT: { slug: 'garden' } },
          order: { title: 'asc' },
        },
      },
    ],
    returns: { $: 'found.map(r, r.title)' },
  },
  noteThenTag: {
    description: 'Makes a note and then a label, which the policy lets only a curator make.',
    steps: [
      { create: { entity: 'Item', fields: { kind: 'note', title: 'before' } } },
      { create: { entity: 'Label', fields: { name: 'garden' } } },
    ],
  },
  orderKept: {
    description: 'Puts the children named first, keeping the rest after them in the order they held.',
    params: { parent: { type: 'string', required: true }, ids: { type: 'list', required: true } },
    steps: [
      {
        setRelation: {
          entity: 'Item',
          id: { $: 'parent' },
          relation: 'children',
          targets: { $: 'ids' },
          keep: true,
        },
      },
    ],
  },
  takeBack: {
    description: 'Deletes a record, only if the invoker made it.',
    params: { id: { type: 'string', required: true } },
    steps: [{ delete: { entity: 'Item', id: { $: 'id' }, own: true } }],
  },
  makeAndDrop: {
    description: 'Makes a note and deletes it, which only its author may.',
    steps: [
      { create: { as: 'note', entity: 'Item', fields: { kind: 'note', title: 'brief' } } },
      { delete: { entity: 'Item', id: { $: 'note.id' } } },
    ],
  },
  note: {
    description: 'A note with this title.',
    params: { title: { type: 'string', required: true } },
    steps: [{ create: { as: 'made', entity: 'Item', fields: { kind: 'note', title: { $: 'title' } } } }],
    returns: { $: 'made.id' },
  },
  noteThroughCall: {
    description: 'A note made by calling the operation that makes one.',
    params: { title: { type: 'string', required: true } },
    steps: [{ call: { as: 'made', operation: 'conformance.note', args: { title: { $: 'title' } } } }],
    returns: { $: 'made' },
  },
  maybeNote: {
    description: 'A note when asked for one, and whether it was made.',
    params: { make: { type: 'boolean', required: true } },
    steps: [
      {
        create: { as: 'made', entity: 'Item', fields: { kind: 'note', title: 'maybe' } },
        when: { $: 'make' },
      },
    ],
    returns: { $: "made.id ?? 'absent'" },
  },
  writeChosen: {
    description: 'Makes a note, then a record of the entity it is given, from a list naming a protected one.',
    params: { entity: { type: 'string', required: true } },
    steps: [
      { create: { entity: 'Item', fields: { kind: 'note', title: 'before' } } },
      { create: { entity: { $: 'entity' }, oneOf: ['Item', 'Policy'], fields: {} } },
    ],
  },
  /*
    Records keyed by identity: their ids derive from the entity and the slug, never the invocation.
  */
  nameState: {
    description: 'A status, keyed by its slug.',
    params: { slug: { type: 'string', required: true } },
    steps: [
      {
        create: {
          as: 'made',
          entity: 'Status',
          identity: ['slug'],
          fields: { name: { $: 'slug' }, slug: { $: 'slug' } },
        },
      },
    ],
    returns: { $: 'made.id' },
  },
  nameStateTwice: {
    description: 'The same status named twice in one operation, and a note before it.',
    params: { slug: { type: 'string', required: true } },
    steps: [
      { create: { entity: 'Item', fields: { kind: 'note', title: 'before' } } },
      { create: { entity: 'Status', identity: ['slug'], fields: { name: 'One', slug: { $: 'slug' } } } },
      { create: { entity: 'Status', identity: ['slug'], fields: { name: 'Two', slug: { $: 'slug' } } } },
    ],
  },
  nameStateBesideNote: {
    description: 'A status keyed by its slug and a note keyed by the invocation, answering both ids.',
    params: { slug: { type: 'string', required: true } },
    steps: [
      {
        create: {
          as: 'state',
          entity: 'Status',
          identity: ['slug'],
          fields: { name: { $: 'slug' }, slug: { $: 'slug' } },
        },
      },
      { create: { as: 'note', entity: 'Item', fields: { kind: 'note', title: { $: 'slug' } } } },
    ],
    returns: { $: '[state.id, note.id]' },
  },
  retitle: {
    description: 'Retitles one note.',
    params: { id: { type: 'string', required: true } },
    steps: [{ update: { entity: 'Item', id: { $: 'id' }, fields: { title: 'retitled' } } }],
  },
  theTag: {
    description: 'The one tag there is, or a failure.',
    steps: [{ find: { as: 'tag', entity: 'Item', where: { kind: 'tag' }, one: true } }],
    returns: { $: 'tag.id' },
  },
  unlinkStrictly: {
    description: 'Takes a record out of a holder, asserting it was in it.',
    params: { holder: { type: 'string', required: true }, target: { type: 'string', required: true } },
    steps: [
      {
        unlink: {
          entity: 'Item',
          id: { $: 'holder' },
          relation: 'children',
          target: { $: 'target' },
          strict: true,
        },
      },
    ],
  },
  readsNobody: {
    description: 'Titles a note from a name nothing binds.',
    steps: [{ create: { entity: 'Item', fields: { kind: 'note', title: { $: 'nobody' } } } }],
  },
  makesNowhere: {
    description: 'Creates a record of an entity the dataset has no type for.',
    steps: [{ create: { entity: 'Nowhere', fields: { title: 'x' } } }],
  },
  makesChosen: {
    description: 'Creates a record of the entity the caller names, among items only.',
    params: { kind: { type: 'string', required: true } },
    steps: [{ create: { entity: { $: 'kind' }, oneOf: ['Item'], fields: { $: '{ kind: "note" }' } } }],
  },
  makesAny: {
    description: 'Creates a record of whatever entity the caller names, with the fields given.',
    params: { kind: { type: 'string', required: true }, fields: { type: 'object', required: true } },
    steps: [{ create: { entity: { $: 'kind' }, oneOf: [{ category: 'any' }], fields: { $: 'fields' } } }],
  },
  notesFor: {
    description: 'A note per item given.',
    params: { items: { type: 'json', required: true } },
    steps: [
      {
        forEach: {
          in: { $: 'items' },
          as: 'item',
          steps: [{ create: { entity: 'Item', fields: { kind: 'note', title: { $: 'item.title' } } } }],
        },
      },
    ],
  },
  firstTags: {
    description: 'The first tags, as many as asked for.',
    params: { n: { type: 'number', required: true } },
    steps: [{ find: { as: 'tags', entity: 'Item', where: { kind: 'tag' }, limit: { $: 'n' } } }],
    returns: { $: 'count(tags)' },
  },
  callsNowhere: {
    description: 'Calls an operation nobody registered.',
    steps: [{ call: { operation: 'conformance.nowhere' } }],
  },
  deep0: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep1' } }],
  },
  deep1: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep2' } }],
  },
  deep2: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep3' } }],
  },
  deep3: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep4' } }],
  },
  deep4: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep5' } }],
  },
  deep5: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep6' } }],
  },
  deep6: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep7' } }],
  },
  deep7: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep8' } }],
  },
  deep8: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep9' } }],
  },
  deep9: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep10' } }],
  },
  deep10: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep11' } }],
  },
  deep11: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep12' } }],
  },
  deep12: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep13' } }],
  },
  deep13: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep14' } }],
  },
  deep14: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep15' } }],
  },
  deep15: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep16' } }],
  },
  deep16: {
    description: 'One call of a chain seventeen deep.',
    steps: [{ call: { operation: 'conformance.deep17' } }],
  },
  deep17: {
    description: 'The bottom of a chain of calls seventeen deep.',
    steps: [{ create: { entity: 'Item', fields: { kind: 'note', title: 'bottom' } } }],
  },
  linkFour: {
    description: 'Links four records under a holder, in the order given, through an ordered and an unordered relation.',
    params: {
      holder: { type: 'string', required: true },
      first: { type: 'string', required: true },
      second: { type: 'string', required: true },
      third: { type: 'string', required: true },
      fourth: { type: 'string', required: true },
    },
    steps: [
      ...(['first', 'second', 'third', 'fourth'] as const).map((target) => ({
        link: { entity: 'Item', id: { $: 'holder' }, relation: 'children', target: { $: target } },
      })),
      ...(['first', 'second', 'third', 'fourth'] as const).map((target) => ({
        link: { entity: 'Item', id: { $: 'holder' }, relation: 'mentions', target: { $: target } },
      })),
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
  observe: [ITEMS],
});
const TODO = { key: 'todo', title: 'To do' };
const DONE = { key: 'done', title: 'Done' };
const TAG = { entity: 'Item', id: 'urn:example:tag-garden', fields: { kind: 'tag', slug: 'garden' } };
/** The ids create-and-link's invocation derives for its board (path `0`) and its done column (`1`, `k=done`, `0`). */
const BOARD = 'urn:uuid:30198dab-4163-8c59-abb3-e132517aa975';
const DONE_COLUMN = 'urn:uuid:b5aaccfb-347d-82b8-844c-ed58404febc5';
/** root holds a and b; a holds a1; a1 holds a1x — three levels under root. */
const TREE: SeedRecord[] = [
  { entity: 'Item', id: 'urn:example:a1x', fields: { kind: 'folder', title: 'a1x' } },
  {
    entity: 'Item',
    id: 'urn:example:a1',
    fields: { kind: 'folder', title: 'a1' },
    relations: { children: ['urn:example:a1x'] },
  },
  {
    entity: 'Item',
    id: 'urn:example:a',
    fields: { kind: 'folder', title: 'a' },
    relations: { children: ['urn:example:a1'] },
  },
  { entity: 'Item', id: 'urn:example:b', fields: { kind: 'folder', title: 'b' } },
  {
    entity: 'Item',
    id: 'urn:example:root',
    fields: { kind: 'folder', title: 'root' },
    relations: { children: ['urn:example:a', 'urn:example:b'] },
  },
];

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
    observe: [ITEMS],
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
    observe: [ITEMS],
  },
  {
    id: 'found-carries-id',
    note: 'a found record carries its id: a step reads it by name, and a forEach over found records keys by it',
    operations: OPERATIONS,
    dataset: [TAG, { entity: 'Item', id: 'urn:example:tag-weeds', fields: { kind: 'tag', slug: 'weeds' } }],
    operation: 'touchTags',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000024',
    invokedAt: AT,
    observe: [ITEMS],
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
    observe: [ITEMS],
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
    observe: [ITEMS],
  },
  {
    id: 'strict-link',
    note: 'a strict link to a record already linked fails as alreadyLinked and changes nothing',
    operations: OPERATIONS,
    dataset: [
      { entity: 'Item', id: 'urn:example:child', fields: { kind: 'card' } },
      {
        entity: 'Item',
        id: 'urn:example:parent',
        fields: { kind: 'board' },
        relations: { children: ['urn:example:child'] },
      },
    ],
    operation: 'adopt',
    args: { parent: 'urn:example:parent', child: 'urn:example:child' },
    invocationId: '00000000-0000-4000-8000-000000000006',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'set-relation-keep',
    note: 'a setRelation that keeps puts the named members first and every other member after them, in the order they held',
    operations: OPERATIONS,
    dataset: [
      { entity: 'Item', id: 'urn:example:k1', fields: { kind: 'card', title: 'k1' } },
      { entity: 'Item', id: 'urn:example:k2', fields: { kind: 'card', title: 'k2' } },
      { entity: 'Item', id: 'urn:example:k3', fields: { kind: 'card', title: 'k3' } },
      {
        entity: 'Item',
        id: 'urn:example:holder',
        fields: { kind: 'board', title: 'holder' },
        relations: { children: ['urn:example:k1', 'urn:example:k2', 'urn:example:k3'] },
      },
    ],
    operation: 'orderKept',
    args: { parent: 'urn:example:holder', ids: ['urn:example:k3'] },
    invocationId: '00000000-0000-4000-8000-000000000090',
    invokedAt: AT,
    observe: [ITEMS],
  },
  /*
    The runner's rules the cases above leave open: a read that must not move under the operation, a
    walk down a relation, a NOT over a field a record lacks, the write check refusing, an id made
    inside a call, a guarded create that does not run, a replay, and a write no operation may make.
  */
  {
    id: 'expect-holds',
    note: 'an expect find that reads the same at the end lets the operation land',
    operations: OPERATIONS,
    dataset: [{ entity: 'Item', id: 'urn:example:note', fields: { kind: 'note', title: 'mine' } }],
    operation: 'expecting',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000030',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'expect-changed',
    note: 'a note committed by another writer after the expect find read fails the operation as expectChanged, and its tag does not land',
    operations: OPERATIONS,
    dataset: [{ entity: 'Item', id: 'urn:example:note', fields: { kind: 'note', title: 'mine' } }],
    operation: 'expecting',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000031',
    invokedAt: AT,
    concurrent: [{ entity: 'Item', id: 'urn:example:their-note', fields: { kind: 'note', title: 'theirs' } }],
    observe: [ITEMS],
  },
  {
    id: 'find-scope-levels',
    note: 'a find walking two levels down a relation reaches the children and grandchildren, and stops there',
    operations: OPERATIONS,
    dataset: TREE,
    operation: 'walkTwoDeep',
    args: { root: 'urn:example:root' },
    invocationId: '00000000-0000-4000-8000-000000000032',
    invokedAt: AT,
    observe: [],
  },
  {
    id: 'find-scope-transitive',
    note: 'a transitive find reaches everything under the record, however deep',
    operations: OPERATIONS,
    dataset: TREE,
    operation: 'walkAll',
    args: { root: 'urn:example:root' },
    invocationId: '00000000-0000-4000-8000-000000000033',
    invokedAt: AT,
    observe: [],
  },
  {
    id: 'not-absent',
    note: 'NOT over a comparison matches a record with no value for the field, as well as one with another value',
    operations: OPERATIONS,
    dataset: [
      { ...TAG, fields: { ...TAG.fields, title: 'Garden' } },
      {
        entity: 'Item',
        id: 'urn:example:tag-weeds',
        fields: { kind: 'tag', slug: 'weeds', title: 'Weeds' },
      },
      { entity: 'Item', id: 'urn:example:tag-bare', fields: { kind: 'tag', title: 'Bare' } },
    ],
    operation: 'otherTags',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000034',
    invokedAt: AT,
    observe: [],
  },
  {
    id: 'refused-write',
    note: 'a write the policy refuses fails the operation as refused, and the note made before it does not land',
    operations: OPERATIONS,
    dataset: [],
    operation: 'noteThenTag',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000035',
    invokedAt: AT,
    observe: [ITEMS, { entity: 'Label', fields: ['name'], relations: [] }],
  },
  {
    id: 'author-deletes-own',
    note: 'a record the operation made is its invoker’s, so a policy letting only the author delete lets the operation delete it',
    operations: OPERATIONS,
    dataset: [],
    operation: 'makeAndDrop',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000036',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'call-derived-id',
    note: 'a record made inside a call takes its id from the call’s path, and its author is the invoker',
    operations: OPERATIONS,
    dataset: [],
    operation: 'noteThroughCall',
    args: { title: 'called' },
    invocationId: '00000000-0000-4000-8000-000000000037',
    invokedAt: AT,
    observe: [{ entity: 'Item', fields: ['kind', 'title', 'author'], relations: [] }],
  },
  {
    id: 'when-false-create',
    note: 'a create whose when is false writes nothing, and the name it would have bound reads as no value',
    operations: OPERATIONS,
    dataset: [],
    operation: 'maybeNote',
    args: { make: false },
    invocationId: '00000000-0000-4000-8000-000000000038',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'forEach-replay',
    note: 'create-and-link replayed onto a dataset holding its done column: the replay names the same id for that key, is refused as recordExists, and adds nothing',
    operations: OPERATIONS,
    dataset: [{ entity: 'Item', id: DONE_COLUMN, fields: { kind: 'column', title: 'Done' } }],
    operation: 'makeBoard',
    args: { title: 'Plan', columns: [TODO, DONE] },
    invocationId: '00000000-0000-4000-8000-000000000001',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'create-onto-held-id',
    note: 'a create whose derived id a record of another entity already holds is refused as recordExists',
    operations: OPERATIONS,
    dataset: [{ entity: 'Card', id: BOARD, fields: { title: 'Squatter', status: 'todo' } }],
    operation: 'note',
    args: { title: 'late' },
    invocationId: '00000000-0000-4000-8000-000000000001',
    invokedAt: AT,
    observe: [ITEMS, { entity: 'Card', fields: ['title'], relations: [] }],
  },
  {
    id: 'protected-entity',
    note: 'a write to an access-control entity, chosen at run time, fails as static protectedEntity, and the note made before it does not land',
    operations: OPERATIONS,
    dataset: [],
    operation: 'writeChosen',
    args: { entity: 'Policy' },
    invocationId: '00000000-0000-4000-8000-000000000039',
    invokedAt: AT,
    observe: [ITEMS, { entity: 'Policy', fields: [], relations: [] }],
  },
  {
    id: 'relation-order',
    // Written in the reverse of code-point order, four of them: a backend that loses the written
    // order shows it, rather than happening to answer in it.
    note: 'an ordered relation reads back in the order written, an unordered one compares as a set, and records list by id in code-point order',
    operations: OPERATIONS,
    dataset: [
      { entity: 'Item', id: 'urn:example:holder', fields: { kind: 'board' } },
      { entity: 'Item', id: 'urn:example:alpha', fields: { kind: 'card' } },
      { entity: 'Item', id: 'urn:example:Zed', fields: { kind: 'card' } },
      { entity: 'Item', id: 'urn:example:Yew', fields: { kind: 'card' } },
      { entity: 'Item', id: 'urn:example:Xi', fields: { kind: 'card' } },
    ],
    operation: 'linkFour',
    args: {
      holder: 'urn:example:holder',
      first: 'urn:example:alpha',
      second: 'urn:example:Zed',
      third: 'urn:example:Yew',
      fourth: 'urn:example:Xi',
    },
    invocationId: '00000000-0000-4000-8000-000000000040',
    invokedAt: AT,
    observe: [{ entity: 'Item', fields: ['kind'], relations: ['children', 'mentions'] }],
  },
  /*
    Identity: the id a keyed create derives is the entity's and the slug's, the same from any
    invocation; a second create of it is refused; and it is never an id an invocation derives.
  */
  {
    id: 'identity-id',
    note: 'a create keyed by identity derives its id from the entity and the slug, not the invocation',
    operations: OPERATIONS,
    dataset: [],
    operation: 'nameState',
    args: { slug: 'blocked' },
    invocationId: '00000000-0000-4000-8000-000000000041',
    invokedAt: AT,
    observe: [{ entity: 'Status', fields: ['name', 'slug'], relations: [] }],
  },
  {
    id: 'identity-id-other-invocation',
    note: 'another invocation naming the same identity derives the same id as identity-id',
    operations: OPERATIONS,
    dataset: [],
    operation: 'nameState',
    args: { slug: 'blocked' },
    invocationId: '00000000-0000-4000-8000-000000000042',
    invokedAt: AT,
    observe: [{ entity: 'Status', fields: ['name', 'slug'], relations: [] }],
  },
  {
    id: 'identity-id-in-space',
    note: 'in a dataset with an identity domain (a space), the same identity derives another id, within that domain',
    operations: OPERATIONS,
    dataset: [],
    operation: 'nameState',
    args: { slug: 'blocked' },
    invocationId: '00000000-0000-4000-8000-000000000041',
    invokedAt: AT,
    domain: 'urn:example:space-a',
    observe: [{ entity: 'Status', fields: ['name', 'slug'], relations: [] }],
  },
  {
    id: 'identity-space-not-ready',
    note: 'in a dataset naming itself by a record not held yet, an identity create is refused as spaceNotReady, never derived without the domain',
    operations: OPERATIONS,
    dataset: [],
    operation: 'nameState',
    args: { slug: 'blocked' },
    invocationId: '00000000-0000-4000-8000-000000000091',
    invokedAt: AT,
    domain: { arriving: true },
    observe: [{ entity: 'Status', fields: ['name', 'slug'], relations: [] }],
  },
  {
    id: 'identity-twice',
    note: 'a second create of the same identity is refused as recordExists, and nothing the operation made lands',
    operations: OPERATIONS,
    dataset: [],
    operation: 'nameStateTwice',
    args: { slug: 'blocked' },
    invocationId: '00000000-0000-4000-8000-000000000043',
    invokedAt: AT,
    observe: [ITEMS, { entity: 'Status', fields: ['name', 'slug'], relations: [] }],
  },
  {
    id: 'identity-not-invocation',
    note: 'a record keyed by identity and one keyed by the invocation get different ids, the first the one identity-id derives',
    operations: OPERATIONS,
    dataset: [],
    operation: 'nameStateBesideNote',
    args: { slug: 'blocked' },
    invocationId: '00000000-0000-4000-8000-000000000044',
    invokedAt: AT,
    observe: [ITEMS, { entity: 'Status', fields: ['slug'], relations: [] }],
  },
  {
    id: 'delete-own-mine',
    note: 'a delete of the invoker’s own record deletes it',
    operations: OPERATIONS,
    dataset: [{ entity: 'Item', id: 'urn:example:mine', fields: { kind: 'note', title: 'mine' } }],
    operation: 'takeBack',
    args: { id: 'urn:example:mine' },
    invocationId: '00000000-0000-4000-8000-000000000045',
    invokedAt: AT,
    observe: [{ entity: 'Item', fields: ['kind', 'title', 'author'], relations: [] }],
  },
  {
    id: 'delete-own-not-mine',
    note: 'a delete of one’s own record, invoked by somebody who did not make it, fails as notOwn and deletes nothing',
    operations: OPERATIONS,
    dataset: [{ entity: 'Item', id: 'urn:example:theirs', fields: { kind: 'note', title: 'theirs' } }],
    operation: 'takeBack',
    args: { id: 'urn:example:theirs' },
    invoker: 'did:example:visitor',
    invocationId: '00000000-0000-4000-8000-000000000046',
    invokedAt: AT,
    observe: [{ entity: 'Item', fields: ['kind', 'title', 'author'], relations: [] }],
  },
  {
    id: 'set-relation-keep-adds',
    note: 'a setRelation that keeps adds a member it names that the relation did not hold, and removes none',
    operations: OPERATIONS,
    dataset: [
      { entity: 'Item', id: 'urn:example:k1', fields: { kind: 'card', title: 'k1' } },
      { entity: 'Item', id: 'urn:example:k2', fields: { kind: 'card', title: 'k2' } },
      { entity: 'Item', id: 'urn:example:k3', fields: { kind: 'card', title: 'k3' } },
      {
        entity: 'Item',
        id: 'urn:example:holder',
        fields: { kind: 'board', title: 'holder' },
        relations: { children: ['urn:example:k1', 'urn:example:k2'] },
      },
    ],
    operation: 'orderKept',
    args: { parent: 'urn:example:holder', ids: ['urn:example:k3', 'urn:example:k1'] },
    invocationId: '00000000-0000-4000-8000-000000000047',
    invokedAt: AT,
    observe: [ITEMS],
  },

  {
    id: 'update-missing',
    note: 'an update naming a record that is not there fails as notFound',
    operations: OPERATIONS,
    dataset: [],
    operation: 'retitle',
    args: { id: 'urn:example:gone' },
    invocationId: '00000000-0000-4000-8000-000000000048',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'find-one-ambiguous',
    note: 'a find with one that matches two records fails as ambiguous',
    operations: OPERATIONS,
    dataset: [TAG, { entity: 'Item', id: 'urn:example:tag-weeds', fields: { kind: 'tag', slug: 'weeds' } }],
    operation: 'theTag',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000049',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'strict-unlink',
    note: 'a strict unlink of a record that is not a member fails as notLinked and changes nothing',
    operations: OPERATIONS,
    dataset: [
      { entity: 'Item', id: 'urn:example:parent', fields: { kind: 'board', title: 'parent' } },
      { entity: 'Item', id: 'urn:example:stranger', fields: { kind: 'note', title: 'stranger' } },
    ],
    operation: 'unlinkStrictly',
    args: { holder: 'urn:example:parent', target: 'urn:example:stranger' },
    invocationId: '00000000-0000-4000-8000-000000000050',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'bad-args',
    note: 'args missing a required param fail as badArgs before anything runs',
    operations: OPERATIONS,
    dataset: [],
    operation: 'retitle',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000051',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'unbound-name',
    note: 'an expression reading a name nothing binds fails as unboundName',
    operations: OPERATIONS,
    dataset: [],
    operation: 'readsNobody',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000052',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'unknown-entity',
    note: 'a create of an entity the dataset has no type for fails as unknownEntity',
    operations: OPERATIONS,
    dataset: [],
    operation: 'makesNowhere',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000053',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'outside-one-of',
    note: 'a chosen entity its oneOf does not admit fails as outsideOneOf, and nothing lands',
    operations: OPERATIONS,
    dataset: [],
    operation: 'makesChosen',
    args: { kind: 'Status' },
    invocationId: '00000000-0000-4000-8000-000000000054',
    invokedAt: AT,
    observe: [ITEMS, { entity: 'Status', fields: ['name', 'slug'], relations: [] }],
  },
  {
    id: 'not-granted',
    note: 'a chosen entity the host refuses this caller fails as notGranted, and nothing lands',
    operations: OPERATIONS,
    dataset: [],
    operation: 'makesAny',
    args: { kind: 'Status', fields: { name: 'Blocked', slug: 'blocked' } },
    invocationId: '00000000-0000-4000-8000-000000000055',
    invokedAt: AT,
    deniedChosen: ['Status'],
    observe: [ITEMS, { entity: 'Status', fields: ['name', 'slug'], relations: [] }],
  },
  {
    id: 'forEach-no-key',
    note: 'a forEach item with no id, no key and no key expression fails as forEachKey, and nothing lands',
    operations: OPERATIONS,
    dataset: [],
    operation: 'notesFor',
    args: { items: [{ title: 'one' }] },
    invocationId: '00000000-0000-4000-8000-000000000056',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'not-a-list',
    note: 'a forEach over something that is not a list fails as notAList',
    operations: OPERATIONS,
    dataset: [],
    operation: 'notesFor',
    args: { items: 'one' },
    invocationId: '00000000-0000-4000-8000-000000000057',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'call-depth',
    note: 'calls nested seventeen deep fail as callDepth, and the record at the bottom does not land',
    operations: OPERATIONS,
    dataset: [],
    operation: 'deep0',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000058',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'malformed-limit',
    note: 'a limit that is not a whole number fails as malformed',
    operations: OPERATIONS,
    dataset: [TAG],
    operation: 'firstTags',
    args: { n: 1.5 },
    invocationId: '00000000-0000-4000-8000-000000000059',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'unknown-operation',
    note: 'a call to an operation nobody registered fails as unknownOperation',
    operations: OPERATIONS,
    dataset: [],
    operation: 'callsNowhere',
    args: {},
    invocationId: '00000000-0000-4000-8000-000000000060',
    invokedAt: AT,
    observe: [ITEMS],
  },
  {
    id: 'version-mismatch',
    note: 'an invocation for a version of the namespace other than the registered one fails as versionMismatch',
    operations: OPERATIONS,
    dataset: [TAG],
    operation: 'retitle',
    args: { id: 'urn:example:tag-garden' },
    invocationId: '00000000-0000-4000-8000-000000000061',
    invokedAt: AT,
    version: '2',
    observe: [ITEMS],
  },
];

/** WE's own operations over WE's manifest: conformance for a host adopting WE's domain, not the format. */
const CORE_CASES: OperationCase[] = [
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
        fields: { agent: VECTOR_INVOKER, kind: 'maybe', node: 'urn:example:event' },
      },
      {
        entity: 'Involvement',
        id: 'urn:example:other-event',
        fields: { agent: VECTOR_INVOKER, kind: 'maybe', node: 'urn:example:elsewhere' },
      },
    ],
    operation: 'respond',
    args: { node: 'urn:example:event', kind: 'going' },
    invocationId: '00000000-0000-4000-8000-000000000008',
    invokedAt: AT,
    observe: [{ entity: 'Involvement', fields: ['agent', 'kind'], relations: ['node'] }],
  },
  {
    id: 'core-set-involvement-to-one',
    note: 'core.setInvolvement finds the pair on this record by its to-one, leaves the same pair on another record, and writes the new one’s node as one id',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'InvolvementType', id: 'urn:example:assignee', fields: { name: 'Assignee', slug: 'assignee' } },
      {
        entity: 'Involvement',
        id: 'urn:example:on-other-task',
        fields: { agent: 'did:example:ana', kind: 'assignee', node: 'urn:example:other-task' },
      },
    ],
    operation: 'setInvolvement',
    args: { node: 'urn:example:task', agent: 'did:example:ana', kind: 'assignee', on: true },
    invocationId: '00000000-0000-4000-8000-000000000013',
    invokedAt: AT,
    observe: [{ entity: 'Involvement', fields: ['agent', 'kind'], relations: ['node'] }],
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
  /*
    The generic record writes, on whatever record type they are handed: several deleted as one act,
    and a record moved between holders through a relation the call names.
  */
  {
    id: 'core-delete-records-any',
    note: 'core.deleteRecords deletes records of two types named at run time, and leaves the rest',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'TaskBlock', id: 'urn:example:gone-task', fields: { title: 'Gone', status: 'todo' } },
      { entity: 'TaskBlock', id: 'urn:example:kept-task', fields: { title: 'Kept', status: 'todo' } },
      { entity: 'TextBlock', id: 'urn:example:gone-line', fields: { text: 'gone' } },
    ],
    operation: 'deleteRecords',
    args: {
      records: [
        { entity: 'TaskBlock', id: 'urn:example:gone-task' },
        { entity: 'TextBlock', id: 'urn:example:gone-line' },
      ],
    },
    invocationId: '00000000-0000-4000-8000-000000000022',
    invokedAt: AT,
    observe: [
      { entity: 'TaskBlock', fields: ['title'], relations: [] },
      { entity: 'TextBlock', fields: ['text'], relations: [] },
    ],
  },
  {
    id: 'core-move-under',
    note: 'core.moveUnder takes a record off one holder’s list and onto another’s, the relation named at run time',
    operations: CORE_OPERATIONS,
    dataset: [
      { entity: 'TaskBlock', id: 'urn:example:card', fields: { title: 'Card', status: 'todo' } },
      {
        entity: 'CollectionBlock',
        id: 'urn:example:from',
        fields: { kind: 'folder' },
        relations: { children: ['urn:example:card'] },
      },
      { entity: 'CollectionBlock', id: 'urn:example:to', fields: { kind: 'folder' } },
    ],
    operation: 'moveUnder',
    args: {
      holder: 'CollectionBlock',
      relation: 'children',
      record: 'urn:example:card',
      from: 'urn:example:from',
      to: 'urn:example:to',
    },
    invocationId: '00000000-0000-4000-8000-000000000023',
    invokedAt: AT,
    observe: [{ entity: 'CollectionBlock', fields: ['kind'], relations: ['children'] }],
  },
];

/** The suite's own operations a definition calls, by bare name, and their callees in turn. */
function suiteCallees(name: string, into: Record<string, OperationDefinition>): void {
  if (name in into || !OPERATIONS[name]) return;
  into[name] = OPERATIONS[name];
  for (const called of callsOf(OPERATIONS[name]))
    if (called.startsWith(`${VECTOR_NAMESPACE}.`)) suiteCallees(called.slice(VECTOR_NAMESPACE.length + 1), into);
}

/**
 * Each case carries only the operation it runs, and the suite's operations that one calls, so its
 * vector reads on its own.
 */
function trimmed(c: OperationCase): OperationCase {
  if (c.operations !== OPERATIONS) return { ...c, operations: { [c.operation]: c.operations[c.operation] } };
  const operations: Record<string, OperationDefinition> = {};
  suiteCallees(c.operation, operations);
  return { ...c, operations };
}

/** The format's cases, over the neutral entities: what an operations-only host must pass. */
export const OPERATION_CASES: OperationCase[] = CASES.map(trimmed);

/** WE's own operations' cases, over WE's manifest: what a host adopting WE's domain must pass too. */
export const CORE_OPERATION_CASES: OperationCase[] = CORE_CASES.map(trimmed);

/** Code-point order, the one every language can reproduce; `localeCompare` is the reader's alphabet. */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (char) => char.codePointAt(0)!);
  const y = Array.from(b, (char) => char.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

const sortedKeys = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.keys(record)
      .sort(compareCodePoints)
      .map((key) => [key, record[key]]),
  );

/** WE's own operations a case's operations call, at any depth, by qualified name, sorted. */
function coreCalls(operations: Record<string, OperationDefinition>): Record<string, OperationDefinition> {
  const found: Record<string, OperationDefinition> = {};
  const visit = (current: OperationDefinition) => {
    for (const name of callsOf(current)) {
      const callee = name.startsWith('core.') ? CORE_OPERATIONS[name.slice('core.'.length)] : undefined;
      if (!callee || name in found) continue;
      found[name] = callee;
      visit(callee);
    }
  };
  for (const op of Object.values(operations)) visit(op);
  return sortedKeys(found);
}

type StepBody = {
  entity?: unknown;
  oneOf?: unknown[];
  scope?: { anchor?: unknown };
  parent?: { entity?: unknown };
  steps?: unknown[];
  expect?: unknown;
};

/** Each verb's body in a list of steps, at any depth of `forEach`. */
function* bodiesOf(steps: unknown[] | undefined): Generator<[string, StepBody]> {
  for (const step of steps ?? []) {
    for (const [verb, body] of Object.entries(step as Record<string, unknown>)) {
      if (verb === 'when' || !body || typeof body !== 'object') continue;
      yield [verb, body];
      yield* bodiesOf((body as StepBody).steps);
    }
  }
}

/**
 * The entity schemas the cases need, as the file carries them: every entity a case seeds, observes or
 * names in a step (its own operations' and the ones they call), every entity a relation of those
 * targets, and the access-control entities — each with only what changes what an operation does.
 */
/** Entities a case names so that the dataset has no type for them: never in the file's entities. */
const UNDECLARED_ENTITIES = new Set(['Nowhere']);

export function vectorEntities(
  cases: readonly OperationCase[] = OPERATION_CASES,
  schemas: Record<string, EntitySchema | VectorEntity> = FORMAT_ENTITIES,
): Record<string, VectorEntity> {
  const named = new Set<string>(PROTECTED_ENTITIES);
  for (const c of cases) {
    for (const record of [...c.dataset, ...(c.concurrent ?? []), ...c.observe]) named.add(record.entity);
    for (const op of [...Object.values(c.operations), ...Object.values(coreCalls(c.operations))])
      for (const [, body] of bodiesOf(op.steps)) {
        for (const name of [body.entity, ...(body.oneOf ?? []), body.scope?.anchor, body.parent?.entity])
          if (typeof name === 'string') named.add(name);
      }
  }
  const out: Record<string, VectorEntity> = {};
  const add = (name: string) => {
    if (name in out) return;
    if (UNDECLARED_ENTITIES.has(name)) return;
    const schema = schemas[name];
    if (!schema) throw new Error(`A case names "${name}", which the suite's entities do not declare`);
    out[name] = neutralEntity(schema);
    for (const relation of Object.values(schema.relations)) if (relation.target) add(relation.target);
  };
  for (const name of named) add(name);
  return sortedKeys(out);
}

function neutralEntity(schema: EntitySchema): VectorEntity {
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, { type, required, default: fallback }]) => [
      name,
      { type, ...(required ? { required } : {}), ...(fallback !== undefined ? { default: fallback } : {}) },
    ]),
  );
  const relations = Object.fromEntries(
    Object.entries(schema.relations).map(([name, { target, cardinality, ordered, reverseOf }]) => [
      name,
      { target, cardinality, ...(ordered ? { ordered } : {}), ...(reverseOf ? { reverseOf } : {}) },
    ]),
  );
  return {
    properties: sortedKeys(properties),
    relations: sortedKeys(relations),
    ...(schema.abstract ? { abstract: true } : {}),
    ...(schema.blockable ? { blockable: true } : {}),
  };
}

/** The access-control entities, as the file lists them. */
export const VECTOR_PROTECTED_ENTITIES = [...PROTECTED_ENTITIES].sort(compareCodePoints);

export const OPERATION_CONFORMANCE_CASES = [...OPERATION_CASES, ...CORE_OPERATION_CASES].map(
  (c) => `operations.${c.id}` as const,
);
export type OperationConformanceCase = `operations.${string}`;

interface Model {
  create(dataset: DatasetHandle, data: Record<string, unknown>, options?: { id?: string }): Promise<{ id: string }>;
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  setRelation(dataset: DatasetHandle, id: string, relation: string, ids: readonly string[]): Promise<void>;
}

const model = (entity: string, dataset: DatasetHandle) => {
  const found = getEntityForDataset(entity, dataset);
  if (!found) throw new Error(`The dataset has no type for "${entity}"`);
  return found as unknown as Model;
};

/** Absent and empty read alike on every backend: the contract never stores ''. */
const present = (value: unknown) => value !== undefined && value !== null && value !== '';

const idsIn = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === 'string' ? entry : String((entry as { id?: unknown }).id)))
    : [];

/** `value` with every string equal to `from` replaced by `to`, at any depth. */
function swap<T>(value: T, from: string, to: string): T {
  if (from === to) return value;
  if (value === from) return to as T;
  if (Array.isArray(value)) return value.map((entry: unknown) => swap(entry, from, to)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, swap(entry, from, to)])) as T;
  return value;
}

async function seed(dataset: DatasetHandle, records: readonly SeedRecord[]): Promise<void> {
  for (const record of records) await model(record.entity, dataset).create(dataset, record.fields, { id: record.id });
  for (const record of records)
    for (const [relation, ids] of Object.entries(record.relations ?? {}))
      await model(record.entity, dataset).setRelation(dataset, record.id, relation, ids);
}

/**
 * Read back what a case observes, in the file's terms: records by id in code-point order, each
 * relation's members as read when the schema says it is ordered and in code-point order when it is a
 * set, so a backend that keeps a set in another order still matches.
 */
async function observe(
  dataset: DatasetHandle,
  observations: readonly Observation[],
  entities: Record<string, VectorEntity>,
): Promise<Record<string, ObservedRecord[]>> {
  const records: Record<string, ObservedRecord[]> = {};
  for (const { entity, fields, relations } of observations) {
    const toOne = (relation: string) => entities[entity]?.relations[relation]?.cardinality === 'one';
    // A row carries its relations as target ids without an include, and an include would ask the
    // backend to hydrate records the relation may not hold (`WeNode.mentions` holds agents' DIDs). A
    // to-one is read as it stands on the row, the one id, so a backend holding it any other way
    // differs from the file.
    const rows = await model(entity, dataset).findAll(dataset, {});
    records[entity] = rows
      .map((row) => {
        const out: ObservedRecord = { id: row.id as string };
        for (const field of fields) if (present(row[field])) out[field] = row[field];
        for (const relation of relations) {
          if (toOne(relation)) {
            if (present(row[relation])) out[relation] = row[relation];
            continue;
          }
          const ids = idsIn(row[relation]);
          if (!ids.length) continue;
          out[relation] = entities[entity]?.relations[relation]?.ordered ? ids : [...ids].sort(compareCodePoints);
        }
        return out;
      })
      .sort((a, b) => compareCodePoints(a.id, b.id));
  }
  return records;
}

/** The write check a host would register for the file's policy, with `person` the agent writing. */
function policyCheck(policy: VectorPolicy, person: string): EntityWriteCheck {
  return async (write) => {
    const request: ActionRequest = { action: actionOf(write.entity, write.kind, write.relation) };
    if (write.kind === 'create') {
      request.author = person;
      request.after = write.data ?? {};
    } else {
      // Always the backend's answer: what the transaction has staged, or else what is committed.
      const record = (await write.record?.()) ?? null;
      request.author = typeof record?.author === 'string' ? record.author : null;
      request.before = record;
      if (write.kind === 'edit') {
        request.after = record ? { ...record, ...write.data } : null;
        request.changed = Object.keys(write.data ?? {});
      }
    }
    const refusal = evaluate(policy.rules, request, { person, ...policy.invoker });
    if (refusal) throw new PolicyRefusal(refusal);
  };
}

/**
 * Commit a vector's `concurrent` records the moment its first `expect` find has read: another
 * writer landing between the read and the operation's end. Done by wrapping the find's entity's
 * read, since that read is the only moment the contract lets a caller see. Returns the undo.
 */
function interleave(dataset: DatasetHandle, vector: VectorInput, records: readonly SeedRecord[]): () => void {
  if (!records.length) return () => {};
  const finds = Object.values(vector.manifest.operations).flatMap((op) =>
    [...bodiesOf(op.steps)].filter(([verb, body]) => verb === 'find' && body.expect === true),
  );
  const entity = finds[0]?.[1].entity;
  if (typeof entity !== 'string') throw new Error(`${vector.id} has concurrent records but no expect find`);
  const Model = model(entity, dataset) as unknown as Record<string, unknown>;
  const own = Object.getOwnPropertyDescriptor(Model, 'findAll');
  const read = Model.findAll as (...args: unknown[]) => Promise<unknown>;
  let landed = false;
  Model.findAll = async function (this: unknown, ...args: unknown[]) {
    const rows = await read.apply(this, args);
    if (!landed) {
      landed = true;
      await seed(dataset, records);
    }
    return rows;
  };
  return () => {
    if (own) Object.defineProperty(Model, 'findAll', own);
    else delete Model.findAll;
  };
}

/**
 * Run one vector on a fresh subject and say what it produced, in the file's terms.
 *
 * `registerCalls` registers the vector's `calls` under their own namespaces, as an implementation
 * with none of WE's operations of its own does; a WE backend already has them.
 */
export async function runVector(
  subject: ConformanceSubject,
  context: VectorContext,
  vector: VectorInput,
  opts: { registerCalls?: boolean } = {},
): Promise<Pick<OperationVector, 'outcome' | 'records'>> {
  const agent = subject.agent;
  // The file's invoker wrote the seeds and is the runner's agent; a case may be invoked by another.
  const inbound = <T>(value: T) => swap(value, VECTOR_INVOKER, agent);
  const invoker = vector.invoker === VECTOR_INVOKER ? agent : vector.invoker;
  await seed(subject.dataset, inbound(vector.dataset));

  if (opts.registerCalls) {
    const byNamespace: Record<string, Record<string, OperationDefinition>> = {};
    for (const [name, definition] of Object.entries(vector.calls)) {
      const dot = name.indexOf('.');
      (byNamespace[name.slice(0, dot)] ??= {})[name.slice(dot + 1)] = definition;
    }
    for (const [namespace, operations] of Object.entries(byNamespace))
      registerOperations(namespace, operations, { entities: context.entities });
  }
  registerOperations(VECTOR_NAMESPACE, vector.manifest.operations, {
    entities: context.entities,
    version: vector.manifest.version,
  });
  const undo = interleave(subject.dataset, vector, inbound(vector.concurrent ?? []));
  registerEntityWriteCheck(policyCheck(context.policy, agent));
  let outcome: OperationVector['outcome'];
  try {
    const result = await runOperation(`${VECTOR_NAMESPACE}.${vector.operation}`, inbound(vector.args), {
      dataset: subject.dataset,
      invoker,
      invocationId: vector.invocationId,
      invokedAt: vector.invokedAt,
      // The case's, never the host's: a dataset in a vector has the identity domain the file gives it.
      domain: vector.domain ?? null,
      ...(vector.version ? { version: vector.version } : {}),
      ...(vector.deniedChosen ? { admitChosen: (entity: string) => !vector.deniedChosen!.includes(entity) } : {}),
    });
    outcome = { result: result === undefined ? null : swap(result, agent, VECTOR_INVOKER) };
  } catch (error) {
    if (!isOperationError(error)) throw error;
    outcome = { error: { class: error.class, code: error.code } };
  } finally {
    registerEntityWriteCheck(null);
    undo();
    unregisterOperations(VECTOR_NAMESPACE);
  }
  const records = await observe(subject.dataset, vector.observe, context.entities);
  return { outcome, records: swap(records, agent, VECTOR_INVOKER) };
}

/** A case as its vector states it, before it is run. */
export function vectorInput(c: OperationCase): VectorInput {
  return {
    id: c.id,
    note: c.note,
    manifest: { version: '1', operations: c.operations },
    calls: coreCalls(c.operations),
    dataset: c.dataset,
    operation: c.operation,
    args: c.args,
    invoker: c.invoker ?? VECTOR_INVOKER,
    invocationId: c.invocationId,
    invokedAt: c.invokedAt,
    ...(c.concurrent ? { concurrent: c.concurrent } : {}),
    ...(c.domain ? { domain: c.domain } : {}),
    ...(c.version ? { version: c.version } : {}),
    ...(c.deniedChosen ? { deniedChosen: c.deniedChosen } : {}),
    observe: c.observe,
  };
}

/** A case as its vector records it: everything another implementation needs to run it. */
export function vectorOf(c: OperationCase, produced: Pick<OperationVector, 'outcome' | 'records'>): OperationVector {
  return { ...vectorInput(c), ...produced };
}

/**
 * One file of operation vectors: its cases, the schemas their entities are drawn from, and the policy
 * they run under.
 *
 * Two files, because the halves differ in what every case shares: the format's cases run over a few
 * neutral entities under a policy naming them, and WE's own operations over WE's manifest under one
 * naming WE's. An operations-only host loads the first and never the second.
 */
export interface OperationVectorSuite {
  /** `format` for the format's own rules; `we-core` for WE's core operations. */
  profile: 'format' | 'we-core';
  file: URL;
  cases: readonly OperationCase[];
  schemas: Record<string, EntitySchema | VectorEntity>;
  policy: VectorPolicy;
}

export const FORMAT_VECTOR_SUITE: OperationVectorSuite = {
  profile: 'format',
  file: new URL('../vectors/operations/operations.json', import.meta.url),
  cases: OPERATION_CASES,
  schemas: FORMAT_ENTITIES,
  policy: VECTOR_POLICY,
};

export const CORE_VECTOR_SUITE: OperationVectorSuite = {
  profile: 'we-core',
  file: new URL('../vectors/operations/we-core/operations.json', import.meta.url),
  cases: CORE_OPERATION_CASES,
  schemas: CORE_MANIFEST.entities,
  policy: CORE_VECTOR_POLICY,
};

export const OPERATION_VECTOR_SUITES = [FORMAT_VECTOR_SUITE, CORE_VECTOR_SUITE] as const;

/** A file's shared sections, as the cases written here need them. */
export function vectorContext(suite: OperationVectorSuite = FORMAT_VECTOR_SUITE): Omit<OperationVectorFile, 'cases'> {
  return {
    version: 2,
    entities: vectorEntities(suite.cases, suite.schemas),
    protectedEntities: VECTOR_PROTECTED_ENTITIES,
    policy: suite.policy,
  };
}

export const OPERATION_VECTORS_FILE = FORMAT_VECTOR_SUITE.file;

/** The recorded vectors of one file, as committed: the format's unless another is named. */
export function readOperationVectors(suite: OperationVectorSuite = FORMAT_VECTOR_SUITE): OperationVectorFile {
  return JSON.parse(readFileSync(suite.file, 'utf8')) as OperationVectorFile;
}

/** Entity names this file has declared on a backend, so a later subject declares them again on its own. */
const declaredForVectors = new Set<string>();

/**
 * Give the subject's dataset every entity the file names that the backend does not already have,
 * the way a module's entities are installed. A WE backend already has the access-control entities
 * and WE's own; the format's neutral ones it lacks, and gets here.
 */
async function installVectorEntities(subject: ConformanceSubject, entities: Record<string, VectorEntity>) {
  const missing = Object.fromEntries(
    Object.entries(entities).filter(
      ([name]) => declaredForVectors.has(name) || !getEntityForDataset(name, subject.dataset),
    ),
  );
  if (!Object.keys(missing).length) return;
  for (const name of Object.keys(missing)) declaredForVectors.add(name);
  const payloads = subject.ports.schemas.declareInDataset(
    subject.dataset,
    { version: '1', entities: missing },
    { moduleId: VECTOR_NAMESPACE },
  );
  await subject.ports.schemas.installModules(subject.dataset, Object.values(payloads));
}

export function describeOperations(name: string, harness: ConformanceHarness, timeout: number): void {
  for (const suite of OPERATION_VECTOR_SUITES) describeSuite(name, suite, harness, timeout);

  describe(`backend conformance: ${name} — declared operations`, () => {
    it('lists as known only operation cases it has', () => {
      // A misspelt name would otherwise leave its case running plain, and its reason unread.
      const listed = [...Object.keys(harness.knownGaps ?? {}), ...Object.keys(harness.knownIntermittent ?? {})];
      const known = new Set<string>(OPERATION_CONFORMANCE_CASES);
      expect(listed.filter((id) => id.startsWith('operations.') && !known.has(id))).toEqual([]);
    });
  });
}

function describeSuite(name: string, suite: OperationVectorSuite, harness: ConformanceHarness, timeout: number) {
  describe(`backend conformance: ${name} — declared operations (${suite.profile})`, () => {
    let subject: ConformanceSubject;
    const file = readOperationVectors(suite);

    beforeEach(async () => {
      subject = await harness.setup();
      await installVectorEntities(subject, file.entities);
      return () => harness.teardown?.(subject);
    }, timeout);

    const recorded = new Map(file.cases.map((vector) => [vector.id, vector]));

    it('has a recorded vector for every case, and no vector without one', () => {
      expect([...recorded.keys()].sort()).toEqual(suite.cases.map((c) => c.id).sort());
    });

    it('carries the entities, the protected entities and the policy the cases run under', () => {
      const { cases: _cases, ...shared } = file;
      expect(shared).toEqual(vectorContext(suite));
    });

    for (const c of suite.cases) {
      const id: OperationConformanceCase = `operations.${c.id}`;
      const body = async () => {
        const vector = recorded.get(c.id);
        expect(vector, `no vector recorded for ${c.id}`).toBeDefined();
        // The case as written must still be the case as recorded, or the vector is stale.
        expect(vectorOf(c, { outcome: vector!.outcome, records: vector!.records })).toEqual(vector);
        expect(await runVector(subject, file, vector!)).toEqual({ outcome: vector!.outcome, records: vector!.records });
      };
      const gap = harness.knownGaps?.[id];
      const intermittent = harness.knownIntermittent?.[id];
      if (gap) it.fails(`${c.note} [known gap: ${gap}]`, body, timeout);
      // As in the main suite: retried, and each retry runs the hooks again on a fresh subject.
      else if (intermittent) it(`${c.note} [intermittent: ${intermittent}]`, { timeout, retry: 4 }, body);
      else it(c.note, body, timeout);
    }
  });
}
