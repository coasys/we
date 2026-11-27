/**
 * Where a card sits in a tree read "as arranged", and whether a drop would put it inside itself.
 * Data in, data out — no stores, no reactivity, no imports — so a second host can implement it
 * against the recorded vectors beside this file (`vectors/treeRanks.json`) or run it as is.
 *
 * The order among siblings is a rank on each card's placement, lowest first. The host reads the
 * spine and the placements, asks this what to write, and hands the answer to the declared operation
 * that writes it; nothing here reads or writes data.
 */

/**
 * How far apart neighbouring ranks are left when a row is renumbered.
 *
 * Wide enough that seating a card between two of them is arithmetic rather than a renumbering, for more
 * insertions into one gap than anybody will make. When it does run out the row is renumbered, which is
 * correct and merely slower.
 */
export const RANK_STEP = 1024;

/** One card's rank, as read or as to be written. */
export interface RankEntry {
  id: string;
  rank?: number;
}

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
 * Answers only what has to change, in row order: the card always, and each sibling whose rank differs
 * from the one it needs.
 */
export function seatInRow(row: readonly RankEntry[], card: string, index: number): { id: string; rank: number }[] {
  const at = Math.max(0, Math.min(index, row.length));
  const clean = row.every(
    (entry, position) => isRank(entry.rank) && (position === 0 || entry.rank > row[position - 1].rank!),
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
    if (fits) return [{ id: card, rank }];
  }

  const writes: { id: string; rank: number }[] = [];
  const ranked = new Map(row.map((entry) => [entry.id, entry.rank]));
  const renumbered = [...row.slice(0, at).map((entry) => entry.id), card, ...row.slice(at).map((entry) => entry.id)];
  renumbered.forEach((id, position) => {
    const rank = (position + 1) * RANK_STEP;
    if (id === card || ranked.get(id) !== rank) writes.push({ id, rank });
  });
  return writes;
}

/** What a drop into a tree says about where the card lands among its new siblings. */
export interface RowInput {
  /** The card being dropped. */
  card: string;
  /** The parent's children through the spine, the card left out. */
  siblings: readonly string[];
  /** Each card's rank where its placement holds one, by id. */
  ranks: Readonly<Record<string, number>>;
  /** The row as the reader saw the card land in it, when the drop says. */
  order?: readonly string[];
  /** The card the drop was aimed at. */
  target?: string;
  /** `child` drops onto a parent; `sibling` beside a card. */
  into: 'child' | 'sibling';
  /** For a sibling drop, whether the card goes before the target rather than after it. */
  before?: boolean;
}

/**
 * The row and the index to seat a card at, from a drop.
 *
 * The row as the drop reported it when it did — only the parent's real children kept, and any it did not
 * mention after, in rank order — because the tree orders unranked cards by when they were made, which the
 * host cannot know; a row ordered here instead would write some other order than the one on screen. With
 * no order said, a drop ON a parent goes last and one BESIDE a sibling goes on the side it named.
 *
 * Rank order is ranked cards lowest first, then unranked ones, ties by id in code-point order (so every
 * host breaks them the same way, whatever its locale).
 */
export function rowFor(input: RowInput): { row: RankEntry[]; index: number } {
  const { card, siblings, ranks } = input;
  const rankOf = (id: string) => (Object.prototype.hasOwnProperty.call(ranks, id) ? ranks[id] : undefined);
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byRank = (a: string, b: string) => {
    const [one, two] = [rankOf(a), rankOf(b)];
    if (one !== undefined && two !== undefined) return one - two || byId(a, b);
    return one !== undefined ? -1 : two !== undefined ? 1 : byId(a, b);
  };
  const shown = input.order?.filter((id) => id === card || siblings.includes(id));
  let ids: string[];
  let index: number;
  if (shown?.includes(card)) {
    const seen = shown.filter((id) => id !== card);
    ids = [...seen, ...siblings.filter((id) => !seen.includes(id)).sort(byRank)];
    index = shown.indexOf(card);
  } else {
    ids = [...siblings].sort(byRank);
    const beside = input.target ? ids.indexOf(input.target) : -1;
    index = input.into === 'child' || beside < 0 ? ids.length : beside + (input.before ? 0 : 1);
  }
  const row = ids.map((id) => {
    const rank = rankOf(id);
    return rank === undefined ? { id } : { id, rank };
  });
  return { row, index };
}

/**
 * Whether `candidate` is `card` itself or somewhere under it, walking up `parentOf` (child id → parent
 * id). The walk stops at a loop: the spine is shared, last-write-wins data, so a cycle is a state a
 * space can be in, and a walk without the check would never end.
 */
export function isUnder(candidate: string, card: string, parentOf: Readonly<Record<string, string>>): boolean {
  const seen = new Set<string>();
  let at: string | undefined = candidate;
  while (at && !seen.has(at)) {
    if (at === card) return true;
    seen.add(at);
    at = Object.prototype.hasOwnProperty.call(parentOf, at) ? parentOf[at] : undefined;
  }
  return false;
}
