import type { ModuleFunction } from '@we/module-shared';

/** One row of a tally: a choice, how many took it, and what share of the votes that is. */
export interface TallyRow {
  option: string;
  count: number;
  /** 0..1. Zero when nobody has voted, so a bar drawn from it is empty rather than undefined. */
  share: number;
  /** Whether this is the choice with the most votes. Several may lead. */
  leading: boolean;
}

/** The choices a poll offers, from its comma-separated string or an already-split list. */
export function pollOptions(options: unknown): string[] {
  if (Array.isArray(options)) return options.map((o) => String(o).trim()).filter(Boolean);
  if (typeof options !== 'string') return [];
  return options
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * A vote written and not yet seen come back — this agent's own, held by the store.
 *
 * Carries its poll as well as its option because the registered `tally` reports back against it, and
 * a tally is handed one poll's votes with nothing on them saying which poll that is.
 */
export interface PendingVote {
  poll: string;
  author: string;
  option: string;
}

/**
 * Count votes per choice.
 *
 * Every declared choice gets a row, voted for or not, in the poll's own order — a chart with a bar
 * missing reads as a mistake rather than as zero. A vote for a choice the poll no longer offers is
 * counted under its own name at the end, since throwing it away would misreport the total.
 *
 * `pending` is this agent's vote written and not yet read back — the store holds it, and the count
 * is drawn with it in place of whatever the rows still say. Without it, pressing a choice left the
 * bars unmoved for a round trip and the press read as having failed: the vote is written and the
 * tally beside it is the only thing that could say so. Applied by REPLACING that author's row vote
 * rather than adding to it, since changing a vote must not count twice.
 *
 * Pure and total, as every expression function must be: anything that is not a list of votes with an
 * `option` counts as no votes, and a `pending` that is not a vote is ignored.
 */
export function tally(args: { votes?: unknown; options?: unknown; pending?: unknown }): TallyRow[] {
  const votes = Array.isArray(args?.votes) ? args.votes : [];
  const pending = args?.pending as PendingVote | null | undefined;
  const held =
    pending && typeof pending.option === 'string' && pending.option && typeof pending.author === 'string'
      ? pending
      : null;
  const declared = pollOptions(args?.options);
  const counts = new Map<string, number>(declared.map((option) => [option, 0]));
  for (const vote of votes) {
    const row = vote as { option?: unknown; author?: unknown } | null;
    // The held vote stands in for this author's stored one, whatever it says.
    if (held && row?.author === held.author) continue;
    const option = row?.option;
    if (typeof option !== 'string' || !option) continue;
    counts.set(option, (counts.get(option) ?? 0) + 1);
  }
  if (held) counts.set(held.option, (counts.get(held.option) ?? 0) + 1);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const most = Math.max(0, ...counts.values());
  return [...counts.entries()].map(([option, count]) => ({
    option,
    count,
    share: total ? count / total : 0,
    leading: total > 0 && count === most,
  }));
}

/** The function as the module lends it to expressions — catalogued beside the host's own. */
export const tallyFunction: ModuleFunction = {
  name: 'tally',
  params: ['options'],
  doc: 'Votes counted per choice — { option, count, share, leading }[] — one row per choice the poll offers, in its order, plus a row for any choice a vote names that the poll no longer does. Options: votes (a Vote query), options (the poll’s comma-separated choices), pending (modules.polls.pendingVote[<poll id>] — this agent’s vote written and not yet read back, counted in place of their stored one so the bars move on the press).',
  example: 'tally({ votes: local.votes, options: block.options, pending: modules.polls.pendingVote[block.id] })',
  fn: tally as (...args: never[]) => unknown,
};
