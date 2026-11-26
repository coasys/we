/**
 * Declared operations, run by `@we/entities`' runner against this backend — the reference: every
 * step verb, the guards, loops and calls, the errors an operation can fail with, and that a failed
 * operation leaves nothing behind.
 */
import type { EntityManifest, OneOfEntry, OperationDefinition } from '@we/backend-shared';
import {
  getEntity,
  inlineRecordId,
  isOperationError,
  OperationError,
  registerEntityWriteCheck,
  registerOperations,
  runOperation,
  unregisterEntity,
  unregisterOperations,
} from '@we/entities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const AGENT = 'did:test:me';

const children = (of: string) => ({
  link: { entity: 'CollectionBlock', id: { $: of }, relation: 'children', target: { $: 'made.id' } },
});

const OPS: Record<string, OperationDefinition> = {
  makeBoard: {
    description: 'A board and its columns.',
    params: { title: { type: 'string', required: true }, columns: { type: 'list', required: true } },
    steps: [
      { create: { as: 'board', entity: 'CollectionBlock', fields: { kind: 'board', title: { $: 'title' } } } },
      {
        forEach: {
          in: { $: 'columns' },
          as: 'col',
          steps: [
            {
              create: { as: 'made', entity: 'CollectionBlock', fields: { kind: 'column', title: { $: 'col.title' } } },
            },
            children('board.id'),
          ],
        },
      },
    ],
    returns: { board: { $: 'board.id' }, title: { $: 'title' } },
  },
  ensureTag: {
    description: 'The tag with this slug, made if there is none.',
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
  writeTwice: {
    description: 'Make a note and retitle it in the same operation.',
    steps: [
      { create: { as: 'note', entity: 'CollectionBlock', fields: { kind: 'note', title: 'first' } } },
      { update: { entity: 'CollectionBlock', id: { $: 'note.id' }, fields: { title: 'second' } } },
    ],
    returns: { $: 'note.id' },
  },
  retitle: {
    description: 'Retitle the one record of a kind, and clear its description.',
    params: { kind: { type: 'string', required: true }, title: { type: 'string' } },
    steps: [
      { find: { as: 'it', entity: 'CollectionBlock', where: { kind: { $: 'kind' } }, one: true } },
      {
        update: {
          entity: 'CollectionBlock',
          id: { $: 'it' },
          fields: { title: { $: 'title' } },
          unset: ['description'],
        },
      },
    ],
    returns: { $: 'it.id' },
  },
  restate: {
    description:
      'Edit the one record of a kind with a field set, stamping who edited it — a clear in the set included.',
    params: { kind: { type: 'string', required: true }, fields: { type: 'object', required: true } },
    steps: [
      { find: { as: 'it', entity: 'CollectionBlock', where: { kind: { $: 'kind' } }, one: true } },
      {
        update: {
          entity: 'CollectionBlock',
          id: { $: 'it' },
          fields: { $: 'merge(fields, { title: trim(it.title) })' },
        },
        when: { $: 'count(keys(fields)) > 0' },
      },
    ],
    returns: { $: 'keys(fields)' },
  },
  link: {
    description: 'Put a record under another.',
    params: {
      parent: { type: 'string', required: true },
      child: { type: 'string', required: true },
      strict: { type: 'boolean' },
    },
    steps: [
      {
        link: {
          entity: 'CollectionBlock',
          id: { $: 'parent' },
          relation: 'children',
          target: { $: 'child' },
          strict: true,
        },
        when: { $: 'strict' },
      },
      {
        link: { entity: 'CollectionBlock', id: { $: 'parent' }, relation: 'children', target: { $: 'child' } },
        when: { $: '!strict' },
      },
    ],
  },
  unlink: {
    description: 'Take a record out from under another, strictly.',
    params: { parent: { type: 'string', required: true }, child: { type: 'string', required: true } },
    steps: [
      {
        unlink: {
          entity: 'CollectionBlock',
          id: { $: 'parent' },
          relation: 'children',
          target: { $: 'child' },
          strict: true,
        },
      },
    ],
  },
  order: {
    description: 'Put a record’s children in this order.',
    params: { parent: { type: 'string', required: true }, order: { type: 'list', required: true } },
    steps: [
      {
        setRelation: { entity: 'CollectionBlock', id: { $: 'parent' }, relation: 'children', targets: { $: 'order' } },
      },
    ],
  },
  remove: {
    description: 'Delete a record.',
    params: { id: { type: 'string', required: true } },
    steps: [{ delete: { entity: 'CollectionBlock', id: { $: 'id' } } }],
  },
  guarded: {
    description: 'Make a note, if the number is small.',
    params: { n: { type: 'number', required: true } },
    errors: { tooBig: 'The number is too big.' },
    steps: [
      { create: { entity: 'CollectionBlock', fields: { kind: 'note', title: 'before the check' } } },
      { check: { condition: { $: 'n < 10' }, error: 'tooBig' } },
      { create: { entity: 'CollectionBlock', fields: { kind: 'note', title: 'after the check' } } },
    ],
  },
  nested: {
    description: 'Groups of items, each item under its group.',
    params: { groups: { type: 'list', required: true } },
    steps: [
      {
        forEach: {
          in: { $: 'groups' },
          as: 'g',
          key: { $: 'g.name' },
          steps: [
            { create: { as: 'group', entity: 'CollectionBlock', fields: { kind: 'group', title: { $: 'g.name' } } } },
            {
              forEach: {
                in: { $: 'g.items' },
                as: 'item',
                steps: [
                  {
                    create: {
                      as: 'made',
                      entity: 'CollectionBlock',
                      fields: { kind: 'item', title: { $: 'item.key' } },
                    },
                  },
                  children('group.id'),
                ],
              },
            },
          ],
        },
      },
    ],
  },
  caller: {
    description: 'Make a board through makeBoard, and say what it returned.',
    steps: [
      {
        call: {
          as: 'made',
          operation: 'test.makeBoard',
          args: { title: 'Called', columns: [{ key: 'a', title: 'A' }] },
        },
      },
    ],
    returns: { $: 'made.board' },
  },
  pick: {
    description: 'A record of an entity chosen by the caller.',
    params: { entity: { type: 'string', required: true } },
    steps: [{ create: { as: 'made', entity: { $: 'entity' }, oneOf: ['CollectionBlock', 'TextBlock'], fields: {} } }],
    returns: { $: 'made.id' },
  },
  readsMe: {
    description: 'Reads a name nothing binds.',
    steps: [],
    returns: { $: 'me.did' },
  },
  writesPolicy: {
    description: 'Writes a record no operation may.',
    steps: [{ create: { entity: 'Policy', fields: {} } }],
  },
  writesChosen: {
    description: 'Creates a record of the entity it is given, from a list that names a protected one.',
    params: { entity: { type: 'string', required: true } },
    steps: [{ create: { entity: { $: 'entity' }, oneOf: ['CollectionBlock', 'Policy'], fields: {} } }],
  },
  expecting: {
    description: 'A find that must not change before the end.',
    steps: [
      { find: { as: 'notes', entity: 'CollectionBlock', where: { kind: 'note' }, expect: true } },
      { create: { entity: 'CollectionBlock', fields: { kind: 'tag' } } },
    ],
  },
  echo: {
    description: 'Returns what it was given.',
    params: { value: { type: 'json' } },
    steps: [],
    returns: { got: { $: 'value' }, who: { $: 'invoker' }, when: { $: 'invokedAt' } },
  },
};

let dataset: unknown;
let ports: ReturnType<typeof createInMemoryBackendPorts>;

beforeEach(async () => {
  ports = createInMemoryBackendPorts(
    { selfId: () => AGENT },
    { agent: { id: AGENT, unlocked: true }, datasets: [{ id: 'ds-ops', name: 'Ops' }] },
  );
  dataset = (await ports.lifecycle.get('ds-ops'))!.handle;
  registerOperations('test', OPS);
});

afterEach(() => {
  unregisterOperations('test');
  registerEntityWriteCheck(null);
  vi.restoreAllMocks();
});

interface Row {
  id: string;
  [field: string]: unknown;
}
const Collection = () =>
  getEntity('CollectionBlock') as unknown as {
    findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
    create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
  };
const ofKind = async (kind: string) => Collection().findAll(dataset, { where: { kind } });
const titles = async (kind: string) => (await ofKind(kind)).map((row) => row.title).sort();
const childrenOf = async (id: string) => {
  const [row] = await Collection().findAll(dataset, { where: { id }, include: { children: true } });
  return ((row?.children ?? []) as Row[]).map((child) => child.id);
};
const run = (name: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  runOperation(`test.${name}`, args, { dataset, invoker: AGENT, ...extra });

/** The error an operation failed with, so a case can say exactly which. */
async function failure(promise: Promise<unknown>): Promise<OperationError> {
  try {
    await promise;
  } catch (error) {
    if (isOperationError(error)) return error;
    throw error;
  }
  throw new Error('the operation succeeded');
}

describe('running an operation', () => {
  it('creates and links, and returns what it said it would', async () => {
    const result = (await run('makeBoard', {
      title: 'Plan',
      columns: [
        { key: 'todo', title: 'To do' },
        { key: 'done', title: 'Done' },
      ],
    })) as { board: string; title: string };
    expect(result.title).toBe('Plan');
    expect(result.board).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await titles('board')).toEqual(['Plan']);
    const columns = await ofKind('column');
    expect(columns.map((c) => c.title).sort()).toEqual(['Done', 'To do']);
    expect((await childrenOf(result.board)).sort()).toEqual(columns.map((c) => c.id).sort());
  });

  it('skips a step whose guard is falsy, and reads its name as absent', async () => {
    const first = await run('ensureTag', { slug: 'garden' });
    const second = await run('ensureTag', { slug: 'garden' });
    expect(second).toBe(first);
    expect(await ofKind('tag')).toHaveLength(1);
  });

  it('lands a second write to a record it created', async () => {
    const id = (await run('writeTwice')) as string;
    const [note] = await Collection().findAll(dataset, { where: { id } });
    expect(note.title).toBe('second');
  });

  it('updates and clears a found record', async () => {
    await Collection().create(dataset, { kind: 'solo', title: 'old', description: 'gone soon' });
    await run('retitle', { kind: 'solo', title: 'new' });
    const [row] = await ofKind('solo');
    expect(row.title).toBe('new');
    expect(row.description ?? '').toBe('');
  });

  it('keeps a clear written as null through merge and keys', async () => {
    // A field set says "clear this" with null as well as ''. merge and keys keep both, so a clear
    // built into a larger write still reaches the record, and the operation still sees the set as
    // having something in it.
    await Collection().create(dataset, { kind: 'stated', title: ' kept ', description: 'gone soon', icon: 'leaf' });
    const keys = await run('restate', { kind: 'stated', fields: { description: null, icon: '' } });
    expect(keys).toEqual(['description', 'icon']);
    const [row] = await ofKind('stated');
    expect(row.title).toBe('kept');
    expect(row.description ?? '').toBe('');
    expect(row.icon ?? '').toBe('');
  });

  it('deletes', async () => {
    const made = await Collection().create(dataset, { kind: 'doomed' });
    await run('remove', { id: made.id });
    expect(await ofKind('doomed')).toEqual([]);
  });

  it('links leniently, and refuses a strict link to a member and a strict unlink of a stranger', async () => {
    const parent = await Collection().create(dataset, { kind: 'p' });
    const child = await Collection().create(dataset, { kind: 'c' });
    await run('link', { parent: parent.id, child: child.id });
    await run('link', { parent: parent.id, child: child.id });
    expect(await childrenOf(parent.id)).toEqual([child.id]);
    const strict = await failure(run('link', { parent: parent.id, child: child.id, strict: true }));
    expect([strict.class, strict.code]).toEqual(['precondition', 'alreadyLinked']);
    const stranger = await Collection().create(dataset, { kind: 'c' });
    const unlinked = await failure(run('unlink', { parent: parent.id, child: stranger.id }));
    expect([unlinked.class, unlinked.code]).toEqual(['precondition', 'notLinked']);
    await run('unlink', { parent: parent.id, child: child.id });
    expect(await childrenOf(parent.id)).toEqual([]);
  });

  it('sets a whole relation in the order given', async () => {
    const parent = await Collection().create(dataset, { kind: 'p' });
    const a = await Collection().create(dataset, { kind: 'c' });
    const b = await Collection().create(dataset, { kind: 'c' });
    await run('order', { parent: parent.id, order: [b.id, a] });
    expect(await childrenOf(parent.id)).toEqual([b.id, a.id]);
  });

  it('fails a check with its named error, and leaves nothing it wrote before the check', async () => {
    const error = await failure(run('guarded', { n: 12 }));
    expect([error.class, error.code, error.message]).toEqual(['precondition', 'tooBig', 'The number is too big.']);
    expect(error.step).toBe('test.guarded/steps.1.check');
    expect(await ofKind('note')).toEqual([]);
    await run('guarded', { n: 3 });
    expect(await titles('note')).toEqual(['after the check', 'before the check']);
  });

  it('runs nested loops, each item under its own group', async () => {
    await run('nested', {
      groups: [
        { name: 'fruit', items: [{ key: 'apple' }, { key: 'pear' }] },
        { name: 'veg', items: [{ key: 'leek' }] },
      ],
    });
    const groups = await ofKind('group');
    const byName = Object.fromEntries(groups.map((g) => [g.title, g.id]));
    const items = await ofKind('item');
    const titleOf = Object.fromEntries(items.map((i) => [i.id, i.title]));
    expect((await childrenOf(byName.fruit)).map((id) => titleOf[id]).sort()).toEqual(['apple', 'pear']);
    expect((await childrenOf(byName.veg)).map((id) => titleOf[id])).toEqual(['leek']);
  });

  it('calls another operation inside the same transaction, and names what it returned', async () => {
    const board = await run('caller');
    const [row] = await ofKind('board');
    expect(board).toBe(row.id);
    expect(await titles('column')).toEqual(['A']);
  });

  it('creates an entity chosen by expression only from its oneOf', async () => {
    const id = await run('pick', { entity: 'TextBlock' });
    const Text = getEntity('TextBlock') as unknown as { findAll(d: unknown, q: unknown): Promise<Row[]> };
    expect(await Text.findAll(dataset, { where: { id } })).toHaveLength(1);
    const error = await failure(run('pick', { entity: 'Space' }));
    expect([error.class, error.code]).toEqual(['static', 'outsideOneOf']);
  });

  it('binds invoker and invokedAt, and returns an optional param as absent', async () => {
    const result = (await run('echo', {}, { invokedAt: '2026-11-24T10:00:00.000Z' })) as Record<string, unknown>;
    expect(result).toEqual({ got: undefined, who: AGENT, when: '2026-11-24T10:00:00.000Z' });
  });
});

describe('a category in oneOf', () => {
  // An entity of the kind a module brings: a block, so it is in `blockable`, and nothing core names.
  const STICKERS: EntityManifest = {
    version: '1',
    entities: {
      Sticker: {
        extends: 'WeNode',
        blockable: true,
        properties: { glyph: { type: 'string', default: '' }, version: { type: 'number', default: 0 } },
        relations: {},
      },
    },
  };
  const post = (entity: string) =>
    runOperation(
      'core.createPost',
      { root: { kind: 'post' }, blocks: [{ key: '0', entity, fields: { glyph: '*' } }] },
      { dataset, invoker: AGENT },
    );

  afterEach(() => {
    unregisterOperations('stickers');
    unregisterEntity('Sticker');
  });

  it('admits a block type a module registered, into a post core declared', async () => {
    ports.schemas.declare(STICKERS, { moduleId: 'stickers' });
    registerOperations('stickers', undefined, { entities: STICKERS.entities });
    const id = (await post('Sticker')) as string;
    expect(await childrenOf(id)).toHaveLength(1);
    const [sticker] = await getEntity('Sticker').findAll(dataset, {});
    expect(sticker).toMatchObject({ glyph: '*' });
  });

  it('reads the registry when it runs, so a withdrawn module’s block is outside it again', async () => {
    ports.schemas.declare(STICKERS, { moduleId: 'stickers' });
    registerOperations('stickers', undefined, { entities: STICKERS.entities });
    unregisterOperations('stickers');
    const error = await failure(post('Sticker'));
    expect([error.class, error.code]).toEqual(['static', 'outsideOneOf']);
    expect(error.message).toContain('any block type');
    expect(await ofKind('post')).toEqual([]);
  });

  it('holds what is not in it out', async () => {
    const error = await failure(post('Space'));
    expect([error.class, error.code]).toEqual(['static', 'outsideOneOf']);
  });
});

describe('any record type', () => {
  const ANY: OneOfEntry[] = [{ category: 'any' }];
  const GENERIC: Record<string, OperationDefinition> = {
    edit: {
      description: 'Edit a record of any type.',
      params: { entity: { type: 'string', required: true }, id: { type: 'string' }, fields: { type: 'object' } },
      steps: [{ update: { entity: { $: 'entity' }, oneOf: ANY, id: { $: 'id' }, fields: { $: 'fields' } } }],
    },
    remove: {
      description: 'Delete records of any type.',
      params: { records: { type: 'list', required: true } },
      steps: [
        {
          forEach: {
            in: { $: 'records' },
            as: 'record',
            steps: [{ delete: { entity: { $: 'record.entity' }, oneOf: ANY, id: { $: 'record.id' } } }],
          },
        },
      ],
    },
    relink: {
      description: 'Move a record from one holder to another through a relation the caller names.',
      params: {
        entity: { type: 'string', required: true },
        relation: { type: 'string', required: true },
        child: { type: 'string', required: true },
        from: { type: 'string', required: true },
        to: { type: 'string', required: true },
      },
      steps: [
        {
          unlink: {
            entity: { $: 'entity' },
            oneOf: ANY,
            id: { $: 'from' },
            relation: { $: 'relation' },
            target: { $: 'child' },
          },
        },
        {
          link: {
            entity: { $: 'entity' },
            oneOf: ANY,
            id: { $: 'to' },
            relation: { $: 'relation' },
            target: { $: 'child' },
          },
        },
      ],
    },
  };
  beforeEach(() => registerOperations('generic', GENERIC));
  afterEach(() => unregisterOperations('generic'));
  const generic = (name: string, args: Record<string, unknown>) =>
    runOperation(`generic.${name}`, args, { dataset, invoker: AGENT });

  it('edits and deletes a record of whatever type the caller names', async () => {
    const note = await Collection().create(dataset, { kind: 'note', title: 'old' });
    const topic = await getEntity('Topic').create(dataset, { name: 'Soil' } as never);
    await generic('edit', { entity: 'CollectionBlock', id: note.id, fields: { title: 'new' } });
    expect((await ofKind('note'))[0].title).toBe('new');
    await generic('remove', {
      records: [
        { entity: 'CollectionBlock', id: note.id },
        { entity: 'Topic', id: topic.id },
      ],
    });
    expect(await ofKind('note')).toEqual([]);
    expect(await getEntity('Topic').findAll(dataset, {})).toEqual([]);
  });

  it('moves a record between holders through a relation named when it runs', async () => {
    const [a, b, card] = [
      await Collection().create(dataset, { kind: 'column' }),
      await Collection().create(dataset, { kind: 'column' }),
      await Collection().create(dataset, { kind: 'card' }),
    ];
    await getEntity('CollectionBlock').addRelation(dataset, a.id, 'children', card.id);
    await generic('relink', { entity: 'CollectionBlock', relation: 'children', child: card.id, from: a.id, to: b.id });
    expect(await childrenOf(a.id)).toEqual([]);
    expect(await childrenOf(b.id)).toEqual([card.id]);
  });

  it('still refuses the entities that decide who may write, and an abstract one', async () => {
    const policy = await failure(generic('edit', { entity: 'Policy', id: 'x', fields: {} }));
    expect([policy.class, policy.code]).toEqual(['static', 'protectedEntity']);
    const abstract = await failure(generic('edit', { entity: 'WeNode', id: 'x', fields: {} }));
    expect([abstract.class, abstract.code]).toEqual(['static', 'outsideOneOf']);
    expect(abstract.message).toContain('any record type');
    const unknown = await failure(generic('edit', { entity: 'NoSuchThing', id: 'x', fields: {} }));
    expect([unknown.class, unknown.code]).toEqual(['static', 'outsideOneOf']);
  });
});

describe('core.createRecord', () => {
  it('makes the records filled in inline first, by the ids the host planned, and points the new one at them', async () => {
    const invocationId = crypto.randomUUID();
    const place = await inlineRecordId(invocationId, 'location.0');
    const id = (await runOperation(
      'core.createRecord',
      {
        entity: 'EventBlock',
        fields: { title: 'Dawn walk', startDate: '2026-10-10', location: place },
        inline: [{ key: 'location.0', entity: 'LocationBlock', fields: { name: 'Ham Wall' } }],
      },
      { dataset, invoker: AGENT, invocationId },
    )) as string;
    const [event] = await getEntity('EventBlock').findAll(dataset, { where: { id }, include: { location: true } });
    expect((event as unknown as { location: Row }).location).toMatchObject({ id: place, name: 'Ham Wall' });
  });
});

describe('a find walking below its anchor', () => {
  const WALKS: Record<string, OperationDefinition> = {
    under: {
      description: 'Everything under a collection, as deep as it goes or by levels.',
      params: { root: { type: 'string', required: true }, levels: { type: 'list' } },
      steps: [
        {
          find: {
            as: 'all',
            entity: 'CollectionBlock',
            scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'root' }, transitive: true },
          },
        },
        {
          find: {
            as: 'two',
            entity: 'CollectionBlock',
            scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'root' }, levels: [1, 1] },
          },
        },
      ],
      returns: { all: { $: 'all.map(r, r.title)' }, two: { $: 'two.map(r, r.title)' } },
    },
  };
  beforeEach(() => registerOperations('walks', WALKS));
  afterEach(() => unregisterOperations('walks'));

  it('passes levels and transitive to the read, which walks them', async () => {
    const make = (title: string) => Collection().create(dataset, { kind: 'folder', title });
    const [root, a, b, a1, a1x] = [
      await make('root'),
      await make('a'),
      await make('b'),
      await make('a1'),
      await make('a1x'),
    ];
    const add = (parent: Row, child: Row) =>
      getEntity('CollectionBlock').addRelation(dataset, parent.id, 'children', child.id);
    await add(root, a);
    await add(root, b);
    await add(a, a1);
    await add(a1, a1x);
    const found = (await runOperation('walks.under', { root: root.id }, { dataset, invoker: AGENT })) as {
      all: string[];
      two: string[];
    };
    expect([...found.all].sort()).toEqual(['a', 'a1', 'a1x', 'b']);
    expect(found.two).toEqual(['a', 'a1']);
  });
});

describe('find one', () => {
  it('fails as notFound with none and ambiguous with two', async () => {
    const none = await failure(run('retitle', { kind: 'missing', title: 'x' }));
    expect([none.class, none.code]).toEqual(['precondition', 'notFound']);
    await Collection().create(dataset, { kind: 'twin' });
    await Collection().create(dataset, { kind: 'twin' });
    const two = await failure(run('retitle', { kind: 'twin', title: 'x' }));
    expect([two.class, two.code]).toEqual(['precondition', 'ambiguous']);
  });
});

describe('ids', () => {
  const columns = [
    { key: 'todo', title: 'To do' },
    { key: 'done', title: 'Done' },
  ];

  it('follow an item’s key, not its position: the same invocation reordered makes the same ids', async () => {
    await run('makeBoard', { title: 'A', columns }, { invocationId: 'inv-1' });
    const first = Object.fromEntries((await ofKind('column')).map((c) => [c.title, c.id]));
    // A fresh dataset, so the replay is not refused.
    const ports = createInMemoryBackendPorts(
      { selfId: () => AGENT },
      { agent: { id: AGENT, unlocked: true }, datasets: [{ id: 'ds-ops-2', name: 'Ops 2' }] },
    );
    dataset = (await ports.lifecycle.get('ds-ops-2'))!.handle;
    await run('makeBoard', { title: 'A', columns: [...columns].reverse() }, { invocationId: 'inv-1' });
    const second = Object.fromEntries((await ofKind('column')).map((c) => [c.title, c.id]));
    expect(second).toEqual(first);
  });

  it('refuse a replay of the same invocation as recordExists, and it adds nothing', async () => {
    await run('makeBoard', { title: 'A', columns }, { invocationId: 'inv-2' });
    const error = await failure(run('makeBoard', { title: 'A', columns }, { invocationId: 'inv-2' }));
    expect([error.class, error.code]).toEqual(['precondition', 'recordExists']);
    expect(error.step).toBe('test.makeBoard/steps.0.create');
    expect(await ofKind('board')).toHaveLength(1);
    expect(await ofKind('column')).toHaveLength(2);
  });

  it('refuse two items sharing a key', async () => {
    const error = await failure(run('makeBoard', { title: 'A', columns: [columns[0], columns[0]] }));
    expect([error.class, error.code]).toEqual(['static', 'forEachKey']);
    expect(await ofKind('board')).toEqual([]);
  });

  it('refuse an item with no key', async () => {
    const error = await failure(run('makeBoard', { title: 'A', columns: [{ title: 'Nameless' }] }));
    expect([error.class, error.code]).toEqual(['static', 'forEachKey']);
  });
});

describe('static errors at run time', () => {
  it('an unknown operation, bad args, an unbound name, a protected entity', async () => {
    const unknown = await failure(runOperation('test.nope', {}, { dataset, invoker: AGENT }));
    expect([unknown.class, unknown.code]).toEqual(['static', 'unknownOperation']);
    const missing = await failure(run('makeBoard', { title: 'x' }));
    expect([missing.class, missing.code]).toEqual(['static', 'badArgs']);
    const extra = await failure(run('makeBoard', { title: 'x', columns: [], colour: 'red' }));
    expect(extra.code).toBe('badArgs');
    const typed = await failure(run('makeBoard', { title: 3, columns: [] }));
    expect(typed.code).toBe('badArgs');
    const unbound = await failure(run('readsMe'));
    expect([unbound.class, unbound.code]).toEqual(['static', 'unboundName']);
    const policy = await failure(run('writesPolicy'));
    expect([policy.class, policy.code]).toEqual(['static', 'protectedEntity']);
  });

  it('a protected entity reached through oneOf, which only the run can see', async () => {
    // The validator refuses a oneOf naming one, but registering checks structure only, so the
    // runner holds the line itself for whatever the expression chooses.
    const chosen = await failure(run('writesChosen', { entity: 'Policy' }));
    expect([chosen.class, chosen.code]).toEqual(['static', 'protectedEntity']);
    expect(await getEntity('Policy').findAll(dataset, {})).toEqual([]);
    await run('writesChosen', { entity: 'CollectionBlock' });
  });

  it('a version other than the one registered', async () => {
    registerOperations('test', OPS, { version: '2' });
    const error = await failure(run('echo', {}, { version: '1' }));
    expect(error.code).toBe('versionMismatch');
    expect(await run('echo', { value: 1 }, { version: '2' })).toMatchObject({ got: 1 });
  });
});

describe('the write check', () => {
  it('a refused write fails the operation as refused, with the reason, and nothing lands', async () => {
    registerEntityWriteCheck((write) => {
      if (write.kind === 'add')
        throw Object.assign(new Error('Members may not arrange boards.'), { name: 'PolicyRefusal' });
    });
    const error = await failure(run('makeBoard', { title: 'A', columns: [{ key: 'a', title: 'A' }] }));
    expect([error.class, error.code, error.message]).toEqual([
      'precondition',
      'refused',
      'Members may not arrange boards.',
    ]);
    expect(await ofKind('board')).toEqual([]);
    expect(await ofKind('column')).toEqual([]);
  });
});

describe('the write check, against what the operation has staged', () => {
  /** Anyone may create; only a record's author may edit it — the narrowest policy that tells. */
  const authorOnly = (told: unknown[]) =>
    registerEntityWriteCheck(async (write) => {
      if (write.kind !== 'edit') return;
      const record = await write.record?.();
      told.push(record);
      if (record?.author !== AGENT)
        throw Object.assign(new Error('Only its author may edit a record.'), { name: 'PolicyRefusal' });
    });

  it('judges an update to a record the operation created against that record, by its author', async () => {
    const told: unknown[] = [];
    authorOnly(told);
    const id = (await run('writeTwice')) as string;
    expect(told).toEqual([expect.objectContaining({ id, title: 'first', author: AGENT })]);
    const [note] = await Collection().findAll(dataset, { where: { id } });
    expect(note.title).toBe('second');
  });

  it('rolls the whole operation back when the policy refuses that update', async () => {
    registerEntityWriteCheck((write) => {
      if (write.kind === 'edit') throw Object.assign(new Error('Nobody may edit.'), { name: 'PolicyRefusal' });
    });
    const error = await failure(run('writeTwice'));
    expect([error.class, error.code]).toEqual(['precondition', 'refused']);
    expect(await ofKind('note')).toEqual([]);
  });
});

describe('expect', () => {
  it('passes when the find reads the same at the end', async () => {
    await Collection().create(dataset, { kind: 'note' });
    await run('expecting');
    expect(await ofKind('tag')).toHaveLength(1);
  });

  it('fails as expectChanged when it does not, and nothing lands', async () => {
    const note = await Collection().create(dataset, { kind: 'note' });
    const Model = getEntity('CollectionBlock') as unknown as { findAll: (...a: unknown[]) => Promise<Row[]> };
    const real = Model.findAll.bind(Model);
    let reads = 0;
    vi.spyOn(Model, 'findAll').mockImplementation(async (...a: unknown[]) => {
      reads++;
      // Somebody else's note lands between the find and the end of the operation.
      return reads === 2 ? [...(await real(...a)), { ...note, id: 'theirs' }] : real(...a);
    });
    const error = await failure(run('expecting'));
    expect([error.class, error.code]).toEqual(['precondition', 'expectChanged']);
    vi.restoreAllMocks();
    expect(await ofKind('tag')).toEqual([]);
  });
});
