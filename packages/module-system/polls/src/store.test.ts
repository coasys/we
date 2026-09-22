/**
 * One vote per person per poll, as a query rather than a constraint.
 */
import { fakeDeps, fakeRecords } from '@we/module-testing';
import { describe, expect, it } from 'vitest';

import { createPollsStore } from './store';

function deps(records = fakeRecords({ author: 'did:me' }), settings: Record<string, boolean> = {}) {
  const bag = fakeDeps({
    selfId: () => 'did:me',
    settings: () => settings,
    kernels: { records: records.kernel },
  });
  return { bag, records };
}

/** What was written, as a sentence per write — the order is the assertion. */
const writesOf = (records: ReturnType<typeof fakeRecords>) =>
  records.writes.map((write) => `${write.op} ${write.entity}${write.op === 'create' ? '' : ` ${write.id}`}`);

describe('voting', () => {
  it('creates a vote the first time, and changes it the second', async () => {
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-1', 'coffee');
    expect(records.rows).toEqual([
      { id: 'Vote-1', author: 'did:me', __entity: 'Vote', pollId: 'poll-1', option: 'coffee' },
    ]);
    expect(writesOf(records)).toEqual(['create Vote', 'update Vote Vote-1']);
  });

  it('does nothing when the same choice is pressed again', async () => {
    const { bag, records } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    await store.vote('poll-1', 'tea');
    expect(writesOf(records)).toEqual(['create Vote']);
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
    const records = fakeRecords({ author: 'did:me' });
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
