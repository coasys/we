/**
 * The flow port, over AD4M's flow engine.
 *
 * AD4M derives a record's state in a flow on every replica, from the signed proposals and votes it
 * holds. The contract speaks about records and moves; the engine about runs, proposals and an
 * entry state. This file translates between the two: a neutral definition into a `SHACLFlow` and
 * back, a move into the proposals it takes, and what the engine holds back into records
 * ({@link ./flowRuns}).
 *
 * ## What the SDK leaves to its caller
 *
 * **Installing is additive.** `addFlow` writes a definition's links and removes none. Re-installing
 * a changed rule would leave the old `consensusRule` beside the new one, and the engine refuses to
 * move a run at all while one state holds two different rules (a peer shadowing a rule must not be
 * able to downgrade it). So {@link install} diffs: it reads what the dataset holds of the definition,
 * removes what the new one does not say, and adds what it does. Only predicates a definition writes
 * are ever removed — a flow's URI is also the source of links that are not its definition, such as
 * its receipt index. There is no `removeFlow` either; {@link remove} is the same diff towards nothing.
 *
 * **Starting is not idempotent.** `FlowInstance.start` mints a run every time it is called, so a
 * record's run is looked for first, and the earliest is the record's (`runFor`).
 *
 * **A run begins in the lowest state.** A record that predates the flow must not restart in the
 * first column, so every flow WE installs carries a hidden entry state, and a record's first move
 * enters it from there into where it already stands ({@link ENTRY_STATE}).
 *
 * **Votes are not on the model.** `FlowTransitionProposal` carries the proposer and nothing about who
 * agreed. A vote is an `acceptedBy` link naming its voter, and counts only when that voter signed it
 * — the engine's own rule, which stops one agent writing votes for others. Read here the same way.
 *
 * **There is no flow subscription.** A run's state is a cache the executor rewrites when it derives
 * one — after a local vote, or ~300 ms after a peer's arrives — so watching means watching the links
 * that change when anything about a run does, and re-reading.
 *
 * **Refusals are sentences.** The engine names why it refused a move only in its message, so the
 * three it gives — not reachable, guard unmet, contested — are read out of it here and nowhere else.
 *
 * ## What it does not do
 *
 * The definition itself is ordinary links, which any member can rewrite; the engine reads whatever
 * the dataset holds. That is an engine property, recorded against the engine (coasys/ad4m#1080), and
 * nothing here can close it — which is why {@link AD4M_FLOW_CAPABILITIES} says `peers`.
 */
import {
  FlowInstance,
  type FlowProposeResult as Ad4mFlowProposeResult,
  FlowTransitionProposal,
  Link,
  type LinkExpression,
  LinkQuery,
  Literal,
  type ModelQuery,
  type PerspectiveProxy,
  SHACLFlow,
} from '@coasys/ad4m';
import type {
  DatasetHandle,
  EntitySchema,
  FlowApprovals,
  FlowCapabilities,
  FlowDefinition,
  FlowGuard,
  FlowItem,
  FlowMoveResult,
  FlowPort,
  FlowRequirement,
  FlowRole,
  FlowStateDefinition,
  FlowStep,
  FlowSummary,
} from '@we/backend-shared';
import {
  approvalsFor,
  CONTAINMENT_PREDICATE,
  guardsFor,
  trace,
  tracing,
  validateFlowDefinition,
} from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

import { ENTRY_STATE, itemOf, openMoves, type Proposal, type Run, runFor, stateOf, stepsOf } from './flowRuns';
import { recordMissingMethod } from './missingMethods';

const proxy = (dataset: DatasetHandle) => dataset as PerspectiveProxy;

/** Where a flow's URIs live: `${namespace}${name}Flow`, which the SDK reads a name back out of. */
export const FLOW_NAMESPACE = 'we://flow/';

export const AD4M_FLOW_CAPABILITIES: FlowCapabilities = {
  requirements: ['approvals', 'guard'],
  enforcement: 'peers',
  sealedEvidence: true,
  contention: 'stall',
};

const HAS_STATE = 'ad4m://hasState';
const HAS_TRANSITION = 'ad4m://hasTransition';
const ACCEPTED_BY = 'ad4m://acceptedBy';
const RESOLVED_AS = 'ad4m://flow/resolved_as';
const FIRED = 'fired';
/** The engine's name for the record a run is about, substituted where a rule or guard is read. */
const BASE = '$flow.base';

/**
 * Every predicate `SHACLFlow.toLinks` writes — the only links {@link install} will remove.
 *
 * Listed rather than derived from one definition's links, because a predicate the *old* definition
 * wrote and the new one does not (a hint since cleared) is exactly the kind that must go.
 */
const DEFINITION_PREDICATES = new Set([
  'rdf://type',
  'ad4m://flowName',
  'ad4m://interpretationHint',
  'ad4m://inputTypes',
  'ad4m://outputTypes',
  'ad4m://creationHint',
  'ad4m://context',
  'ad4m://consensusRule',
  HAS_STATE,
  HAS_TRANSITION,
  'ad4m://stateName',
  'ad4m://stateValue',
  'ad4m://requires',
  'ad4m://semanticCheck',
  'ad4m://actionName',
  'ad4m://fromState',
  'ad4m://toState',
  'ad4m://transitionActions',
]);

/**
 * The links whose change means something about a run changed: a run begun, a proposal made, a vote,
 * a move marked, a state re-derived. One subscription each, written as the plainest SPARQL there is
 * — the executor decides which diffs re-run a subscription from the predicates named in its text.
 */
const WATCHED_PREDICATES = [
  'ad4m://flow/base',
  'ad4m://flow/to_state',
  ACCEPTED_BY,
  RESOLVED_AS,
  'ad4m://flow/current_state',
];

/** How long a watch with nobody listening lingers, for a watcher that is about to come straight back. */
const WATCH_GRACE_MS = 1500;
/** How long a burst of changes is gathered before the dataset is re-read once for all of it. */
const REREAD_DEBOUNCE_MS = 60;
/** How long a definition read back from the dataset is trusted before it is read again. */
const DEFINITION_TTL_MS = 10_000;

// ─── Relations by name ─────────────────────────────────────────────────────────

/** An entity's relations, with what it inherits — every WeNode's own included. */
function relationsOf(entity: string): EntitySchema['relations'] {
  const schema = CORE_MANIFEST.entities[entity];
  if (!schema) return {};
  return { ...(schema.extends ? relationsOf(schema.extends) : {}), ...schema.relations };
}

const subjectEntities = (subjects: readonly string[]) =>
  subjects.length
    ? subjects
    : Object.entries(CORE_MANIFEST.entities)
        .filter(([, schema]) => !schema.abstract)
        .map(([name]) => name);

/**
 * The predicate a relation of the flow's records is stored under, for the engine's `linkedTo`.
 *
 * Only a relation the record holds: `linkedTo` follows a link *from* the record, and a relation read
 * backwards (`reverseOf`) is a link from the other end, which it cannot express.
 */
function predicateOf(relation: string, subjects: readonly string[]): string {
  for (const entity of subjectEntities(subjects)) {
    const spec = relationsOf(entity)[relation];
    if (!spec) continue;
    if (spec.reverseOf) {
      throw new Error(`flows: "${relation}" is read backwards on ${entity}, so a guard cannot be tied through it`);
    }
    const predicate = spec.containment ? CONTAINMENT_PREDICATE : spec.predicate;
    if (predicate) return predicate;
  }
  throw new Error(`flows: no record a flow over ${subjects.join(', ') || 'any record'} moves holds "${relation}"`);
}

/** The relation a predicate stores, among the flow's records — {@link predicateOf} backwards. */
function relationOf(predicate: string, subjects: readonly string[]): string | undefined {
  for (const entity of subjectEntities(subjects)) {
    for (const [name, spec] of Object.entries(relationsOf(entity))) {
      if (spec.reverseOf) continue;
      if ((spec.containment ? CONTAINMENT_PREDICATE : spec.predicate) === predicate) return name;
    }
  }
  return undefined;
}

// ─── Definition ────────────────────────────────────────────────────────────────

/** Conditions in a fixed order, because the engine compares rules and guards by their text. */
const sortedWhere = (where: Record<string, string | number | boolean>) =>
  Object.fromEntries(
    Object.keys(where)
      .sort()
      .map((key) => [key, where[key]]),
  );

/**
 * A state's rule, in the engine's shape — or nothing, where the engine's own default (one vote,
 * from anybody) already says it.
 *
 * Built key by key in a fixed order, `where` sorted, because the engine compares rules by their
 * text: two installs of one definition must write the same bytes or the second looks like a rival
 * rule rather than the same one.
 */
function ruleFor(state: FlowStateDefinition): Record<string, unknown> | undefined {
  const { count, from } = approvalsFor(state);
  if (count === 1 && !from) return undefined;
  const rule: Record<string, unknown> = { n: count };
  if (from) {
    const where: Record<string, string | number | boolean> = { ...(from.where ?? {}) };
    if (from.subjectField) where[from.subjectField] = BASE;
    rule.fromRole = { className: from.entity, where: sortedWhere(where), didProperty: from.agentField };
  }
  return rule;
}

/** A guard in the engine's shape. Keys in a fixed order, for {@link ruleFor}'s reason. */
function guardQuery(guard: FlowGuard, subjects: readonly string[]): ModelQuery {
  const where: Record<string, string | number | boolean> = { ...(guard.where ?? {}) };
  if (guard.tie && 'field' in guard.tie) where[guard.tie.field] = BASE;
  const query: ModelQuery = { className: guard.entity };
  if (Object.keys(where).length) query.where = sortedWhere(where);
  const min = guard.min ?? 1;
  if (min !== 1 || guard.max !== undefined)
    query.count = { min, ...(guard.max !== undefined ? { max: guard.max } : {}) };
  if (guard.tie && 'relation' in guard.tie)
    query.linkedTo = { via: predicateOf(guard.tie.relation, subjects), to: 'base' };
  return query;
}

export function toShaclFlow(definition: FlowDefinition): SHACLFlow {
  const flow = new SHACLFlow(definition.name, FLOW_NAMESPACE);
  flow.inputTypes = [...definition.subjects];
  if (definition.hint) flow.interpretationHint = definition.hint;
  // The entry comes first: the engine starts every run in the lowest value.
  flow.addState({ name: ENTRY_STATE, value: 0 });
  definition.states.forEach((state, index) => {
    const rule = ruleFor(state);
    const guards = guardsFor(state).map((guard) => guardQuery(guard, definition.subjects));
    flow.addState({
      name: state.name,
      value: index + 1,
      ...(state.hint ? { interpretationHint: state.hint } : {}),
      ...(rule ? { consensusRule: rule as never } : {}),
      ...(guards.length ? { requires: guards } : {}),
    });
  });
  // From the entry into every state, on one ask from anybody: the move that places a record where it
  // already stands. A state's own rules still apply to entering it, from here as from anywhere.
  for (const state of definition.states) {
    flow.addTransition({ actionName: state.name, fromState: ENTRY_STATE, toState: state.name, actions: [] });
  }
  for (const transition of definition.transitions) {
    flow.addTransition({
      actionName: transition.name ?? transition.to,
      fromState: transition.from,
      toState: transition.to,
      actions: [],
    });
  }
  return flow;
}

/** The record a rule's `where` ties to the run, and the rest of the conditions. */
function splitBase(where: Record<string, unknown> | undefined) {
  let field: string | undefined;
  const rest: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(where ?? {})) {
    if (value === BASE) field = key;
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') rest[key] = value;
  }
  return { field, rest };
}

/**
 * A `SHACLFlow` as the contract says it — {@link toShaclFlow} backwards. What the contract cannot
 * hold is dropped; whether anything was is what {@link isEditable} answers.
 */
export function fromShaclFlow(flow: SHACLFlow): FlowDefinition {
  const subjects = flow.inputTypes.filter((t) => t !== 'any');
  const states: FlowStateDefinition[] = [...flow.states]
    .filter((s) => s.name !== ENTRY_STATE)
    .sort((a, b) => a.value - b.value)
    .map((state) => {
      const requires: FlowRequirement[] = [];
      const rule = state.consensusRule ?? flow.consensusRule;
      if (rule && (rule.n > 1 || rule.fromRole)) {
        const approvals: FlowApprovals = { kind: 'approvals', count: rule.n };
        if (rule.fromRole) {
          const { field, rest } = splitBase(rule.fromRole.where);
          const from: FlowRole = { entity: rule.fromRole.className, agentField: rule.fromRole.didProperty ?? '' };
          if (Object.keys(rest).length) from.where = rest;
          if (field) from.subjectField = field;
          approvals.from = from;
        }
        requires.push(approvals);
      }
      for (const query of state.requires ?? []) {
        const { field, rest } = splitBase(query.where);
        const guard: FlowGuard = { kind: 'guard', entity: query.className };
        if (Object.keys(rest).length) guard.where = rest;
        if (query.count?.min !== undefined && query.count.min !== 1) guard.min = query.count.min;
        if (query.count?.max !== undefined) guard.max = query.count.max;
        const via = typeof query.linkedTo === 'object' ? relationOf(query.linkedTo.via, subjects) : undefined;
        if (via) guard.tie = { relation: via };
        else if (field) guard.tie = { field };
        requires.push(guard);
      }
      return {
        name: state.name,
        ...(requires.length ? { requires } : {}),
        ...(state.interpretationHint ? { hint: state.interpretationHint } : {}),
      };
    });
  const transitions = flow.transitions
    .filter((t) => t.fromState !== ENTRY_STATE)
    .map((t) => ({
      from: t.fromState,
      to: t.toState,
      ...(t.actionName && t.actionName !== t.toState ? { name: t.actionName } : {}),
    }));
  return {
    name: flow.name,
    subjects,
    states,
    transitions,
    ...(flow.interpretationHint ? { hint: flow.interpretationHint } : {}),
  };
}

/**
 * Whether a stored flow says exactly what the contract can hold: read back and written again, it
 * comes out link for link the same. A flow another app wrote — with actions, outputs, a semantic
 * check, a namespace of its own, a guard tied in a way the contract has no word for — does not, and
 * saving it from WE would quietly drop the rest.
 */
export function isEditable(flow: SHACLFlow): boolean {
  let again: SHACLFlow;
  try {
    again = toShaclFlow(fromShaclFlow(flow));
  } catch {
    return false;
  }
  const keys = (f: SHACLFlow) => new Set(f.toLinks().map(keyOf));
  const a = keys(flow);
  const b = keys(again);
  return a.size === b.size && [...a].every((key) => b.has(key));
}

/** What `addFlow` writes beside the definition: the dataset's register of flows by name. */
function registrationLinks(name: string, flowUri: string): Link[] {
  const literal = Literal.from(name).toUrl();
  return [
    new Link({ source: 'ad4m://self', predicate: 'ad4m://has_flow', target: literal }),
    new Link({ source: literal, predicate: 'ad4m://flow_uri', target: flowUri }),
  ];
}

/**
 * A link's identity for comparison. Literal targets are compared decoded: a literal can come back
 * from the store in a different percent-encoding than it went in, and treating that as a difference
 * would rewrite the whole definition on every install.
 */
function keyOf(link: { source: string; predicate?: string; target: string }): string {
  let target = link.target;
  if (target.startsWith('literal:')) {
    try {
      target = decodeURIComponent(target);
    } catch {
      // Not percent-encoded after all; compare as stored.
    }
  }
  return `${link.source}\u0000${link.predicate ?? ''}\u0000${target}`;
}

/**
 * What the dataset holds of one flow's definition and its entry in the register: the flow's own
 * links, those of every state and transition it names (or `also` names), and every URI its name maps
 * to.
 */
async function heldDefinition(perspective: PerspectiveProxy, name: string, flowUri: string, also: Link[] = []) {
  const own = await perspective.get(new LinkQuery({ source: flowUri }));
  const children = new Set<string>();
  for (const link of [...own.map((l) => l.data), ...also]) {
    if (link.predicate === HAS_STATE || link.predicate === HAS_TRANSITION) children.add(link.target);
  }
  const childLinks = (
    await Promise.all([...children].map((child) => perspective.get(new LinkQuery({ source: child }))))
  ).flat();
  const [entry, mapping] = registrationLinks(name, flowUri);
  const [entries, mappings] = await Promise.all([
    perspective.get(new LinkQuery({ source: entry.source, predicate: entry.predicate })),
    perspective.get(new LinkQuery({ source: mapping.source, predicate: mapping.predicate })),
  ]);
  return [
    ...[...own, ...childLinks].filter((l) => DEFINITION_PREDICATES.has(l.data.predicate ?? '')),
    // The register lists every flow in the dataset; only this name's entry is ours to judge.
    ...entries.filter((l) => keyOf(l.data) === keyOf(entry)),
    // Every URI this name maps to: one pointing anywhere else is stale and goes.
    ...mappings,
  ];
}

// ─── Reading runs ─────────────────────────────────────────────────────────────

/** A DID as a link target: raw, or as the string literal the SDK's setters write. */
function didOf(target: string): string {
  if (!target.startsWith('literal:')) return target;
  try {
    const value = Literal.fromUrl(target).get();
    return typeof value === 'string' ? value : target;
  } catch {
    return target;
  }
}

const millisOf = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

/** A class the engine registers on first use reads as absent until then, rather than as an error. */
const unregistered = (error: unknown) =>
  /no shacl shape stored|shape not found|class not registered|not registered/i.test(
    error instanceof Error ? error.message : String(error),
  );

const runOf = (instance: FlowInstance): Run => {
  const startedAt = instance.startedAtMillis ?? millisOf((instance.record as { createdAt?: unknown }).createdAt);
  return {
    id: instance.uri,
    subject: instance.subject,
    state: instance.currentStateName ?? '',
    ...(startedAt !== undefined ? { startedAt } : {}),
  };
};

async function readRuns(perspective: PerspectiveProxy, flowName: string, subject?: string): Promise<Run[]> {
  try {
    const instances = await FlowInstance.findAll(perspective, subject ? { flowName, subject } : { flowName });
    return instances.map(runOf);
  } catch (error) {
    if (unregistered(error)) return [];
    throw error;
  }
}

/** Every proposal on these runs, with its voters, whether it settled a move, and its evidence. */
async function readProposals(perspective: PerspectiveProxy, runs: readonly Run[]): Promise<Proposal[]> {
  if (!runs.length) return [];
  const runIds = new Set(runs.map((run) => run.id));
  let rows: FlowTransitionProposal[] = [];
  try {
    rows = await FlowTransitionProposal.findAll(perspective);
  } catch (error) {
    if (!unregistered(error)) throw error;
  }
  const mine = rows.filter((row) => runIds.has(row.flowInstance));
  if (!mine.length) return [];

  // Two reads for every proposal at once, rather than two per proposal.
  const [votes, marks] = await Promise.all([
    perspective.get(new LinkQuery({ predicate: ACCEPTED_BY })),
    perspective.get(new LinkQuery({ predicate: RESOLVED_AS })),
  ]);
  const votersOf = new Map<string, string[]>();
  for (const vote of votes as LinkExpression[]) {
    const voter = didOf(vote.data.target);
    // A vote counts only when its voter signed it — see the module docblock.
    if (vote.author !== voter) continue;
    if ((vote.proof as { valid?: boolean } | undefined)?.valid === false) continue;
    const list = votersOf.get(vote.data.source) ?? [];
    if (!list.includes(voter)) list.push(voter);
    votersOf.set(vote.data.source, list);
  }
  const fired = new Set(
    (marks as LinkExpression[]).filter((mark) => didOf(mark.data.target) === FIRED).map((mark) => mark.data.source),
  );

  return mine.map((row) => {
    const proposedAt = millisOf((row as { createdAt?: unknown }).createdAt);
    return {
      id: row.id,
      run: row.flowInstance,
      from: row.fromState,
      to: row.toState,
      proposer: row.proposer,
      voters: [row.proposer, ...(votersOf.get(row.id) ?? []).filter((did) => did !== row.proposer)],
      ...(row.rationale ? { rationale: row.rationale } : {}),
      ...(proposedAt !== undefined ? { proposedAt } : {}),
      settled: fired.has(row.id),
      evidence: [...(row.evidence ?? [])],
    };
  });
}

// ─── Moves ────────────────────────────────────────────────────────────────────

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The SDK throws strings in places; the contract rejects with errors. */
const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** Where a refusal says the run stands, when it was refused as unreachable. */
const refusedFrom = (error: unknown) => /not reachable from `([^`]+)`/.exec(messageOf(error))?.[1];
const refusedUnmet = (error: unknown) => /guard for `[^`]+` is not satisfied/.test(messageOf(error));
const refusedContested = (error: unknown) => /is contested in `/.test(messageOf(error));
/** The call outlived the caller's patience; the executor may well still be doing it. */
const timedOut = (error: unknown) => /timed out|timeout/i.test(messageOf(error));

/** An engine state as the contract says it. */
const shown = (state: string | undefined): string | null => (state && state !== ENTRY_STATE ? state : null);

/**
 * What a refused or timed-out move amounts to, read from the engine's message — or `undefined` for an
 * error that is not a refusal at all, which the caller rethrows. `state` is where the record was last
 * known to stand, for a refusal that does not say.
 */
export function moveRefusal(error: unknown, to: string, state: string | null): FlowMoveResult | undefined {
  const at = refusedFrom(error);
  // Refused because the record is already there: what the caller saw was behind.
  if (at === to) return { outcome: 'moved', state: to, steps: [] };
  if (at !== undefined) return { outcome: 'refused', reason: 'not-allowed', state: shown(at) };
  if (refusedUnmet(error)) return { outcome: 'refused', reason: 'unmet', state };
  if (refusedContested(error)) return { outcome: 'stalled', state };
  if (timedOut(error)) return { outcome: 'pending' };
  return undefined;
}

/**
 * Time one step under the `flows` trace scope — `localStorage.setItem('we:trace', 'flows')`.
 *
 * Kept rather than added for one investigation: a move that takes twenty seconds is several calls
 * (find the run, propose, re-read), and only the timing of each says whether the time is spent in
 * the executor or around it. Free when tracing is off — one check, and the call runs untouched.
 */
async function timed<T>(event: string, detail: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  if (!tracing()) return run();
  const started = performance.now();
  try {
    const result = await run();
    trace('flows', event, { ...detail, ms: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    trace('flows', `${event}:error`, {
      ...detail,
      ms: Math.round(performance.now() - started),
      error: asError(error).message,
    });
    throw error;
  }
}

// ─── Watching ─────────────────────────────────────────────────────────────────

interface Watch {
  listeners: Set<() => void>;
  started: Promise<Array<{ dispose(): void }>>;
  idle?: ReturnType<typeof setTimeout>;
}

// ─── The port ─────────────────────────────────────────────────────────────────

export function createAd4mFlowPort(selfId: () => string | undefined = () => undefined): FlowPort {
  /** One set of subscriptions per perspective, shared by every watcher of it. */
  const watches = new Map<PerspectiveProxy, Watch>();
  /** Definitions read back, per perspective and name, until they are written or grow old. */
  const definitions = new WeakMap<PerspectiveProxy, Map<string, { at: number; flow: Promise<SHACLFlow | null> }>>();

  /** Tell every watcher of a perspective to re-read — after a write of our own, which a cache may lag. */
  const poke = (perspective: PerspectiveProxy) => {
    for (const listener of [...(watches.get(perspective)?.listeners ?? [])]) listener();
  };

  const forget = (perspective: PerspectiveProxy, name: string) => definitions.get(perspective)?.delete(name);

  /** A flow as the dataset holds it, read at most once every {@link DEFINITION_TTL_MS}. */
  function stored(perspective: PerspectiveProxy, name: string): Promise<SHACLFlow | null> {
    let byName = definitions.get(perspective);
    if (!byName) {
      byName = new Map();
      definitions.set(perspective, byName);
    }
    const cached = byName.get(name);
    if (cached && Date.now() - cached.at < DEFINITION_TTL_MS) return cached.flow;
    const flow = perspective.getFlow(name).catch((error: unknown) => {
      byName.delete(name);
      throw error;
    });
    byName.set(name, { at: Date.now(), flow });
    return flow;
  }

  async function installed(perspective: PerspectiveProxy, name: string): Promise<SHACLFlow> {
    const flow = await stored(perspective, name);
    if (!flow) throw new Error(`flows: flow "${name}" is not installed`);
    return flow;
  }

  /** What entering a state takes, for reading whether two waiting moves have stalled. */
  const needsIn = (flow: SHACLFlow) => (to: string) => {
    const state = flow.states.find((s) => s.name === to);
    const rule = state?.consensusRule ?? flow.consensusRule;
    return { count: Math.max(1, rule?.n ?? 1), restricted: Boolean(rule?.fromRole) };
  };

  /** The state a record placed into a flow starts in: where the caller says, or the first real one. */
  const placeAt = (flow: SHACLFlow, wanted: string | undefined) => {
    const states = flow.states.filter((s) => s.name !== ENTRY_STATE).sort((a, b) => a.value - b.value);
    return wanted && states.some((s) => s.name === wanted) ? wanted : states[0]?.name;
  };

  /** The record's run, starting one when there is none. */
  async function runOfSubject(perspective: PerspectiveProxy, flowName: string, subject: string): Promise<Run> {
    const found = runFor(await timed('run:find', { subject }, () => readRuns(perspective, flowName, subject)), subject);
    if (found) return found;
    const started = await timed('run:start', { subject }, () => FlowInstance.start(perspective, flowName, subject));
    poke(perspective);
    return runOf(started);
  }

  /**
   * Place a run that stands at the entry — or has not been derived here, which may or may not be past
   * it. Asking for the entry move is harmless either way: a run already past it refuses the move and
   * names where it stands. Resolves with where the run stands after.
   */
  async function place(perspective: PerspectiveProxy, flow: SHACLFlow, run: Run, at: string | undefined) {
    const known = stateOf(run);
    if (known !== null || !flow.states.some((s) => s.name === ENTRY_STATE)) return known ?? shown(run.state);
    const into = placeAt(flow, at);
    if (!into) return null;
    try {
      const result = await timed('place', { run: run.id, into }, () => perspective.proposeFlowTransition(run.id, into));
      return shown(result.derivedState);
    } catch (error) {
      const at = refusedFrom(error);
      if (at === undefined) throw error;
      return shown(at);
    }
  }

  /** The voters on a run's waiting move, for a move that is still short. */
  async function votersOn(perspective: PerspectiveProxy, run: Run, state: string | null, to: string) {
    const proposals = await readProposals(perspective, [run]);
    const open = openMoves(proposals, { ...run, state: state ?? run.state });
    return open.find((move) => move.to === to)?.voters ?? [];
  }

  async function toMoveResult(
    perspective: PerspectiveProxy,
    run: Run,
    to: string,
    result: Ad4mFlowProposeResult,
  ): Promise<FlowMoveResult> {
    const state = shown(result.derivedState);
    if (result.contested) return { outcome: 'stalled', state };
    if (result.outcomes.length) {
      const steps: FlowStep[] = result.outcomes
        .filter((outcome) => outcome.fromState !== ENTRY_STATE)
        .map((outcome) => ({
          from: outcome.fromState,
          to: outcome.toState,
          voters: [...outcome.voters],
          evidence: [],
        }));
      return { outcome: 'moved', state: state ?? to, steps };
    }
    return {
      outcome: 'waiting',
      state,
      to,
      voted: result.recordedVote,
      voters: await votersOn(perspective, run, state, to),
    };
  }

  async function subscribe(perspective: PerspectiveProxy, onChange: () => void): Promise<() => void> {
    let watch = watches.get(perspective);
    if (!watch) {
      const listeners = new Set<() => void>();
      const started = Promise.all(
        WATCHED_PREDICATES.map((predicate) =>
          perspective.subscribeQuery(`SELECT ?s ?o WHERE { ?s <${predicate}> ?o }`).then((sub) => {
            sub.onResult(() => {
              trace('flows', 'changed', { predicate });
              for (const listener of [...listeners]) listener();
            });
            return sub;
          }),
        ),
      );
      const created: Watch = { listeners, started };
      watches.set(perspective, created);
      // A watch that never started holds nothing; the next caller asks again.
      started.catch(() => {
        if (watches.get(perspective) === created) watches.delete(perspective);
      });
      watch = created;
    }
    const shared = watch;
    clearTimeout(shared.idle);
    shared.idle = undefined;
    shared.listeners.add(onChange);
    try {
      await shared.started;
    } catch (error) {
      shared.listeners.delete(onChange);
      throw error;
    }
    return () => {
      if (!shared.listeners.delete(onChange) || shared.listeners.size) return;
      clearTimeout(shared.idle);
      // Disposed after a grace period rather than at once: the executor shares one subscription
      // between identical queries, and a dispose racing a fresh subscribe would end that one too.
      shared.idle = setTimeout(() => {
        if (shared.listeners.size) return;
        if (watches.get(perspective) === shared) watches.delete(perspective);
        void shared.started.then(
          (subs) => subs.forEach((sub) => sub.dispose()),
          () => {},
        );
      }, WATCH_GRACE_MS);
    };
  }

  /** Every record going through a flow, as the contract reads them. */
  async function readItems(perspective: PerspectiveProxy, flowName: string): Promise<FlowItem[]> {
    const [flow, runs] = await Promise.all([stored(perspective, flowName), readRuns(perspective, flowName)]);
    // Not installed (yet): a member can watch before whoever administers the space has written it.
    if (!flow) return [];
    const proposals = await readProposals(perspective, runs);
    const needs = needsIn(flow);
    const subjects = [...new Set(runs.map((run) => run.subject))];
    return subjects.map((subject) => itemOf(runFor(runs, subject)!, proposals, needs));
  }

  return {
    capabilities: AD4M_FLOW_CAPABILITIES,

    async install(dataset, definition) {
      const problems = validateFlowDefinition(definition, AD4M_FLOW_CAPABILITIES);
      if (problems.length) throw new Error(`flows: ${problems.join(' ')}`);
      const perspective = proxy(dataset);
      const flow = toShaclFlow(definition);
      const desired = [...flow.toLinks(), ...registrationLinks(flow.name, flow.flowUri)];
      const desiredKeys = new Set(desired.map(keyOf));
      const held = await heldDefinition(perspective, flow.name, flow.flowUri, desired);
      const heldKeys = new Set(held.map((l) => keyOf(l.data)));

      const stale = held.filter((l) => !desiredKeys.has(keyOf(l.data)));
      const missing = desired.filter((l) => !heldKeys.has(keyOf(l)));
      trace('flows', 'install', { flow: definition.name, removing: stale.length, adding: missing.length });
      forget(perspective, definition.name);
      if (!stale.length && !missing.length) return;
      // Removed first: for as long as an old rule and its replacement sit side by side, the engine
      // refuses to move anything into that state.
      if (stale.length) await perspective.removeLinks(stale as never);
      if (missing.length) await perspective.addLinks(missing);
    },

    async list(dataset) {
      const perspective = proxy(dataset);
      const names = await perspective.sdnaFlows();
      const summaries = await Promise.all(
        [...new Set(names)].map(async (name): Promise<FlowSummary | null> => {
          const flow = await stored(perspective, name);
          if (!flow) return null;
          const runs = await readRuns(perspective, name);
          return { name, editable: isEditable(flow), records: new Set(runs.map((r) => r.subject)).size };
        }),
      );
      return summaries.filter((s): s is FlowSummary => s !== null);
    },

    async read(dataset, name) {
      const flow = await stored(proxy(dataset), name);
      return flow ? fromShaclFlow(flow) : null;
    },

    async remove(dataset, name) {
      const perspective = proxy(dataset);
      const flow = await stored(perspective, name);
      if (!flow) return;
      const records = new Set((await readRuns(perspective, name)).map((r) => r.subject)).size;
      if (records) throw new Error(`flows: "${name}" still has ${records} record(s) going through it`);
      const held = await heldDefinition(perspective, name, flow.flowUri);
      forget(perspective, name);
      if (held.length) await perspective.removeLinks(held as never);
      poke(perspective);
    },

    async start(dataset, flowName, subject, opts) {
      const perspective = proxy(dataset);
      try {
        const flow = await installed(perspective, flowName);
        const run = await runOfSubject(perspective, flowName, subject);
        const state = await place(perspective, flow, run, opts?.at);
        poke(perspective);
        return {
          subject,
          state,
          ...(run.startedAt !== undefined ? { since: run.startedAt } : {}),
          waiting: [],
          stalled: false,
        };
      } catch (error) {
        recordMissingMethod(error);
        throw asError(error);
      }
    },

    async move(dataset, flowName, subject, to, opts) {
      const perspective = proxy(dataset);
      let state: string | null = null;
      try {
        const flow = await installed(perspective, flowName);
        const run = await runOfSubject(perspective, flowName, subject);
        state = await place(perspective, flow, run, opts?.from);
        if (state === to) {
          poke(perspective);
          return { outcome: 'moved', state: to, steps: [] };
        }
        const result = await timed('propose', { run: run.id, to }, () =>
          perspective.proposeFlowTransition(run.id, to, opts?.note),
        );
        poke(perspective);
        return await toMoveResult(perspective, run, to, result);
      } catch (error) {
        const refusal = moveRefusal(error, to, state);
        if (refusal) return refusal;
        recordMissingMethod(error);
        throw asError(error);
      }
    },

    async withdraw(dataset, flowName, subject) {
      const perspective = proxy(dataset);
      const me = selfId();
      if (!me) throw new Error('flows: no agent is signed in');
      const run = runFor(await readRuns(perspective, flowName, subject), subject);
      if (!run) return 0;
      let withdrawn = 0;
      try {
        // Every proposal of the waiting moves the caller asked on — twins included — and none they
        // did not sign, nor any move that has happened.
        const proposals = await readProposals(perspective, [run]);
        for (const open of openMoves(proposals, run)) {
          for (const id of open.proposals) {
            if (!proposals.find((p) => p.id === id)?.voters.includes(me)) continue;
            withdrawn += await timed('withdraw', { proposal: id }, () => perspective.rejectFlowProposal(id));
          }
        }
      } finally {
        if (withdrawn) poke(perspective);
      }
      return withdrawn;
    },

    async watch(dataset, flowName, onChange) {
      const perspective = proxy(dataset);
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let reading = false;
      let again = false;

      // Coalesced: a peer's proposal arrives as several diffs, and a vote re-derives a cache a
      // moment later — one re-read covers the lot. A change arriving mid-read queues exactly one more.
      const reread = async () => {
        if (reading) {
          again = true;
          return;
        }
        reading = true;
        try {
          const items = await timed('read', { flow: flowName }, () => readItems(perspective, flowName));
          if (!stopped) onChange({ flow: flowName, items });
        } catch (error) {
          if (!recordMissingMethod(error)) console.warn('flows: could not read the records of', flowName, error);
        } finally {
          reading = false;
          if (again && !stopped) {
            again = false;
            schedule();
          }
        }
      };
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void reread(), REREAD_DEBOUNCE_MS);
      };

      const unsubscribe = await subscribe(perspective, schedule);
      void reread();
      return () => {
        stopped = true;
        clearTimeout(timer);
        unsubscribe();
      };
    },

    async history(dataset, flowName, subject) {
      const perspective = proxy(dataset);
      const run = runFor(await readRuns(perspective, flowName, subject), subject);
      if (!run) return [];
      return stepsOf(await readProposals(perspective, [run]), run);
    },
  };
}
