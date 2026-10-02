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
 * Plus one state no board shows, {@link ENTRY_STATE}, which every run starts in. A run starts the
 * first time anyone moves a task, and the task already has a state by then — whatever it was made
 * with, or whatever it was moved to before the space asked for agreement. So the first move of a run
 * is out of the entry state into the one the task is already in, with one vote from anybody, and
 * only then into the one somebody asked for. A task made straight into a column that asks for
 * approval starts in the first column that does not, and asks.
 *
 * What that entry costs is written down rather than hidden: a client that skipped this code could
 * start a run of a task nobody has moved and enter it straight into Done. That is no more than such
 * a client could already do by writing `status`, and it is the same limit the rest of a flow has —
 * the rules are data in the space, and a member with a modified client can rewrite them.
 *
 * ## Which state a surface shows
 *
 * The run's, where a task has one; `status` otherwise. `status` goes on being written — by whoever's
 * action moved the run — so every surface that reads it (a card's badge, the inspector, a model
 * reading the space) keeps working without knowing flows exist. The board reads the run, because the
 * board is where a move is asked for and where "not yet" has to be visible.
 */
import type { DatasetHandle, FlowDefinition, FlowPort, FlowSnapshot, OpenMove } from '@we/backend-shared';
import { openMoves, readProposeResult, runFor, trace, tracing } from '@we/backend-shared';

/** The flow's name in the dataset. One per space: the space's own task states. */
export const TASK_FLOW = 'TaskStates';

/**
 * Where every run starts — a state no board shows. A slug is lower-case letters, digits and hyphens,
 * so this cannot be one.
 */
export const ENTRY_STATE = '_entry';

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
    states: [
      { name: ENTRY_STATE, hint: 'Not yet moved since the community began asking for agreement.' },
      ...slugs.map((slug) => {
        const rule = bySlug.get(slug);
        const approvals = approvalsOf(rule);
        return {
          name: slug,
          ...(approvals > 1 ? { approvals } : {}),
          ...(rule?.approverKind
            ? {
                role: {
                  entity: 'Involvement',
                  agentField: 'agent',
                  where: { kind: rule.approverKind },
                  subjectField: 'node',
                },
              }
            : {}),
        };
      }),
    ],
    transitions: [
      ...slugs.map((to) => ({ from: ENTRY_STATE, to })),
      ...slugs.flatMap((from) => slugs.filter((to) => to !== from).map((to) => ({ from, to }))),
    ],
  };
}

// ─── Reading a snapshot ─────────────────────────────────────────────────────────

/** A space's flow as the board reads it: the runs, and the rules each state asks for. */
export interface TaskFlowView {
  snapshot: FlowSnapshot;
  rules: Record<string, { approvals: number; approverKind: string }>;
}

/** The state a task's run is in, or `undefined` where the board should read `status`. */
export function flowStateOf(view: TaskFlowView | null | undefined, taskId: string): string | undefined {
  if (!view) return undefined;
  const run = runFor(view.snapshot.runs, taskId);
  // Not derived here yet, or never moved out of the entry: the run knows nothing `status` does not.
  if (!run?.state || run.state === ENTRY_STATE) return undefined;
  return run.state;
}

/** The one move a task is waiting on — the earliest asked — or `undefined`. */
export function openMoveOf(view: TaskFlowView | null | undefined, taskId: string): OpenMove | undefined {
  if (!view) return undefined;
  const run = runFor(view.snapshot.runs, taskId);
  if (!run?.state) return undefined;
  return openMoves(view.snapshot, run).filter((move) => move.to !== ENTRY_STATE)[0];
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
 * Two answers beyond what a backend reports:
 *
 * - `already-there` — the backend refused because the run is already in the state asked for. The
 *   move is done as far as anyone can make it, and `status` should say so. It happens when the
 *   state a board shows is behind the backend's — a rule changed, and the backend re-judged the
 *   run without yet re-deriving what it shows.
 * - `slow` — the call did not answer in time. Not a failure: the backend usually carries on and
 *   the move lands, and the board catches up when it does.
 */
export type TaskMoveOutcome = ReturnType<typeof readProposeResult> | 'already-there' | 'slow' | null;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The state a refusal names the run as being in, when it was refused as unreachable. */
const refusedFrom = (error: unknown): string | undefined => /not reachable from `([^`]+)`/.exec(messageOf(error))?.[1];

/** The call outlived the caller's patience; the backend may well still be doing it. */
const timedOut = (error: unknown) => /timed out|timeout/i.test(messageOf(error));

export interface TaskFlowDeps {
  /** The space's dataset, when one is on screen. */
  dataset: () => DatasetHandle | undefined;
  port: () => FlowPort | undefined;
  /** The space's states, in its order. */
  states: () => readonly TaskStateRule[];
  /** The latest snapshot, for withdrawing — which needs to know which proposals carry the viewer's vote. */
  snapshot: () => FlowSnapshot | null;
  me: () => string | undefined;
}

export interface TaskFlowActions {
  /** Whether the space's states run as a flow at all. */
  enabled: () => boolean;
  /**
   * Ask for a task to move from the state it is in to another. Starts the task's run if it has
   * none, entering it into `from` first — see the module docblock.
   */
  move: (taskId: string, from: string, to: string) => Promise<TaskMoveOutcome>;
  /** Take back the viewer's vote on whatever move a task is waiting on. */
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

    try {
      const run = await port.start(dataset, TASK_FLOW, taskId);
      let state = run.state;
      /*
        A run that has never left the entry is entered into the state the task already holds, on one
        vote from anybody. An empty state is a run this device has not derived yet — synced in from a
        peer a moment ago — which may or may not be past the entry; asking for the entry move then is
        harmless either way, since a run past it refuses the move and names where it stands.
      */
      if (!state || state === ENTRY_STATE) {
        const into = known.has(from) ? from : entryFor(to);
        try {
          state = (await port.propose(dataset, run.id, into)).state;
        } catch (error) {
          const at = refusedFrom(error);
          if (!at) throw error;
          state = at;
        }
      }
      if (state === to) return 'moved';
      try {
        return readProposeResult(await port.propose(dataset, run.id, to));
      } catch (error) {
        // The run is already where it was asked to go; what this device showed was behind.
        if (refusedFrom(error) === to) return 'already-there';
        throw error;
      }
    } catch (error) {
      if (timedOut(error)) return 'slow';
      throw error;
    }
  }

  async function withdraw(taskId: string): Promise<number> {
    const port = deps.port();
    const dataset = deps.dataset();
    const snapshot = deps.snapshot();
    const me = deps.me();
    if (!port || !dataset || !snapshot || !me) return 0;
    const run = runFor(snapshot.runs, taskId);
    if (!run) return 0;
    let withdrawn = 0;
    // Every proposal of the open moves the viewer asked on — twins included — and none they did not.
    for (const open of openMoves(snapshot, run)) {
      for (const id of open.proposals) {
        const proposal = snapshot.proposals.find((p) => p.id === id);
        if (proposal?.voters.includes(me)) withdrawn += await port.withdraw(dataset, id);
      }
    }
    return withdrawn;
  }

  return { enabled, move, withdraw, entryFor };
}
