/**
 * A gesture on something on screen is drawn before any backend read answers.
 *
 * The backend here answers no read at all until it is told to — a round trip that never ends — while
 * the live reads a screen would hold are open and followed. Each gesture is invoked as the host
 * invokes it, and its write must appear in those reads while every read it could have asked is still
 * waiting: the speculative run, and the store's own reads before it, are answered from what the
 * reads hold. Then the backend answers, the real run lands, and the stored rows say the same.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import type { LivePage, LiveQuery } from '@we/backend-shared';
import {
  clearPredictions,
  getEntity,
  getEntityForDataset,
  registerOperations,
  unregisterOperations,
  withPredictions,
} from '@we/entities';
import { POLLS_MANIFEST } from '@we/module-polls';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardActions } from '../src/shared/boards';
import { invokeOperation } from '../src/shared/invokeOperation';

const ME = 'did:test:me';

type Row = Record<string, unknown> & { id: string };
type Statics = {
  create(d: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  setRelation(d: unknown, id: string, relation: string, targets: string[]): Promise<void>;
  query(d: unknown, q?: Record<string, unknown>): LiveQuery<LivePage<Row>>;
};

let handle: unknown;
const backend = (name: string) => (getEntityForDataset(name, handle) ?? getEntity(name)) as unknown as Statics;
/** The entity as a template's `$query` reaches it — the renderer's bindings draw what is pending. */
const onScreen = (name: string) => withPredictions(backend(name), [name]) as unknown as Statics;

/** A live read followed as a surface follows it, and what it shows now. */
const opened: (() => void)[] = [];
async function follow(name: string, query: Record<string, unknown>) {
  const live = onScreen(name).query(handle, query);
  let shown: Row[] = [];
  const stop = live.subscribe((snapshot) => {
    if (snapshot.status === 'ready' && snapshot.data) shown = snapshot.data.results;
  });
  await live.first;
  opened.push(() => {
    stop();
    live.dispose();
  });
  return () => shown;
}

/**
 * Hold every backend read of these entities until `open`, counting the ones that have answered. The
 * live reads are not held: they are already open, which is what a screen showing the rows means.
 */
function holdReads(names: string[]) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let answered = 0;
  const restore: (() => void)[] = [];
  for (const name of names) {
    const cls = backend(name) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const method of ['findAll', 'findOne']) {
      const real = cls[method];
      cls[method] = (...args: unknown[]) => gate.then(() => real.apply(cls, args)).finally(() => void answered++);
      restore.push(() => void (cls[method] = real));
    }
  }
  return {
    open: () => open(),
    answered: () => answered,
    restore: () => restore.forEach((fn) => fn()),
  };
}

/** Wait until `drawn` is true or a few dozen turns have passed — never for a read, which is held. */
async function until(drawn: () => boolean) {
  for (let i = 0; i < 40 && !drawn(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return drawn();
}

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-drawn', name: 'Drawn' }] },
  );
  ports.schemas.declare(POLLS_MANIFEST, { moduleId: 'polls' });
  handle = (await ports.lifecycle.get('ds-drawn'))!.handle;
  registerOperations('polls', POLLS_MANIFEST.operations, { version: POLLS_MANIFEST.version });
});

afterEach(() => {
  for (const close of opened.splice(0)) close();
  unregisterOperations('polls');
  clearPredictions();
});

const signalsOf = (rows: Row[], id: string) => (rows.find((row) => row.id === id)?.signals ?? []) as Row[];

describe('drawn before any read answers', () => {
  it('a reaction pressed, and taken back', async () => {
    const post = await backend('CollectionBlock').create(handle, { kind: 'post' });
    const shown = await follow('CollectionBlock', { where: { kind: 'post' }, include: { signals: true } });
    const reads = holdReads(['Signal', 'CollectionBlock']);

    const pressed = invokeOperation(
      'core.upsertSignal',
      { node: post.id, signalType: 'like', value: 1 },
      { dataset: handle, invoker: ME },
    );
    expect(await until(() => signalsOf(shown(), post.id).length === 1)).toBe(true);
    expect(signalsOf(shown(), post.id)[0]).toMatchObject({ value: 1, author: ME });
    expect(reads.answered()).toBe(0);

    // Taken back before the press has landed: predicted from the press's own prediction.
    const takenBack = invokeOperation(
      'core.withdrawSignal',
      { node: post.id, signalType: 'like' },
      { dataset: handle, invoker: ME },
    );
    expect(await until(() => signalsOf(shown(), post.id).length === 0)).toBe(true);
    expect(reads.answered()).toBe(0);

    reads.open();
    await Promise.all([pressed, takenBack]);
    reads.restore();
    expect(await backend('Signal').findAll(handle, { parent: { id: post.id, relation: 'signals' } })).toEqual([]);
  });

  it('a card moved between columns, and the board’s columns reordered', async () => {
    const Collection = backend('CollectionBlock');
    const board = await Collection.create(handle, { kind: 'board' });
    const todo = await Collection.create(
      handle,
      { kind: 'column', slug: 'todo' },
      { parent: { id: board.id, relation: 'children' } },
    );
    const done = await Collection.create(
      handle,
      { kind: 'column', slug: 'done' },
      { parent: { id: board.id, relation: 'children' } },
    );
    const task = await backend('TaskBlock').create(handle, { title: 'Ship it', status: 'todo' });
    await Collection.setRelation(handle, todo.id, 'arranges', [task.id]);

    // The board's three reads, as `taskBoard` declares them.
    const boardRow = await follow('CollectionBlock', {
      where: { id: board.id },
      include: { children: true },
      limit: 1,
    });
    const columns = await follow('CollectionBlock', {
      where: { kind: 'column' },
      parent: { id: board.id, relation: 'children' },
    });
    const pool = await follow('TaskBlock', { order: { createdAt: 'asc' } });
    const reads = holdReads(['CollectionBlock', 'TaskBlock']);

    const actions = createBoardActions({
      dataset: () => handle as never,
      invoker: () => ME,
      offeredStates: () => [],
      notify: (message) => {
        throw new Error(message);
      },
    });
    const moved = actions.moveCardToColumn(todo.id, done.id, task.id);
    const arranged = (id: string) => (columns().find((row) => row.id === id)?.arranges ?? []) as string[];
    expect(await until(() => arranged(done.id).includes(task.id))).toBe(true);
    expect(arranged(todo.id)).not.toContain(task.id);
    expect(pool().find((row) => row.id === task.id)?.status).toBe('done');
    expect(reads.answered()).toBe(0);

    const reordered = invokeOperation(
      'core.reorderBoardColumns',
      { board: board.id, ids: [done.id, todo.id] },
      { dataset: handle, invoker: ME },
    );
    const order = () => ((boardRow()[0]?.children ?? []) as Row[]).map((row) => row.id);
    expect(await until(() => order()[0] === done.id)).toBe(true);
    expect(reads.answered()).toBe(0);

    reads.open();
    await Promise.all([moved, reordered]);
    reads.restore();
    const [stored] = await Collection.findAll(handle, { where: { id: done.id } });
    expect(stored.arranges).toEqual([task.id]);
  });

  it('a column’s cards rearranged', async () => {
    const Collection = backend('CollectionBlock');
    const column = await Collection.create(handle, { kind: 'column', slug: 'todo' });
    const a = await backend('TaskBlock').create(handle, { title: 'A' });
    const b = await backend('TaskBlock').create(handle, { title: 'B' });
    await Collection.setRelation(handle, column.id, 'arranges', [a.id, b.id]);
    const columns = await follow('CollectionBlock', { where: { kind: 'column' } });
    const reads = holdReads(['CollectionBlock']);

    const arranging = invokeOperation(
      'core.arrangeColumn',
      { column: column.id, ids: [b.id, a.id] },
      { dataset: handle, invoker: ME },
    );
    expect(await until(() => (columns()[0]?.arranges as string[])?.[0] === b.id)).toBe(true);
    expect(reads.answered()).toBe(0);
    reads.open();
    await arranging;
    reads.restore();
  });

  it('a vote cast on a poll', async () => {
    const votes = await follow('Vote', { where: { pollId: 'poll-1' } });
    const reads = holdReads(['Vote']);
    const voting = invokeOperation('polls.vote', { poll: 'poll-1', option: 'tea' }, { dataset: handle, invoker: ME });
    expect(await until(() => votes().some((row) => row.option === 'tea' && row.author === ME))).toBe(true);
    expect(reads.answered()).toBe(0);
    reads.open();
    await voting;
    reads.restore();
  });
});
