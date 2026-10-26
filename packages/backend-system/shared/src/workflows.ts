/**
 * Rules over a record's state, and moves made under them.
 *
 * A **workflow** is a definition: the states a record can be in, the moves allowed between them, and
 * what each state requires before a record may enter it — a number of people agreeing, or something
 * being present. A record **moves** when somebody asks for a move and what the state requires is met.
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
 * {@link WorkflowCapabilities}, and a surface reads that rather than guessing.
 *
 * ## Facts here, readings above
 *
 * The port reports what a backend knows: where a record stands, which moves are waiting and who asked,
 * which moves happened and who made them. What a surface shows — "one more approval", "you already
 * agreed", which columns a card may enter — is a reading of those facts, and lives in the helpers at the
 * bottom of this file, which any caller can replace without the contract changing.
 *
 * ## What a workflow does not do
 *
 * It does not stop a write. A record's other properties stay as writable as ever. How strongly a rule
 * holds against a member who wants around it is the backend's to say — see
 * {@link WorkflowCapabilities.enforcement}.
 */
import type { DatasetHandle } from './dataSource';

// ─── Definitions ───────────────────────────────────────────────────────────────

/**
 * Who counts toward a state's approvals: the agents named by records of one entity.
 *
 * Who counts is ordinary data rather than a special kind of thing — "the people reviewing this task"
 * is whichever involvement records say so — so a community names them in its own vocabulary and a
 * workflow refers to them by query.
 */
export interface AgentQuery {
  /** The entity whose records name the eligible. */
  entity: string;
  /** The property on each record holding the eligible agent's id. */
  agentField: string;
  /** Conditions every counting record must meet — equality only. */
  where?: Record<string, string | number | boolean>;
  /**
   * The property on each record that must name the record being moved, when the query is about *this*
   * record rather than about the space — "reviewing this task", not "a reviewer somewhere".
   */
  recordField?: string;
}

/**
 * How evidence is tied to the record being moved.
 *
 * - `{ relation }` — the record holds it through one of its own relations, named as its entity names
 *   it: `responses` for what was made in response to it (a comment, a document answering a task),
 *   `children` for a collection's parts.
 * - `{ field }` — each piece names the record in a property of its own, the way an involvement names
 *   the task it is about.
 *
 * Absent, evidence counts matching records anywhere in the dataset.
 */
export type Via = { relation: string } | { field: string };

/** Distinct agents who count must ask for the move. */
export interface ApprovalsRequirement {
  kind: 'approvals';
  /** At least 1. */
  count: number;
  /** Who counts. Absent, anybody does. */
  from?: AgentQuery;
}

/**
 * Records matching a query must exist — "a document attached", "a comment from a reviewer" — or, with
 * `max: 0`, must not. The records that satisfied it when a move was asked for are that move's evidence.
 */
export interface EvidenceRequirement {
  kind: 'evidence';
  /** The entity whose records count. */
  entity: string;
  /** Conditions every counting record must meet — equality only. */
  where?: Record<string, string | number | boolean>;
  /** At least this many must match. Default 1. */
  min?: number;
  /** At most this many may match. */
  max?: number;
  via?: Via;
}

/** One thing a state requires before a record may enter it. */
export type Requirement = ApprovalsRequirement | EvidenceRequirement;

/** The kinds of requirement there are — what {@link WorkflowCapabilities.requirements} lists. */
export type RequirementKind = Requirement['kind'];

export interface WorkflowState {
  /** Unique within the workflow; letters, digits, `-` and `_`, not starting with `_`. */
  name: string;
  /**
   * Everything entering this state requires; all of it must hold. At most one `approvals`. Absent or
   * empty, one ask from anybody moves a record in.
   */
  requires?: Requirement[];
  /** One sentence on what being in this state means, for a model reasoning about the record. */
  hint?: string;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  /** What the move is called where a person is offered it. Derived when absent. */
  name?: string;
}

export interface WorkflowDefinition {
  /** The workflow's identifier within a dataset; letters and digits. */
  name: string;
  /** The entities a record moved through this workflow may be. Empty means any record. */
  entities: string[];
  /**
   * In order. A record the workflow has not seen starts in the first, unless whoever moves it says
   * where it already stands — see {@link MoveOptions.from}.
   */
  states: WorkflowState[];
  /**
   * The only moves anybody may ask for. A state with no move out of it is final. A set: the order
   * means nothing, and a backend may answer with them in any order.
   */
  transitions: WorkflowTransition[];
  /** One sentence on what the workflow is about. */
  hint?: string;
}

/** A workflow as a list shows it. */
export interface WorkflowSummary {
  name: string;
  /**
   * The definition can be read back exactly as {@link WorkflowDefinition} says it. False for a
   * workflow written by something that uses more than this contract can hold — saving it from here
   * would drop the rest.
   */
  editable: boolean;
  /** How many records are going through it. */
  records: number;
}

// ─── Records going through a workflow ──────────────────────────────────────────

/** A move somebody has asked for that has not happened. */
export interface Proposal {
  to: string;
  /** Everyone who has asked for it, the first asker first. Counted toward its approvals or not. */
  approvers: string[];
  /** Milliseconds since the epoch, when first asked. */
  askedAt?: number;
  /** What the first asker said about it. */
  note?: string;
}

/** One record going through a workflow. */
export interface WorkflowItem {
  /** The record. */
  record: string;
  /**
   * Where it stands. `null` when this backend cannot say yet — a peer-to-peer backend that has not
   * derived it here, or a record the workflow has not placed — and a reader falls back to what the
   * record itself says.
   */
  state: string | null;
  /** Milliseconds since the epoch, when the record entered the workflow. */
  since?: number;
  /** Moves asked for out of where it stands. */
  waiting: Proposal[];
  /** Two moves out of where it stands are both agreed and the backend will not choose: somebody has to withdraw. */
  stalled: boolean;
}

/** Every record going through one workflow. */
export interface WorkflowView {
  workflow: string;
  items: WorkflowItem[];
}

/** A move that happened. */
export interface Move {
  from: string;
  to: string;
  /** The agents whose asks made it. */
  approvers: string[];
  /** Milliseconds since the epoch, when first asked. */
  at?: number;
  /** Ids of the records that met the state's evidence requirements when it was asked for. */
  evidence: string[];
  note?: string;
}

/** What one move call came to. */
export type MoveResult =
  /** The record moved — or was already where it was asked to go, in which case `moves` is empty. */
  | { outcome: 'moved'; state: string; moves: Move[] }
  /**
   * Recorded and short of what the state requires. `approved` is false when the caller had already
   * asked.
   */
  | { outcome: 'waiting'; state: string | null; to: string; approved: boolean; approvers: string[] }
  /**
   * Nothing written. `not-allowed`: no move from where the record stands to there. `unmet`: the
   * state's evidence requirements do not hold yet.
   */
  | { outcome: 'refused'; reason: 'not-allowed' | 'unmet'; state: string | null }
  /** The record is stuck — see {@link WorkflowItem.stalled}. More asks cannot help. */
  | { outcome: 'stalled'; state: string | null }
  /** Asked, and the backend has not answered in time. Not a failure: what happened arrives through {@link WorkflowPort.watch}. */
  | { outcome: 'pending' };

export interface MoveOptions {
  /**
   * Where the caller believes the record already stands. Used only when the workflow has no place for
   * it yet: a record that existed before the workflow did enters at `from` rather than restarting in
   * the first state. Ignored when it names no state of the workflow.
   */
  from?: string;
  /** What the caller says about the move. */
  note?: string;
}

// ─── What a backend can do ─────────────────────────────────────────────────────

export interface WorkflowCapabilities {
  /** The kinds of requirement this backend enforces. A definition using another is refused on install. */
  requirements: RequirementKind[];
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

export interface WorkflowPort {
  readonly capabilities: WorkflowCapabilities;

  /**
   * Make the dataset's copy of a workflow say what this definition says. Idempotent, and diff-first:
   * installing an unchanged definition writes nothing. Rejects a definition
   * {@link validateWorkflowDefinition} finds fault with.
   *
   * Replaces rather than merges. A rule left over from an earlier version beside the new one is not
   * a stricter rule, it is two rules.
   */
  install(dataset: DatasetHandle, definition: WorkflowDefinition): Promise<void>;
  /** Every workflow in the dataset. */
  list(dataset: DatasetHandle): Promise<WorkflowSummary[]>;
  /** One workflow's definition, or `null` when there is none by that name. */
  read(dataset: DatasetHandle, workflow: string): Promise<WorkflowDefinition | null>;
  /**
   * Take a workflow out of the dataset. Rejects while any record is going through it: those records
   * would be left where they stand with nothing to move them, and a workflow made later under the same
   * name could pick them up again.
   */
  remove(dataset: DatasetHandle, workflow: string): Promise<void>;

  /**
   * Put a record into a workflow, at `at` or the first state. Resolves with where it stands — which,
   * for a record already in the workflow, is wherever that is.
   */
  start(dataset: DatasetHandle, workflow: string, record: string, opts?: { at?: string }): Promise<WorkflowItem>;
  /**
   * Ask for a record to move — the same call whether the caller is first to ask or agreeing with
   * somebody who did. A record not yet in the workflow enters it first (see {@link MoveOptions.from}).
   */
  move(dataset: DatasetHandle, workflow: string, record: string, to: string, opts?: MoveOptions): Promise<MoveResult>;
  /**
   * Take back what the caller asked for on a record's waiting moves. Never touches anybody else's ask,
   * nor a move that has happened. Resolves with how many asks were withdrawn.
   */
  withdraw(dataset: DatasetHandle, workflow: string, record: string): Promise<number>;

  /**
   * Every record going through a workflow — once now, and again whenever that changes, including when
   * a peer's ask arrives. Resolves with a stop function once watching has begun.
   */
  watch(dataset: DatasetHandle, workflow: string, onChange: (view: WorkflowView) => void): Promise<() => void>;
  /** The moves a record has made in a workflow, oldest first. */
  history(dataset: DatasetHandle, workflow: string, record: string): Promise<Move[]>;
}

// ─── Checking a definition ─────────────────────────────────────────────────────

const STATE_NAME = /^[A-Za-z0-9-][A-Za-z0-9_-]*$/;
const WORKFLOW_NAME = /^[A-Za-z0-9]+$/;

/**
 * What is wrong with a definition, as sentences — empty when nothing is. Checked against what a backend
 * can enforce when given its capabilities.
 *
 * The editor and both adapters call this, so a definition the editor accepts is one every backend
 * installs, and a mistake is described once.
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  capabilities?: WorkflowCapabilities,
): string[] {
  const problems: string[] = [];
  if (!WORKFLOW_NAME.test(definition.name))
    problems.push(`"${definition.name}" is not a workflow name: letters and digits only.`);
  if (!definition.states.length) problems.push('A workflow needs at least one state.');
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
      if (requirement.kind === 'evidence') {
        const min = requirement.min ?? 1;
        if (!(Number.isInteger(min) && min >= 0))
          problems.push(`"${state.name}" asks for evidence with a minimum of ${min}.`);
        if (requirement.max !== undefined && requirement.max < min) {
          problems.push(`"${state.name}" asks for evidence whose maximum is below its minimum.`);
        }
        if (!requirement.entity) problems.push(`"${state.name}" asks for evidence that names no kind of record.`);
        const via = requirement.via;
        if (via && !('relation' in via ? via.relation : via.field)) {
          problems.push(`"${state.name}" asks for evidence tied to the record by nothing.`);
        }
      }
    }
  }
  const moves = new Set<string>();
  for (const transition of definition.transitions) {
    for (const end of [transition.from, transition.to]) {
      if (!names.has(end)) problems.push(`A move names "${end}", which is not a state of this workflow.`);
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
export function allowedMoves(definition: WorkflowDefinition, state: string | null): string[] {
  if (state === null) return definition.states[0] ? [definition.states[0].name] : [];
  return definition.transitions.filter((t) => t.from === state).map((t) => t.to);
}

/** A state no move leaves. */
export function isFinalState(definition: WorkflowDefinition, state: string): boolean {
  return !definition.transitions.some((t) => t.from === state);
}

/** How many approvals entering a state takes, and from whom. One from anybody when it says nothing. */
export function approvalsFor(state: WorkflowState | undefined): { count: number; from?: AgentQuery } {
  const rule = state?.requires?.find((r): r is ApprovalsRequirement => r.kind === 'approvals');
  return rule
    ? { count: Math.max(1, Math.floor(rule.count)), ...(rule.from ? { from: rule.from } : {}) }
    : { count: 1 };
}

/** The evidence entering a state takes. */
export function evidenceFor(state: WorkflowState | undefined): EvidenceRequirement[] {
  return (state?.requires ?? []).filter((r): r is EvidenceRequirement => r.kind === 'evidence');
}

/** Whether entering a state takes more than one ask from anybody — agreement, or something present. */
export function asksForMore(state: WorkflowState | undefined): boolean {
  const approvals = approvalsFor(state);
  return approvals.count > 1 || Boolean(approvals.from) || evidenceFor(state).length > 0;
}

/** A record's item in a view, or `undefined` when it is not going through the workflow. */
export function itemFor(view: WorkflowView | null | undefined, record: string): WorkflowItem | undefined {
  return view?.items.find((item) => item.record === record);
}
