/**
 * The flow port, over AD4M's flow engine.
 *
 * AD4M derives a run's state on every replica from the signed proposals and votes it holds, so what
 * this file does is mostly translation — a neutral definition into a `SHACLFlow`, the engine's
 * results back into the contract's words — plus the four things the SDK leaves to its caller.
 *
 * ## What the SDK leaves to its caller
 *
 * **Installing is additive.** `addFlow` writes a definition's links and removes none. Re-installing
 * a changed rule would leave the old `consensusRule` beside the new one, and the engine refuses to
 * move a run at all while one state holds two different rules (a peer shadowing a rule must not be
 * able to downgrade it). So {@link install} diffs: it reads what the dataset holds of the definition,
 * removes what the new one does not say, and adds what it does. Only predicates a definition writes
 * are ever removed — a flow's URI is also the source of links that are not its definition, such as
 * its receipt index.
 *
 * **Starting is not idempotent.** `FlowInstance.start` mints a run every time it is called, so
 * {@link start} looks first and treats the earliest run as the subject's, on the rule every reader
 * applies (`runFor`).
 *
 * **Votes are not on the model.** `FlowTransitionProposal` carries the proposer and nothing about who
 * agreed. A vote is an `acceptedBy` link naming its voter, and counts only when that voter signed it
 * — the engine's own rule, which stops one agent writing votes for others. Read here the same way.
 *
 * **There is no flow subscription.** A run's state is a cache the executor rewrites when it derives
 * one — after a local vote, or ~300 ms after a peer's arrives — so watching means watching the links
 * that change when anything about a run does, and re-reading.
 *
 * ## What it does not do
 *
 * The definition itself is ordinary links, which any member can rewrite; the engine reads whatever
 * the dataset holds. That is an engine property, recorded against the engine (coasys/ad4m#1080), and
 * nothing here can close it.
 */
import {
  FlowInstance,
  type FlowProposeResult as Ad4mFlowProposeResult,
  FlowTransitionProposal,
  Link,
  type LinkExpression,
  LinkQuery,
  Literal,
  type PerspectiveProxy,
  SHACLFlow,
} from '@coasys/ad4m';
import type {
  DatasetHandle,
  FlowDefinition,
  FlowPort,
  FlowProposal,
  FlowProposeResult,
  FlowRun,
  FlowSnapshot,
  FlowStateDefinition,
} from '@we/backend-shared';
import { runFor } from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

const proxy = (dataset: DatasetHandle) => dataset as PerspectiveProxy;

/** Where a flow's URIs live: `${namespace}${name}Flow`, which the SDK reads a name back out of. */
export const FLOW_NAMESPACE = 'we://flow/';

const HAS_STATE = 'ad4m://hasState';
const HAS_TRANSITION = 'ad4m://hasTransition';
const ACCEPTED_BY = 'ad4m://acceptedBy';
const RESOLVED_AS = 'ad4m://flow/resolved_as';
const FIRED = 'fired';

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

// ─── Definition ────────────────────────────────────────────────────────────────

/**
 * A state's rule, in the engine's shape — or nothing, where the engine's own default (one vote,
 * from anybody) already says it.
 *
 * Built key by key in a fixed order, `where` sorted, because the engine compares rules by their
 * text: two installs of one definition must write the same bytes or the second looks like a rival
 * rule rather than the same one.
 */
function ruleFor(state: FlowStateDefinition): Record<string, unknown> | undefined {
  const n = Math.max(1, Math.floor(state.approvals ?? 1));
  if (n === 1 && !state.role) return undefined;
  const rule: Record<string, unknown> = { n };
  if (state.role) {
    const where: Record<string, string | number | boolean> = { ...(state.role.where ?? {}) };
    // `$flow.base` is the engine's name for the run's subject, substituted when the rule is read.
    if (state.role.subjectField) where[state.role.subjectField] = '$flow.base';
    const sorted = Object.fromEntries(
      Object.keys(where)
        .sort()
        .map((key) => [key, where[key]]),
    );
    rule.fromRole = { className: state.role.entity, where: sorted, didProperty: state.role.agentField };
  }
  return rule;
}

export function toShaclFlow(definition: FlowDefinition): SHACLFlow {
  const flow = new SHACLFlow(definition.name, FLOW_NAMESPACE);
  flow.inputTypes = [...definition.subjects];
  if (definition.hint) flow.interpretationHint = definition.hint;
  definition.states.forEach((state, index) => {
    const rule = ruleFor(state);
    flow.addState({
      name: state.name,
      // An ordering key, and the engine starts every run in the lowest — which is why the contract
      // says the first state is where runs begin.
      value: index,
      ...(state.hint ? { interpretationHint: state.hint } : {}),
      ...(rule ? { consensusRule: rule as never } : {}),
    });
  });
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

/** What `addFlow` writes beside the definition: the dataset's register of flows by name. */
function registrationLinks(flow: SHACLFlow): Link[] {
  const name = Literal.from(flow.name).toUrl();
  return [
    new Link({ source: 'ad4m://self', predicate: 'ad4m://has_flow', target: name }),
    new Link({ source: name, predicate: 'ad4m://flow_uri', target: flow.flowUri }),
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

// ─── Reading ──────────────────────────────────────────────────────────────────

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

async function readSnapshot(perspective: PerspectiveProxy, flowName: string): Promise<FlowSnapshot> {
  const instances = await FlowInstance.findAll(perspective, { flowName });
  const runs: FlowRun[] = instances.map((instance) => {
    const startedAt = instance.startedAtMillis ?? millisOf((instance.record as { createdAt?: unknown }).createdAt);
    return {
      id: instance.uri,
      subject: instance.subject,
      state: instance.currentStateName ?? '',
      ...(startedAt !== undefined ? { startedAt } : {}),
    };
  });
  if (!runs.length) return { runs, proposals: [] };

  const runIds = new Set(runs.map((run) => run.id));
  let rows: FlowTransitionProposal[] = [];
  try {
    rows = await FlowTransitionProposal.findAll(perspective);
  } catch (error) {
    if (!unregistered(error)) throw error;
  }
  const mine = rows.filter((row) => runIds.has(row.flowInstance));
  if (!mine.length) return { runs, proposals: [] };

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

  const proposals: FlowProposal[] = mine.map((row) => {
    const proposedAt = millisOf((row as { createdAt?: unknown }).createdAt);
    const voters = [row.proposer, ...(votersOf.get(row.id) ?? []).filter((did) => did !== row.proposer)];
    return {
      id: row.id,
      run: row.flowInstance,
      from: row.fromState,
      to: row.toState,
      proposer: row.proposer,
      voters,
      ...(row.rationale ? { rationale: row.rationale } : {}),
      ...(proposedAt !== undefined ? { proposedAt } : {}),
      settled: fired.has(row.id),
    };
  });
  return { runs, proposals };
}

function toResult(result: Ad4mFlowProposeResult): FlowProposeResult {
  return {
    proposal: result.proposalUri,
    opened: result.minted,
    voted: result.recordedVote,
    moves: result.outcomes.map((outcome) => ({
      from: outcome.fromState,
      to: outcome.toState,
      voters: [...outcome.voters],
    })),
    state: result.derivedState,
    stalled: result.contested,
  };
}

/** The SDK throws strings in places; the contract rejects with errors. */
const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

// ─── Watching ─────────────────────────────────────────────────────────────────

interface Watch {
  listeners: Set<() => void>;
  started: Promise<Array<{ dispose(): void }>>;
  idle?: ReturnType<typeof setTimeout>;
}

// ─── The port ─────────────────────────────────────────────────────────────────

export function createAd4mFlowPort(): FlowPort {
  /** One set of subscriptions per perspective, shared by every watcher of it. */
  const watches = new Map<PerspectiveProxy, Watch>();

  /** Tell every watcher of a perspective to re-read — after a write of our own, which a cache may lag. */
  const poke = (perspective: PerspectiveProxy) => {
    for (const listener of [...(watches.get(perspective)?.listeners ?? [])]) listener();
  };

  async function subscribe(perspective: PerspectiveProxy, onChange: () => void): Promise<() => void> {
    let watch = watches.get(perspective);
    if (!watch) {
      const listeners = new Set<() => void>();
      const started = Promise.all(
        WATCHED_PREDICATES.map((predicate) =>
          perspective.subscribeQuery(`SELECT ?s ?o WHERE { ?s <${predicate}> ?o }`).then((sub) => {
            sub.onResult(() => {
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

  return {
    async install(dataset, definition) {
      const perspective = proxy(dataset);
      const flow = toShaclFlow(definition);
      const desired = [...flow.toLinks(), ...registrationLinks(flow)];
      const desiredKeys = new Set(desired.map(keyOf));

      // What the dataset holds of this definition: the flow's own links, and those of every state
      // and transition it names now or named before.
      const own = await perspective.get(new LinkQuery({ source: flow.flowUri }));
      const children = new Set<string>();
      for (const link of [...own.map((l) => l.data), ...desired]) {
        if (link.predicate === HAS_STATE || link.predicate === HAS_TRANSITION) children.add(link.target);
      }
      const childLinks = (
        await Promise.all([...children].map((child) => perspective.get(new LinkQuery({ source: child }))))
      ).flat();
      const [entry, mapping] = registrationLinks(flow);
      const [entries, mappings] = await Promise.all([
        perspective.get(new LinkQuery({ source: entry.source, predicate: entry.predicate })),
        perspective.get(new LinkQuery({ source: mapping.source, predicate: mapping.predicate })),
      ]);
      const held = [
        ...[...own, ...childLinks].filter((l) => DEFINITION_PREDICATES.has(l.data.predicate ?? '')),
        // The register lists every flow in the dataset; only this name's entry is ours to judge.
        ...entries.filter((l) => keyOf(l.data) === keyOf(entry)),
        // Every URI this name maps to: one pointing anywhere else is stale and goes.
        ...mappings,
      ];
      const heldKeys = new Set(held.map((l) => keyOf(l.data)));

      const stale = held.filter((l) => !desiredKeys.has(keyOf(l.data)));
      const missing = desired.filter((l) => !heldKeys.has(keyOf(l)));
      if (!stale.length && !missing.length) return;
      // Removed first: for as long as an old rule and its replacement sit side by side, the engine
      // refuses to move anything into that state.
      if (stale.length) await perspective.removeLinks(stale as never);
      if (missing.length) await perspective.addLinks(missing);
    },

    async start(dataset, flowName, subject) {
      const perspective = proxy(dataset);
      try {
        const existing = await FlowInstance.findAll(perspective, { flowName, subject });
        const runs: FlowRun[] = existing.map((instance) => ({
          id: instance.uri,
          subject: instance.subject,
          state: instance.currentStateName ?? '',
          ...(instance.startedAtMillis !== undefined ? { startedAt: instance.startedAtMillis } : {}),
        }));
        const found = runFor(runs, subject);
        if (found) return found;
        const started = await FlowInstance.start(perspective, flowName, subject);
        poke(perspective);
        return {
          id: started.uri,
          subject,
          state: started.currentStateName ?? '',
          ...(started.startedAtMillis !== undefined ? { startedAt: started.startedAtMillis } : {}),
        };
      } catch (error) {
        recordMissingMethod(error);
        throw asError(error);
      }
    },

    async propose(dataset, run, to, rationale) {
      const perspective = proxy(dataset);
      try {
        const result = await perspective.proposeFlowTransition(run, to, rationale);
        poke(perspective);
        return toResult(result);
      } catch (error) {
        recordMissingMethod(error);
        throw asError(error);
      }
    },

    async withdraw(dataset, proposal) {
      const perspective = proxy(dataset);
      try {
        const removed = await perspective.rejectFlowProposal(proposal);
        poke(perspective);
        return removed;
      } catch (error) {
        recordMissingMethod(error);
        throw asError(error);
      }
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
          const snapshot = await readSnapshot(perspective, flowName);
          if (!stopped) onChange(snapshot);
        } catch (error) {
          if (!recordMissingMethod(error)) console.warn('flows: could not read the runs of', flowName, error);
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
  };
}
