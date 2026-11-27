/**
 * What the polls store adds to a vote: which poll a vote is being written for, and saying so when it
 * fails.
 *
 * Everything else about a poll is data. Making one is `record.create`; listing them and their votes
 * is `$query`; counting is the `tally` function. Casting a vote is the write that depends on a read —
 * *find my vote, then change it or make one* — and that is the module's declared operation,
 * `polls.vote`, in its manifest. The host runs it as it runs every operation, so the vote is drawn in
 * the card's own `votes` query from the press, before it is stored; nothing here holds it.
 */
import type { ModuleStoreDeps } from '@we/module-shared';

export function createPollsStore(deps: ModuleStoreDeps) {
  const { signal, state, action } = deps;

  /** The poll a vote is being written for, so its card can show the press landed. */
  const [voting, setVoting] = signal('');
  const [lastError, setLastError] = signal('');

  /**
   * Cast, or change, this agent's vote on one poll — `polls.vote`.
   *
   * One vote per agent per poll is a *query*, not a constraint the backend enforces: the operation
   * finds every vote this agent wrote on the poll by `author`, keeps one and removes the rest.
   * Pressing the same choice again is a no-op rather than a withdrawal — withdrawing is a different
   * act, and a button that sometimes removes what it usually sets is the kind that gets pressed twice.
   */
  async function vote(pollId: string, option: string): Promise<void> {
    const operations = deps.operations;
    if (!operations || !pollId || !option) return;
    setVoting(pollId);
    setLastError('');
    try {
      await operations.run('polls.vote', { poll: pollId, option });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not record your vote.';
      setLastError(message);
      deps.notify?.('error', message);
    } finally {
      setVoting('');
    }
  }

  return {
    voting: state(voting, 'The id of the poll a vote is being written for, or empty.'),
    lastError: state(lastError, 'Why the last vote could not be recorded, or empty.'),
    vote: action(vote, 'Casts this agent’s vote on a poll, or changes it — one vote per person per poll.'),
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
