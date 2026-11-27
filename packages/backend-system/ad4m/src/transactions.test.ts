/**
 * The registered runner commits what its callback staged, and discards the batch when the callback
 * throws — against a perspective stand-in, since the real batch calls need an executor.
 */
import type { PerspectiveProxy } from '@coasys/ad4m';
import { describe, expect, it } from 'vitest';

import { runAd4mTransaction } from './transactions';

function fakePerspective() {
  const calls: string[] = [];
  const perspective = {
    createBatch: () => {
      calls.push('create');
      return Promise.resolve('batch-1');
    },
    commitBatch: (id: string) => {
      calls.push(`commit:${id}`);
      return Promise.resolve();
    },
    discardBatch: (id: string) => {
      calls.push(`discard:${id}`);
      return Promise.resolve();
    },
  };
  return { calls, perspective: perspective as unknown as PerspectiveProxy };
}

describe('runAd4mTransaction', () => {
  it('hands the callback the batch, and commits it when the callback resolves', async () => {
    const { calls, perspective } = fakePerspective();
    const result = await runAd4mTransaction(perspective, async (tx) => {
      calls.push(`run:${tx.batchId}`);
      return Promise.resolve('done');
    });
    expect(result).toBe('done');
    expect(calls).toEqual(['create', 'run:batch-1', 'commit:batch-1']);
  });

  it('discards the batch when the callback throws, and rethrows what it threw', async () => {
    const { calls, perspective } = fakePerspective();
    const failure = new Error('the second write failed');
    const run = runAd4mTransaction(perspective, () => Promise.reject(failure));
    await expect(run).rejects.toBe(failure);
    expect(calls).toEqual(['create', 'discard:batch-1']);
  });

  it('rethrows the callback’s error even when the discard fails too', async () => {
    const { calls, perspective } = fakePerspective();
    (perspective as unknown as { discardBatch: () => Promise<void> }).discardBatch = () => {
      calls.push('discard failed');
      return Promise.reject(new Error('socket closed'));
    };
    const failure = new Error('the second write failed');
    await expect(runAd4mTransaction(perspective, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(calls).toEqual(['create', 'discard failed']);
  });
});
