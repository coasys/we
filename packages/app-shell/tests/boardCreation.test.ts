/**
 * A board comes into being with its columns — and the other board writes land as one each.
 *
 * Making a board, adding a column and renaming one are invoked by templates as operations, with the
 * params a template passes; the rest go through the store's board actions, which hold what is drawn
 * ahead of a write.
 *
 * Against the in-memory backend, the reference: the writes are declared operations now, run by the
 * real runner in one transaction, so a stand-in data layer would test the stand-in. The rule that
 * once broke this — a record created in a transaction cannot be read until it commits, so writing a
 * new board's columns onto it found no board and did nothing — is the runner's and the backend's to
 * keep, and their conformance suites hold it on every backend.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity, runOperation } from '@we/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type BoardDeps, createBoardActions } from '../src/shared/boards';

const ME = 'did:test:me';
const STATES = [
  { name: 'To do', slug: 'todo' },
  { name: 'Doing', slug: 'doing' },
  { name: 'Done', slug: 'done' },
];

type Row = Record<string, unknown> & { id: string };
let dataset: unknown;

const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findOne(p: unknown, query: Record<string, unknown>): Promise<Row | null>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  };

const read = (id: string) => model('CollectionBlock').findOne(dataset, { where: { id } });
const ids = (value: unknown) => (Array.isArray(value) ? (value as unknown[]).map(String) : []);
const columnSlugs = async (boardId: string) =>
  Promise.all(ids((await read(boardId))?.children).map(async (id) => (await read(id))?.slug));

/** An operation, run as a template invokes it: one params object, in the space on screen. */
const op = <T = unknown>(name: string, params: Record<string, unknown>) =>
  runOperation(`core.${name}`, params, { dataset: dataset as never, invoker: ME }) as Promise<T>;
const SLUGS = STATES.map((state) => state.slug);

const actions = (extra: Partial<BoardDeps> = {}) =>
  createBoardActions({
    dataset: () => dataset,
    invoker: () => ME,
    offeredStates: () => STATES,
    // A failure is said in a toast and swallowed; here it fails the test instead.
    notify: (message) => {
      throw new Error(message);
    },
    ...extra,
  });

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-boards', name: 'Boards' }] },
  );
  dataset = (await ports.lifecycle.get('ds-boards'))!.handle;
  await model('CollectionBlock').create(dataset, { kind: 'call', title: 'Standup' }, { id: 'call' });
  await model('TaskBlock').create(
    dataset,
    { title: 'Ship it', status: 'todo' },
    {
      id: 'task',
      parent: { id: 'call', relation: 'children', entity: 'CollectionBlock' },
    },
  );
});

describe('making a board', () => {
  it('gives it a column per state, in the community’s order', async () => {
    const boardId = await op<string>('createBoard', {
      title: 'Standup',
      states: SLUGS,
      parent: 'call',
      gathers: 'call',
    });

    expect(await columnSlugs(boardId)).toEqual(['todo', 'doing', 'done']);
    expect(ids((await read('call'))?.children)).toContain(boardId);
    expect((await read(boardId))?.gathers).toBe('call');
  });

  it('leaves a board loose rather than failing when its container has gone', async () => {
    const boardId = await op<string>('createBoard', { title: 'Loose', states: SLUGS, parent: 'nowhere' });
    expect(boardId).toBeTruthy();
    expect(await columnSlugs(boardId)).toEqual(['todo', 'doing', 'done']);
  });

  it('gives a call’s board its columns when interpretation makes it', async () => {
    const boardId = await actions().ensureBoardFor('call');

    expect((await read('call'))?.board).toBe(boardId);
    expect(await columnSlugs(boardId)).toEqual(['todo', 'doing', 'done']);
    // Asked again, it is the same board.
    expect(await actions().ensureBoardFor('call')).toBe(boardId);
  });

  it('gives a call no board while it holds no task', async () => {
    await model('CollectionBlock').create(dataset, { kind: 'call', title: 'Quiet' }, { id: 'quiet' });
    expect(await actions().ensureBoardFor('quiet')).toBe('');
    expect((await read('quiet'))?.board).toBeFalsy();
  });

  it('makes the space’s own board once, gathering from the space collection, and names it by landmark', async () => {
    await model('CollectionBlock').create(dataset, { kind: 'space' }, { id: 'root' });
    await model('Space').create(dataset, { name: 'Space', root: 'root' }, { id: 'space' });
    const landmarksChanged = vi.fn();
    const space = actions({ landmarksChanged });

    const boardId = await space.openBoardFor();

    expect((await read(boardId))?.gathers).toBe('root');
    expect(ids((await read('root'))?.children)).toContain(boardId);
    expect(await columnSlugs(boardId)).toEqual(['todo', 'doing', 'done']);
    const landmarks = await model('SpaceLandmark').findAll(dataset);
    expect(landmarks).toEqual([expect.objectContaining({ name: 'board', node: boardId })]);
    expect(landmarksChanged).toHaveBeenCalledTimes(1);

    // Pressed again, it is the same board — the landmark names it — and nothing more is written.
    expect(await space.openBoardFor()).toBe(boardId);
    expect(await model('SpaceLandmark').findAll(dataset)).toHaveLength(1);
  });
});

describe('a board’s columns', () => {
  let boardId = '';
  beforeEach(async () => {
    boardId = await op<string>('createBoard', { title: 'Work', states: SLUGS });
  });

  it('stores no title for a bound column named as its state, and stores a lane’s', async () => {
    await op('addBoardColumn', { board: boardId, name: 'Doing', slug: 'doing', states: STATES });
    // A lane: the template sends no slug rather than an empty one.
    await op('addBoardColumn', { board: boardId, name: 'Thursday', slug: null, states: STATES });
    const columns = await Promise.all(ids((await read(boardId))?.children).map(read));
    expect(columns.slice(3).map((c) => [c?.slug ?? '', c?.title ?? ''])).toEqual([
      ['doing', ''],
      ['', 'Thursday'],
    ]);
  });

  it('adds a column for a new state to the space’s board only when it lacks one', async () => {
    await model('SpaceLandmark').create(dataset, { name: 'board', node: boardId });
    await actions().addStateToSpaceBoard('todo', 'To do');
    await actions().addStateToSpaceBoard('review', 'Review');
    expect(await columnSlugs(boardId)).toEqual(['todo', 'doing', 'done', 'review']);
  });

  it('renames a column, and a rename back to its state’s name stores nothing', async () => {
    const [todo] = ids((await read(boardId))?.children);
    await op('renameBoardColumn', { column: todo, name: 'Backlog', states: STATES });
    expect((await read(todo))?.title).toBe('Backlog');
    await op('renameBoardColumn', { column: todo, name: 'To do', states: STATES });
    expect((await read(todo))?.title).toBeFalsy();
  });

  it('reorders only the columns the board holds, the rest after', async () => {
    const [todo, doing, done] = ids((await read(boardId))?.children);
    await op('reorderBoardColumns', { board: boardId, ids: [done, 'stranger', todo] });
    expect(ids((await read(boardId))?.children)).toEqual([done, todo, doing]);
  });

  it('hands a removed column’s cards to the board, and deletes only the column', async () => {
    const [todo] = ids((await read(boardId))?.children);
    await op('arrangeColumn', { column: todo, ids: ['task'] });
    await actions().removeBoardColumn(boardId, todo);

    const board = await read(boardId);
    expect(ids(board?.children)).not.toContain(todo);
    expect(ids(board?.arranges)).toEqual(['task']);
    expect(await read(todo)).toBeNull();
    expect(await model('TaskBlock').findOne(dataset, { where: { id: 'task' } })).not.toBeNull();
  });

  it('stores a column’s order as the ids given, then what it still holds', async () => {
    const [todo] = ids((await read(boardId))?.children);
    await model('TaskBlock').create(dataset, { title: 'Two', status: 'todo' }, { id: 'two' });
    await op('arrangeColumn', { column: todo, ids: ['task', 'two'] });
    await op('arrangeColumn', { column: todo, ids: ['two'] });
    expect(ids((await read(todo))?.arranges)).toEqual(['two', 'task']);
  });

  it('puts a column showing part of itself back in its places, the hidden cards keeping theirs', async () => {
    // What a people filter does: the column holds a, h, b and shows a and b; b is dragged above a.
    const [todo] = ids((await read(boardId))?.children);
    await op('arrangeColumn', { column: todo, ids: ['a', 'h', 'b'] });
    await op('arrangeColumn', { column: todo, ids: ['b', 'a'], order: ['a', 'h', 'b'] });
    expect(ids((await read(todo))?.arranges)).toEqual(['b', 'h', 'a']);
  });
});
