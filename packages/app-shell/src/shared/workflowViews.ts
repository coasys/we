/**
 * A workflow as a template draws it: lanes of labelled steps, each step's requirements as words, and a
 * record's walk — computed here, from the definition, so a schema arranges values and decides nothing.
 *
 * Framework-neutral and pure, like `workflowLanes.ts` and `workflowDraft.ts` beside it; `WorkflowStore` is the
 * Solid binding that feeds these the live definition and the records going through it.
 */
import type {
  AgentQuery,
  ApprovalsRequirement,
  EvidenceRequirement,
  Move,
  Via,
  WorkflowDefinition,
  WorkflowItem,
} from '@we/backend-shared';
import { allowedMoves, approvalsFor, evidenceFor } from '@we/backend-shared';

import { subjectOfEvidence } from './evidenceSubjects';
import { stateLabelOf } from './workflowDraft';
import { finalStates, toLanes, walkOf, type WorkflowLanes, type WorkflowSequenceRule } from './workflowLanes';

/** The role task states and the workflow editor both write: holders of an involvement kind on the record. */
export function involvementRole(kind: string): AgentQuery {
  return { entity: 'Involvement', agentField: 'agent', where: { kind }, recordField: 'node' };
}

/** The involvement kind a role names, when it is the one {@link involvementRole} writes. */
export function kindOf(role: AgentQuery | undefined): string {
  if (!role || role.entity !== 'Involvement' || role.recordField !== 'node') return '';
  const kind = role.where?.kind;
  return typeof kind === 'string' ? kind : '';
}

export interface EvidenceView {
  entity: string;
  /** `responses`, `children`, a field's name, or empty for "anywhere". */
  via: string;
  min: number;
  max: number | null;
  label: string;
}

export interface StepView {
  name: string;
  label: string;
  /** No move leaves it. */
  final: boolean;
  /** How many approvals entering it takes; 1 is a plain ask. */
  approvals: number;
  /** The involvement kind whose holders' approval counts; empty for anybody's. */
  approverKind: string;
  /** Who counts, in words. Empty when anybody does. */
  approverLabel: string;
  evidence: EvidenceView[];
  /** Everything entering it takes, as one short phrase each. */
  requires: string[];
  hint: string;
  /**
   * The steps a move nothing else covers comes in from (an exception), by name as a person reads it —
   * so a map of lanes can say "also from Draft" on the step it leads into rather than only in a list.
   */
  alsoFrom: string[];
}

export interface LaneView {
  index: number;
  main: boolean;
  leaves: string;
  leavesLabel: string;
  rejoins: string;
  rejoinsLabel: string;
  /** A branch with nowhere to rejoin: its last step is final. */
  ends: boolean;
  /**
   * Where along the line the lane's first step stands, in step widths from the main line's first — so
   * a branch can be drawn under the step it leaves, as a line on a map rather than a list below it. A
   * branch starts one along from the step it leaves; the main line at 0.
   */
  column: number;
  /** The column of the lane's last step. */
  lastColumn: number;
  /** The column of the step it rejoins at, or -1 for a lane that does not rejoin. */
  rejoinsColumn: number;
  /** Which lane the step it leaves is on, and the step it rejoins at — so a line can climb to it. -1 for none. */
  leavesLane: number;
  rejoinsLane: number;
  steps: StepView[];
}

export interface ExceptionView {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  name: string;
}

export interface WorkflowEditorView {
  name: string;
  entities: string[];
  hint: string;
  rule: WorkflowSequenceRule;
  /** The definition reads back as lanes, so it can be edited as lanes. */
  fits: boolean;
  lanes: LaneView[];
  exceptions: ExceptionView[];
  /** Every step, in order — for pickers, and for finding one by name. */
  steps: StepView[];
}

export interface WorkflowLabels {
  /** A step's name as a person reads it. */
  state: (name: string) => string;
  /** An involvement kind's name as the community calls it. */
  kind: (slug: string) => string;
}

export const defaultLabels: WorkflowLabels = { state: stateLabelOf, kind: stateLabelOf };

const viaOf = (via: Via | undefined) => (!via ? '' : 'relation' in via ? via.relation : via.field);

/** An evidence requirement in words: "at least 1 TextBlock in response to it". */
export function evidenceLabel(requirement: EvidenceRequirement): string {
  const min = requirement.min ?? 1;
  const count = requirement.max !== undefined ? `${min}–${requirement.max}` : `at least ${min}`;
  const where =
    requirement.via && 'relation' in requirement.via
      ? requirement.via.relation === 'responses'
        ? ' in response to it'
        : ` in its ${requirement.via.relation}`
      : requirement.via
        ? ` naming it as ${requirement.via.field}`
        : '';
  const subject = subjectOfEvidence(requirement);
  const noun = subject ? (requirement.max === undefined && min === 1 ? subject.one : subject.many) : requirement.entity;
  return `${count} ${noun}${where}`;
}

/** "A", "A or B", "A, B or C". */
const orList = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;

/**
 * Why a move was refused, as a sentence — or `null` where there is not enough to say more than that
 * it was. A refusal that only says "not allowed" leaves a person guessing which rule stopped them,
 * and the workflow already knows: where a record may go from where it stands, and what a step asks for.
 */
export function refusalWords(
  definition: WorkflowDefinition | null | undefined,
  from: string | null | undefined,
  to: string,
  reason: string,
  labels: WorkflowLabels = defaultLabels,
): string | null {
  if (!definition) return null;
  if (reason === 'not-allowed') {
    if (!from) return null;
    const allowed = allowedMoves(definition, from).map(labels.state);
    return allowed.length
      ? `From ${labels.state(from)} it can only move to ${orList(allowed)}.`
      : `Nothing moves on from ${labels.state(from)}.`;
  }
  if (reason === 'unmet') {
    const evidence = evidenceFor(definition.states.find((s) => s.name === to));
    if (!evidence.length) return null;
    return `Not yet — ${labels.state(to)} needs ${evidence.map(evidenceLabel).join(' and ')}.`;
  }
  return null;
}

function stepView(definition: WorkflowDefinition, name: string, labels: WorkflowLabels, finals: Set<string>): StepView {
  const state = definition.states.find((s) => s.name === name);
  const approvals: { count: number; from?: AgentQuery } = approvalsFor(state);
  const kind = kindOf(approvals.from);
  const approverLabel = approvals.from ? (kind ? labels.kind(kind) : approvals.from.entity) : '';
  const evidence = evidenceFor(state).map((requirement): EvidenceView => ({
    entity: requirement.entity,
    via: viaOf(requirement.via),
    min: requirement.min ?? 1,
    max: requirement.max ?? null,
    label: evidenceLabel(requirement),
  }));
  const requires = [
    ...(approvals.count > 1 || approvals.from
      ? [
          `${approvals.count} approval${approvals.count === 1 ? '' : 's'}${approverLabel ? ` from ${approverLabel}` : ''}`,
        ]
      : []),
    ...evidence.map((g) => g.label),
  ];
  return {
    name,
    label: labels.state(name),
    final: finals.has(name),
    approvals: approvals.count,
    approverKind: kind,
    approverLabel,
    evidence,
    requires,
    hint: state?.hint ?? '',
    // Filled in where the lanes are known — see `editorView`.
    alsoFrom: [],
  };
}

/** A definition as the editor draws it — the same view whether it is being edited or only shown. */
export function editorView(
  definition: WorkflowDefinition,
  labels: WorkflowLabels = defaultLabels,
  model?: WorkflowLanes,
): WorkflowEditorView {
  const read = model ? { model, fits: true } : toLanes(definition);
  const finals = new Set(finalStates(definition));
  const label = (name: string | undefined) => (name ? labels.state(name) : '');
  return {
    name: definition.name,
    entities: [...definition.entities],
    hint: definition.hint ?? '',
    rule: read.model.rule,
    fits: read.fits,
    // `columnOf` is complete once every lane is placed, which it is by the time these are built.
    lanes: lanesWithColumns(read.model.lanes).map(({ lane, column, columnOf, laneOf }, index) => ({
      index,
      main: index === 0,
      leaves: lane.leaves ?? '',
      leavesLabel: label(lane.leaves),
      rejoins: lane.rejoins ?? '',
      rejoinsLabel: label(lane.rejoins),
      ends: index > 0 && !lane.rejoins,
      column,
      lastColumn: column + Math.max(0, lane.states.length - 1),
      rejoinsColumn: lane.rejoins ? (columnOf.get(lane.rejoins) ?? -1) : -1,
      leavesLane: lane.leaves ? (laneOf.get(lane.leaves) ?? -1) : -1,
      rejoinsLane: lane.rejoins ? (laneOf.get(lane.rejoins) ?? -1) : -1,
      steps: lane.states.map((name) => ({
        ...stepView(definition, name, labels, finals),
        alsoFrom: read.model.exceptions.filter((m) => m.to === name).map((m) => labels.state(m.from)),
      })),
    })),
    exceptions: read.model.exceptions.map((m) => ({
      from: m.from,
      to: m.to,
      fromLabel: labels.state(m.from),
      toLabel: labels.state(m.to),
      name: m.name ?? '',
    })),
    steps: definition.states.map((s) => stepView(definition, s.name, labels, finals)),
  };
}

export interface RecordView {
  record: string;
  title: string;
  /** When it entered the workflow, as an ISO date for a timestamp; empty where the backend cannot say. */
  startedAt: string;
  state: string | null;
  stateLabel: string;
  stalled: boolean;
  /** Moves asked for out of where it stands, with how far each has got. */
  waiting: {
    to: string;
    toLabel: string;
    approvers: string[];
    needs: number;
    note: string;
    /** The viewer has asked for it. */
    mine: boolean;
  }[];
  walk: { name: string; label: string; at: 'done' | 'current' | 'ahead' }[];
  next: { name: string; label: string }[];
}

/**
 * Each lane with the column its first step stands in — see `LaneView.column`. A lane leaving a step not
 * placed yet (written before the lane it leaves) is placed after the main line's first step.
 */
function lanesWithColumns(lanes: readonly WorkflowLanes['lanes'][number][]) {
  const columnOf = new Map<string, number>();
  const laneOf = new Map<string, number>();
  return lanes.map((lane, index) => {
    const column = index === 0 ? 0 : (columnOf.get(lane.leaves ?? '') ?? 0) + 1;
    lane.states.forEach((name, i) => {
      if (!columnOf.has(name)) columnOf.set(name, column + i);
      if (!laneOf.has(name)) laneOf.set(name, index);
    });
    return { lane, column, columnOf, laneOf };
  });
}

/** One record going through a workflow, as a row draws it. */
export function recordView(
  definition: WorkflowDefinition,
  model: WorkflowLanes,
  item: WorkflowItem,
  title: string,
  me: string | undefined,
  labels: WorkflowLabels = defaultLabels,
): RecordView {
  const walk = walkOf(definition, model, item.state);
  return {
    record: item.record,
    title,
    startedAt: isoOf(item.since),
    state: item.state,
    stateLabel: item.state ? labels.state(item.state) : '',
    stalled: item.stalled,
    waiting: item.waiting.map((move) => ({
      to: move.to,
      toLabel: labels.state(move.to),
      approvers: move.approvers,
      needs: approvalsFor(definition.states.find((s) => s.name === move.to)).count,
      note: move.note ?? '',
      mine: Boolean(me && move.approvers.includes(me)),
    })),
    walk: walk.steps.map((step) => ({ ...step, label: labels.state(step.name) })),
    next: walk.next.map((name) => ({ name, label: labels.state(name) })),
  };
}

export interface StepHistoryView {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  approvers: string[];
  at: number | null;
  /** `at` as an ISO date, for a timestamp; empty where the backend cannot say. */
  when: string;
  evidence: string[];
  note: string;
}

/** Milliseconds as an ISO date — what a timestamp element reads — or empty for none. */
const isoOf = (ms: number | null | undefined): string =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : '';

export const historyView = (steps: Move[], labels: WorkflowLabels = defaultLabels): StepHistoryView[] =>
  steps.map((step) => ({
    from: step.from,
    to: step.to,
    fromLabel: labels.state(step.from),
    toLabel: labels.state(step.to),
    approvers: step.approvers,
    at: step.at ?? null,
    when: isoOf(step.at),
    evidence: step.evidence,
    note: step.note ?? '',
  }));

/** An approvals rule from what the editor offers: a count, and whose agreement counts. */
export function approvalsRule(count: number, kind: string): ApprovalsRequirement | null {
  const n = Math.max(1, Math.floor(count));
  if (n === 1 && !kind) return null;
  return { kind: 'approvals', count: n, ...(kind ? { from: involvementRole(kind) } : {}) };
}
