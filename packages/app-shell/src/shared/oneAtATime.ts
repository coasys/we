/**
 * One write at a time, per key.
 *
 * ## The shape of the bug this exists for
 *
 * A write that is **read-then-write** is only correct if nothing else is writing the same thing
 * meanwhile. `upsertSignal` is exactly that shape — find this agent's reaction of this type, delete
 * it, create the new one — and nothing serialised it. Two calls for the same pair therefore both
 * read *before* either wrote: both found the same record, both deleted it, and both created one.
 * The result is two reactions by one person on one type, which every count then believes, and which
 * no later change repairs because `findOne` only ever reaches the first of them.
 *
 * It surfaced as a slider in the reactions modal showing the same person twice with the same value,
 * and the first theory — that the control committed twice for one drag — was wrong: a real drag,
 * driven in a real browser by the layout harness, commits exactly once. The double call came from
 * somewhere else, and the lesson is that it does not matter where. A read-then-write is racy against
 * *any* second caller, including a rerender, a repeated press, and a future surface nobody has
 * written yet. Fixing the caller fixes one of those.
 *
 * ## Per key, not globally
 *
 * A global queue would make reacting to one post wait on a reaction to another, which is a
 * throughput cost for no correctness gain: the invariant is about one pair. Keys are the caller's
 * to choose and should name the thing being guarded (`<record>|<type>`), never the action.
 *
 * ## It orders, it does not deduplicate
 *
 * Two presses are two answers and both run — the second simply reads what the first left. Anything
 * that wants "only the last one counts" is a different tool (a debounce), and conflating the two
 * would silently drop a write somebody made.
 */
export interface Queue {
  /** Run `work` after everything already queued under `key`, and answer with its result. */
  (key: string, work: () => Promise<unknown>): Promise<unknown>;
}

export function oneAtATime(): <T>(key: string, work: () => Promise<T>) => Promise<T> {
  /*
    The tail of each key's chain — what a new call waits on, not what is currently running.

    Holding the tail rather than a "busy" flag is what makes three rapid calls run in the order they
    were made instead of two of them racing once the first finishes.
  */
  const tails = new Map<string, Promise<unknown>>();

  return function queue<T>(key: string, work: () => Promise<T>): Promise<T> {
    /*
      `.then(…, …)` rather than `.catch()`: a failed write must not take the queue with it. The next
      caller's job is unrelated to why the last one was refused, and a key whose chain is a rejected
      promise would reject every call made after it, forever.
    */
    const previous = tails.get(key) ?? Promise.resolve();
    const mine = previous.then(
      () => work(),
      () => work(),
    );

    /*
      The chain is the SETTLED tail, so a rejection here is handled and never reaches the runtime as
      an unhandled rejection. `mine` itself is returned unswallowed, so the caller still sees the
      failure and can say so.
    */
    const settled = mine.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, settled);

    // Forget the key once its chain has drained, so a long-lived queue over many records does not
    // grow a permanent entry per record ever reacted to. Only when nothing newer has arrived.
    void settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key);
    });

    return mine;
  };
}
