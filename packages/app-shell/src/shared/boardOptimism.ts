/**
 * The board's arrangements that have been written and not yet seen come back.
 *
 * `@we/optimism` holds the rules; this holds the state, and is the one place the two halves of the
 * round trip meet — `boards.ts` puts an arrangement here the moment somebody drops a card, and
 * whatever draws the board reports back when the data has overtaken it.
 *
 * ## Why a module singleton rather than a member of `spaceStore`
 *
 * Every member of a store is public API a template can name, so adding one means classifying it in
 * `templateSurface.ts` and describing it in the generated context. This is neither template-facing
 * nor useful to one: it is wiring between a write and the read that supersedes it, and a template
 * that could read it would learn only which of its own drags had not landed yet. The same reasoning
 * `seedRegistry` and the query-IR flag were module singletons for — non-component code reads them,
 * and there is exactly one per running app.
 *
 * ## A card's state is held as an arrangement of one
 *
 * A drop into a bound column writes two things — the target column's order, and the card's own
 * `status` — and they come back on two different subscriptions. Both have to be stood in for or the
 * card is drawn in neither column while one has landed and the other has not.
 *
 * They are held in one map, under the relation `status`, rather than in a second one with rules of
 * its own. The settling question is identical — *has an answer later than my write arrived* — and so
 * is the answer. A second mechanism would be a second chance to get that subtly different, which is
 * precisely the bug this exists to avoid.
 *
 * ## `done` is why the ports grew a third member
 *
 * Rule 4: a hold is not judged against the data until the last write behind it has returned. Without
 * somebody saying so, a board that was dragged twice in a second could have the first drag's echo
 * read as "the data moved" while the second drag is what is on screen — the card jumps back to where
 * the first drag put it, then forward again. `boards.ts` reports every write that returns.
 */
import { createOptimism, keyOf, sameOrder } from '@we/optimism';
import { createSignal } from 'solid-js';

/** The relation a card's own state is held under — see the docblock. */
const STATUS = 'status';

const optimism = createOptimism<string[]>(createSignal, { same: sameOrder });

export const boardOptimism = {
  /** What `createBoardActions` is given: hold on the way out, release when a write is refused. */
  ports: {
    hold: (recordId: string, relation: string, ids: readonly string[]) =>
      optimism.hold(keyOf(recordId, relation), [...ids]),
    release: (recordId: string, relation: string) => optimism.release(keyOf(recordId, relation)),
    holdStatus: (recordId: string, status: string) => optimism.hold(keyOf(recordId, STATUS), [status]),
    releaseStatus: (recordId: string) => optimism.release(keyOf(recordId, STATUS)),
    /** A write returned. The hold stands — it is the *data* that retires one — but stops being exempt. */
    done: (recordId: string, relation: string) => optimism.done(keyOf(recordId, relation)),
    doneStatus: (recordId: string) => optimism.done(keyOf(recordId, STATUS)),
  },

  /**
   * The overlay, in the shape `arrangedBoard` takes.
   *
   * Reading the holds here is what makes the board redraw the instant a card is dropped: the
   * expression that calls `arrangedBoard` is a memo, and this read is one of its dependencies.
   *
   * Both lookups are given what the data actually says, because that is what decides whether the
   * overlay still applies — the caller cannot know, and asking it to remember would put the rule in
   * two places.
   */
  overlay: () => {
    optimism.holds(); // the dependency; `toDraw` reads it again per lookup
    return {
      order: (recordId: string, relation: string, observed: readonly string[]) =>
        optimism.toDraw(keyOf(recordId, relation), [...observed]),
      status: (recordId: string, observed: string | undefined) =>
        optimism.toDraw(keyOf(recordId, STATUS), [observed ?? ''])?.[0],
    };
  },

  /**
   * Report what the drawn board has caught up on, and forget it.
   *
   * Called by whoever just drew, with a way to look up what each record's relation actually read as
   * in the data it drew from. Deferred to a microtask by its caller, since this writes a signal and
   * a write during a render is a re-entrancy bug waiting to happen.
   */
  settle(observed: (recordId: string, relation: string) => readonly string[] | undefined): void {
    optimism.settle((key) => {
      const [recordId, relation] = key.split('\u0000');
      const seen = observed(recordId, relation);
      return seen ? [...seen] : undefined;
    });
  },

  /** Whether anything is currently drawn ahead of the data — for a caller that wants to say so. */
  inFlight: () => optimism.inFlight(),

  /**
   * Forget everything held, unconditionally.
   *
   * For a change of subject rather than a change of answer: the arrangements held here belong to the
   * board on screen, and standing in for one after moving to another space would draw a promise
   * about records nothing on screen is showing. `settle` cannot do this — it only ever releases an
   * entry the data has overtaken, and data that is no longer being drawn overtakes nothing.
   */
  reset: () => optimism.reset(),
};
