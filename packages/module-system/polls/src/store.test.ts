/**
 * One vote per person per poll, as a query rather than a constraint.
 */
import type { ModuleStoreDeps, RecordQuery } from '@we/module-shared';
import { markAction, markState } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { createPollsStore } from './store';

function fakeRecords() {
  const rows: Record<string, unknown>[] = [];
  const writes: string[] = [];
  let next = 0;
  return {
    rows,
    writes,
    kernel: {
      create: async (entity: string, fields: Record<string, unknown>) => {
        const id = `${entity}-${++next}`;
        rows.push({ id, author: 'did:me', ...fields });
        writes.push(`create ${entity} ${fields.option}`);
        return id;
      },
      update: async (_entity: string, id: string, fields: Record<string, unknown>) => {
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, fields);
        writes.push(`update ${id} ${fields.option}`);
      },
      link: async () => {},
      remove: async () => {},
      find: async (_entity: string, query?: RecordQuery) => {
        const where = query?.where ?? {};
        return rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      },
      subscribe: () => () => {},
    },
  };
}

function deps(records = fakeRecords(), settings: Record<string, boolean> = {}) {
  const bag: ModuleStoreDeps = {
    signal: <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => void (value = next)];
    },
    state: markState,
    action: markAction,
    selfId: () => 'did:me',
    settings: () => settings,
    kernels: { records: records.kernel },
  };
  return { bag, records };
}

describe('voting', () => {
  it('creates a vote the first time, and changes it the second', async () => {
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-1', 'coffee');
    expect(records.rows).toEqual([{ id: 'Vote-1', author: 'did:me', pollId: 'poll-1', option: 'coffee' }]);
    expect(records.writes).toEqual(['create Vote tea', 'update Vote-1 coffee']);
  });

  it('does nothing when the same choice is pressed again', async () => {
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-1', 'tea');
    expect(records.writes).toEqual(['create Vote tea']);
  });

  it('keeps votes on different polls apart', async () => {
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-2', 'tea');
    expect(records.rows).toHaveLength(2);
  });

  it('degrades to nothing without the records kernel', async () => {
    const { bag } = deps();
    const store = createPollsStore({ ...bag, kernels: {} });
    await expect(store.vote('poll-1', 'tea')).resolves.toBeUndefined();
  });

  it('reports a failed write rather than throwing', async () => {
    const records = fakeRecords();
    records.kernel.create = async () => {
      throw new Error('offline');
    };
    const { bag } = deps(records);
    const notified: string[] = [];
    const store = createPollsStore({ ...bag, notify: (_tone, message) => void notified.push(message) });
    await store.vote('poll-1', 'tea');
    expect(store.lastError()).toBe('offline');
    expect(notified).toEqual(['offline']);
    expect(store.voting()).toBe('');
  });
});

describe('the setting', () => {
  it('reveals counts before voting unless the community said otherwise', () => {
    expect(createPollsStore(deps().bag).revealBeforeVoting()).toBe(true);
    expect(createPollsStore(deps(fakeRecords(), { revealBeforeVoting: false }).bag).revealBeforeVoting()).toBe(false);
  });
});
