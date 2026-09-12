/**
 * An arrangement that has been written and not yet seen come back.
 *
 * Dropping a card on a board writes a relation and then waits: the write goes to the executor, the
 * subscription re-runs, and only then does the column redraw. Measured on a real board that is about
 * a second, during which the card is drawn from the last result — which is to say back where it
 * started. It reads as the drop having failed and then silently succeeding.
 *
 * So the order somebody dragged into is held here and drawn immediately, and this is the record of
 * which columns are currently being drawn from something not yet stored.
 *
 * ## It is a promise about presentation, never a prediction of the merge
 *
 * An ordered relation on AD4M is an RGA: the executor diffs the written list against what it holds,
 * writes an entry only for what moved, and deliberately never regenerates an entry whose predecessor
 * is unchanged — which is what stops one person's save clobbering another's. So **what comes back is
 * a merge, and under concurrent drags it can be neither party's list.**
 *
 * An overlay that tried to be right about that would be re-implementing the executor's algorithm on
 * the client, would be wrong for any backend that merges differently, and would break the one thing
 * `boards.ts` is careful about — that nothing on this side indexes, renumbers, merges or breaks a
 * tie. So this shows what was asked for and defers completely to the next authoritative answer.
 *
 * ## Which is why settling compares against `before`, not against `ids`
 *
 * "Hold until the data equals what I wrote" is the obvious rule and it can hang forever, because
 * under a concurrent write the converged answer legitimately never equals it. What is wanted is
 * causality — *has an answer arrived that is later than my write* — and the value the relation held
 * when the write was issued answers that: the moment the observed order differs from `before`, the
 * data has moved, so the overlay has been superseded whether by this write or by somebody else's.
 *
 * A peer whose drag lands first therefore drops the overlay too, and the card moves to where the
 * merge put it. That is the right outcome and the honest one.
 */

/** One relation's intended order, and what it read as when that was written. */
export interface PendingOrder {
  /** The order to draw until the data catches up. */
  ids: string[];
  /**
   * What the relation read as when this was held — the thing "it has moved" is measured against.
   *
   * **Absent until the first draw, deliberately.** Knowing it at hold time means reading the record
   * first, and a read is a round trip — during which the card sits at its old position, undimmed,
   * because `we-sortable` restores it on drop and the consumer has not reordered anything yet. That
   * is the flash this exists to remove, wearing a smaller coat.
   *
   * So an entry goes up on the tick of the drop knowing only where the card should go, and the
   * baseline is taken from the data the very next draw is made from — which is the value a read
   * would have returned, arriving without anyone asking for it.
   *
   * An entry with no baseline yet is believed: a write issued moments ago cannot have been answered.
   */
  before?: string[];
  /** When it was issued, for the backstop below. */
  at: number;
}

/** Pending orders keyed `<recordId>.<relation>` — one record may have several arranged at once. */
export type PendingOrders = Record<string, PendingOrder>;

/**
 * How long an overlay may stand before it is disbelieved regardless.
 *
 * Nothing should reach it: a write either lands, and the next push moves the data, or it fails, and
 * the caller drops it explicitly. It exists because the failure it guards against is the worst
 * available — a card pinned to a position nothing agrees with, indefinitely, with no error anywhere —
 * and the cost of being wrong in the other direction is one late frame.
 */
export const PENDING_ORDER_TTL_MS = 10_000;

/**
 * Two orders, compared element by element.
 *
 * Not by joining them into strings: any separator can appear inside an id, and an AD4M id is a URI,
 * so a join is a comparison that is *almost* always right — the failure needing an id containing the
 * separator, which is the kind nobody reproduces.
 */
const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export const orderKey = (recordId: string, relation: string) => `${recordId}.${relation}`;

/** Note that this relation should be drawn in this order until the data moves. */
export function holdOrder(
  pending: PendingOrders,
  recordId: string,
  relation: string,
  ids: readonly string[],
  now = Date.now(),
): PendingOrders {
  return { ...pending, [orderKey(recordId, relation)]: { ids: [...ids], at: now } };
}

/** Stop drawing it — the write failed, or something else has superseded it. */
export function dropOrder(pending: PendingOrders, recordId: string, relation: string): PendingOrders {
  const key = orderKey(recordId, relation);
  if (!pending[key]) return pending;
  const next = { ...pending };
  delete next[key];
  return next;
}

/**
 * The order to draw this relation in: the pending one, or the observed one if it has moved on.
 *
 * The single place the rule lives, so a reader and whatever later drops the entry cannot disagree
 * about whether it still applies. `undefined` means "nothing pending here, draw what you were given".
 */
export function orderToDraw(
  pending: PendingOrders,
  recordId: string,
  relation: string,
  observed: readonly string[],
  now = Date.now(),
): string[] | undefined {
  const entry = pending[orderKey(recordId, relation)];
  if (!entry) return undefined;
  if (now - entry.at > PENDING_ORDER_TTL_MS) return undefined;
  // No baseline yet: this is the draw that sets one, and nothing can have answered a write issued
  // moments ago.
  if (!entry.before) return entry.ids;
  // The data has moved since the write was issued, so an answer later than it has arrived — by this
  // write or by somebody else's. Either way the overlay is spent.
  if (!sameOrder(observed, entry.before)) return undefined;
  return entry.ids;
}

/**
 * What the pending map should be, having seen what a draw was actually made from.
 *
 * Two jobs, and they are the same job at two ages. An entry with no baseline **takes** one: the data
 * this draw used is what the relation read as when the write went out, which is the value a read
 * would have returned had anyone paid for one. An entry that has a baseline is **compared** against
 * it, and is dropped the moment the data has moved — by this write, or by a peer's.
 *
 * Returns the same object when nothing changed, so a signal set from it does not re-render the world
 * on every push.
 *
 * Done here rather than in the reader because the reader is a pure function called inside a memo, and
 * the *drawing* is what proves an overlay is no longer needed — the reasoning `confirmPending`
 * records for the canvas, where clearing at the moment rows arrived put the old value back for the
 * rest of the seed and made one edit flash twice.
 */
export function reconcileOrders(
  pending: PendingOrders,
  observedBy: (recordId: string, relation: string) => readonly string[] | undefined,
  now = Date.now(),
): PendingOrders {
  let next = pending;
  const change = (key: string, entry: PendingOrder | null) => {
    if (next === pending) next = { ...pending };
    if (entry) next[key] = entry;
    else delete next[key];
  };

  for (const [key, entry] of Object.entries(pending)) {
    const split = key.lastIndexOf('.');
    const observed = observedBy(key.slice(0, split), key.slice(split + 1));

    if (now - entry.at > PENDING_ORDER_TTL_MS) {
      change(key, null);
      continue;
    }
    // Not drawn at all this pass says nothing — the record may simply not be in view, and a column
    // scrolled out of a filter is not a column whose write has landed.
    if (!observed) continue;
    if (!entry.before) {
      change(key, { ...entry, before: [...observed] });
      continue;
    }
    if (!sameOrder(observed, entry.before)) change(key, null);
  }
  return next;
}
