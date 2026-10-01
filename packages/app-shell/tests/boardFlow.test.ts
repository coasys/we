/**
 * A drop on a board whose space asks for agreement: what is written, and what is only asked.
 *
 * The rule is small and easy to get backwards — a move that is waiting must write *nothing*, or the
 * card is filed in Done by the very drop that asked whether it may be — so it is held here against a
 * store that records every write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  id: string;
  slug?: string;
  status?: string;
  arranges?: string[];
}

const rows = new Map<string, Row>();
const writes: string[] = [];

vi.mock('@we/entities', () => {
  const record = (row: Row) => ({
    ...row,
    arranges: [...(row.arranges ?? [])],
    async save() {
      const stored = rows.get(row.id)!;
      if (this.status !== stored.status) writes.push(`status ${row.id} ${this.status}`);
      stored.status = this.status;
    },
  });
  const CollectionBlock = {
    findOne: async (_p: unknown, query: { where: { id: string } }) => {
      const row = rows.get(query.where.id);
      return row ? record(row) : null;
    },
    setRelation: async (_p: unknown, id: string, relation: string, targets: string[]) => {
      writes.push(`${relation} ${id} ${targets.join(',')}`);
      rows.get(id)!.arranges = [...targets];
    },
    addRelation: async (_p: unknown, id: string, relation: string, target: string) => {
      writes.push(`${relation} ${id} +${target}`);
      rows.get(id)!.arranges = [...(rows.get(id)!.arranges ?? []), target];
    },
    removeRelation: async (_p: unknown, id: string, relation: string, target: string) => {
      writes.push(`${relation} ${id} -${target}`);
      rows.get(id)!.arranges = (rows.get(id)!.arranges ?? []).filter((t) => t !== target);
    },
  };
  const TaskBlock = {
    findOne: async (_p: unknown, query: { where: { id: string } }) => {
      const row = rows.get(query.where.id);
      return row ? record(row) : null;
    },
    create: async (_p: unknown, data: Row) => {
      const row = { ...data, id: `task-${rows.size}` };
      rows.set(row.id, row);
      writes.push(`create ${row.id} ${row.status}`);
      return row;
    },
  };
  return {
    CollectionBlock,
    Space: {},
    getEntityForDataset: (name: string) => (name === 'TaskBlock' ? TaskBlock : undefined),
    runEntityTransaction: async (_p: unknown, run: (tx: { batchId: string }) => Promise<unknown>) =>
      run({ batchId: 'b' }),
  };
});

const { createBoardActions } = await import('../src/shared/boards');

const holds: string[] = [];
const releases: string[] = [];

function actions(
  outcome: 'moved' | 'waiting' | 'already-voted' | 'stalled' | 'already-there' | 'slow' | null,
  asking = new Set(['done']),
) {
  const move = vi.fn(async () => outcome);
  const notify = vi.fn();
  const board = createBoardActions({
    dataset: () => ({}) as never,
    offeredStates: () => [
      { name: 'To do', slug: 'todo' },
      { name: 'Done', slug: 'done' },
    ],
    notify,
    hold: (id, relation) => holds.push(`${relation} ${id}`),
    release: (id, relation) => releases.push(`${relation} ${id}`),
    holdStatus: (id, status) => holds.push(`status ${id} ${status}`),
    releaseStatus: (id) => releases.push(`status ${id}`),
    flow: {
      enabled: () => outcome !== null,
      needsAgreement: (slug) => asking.has(slug),
      stateOf: () => undefined,
      move,
      entryFor: () => 'todo',
    },
  });
  return { board, move, notify };
}

beforeEach(() => {
  rows.clear();
  writes.length = 0;
  holds.length = 0;
  releases.length = 0;
  rows.set('col-todo', { id: 'col-todo', slug: 'todo', arranges: ['t1'] });
  rows.set('col-done', { id: 'col-done', slug: 'done', arranges: [] });
  rows.set('t1', { id: 't1', status: 'todo' });
});

describe('a drop into a state that asks for agreement', () => {
  it('asks, and writes nothing — not the order, not the state — while the move is waiting', async () => {
    const { board, move } = actions('waiting');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1'], 'done');
    expect(move).toHaveBeenCalledWith('t1', 'todo', 'done');
    expect(writes).toEqual([]);
    expect(rows.get('t1')!.status).toBe('todo');
  });

  it('draws nothing ahead of it either, so the card never jumps to Done and back', async () => {
    const { board } = actions('waiting');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1'], 'done');
    expect(holds).toEqual([]);
  });

  it('writes the arrangement and the state once the move has happened', async () => {
    const { board } = actions('moved');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1'], 'done');
    expect(rows.get('t1')!.status).toBe('done');
    expect(writes).toContain('status t1 done');
    expect(rows.get('col-done')!.arranges).toEqual(['t1']);
  });

  it('says so when the card is stuck', async () => {
    const { board, notify } = actions('stalled');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1'], 'done');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('stuck'));
    expect(writes).toEqual([]);
  });
});

describe('a drop the backend could not answer plainly', () => {
  it('writes the state when the run was already there, and says the column may lag', async () => {
    const { board, notify } = actions('already-there');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1'], 'done');
    expect(rows.get('t1')!.status).toBe('done');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('already there'));
  });

  it('writes nothing on a timeout, and says the vote is still being counted', async () => {
    const { board, notify } = actions('slow');
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1'], 'done');
    expect(writes).toEqual([]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('still counting'));
  });
});

describe('a drop in a space that asks for nothing', () => {
  it('writes the state as it always has', async () => {
    const { board, move } = actions(null);
    await board.moveCardToColumn('col-todo', 'col-done', 't1', ['t1'], 'done');
    expect(move).not.toHaveBeenCalled();
    expect(rows.get('t1')!.status).toBe('done');
    expect(holds).toContain('status t1 done');
  });
});

describe('a task made straight into a column', () => {
  it('is born in the first state that asks for nothing, and asks for the column it was made in', async () => {
    const { board, move } = actions('waiting');
    await board.addTaskToColumn('col-done', 'Ship it');
    const made = [...rows.values()].find((r) => r.id.startsWith('task-'))!;
    expect(made.status).toBe('todo');
    expect(rows.get('col-done')!.arranges).toEqual([]);
    expect(move).toHaveBeenCalledWith(made.id, 'todo', 'done');
  });

  it('is made in its column as before where that state asks for nothing', async () => {
    const { board, move } = actions('waiting');
    await board.addTaskToColumn('col-todo', 'Plan it');
    const made = [...rows.values()].find((r) => r.id.startsWith('task-'))!;
    expect(made.status).toBe('todo');
    expect(move).not.toHaveBeenCalled();
  });
});
