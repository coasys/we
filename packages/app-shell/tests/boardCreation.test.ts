/**
 * A board comes into being with its columns.
 *
 * The data layer here is a stand-in with one rule taken from the executor, because that rule is the
 * whole bug: **a record created in a batch cannot be read until the batch commits.** A relation write
 * by id begins with that read, so writing a new board's columns onto it inside the transaction that
 * created it found no board and did nothing — every board was made pointed at by its call and
 * holding no columns. The in-memory backend applies writes immediately, which is why nothing caught
 * it; a stand-in that did the same would pass against the broken code too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  id: string;
  kind?: string;
  slug?: string;
  title?: string;
  children?: string[];
  gathers?: string[];
  board?: string;
}

const committed = new Map<string, Row>();
const batches = new Map<string, { staged: Row[]; ops: Array<() => void> }>();
let nextId = 0;

const hydrate = (row: Row, include?: { board?: boolean }) => ({
  ...row,
  children: [...(row.children ?? [])],
  ...(include?.board && row.board ? { board: { ...committed.get(row.board) } } : {}),
  setBoard: async (board: { id: string }) => {
    committed.get(row.id)!.board = board.id;
  },
});

vi.mock('@we/entities', () => {
  const CollectionBlock = {
    create: async (_p: unknown, data: Row, options?: { batchId?: string }) => {
      const row: Row = { ...data, id: `block-${nextId++}` };
      const batch = options?.batchId ? batches.get(options.batchId) : undefined;
      if (batch) batch.staged.push(row);
      else committed.set(row.id, row);
      return row;
    },
    // Committed rows only — the executor's rule.
    findOne: async (_p: unknown, query: { where: { id: string }; include?: { board?: boolean } }) => {
      const row = committed.get(query.where.id);
      return row ? hydrate(row, query.include) : null;
    },
    findAll: async (_p: unknown, query: { where: Partial<Row> }) =>
      [...committed.values()].filter((row) => Object.entries(query.where).every(([k, v]) => row[k as keyof Row] === v)),
    setRelation: async (_p: unknown, id: string, relation: 'children', targets: string[], batchId?: string) => {
      // Reads first, like the AD4M adapter: a record nobody can see is a write that does nothing.
      if (!committed.has(id)) return;
      const apply = () => (committed.get(id)![relation] = [...targets]);
      if (batchId) batches.get(batchId)!.ops.push(apply);
      else apply();
    },
    addRelation: async (_p: unknown, id: string, relation: 'children', target: string, batchId?: string) => {
      if (!committed.has(id)) return;
      const apply = () => {
        const row = committed.get(id)!;
        row[relation] = [...(row[relation] ?? []), target];
      };
      if (batchId) batches.get(batchId)!.ops.push(apply);
      else apply();
    },
  };
  return {
    CollectionBlock,
    Space: { findOne: async () => null },
    getEntitiesForPerspective: () => ({ findAll: async () => [{ id: 'task' }] }),
    runEntityTransaction: async (_p: unknown, fn: (tx: { batchId: string }) => Promise<unknown>) => {
      const batchId = `batch-${nextId++}`;
      batches.set(batchId, { staged: [], ops: [] });
      const result = await fn({ batchId });
      const batch = batches.get(batchId)!;
      for (const row of batch.staged) committed.set(row.id, row);
      for (const op of batch.ops) op();
      batches.delete(batchId);
      return result;
    },
  };
});

const { createBoardActions } = await import('../src/shared/boards');

const STATES = [
  { name: 'To do', slug: 'todo' },
  { name: 'Doing', slug: 'doing' },
  { name: 'Done', slug: 'done' },
];

const actions = () =>
  createBoardActions({ dataset: () => ({}) as never, offeredStates: () => STATES, notify: () => {} });

const columnSlugs = (boardId: string) => (committed.get(boardId)?.children ?? []).map((id) => committed.get(id)?.slug);

beforeEach(() => {
  committed.clear();
  batches.clear();
  nextId = 0;
  committed.set('call', { id: 'call', kind: 'call', title: 'Standup', children: ['task'] });
});

describe('making a board', () => {
  it('gives it a column per state, in the community’s order', async () => {
    const boardId = await actions().createBoard('Standup', 'call', { gathers: 'call' });

    expect(columnSlugs(boardId)).toEqual(['todo', 'doing', 'done']);
    expect(committed.get('call')?.children).toContain(boardId);
  });

  it('gives a call’s board its columns when extraction makes it', async () => {
    const boardId = await actions().ensureBoardFor('call');

    expect(committed.get('call')?.board).toBe(boardId);
    expect(columnSlugs(boardId)).toEqual(['todo', 'doing', 'done']);
  });
});
