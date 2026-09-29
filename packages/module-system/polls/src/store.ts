/**
 * What the polls store does that a template could not: cast a vote that replaces this agent's last.
 *
 * Everything else about a poll is data. Making one is `record.create`; listing them and their votes
 * is `$query`; counting is the `tally` function. The one thing that needs code is the write that
 * depends on a read — *find my vote, then change it or make one* — because `record.create` from a
 * button would add a second vote every time somebody changed their mind, and a schema has no way to
 * say "the one I already wrote".
 *
 * That read is why this module asks for the `records` kernel rather than only writing through the
 * template's `record.create`: the read half is what a module observing records had no way to do.
 */
import type { ModuleStoreDeps } from '@we/module-shared';
import { createOptimism, sameValue } from '@we/optimism';
import { namespace } from '@we/schema-shared';

import type { PendingVote } from './functions';

export function createPollsStore(deps: ModuleStoreDeps) {
  const { signal, state, action, selfId } = deps;
  const records = deps.kernels.records;

  /** The poll a vote is being written for, so its card can show the press landed. */
  const [voting, setVoting] = signal('');
  const [lastError, setLastError] = signal('');

  /*
    The vote drawn before it has been seen come back, keyed by poll.

    `voting` was the whole of this: a spinner saying something is happening, which is what a card can
    show without a hold. It is the wrong answer to "did my press register" — the person pressed a
    choice, and the thing that says it registered is that choice being selected and the bars moving.
    A second of unmoved bars under a spinner reads as the press having failed.

    `@we/optimism` rather than a flag of this module's own: the rules for when to stop believing a
    held value are five, subtle, and were got wrong three times in the host before they were
    unified. The signal is `deps.signal`, so this module still imports no framework.
  */
  const votes = createOptimism<string>(signal, { same: sameValue });

  /**
   * Cast, or change, this agent's vote on one poll.
   *
   * One vote per agent per poll is a *query*, not a constraint the backend enforces: the vote this
   * agent already wrote is found by `author`, which every record carries, and updated in place.
   * Pressing the same choice again is a no-op rather than a withdrawal — withdrawing is a different
   * act, and a button that sometimes removes what it usually sets is the kind that gets pressed twice.
   */
  async function vote(pollId: string, option: string): Promise<void> {
    if (!records || !pollId || !option) return;
    const me = selfId?.() ?? null;
    setVoting(pollId);
    setLastError('');
    // Before the read, not after it: the point is that the choice is selected on the press rather
    // than on the round trip. Withdrawn below if the write turns out not to be possible.
    if (me) votes.hold(pollId, option);
    try {
      const mine = me ? await records.find('Vote', { where: { pollId, author: me }, limit: 1 }) : [];
      const existing = mine[0] as { id?: string; option?: string } | undefined;
      if (existing?.id) {
        if (existing.option !== option) await records.update('Vote', existing.id, { option });
      } else {
        await records.create('Vote', { pollId, option });
      }
      // The write is back. Not a release — what retires a hold is the rows moving — but it ends the
      // hold's exemption from what the next draw says.
      if (me) votes.done(pollId);
    } catch (error) {
      if (me) votes.release(pollId);
      const message = error instanceof Error ? error.message : 'Could not record your vote.';
      setLastError(message);
      deps.notify?.('error', message);
    } finally {
      setVoting('');
    }
  }

  /**
   * What the rows a card drew say about the vote held for that poll, reported back.
   *
   * Called from the registered `tally`, which is the only thing that sees both at once — the store
   * cannot read a template's `$queries`. Deferred to a microtask by its caller, since this writes a
   * signal and a write during a render is a re-entrancy bug waiting to happen.
   *
   * **A card with no rows reports nothing.** A poll nobody has voted on yet holds an empty list, and
   * read as data that says the held vote is absent — so it would be released and the choice would
   * un-select for the rest of the round trip, which is the flash this exists to remove. The same
   * rule `involvementOptimism.settleFromRows` records.
   */
  function settleFromRows(pollId: string, rows: unknown): void {
    if (!pollId || !Array.isArray(rows) || !rows.length) return;
    const me = selfId?.() ?? null;
    if (!me) return;
    const stored = (rows as { author?: unknown; option?: unknown }[]).find((row) => row.author === me);
    const option = typeof stored?.option === 'string' ? stored.option : '';
    votes.settle((key) => (key === pollId ? option : undefined));
  }

  return {
    settleFromRows,
    voting: state(voting, 'The id of the poll a vote is being written for, or empty.'),
    lastError: state(lastError, 'Why the last vote could not be recorded, or empty.'),
    vote: action(vote, 'Casts this agent’s vote on a poll, or changes it — one vote per person per poll.'),
    /**
     * This agent's vote on one poll, written and not yet read back — `modules.polls.pendingVote[<id>]`.
     *
     * A `namespace` rather than an object: poll ids are not enumerable from here, and the evaluator
     * guards property reads with `property in base`, which a Proxy over an empty target fails for
     * every key. The same mechanism `modules.transcribe.extractionFor` uses.
     *
     * Pass it to `tally` and read it for the selected choice; absent means the rows are the answer.
     */
    pendingVote: state(
      () =>
        namespace((pollId: string): PendingVote | undefined => {
          const me = selfId?.() ?? null;
          const held = me ? votes.toDraw(pollId, '') : undefined;
          return held === undefined || !me ? undefined : { poll: pollId, author: me, option: held };
        }),
      'This agent’s vote on a poll, written and not yet read back — { author, option }, or nothing. Keyed by poll id.',
    ),
    /**
     * Whether a poll shows its counts before this agent has voted — the module's one setting,
     * resolved for wherever the agent is. Read here rather than in the card so the card asks a
     * question of the store and never of a level.
     */
    revealBeforeVoting: state(
      () => deps.settings?.().revealBeforeVoting !== false,
      'Whether a poll shows its counts before this agent has voted — the community’s setting here.',
    ),
  };
}
