/**
 * A space's task states as a flow — the state of a task decided by agreement rather than by
 * whoever dragged it last.
 *
 * ## When a space has one
 *
 * Only when it asks for one. A task state can ask for approvals — "nothing is Done until two of us
 * say so" — or name whose approval counts ("…and one of them is reviewing it"). A space where no
 * state asks for anything has no flow, and a drop writes `TaskBlock.status` exactly as it always
 * has. The first state that asks turns the space's states into a flow; that is the whole switch,
 * so there is no second setting that could disagree with the first.
 *
 * ## The shape of the flow
 *
 * Every state can be reached from every other, because that is what a board allows — a card goes
 * back to Doing as easily as forward to Done. A flow where every state leads somewhere has no dead
 * end, which matters twice over: a backend treats a state with no way out as the end of a run and
 * asks more of a move into it, and a choice between two moves never forecloses the other.
 *
 * A task the flow has not seen yet — one that existed before the space asked for agreement, or was
 * moved before it did — enters the flow where its `status` already says it is, rather than restarting
 * in the first column: every move passes the task's current state as `from`. How a backend honours
 * that is its own business. A task made straight into a column that asks for agreement starts in the
 * first column that does not, and asks.
 *
 * What that costs is written down rather than hidden: a client that passed a false `from` could enter
 * a task straight into Done, where that state asks for nothing more than any other entry. That is no
 * more than such a client could already do by writing `status`, and how far any rule holds against a
 * member running other software is the backend's to say (`FlowCapabilities.enforcement`).
 *
 * ## Which state a surface shows
 *
 * The flow's, where it can say; `status` otherwise. `status` goes on being written — by whoever's
 * action moved the run — so every surface that reads it (a card's badge, the inspector, a model
 * reading the space) keeps working without knowing flows exist. The board reads the run, because the
 * board is where a move is asked for and where "not yet" has to be visible.
 */
import type {
  DatasetHandle,
  FlowDefinition,
  FlowMoveResult,
  FlowPort,
  FlowStateDefinition,
  FlowView,
  FlowWaitingMove,
} from '@we/backend-shared';
import { itemFor, trace, tracing } from '@we/backend-shared';

import { involvementRole } from './flowViews';

/** The flow's name in the dataset. One per space: the space's own task states. */
export const TASK_FLOW = 'TaskStates';

/** How many approvals a state may ask for. Past this a number is a typo, not a policy. */
export const MAX_APPROVALS = 20;

/** What the flow needs to know about one task state. */
export interface TaskStateRule {
  slug: string;
  approvals?: number;
  /** The slug of the InvolvementType whose holders' approval counts; empty for anybody's. */
  approverKind?: string;
}

/** A state's approvals, normalised: a whole number from 1 to {@link MAX_APPROVALS}. */
export function approvalsOf(state: TaskStateRule | undefined): number {
  const n = Math.floor(Number(state?.approvals ?? 1));
  return Number.isFinite(n) ? Math.min(MAX_APPROVALS, Math.max(1, n)) : 1;
}

/** Whether a drop into this state waits for agreement rather than moving the card. */
export function needsAgreement(state: TaskStateRule | undefined): boolean {
  return approvalsOf(state) > 1 || Boolean(state?.approverKind);
}

/**
 * The space's task states as a flow, or `null` when no state asks for agreement.
 *
 * Deterministic in the order and content of what it is given, because two members installing the
 * same states must install the same definition — see the flow port's note on rival rules.
 */
export function compileTaskFlow(states: readonly TaskStateRule[]): FlowDefinition | null {
  const slugs = [...new Set(states.map((s) => s.slug).filter(Boolean))];
  if (!slugs.length || !states.some(needsAgreement)) return null;
  const bySlug = new Map(states.map((s) => [s.slug, s]));
  return {
    name: TASK_FLOW,
    subjects: ['TaskBlock'],
    hint: "Where a task stands in this community's work.",
    states: slugs.map((slug): FlowStateDefinition => {
      const rule = bySlug.get(slug);
      const count = approvalsOf(rule);
      if (count === 1 && !rule?.approverKind) return { name: slug };
      return {
        name: slug,
        requires: [
          {
            kind: 'approvals',
            count,
            ...(rule?.approverKind ? { from: involvementRole(rule.approverKind) } : {}),
          },
        ],
      };
    }),
    transitions: slugs.flatMap((from) => slugs.filter((to) => to !== from).map((to) => ({ from, to }))),
  };
}

// ─── Reading a view ─────────────────────────────────────────────────────────────

/** A space's flow as the board reads it: where each task stands, and the rules each state asks for. */
export interface TaskFlowView {
  view: FlowView;
  rules: Record<string, { approvals: number; approverKind: string }>;
}

/** The state the flow has a task in, or `undefined` where the board should read `status`. */
export function flowStateOf(view: TaskFlowView | null | undefined, taskId: string): string | undefined {
  // Not in the flow, or the backend cannot say yet: the flow knows nothing `status` does not.
  return itemFor(view?.view, taskId)?.state ?? undefined;
}

/** The one move a task is waiting on — the earliest asked — or `undefined`. */
export function openMoveOf(view: TaskFlowView | null | undefined, taskId: string): FlowWaitingMove | undefined {
  return itemFor(view?.view, taskId)?.waiting[0];
}

/** What a card shows about the move it is waiting on. */
export interface TaskMoveCard {
  /** The state asked for. */
  to: string;
  /** Everyone who asked, the first asker first. */
  voters: string[];
  /** Of those, how many count toward the state's approvals. */
  counted: number;
  /** How many the state asks for. */
  needs: number;
  /** The viewer has asked for it. */
  mine: boolean;
  /** The viewer's approval would count, and they have not given it. */
  canApprove: boolean;
  /** The kind whose holders' approval counts, or empty for anybody's. */
  approverKind: string;
}

/**
 * A task's waiting move, read for a card.
 *
 * Whether an approval counts is judged here against who holds the kind *now*, while the backend
 * judges each vote as of when it was cast — so for a moment after somebody is taken off a task the
 * count on the card can differ from the backend's. Where the card sits is always the backend's
 * answer; this only says how close a move is.
 */
export function taskMoveCard(
  view: TaskFlowView | null | undefined,
  taskId: string,
  holders: (kind: string) => readonly string[],
  me: string | null | undefined,
): TaskMoveCard | undefined {
  const move = openMoveOf(view, taskId);
  if (!move || !view) return undefined;
  const rule = view.rules[move.to] ?? { approvals: 1, approverKind: '' };
  const eligible = rule.approverKind ? new Set(holders(rule.approverKind)) : null;
  const counts = (did: string) => !eligible || eligible.has(did);
  const mine = Boolean(me && move.voters.includes(me));
  return {
    to: move.to,
    voters: move.voters,
    counted: move.voters.filter(counts).length,
    needs: rule.approvals,
    mine,
    canApprove: Boolean(me && !mine && counts(me)),
    approverKind: rule.approverKind,
  };
}

// ─── Acting ─────────────────────────────────────────────────────────────────────

/**
 * What asking for a move came to. `null` when the space has no flow and the caller should write
 * `status`.
 *
 * - `moved` — it happened. `already-there` — the task was already where it was asked to go: done as
 *   far as anyone can make it, and `status` should say so. It happens when what a board shows is
 *   behind the backend.
 * - `waiting` — recorded, short of agreement. `already-voted` — the caller had asked already.
 * - `not-allowed`, `unmet` — refused: no move from where it stands to there, or what the state asks
 *   to be present is not.
 * - `stalled` — stuck between two agreed moves; somebody has to withdraw.
 * - `slow` — the backend had not answered in time. Not a failure: it usually carries on, and the board
 *   catches up when it does.
 */
export type TaskMoveOutcome =
  'moved' | 'already-there' | 'waiting' | 'already-voted' | 'not-allowed' | 'unmet' | 'stalled' | 'slow' | null;

/** A move's result in the board's words. */
export function readMoveResult(result: FlowMoveResult): Exclude<TaskMoveOutcome, null> {
  switch (result.outcome) {
    case 'moved':
      return result.steps.length ? 'moved' : 'already-there';
    case 'waiting':
      return result.voted ? 'waiting' : 'already-voted';
    case 'refused':
      return result.reason;
    case 'stalled':
      return 'stalled';
    case 'pending':
      return 'slow';
  }
}

export interface TaskFlowDeps {
  /** The space's dataset, when one is on screen. */
  dataset: () => DatasetHandle | undefined;
  port: () => FlowPort | undefined;
  /** The space's states, in its order. */
  states: () => readonly TaskStateRule[];
}

export interface TaskFlowActions {
  /** Whether the space's states run as a flow at all. */
  enabled: () => boolean;
  /**
   * Ask for a task to move from the state it is in to another. A task the flow has not seen enters it
   * at `from` — see the module docblock.
   */
  move: (taskId: string, from: string, to: string) => Promise<TaskMoveOutcome>;
  /** Take back the viewer's ask on whatever move a task is waiting on. */
  withdraw: (taskId: string) => Promise<number>;
  /** The state a task made into a column that asks for agreement starts in instead. */
  entryFor: (to: string) => string;
}

export function createTaskFlowActions(deps: TaskFlowDeps): TaskFlowActions {
  const enabled = () => Boolean(deps.port() && compileTaskFlow(deps.states()));

  function entryFor(to: string): string {
    const states = deps.states();
    return (states.find((s) => !needsAgreement(s)) ?? states.find((s) => s.slug !== to) ?? states[0])?.slug ?? to;
  }

  /**
   * The whole of a move, timed under the `flows` trace scope — set beside the adapter's per-call
   * timings, the difference is what WE spends around the backend rather than in it.
   */
  async function move(taskId: string, from: string, to: string): Promise<TaskMoveOutcome> {
    if (!tracing()) return moveOnce(taskId, from, to);
    const started = performance.now();
    const outcome = await moveOnce(taskId, from, to).catch((error: unknown) => {
      trace('flows', 'move:error', { taskId, to, ms: Math.round(performance.now() - started) });
      throw error;
    });
    trace('flows', 'move', { taskId, to, outcome, ms: Math.round(performance.now() - started) });
    return outcome;
  }

  async function moveOnce(taskId: string, from: string, to: string): Promise<TaskMoveOutcome> {
    const port = deps.port();
    const dataset = deps.dataset();
    if (!port || !dataset || !enabled()) return null;
    const known = new Set(deps.states().map((s) => s.slug));
    if (!known.has(to)) throw new Error(`"${to}" is not one of this space's states`);
    const result = await port.move(dataset, TASK_FLOW, taskId, to, { from: known.has(from) ? from : entryFor(to) });
    return readMoveResult(result);
  }

  async function withdraw(taskId: string): Promise<number> {
    const port = deps.port();
    const dataset = deps.dataset();
    if (!port || !dataset) return 0;
    return port.withdraw(dataset, TASK_FLOW, taskId);
  }

  return { enabled, move, withdraw, entryFor };
}
