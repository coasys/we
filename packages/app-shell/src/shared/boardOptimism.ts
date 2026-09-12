/**
 * The board's arrangements that have been written and not yet seen come back.
 *
 * `shapes/pendingOrder` holds the rules; this holds the state, and is the one place the two halves
 * of the round trip meet — `boards.ts` puts an arrangement here the moment somebody drops a card,
 * and whatever draws the board reports back when the data has overtaken it.
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
 * They are held in one map, under `<recordId>.status`, rather than in a second one with rules of its
 * own. The settling question is identical — *has an answer later than my write arrived* — and the
 * answer is identical: the value has moved from what it read when the write was issued. A second
 * mechanism would be a second chance to get that subtly different, which is precisely the bug this
 * exists to avoid.
 *
 * ## Nothing releases on success
 *
 * Only on failure. Releasing when the write *resolves* would put the card back for the rest of the
 * round trip — the flash again, with extra steps — because the promise settles before the
 * subscription carries the new order to the screen. What releases a successful one is the data
 * moving, which only whatever draws the board can observe; see {@link settle}.
 */
import { createSignal } from 'solid-js';

import { dropOrder, holdOrder, orderToDraw, type PendingOrders, reconcileOrders } from './shapes/pendingOrder';

/** The relation a card's own state is held under — see the docblock. */
const STATUS = 'status';

const [orders, setOrders] = createSignal<PendingOrders>({});

export const boardOptimism = {
  /** What `createBoardActions` is given: hold on the way out, release only when a write is refused. */
  ports: {
    hold: (recordId: string, relation: string, ids: readonly string[]) =>
      setOrders((held) => holdOrder(held, recordId, relation, ids)),
    release: (recordId: string, relation: string) => setOrders((held) => dropOrder(held, recordId, relation)),
    holdStatus: (recordId: string, status: string) => setOrders((held) => holdOrder(held, recordId, STATUS, [status])),
    releaseStatus: (recordId: string) => setOrders((held) => dropOrder(held, recordId, STATUS)),
  },

  /**
   * The overlay, in the shape `arrangedBoard` takes.
   *
   * Reading the signal here is what makes the board redraw the instant a card is dropped: the
   * expression that calls `arrangedBoard` is a memo, and this read is one of its dependencies.
   *
   * Both lookups are given what the data actually says, because that is what decides whether the
   * overlay still applies — the caller cannot know, and asking it to remember would put the rule in
   * two places.
   */
  overlay: () => {
    const held = orders();
    return {
      order: (recordId: string, relation: string, observed: readonly string[]) =>
        orderToDraw(held, recordId, relation, observed),
      status: (recordId: string, observed: string | undefined) =>
        orderToDraw(held, recordId, STATUS, [observed ?? ''])?.[0],
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
    setOrders((held) => reconcileOrders(held, observed));
  },

  /** Whether anything is currently drawn ahead of the data — for a caller that wants to say so. */
  inFlight: () => Object.keys(orders()).length > 0,

  /**
   * Forget everything held, unconditionally.
   *
   * For a change of subject rather than a change of answer: the arrangements held here belong to the
   * board on screen, and standing in for one after moving to another space would draw a promise
   * about records nothing on screen is showing. `settle` cannot do this — it only ever releases an
   * entry the data has overtaken, and data that is no longer being drawn overtakes nothing.
   */
  reset: () => setOrders({}),
};
