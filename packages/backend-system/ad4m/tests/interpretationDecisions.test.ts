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
  });

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
