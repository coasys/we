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
 * Drop the patches these rows confirm.
 *
 * Two rules, both learned rather than assumed:
 *
 * - **Every field must match, not any.** A read that has caught up on a card's colour but not its
 *   size is still a read the optimistic size is needed for. Clearing on a partial match would put
 *   the old size back for however long the rest took.
 * - **Compare values; do not trust the write to have landed.** A read issued *before* a write can be
 *   answered after it, and the reverse — so "a read happened, therefore it is stored" is wrong in
 *   both directions. A row that carries the values is the only evidence that means anything, and it
 *   makes this immune to the ordering entirely.
 *
 * Returns the same object when nothing changed, so a signal set from it does not re-render the world
 * on every read.
 */
export function confirmPending(
  pending: PendingWrites,
  rows: readonly Record<string, unknown>[],
  idOf: (row: Record<string, unknown>) => string | undefined,
): PendingWrites {
  let next = pending;
  for (const row of rows) {
    const id = idOf(row);
    const patch = id ? pending[id] : undefined;
    if (!id || !patch) continue;
    if (!Object.entries(patch).every(([field, value]) => row[field] === value)) continue;
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
