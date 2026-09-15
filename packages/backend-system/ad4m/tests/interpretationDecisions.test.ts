/**
 * Deciding on a staged suggestion, in a space where somebody else may decide first.
 *
 * Two members looking at one card is the ordinary case in a call, so two things are pinned here. A
 * decision on a suggestion that is no longer staged answers `false` — as the port promises — rather
 * than throwing, which left the card impossible to clear from the second screen. And the adapter
 * reports that the staged set moved whenever the overlay's marker link comes or goes, which is what
 * lets every other screen stop showing a card as pending.
 */
import { createAd4mInterpretationPort } from '@we/backend-ad4m';
import { describe, expect, it } from 'vitest';

function perspective(decide: () => Promise<boolean>) {
  let resultCb: (() => void) | null = null;
  let disposed = false;
  return {
    /** Simulate the executor pushing a subscription update. */
    pushResult() {
      if (!disposed && resultCb) resultCb();
    },
    get disposed() {
      return disposed;
    },
    handle: {
      runInterpretation: () => undefined,
      interpretationOverlays: async () => [],
      acceptInterpretation: decide,
      rejectInterpretation: decide,
      subscribeQuery: async (_query: string) => ({
        onResult(cb: () => void) {
          resultCb = cb;
        },
        dispose() {
          disposed = true;
          resultCb = null;
        },
      }),
    } as never,
  };
}

const noOverlay = async (): Promise<boolean> => {
  throw new Error('accept_interpretation: no overlay on `we://task/1`');
};

describe('a decision somebody else already made', () => {
  const port = createAd4mInterpretationPort();

  it('answers false for accept and reject rather than throwing', async () => {
    const p = perspective(noOverlay);
    await expect(port.accept(p.handle, 'we://task/1')).resolves.toBe(false);
    await expect(port.reject(p.handle, 'we://task/1')).resolves.toBe(false);
  });

  it('still throws for anything else', async () => {
    const p = perspective(async () => {
      throw new Error('executor unreachable');
    });
    await expect(port.reject(p.handle, 'we://task/1')).rejects.toThrow('executor unreachable');
  });
});

describe('hearing that the staged suggestions moved', () => {
  const port = createAd4mInterpretationPort();

  it('fires every time the executor pushes a subscription update', async () => {
    const p = perspective(async () => true);
    let heard = 0;
    await port.onProposalsChanged!(p.handle, () => heard++);

    p.pushResult();
    p.pushResult();
    expect(heard).toBe(2);
  });

  it('stops firing after the cleanup function runs', async () => {
    const p = perspective(async () => true);
    let heard = 0;
    const off = await port.onProposalsChanged!(p.handle, () => heard++);

    p.pushResult();
    expect(heard).toBe(1);

    off();
    p.pushResult();
    expect(heard).toBe(1);
    expect(p.disposed).toBe(true);
  });
});
