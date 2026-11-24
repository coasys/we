/**
 * Declared operations without a backend: the static checks, the effect summary, the id derivation,
 * and the core operations as data. Running them is tested against the in-memory backend, in its
 * package.
 */
import type { EntityManifest, OperationDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { CORE_MANIFEST, CORE_OPERATIONS } from '../src/manifest';
import { postBlockId, THREAD_SUBJECTS } from '../src/manifest/operations/content';
import {
  deriveRecordId,
  describeEffects,
  describeOperation,
  effectSummary,
  getOperation,
  listOperations,
  operationCatalog,
  registerOperations,
  unregisterOperations,
  validateOperations,
} from '../src/operations';

const MANIFEST = (operations: Record<string, unknown>): EntityManifest => ({
  version: '1',
  entities: {
    Board: {
      properties: { title: { type: 'string', required: true }, note: { type: 'string' } },
      relations: {
        columns: { target: 'Column', cardinality: 'many', ordered: true },
        lead: { target: 'Column', cardinality: 'one' },
      },
    },
    Column: { properties: { title: { type: 'string', default: '' } }, relations: {} },
  },
  operations: operations as Record<string, OperationDefinition>,
});

const op = (steps: unknown[], extra: Record<string, unknown> = {}) => ({ description: 'A test.', steps, ...extra });

/** The messages, by path, the validator gives one operation named `t`. */
const issues = (definition: unknown, opts: Parameters<typeof validateOperations>[1] = {}) =>
  validateOperations(MANIFEST({ t: definition }), { namespace: 'demo', ...opts }).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );

describe('static checks', () => {
  it('pass a well-formed operation', () => {
    const good = op(
      [
        { create: { as: 'board', entity: 'Board', fields: { title: { $: 'title' } } } },
        {
          forEach: {
            in: { $: 'columns' },
            as: 'col',
            steps: [
              { create: { as: 'column', entity: 'Column', fields: { title: { $: 'col.title' } } } },
              { link: { entity: 'Board', id: { $: 'board.id' }, relation: 'columns', target: { $: 'column' } } },
            ],
          },
        },
      ],
      {
        params: { title: { type: 'string', required: true }, columns: { type: 'list' } },
        returns: { $: 'board.id' },
      },
    );
    expect(issues(good)).toEqual([]);
  });

  it('check a link whose entity is chosen by expression against every name it may be', () => {
    const link = (extra: Record<string, unknown>) =>
      op([{ link: { id: 'b', relation: 'columns', target: 'c', ...extra } }], {
        params: { which: { type: 'string' } },
      });
    expect(issues(link({ entity: { $: 'which' }, oneOf: ['Board'] }))).toEqual([]);
    expect(issues(link({ entity: { $: 'which' } }))).toEqual([
      'operations.t.steps.0.link.oneOf: an entity chosen by expression must list what it may be in "oneOf"',
    ]);
    expect(issues(link({ entity: { $: 'which' }, oneOf: ['Board', 'Column'] }))).toEqual([
      'operations.t.steps.0.link.relation: Column has no relation "columns"',
    ]);
  });

  it('refuse a name read before it is bound, and the template names an operation has no use for', () => {
    expect(
      issues(
        op([
          { update: { entity: 'Board', id: { $: 'later.id' }, fields: { note: { $: 'me.did' } } } },
          { find: { as: 'later', entity: 'Board' } },
        ]),
      ),
    ).toEqual([
      'operations.t.steps.0.update.id: "later" is not bound here — an operation reads its params, invoker, invokedAt and what earlier steps named',
      'operations.t.steps.0.update.fields.note: "me" is not bound here — an operation reads its params, invoker, invokedAt and what earlier steps named',
    ]);
  });

  it('keep a loop’s names inside the loop', () => {
    const leaky = op([
      { forEach: { in: [{ id: 'a' }], as: 'x', steps: [{ find: { as: 'inner', entity: 'Board' } }] } },
      { delete: { entity: 'Board', id: { $: 'inner' } } },
    ]);
    expect(issues(leaky)).toEqual([
      'operations.t.steps.1.delete.id: "inner" is not bound here — an operation reads its params, invoker, invokedAt and what earlier steps named',
    ]);
  });

  it('refuse a duplicate name, and a param shadowing one every operation has', () => {
    expect(issues(op([{ find: { as: 'x', entity: 'Board' } }, { find: { as: 'x', entity: 'Board' } }], {}))).toEqual([
      'operations.t.steps.1.find.as: "x" is already bound here',
    ]);
    expect(issues(op([], { params: { invoker: { type: 'string' } } }))).toEqual([
      'operations.t.params.invoker: "invoker" is bound for every operation, so a param cannot take the name',
    ]);
    expect(issues(op([{ find: { as: 'title', entity: 'Board' } }], { params: { title: { type: 'string' } } }))).toEqual(
      ['operations.t.steps.0.find.as: "title" is already bound here'],
    );
  });

  it('refuse unknown entities, fields and relations, and a link on a to-one relation', () => {
    expect(
      issues(
        op([
          { create: { entity: 'Card', fields: {} } },
          { create: { entity: 'Board', fields: { title: 'x', colour: 'red' } } },
          { link: { entity: 'Board', id: 'b', relation: 'cards', target: 'c' } },
          { link: { entity: 'Board', id: 'b', relation: 'lead', target: 'c' } },
          { find: { as: 'f', entity: 'Board', where: { colour: 'red' }, order: { size: 'asc' } } },
        ]),
      ),
    ).toEqual([
      'operations.t.steps.0.create.entity: unknown entity "Card"',
      'operations.t.steps.1.create.fields.colour: Board has no field "colour"',
      'operations.t.steps.2.link.relation: Board has no relation "cards"',
      'operations.t.steps.3.link.relation: "lead" holds one record; a to-one relation is written as a field, not linked',
      'operations.t.steps.4.find.where.colour: Board has no field "colour"',
      'operations.t.steps.4.find.order.size: Board has no field "size" to order by',
    ]);
  });

  it('refuse a create missing a required field with no default', () => {
    expect(issues(op([{ create: { entity: 'Board', fields: { note: 'x' } } }]))).toEqual([
      'operations.t.steps.0.create.fields: Board requires "title", which this create does not give',
    ]);
  });

  it('hold an entity chosen by expression to a oneOf of known names', () => {
    expect(
      issues(op([{ create: { entity: { $: 'kind' }, fields: {} } }], { params: { kind: { type: 'string' } } })),
    ).toEqual([
      'operations.t.steps.0.create.oneOf: an entity chosen by expression must list what it may be in "oneOf"',
    ]);
    expect(
      issues(
        op([{ create: { entity: { $: 'kind' }, oneOf: ['Column', 'Card'], fields: {} } }], {
          params: { kind: { type: 'string' } },
        }),
      ),
    ).toEqual(['operations.t.steps.0.create.oneOf.1: unknown entity "Card"']);
  });

  it('expand a category in oneOf to the entities in view that are in it, and refuse an unknown one', () => {
    const blocks: EntityManifest = {
      version: '1',
      entities: {
        Note: { blockable: true, properties: { version: { type: 'number', default: 0 } }, relations: {} },
        Pin: {
          blockable: true,
          properties: { version: { type: 'number', default: 0 } },
          relations: { columns: { target: 'Column', cardinality: 'many' } },
        },
        Shelf: { abstract: true, blockable: true, properties: {}, relations: {} },
      },
    };
    const linkAny = (oneOf: unknown[]) =>
      op([{ link: { entity: { $: 'kind' }, oneOf, id: 'b', relation: 'columns', target: 'c' } }], {
        params: { kind: { type: 'string' } },
      });
    // Note is a block without the relation; Board is not a block; the abstract Shelf is in no category.
    expect(issues(linkAny([{ category: 'blockable' }]), { external: blocks })).toEqual([
      'operations.t.steps.0.link.relation: Note has no relation "columns"',
    ]);
    expect(issues(linkAny([{ category: 'pinnable' }]), { external: blocks })).toEqual([
      `operations.t.steps.0.link.oneOf.0: "pinnable" is not a category — an entry is an entity's name or one of { "category": "blockable" }`,
    ]);
    const createAny = (fields: unknown) =>
      op([{ create: { entity: { $: 'kind' }, oneOf: [{ category: 'blockable' }], fields } }], {
        params: { kind: { type: 'string' }, given: { type: 'object' } },
      });
    expect(issues(createAny({ $: 'given' }), { external: blocks })).toEqual([]);
    expect(issues(createAny({}), { external: blocks })).toEqual([
      'operations.t.steps.0.create.fields: a create whose entity may be any of a category takes its fields as one expression — what is in the category is not all known here',
    ]);
  });

  it('refuse a name the expression language reads as one of its own words', () => {
    expect(issues(op([], { params: { in: { type: 'list' } } }))).toEqual([
      'operations.t.params.in: "in" is an operator in an expression, so no expression could read a param by that name — name it something else',
    ]);
    expect(issues(op([{ find: { as: 'null', entity: 'Board' } }]))).toEqual([
      'operations.t.steps.0.find.as: "null" is a literal in an expression, so no expression could read what a step binds by that name — name it something else',
    ]);
  });

  it('refuse a write to the entities that decide who may write', () => {
    const external = CORE_MANIFEST;
    for (const entity of ['Policy', 'Role', 'RoleGrant'])
      expect(issues(op([{ delete: { entity, id: 'x' } }]), { external })).toEqual([
        `operations.t.steps.0.delete.entity: an operation may not write ${entity} — who may write what is never changed by one`,
      ]);
    // Reading one is fine: a check may ask what the policy says.
    expect(issues(op([{ find: { as: 'p', entity: 'Policy' } }]), { external })).toEqual([]);
  });

  it('allow only core functions', () => {
    expect(
      issues(op([{ check: { condition: { $: 'calendarMonth({})' }, error: 'no' } }], { errors: { no: 'No.' } })),
    ).toEqual([
      'operations.t.steps.0.check.condition: "calendarMonth" is not a core function. Only the core library is callable here, because a function one host provides means nothing on another',
    ]);
  });

  it('refuse a check naming an undeclared error', () => {
    expect(issues(op([{ check: { condition: true, error: 'nope' } }]))).toEqual([
      'operations.t.steps.0.check.error: "nope" is not one of this operation\'s errors — declare it in "errors"',
    ]);
  });

  it('refuse nesting forEach more than three deep', () => {
    const loop = (as: string, steps: unknown[]) => ({ forEach: { in: [], as, key: { $: 'invoker' }, steps } });
    const deep = op([loop('a', [loop('b', [loop('c', [loop('d', [])])])])]);
    expect(issues(deep).filter((i) => i.includes('nests'))).toHaveLength(1);
  });

  it('refuse a literal list item with no key', () => {
    expect(issues(op([{ forEach: { in: [{ title: 'a' }], as: 'x', steps: [] } }]))).toEqual([
      'operations.t.steps.0.forEach.in.0: an item needs an "id" or a "key", or the forEach a "key" expression',
    ]);
  });

  it('resolve calls, check their args, and refuse a cycle', () => {
    const manifest = MANIFEST({
      a: op([{ call: { operation: 'demo.b', args: { n: 1 } } }]),
      b: op([{ call: { operation: 'demo.a' } }], { params: { n: { type: 'number', required: true } } }),
      c: op([{ call: { operation: 'demo.b', args: { m: 1 } } }, { call: { operation: 'other.x' } }]),
    });
    expect(validateOperations(manifest, { namespace: 'demo' }).map((i) => `${i.path}: ${i.message}`)).toEqual([
      'operations.c.steps.0.call.args.m: demo.b has no param "m"',
      'operations.c.steps.0.call.args: demo.b requires "n"',
      'operations.c.steps.1.call.operation: no operation "other.x" is known',
      'operations.a: calls itself: demo.a → demo.b → demo.a',
      'operations.b: calls itself: demo.b → demo.a → demo.b',
    ]);
  });
});

describe('the effect summary', () => {
  it('lists verbs per entity across branches and calls, with bulk and destructive', () => {
    const removeLead = op([{ unlink: { entity: 'Board', id: 'b', relation: 'columns', target: 'c' } }]);
    const definition = op([
      { create: { as: 'board', entity: 'Board', fields: { title: 'x' } } },
      { update: { entity: 'Board', id: 'b', fields: {} }, when: false },
      {
        forEach: {
          in: [],
          as: 'c',
          steps: [
            { create: { entity: 'Column', fields: {}, parent: { id: 'b', relation: 'columns', entity: 'Board' } } },
          ],
        },
      },
      { call: { operation: 'demo.removeLead' } },
    ]) as OperationDefinition;
    const summary = effectSummary(definition, {
      operations: (name) => (name === 'demo.removeLead' ? (removeLead as OperationDefinition) : undefined),
    });
    expect(summary).toEqual({
      entities: { Board: ['add:columns', 'create', 'edit', 'remove:columns'], Column: ['create'] },
      categories: {},
      bulk: true,
      destructive: true,
    });
  });

  it('is not bulk or destructive for one create', () => {
    expect(effectSummary(op([{ create: { entity: 'Column', fields: {} } }]) as OperationDefinition)).toEqual({
      entities: { Column: ['create'] },
      categories: {},
      bulk: false,
      destructive: false,
    });
  });

  it('counts a category in oneOf as itself, never as what is in it', () => {
    const summary = effectSummary(
      op([
        { create: { entity: { $: 'kind' }, oneOf: [{ category: 'blockable' }], fields: { $: 'fields' } } },
        {
          link: {
            entity: { $: 'kind' },
            oneOf: [{ category: 'blockable' }, 'Board'],
            id: 'b',
            relation: 'thread',
            target: 'c',
          },
        },
      ]) as OperationDefinition,
    );
    expect(summary).toEqual({
      entities: { Board: ['add:thread'] },
      categories: { blockable: ['add:thread', 'create'] },
      bulk: false,
      destructive: false,
    });
    expect(describeEffects(summary)).toBe(
      'adds to Board.thread; adds to thread on any block type; creates any block type',
    );
  });
});

describe('record ids', () => {
  it('are stable: the same invocation and path always give the same id', async () => {
    const id = await deriveRecordId('3f2b8c1e-0000-4000-8000-000000000001', ['0', 'k=todo', '0']);
    expect(id).toBe(await deriveRecordId('3f2b8c1e-0000-4000-8000-000000000001', ['0', 'k=todo', '0']));
    expect(id).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Pinned, so a change to the derivation is a change somebody makes on purpose: every other
    // implementation has to derive this same id.
    expect(id).toBe(PINNED_ID);
  });

  it('depend on the key and the invocation, and cannot be confused by a key containing the framing', async () => {
    const base = await deriveRecordId('inv', ['0', 'k=a', '1']);
    expect(await deriveRecordId('inv', ['0', 'k=b', '1'])).not.toBe(base);
    expect(await deriveRecordId('other', ['0', 'k=a', '1'])).not.toBe(base);
    expect(await deriveRecordId('inv', ['0', 'k=a1', ''])).not.toBe(base);
    expect(await deriveRecordId('inv', ['0', '3:k=a', '1'])).not.toBe(base);
  });
});

describe('the core operations', () => {
  it('are data: each survives JSON unchanged', () => {
    for (const [name, definition] of Object.entries(CORE_OPERATIONS))
      expect(JSON.parse(JSON.stringify(definition)), name).toEqual(definition);
    expect(JSON.parse(JSON.stringify(CORE_MANIFEST.operations))).toEqual(CORE_MANIFEST.operations);
  });

  it('pass the static checks against the core vocabulary', () => {
    expect(validateOperations(CORE_MANIFEST, { namespace: 'core', operations: getOperation })).toEqual([]);
  });

  it('give createPost the block ids the host plans for its stored document', async () => {
    // The step path postBlockId derives from is the forEach that creates the blocks.
    const steps = CORE_OPERATIONS.createPost.steps;
    const loop = steps[3] as { forEach?: { steps: { create?: unknown }[] } };
    expect(loop.forEach?.steps[0]?.create).toBeDefined();
    expect(await postBlockId('inv', 'a')).toBe(await deriveRecordId('inv', ['3', 'k=a', '0']));
  });

  it('list only entities built on WeNode as what a thread’s subject may be, every core block among them', () => {
    const named = THREAD_SUBJECTS.filter((entry) => typeof entry === 'string');
    const blocks = Object.keys(CORE_MANIFEST.entities).filter((name) => CORE_MANIFEST.entities[name].blockable);
    expect(blocks.length).toBeGreaterThan(10);
    for (const name of [...named, ...blocks])
      expect(CORE_MANIFEST.entities[name]?.relations.thread, name).toBeDefined();
  });

  it('are registered under core', () => {
    expect(listOperations().filter((name) => name.startsWith('core.'))).toEqual(
      Object.keys(CORE_OPERATIONS)
        .map((name) => `core.${name}`)
        .sort(),
    );
  });
});

describe('the catalogue', () => {
  it('describes every registered operation from its definition, effects included', () => {
    registerOperations('demo', {
      tidy: op([{ delete: { entity: 'Board', id: { $: 'board' } } }], {
        params: { board: { type: 'string', required: true } },
      }),
      peek: op([{ find: { as: 'all', entity: 'Board' } }], { returns: { $: 'all' } }),
    } as unknown as Record<string, OperationDefinition>);
    try {
      expect(operationCatalog().map((entry) => entry.name)).toEqual(listOperations());
      expect(describeOperation('demo.tidy')).toEqual({
        name: 'demo.tidy',
        description: 'A test.',
        params: { board: { type: 'string', required: true } },
        returns: false,
        effects: { entities: { Board: ['delete'] }, categories: {}, bulk: false, destructive: true },
      });
      expect(describeOperation('demo.peek')?.returns).toBe(true);
      expect(describeOperation('demo.nothing')).toBeUndefined();
    } finally {
      unregisterOperations('demo');
    }
  });

  it('says what an operation writes in words', () => {
    expect(describeEffects({ entities: {}, categories: {}, bulk: false, destructive: false })).toBe('writes nothing');
    expect(
      describeEffects({
        entities: { Board: ['add:columns', 'create'], Column: ['delete'] },
        categories: {},
        bulk: true,
        destructive: true,
      }),
    ).toBe(
      'adds to Board.columns; creates a Board; deletes a Column (may write many records in one call, destructive)',
    );
  });
});

const PINNED_ID = 'urn:uuid:2ddc1399-ea85-86eb-add9-4f8c93c81318';
