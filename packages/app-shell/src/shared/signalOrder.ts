/**
 * The order a record's reactions were first drawn in, held for as long as the app is open.
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
 * Nothing a template can declare survives that, because the thing that does not survive is the
 * template's own state. So the order lives here, beside the optimism holds, keyed by record.
 *
 * ## Holding it means the order can go stale, and that is the point
 *
 * A record whose order was settled an hour ago keeps it, even as reactions arrive and overtake each
 * other. That is the bargain: an order that reflects the latest counts is an order that moves under
 * somebody's cursor, and a reaction they have just withdrawn sliding down the column is worse than
 * a leaderboard being a few minutes out of date. Types the settled order has never seen are
 * appended by use, so nothing new is ever hidden.
 *
 * It is dropped when the space changes, with the optimism holds and for the same reason — a promise
 * about records on the screen being left — and it is capped, so a long session spent scrolling a
 * feed does not accumulate an entry per record ever drawn.
 */

/**
 * How many records keep their order.
 *
 * Generous enough that everything on one screen, and everything scrolled past recently, is covered,
 * and small enough that it is a rounding error in memory. The oldest goes first: a record nobody
 * has looked at for five hundred other records is one whose order nobody is watching.
 */
const LIMIT = 500;

const settled = new Map<string, string[]>();

export const signalOrder = {
  /** The order settled for this record, or undefined where none is. */
  held: (record: string): string[] | undefined => {
    const order = settled.get(record);
    // Re-inserted so it counts as recently used: a Map iterates in insertion order, which is what
    // makes the eviction below reach for the least recently drawn rather than the oldest.
    if (order) {
      settled.delete(record);
      settled.set(record, order);
    }
    return order;
  },

  /** Note the order this record's reactions are being drawn in. */
  settle: (record: string, ids: string[]): void => {
    settled.delete(record);
    settled.set(record, ids);
    while (settled.size > LIMIT) {
      const oldest = settled.keys().next().value;
      if (oldest === undefined) break;
      settled.delete(oldest);
    }
  },

  /** Forget everything — the space being left, or a test starting. */
  reset: (): void => settled.clear(),

  /** How many records are holding an order. For tests, and for judging the cap. */
  size: (): number => settled.size,
};
