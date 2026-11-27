/**
 * A delete limited to the invoker's own records, and a setRelation that keeps what it leaves out —
 * the two step options that let a reaction be taken back, and a column reordered, without the
 * operation counting as destructive.
 */
import { effectSummary, getEntity, registerOperations, runOperation, unregisterOperations } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ME = 'did:test:me';
const OTHER = 'did:test:other';

type Row = { id: string; [field: string]: unknown };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
    findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  };

const OPERATIONS = {
  takeBack: {
    description: 'Deletes a reaction, if it is the invoker’s.',
    params: { id: { type: 'string', required: true } },
    steps: [{ delete: { entity: 'Signal', id: { $: 'id' }, own: true } }],
  },
  orderKept: {
    description: 'Orders a board’s children, keeping the rest.',
    params: { board: { type: 'string', required: true }, ids: { type: 'list', required: true } },
    steps: [
      {
        setRelation: {
          entity: 'CollectionBlock',
          id: { $: 'board' },
          relation: 'children',
          targets: { $: 'ids' },
          keep: true,
        },
      },
    ],
  },
} as const;

let dataset: unknown;
let author = ME;

beforeEach(async () => {
  author = ME;
  const ports = createInMemoryBackendPorts(
    { selfId: () => author },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-own', name: 'Own' }] },
  );
  dataset = (await ports.lifecycle.get('ds-own'))!.handle;
  registerOperations('demo', OPERATIONS as never);
});
afterEach(() => unregisterOperations('demo'));

describe('a delete of the invoker’s own record', () => {
  it('deletes a record the invoker made, and refuses one somebody else made', async () => {
    const mine = await model('Signal').create(dataset, { signalTypeId: 'like', value: 1 });
    author = OTHER;
    const theirs = await model('Signal').create(dataset, { signalTypeId: 'like', value: 1 });
    author = ME;
    await runOperation('demo.takeBack', { id: mine.id }, { dataset, invoker: ME });
    await expect(runOperation('demo.takeBack', { id: theirs.id }, { dataset, invoker: ME })).rejects.toMatchObject({
      class: 'precondition',
      code: 'notOwn',
    });
    expect((await model('Signal').findAll(dataset)).map((r) => r.id)).toEqual([theirs.id]);
  });

  it('is not destructive, and an ordering that keeps its members is not either', () => {
    expect(effectSummary(OPERATIONS.takeBack as never)).toMatchObject({
      entities: { Signal: ['deleteOwn'] },
      destructive: false,
    });
    expect(effectSummary(OPERATIONS.orderKept as never)).toMatchObject({
      entities: { CollectionBlock: ['add:children'] },
      destructive: false,
    });
  });
});

describe('a setRelation that keeps', () => {
  it('puts the named members first and the rest after them, in their order', async () => {
    const [a, b, c] = await Promise.all(
      ['a', 'b', 'c'].map((title) => model('CollectionBlock').create(dataset, { kind: 'card', title })),
    );
    const board = await model('CollectionBlock').create(dataset, { kind: 'board', children: [a.id, b.id, c.id] });
    await runOperation('demo.orderKept', { board: board.id, ids: [c.id, a.id] }, { dataset, invoker: ME });
    const [read] = await model('CollectionBlock').findAll(dataset, { where: { id: board.id } });
    expect(read.children).toEqual([c.id, a.id, b.id]);
  });
});
