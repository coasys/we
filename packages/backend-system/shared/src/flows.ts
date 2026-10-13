/**
 * Rules over a record's state, and moves made under them.
 *
 * A **flow** is a definition: the states a record can be in, the moves allowed between them, and what
 * each state requires before a record may enter it — a number of people agreeing, or something being
 * present. A record **moves** when somebody asks for a move and what the state requires is met.
 *
 * ## The domain here, the mechanism in the adapter
 *
 * The contract speaks about records, rules and moves, and nothing about how a backend enforces them.
 * A backend with a server checks a rule inside a transaction. A peer-to-peer backend has each replica
 * derive a record's state from the signed votes it holds, which means runs, proposals, an entry state
 * and a state not yet derived here. All of that stays inside its adapter. A surface sees the same
 * answers either way: a move happened, it is waiting for agreement, it was refused and why, or the
 * record is stuck.
 *
 * Where backends genuinely differ — which kinds of requirement they can enforce, whether a move's
 * evidence is sealed, what happens when two moves are agreed at once — the backend says so in
 * {@link FlowCapabilities}, and a surface reads that rather than guessing.
 *
 * ## Facts here, readings above
 *
 * The port reports what a backend knows: where a record stands, which moves are waiting and who asked,
 * which moves happened and who made them. What a surface shows — "one more approval", "you already
 * agreed", which columns a card may enter — is a reading of those facts, and lives in the helpers at the
 * bottom of this file, which any caller can replace without the contract changing.
 *
 * ## What a flow does not do
 *
 * It does not stop a write. A record's other properties stay as writable as ever. How strongly a rule
 * holds against a member who wants around it is the backend's to say — see
 * {@link FlowCapabilities.enforcement}.
 */
import type { DatasetHandle } from './dataSource';

// ─── Definitions ───────────────────────────────────────────────────────────────

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
   * The property on each record that must name the record being moved, when the role is about *this*
   * record rather than about the space — "reviewing this task", not "a reviewer somewhere".
   */
  subjectField?: string;
}

/**
 * How a guard's records are tied to the record being moved.
 *
 * - `{ relation }` — the record holds them through one of its own relations, named as its entity names
 *   it: `responses` for what was made in response to it (a comment, a document answering a task),
 *   `children` for a collection's parts.
 * - `{ field }` — each names the record in a property of its own, the way an involvement names the task
 *   it is about.
 *
 * Absent, a guard counts matching records anywhere in the dataset.
 */
export type FlowTie = { relation: string } | { field: string };

/** Distinct agents who count must ask for the move. */
export interface FlowApprovals {
  kind: 'approvals';
  /** At least 1. */
  count: number;
  /** Who counts. Absent, anybody does. */
  from?: FlowRole;
}

/**
 * Records matching a query must exist — "a document attached", "a comment from a reviewer". The records
 * that satisfied it when a move was asked for are that move's evidence.
 */
export interface FlowGuard {
  kind: 'guard';
  /** The entity whose records count. */
  entity: string;
  /** Conditions every counting record must meet — equality only. */
  where?: Record<string, string | number | boolean>;
  /** At least this many must match. Default 1. */
  min?: number;
  /** At most this many may match. */
  max?: number;
  tie?: FlowTie;
}

/** One thing a state requires before a record may enter it. */
export type FlowRequirement = FlowApprovals | FlowGuard;

/** The kinds of requirement there are — what {@link FlowCapabilities.requirements} lists. */
export type FlowRequirementKind = FlowRequirement['kind'];

export interface FlowStateDefinition {
  /** Unique within the flow; letters, digits, `-` and `_`, not starting with `_`. */
  name: string;
  /**
   * Everything entering this state requires; all of it must hold. At most one `approvals`. Absent or
   * empty, one ask from anybody moves a record in.
   */
  requires?: FlowRequirement[];
  /** One sentence on what being in this state means, for a model reasoning about the record. */
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
  /** The entities a record moved through this flow may be. Empty means any record. */
  subjects: string[];
  /**
   * In order. A record the flow has not seen starts in the first, unless whoever moves it says where it
   * already stands — see {@link FlowMoveOptions.from}.
   */
  states: FlowStateDefinition[];
  /**
   * The only moves anybody may ask for. A state with no move out of it is final. A set: the order
   * means nothing, and a backend may answer with them in any order.
   */
  transitions: FlowTransitionDefinition[];
  /** One sentence on what the flow is about. */
  hint?: string;
}

/** A flow as a list shows it. */
export interface FlowSummary {
  name: string;
  /**
   * The definition can be read back exactly as {@link FlowDefinition} says it. False for a flow written
   * by something that uses more than this contract can hold — saving it from here would drop the rest.
   */
  editable: boolean;
  /** How many records are going through it. */
  records: number;
}

// ─── Records going through a flow ──────────────────────────────────────────────

/** A move somebody has asked for that has not happened. */
export interface FlowWaitingMove {
  to: string;
  /** Everyone who has asked for it, the first asker first. Counted toward its approvals or not. */
  voters: string[];
  /** Milliseconds since the epoch, when first asked. */
  askedAt?: number;
  /** What the first asker said about it. */
  note?: string;
}

/** One record going through a flow. */
export interface FlowItem {
  /** The record. */
  subject: string;
  /**
   * Where it stands. `null` when this backend cannot say yet — a peer-to-peer backend that has not
   * derived it here, or a record the flow has not placed — and a reader falls back to what the record
   * itself says.
   */
  state: string | null;
  /** Milliseconds since the epoch, when the record entered the flow. */
  since?: number;
  /** Moves asked for out of where it stands. */
  waiting: FlowWaitingMove[];
  /** Two moves out of where it stands are both agreed and the backend will not choose: somebody has to withdraw. */
  stalled: boolean;
}

/** Every record going through one flow. */
export interface FlowView {
  flow: string;
  items: FlowItem[];
}

/** A move that happened. */
export interface FlowStep {
  from: string;
  to: string;
  /** The agents whose asks made it. */
  voters: string[];
  /** Milliseconds since the epoch, when first asked. */
  at?: number;
  /** Ids of the records that met the state's guards when it was asked for. */
  evidence: string[];
  note?: string;
}

/** What one move call came to. */
export type FlowMoveResult =
  /** The record moved — or was already where it was asked to go, in which case `steps` is empty. */
  | { outcome: 'moved'; state: string; steps: FlowStep[] }
  /** Recorded and short of what the state requires. `voted` is false when the caller had already asked. */
  | { outcome: 'waiting'; state: string | null; to: string; voted: boolean; voters: string[] }
  /**
   * Nothing written. `not-allowed`: no move from where the record stands to there. `unmet`: the state's
   * guards do not hold yet.
   */
  | { outcome: 'refused'; reason: 'not-allowed' | 'unmet'; state: string | null }
  /** The record is stuck — see {@link FlowItem.stalled}. More asks cannot help. */
  | { outcome: 'stalled'; state: string | null }
  /** Asked, and the backend has not answered in time. Not a failure: what happened arrives through {@link FlowPort.watch}. */
  | { outcome: 'pending' };

export interface FlowMoveOptions {
  /**
   * Where the caller believes the record already stands. Used only when the flow has no place for it
   * yet: a record that existed before the flow did enters at `from` rather than restarting in the first
   * state. Ignored when it names no state of the flow.
   */
  from?: string;
  /** What the caller says about the move. */
  note?: string;
}

// ─── What a backend can do ─────────────────────────────────────────────────────

export interface FlowCapabilities {
  /** The kinds of requirement this backend enforces. A definition using another is refused on install. */
  requirements: FlowRequirementKind[];
  /**
   * How a rule holds. `server`: one authority applies it and nobody gets round it. `peers`: every
   * member's software applies it to what it holds — a member running other software can write past it,
   * and nobody else's screen shows the result.
   */
  enforcement: 'server' | 'peers';
  /** A move's evidence is sealed: a later edit to it does not change what the move was agreed on. */
  sealedEvidence: boolean;
  /**
   * Two moves out of one state both agreed. `stall`: the backend picks neither and the record is
   * stuck until somebody withdraws. `first`: the earlier one wins.
   */
  contention: 'stall' | 'first';
}

// ─── The port ──────────────────────────────────────────────────────────────────

export interface FlowPort {
  readonly capabilities: FlowCapabilities;

  /**
   * Make the dataset's copy of a flow say what this definition says. Idempotent, and diff-first:
   * installing an unchanged definition writes nothing. Rejects a definition {@link validateFlowDefinition}
   * finds fault with.
   *
   * Replaces rather than merges. A rule left over from an earlier version beside the new one is not
   * a stricter rule, it is two rules.
   */
  install(dataset: DatasetHandle, definition: FlowDefinition): Promise<void>;
  /** Every flow in the dataset. */
  list(dataset: DatasetHandle): Promise<FlowSummary[]>;
  /** One flow's definition, or `null` when there is none by that name. */
  read(dataset: DatasetHandle, flow: string): Promise<FlowDefinition | null>;
  /**
   * Take a flow out of the dataset. Rejects while any record is going through it: those records would
   * be left where they stand with nothing to move them, and a flow made later under the same name could
   * pick them up again.
   */
  remove(dataset: DatasetHandle, flow: string): Promise<void>;

  /**
   * Put a record into a flow, at `at` or the first state. Resolves with where it stands — which, for a
   * record already in the flow, is wherever that is.
   */
  start(dataset: DatasetHandle, flow: string, subject: string, opts?: { at?: string }): Promise<FlowItem>;
  /**
   * Ask for a record to move — the same call whether the caller is first to ask or agreeing with
   * somebody who did. A record not yet in the flow enters it first (see {@link FlowMoveOptions.from}).
   */
  move(
    dataset: DatasetHandle,
    flow: string,
    subject: string,
    to: string,
    opts?: FlowMoveOptions,
  ): Promise<FlowMoveResult>;
  /**
   * Take back what the caller asked for on a record's waiting moves. Never touches anybody else's ask,
   * nor a move that has happened. Resolves with how many asks were withdrawn.
   */
  withdraw(dataset: DatasetHandle, flow: string, subject: string): Promise<number>;

  /**
   * Every record going through a flow — once now, and again whenever that changes, including when a
   * peer's ask arrives. Resolves with a stop function once watching has begun.
   */
  watch(dataset: DatasetHandle, flow: string, onChange: (view: FlowView) => void): Promise<() => void>;
  /** The moves a record has made in a flow, oldest first. */
  history(dataset: DatasetHandle, flow: string, subject: string): Promise<FlowStep[]>;
}

// ─── Checking a definition ─────────────────────────────────────────────────────

const STATE_NAME = /^[A-Za-z0-9-][A-Za-z0-9_-]*$/;
const FLOW_NAME = /^[A-Za-z0-9]+$/;

/**
 * What is wrong with a definition, as sentences — empty when nothing is. Checked against what a backend
 * can enforce when given its capabilities.
 *
 * The editor and both adapters call this, so a definition the editor accepts is one every backend
 * installs, and a mistake is described once.
 */
export function validateFlowDefinition(definition: FlowDefinition, capabilities?: FlowCapabilities): string[] {
  const problems: string[] = [];
  if (!FLOW_NAME.test(definition.name))
    problems.push(`"${definition.name}" is not a flow name: letters and digits only.`);
  if (!definition.states.length) problems.push('A flow needs at least one state.');
  const names = new Set<string>();
  for (const state of definition.states) {
    if (!STATE_NAME.test(state.name)) {
      problems.push(`"${state.name}" is not a state name: letters, digits, "-" and "_", not starting with "_".`);
    }
    if (names.has(state.name)) problems.push(`Two states are called "${state.name}".`);
    names.add(state.name);
    const requires = state.requires ?? [];
    if (requires.filter((r) => r.kind === 'approvals').length > 1) {
      problems.push(`"${state.name}" asks for approvals twice; one rule says how many and from whom.`);
    }
    for (const requirement of requires) {
      if (capabilities && !capabilities.requirements.includes(requirement.kind)) {
        problems.push(`"${state.name}" requires ${requirement.kind}, which this backend cannot enforce.`);
      }
      if (requirement.kind === 'approvals' && !(Number.isInteger(requirement.count) && requirement.count >= 1)) {
        problems.push(
          `"${state.name}" asks for ${requirement.count} approvals; it must be a whole number, at least 1.`,
        );
      }
      if (requirement.kind === 'guard') {
        const min = requirement.min ?? 1;
        if (!(Number.isInteger(min) && min >= 0))
          problems.push(`"${state.name}" has a guard with a minimum of ${min}.`);
        if (requirement.max !== undefined && requirement.max < min) {
          problems.push(`"${state.name}" has a guard whose maximum is below its minimum.`);
        }
        if (!requirement.entity) problems.push(`"${state.name}" has a guard that names no kind of record.`);
        const tie = requirement.tie;
        if (tie && !('relation' in tie ? tie.relation : tie.field)) {
          problems.push(`"${state.name}" has a guard tied to the record by nothing.`);
        }
      }
    }
  }
  const moves = new Set<string>();
  for (const transition of definition.transitions) {
    for (const end of [transition.from, transition.to]) {
      if (!names.has(end)) problems.push(`A move names "${end}", which is not a state of this flow.`);
    }
    if (transition.from === transition.to) problems.push(`A move from "${transition.from}" to itself goes nowhere.`);
    const key = `${transition.from}\u0000${transition.to}`;
    if (moves.has(key)) problems.push(`The move from "${transition.from}" to "${transition.to}" is listed twice.`);
    moves.add(key);
  }
  return problems;
}

// ─── Readings ──────────────────────────────────────────────────────────────────

/** The states a record standing at `state` may be asked into. A record with no known state may enter the first. */
export function allowedMoves(definition: FlowDefinition, state: string | null): string[] {
  if (state === null) return definition.states[0] ? [definition.states[0].name] : [];
  return definition.transitions.filter((t) => t.from === state).map((t) => t.to);
}

/** A state no move leaves. */
export function isFinalState(definition: FlowDefinition, state: string): boolean {
  return !definition.transitions.some((t) => t.from === state);
}

/** How many approvals entering a state takes, and from whom. One from anybody when it says nothing. */
export function approvalsFor(state: FlowStateDefinition | undefined): { count: number; from?: FlowRole } {
  const rule = state?.requires?.find((r): r is FlowApprovals => r.kind === 'approvals');
  return rule
    ? { count: Math.max(1, Math.floor(rule.count)), ...(rule.from ? { from: rule.from } : {}) }
    : { count: 1 };
}

/** The guards entering a state takes. */
export function guardsFor(state: FlowStateDefinition | undefined): FlowGuard[] {
  return (state?.requires ?? []).filter((r): r is FlowGuard => r.kind === 'guard');
}

/** Whether entering a state takes more than one ask from anybody — agreement, or something present. */
export function asksForMore(state: FlowStateDefinition | undefined): boolean {
  const approvals = approvalsFor(state);
  return approvals.count > 1 || Boolean(approvals.from) || guardsFor(state).length > 0;
}

/** A record's item in a view, or `undefined` when it is not going through the flow. */
export function itemFor(view: FlowView | null | undefined, subject: string): FlowItem | undefined {
  return view?.items.find((item) => item.subject === subject);
}
