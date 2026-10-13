/**
 * A flow as a template draws it: lanes of labelled steps, each step's requirements as words, and a
 * record's walk — computed here, from the definition, so a schema arranges values and decides nothing.
 *
 * Framework-neutral and pure, like `flowLanes.ts` and `flowDraft.ts` beside it; `FlowStore` is the
 * Solid binding that feeds these the live definition and the records going through it.
 */
import type {
  FlowApprovals,
  FlowDefinition,
  FlowGuard,
  FlowItem,
  FlowRole,
  FlowStep,
  FlowTie,
} from '@we/backend-shared';
import { approvalsFor, guardsFor } from '@we/backend-shared';

import { stateLabelOf } from './flowDraft';
import { finalStates, type FlowLanes, type FlowSequenceRule, toLanes, walkOf } from './flowLanes';

/** The role task states and the flow editor both write: holders of an involvement kind on the record. */
export function involvementRole(kind: string): FlowRole {
  return { entity: 'Involvement', agentField: 'agent', where: { kind }, subjectField: 'node' };
}

/** The involvement kind a role names, when it is the one {@link involvementRole} writes. */
export function kindOf(role: FlowRole | undefined): string {
  if (!role || role.entity !== 'Involvement' || role.subjectField !== 'node') return '';
  const kind = role.where?.kind;
  return typeof kind === 'string' ? kind : '';
}

export interface GuardView {
  entity: string;
  /** `responses`, `children`, a field's name, or empty for "anywhere". */
  tie: string;
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
  guards: GuardView[];
  /** Everything entering it takes, as one short phrase each. */
  requires: string[];
  hint: string;
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
  steps: StepView[];
}

export interface ExceptionView {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  name: string;
}

export interface FlowEditorView {
  name: string;
  subjects: string[];
  hint: string;
  rule: FlowSequenceRule;
  /** The definition reads back as lanes, so it can be edited as lanes. */
  fits: boolean;
  lanes: LaneView[];
  exceptions: ExceptionView[];
  /** Every step, in order — for pickers, and for finding one by name. */
  steps: StepView[];
}

export interface FlowLabels {
  /** A step's name as a person reads it. */
  state: (name: string) => string;
  /** An involvement kind's name as the community calls it. */
  kind: (slug: string) => string;
}

export const defaultLabels: FlowLabels = { state: stateLabelOf, kind: stateLabelOf };

const tieOf = (tie: FlowTie | undefined) => (!tie ? '' : 'relation' in tie ? tie.relation : tie.field);

function guardLabel(guard: FlowGuard): string {
  const min = guard.min ?? 1;
  const count = guard.max !== undefined ? `${min}–${guard.max}` : `at least ${min}`;
  const where =
    guard.tie && 'relation' in guard.tie
      ? guard.tie.relation === 'responses'
        ? ' in response to it'
        : ` in its ${guard.tie.relation}`
      : guard.tie
        ? ` naming it as ${guard.tie.field}`
        : '';
  return `${count} ${guard.entity}${where}`;
}

function stepView(definition: FlowDefinition, name: string, labels: FlowLabels, finals: Set<string>): StepView {
  const state = definition.states.find((s) => s.name === name);
  const approvals: { count: number; from?: FlowRole } = approvalsFor(state);
  const kind = kindOf(approvals.from);
  const approverLabel = approvals.from ? (kind ? labels.kind(kind) : approvals.from.entity) : '';
  const guards = guardsFor(state).map((guard): GuardView => ({
    entity: guard.entity,
    tie: tieOf(guard.tie),
    min: guard.min ?? 1,
    max: guard.max ?? null,
    label: guardLabel(guard),
  }));
  const requires = [
    ...(approvals.count > 1 || approvals.from
      ? [
          `${approvals.count} approval${approvals.count === 1 ? '' : 's'}${approverLabel ? ` from ${approverLabel}` : ''}`,
        ]
      : []),
    ...guards.map((g) => g.label),
  ];
  return {
    name,
    label: labels.state(name),
    final: finals.has(name),
    approvals: approvals.count,
    approverKind: kind,
    approverLabel,
    guards,
    requires,
    hint: state?.hint ?? '',
  };
}

/** A definition as the editor draws it — the same view whether it is being edited or only shown. */
export function editorView(
  definition: FlowDefinition,
  labels: FlowLabels = defaultLabels,
  model?: FlowLanes,
): FlowEditorView {
  const read = model ? { model, fits: true } : toLanes(definition);
  const finals = new Set(finalStates(definition));
  const label = (name: string | undefined) => (name ? labels.state(name) : '');
  return {
    name: definition.name,
    subjects: [...definition.subjects],
    hint: definition.hint ?? '',
    rule: read.model.rule,
    fits: read.fits,
    lanes: read.model.lanes.map((lane, index) => ({
      index,
      main: index === 0,
      leaves: lane.leaves ?? '',
      leavesLabel: label(lane.leaves),
      rejoins: lane.rejoins ?? '',
      rejoinsLabel: label(lane.rejoins),
      ends: index > 0 && !lane.rejoins,
      steps: lane.states.map((name) => stepView(definition, name, labels, finals)),
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
  subject: string;
  title: string;
  state: string | null;
  stateLabel: string;
  stalled: boolean;
  /** Moves asked for out of where it stands, with how far each has got. */
  waiting: {
    to: string;
    toLabel: string;
    voters: string[];
    needs: number;
    note: string;
    /** The viewer has asked for it. */
    mine: boolean;
  }[];
  walk: { name: string; label: string; at: 'done' | 'current' | 'ahead' }[];
  next: { name: string; label: string }[];
}

/** One record going through a flow, as a row draws it. */
export function recordView(
  definition: FlowDefinition,
  model: FlowLanes,
  item: FlowItem,
  title: string,
  me: string | undefined,
  labels: FlowLabels = defaultLabels,
): RecordView {
  const walk = walkOf(definition, model, item.state);
  return {
    subject: item.subject,
    title,
    state: item.state,
    stateLabel: item.state ? labels.state(item.state) : '',
    stalled: item.stalled,
    waiting: item.waiting.map((move) => ({
      to: move.to,
      toLabel: labels.state(move.to),
      voters: move.voters,
      needs: approvalsFor(definition.states.find((s) => s.name === move.to)).count,
      note: move.note ?? '',
      mine: Boolean(me && move.voters.includes(me)),
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
  voters: string[];
  at: number | null;
  evidence: string[];
  note: string;
}

export const historyView = (steps: FlowStep[], labels: FlowLabels = defaultLabels): StepHistoryView[] =>
  steps.map((step) => ({
    from: step.from,
    to: step.to,
    fromLabel: labels.state(step.from),
    toLabel: labels.state(step.to),
    voters: step.voters,
    at: step.at ?? null,
    evidence: step.evidence,
    note: step.note ?? '',
  }));

/** An approvals rule from what the editor offers: a count, and whose agreement counts. */
export function approvalsRule(count: number, kind: string): FlowApprovals | null {
  const n = Math.max(1, Math.floor(count));
  if (n === 1 && !kind) return null;
  return { kind: 'approvals', count: n, ...(kind ? { from: involvementRole(kind) } : {}) };
}
