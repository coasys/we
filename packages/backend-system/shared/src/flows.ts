/**
 * Group decisions over a record's state — a state machine a group moves forward by voting.
 *
 * A **flow** is a definition: the states a record can be in, the moves between them, and for each
 * state how many distinct people must agree before a record may enter it, and who counts. A **run**
 * is one record going through a flow. A **proposal** is one person asking for one move on one run;
 * others agree by asking for the same move. When enough people who count have asked, the move
 * happens — for everyone, since each backend derives a run's state from the votes it holds rather
 * than from whoever wrote last.
 *
 * ## Facts here, readings above
 *
 * The port reports what a backend knows and nothing it would have to guess at: which proposal a call
 * opened or joined, whether it recorded a vote, which moves happened and who made each, where the run
 * stands, whether it is stuck. What a surface shows — "waiting for one more", "you already agreed" —
 * is a reading of those facts, and lives in the helpers at the bottom of this file, which any caller
 * can replace without the contract changing. A port that answered in the surface's words would have
 * to be widened every time a surface wanted a word it had not thought of.
 *
 * ## What a flow does not do
 *
 * It does not stop a write. A record's other properties stay as writable as ever, and a flow's own
 * rules are data in the dataset like anything else. What it gives is a state every reader derives the
 * same way from signed votes — so a move nobody agreed to is one nobody's screen shows.
 *
 * Grown as consumers appear: members this contract does not have yet (a portable proof that a run
 * finished, what a run produced) arrive as new optional members, which no implementation has to
 * change for.
 */
import type { DatasetHandle } from './dataSource';

/**
 * Who counts toward a state's approvals: the agents named by records of one entity.
 *
 * A role is ordinary data rather than a special kind of thing — "the people reviewing this task" is
 * whichever involvement records say so — so a community names its roles in its own vocabulary and a
 * flow refers to them by query.
 */
export interface FlowRole {
  /** The entity whose records name the eligible. */
  entity: string;
  /** The property on each record holding the eligible agent's id. */
  agentField: string;
  /** Conditions every counting record must meet — equality only. */
  where?: Record<string, string | number | boolean>;
  /**
   * The property on each record that must name the run's subject, when the role is about *this*
   * record rather than about the space — "reviewing this task", not "a reviewer somewhere".
   */
  subjectField?: string;
}

export interface FlowStateDefinition {
  /** Unique within the flow; letters, digits, `-` and `_`. */
  name: string;
  /** How many distinct agents who count must ask for a move before a run may enter this state. At least 1. */
  approvals?: number;
  /** Who counts. Absent, anybody does. */
  role?: FlowRole;
  /** One sentence on what being in this state means, for a model reasoning about the run. */
  hint?: string;
}

export interface FlowTransitionDefinition {
  from: string;
  to: string;
  /** What the move is called where a person is offered it. Derived when absent. */
  name?: string;
}

export interface FlowDefinition {
  /** The flow's identifier within a dataset; letters and digits. */
  name: string;
  /** The entities a run may be about. */
  subjects: string[];
  /**
   * In order. **Every run starts in the first**, whatever else is true of the record it is about —
   * so a flow over records that already have a state wants a first state standing for "not yet
   * entered", and a move out of it for each state a record might already be in.
   */
  states: FlowStateDefinition[];
  /** The only moves a proposal may ask for. */
  transitions: FlowTransitionDefinition[];
  /** One sentence on what the flow is about. */
  hint?: string;
}

/** One record going through a flow. */
export interface FlowRun {
  id: string;
  /** The record the run is about. */
  subject: string;
  /** Where the run stands, as this backend derives it. Empty when it has not been derived here yet. */
  state: string;
  /** Milliseconds since the epoch; what tells two runs of one subject apart — see {@link runFor}. */
  startedAt?: number;
}

/** One person asking for one move on one run, and everyone who has agreed with them. */
export interface FlowProposal {
  id: string;
  run: string;
  from: string;
  to: string;
  proposer: string;
  /** Everyone who has asked for this move on this proposal, the proposer first. Counted or not. */
  voters: string[];
  rationale?: string;
  proposedAt?: number;
  /** The move happened — this proposal is history, not a question still open. */
  settled: boolean;
}

/** A move that happened, and the agents whose votes made it. */
export interface FlowMove {
  from: string;
  to: string;
  voters: string[];
}

/** What one propose call did, and where the run stands after it. */
export interface FlowProposeResult {
  /** The proposal this call opened or joined — the one to withdraw from. */
  proposal: string;
  /** This call wrote the proposal, rather than joining one somebody else had opened for the same move. */
  opened: boolean;
  /** This call recorded a vote. False when the caller had already asked for this move. */
  voted: boolean;
  /** Moves that happened because of this call. Empty while the move is short of its approvals. */
  moves: FlowMove[];
  /** Where the run stands after the call. */
  state: string;
  /**
   * Two moves out of the run's state both have their approvals, and the backend will not pick one.
   * More votes cannot help; somebody has to withdraw.
   */
  stalled: boolean;
}

/** Every run of one flow in a dataset, and every proposal on them. */
export interface FlowSnapshot {
  runs: FlowRun[];
  proposals: FlowProposal[];
}

export interface FlowPort {
  /**
   * Make the dataset's copy of a flow say what this definition says. Idempotent, and diff-first:
   * installing an unchanged definition writes nothing.
   *
   * Replaces rather than merges. A rule left over from an earlier version beside the new one is not
   * a stricter rule, it is two rules — and a backend may refuse to move a run at all while it holds two.
   */
  install(dataset: DatasetHandle, definition: FlowDefinition): Promise<void>;
  /**
   * The run of a flow about a record, starting one when there is none.
   *
   * Two agents starting a run at the same moment both succeed, so a subject can have more than one;
   * every reader treats the same one as authoritative — see {@link runFor}.
   */
  start(dataset: DatasetHandle, flow: string, subject: string): Promise<FlowRun>;
  /**
   * Ask for a move — opening a proposal for it, or agreeing with the one already open.
   *
   * Rejects when the move is not one the run can make from where it stands, naming that state.
   */
  propose(dataset: DatasetHandle, run: string, to: string, rationale?: string): Promise<FlowProposeResult>;
  /**
   * Take back what the caller asked for on a proposal — its vote, or the whole proposal if it opened
   * it. Never touches anybody else's. Resolves with how much was withdrawn; rejects when the caller
   * had asked for nothing there.
   *
   * A withdrawal can move a run *back*: state is derived from the votes present, so taking away the
   * vote that completed a move undoes it.
   */
  withdraw(dataset: DatasetHandle, proposal: string): Promise<number>;
  /**
   * Every run of a flow and every proposal on them — once now, and again whenever that changes,
   * including when a peer's vote arrives. Resolves with a stop function once watching has begun.
   */
  watch(dataset: DatasetHandle, flow: string, onChange: (snapshot: FlowSnapshot) => void): Promise<() => void>;
}

// ─── Readings ──────────────────────────────────────────────────────────────────

/**
 * The run that speaks for a subject: the earliest started, then the lowest id.
 *
 * A subject can have two runs when two agents started one at once. Which one counts must not depend
 * on who is asking, so the choice is made on facts every reader holds the same.
 */
export function runFor(runs: readonly FlowRun[], subject: string): FlowRun | undefined {
  let best: FlowRun | undefined;
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

/** A move somebody has asked for and that has not happened. */
export interface OpenMove {
  to: string;
  /** Every proposal asking for it. Usually one; two when two agents opened one at the same moment. */
  proposals: string[];
  /** Everyone who has asked, across all of them, in the order they asked. Counted or not. */
  voters: string[];
  /** Who asked first. */
  proposer: string;
  proposedAt?: number;
}

/**
 * The moves still open on a run, one per target state.
 *
 * Only proposals out of the state the run is in: one asked for from a state the run has since left
 * is a question about a situation that no longer exists. Proposals asking for the same move are one
 * move — a backend counts approvals per move, not per proposal, so twins opened concurrently add up.
 */
export function openMoves(snapshot: FlowSnapshot, run: FlowRun): OpenMove[] {
  const byTarget = new Map<string, OpenMove>();
  const asked = snapshot.proposals
    .filter((p) => p.run === run.id && !p.settled && p.from === run.state && p.to !== run.state)
    .sort((a, b) => (a.proposedAt ?? 0) - (b.proposedAt ?? 0) || (a.id < b.id ? -1 : 1));
  for (const proposal of asked) {
    const move = byTarget.get(proposal.to);
    if (!move) {
      byTarget.set(proposal.to, {
        to: proposal.to,
        proposals: [proposal.id],
        voters: [...new Set(proposal.voters)],
        proposer: proposal.proposer,
        ...(proposal.proposedAt !== undefined ? { proposedAt: proposal.proposedAt } : {}),
      });
      continue;
    }
    move.proposals.push(proposal.id);
    for (const voter of proposal.voters) if (!move.voters.includes(voter)) move.voters.push(voter);
  }
  return [...byTarget.values()];
}

/**
 * What a propose call amounted to, in the four cases a surface tells apart.
 *
 * `stalled` is checked first: a stuck run is not waiting for anything, and saying it was would invite
 * votes that cannot help.
 */
export function readProposeResult(result: FlowProposeResult): 'moved' | 'waiting' | 'already-voted' | 'stalled' {
  if (result.stalled) return 'stalled';
  if (result.moves.length) return 'moved';
  return result.voted ? 'waiting' : 'already-voted';
}
