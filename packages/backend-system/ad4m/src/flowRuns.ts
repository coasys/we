/**
 * How AD4M's flow engine keeps a record's place in a flow, and how that is read back as the
 * contract's records, waiting moves and steps.
 *
 * The engine keeps a **run** per record (a `FlowInstance`), each replica derives the run's state from
 * the signed **proposals** and votes it holds, and a run begins in its flow's lowest state. None of
 * that is in the contract — a surface asks about a record and gets a record back — so it is gathered
 * here, as pure functions over what the adapter read, where it can be tested without an executor.
 */
import type { FlowItem, FlowStep, FlowWaitingMove } from '@we/backend-shared';

/**
 * The state every run WE installs begins in, before it is placed. Never shown: a record standing
 * here has no state the flow can speak for, and reads as `null`.
 *
 * It exists because a run can only begin in the flow's lowest state, while a record may well
 * predate the flow. Entering it from here into the state the record already holds keeps every
 * existing record where it is rather than restarting it in the first column.
 */
export const ENTRY_STATE = '_entry';

/** One record's run of a flow, as read. */
export interface Run {
  id: string;
  subject: string;
  /** As this replica derives it; empty when not derived here yet. */
  state: string;
  startedAt?: number;
}

/** One ask for one move on one run, and everyone who has agreed with it. */
export interface Proposal {
  id: string;
  run: string;
  from: string;
  to: string;
  proposer: string;
  /** Everyone who has asked for this move on this proposal, the proposer first. */
  voters: string[];
  rationale?: string;
  proposedAt?: number;
  /** The move happened — history, not a question still open. */
  settled: boolean;
  evidence: string[];
}

/**
 * The run that speaks for a subject: the earliest started, then the lowest id.
 *
 * A subject can have two runs when two agents started one at once. Which one counts must not depend
 * on who is asking, so the choice is made on facts every reader holds the same.
 */
export function runFor(runs: readonly Run[], subject: string): Run | undefined {
  let best: Run | undefined;
  for (const run of runs) {
    if (run.subject !== subject) continue;
    if (!best) {
      best = run;
      continue;
    }
    const a = run.startedAt ?? Number.POSITIVE_INFINITY;
    const b = best.startedAt ?? Number.POSITIVE_INFINITY;
    if (a < b || (a === b && run.id < best.id)) best = run;
  }
  return best;
}

/** A run's state as the contract says it: `null` where the engine has not placed or derived it here. */
export const stateOf = (run: Run): string | null => (run.state && run.state !== ENTRY_STATE ? run.state : null);

/** A move somebody has asked for that has not happened, and the proposals asking for it. */
export interface OpenMove extends FlowWaitingMove {
  proposals: string[];
}

const byAsked = (a: Proposal, b: Proposal) => (a.proposedAt ?? 0) - (b.proposedAt ?? 0) || (a.id < b.id ? -1 : 1);

/**
 * The moves still open on a run, one per target state.
 *
 * Only proposals out of the state the run is in: one asked for from a state the run has since left
 * is a question about a situation that no longer exists. Proposals asking for the same move are one
 * move — the engine counts approvals per move, not per proposal, so twins opened concurrently add up.
 */
export function openMoves(proposals: readonly Proposal[], run: Run): OpenMove[] {
  const byTarget = new Map<string, OpenMove>();
  const asked = proposals
    .filter((p) => p.run === run.id && !p.settled && p.from === run.state && p.to !== run.state)
    .sort(byAsked);
  for (const proposal of asked) {
    const move = byTarget.get(proposal.to);
    if (!move) {
      byTarget.set(proposal.to, {
        to: proposal.to,
        proposals: [proposal.id],
        voters: [...new Set(proposal.voters)],
        ...(proposal.proposedAt !== undefined ? { askedAt: proposal.proposedAt } : {}),
        ...(proposal.rationale ? { note: proposal.rationale } : {}),
      });
      continue;
    }
    move.proposals.push(proposal.id);
    for (const voter of proposal.voters) if (!move.voters.includes(voter)) move.voters.push(voter);
  }
  return [...byTarget.values()];
}

/**
 * A record as the contract reads it.
 *
 * `stalled` is inferred, because the engine reports contention only to whoever proposes into it: two
 * open moves out of the run's state that each already have as many asks as their state takes. Settled
 * moves leave the open list, so the only way two complete asks stay open is the engine declining to
 * choose. Where a state counts only some people the asks may include ones that do not count, so such
 * a state never contributes — a stall there shows on the next ask, which the engine refuses.
 */
export function itemOf(
  run: Run,
  proposals: readonly Proposal[],
  needs: (to: string) => { count: number; restricted: boolean },
): FlowItem {
  const open = openMoves(proposals, run);
  const complete = open.filter((move) => {
    const rule = needs(move.to);
    return !rule.restricted && move.voters.length >= rule.count;
  });
  return {
    subject: run.subject,
    state: stateOf(run),
    ...(run.startedAt !== undefined ? { since: run.startedAt } : {}),
    waiting: open.map(({ proposals: _proposals, ...move }) => move),
    stalled: complete.length > 1,
  };
}

/**
 * The moves a run made, oldest first. Twins that settled one move together are one step; entering
 * the run from {@link ENTRY_STATE} is not a step — it placed the record rather than moving it.
 */
export function stepsOf(proposals: readonly Proposal[], run: Run): FlowStep[] {
  const settled = proposals.filter((p) => p.run === run.id && p.settled && p.from !== ENTRY_STATE).sort(byAsked);
  const steps: FlowStep[] = [];
  for (const proposal of settled) {
    const last = steps.at(-1);
    if (last && last.from === proposal.from && last.to === proposal.to) {
      for (const voter of proposal.voters) if (!last.voters.includes(voter)) last.voters.push(voter);
      for (const id of proposal.evidence) if (!last.evidence.includes(id)) last.evidence.push(id);
      continue;
    }
    steps.push({
      from: proposal.from,
      to: proposal.to,
      voters: [...new Set(proposal.voters)],
      ...(proposal.proposedAt !== undefined ? { at: proposal.proposedAt } : {}),
      evidence: [...proposal.evidence],
      ...(proposal.rationale ? { note: proposal.rationale } : {}),
    });
  }
  return steps;
}
