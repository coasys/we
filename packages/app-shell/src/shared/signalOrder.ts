/**
 * The order a record's reactions were settled into, held for as long as something is drawing them.
 *
 * ## Why this is not a `$localState` snapshot
 *
 * It was one. A display read the order by use as its `initial`, which is evaluated at mount and
 * never again, and that looked like exactly the right semantics: settle on arrival, hold while
 * somebody reads, re-sort when the panel is reopened.
 *
 * It did not work, and the reason is worth writing down. A reaction surface is drawn inside an
 * `$each` over a QUERY, and a subscription answers by handing the renderer a fresh array of fresh
 * objects. Solid's `<For>` keys by reference, so every one of those rows is a new row: the subtree
 * unmounts, mounts again, and takes its `initial` again. Writing a reaction re-runs the query that
 * feeds the row you wrote it on — so the snapshot was re-taken on precisely the events it existed
 * to be stable across, which is why the column still jumped, and why it jumped *late*: the jump was
 * the subscription landing, not the press.
 *
 * ## Why it is not held for the session either
 *
 * That was the next attempt, and it went too far the other way: an order settled once was kept
 * until the space changed, so selecting another card and coming back showed the first card's order
 * from minutes ago — a reaction the reader had since given sitting halfway down a list that claims
 * to be sorted by use. Stale in a way they can see is as wrong as moving under their cursor.
 *
 * So an order lives exactly as long as something is drawing it. The caller releases it when its
 * subtree goes away, and the release is **deferred by a tick**: a remount caused by a subscription
 * disposes the old row and renders the new one in the same batch, so the order is asked for again
 * before the release fires and survives. A record genuinely left behind is asked for by nobody, and
 * is forgotten.
 *
 * That the tick is injectable is not a testing convenience — it is the only way to assert the
 * difference between those two cases without a renderer.
 */

/** Everything settled, by record. */
const settled = new Map<string, string[]>();

/**
 * How many times each record has been asked about.
 *
 * A release compares this against what it was when the release was requested. Unchanged means
 * nobody wanted it in the meantime, which is what tells a record left behind from one whose row was
 * torn down and rebuilt around it.
 */
const touches = new Map<string, number>();

let schedule: (run: () => void) => void = queueMicrotask;

const touch = (record: string) => touches.set(record, (touches.get(record) ?? 0) + 1);

export const signalOrder = {
  /** The order settled for this record, or undefined where none is. */
  held: (record: string): string[] | undefined => {
    touch(record);
    return settled.get(record);
  },

  /** Note the order this record's reactions are being drawn in. */
  settle: (record: string, ids: string[]): void => {
    touch(record);
    settled.set(record, ids);
  },

  /**
   * Nothing is drawing this record any more — forget its order, unless that turns out to be untrue
   * by the end of the tick.
   */
  release: (record: string): void => {
    const asked = touches.get(record) ?? 0;
    schedule(() => {
      if ((touches.get(record) ?? 0) !== asked) return;
      settled.delete(record);
      touches.delete(record);
    });
  },

  /** Forget everything — the space being left, or a test starting. */
  reset: (): void => {
    settled.clear();
    touches.clear();
  },

  /** How many records are holding an order. For tests. */
  size: (): number => settled.size,

  /** Run deferred releases through this instead of a microtask. For tests. */
  scheduleWith: (run: (work: () => void) => void): void => {
    schedule = run;
  },
};
