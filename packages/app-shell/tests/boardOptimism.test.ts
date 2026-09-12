/**
 * The two halves of a drag meeting: what is held on the way out, and what releases it.
 *
 * `pendingOrder` proves the rules in isolation. What is left to check is the composition, because
 * the mistake here is not in either rule — it is in releasing at the wrong moment, and the wrong
 * moment looks exactly like the right one from inside a single function.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { boardOptimism } from '../src/shared/boardOptimism';

const { hold, release, holdStatus, releaseStatus } = boardOptimism.ports;

/** Drop every entry, so one test cannot leak into the next through the module singleton. */
beforeEach(() => {
  boardOptimism.settle(() => []);
  boardOptimism.settle(() => []);
});

const observedFrom =
  (map: Record<string, string[]>) =>
  (recordId: string, relation: string): readonly string[] | undefined =>
    map[`${recordId}.${relation}`];

describe('an arrangement in flight', () => {
  it('is drawn before it is stored', () => {
    hold('col-1', 'arranges', ['b', 'a'], ['a', 'b']);

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toEqual(['b', 'a']);
    expect(boardOptimism.inFlight()).toBe(true);
  });

  it('is withdrawn when the write is refused', () => {
    hold('col-1', 'arranges', ['b', 'a'], ['a', 'b']);
    release('col-1', 'arranges');

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toBeUndefined();
    expect(boardOptimism.inFlight()).toBe(false);
  });

  it('survives a draw where the data has not caught up', () => {
    hold('col-1', 'arranges', ['b', 'a'], ['a', 'b']);

    // The board redraws the instant the entry is held — that is the whole point — and the rows it
    // draws from are still the old ones. Settling on "it was drawn" would release here.
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['a', 'b'] }));

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('is released once the data has moved', () => {
    hold('col-1', 'arranges', ['b', 'a'], ['a', 'b']);
    boardOptimism.settle(observedFrom({ 'col-1.arranges': ['b', 'a'] }));

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['b', 'a'])).toBeUndefined();
    expect(boardOptimism.inFlight()).toBe(false);
  });
});

describe('a card’s state, held as an arrangement of one', () => {
  it('reads as the new state while the write is in flight', () => {
    holdStatus('t1', 'doing', 'todo');

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
    holdStatus('t1', 'doing', 'todo');
    boardOptimism.settle(observedFrom({ 't1.status': ['todo'] }));

    expect(boardOptimism.overlay().status('t1', 'todo')).toBe('doing');
  });

  it('is released once the record actually reads as the new state', () => {
    holdStatus('t1', 'doing', 'todo');
    boardOptimism.settle(observedFrom({ 't1.status': ['doing'] }));

    expect(boardOptimism.overlay().status('t1', 'doing')).toBeUndefined();
  });

  it('is released when the record reads as something else entirely — a peer moved it', () => {
    holdStatus('t1', 'doing', 'todo');
    boardOptimism.settle(observedFrom({ 't1.status': ['blocked'] }));

    expect(boardOptimism.overlay().status('t1', 'blocked')).toBeUndefined();
  });

  it('is withdrawn when the write is refused', () => {
    holdStatus('t1', 'doing', 'todo');
    releaseStatus('t1');

    expect(boardOptimism.overlay().status('t1', 'todo')).toBeUndefined();
  });

  it('does not collide with an arrangement on the same record', () => {
    // Both live in one map keyed `<id>.<relation>`; a card that is also a container must keep them
    // apart, and `status` is a relation name nothing else uses.
    hold('t1', 'arranges', ['x'], ['y']);
    holdStatus('t1', 'doing', 'todo');

    expect(boardOptimism.overlay().order('t1', 'arranges', ['y'])).toEqual(['x']);
    expect(boardOptimism.overlay().status('t1', 'todo')).toBe('doing');
  });
});

describe('what a draw reports', () => {
  it('leaves alone an entry for a record it did not draw', () => {
    hold('col-1', 'arranges', ['b', 'a'], ['a', 'b']);

    // A column outside what was drawn says nothing about whether its write has landed.
    boardOptimism.settle(observedFrom({ 'col-2.arranges': ['q'] }));

    expect(boardOptimism.overlay().order('col-1', 'arranges', ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('settles several at once — a drop writes the target, the source and the state', () => {
    hold('col-1', 'arranges', ['a'], ['a', 'b']);
    hold('col-2', 'arranges', ['b', 'c'], ['c']);
    holdStatus('b', 'doing', 'todo');

    boardOptimism.settle(
      observedFrom({ 'col-1.arranges': ['a'], 'col-2.arranges': ['b', 'c'], 'b.status': ['doing'] }),
    );

    expect(boardOptimism.inFlight()).toBe(false);
  });
});
