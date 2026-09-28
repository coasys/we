/**
 * Where a card sits among its siblings in a tree read "as arranged": a rank on each card's placement,
 * lowest first.
 *
 * Kept out of the store because it is arithmetic about an order, and because the one thing it must get right
 * — writing the order the reader chose, and no other — is easiest to be sure of with nothing else attached.
 */

/**
 * How far apart neighbouring ranks are left when a row is renumbered.
 *
 * Wide enough that seating a card between two of them is arithmetic rather than a renumbering, for more
 * insertions into one gap than anybody will make. When it does run out the row is renumbered, which is
 * correct and merely slower.
 */
export const RANK_STEP = 1024;

/**
 * Whether a stored value is a rank at all.
 *
 * Zero is not one. A placement's numeric fields read 0 as "never set", so the canvas seed drops it and the
 * tree sorts that card with the unranked ones — which means a 0 written as a rank would be a card the store
 * thinks is placed and the tree thinks is not.
 */
export function isRank(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

/**
 * The ranks to write so `card` sits at `index` among `row` — the card's siblings without it, left to right
 * **as the reader sees them**, each with its rank where it has one.
 *
 * One write where the row is already cleanly ranked: the card takes a rank between its two new neighbours,
 * or a step beyond the end it joins. Everywhere else the whole row is renumbered in the order given, card
 * included, which is the only way the order that persists can be the one on screen:
 *
 * - **A card nobody has ranked** sorts after every ranked one and then by when it was made, so a midpoint
 *   computed against it describes a place the tree does not put it. Renumbering ranks it where it is seen.
 * - **Ranks out of step with the order shown** — two cards on the same rank, or a rank written under an
 *   order that has since changed — would make a midpoint land somewhere else. Renumbering settles them.
 * - **A gap that has closed**, after enough drops into one place that no midpoint is left between two ranks.
 *
 * Returns only what has to change: the card always, and each sibling whose rank differs from the one it
 * needs.
 */
export function seatInRow(
  row: readonly { id: string; rank?: number }[],
  card: string,
  index: number,
): Map<string, number> {
  const at = Math.max(0, Math.min(index, row.length));
  const clean = row.every(
    (entry, position) => isRank(entry.rank) && (position === 0 || entry.rank! > row[position - 1].rank!),
  );
  if (clean) {
    const before = row[at - 1]?.rank;
    const after = row[at]?.rank;
    const rank =
      before !== undefined && after !== undefined
        ? (before + after) / 2
        : before !== undefined
          ? before + RANK_STEP
          : after !== undefined
            ? after - RANK_STEP
            : RANK_STEP;
    const fits = isRank(rank) && (before === undefined || rank > before) && (after === undefined || rank < after);
    if (fits) return new Map([[card, rank]]);
  }

  const writes = new Map<string, number>();
  const ranked = new Map(row.map((entry) => [entry.id, entry.rank]));
  const renumbered = [...row.slice(0, at).map((entry) => entry.id), card, ...row.slice(at).map((entry) => entry.id)];
  renumbered.forEach((id, position) => {
    const rank = (position + 1) * RANK_STEP;
    if (id === card || ranked.get(id) !== rank) writes.set(id, rank);
  });
  return writes;
}
