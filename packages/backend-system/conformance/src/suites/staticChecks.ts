/**
 * The static checks as vectors: a manifest's operations, and the problems an implementation must
 * refuse them for, by path (`format.md`, "Static checks").
 *
 * Each case names the check it shows by its number in the spec's list. An implementation conforms
 * when it refuses every case that has problems and accepts every case that has none; the paths are
 * what the spec says it SHOULD report, and the reference reports exactly these. Messages are each
 * implementation's own and are not in the file.
 *
 * The entities are the file's, in the format's data model; three of them are the access-control
 * entities, which no write may name.
 */
import { validateManifest } from '@we/backend-shared';
import { validateOperations } from '@we/entities';

/** The namespace every case's operations are registered under. */
export const STATIC_NAMESPACE = 'conformance';

export const STATIC_ENTITIES = {
  Board: {
    properties: {
      title: { type: 'string', required: true },
      note: { type: 'string' },
      done: { type: 'boolean' },
    },
    relations: {
      columns: { target: 'Column', cardinality: 'many', ordered: true },
      lead: { target: 'Column', cardinality: 'one' },
    },
  },
  Column: {
    properties: { title: { type: 'string', default: '' } },
    relations: { cards: { target: 'Card', cardinality: 'many' } },
  },
  Card: { properties: { text: { type: 'string' } }, relations: {} },
  Shelf: { abstract: true, properties: {}, relations: {} },
  Note: {
    blockable: true,
    properties: { version: { type: 'number', default: 0 }, text: { type: 'string' } },
    relations: {},
  },
  Policy: { properties: { document: { type: 'json' } }, relations: {} },
  Role: { properties: { slug: { type: 'string' }, name: { type: 'string' } }, relations: {} },
  RoleGrant: { properties: { role: { type: 'string' } }, relations: {} },
} as const;

export interface StaticCase {
  id: string;
  /** The number of the check the case shows, in the spec's list; 0 for a case every check passes. */
  check: number;
  note: string;
  operations: Record<string, unknown>;
}

const op = (steps: unknown[], extra: Record<string, unknown> = {}) => ({ description: 'A case.', steps, ...extra });
const kind = { kind: { type: 'string' } };

export const STATIC_CASES: StaticCase[] = [
  {
    id: 'static.well-formed',
    check: 0,
    note: 'a board, a column per item in a loop, a link, a call and a returns: nothing to refuse',
    operations: {
      makeBoard: op(
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
          { call: { operation: 'conformance.note', args: { text: { $: 'title' } } } },
        ],
        {
          params: { title: { type: 'string', required: true }, columns: { type: 'list' } },
          returns: { $: 'board.id' },
          serial: { $: 'title' },
        },
      ),
      note: op([{ create: { entity: 'Card', fields: { text: { $: 'text' } } } }], {
        params: { text: { type: 'string', required: true } },
      }),
    },
  },
  {
    id: 'static.structure-unknown-verb',
    check: 1,
    note: 'a step whose key is not one of the closed set of verbs',
    operations: { t: op([{ frobnicate: { entity: 'Board' } }]) },
  },
  {
    id: 'static.structure-unknown-key',
    check: 1,
    note: 'a misspelt key on a step body is refused, not ignored',
    operations: { t: op([{ create: { entity: 'Card', fields: {}, whn: true } }]) },
  },
  {
    id: 'static.structure-levels-and-transitive',
    check: 1,
    note: 'a scope with both levels and transitive',
    operations: {
      t: op([
        {
          find: {
            as: 'f',
            entity: 'Column',
            scope: { anchor: 'Board', via: 'columns', anchorId: 'b', levels: [5], transitive: true },
          },
        },
      ]),
    },
  },
  {
    id: 'static.structure-missing-required',
    check: 1,
    note: 'a create without fields, and an operation without a description',
    operations: { t: op([{ create: { entity: 'Card' } }]), u: { steps: [] } },
  },
  {
    id: 'static.unbound-before',
    check: 2,
    note: 'a name read before the step that binds it, and a name only a template has',
    operations: {
      t: op([
        { update: { entity: 'Board', id: { $: 'later.id' }, fields: { note: { $: 'me.did' } } } },
        { find: { as: 'later', entity: 'Board' } },
      ]),
    },
  },
  {
    id: 'static.unbound-loop-name',
    check: 2,
    note: 'a name bound inside a loop is not visible after it',
    operations: {
      t: op([
        { forEach: { in: [{ id: 'a' }], as: 'x', steps: [{ find: { as: 'inner', entity: 'Board' } }] } },
        { delete: { entity: 'Board', id: { $: 'inner' } } },
      ]),
    },
  },
  {
    id: 'static.rebinds-name',
    check: 3,
    note: 'an as reusing an earlier as, and one reusing a param',
    operations: {
      t: op([{ find: { as: 'x', entity: 'Board' } }, { find: { as: 'x', entity: 'Board' } }]),
      u: op([{ find: { as: 'title', entity: 'Board' } }], { params: { title: { type: 'string' } } }),
    },
  },
  {
    id: 'static.reserved-param',
    check: 3,
    note: 'a param named invoker, and one named in, which an expression reads as an operator',
    operations: {
      t: op([], { params: { invoker: { type: 'string' } } }),
      u: op([], { params: { in: { type: 'list' } } }),
    },
  },
  {
    id: 'static.keyword-as',
    check: 3,
    note: 'an as named null, which an expression reads as a literal',
    operations: { t: op([{ find: { as: 'null', entity: 'Board' } }]) },
  },
  {
    id: 'static.expression-does-not-parse',
    check: 4,
    note: 'an expression that does not parse',
    operations: { t: op([{ create: { entity: 'Card', fields: { text: { $: 'trim(' } } } }]) },
  },
  {
    id: 'static.host-function',
    check: 4,
    note: 'a call to a function one host provides, which is not core',
    operations: {
      t: op([{ check: { condition: { $: 'calendarMonth({})' }, error: 'no' } }], { errors: { no: 'No.' } }),
    },
  },
  {
    id: 'static.function-arity',
    check: 4,
    note: 'a core function called with more arguments than its signature takes',
    operations: { t: op([{ create: { entity: 'Card', fields: { text: { $: "trim('a', 'b')" } } } }]) },
  },
  {
    id: 'static.unknown-entity',
    check: 5,
    note: 'a create of an entity nothing declares',
    operations: { t: op([{ create: { entity: 'Lamp', fields: {} } }]) },
  },
  {
    id: 'static.unknown-one-of',
    check: 5,
    note: 'a oneOf naming an entity nothing declares',
    operations: {
      t: op([{ create: { entity: { $: 'kind' }, oneOf: ['Column', 'Lamp'], fields: {} } }], { params: kind }),
    },
  },
  {
    id: 'static.unknown-category',
    check: 5,
    note: 'a oneOf naming a category that does not exist',
    operations: {
      t: op([{ delete: { entity: { $: 'kind' }, oneOf: [{ category: 'pinnable' }], id: 'x' } }], { params: kind }),
    },
  },
  {
    id: 'static.chosen-without-one-of',
    check: 5,
    note: 'an entity chosen by expression with no oneOf, and a named entity that carries one',
    operations: {
      t: op([{ create: { entity: { $: 'kind' }, fields: {} } }], { params: kind }),
      u: op([{ delete: { entity: 'Board', oneOf: ['Board'], id: 'x' } }]),
    },
  },
  {
    id: 'static.protected-entity',
    check: 6,
    note: 'a write of each access-control entity; reading one is allowed',
    operations: {
      t: op([
        { find: { as: 'p', entity: 'Policy' } },
        { delete: { entity: 'Policy', id: 'x' } },
        { update: { entity: 'Role', id: 'x', fields: { name: 'Admin' } } },
        { create: { entity: 'RoleGrant', fields: { role: 'admin' } } },
      ]),
    },
  },
  {
    id: 'static.create-abstract',
    check: 7,
    note: 'a create of an abstract entity',
    operations: { t: op([{ create: { entity: 'Shelf', fields: {} } }]) },
  },
  {
    id: 'static.create-missing-required',
    check: 7,
    note: 'a create that does not give a required property with no default',
    operations: { t: op([{ create: { entity: 'Board', fields: { note: 'x' } } }]) },
  },
  {
    id: 'static.fields-name-id',
    check: 7,
    note: 'a create and an update naming id in their fields',
    operations: {
      t: op([
        { create: { entity: 'Card', fields: { id: 'urn:example:x', text: 'x' } } },
        { update: { entity: 'Card', id: 'urn:example:x', fields: { id: 'urn:example:y' } } },
      ]),
    },
  },
  {
    id: 'static.unknown-field',
    check: 8,
    note: 'a field no entity declares, in fields, in a where and in an order',
    operations: {
      t: op([
        { create: { entity: 'Board', fields: { title: 'x', colour: 'red' } } },
        { find: { as: 'f', entity: 'Board', where: { colour: 'red' }, order: { size: 'asc' } } },
      ]),
    },
  },
  {
    id: 'static.where-metadata-and-some',
    check: 8,
    note: 'record metadata is readable in a where and an order; a some clause is checked against the relation’s target',
    operations: {
      t: op([
        {
          find: {
            as: 'f',
            entity: 'Board',
            where: { author: { $: 'invoker' }, columns: { some: { title: 'Done', colour: 'red' } } },
            order: { createdAt: 'desc' },
          },
        },
      ]),
    },
  },
  {
    id: 'static.unset',
    check: 9,
    note: 'an unset of a property nobody declares, and of a required one',
    operations: { t: op([{ update: { entity: 'Board', id: 'b', unset: ['colour', 'title'] } }]) },
  },
  {
    id: 'static.relations',
    check: 10,
    note: 'a link through an unknown relation, a link of a to-one, and a scope via a relation its anchor lacks',
    operations: {
      t: op([
        { link: { entity: 'Board', id: 'b', relation: 'cards', target: 'c' } },
        { link: { entity: 'Board', id: 'b', relation: 'lead', target: 'c' } },
        { find: { as: 'f', entity: 'Card', scope: { anchor: 'Board', via: 'cards', anchorId: 'b' } } },
      ]),
    },
  },
  {
    id: 'static.chosen-relation',
    check: 10,
    note: 'a relation checked against every entity its oneOf names; one given by expression is the run’s to judge',
    operations: {
      t: op(
        [
          { link: { entity: { $: 'kind' }, oneOf: ['Board', 'Column'], id: 'b', relation: 'columns', target: 'c' } },
          { link: { entity: 'Board', id: 'b', relation: { $: 'kind' }, target: 'c' } },
        ],
        { params: kind },
      ),
    },
  },
  {
    id: 'static.undeclared-error',
    check: 11,
    note: 'a check naming an error the operation does not declare',
    operations: { t: op([{ check: { condition: true, error: 'nope' } }]) },
  },
  {
    id: 'static.calls',
    check: 12,
    note: 'a call passing a param the callee lacks and missing one it requires, a call to nothing, and a cycle',
    operations: {
      a: op([{ call: { operation: 'conformance.b', args: { n: 1 } } }]),
      b: op([{ call: { operation: 'conformance.a' } }], { params: { n: { type: 'number', required: true } } }),
      c: op([{ call: { operation: 'conformance.b', args: { m: 1 } } }, { call: { operation: 'other.x' } }]),
    },
  },
  {
    id: 'static.forEach-depth',
    check: 13,
    note: 'forEach nested four deep',
    operations: {
      t: op([
        {
          forEach: {
            in: [],
            as: 'a',
            key: { $: 'invoker' },
            steps: [
              {
                forEach: {
                  in: [],
                  as: 'b',
                  key: { $: 'invoker' },
                  steps: [
                    {
                      forEach: {
                        in: [],
                        as: 'c',
                        key: { $: 'invoker' },
                        steps: [{ forEach: { in: [], as: 'd', key: { $: 'invoker' }, steps: [] } }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ]),
    },
  },
  {
    id: 'static.forEach-literal-key',
    check: 13,
    note: 'a literal list item with no id and no key, in a forEach with no key expression',
    operations: { t: op([{ forEach: { in: [{ title: 'a' }], as: 'x', steps: [] } }]) },
  },
  {
    id: 'static.identity-ok',
    check: 14,
    note: 'an identity over a property and a to-one, both given: nothing to refuse',
    operations: {
      t: op([{ create: { entity: 'Board', identity: ['title', 'lead'], fields: { title: 'Plan', lead: 'c1' } } }]),
    },
  },
  {
    id: 'static.identity',
    check: 14,
    note: 'an identity on a chosen entity, over a to-many and an unknown field, naming a field twice, and not given',
    operations: {
      t: op(
        [
          { create: { entity: { $: 'kind' }, oneOf: ['Board'], identity: ['title'], fields: { title: 'x' } } },
          { create: { entity: 'Board', identity: ['columns', 'nope'], fields: { title: 'x' } } },
          { create: { entity: 'Board', identity: ['title', 'title'], fields: { title: 'x' } } },
          { create: { entity: 'Board', identity: ['note'], fields: { title: 'x' } } },
        ],
        { params: kind },
      ),
    },
  },
  {
    id: 'static.serial-literal',
    check: 15,
    note: 'a serial that is not an expression',
    operations: { t: op([], { serial: 'board', params: { board: { type: 'string' } } }) },
  },
  {
    id: 'static.serial-reads-step',
    check: 15,
    note: 'a serial reading a name a step binds, which is not a param',
    operations: { t: op([{ find: { as: 'found', entity: 'Board' } }], { serial: { $: 'found' } }) },
  },
];

/** The paths a manifest's operations are refused at, by code point: structure first, then the rest. */
export function staticIssues(operations: Record<string, unknown>): string[] {
  const manifest = { version: '1', entities: STATIC_ENTITIES, operations };
  const structure = validateManifest(manifest);
  if (!structure.valid) return [...new Set(structure.errors.map((e) => e.path))].sort();
  const issues = validateOperations(structure.manifest, { namespace: STATIC_NAMESPACE });
  return [...new Set(issues.map((issue) => issue.path))].sort();
}

/** `static-checks.json`: the file's entities, and per case its operations and the paths refused. */
export function recordStaticChecks() {
  return {
    version: 1,
    namespace: STATIC_NAMESPACE,
    protectedEntities: ['Policy', 'Role', 'RoleGrant'],
    entities: STATIC_ENTITIES,
    cases: STATIC_CASES.map((c) => {
      const paths = staticIssues(c.operations);
      return { id: c.id, check: c.check, note: c.note, operations: c.operations, refused: paths.length > 0, paths };
    }),
  };
}
