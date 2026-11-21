import type { ModuleFunction } from '@we/module-shared';
import { newestWritten, type Written } from '@we/optimism';

/** One row of a tally: a choice, how many took it, and what share of the votes that is. */
export interface TallyRow {
  option: string;
  count: number;
  /** 0..1. Zero when nobody has voted, so a bar drawn from it is empty rather than undefined. */
  share: number;
  /** Whether this is the choice with the most votes. Several may lead. */
  leading: boolean;
  /** Whether this is the choice the reader voted for — their held vote, or their newest stored one. */
  mine: boolean;
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
  /** Every id that is the voter, this device first — the held vote stands in for a stored one by any. */
  authors: string[];
  option: string;
}

/**
 * Count votes per choice.
 *
 * Every declared choice gets a row, voted for or not, in the poll's own order — a chart with a bar
 * missing reads as a mistake rather than as zero. A vote for a choice the poll no longer offers is
 * counted under its own name at the end, since throwing it away would misreport the total.
 *
 * `me` is every id that is the reader (`me.dids`). One person votes from several device keys, and
 * where two of theirs stand — a change on one computer whose removal of the other's the space refused,
 * or two pressed at once and not yet cleaned up — only the newest counts (`newestWritten`), which is
 * also the one the store settles against and the row marked `mine`. Somebody else's two devices are
 * still counted per key: nothing here can join keys to persons, and the next change that is allowed
 * to remove the loser heals it.
 *
 * `pending` is this agent's vote written and not yet read back — the store holds it, and the count
 * is drawn with it in place of whatever the rows still say. Without it, pressing a choice left the
 * bars unmoved for a round trip and the press read as having failed: the vote is written and the
 * tally beside it is the only thing that could say so. Applied by REPLACING every stored vote of that
 * voter's, from any of their devices, rather than adding to one, since changing a vote must not count
 * twice.
 *
 * Pure and total, as every expression function must be: anything that is not a list of votes with an
 * `option` counts as no votes, and a `pending` that is not a vote is ignored.
 */
export function tally(args: { votes?: unknown; options?: unknown; pending?: unknown; me?: unknown }): TallyRow[] {
  const votes = Array.isArray(args?.votes) ? args.votes : [];
  const pending = args?.pending as PendingVote | null | undefined;
  const held =
    pending && typeof pending.option === 'string' && pending.option && Array.isArray(pending.authors) ? pending : null;
  const me: unknown[] = Array.isArray(args?.me)
    ? (args.me as unknown[])
    : typeof args?.me === 'string'
      ? [args.me]
      : [];
  const selves = new Set<unknown>([...me, ...(held?.authors ?? [])]);
  const declared = pollOptions(args?.options);
  const counts = new Map<string, number>(declared.map((option) => [option, 0]));
  const add = (option: string) => counts.set(option, (counts.get(option) ?? 0) + 1);
  const mine: (Written & { option: string })[] = [];
  for (const vote of votes) {
    const row = vote as { option?: unknown; author?: unknown; id?: unknown; createdAt?: unknown } | null;
    const option = row?.option;
    if (typeof option !== 'string' || !option) continue;
    if (selves.has(row?.author)) mine.push({ id: row?.id, createdAt: row?.createdAt, option });
    else add(option);
  }
  // The held vote stands in for every stored one of mine, whatever they say; without one, my newest.
  const counted = held?.option ?? newestWritten(mine)?.option;
  if (counted) add(counted);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const most = Math.max(0, ...counts.values());
  return [...counts.entries()].map(([option, count]) => ({
    option,
    count,
    share: total ? count / total : 0,
    leading: total > 0 && count === most,
    mine: option === counted,
  }));
}

/** The function as the module lends it to expressions — catalogued beside the host's own. */
export const tallyFunction: ModuleFunction = {
  name: 'tally',
  params: ['options'],
  doc: 'Votes counted per choice — { option, count, share, leading, mine }[] — one row per choice the poll offers, in its order, plus a row for any choice a vote names that the poll no longer does. Options: votes (a Vote query), options (the poll’s comma-separated choices), me (me.dids — the reader’s votes from any of their devices count once, as the newest, and that choice is the row marked mine), pending (modules.polls.pendingVote[<poll id>] — this agent’s vote written and not yet read back, counted in place of their stored ones so the bars move on the press).',
  example:
    'tally({ votes: local.votes, options: block.options, me: me.dids, pending: modules.polls.pendingVote[block.id] })',
  fn: tally,
};
