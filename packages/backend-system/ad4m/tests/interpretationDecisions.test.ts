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

type Listener = (link: { data: { predicate?: string } }) => null;

function perspective(decide: () => Promise<boolean>) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    emit(type: 'link-added' | 'link-removed', predicate: string) {
      for (const cb of listeners.get(type) ?? []) cb({ data: { predicate } });
    },
    handle: {
      runInterpretation: () => undefined,
      interpretationOverlays: async () => [],
      acceptInterpretation: decide,
      rejectInterpretation: decide,
      addListener: async (type: string, cb: Listener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(cb);
      },
      removeListener: async (type: string, cb: Listener) => {
        listeners.get(type)?.delete(cb);
      },
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

  it('fires for the overlay marker coming or going, and for nothing else', async () => {
    const p = perspective(async () => true);
    let heard = 0;
    const off = await port.onProposalsChanged!(p.handle, () => heard++);

    p.emit('link-added', 'ad4m://interp/kind');
    p.emit('link-removed', 'ad4m://interp/kind');
    p.emit('link-removed', 'we://title');
    expect(heard).toBe(2);

    off();
    await Promise.resolve();
    p.emit('link-removed', 'ad4m://interp/kind');
    expect(heard).toBe(2);
  });
});
