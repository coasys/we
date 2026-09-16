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
 * Count votes per choice.
 *
 * Every declared choice gets a row, voted for or not, in the poll's own order — a chart with a bar
 * missing reads as a mistake rather than as zero. A vote for a choice the poll no longer offers is
 * counted under its own name at the end, since throwing it away would misreport the total.
 *
 * Pure and total, as every expression function must be: anything that is not a list of votes with an
 * `option` counts as no votes.
 */
export function tally(args: { votes?: unknown; options?: unknown }): TallyRow[] {
  const votes = Array.isArray(args?.votes) ? args.votes : [];
  const declared = pollOptions(args?.options);
  const counts = new Map<string, number>(declared.map((option) => [option, 0]));
  for (const vote of votes) {
    const option = (vote as { option?: unknown } | null)?.option;
    if (typeof option !== 'string' || !option) continue;
    counts.set(option, (counts.get(option) ?? 0) + 1);
  }
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
  doc: 'Votes counted per choice — { option, count, share, leading }[] — one row per choice the poll offers, in its order, plus a row for any choice a vote names that the poll no longer does. Options: votes (a Vote query), options (the poll’s comma-separated choices).',
  example: 'tally({ votes: local.votes, options: block.options })',
  fn: tally as (...args: never[]) => unknown,
};
