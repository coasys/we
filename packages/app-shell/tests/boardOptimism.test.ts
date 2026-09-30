/**
 * The two halves of a drag meeting: what is held on the way out, and what releases it.
 *
 * `@we/optimism` proves the rules in isolation. What is left to check is the composition, because
 * the mistake here is not in any one rule — it is in releasing at the wrong moment, and the wrong
 * moment looks exactly like the right one from inside a single function.
 *
 * Every write below is followed by `done`, which is what `boards.ts` does when one returns. It is
 * not decoration: until the last write behind a hold is back, nothing the data says is about that
 * hold yet, so a test that omits it is testing a board mid-drag rather than one that has been
 * dropped. The case at the end is what that rule is for.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { boardOptimism } from '../src/shared/boardOptimism';

const { hold, release, holdStatus, releaseStatus, done, doneStatus } = boardOptimism.ports;

/*
  Drop every entry, so one test cannot leak into the next through the module singleton.

  `settle` cannot do this, which is worth knowing: handed an empty order for everything it *seeds*
  those as baselines rather than dropping them, and the entries survive. That is correct — an empty
  relation is a value like any other — and it is why forgetting is its own operation.
*/
beforeEach(() => boardOptimism.reset());

const observedFrom =
  (map: Record<string, string[]>) =>
  (recordId: string, relation: string): readonly string[] | undefined =>
    map[`${recordId}.${relation}`];

describe('an arrangement in flight', () => {
  it('is drawn before it is stored', () => {
    hold('col-1', 'arranges', ['b', 'a']);

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toEqual(['b', 'a']);
    expect(boardOptimism.inFlight()).toBe(true);
  });

  it('is withdrawn when the write is refused', () => {
    hold('col-1', 'arranges', ['b', 'a']);
    release('col-1', 'arranges');

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toBeUndefined();
    expect(boardOptimism.inFlight()).toBe(false);
  });

  it('survives a draw where the data has not caught up', () => {
    hold('col-1', 'arranges', ['b', 'a']);

    // The board redraws the instant the entry is held — that is the whole point — and the rows it
    // draws from are still the old ones. That draw sets the baseline; it must not release.
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['a', 'b'] }));
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['a', 'b'] }));

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('is released once the data has moved', () => {
    hold('col-1', 'arranges', ['b', 'a']);
    done('col-1', 'arranges');
    // Two draws, which is the real sequence: the first is made from the data as it still stands and
    // is what gives the entry its baseline; the second is made from the push that answered.
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['a', 'b'] }));
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['b', 'a'] }));

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['b', 'a'])).toBeUndefined();
    expect(boardOptimism.inFlight()).toBe(false);
  });
});

describe('a card’s state, held as an arrangement of one', () => {
  it('reads as the new state while the write is in flight', () => {
    holdStatus('t1', 'doing');

    expect(boardOptimism.overlay().status('t1', 'todo')).toBe('doing');
  });

  /*
    The bug this file exists for.

    Holding a state makes the board redraw, and the redraw reports back. An earlier version forgot
    every state belonging to a card it had just *drawn*, which is every card — so the overlay was
    released on the very next tick, the card fell back to its old state, and the stale-hint rule
    threw it out of the column it had just been dropped into. It was drawn in neither column: worse
    than the flash it was meant to replace, and produced by the release rule rather than by either
    of the two rules it composes.
  */
  it('survives the redraw that holding it caused', () => {
    holdStatus('t1', 'doing');
    boardOptimism.settle(observedFrom({ 't1.status': ['todo'] }));

    expect(boardOptimism.overlay().status('t1', 'todo')).toBe('doing');
  });

  it('is released once the record actually reads as the new state', () => {
    holdStatus('t1', 'doing');
    doneStatus('t1');
    boardOptimism.settle(observedFrom({ 't1.status': ['todo'] }));
    boardOptimism.settle(observedFrom({ 't1.status': ['doing'] }));

    expect(boardOptimism.overlay().status('t1', 'doing')).toBeUndefined();
  });

  it('is released when the record reads as something else entirely — a peer moved it', () => {
    holdStatus('t1', 'doing');
    doneStatus('t1');
    boardOptimism.settle(observedFrom({ 't1.status': ['todo'] }));
    boardOptimism.settle(observedFrom({ 't1.status': ['blocked'] }));

    expect(boardOptimism.overlay().status('t1', 'blocked')).toBeUndefined();
  });

  it('is withdrawn when the write is refused', () => {
    holdStatus('t1', 'doing');
    releaseStatus('t1');

    expect(boardOptimism.overlay().status('t1', 'todo')).toBeUndefined();
  });

  it('does not collide with an arrangement on the same record', () => {
    // Both live in one map keyed `<id>.<relation>`; a card that is also a container must keep them
    // apart, and `status` is a relation name nothing else uses.
    hold('t1', 'arranges', ['x']);
    holdStatus('t1', 'doing');

    expect(boardOptimism.overlay().order('t1', 'arranges', ['y'])).toEqual(['x']);
    expect(boardOptimism.overlay().status('t1', 'todo')).toBe('doing');
  });
});

describe('what a draw reports', () => {
  it('leaves alone an entry for a record it did not draw', () => {
    hold('col-1', 'arranges', ['b', 'a']);

    // A column outside what was drawn says nothing about whether its write has landed.
    boardOptimism.settle(observedFrom({ 'col-2.arranges': ['q'] }));

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('settles several at once — a drop writes the target, the source and the state', () => {
    hold('col-1', 'arranges', ['a']);
    hold('col-2', 'arranges', ['b', 'c']);
    holdStatus('b', 'doing');
    done('col-1', 'arranges');
    done('col-2', 'arranges');
    doneStatus('b');

    // The draw that gives all three their baselines, then the one made from the answer.
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['a', 'b'], 'col-2.arranges': ['c'], 'b.status': ['todo'] }));
    boardOptimism.settle(
      observedFrom({ 'col-1.arranges': ['a'], 'col-2.arranges': ['b', 'c'], 'b.status': ['doing'] }),
    );

    expect(boardOptimism.inFlight()).toBe(false);
  });
});

describe('a board dragged twice before the first write is back', () => {
  /*
    The rule the board did not have until `@we/optimism` brought it over from involvements.

    Two drags in a second are two writes for one column, and the first one's echo arrives while the
    second drag is what is on screen. Judged then, "the data has moved" is true — of data the person
    has already superseded — so the hold lifts, the column is drawn from the first answer, and the
    cards jump back and then forward again as the second write lands.
  */
  it('ignores the first write echoing back under the second drag', () => {
    hold('col-1', 'arranges', ['b', 'a']);
    hold('col-1', 'arranges', ['a', 'b', 'c']);
    done('col-1', 'arranges'); // the first write returns; the second is still going

    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['b', 'a'] }));

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['b', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('judges it against a fresh baseline once the last write is back', () => {
    hold('col-1', 'arranges', ['b', 'a']);
    hold('col-1', 'arranges', ['a', 'b', 'c']);
    done('col-1', 'arranges');
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['b', 'a'] }));
    done('col-1', 'arranges');

    // Whatever the data said while writes were in flight is the history of the earlier press, so the
    // baseline is taken again from here.
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['b', 'a'] }));
    expect(boardOptimism.overlay().order('col-1', 'arranges', ['b', 'a'])).toEqual(['a', 'b', 'c']);

    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['a', 'b', 'c'] }));
    expect(boardOptimism.inFlight()).toBe(false);
  });

  it('a refused write under a later drag leaves the later one drawn', () => {
    hold('col-1', 'arranges', ['b', 'a']);
    hold('col-1', 'arranges', ['a', 'b', 'c']);
    release('col-1', 'arranges');

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['x'])).toEqual(['a', 'b', 'c']);
  });
});
