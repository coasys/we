/**
 * Optimistic writes, and the rule for when to stop believing them.
 *
 * A board's presentational gestures — resize a card, colour it, change its shape — are answered by a
 * record, and the answer comes back through a subscription and a re-read. That is a round trip at
 * best, and a re-seed of the whole board after it. A slider that lags that far behind the finger
 * reads as broken rather than as slow, so the change is drawn immediately and the pending map is
 * what says which cards are currently being drawn from something not yet stored.
 *
 * Pure, and separate from the store, because the interesting part is a comparison and comparisons
 * are what get subtly wrong: see {@link confirmPending} for the two rules that matter.
 */

/** Field patches waiting to be seen in a read, keyed by the id of the record they were written to. */
export type PendingWrites = Record<string, Record<string, unknown>>;

/**
 * Forget these records' patches.
 *
 * Who decides *when* is the part that was wrong first. Confirming where the data was **read** looks
 * right and is half a second early — a read lands, then the rest of the seed runs, and only then do
 * the drawn things carry the new value; clearing on the read put the old value back for the whole of
 * that window, so an edit flashed to its new size, snapped back, and arrived again. The caller that
 * can see the *drawn* result is the one that knows, so this takes ids and asks nothing.
 *
 * Returns the same object when nothing changed, so a signal set from it does not re-render the world
 * every time something is drawn.
 */
export function dropAllPending(pending: PendingWrites, ids: readonly string[]): PendingWrites {
  let next = pending;
  for (const id of ids) {
    if (!pending[id]) continue;
    if (next === pending) next = { ...pending };
    delete next[id];
  }
  return next;
}

/** Merge a patch into whatever is already in flight for that record. */
export function holdPending(pending: PendingWrites, id: string, patch: Record<string, unknown>): PendingWrites {
  return { ...pending, [id]: { ...pending[id], ...patch } };
}

/** Forget a record's patch — the write failed, or a read has confirmed it. */
export function dropPending(pending: PendingWrites, id: string): PendingWrites {
  if (!pending[id]) return pending;
  const next = { ...pending };
  delete next[id];
  return next;
}
