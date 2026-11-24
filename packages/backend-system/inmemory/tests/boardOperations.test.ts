/**
 * WE's own board operations, run against the reference backend: a board with its columns in one
 * transaction, a find-or-create that writes once, and a move that lands whole or not at all.
 */
import { getEntity, isOperationError, registerEntityWriteCheck, runOperation } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ME = 'did:test:me';

interface Row {
  id: string;
  [field: string]: unknown;
}
type Model = {
  findOne(d: unknown, q: Record<string, unknown>): Promise<Row | null>;
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
};
const Collection = () => getEntity('CollectionBlock') as unknown as Model;
const Task = () => getEntity('TaskBlock') as unknown as Model;

let dataset: unknown;
const run = (name: string, args: Record<string, unknown>) => runOperation(name, args, { dataset, invoker: ME });
const read = async (id: string) => Collection().findOne(dataset, { where: { id } });
const ids = (value: unknown) => (Array.isArray(value) ? (value as string[]) : []);

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-board-ops', name: 'Boards' }] },
  );
  dataset = (await ports.lifecycle.get('ds-board-ops'))!.handle;
});

afterEach(() => registerEntityWriteCheck(null));

describe('core.createBoard', () => {
  it('makes the board and a column per state, in order, inside its container', async () => {
    const call = await Collection().create(dataset, { kind: 'call' });
    const board = (await run('core.createBoard', {
      title: '  Sprint ',
      states: ['todo', 'done'],
      parent: call.id,
      gathers: call.id,
    })) as string;

    const made = await read(board);
    expect(made).toMatchObject({ kind: 'board', mode: 'feed', title: 'Sprint', gathers: call.id });
    const columns = await Promise.all(ids(made?.children).map(read));
    expect(columns.map((c) => [c?.kind, c?.slug])).toEqual([
      ['column', 'todo'],
      ['column', 'done'],
    ]);
    expect(ids((await read(call.id))?.children)).toContain(board);
  });

  it('leaves nothing behind when a write is refused part-way', async () => {
    registerEntityWriteCheck(({ data }) => {
      if ((data as { slug?: string } | undefined)?.slug === 'done')
        throw Object.assign(new Error('Not that column.'), { name: 'PolicyRefusal' });
    });
    const error = await run('core.createBoard', { title: 'Sprint', states: ['todo', 'done'] }).catch((e) => e);
    expect(isOperationError(error) && error.code).toBe('refused');
    expect(await Collection().findAll(dataset)).toEqual([]);
  });
});

describe('core.openBoardFor', () => {
  it('makes a collection’s board once, and answers with it after', async () => {
    const call = await Collection().create(dataset, { kind: 'call', title: 'Standup' });
    const first = await run('core.openBoardFor', { anchor: call.id, states: ['todo'] });
    const again = await run('core.openBoardFor', { anchor: call.id, states: ['todo'] });
    expect(again).toBe(first);
    expect((await read(call.id))?.board).toBe(first);
    expect((await Collection().findAll(dataset, { where: { kind: 'board' } })).length).toBe(1);
  });

  it('answers with nothing for a collection that is not there', async () => {
    expect(await run('core.openBoardFor', { anchor: 'nowhere', states: ['todo'] })).toBe('');
  });
});

describe('core.moveCard', () => {
  it('leaves one column, joins the other where dropped, and takes a bound column’s state', async () => {
    await Task().create(dataset, { title: 'A', status: 'todo' }, { id: 'a' });
    await Task().create(dataset, { title: 'B', status: 'done' }, { id: 'b' });
    await Collection().create(dataset, { kind: 'column', slug: 'todo', arranges: ['a'] }, { id: 'from' });
    await Collection().create(dataset, { kind: 'column', slug: 'done', arranges: ['b'] }, { id: 'to' });

    await run('core.moveCard', { from: 'from', to: 'to', card: 'a', ids: ['a', 'b'] });

    expect(ids((await read('from'))?.arranges)).toEqual([]);
    expect(ids((await read('to'))?.arranges)).toEqual(['a', 'b']);
    expect((await Task().findOne(dataset, { where: { id: 'a' } }))?.status).toBe('done');
  });

  it('positions a card in a lane without touching its state, appending when no drop point is given', async () => {
    await Task().create(dataset, { title: 'A', status: 'todo' }, { id: 'a' });
    await Collection().create(dataset, { kind: 'column', title: 'Thursday', arranges: ['x'] }, { id: 'lane' });

    await run('core.moveCard', { to: 'lane', card: 'a' });

    expect(ids((await read('lane'))?.arranges)).toEqual(['x', 'a']);
    expect((await Task().findOne(dataset, { where: { id: 'a' } }))?.status).toBe('todo');
  });
});

describe('core.removeBoardColumn', () => {
  it('hands the column’s cards to the board and deletes the column, never a card', async () => {
    await Task().create(dataset, { title: 'A', status: 'todo' }, { id: 'a' });
    await Collection().create(dataset, { kind: 'column', slug: 'todo', arranges: ['a'] }, { id: 'col' });
    await Collection().create(dataset, { kind: 'board', children: ['col'] }, { id: 'board' });

    await run('core.removeBoardColumn', { board: 'board', column: 'col' });

    const board = await read('board');
    expect(ids(board?.children)).toEqual([]);
    expect(ids(board?.arranges)).toEqual(['a']);
    expect(await read('col')).toBeNull();
    expect(await Task().findOne(dataset, { where: { id: 'a' } })).not.toBeNull();
  });
});
