/**
 * Declared operations without a backend: the static checks, the effect summary, the id derivation,
 * and the core operations as data. Running them is tested against the in-memory backend, in its
 * package.
 */
import type { EntityManifest, OperationDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { CORE_MANIFEST, CORE_OPERATIONS } from '../src/manifest';
import { deriveRecordId, effectSummary, getOperation, listOperations, validateOperations } from '../src/operations';

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
      bulk: true,
      destructive: true,
    });
  });

  it('is not bulk or destructive for one create', () => {
    expect(effectSummary(op([{ create: { entity: 'Column', fields: {} } }]) as OperationDefinition)).toEqual({
      entities: { Column: ['create'] },
      bulk: false,
      destructive: false,
    });
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

  it('are registered under core', () => {
    expect(listOperations().filter((name) => name.startsWith('core.'))).toEqual(
      Object.keys(CORE_OPERATIONS)
        .map((name) => `core.${name}`)
        .sort(),
    );
  });
});

const PINNED_ID = 'urn:uuid:2ddc1399-ea85-86eb-add9-4f8c93c81318';
