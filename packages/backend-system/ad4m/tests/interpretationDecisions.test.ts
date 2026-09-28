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
import { describe, expect, it, vi } from 'vitest';

function perspective(decide: () => Promise<boolean>) {
  let resultCb: (() => void) | null = null;
  let disposed = false;
  const queries: string[] = [];
  return {
    /** Simulate the executor pushing a subscription update. */
    pushResult() {
      if (!disposed && resultCb) resultCb();
    },
    get disposed() {
      return disposed;
    },
    /** Every query the adapter subscribed with, in order. */
    queries,
    handle: {
      runInterpretation: () => undefined,
      interpretationOverlays: async () => [],
      acceptInterpretation: decide,
      rejectInterpretation: decide,
      subscribeQuery: async (query: string) => {
        queries.push(query);
        return {
          onResult(cb: () => void) {
            resultCb = cb;
          },
          dispose() {
            disposed = true;
            resultCb = null;
          },
        };
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

  it("watches the overlay marker by name, so the executor re-runs the watch only for that marker's changes", async () => {
    /*
      The executor re-runs a subscription only for a diff touching a predicate it reads out of the
      query: only from SPARQL, which it knows by the opening keyword, and only where the predicate
      is written out in full as `<iri>`, by the pattern below. A variable predicate (even one a
      FILTER pins down), a prefixed name, or Prolog leaves it nothing to read, so it re-runs this
      watch for every link of a peer-sync burst: the storm, moved from JS into the executor. A
      second predicate would re-run it for that one's diffs too.
    */
    const triplePredicate = /(?:\?\w+|<[^>]+>)\s+(<[^>]+>)\s+(?:\?\w+|<[^>]+>)/g;
    const p = perspective(async () => true);
    await port.onProposalsChanged!(p.handle, () => {});

    expect(p.queries).toHaveLength(1);
    expect(p.queries[0]).toMatch(/^\s*SELECT\b/i);
    expect([...p.queries[0].matchAll(triplePredicate)].map((m) => m[1])).toEqual(['<ad4m://interp/kind>']);
    // And no variable predicate anywhere, which the executor reads as "re-run for every diff".
    expect(p.queries[0]).not.toMatch(/(?:\?\w+|<[^>]+>)\s+\?\w+\s+(?:\?\w+|<[^>]+>)\s*\./);
  });

  it('fires every time the executor pushes a subscription update', async () => {
    const p = perspective(async () => true);
    let heard = 0;
    await port.onProposalsChanged!(p.handle, () => heard++);

    p.pushResult();
    p.pushResult();
    expect(heard).toBe(2);
  });

  it('stops firing after the cleanup function runs, and lets the subscription go after a grace', async () => {
    vi.useFakeTimers();
    try {
      const p = perspective(async () => true);
      let heard = 0;
      const off = await port.onProposalsChanged!(p.handle, () => heard++);

      p.pushResult();
      expect(heard).toBe(1);

      off();
      p.pushResult();
      expect(heard).toBe(1);
      expect(p.disposed).toBe(false);

      await vi.advanceTimersByTimeAsync(1500);
      expect(p.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('two watches on one perspective', () => {
  /*
    The executor gives identical subscriptions from one user one server-side subscription and keeps
    no count of who holds it, so a dispose ends it for everyone. The case that bites: a space switch
    away and back inside a round trip, where the first watch finishes starting after the second one
    and is stopped the moment it does.
  */
  it('share one subscription, so one letting go leaves the other hearing', async () => {
    vi.useFakeTimers();
    try {
      const port = createAd4mInterpretationPort();
      const p = perspective(async () => true);
      let first = 0;
      let second = 0;
      const offFirst = await port.onProposalsChanged!(p.handle, () => first++);
      await port.onProposalsChanged!(p.handle, () => second++);
      expect(p.queries).toHaveLength(1);

      offFirst();
      vi.advanceTimersByTime(5000);
      p.pushResult();

      expect(p.disposed).toBe(false);
      expect([first, second]).toEqual([0, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pick the subscription back up when a holder returns inside the grace', async () => {
    vi.useFakeTimers();
    try {
      const port = createAd4mInterpretationPort();
      const p = perspective(async () => true);
      const off = await port.onProposalsChanged!(p.handle, () => {});
      off();
      vi.advanceTimersByTime(1000);

      let heard = 0;
      await port.onProposalsChanged!(p.handle, () => heard++);
      vi.advanceTimersByTime(5000);
      p.pushResult();

      expect(p.queries).toHaveLength(1);
      expect(p.disposed).toBe(false);
      expect(heard).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ask again after a watch failed to start, rather than holding the failure', async () => {
    const port = createAd4mInterpretationPort();
    const p = perspective(async () => true);
    const subscribe = (p.handle as { subscribeQuery: (q: string) => Promise<unknown> }).subscribeQuery;
    let calls = 0;
    (p.handle as { subscribeQuery: (q: string) => Promise<unknown> }).subscribeQuery = (query) =>
      ++calls === 1 ? Promise.reject(new Error('executor unreachable')) : subscribe(query);

    await expect(port.onProposalsChanged!(p.handle, () => {})).rejects.toThrow('executor unreachable');
    let heard = 0;
    await port.onProposalsChanged!(p.handle, () => heard++);
    p.pushResult();

    expect(calls).toBe(2);
    expect(heard).toBe(1);
  });
});
