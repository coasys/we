/**
 * A card's score for one reaction, as its badge draws it — the weight the canvas seed read, with this
 * agent's own answer in place while it is on its way.
 *
 * The seed hands on the score, how many people gave it, how it was read (`count`, `sum`, `mean`,
 * `median`) and what the reader gave — not the rows. That is enough to move the score the instant
 * somebody presses, which is the whole of what a press-and-see mark owes them: the write comes back
 * through a subscription about a second later, and a mark that sat unchanged until then reads as a press
 * that did nothing. The one aggregate it cannot move exactly is a median, which depends on everybody's
 * values; there the reader's own mark changes at once and the score catches up when the data does.
 */

export type ReactionAggregate = 'count' | 'sum' | 'mean' | 'median';

/** What the seed said about one card's reactions of one type. */
export interface Weighed {
  /** The score; absent where nobody has voted or rated. */
  weight?: number;
  /** How many people's reactions it was read from. */
  count: number;
  /** What the reader gave, absent when they gave nothing. */
  mine?: number;
  aggregate: ReactionAggregate;
  /** Somebody who answered counts for less than a whole voice — the reader has turned them down. */
  adjusted?: boolean;
}

/** The weighing a card carries for this reaction type, or null when it carries none for it. */
export function readWeighed(data: Record<string, unknown> | undefined, type: string): Weighed | null {
  if (!data || !type || data.weightType !== type) return null;
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const aggregate = data.weightAggregate;
  return {
    ...(number(data.weight) === undefined ? {} : { weight: number(data.weight) }),
    count: number(data.weightCount) ?? 0,
    ...(number(data.weightMine) === undefined ? {} : { mine: number(data.weightMine) }),
    aggregate: aggregate === 'sum' || aggregate === 'mean' || aggregate === 'median' ? aggregate : 'count',
    ...(data.weightAdjusted === true ? { adjusted: true } : {}),
  };
}

/**
 * The score and the reader's own answer with a held answer in place — `undefined` when nothing is held,
 * `null` for a withdrawal. The reader's stored answer is taken out and the held one put in, so changing
 * a rating does not count twice and withdrawing one does not leave it behind.
 */
export function withHeld(weighed: Weighed, held: number | null | undefined): { score?: number; mine?: number } {
  if (held === undefined) {
    return {
      ...(weighed.weight === undefined ? {} : { score: weighed.weight }),
      ...(weighed.mine === undefined ? {} : { mine: weighed.mine }),
    };
  }
  const mine = held === null ? undefined : held;
  const had = weighed.mine !== undefined;
  const count = weighed.count - (had ? 1 : 0) + (mine === undefined ? 0 : 1);
  const withMine = mine === undefined ? {} : { mine };

  switch (weighed.aggregate) {
    case 'count':
      return { score: count, ...withMine };
    case 'sum':
      return { score: (weighed.weight ?? 0) - (weighed.mine ?? 0) + (mine ?? 0), ...withMine };
    case 'mean': {
      if (!count) return withMine;
      const total = (weighed.weight ?? 0) * weighed.count - (weighed.mine ?? 0) + (mine ?? 0);
      return { score: total / count, ...withMine };
    }
    default:
      // A median moves with everybody's values; the reader's mark changes now and the score follows the data.
      return { ...(weighed.weight === undefined ? {} : { score: weighed.weight }), ...withMine };
  }
}

/** A score as a badge prints it: whole for a count or a net vote, to one decimal for an average. */
export function roundScore(score: number, aggregate: ReactionAggregate): number {
  return aggregate === 'count' || aggregate === 'sum' ? Math.round(score) : Math.round(score * 10) / 10;
}
