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
 *
 * "Mine" is the person, not the device. A vote my laptop cast is my vote here, so mine are read by
 * every id that is me (`selfIds`), and the one that counts is the newest of them (`newestWritten`) —
 * the same one `tally` counts and the card shows selected.
 */
import type { ModuleStoreDeps } from '@we/module-shared';
import { createOptimism, keepNewestAcrossDevices, newestWritten, sameValue } from '@we/optimism';
import { namespace } from '@we/schema-shared';

import type { PendingVote } from './functions';

/** A Vote row as the records kernel reads it back. */
interface StoredVote {
  id?: unknown;
  author?: unknown;
  createdAt?: unknown;
  option?: unknown;
}

export function createPollsStore(deps: ModuleStoreDeps) {
  const { signal, state, action } = deps;
  const records = deps.kernels.records;
  /** Every id that is me, this device first. Empty before login, which is a host with nobody to vote. */
  const selves = (): string[] => deps.selfIds();

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
   * One vote per person per poll is a *query*, not a constraint the backend enforces: the votes this
   * person already wrote are found by `author` across every id that is them, and the newest of those
   * is their vote. Pressing the choice that vote already says is a no-op rather than a withdrawal —
   * withdrawing is a different act, and a button that sometimes removes what it usually sets is the
   * kind that gets pressed twice.
   *
   * A change is a new vote, never an edit: which of my votes counts is the newest by `createdAt`, and an
   * edit keeps the old time, so a change here would lose to an older vote my laptop cast, and two
   * computers editing at once would each overwrite the other. So this device's vote is written first,
   * on its own, and then mine are read again and each that loses to it is removed
   * (`keepNewestAcrossDevices`) — or this one, if another of my computers voted later. Two devices
   * voting at once never remove the vote every reader counts — and where one is left over (a device
   * that had not yet seen the other's vote, or a removal the space refused), `tally` reads mine through
   * the same order, so it still counts me once and as the same vote everywhere.
   */
  async function vote(pollId: string, option: string): Promise<void> {
    if (!records || !pollId || !option) return;
    const mine = selves();
    setVoting(pollId);
    setLastError('');
    // Before the read, not after it: the point is that the choice is selected on the press rather
    // than on the round trip. Withdrawn below if the write turns out not to be possible.
    if (mine.length) votes.hold(pollId, option);
    try {
      const read = async () =>
        mine.length ? ((await records.find('Vote', { where: { pollId, author: mine } })) as StoredVote[]) : [];
      const current = newestWritten(await read());
      if (current?.option !== option) {
        const id = await records.create('Vote', { pollId, option });
        // Read again: a vote another of my computers cast meanwhile is judged too.
        // Named fields rather than a spread: a backend's row may carry them as getters on a class.
        const after = (await read()).map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          delete: () => records.remove('Vote', String(row.id)),
        }));
        // Not yet readable, there is nothing to judge it against: what stands is left for the next
        // change, and readers count my newest meanwhile.
        const written = after.find((row) => row.id === id);
        if (written)
          await keepNewestAcrossDevices(written, after, 'polls: could not remove your vote from another device');
      }
      // The write is back. Not a release — what retires a hold is the rows moving — but it ends the
      // hold's exemption from what the next draw says.
      if (mine.length) votes.done(pollId);
    } catch (error) {
      if (mine.length) votes.release(pollId);
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
    const mine = selves();
    if (!mine.length) return;
    // My vote is my newest from any of my computers — the one `tally` counts.
    const stored = newestWritten(
      (rows as StoredVote[]).filter((row) => typeof row?.author === 'string' && mine.includes(row.author)),
    );
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
     * every key. The same mechanism `modules.transcribe.interpretationFor` uses.
     *
     * Pass it to `tally` and read it for the selected choice; absent means the rows are the answer.
     */
    pendingVote: state(
      () =>
        namespace((pollId: string): PendingVote | undefined => {
          const mine = selves();
          const held = mine.length ? votes.toDraw(pollId, '') : undefined;
          return held === undefined || !mine.length ? undefined : { poll: pollId, authors: mine, option: held };
        }),
      'This agent’s vote on a poll, written and not yet read back — { authors, option }, or nothing. Keyed by poll id.',
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
