/**
 * Flows in memory — the contract as a plain state machine, the way a backend with one authority
 * would hold it.
 *
 * Each record going through a flow has a state, the asks waiting on it, and the moves it has made. An
 * ask is recorded against the move it asks for; when enough people who count have asked, and the
 * state's guards hold, the record moves and every ask out of the state it left is closed — a question
 * about a situation that no longer exists. Nothing is derived from votes after the fact, so a move
 * that happened stays happened, and two moves agreed at once cannot both be: the first to be agreed
 * is the move ({@link FlowCapabilities.contention} `first`).
 *
 * What it does not do: eligibility and guards are judged against the records as they are at the
 * moment of the ask, and evidence is a list of ids rather than a seal over their content. Both are
 * what a central backend would do too.
 */
import type {
  DatasetHandle,
  FlowCapabilities,
  FlowDefinition,
  FlowGuard,
  FlowItem,
  FlowMoveResult,
  FlowPort,
  FlowRole,
  FlowStep,
  FlowSummary,
  FlowView,
} from '@we/backend-shared';
import { allowedMoves, approvalsFor, guardsFor, validateFlowDefinition } from '@we/backend-shared';
import { getEntityForDataset } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

interface Ask {
  /** Voter and the tick they asked at, the first asker first. */
  voters: { did: string; at: number }[];
  askedAt: number;
  note?: string;
}

interface Item {
  subject: string;
  state: string;
  since: number;
  /** Waiting moves out of `state`, by the state they ask for. */
  asks: Map<string, Ask>;
  history: FlowStep[];
}

interface FlowStore {
  flows: Map<string, FlowDefinition>;
  /** By flow, then by subject. */
  items: Map<string, Map<string, Item>>;
  listeners: Set<() => void>;
}

type Row = Record<string, unknown> & { id?: string };
type Finder = { findAll(dataset: unknown, query?: Record<string, unknown>): Promise<Row[]> };

export const IN_MEMORY_FLOW_CAPABILITIES: FlowCapabilities = {
  requirements: ['approvals', 'guard'],
  enforcement: 'server',
  sealedEvidence: false,
  contention: 'first',
};

export function createInMemoryFlowPort(selfId: () => string | undefined): FlowPort {
  const stores = new WeakMap<object, FlowStore>();
  // A tick rather than the clock: two writes in the same millisecond must still have an order.
  let tick = 0;
  const now = () => ++tick;

  const storeFor = (dataset: DatasetHandle): FlowStore => {
    const key = dataset as object;
    let store = stores.get(key);
    if (!store) {
      store = { flows: new Map(), items: new Map(), listeners: new Set() };
      stores.set(key, store);
    }
    return store;
  };

  const me = (): string => {
    const did = selfId();
    if (!did) throw new Error('flows: no agent is signed in');
    return did;
  };

  const notify = (store: FlowStore) => {
    for (const listener of [...store.listeners]) listener();
  };

  const flowOf = (store: FlowStore, name: string): FlowDefinition => {
    const flow = store.flows.get(name);
    if (!flow) throw new Error(`flows: flow "${name}" is not installed`);
    return flow;
  };

  const itemsOf = (store: FlowStore, flow: string): Map<string, Item> => {
    let items = store.items.get(flow);
    if (!items) {
      items = new Map();
      store.items.set(flow, items);
    }
    return items;
  };

  // A to-one relation arrives as an id, a hydrated row, or a one-element list of either — the last
  // being how a record is written with one (`{ node: [id] }`).
  const idOf = (value: unknown): string | undefined => {
    const one = Array.isArray(value) ? value[0] : value;
    return typeof one === 'string' ? one : ((one as { id?: string } | null)?.id ?? undefined);
  };

  const matches = (row: Row, where: Record<string, string | number | boolean> | undefined) =>
    !where || Object.entries(where).every(([key, value]) => row[key] === value);

  const finder = (entity: string, dataset: DatasetHandle) => getEntityForDataset(entity, dataset) as Finder | undefined;

  /** Every concrete entity WE declares — where a flow over any record looks for one. */
  const entityNames = () =>
    Object.entries(CORE_MANIFEST.entities)
      .filter(([, schema]) => !schema.abstract)
      .map(([name]) => name);

  /** Everyone the role counts, for this subject. `null` when anybody counts. */
  async function eligible(dataset: DatasetHandle, role: FlowRole | undefined, subject: string) {
    if (!role) return null;
    const Entity = finder(role.entity, dataset);
    if (!Entity) return new Set<string>();
    const dids = new Set<string>();
    for (const row of await Entity.findAll(dataset)) {
      if (role.subjectField && idOf(row[role.subjectField]) !== subject) continue;
      if (!matches(row, role.where)) continue;
      const did = row[role.agentField];
      if (typeof did === 'string' && did) dids.add(did);
    }
    return dids;
  }

  /** The entity a subject is a record of, among those the flow names — or any entity, for a flow over any record. */
  async function entityOf(dataset: DatasetHandle, definition: FlowDefinition, subject: string) {
    const candidates = definition.subjects.length ? definition.subjects : entityNames();
    for (const name of candidates) {
      const rows = await finder(name, dataset)?.findAll(dataset, { where: { id: subject } });
      if (rows?.length) return name;
    }
    return undefined;
  }

  /** The records meeting one guard for this subject. */
  async function guardMatches(
    dataset: DatasetHandle,
    definition: FlowDefinition,
    guard: FlowGuard,
    subject: string,
  ): Promise<string[]> {
    const Entity = finder(guard.entity, dataset);
    if (!Entity) return [];
    let rows: Row[];
    if (guard.tie && 'relation' in guard.tie) {
      // Read as the drill-down it is: the subject's own relation, by name, never by how it is stored.
      const anchor = await entityOf(dataset, definition, subject);
      if (!anchor) return [];
      rows = await Entity.findAll(dataset, { scope: { anchor, via: guard.tie.relation, anchorId: subject } });
    } else {
      rows = await Entity.findAll(dataset);
    }
    const field = guard.tie && 'field' in guard.tie ? guard.tie.field : undefined;
    return rows
      .filter((row) => matches(row, guard.where) && (!field || idOf(row[field]) === subject))
      .map((row) => String(row.id ?? ''))
      .filter(Boolean);
  }

  /** Whether every guard on a state holds for this subject, and the records that make them hold. */
  async function guardsHold(dataset: DatasetHandle, definition: FlowDefinition, guards: FlowGuard[], subject: string) {
    const evidence: string[] = [];
    for (const guard of guards) {
      const ids = await guardMatches(dataset, definition, guard, subject);
      const min = guard.min ?? 1;
      if (ids.length < min || (guard.max !== undefined && ids.length > guard.max)) return { ok: false, evidence };
      evidence.push(...ids);
    }
    return { ok: true, evidence };
  }

  const view = (item: Item): FlowItem => ({
    subject: item.subject,
    state: item.state,
    since: item.since,
    waiting: [...item.asks.entries()]
      .sort(([, a], [, b]) => a.askedAt - b.askedAt)
      .map(([to, ask]) => ({
        to,
        voters: ask.voters.map((v) => v.did),
        askedAt: ask.askedAt,
        ...(ask.note ? { note: ask.note } : {}),
      })),
    stalled: false,
  });

  /** The subject's item, entering it into the flow first — at `at` when that is one of its states. */
  function enter(store: FlowStore, definition: FlowDefinition, subject: string, at?: string): Item {
    const items = itemsOf(store, definition.name);
    const existing = items.get(subject);
    if (existing) return existing;
    const start = at && definition.states.some((s) => s.name === at) ? at : definition.states[0]?.name;
    if (!start) throw new Error(`flows: flow "${definition.name}" has no states`);
    const item: Item = { subject, state: start, since: now(), asks: new Map(), history: [] };
    items.set(subject, item);
    return item;
  }

  return {
    capabilities: IN_MEMORY_FLOW_CAPABILITIES,

    async install(dataset, definition) {
      const problems = validateFlowDefinition(definition, IN_MEMORY_FLOW_CAPABILITIES);
      if (problems.length) throw new Error(`flows: ${problems.join(' ')}`);
      const store = storeFor(dataset);
      store.flows.set(definition.name, structuredClone(definition));
      notify(store);
    },

    async list(dataset) {
      const store = storeFor(dataset);
      return [...store.flows.keys()].map((name): FlowSummary => ({
        name,
        editable: true,
        records: store.items.get(name)?.size ?? 0,
      }));
    },

    async read(dataset, name) {
      const flow = storeFor(dataset).flows.get(name);
      return flow ? structuredClone(flow) : null;
    },

    async remove(dataset, name) {
      const store = storeFor(dataset);
      const records = store.items.get(name)?.size ?? 0;
      if (records) throw new Error(`flows: "${name}" still has ${records} record(s) going through it`);
      store.flows.delete(name);
      store.items.delete(name);
      notify(store);
    },

    async start(dataset, flow, subject, opts) {
      const store = storeFor(dataset);
      const before = itemsOf(store, flow).has(subject);
      const item = enter(store, flowOf(store, flow), subject, opts?.at);
      if (!before) notify(store);
      return view(item);
    },

    async move(dataset, flow, subject, to, opts): Promise<FlowMoveResult> {
      const store = storeFor(dataset);
      const did = me();
      const definition = flowOf(store, flow);
      const fresh = !itemsOf(store, flow).has(subject);
      const item = enter(store, definition, subject, opts?.from);
      if (item.state === to) {
        if (fresh) notify(store);
        return { outcome: 'moved', state: to, steps: [] };
      }
      if (!allowedMoves(definition, item.state).includes(to)) {
        if (fresh) notify(store);
        return { outcome: 'refused', reason: 'not-allowed', state: item.state };
      }
      const target = definition.states.find((s) => s.name === to);
      const guards = await guardsHold(dataset, definition, guardsFor(target), subject);
      if (!guards.ok) {
        if (fresh) notify(store);
        return { outcome: 'refused', reason: 'unmet', state: item.state };
      }

      let ask = item.asks.get(to);
      if (!ask) {
        ask = { voters: [], askedAt: now(), ...(opts?.note ? { note: opts.note } : {}) };
        item.asks.set(to, ask);
      }
      const voted = !ask.voters.some((v) => v.did === did);
      if (voted) ask.voters.push({ did, at: now() });

      const { count, from } = approvalsFor(target);
      const counted = await eligible(dataset, from, subject);
      const agreed = ask.voters.map((v) => v.did).filter((v) => !counted || counted.has(v));
      if (agreed.length < count) {
        notify(store);
        return { outcome: 'waiting', state: item.state, to, voted, voters: ask.voters.map((v) => v.did) };
      }
      const step: FlowStep = {
        from: item.state,
        to,
        voters: agreed.slice(0, count),
        at: ask.askedAt,
        evidence: guards.evidence,
        ...(ask.note ? { note: ask.note } : {}),
      };
      item.history.push(step);
      item.state = to;
      item.asks.clear();
      notify(store);
      return { outcome: 'moved', state: to, steps: [step] };
    },

    async withdraw(dataset, flow, subject) {
      const store = storeFor(dataset);
      const did = me();
      const item = itemsOf(store, flow).get(subject);
      if (!item) return 0;
      let withdrawn = 0;
      for (const [to, ask] of item.asks) {
        const kept = ask.voters.filter((v) => v.did !== did);
        withdrawn += ask.voters.length - kept.length;
        if (kept.length) ask.voters = kept;
        else item.asks.delete(to);
      }
      if (withdrawn) notify(store);
      return withdrawn;
    },

    async watch(dataset, flow, onChange) {
      const store = storeFor(dataset);
      let stopped = false;
      const push = () => {
        const current: FlowView = { flow, items: [...itemsOf(store, flow).values()].map(view) };
        // Asynchronously, as a backend that notifies over a socket would: a caller must not depend
        // on hearing about its own write before the call that made it returns.
        queueMicrotask(() => {
          if (!stopped) onChange(current);
        });
      };
      store.listeners.add(push);
      push();
      return () => {
        stopped = true;
        store.listeners.delete(push);
      };
    },

    async history(dataset, flow, subject) {
      const item = itemsOf(storeFor(dataset), flow).get(subject);
      return item ? structuredClone(item.history) : [];
    },
  };
}
