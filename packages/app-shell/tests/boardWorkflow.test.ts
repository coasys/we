/**
 * A drop on a board whose space asks for agreement: what is written, and what is only asked.
 *
 * The rule is small and easy to get backwards — a move that is waiting must write *nothing*, or the
 * card is filed in Done by the very drop that asked whether it may be — so it is held here against a
 * the in-memory backend, compared before and after.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardActions } from '../src/shared/boards';
import { testOperations, testPredictions } from './support/operations';

type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findOne(p: unknown, query: Record<string, unknown>): Promise<Row | null>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  };

let dataset: unknown;
const row = async (entity: string, id: string) => (await model(entity).findOne(dataset, { where: { id } }))!;
const arranges = async (id: string) => ((await row('CollectionBlock', id)).arranges as string[] | undefined) ?? [];
const status = async (id: string) => (await row('TaskBlock', id)).status;
/** Everything a drop could write, so "writes nothing" is a comparison rather than a promise. */
const state = async () => ({
  todo: await arranges('col-todo'),
  done: await arranges('col-done'),
  t1: await status('t1'),
  tasks: (await model('TaskBlock').findAll(dataset)).length,
});
const made = async () => (await model('TaskBlock').findAll(dataset)).find((task) => task.id !== 't1')!;

function actions(
  outcome: 'moved' | 'waiting' | 'already-approved' | 'stalled' | 'already-there' | 'slow' | null,
  asking = new Set(['done']),
) {
  const move = vi.fn(async () => outcome);
  const notify = vi.fn();
  const board = createBoardActions({
    operations: testOperations,
    dataset: () => dataset,
    invoker: () => 'did:test:me',
    offeredStates: () => [
      { name: 'To do', slug: 'todo' },
      { name: 'Done', slug: 'done' },
    ],
    notify,
    workflow: {
      enabled: () => outcome !== null,
      needsAgreement: (slug) => asking.has(slug),
      stateOf: () => undefined,
      move,
      entryFor: () => 'todo',
    },
  });
  return { board, move, notify };
}

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'ds-flow', name: 'Flow' }] },
  );
  dataset = (await ports.lifecycle.get('ds-flow'))!.handle;
  await model('TaskBlock').create(dataset, { title: 'One', status: 'todo' }, { id: 't1' });
  await model('CollectionBlock').create(
    dataset,
    { kind: 'column', slug: 'todo', arranges: ['t1'] },
    { id: 'col-todo' },
  );
  await model('CollectionBlock').create(dataset, { kind: 'column', slug: 'done' }, { id: 'col-done' });
});

describe('a drop into a state that asks for agreement', () => {
  it('asks, and writes nothing — not the order, not the state — while the move is waiting', async () => {
    const { board, move } = actions('waiting');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1']);
    expect(move).toHaveBeenCalledWith('t1', 'todo', 'done');
    expect(await state()).toEqual({ todo: ['t1'], done: [], t1: 'todo', tasks: 1 });
  });

  it('draws nothing ahead of it either, so the card never jumps to Done and back', async () => {
    const { board } = actions('waiting');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1']);
    expect(testPredictions.for(dataset)).toEqual([]);
  });

  it('writes the arrangement and the state once the move has happened', async () => {
    const { board } = actions('moved');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1']);
    expect(await status('t1')).toBe('done');
    expect(await arranges('col-done')).toEqual(['t1']);
    expect(await arranges('col-todo')).toEqual([]);
  });

  it('says so when the card is stuck', async () => {
    const { board, notify } = actions('stalled');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1']);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('stuck'));
    expect(await state()).toEqual({ todo: ['t1'], done: [], t1: 'todo', tasks: 1 });
  });
});

describe('a drop the backend could not answer plainly', () => {
  it('writes the state when the run was already there, and says the column may lag', async () => {
    const { board, notify } = actions('already-there');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1']);
    expect(await status('t1')).toBe('done');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('already there'));
  });

  it('writes nothing on a timeout, and says the vote is still being counted', async () => {
    const { board, notify } = actions('slow');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1']);
    expect(await state()).toEqual({ todo: ['t1'], done: [], t1: 'todo', tasks: 1 });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('still counting'));
  });
});

describe('a drop in a space that asks for nothing', () => {
  it('writes the state as it always has', async () => {
    const { board, move } = actions(null);
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1']);
    expect(move).not.toHaveBeenCalled();
    expect(await status('t1')).toBe('done');
  });
});

describe('a task made straight into a column', () => {
  it('is born in the first state that asks for nothing, and asks for the column it was made in', async () => {
    const { board, move } = actions('waiting');
    await board.addTaskToColumn('col-done', 'Ship it');
    const task = await made();
    expect(task.status).toBe('todo');
    expect(await arranges('col-done')).toEqual([]);
    expect(move).toHaveBeenCalledWith(task.id, 'todo', 'done');
  });

  it('is made in its column as before where that state asks for nothing', async () => {
    const { board, move } = actions('waiting');
    await board.addTaskToColumn('col-todo', 'Plan it');
    const task = await made();
    expect(task.status).toBe('todo');
    expect(await arranges('col-todo')).toEqual(['t1', task.id]);
    expect(move).not.toHaveBeenCalled();
  });
});
