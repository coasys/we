/**
 * The store's part of a vote: the operation it runs, and what it says when that fails. What the
 * operation writes — one vote per person per poll, a duplicate healed — is tested where it runs,
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
