/**
 * The store's part of a vote: the operation it runs, and the vote it holds on screen meanwhile. What
 * the operation writes — one vote per person per poll, a duplicate healed — is tested where it runs,
 * against a backend (app-shell's `pollsVote.test.ts`).
 */
import { fakeDeps, fakeOperations } from '@we/module-testing';
import { describe, expect, it } from 'vitest';

import { createPollsStore } from './store';

function deps(ops = fakeOperations({ 'polls.vote': () => undefined }), settings: Record<string, boolean> = {}) {
  const bag = fakeDeps({ selfId: () => 'did:me', settings: () => settings, operations: ops.access });
  return { bag, ops };
}

const failing = (message: string) =>
  fakeOperations({
    'polls.vote': () => {
      throw new Error(message);
    },
  });

describe('voting', () => {
  it('runs polls.vote with the poll and the choice', async () => {
    const { bag, ops } = deps();
    const store = createPollsStore(bag);
    await store.vote('poll-1', 'tea');
    expect(ops.calls).toEqual([{ name: 'polls.vote', args: { poll: 'poll-1', option: 'tea' } }]);
  });

  it('degrades to nothing on a host that runs no operations', async () => {
    const { bag } = deps();
    const store = createPollsStore({ ...bag, operations: undefined });
    await expect(store.vote('poll-1', 'tea')).resolves.toBeUndefined();
  });

  it('reports a failed write rather than throwing', async () => {
    const { bag } = deps(failing('offline'));
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
    expect(createPollsStore(deps(undefined, { revealBeforeVoting: false }).bag).revealBeforeVoting()).toBe(false);
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
    const { bag } = deps(failing('nope'));
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
