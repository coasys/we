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

/** A namespace is read through `get`, which is how the evaluator indexes one. */
const heldVote = (store: ReturnType<typeof createPollsStore>, pollId: string) =>
  (store.pendingVote() as { get(key: string): unknown }).get(pollId);

describe('a vote drawn before it is stored', () => {
  it('is held from the press, so the choice and the bars move together', async () => {
    /*
      `voting` was the whole of this before — a spinner saying something is happening, which is what
      a card can show without a hold. It is the wrong answer to "did my press register": the person
      pressed a choice, and what says it registered is that choice being selected and the bars
      moving. A second of unmoved bars under a spinner reads as the press having failed.
    */
    const { bag } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    expect(heldVote(store, 'poll-1')).toEqual({ poll: 'poll-1', author: 'did:me', option: 'tea' });
    // And says nothing about a poll nobody has voted on.
    expect(heldVote(store, 'poll-2')).toBeUndefined();
  });

  it('is withdrawn when the write is refused', async () => {
    const records = fakeRecords({ author: 'did:me' });
    records.kernel.create = async () => {
      throw new Error('nope');
    };
    const { bag } = deps(records);
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    expect(heldVote(store, 'poll-1')).toBeUndefined();
    expect(store.lastError()).toBe('nope');
  });

  it('survives rows that have not caught up, and goes when they have', async () => {
    const { bag } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    // The draw the press itself caused, made from rows that still say nothing — the baseline.
    store.settleFromRows('poll-1', [{ author: 'did:them', option: 'coffee' }]);
    expect(heldVote(store, 'poll-1')).toBeTruthy();

    // The push that answered.
    store.settleFromRows('poll-1', [
      { author: 'did:them', option: 'coffee' },
      { author: 'did:me', option: 'tea' },
    ]);
    expect(heldVote(store, 'poll-1')).toBeUndefined();
  });

  it('is not released by a poll nobody has voted on yet', async () => {
    // An empty list read as data says the held vote is absent, so it would be released and the
    // choice would un-select for the rest of the round trip — the flash this exists to remove.
    const { bag } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');

    store.settleFromRows('poll-1', []);
    expect(heldVote(store, 'poll-1')).toBeTruthy();
  });
});
