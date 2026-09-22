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

export function createPollsStore(deps: ModuleStoreDeps) {
  const { signal, state, action, selfId } = deps;
  const records = deps.kernels.records;

  /** The poll a vote is being written for, so its card can show the press landed. */
  const [voting, setVoting] = signal('');
  const [lastError, setLastError] = signal('');

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
    try {
      const mine = me ? await records.find('Vote', { where: { pollId, author: me }, limit: 1 }) : [];
      const existing = mine[0] as { id?: string; option?: string } | undefined;
      if (existing?.id) {
        if (existing.option !== option) await records.update('Vote', existing.id, { option });
      } else {
        await records.create('Vote', { pollId, option });
      }
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
