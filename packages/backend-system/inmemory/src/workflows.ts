/**
 * Workflows in memory — the contract as a plain state machine, the way a backend with one authority
 * would hold it.
 *
 * Each record going through a workflow has a state, the asks waiting on it, and the moves it has made.
 * An ask is recorded against the move it asks for; when enough people who count have asked, and the
 * state's evidence holds, the record moves and every ask out of the state it left is closed — a
 * question about a situation that no longer exists. Nothing is derived from votes after the fact, so a
 * move that happened stays happened, and two moves agreed at once cannot both be: the first to be
 * agreed is the move ({@link WorkflowCapabilities.contention} `first`).
 *
 * What it does not do: eligibility and evidence are judged against the records as they are at the
 * moment of the ask, and evidence is a list of ids rather than a seal over their content. Both are
 * what a central backend would do too.
 */
import type {
  AgentQuery,
  DatasetHandle,
  EvidenceRequirement,
  Move,
  MoveResult,
  WorkflowCapabilities,
  WorkflowDefinition,
  WorkflowItem,
  WorkflowPort,
  WorkflowSummary,
  WorkflowView,
} from '@we/backend-shared';
import { allowedMoves, approvalsFor, evidenceFor, validateWorkflowDefinition } from '@we/backend-shared';
import { getEntityForDataset } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

interface Ask {
  /** Approver and the tick they asked at, the first asker first. */
  approvers: { did: string; at: number }[];
  askedAt: number;
  note?: string;
}

interface Item {
  record: string;
  state: string;
  since: number;
  /** Waiting moves out of `state`, by the state they ask for. */
  asks: Map<string, Ask>;
  history: Move[];
}

interface WorkflowStore {
  workflows: Map<string, WorkflowDefinition>;
  /** By workflow, then by record. */
  items: Map<string, Map<string, Item>>;
  listeners: Set<() => void>;
}

type Row = Record<string, unknown> & { id?: string };
type Finder = { findAll(dataset: unknown, query?: Record<string, unknown>): Promise<Row[]> };

export const IN_MEMORY_WORKFLOW_CAPABILITIES: WorkflowCapabilities = {
  requirements: ['approvals', 'evidence'],
  enforcement: 'server',
  sealedEvidence: false,
  contention: 'first',
};

export function createInMemoryWorkflowPort(selfId: () => string | undefined): WorkflowPort {
  const stores = new WeakMap<object, WorkflowStore>();
  // A tick rather than the clock: two writes in the same millisecond must still have an order.
  let tick = 0;
  const now = () => ++tick;

  const storeFor = (dataset: DatasetHandle): WorkflowStore => {
    const key = dataset as object;
    let store = stores.get(key);
    if (!store) {
      store = { workflows: new Map(), items: new Map(), listeners: new Set() };
      stores.set(key, store);
    }
    return store;
  };

  const me = (): string => {
    const did = selfId();
    if (!did) throw new Error('workflows: no agent is signed in');
    return did;
  };

  const notify = (store: WorkflowStore) => {
    for (const listener of [...store.listeners]) listener();
  };

  const workflowOf = (store: WorkflowStore, name: string): WorkflowDefinition => {
    const workflow = store.workflows.get(name);
    if (!workflow) throw new Error(`workflows: workflow "${name}" is not installed`);
    return workflow;
  };

  const itemsOf = (store: WorkflowStore, workflow: string): Map<string, Item> => {
    let items = store.items.get(workflow);
    if (!items) {
      items = new Map();
      store.items.set(workflow, items);
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

  /** Every concrete entity WE declares — where a workflow over any record looks for one. */
  const entityNames = () =>
    Object.entries(CORE_MANIFEST.entities)
      .filter(([, schema]) => !schema.abstract)
      .map(([name]) => name);

  /** Everyone the query counts, for this record. `null` when anybody counts. */
  async function eligible(dataset: DatasetHandle, query: AgentQuery | undefined, record: string) {
    if (!query) return null;
    const Entity = finder(query.entity, dataset);
    if (!Entity) return new Set<string>();
    const dids = new Set<string>();
    for (const row of await Entity.findAll(dataset)) {
      if (query.recordField && idOf(row[query.recordField]) !== record) continue;
      if (!matches(row, query.where)) continue;
      const did = row[query.agentField];
      if (typeof did === 'string' && did) dids.add(did);
    }
    return dids;
  }

  /** The entity a record is one of, among those the workflow names — or any entity, for a workflow over any record. */
  async function entityOf(dataset: DatasetHandle, definition: WorkflowDefinition, record: string) {
    const candidates = definition.entities.length ? definition.entities : entityNames();
    for (const name of candidates) {
      const rows = await finder(name, dataset)?.findAll(dataset, { where: { id: record } });
      if (rows?.length) return name;
    }
    return undefined;
  }

  /** The records meeting one evidence requirement for this record. */
  async function evidenceMatches(
    dataset: DatasetHandle,
    definition: WorkflowDefinition,
    evidence: EvidenceRequirement,
    record: string,
  ): Promise<string[]> {
    const Entity = finder(evidence.entity, dataset);
    if (!Entity) return [];
    let rows: Row[];
    if (evidence.via && 'relation' in evidence.via) {
      // Read as the drill-down it is: the record's own relation, by name, never by how it is stored.
      const anchor = await entityOf(dataset, definition, record);
      if (!anchor) return [];
      rows = await Entity.findAll(dataset, { scope: { anchor, via: evidence.via.relation, anchorId: record } });
    } else {
      rows = await Entity.findAll(dataset);
    }
    const field = evidence.via && 'field' in evidence.via ? evidence.via.field : undefined;
    return rows
      .filter((row) => matches(row, evidence.where) && (!field || idOf(row[field]) === record))
      .map((row) => String(row.id ?? ''))
      .filter(Boolean);
  }

  /** Whether all the evidence a state asks for holds for this record, and the records that make it hold. */
  async function evidenceHolds(
    dataset: DatasetHandle,
    definition: WorkflowDefinition,
    requirements: EvidenceRequirement[],
    record: string,
  ) {
    const evidence: string[] = [];
    for (const requirement of requirements) {
      const ids = await evidenceMatches(dataset, definition, requirement, record);
      const min = requirement.min ?? 1;
      if (ids.length < min || (requirement.max !== undefined && ids.length > requirement.max))
        return { ok: false, evidence };
      evidence.push(...ids);
    }
    return { ok: true, evidence };
  }

  const view = (item: Item): WorkflowItem => ({
    record: item.record,
    state: item.state,
    since: item.since,
    waiting: [...item.asks.entries()]
      .sort(([, a], [, b]) => a.askedAt - b.askedAt)
      .map(([to, ask]) => ({
        to,
        approvers: ask.approvers.map((v) => v.did),
        askedAt: ask.askedAt,
        ...(ask.note ? { note: ask.note } : {}),
      })),
    stalled: false,
  });

  /** The record's item, entering it into the workflow first — at `at` when that is one of its states. */
  function enter(store: WorkflowStore, definition: WorkflowDefinition, record: string, at?: string): Item {
    const items = itemsOf(store, definition.name);
    const existing = items.get(record);
    if (existing) return existing;
    const start = at && definition.states.some((s) => s.name === at) ? at : definition.states[0]?.name;
    if (!start) throw new Error(`workflows: workflow "${definition.name}" has no states`);
    const item: Item = { record, state: start, since: now(), asks: new Map(), history: [] };
    items.set(record, item);
    return item;
  }

  return {
    capabilities: IN_MEMORY_WORKFLOW_CAPABILITIES,

    async install(dataset, definition) {
      const problems = validateWorkflowDefinition(definition, IN_MEMORY_WORKFLOW_CAPABILITIES);
      if (problems.length) throw new Error(`workflows: ${problems.join(' ')}`);
      const store = storeFor(dataset);
      store.workflows.set(definition.name, structuredClone(definition));
      notify(store);
    },

    async list(dataset) {
      const store = storeFor(dataset);
      return [...store.workflows.keys()].map((name): WorkflowSummary => ({
        name,
        editable: true,
        records: store.items.get(name)?.size ?? 0,
      }));
    },

    async read(dataset, name) {
      const workflow = storeFor(dataset).workflows.get(name);
      return workflow ? structuredClone(workflow) : null;
    },

    async remove(dataset, name) {
      const store = storeFor(dataset);
      const records = store.items.get(name)?.size ?? 0;
      if (records) throw new Error(`workflows: "${name}" still has ${records} record(s) going through it`);
      store.workflows.delete(name);
      store.items.delete(name);
      notify(store);
    },

    async start(dataset, workflow, record, opts) {
      const store = storeFor(dataset);
      const before = itemsOf(store, workflow).has(record);
      const item = enter(store, workflowOf(store, workflow), record, opts?.at);
      if (!before) notify(store);
      return view(item);
    },

    async move(dataset, workflow, record, to, opts): Promise<MoveResult> {
      const store = storeFor(dataset);
      const did = me();
      const definition = workflowOf(store, workflow);
      const fresh = !itemsOf(store, workflow).has(record);
      const item = enter(store, definition, record, opts?.from);
      if (item.state === to) {
        if (fresh) notify(store);
        return { outcome: 'moved', state: to, moves: [] };
      }
      if (!allowedMoves(definition, item.state).includes(to)) {
        if (fresh) notify(store);
        return { outcome: 'refused', reason: 'not-allowed', state: item.state };
      }
      const target = definition.states.find((s) => s.name === to);
      const evidence = await evidenceHolds(dataset, definition, evidenceFor(target), record);
      if (!evidence.ok) {
        if (fresh) notify(store);
        return { outcome: 'refused', reason: 'unmet', state: item.state };
      }

      let ask = item.asks.get(to);
      if (!ask) {
        ask = { approvers: [], askedAt: now(), ...(opts?.note ? { note: opts.note } : {}) };
        item.asks.set(to, ask);
      }
      const approved = !ask.approvers.some((v) => v.did === did);
      if (approved) ask.approvers.push({ did, at: now() });

      const { count, from } = approvalsFor(target);
      const counted = await eligible(dataset, from, record);
      const agreed = ask.approvers.map((v) => v.did).filter((v) => !counted || counted.has(v));
      if (agreed.length < count) {
        notify(store);
        return { outcome: 'waiting', state: item.state, to, approved, approvers: ask.approvers.map((v) => v.did) };
      }
      const move: Move = {
        from: item.state,
        to,
        approvers: agreed.slice(0, count),
        at: ask.askedAt,
        evidence: evidence.evidence,
        ...(ask.note ? { note: ask.note } : {}),
      };
      item.history.push(move);
      item.state = to;
      item.asks.clear();
      notify(store);
      return { outcome: 'moved', state: to, moves: [move] };
    },

    async withdraw(dataset, workflow, record) {
      const store = storeFor(dataset);
      const did = me();
      const item = itemsOf(store, workflow).get(record);
      if (!item) return 0;
      let withdrawn = 0;
      for (const [to, ask] of item.asks) {
        const kept = ask.approvers.filter((v) => v.did !== did);
        withdrawn += ask.approvers.length - kept.length;
        if (kept.length) ask.approvers = kept;
        else item.asks.delete(to);
      }
      if (withdrawn) notify(store);
      return withdrawn;
    },

    async watch(dataset, workflow, onChange) {
      const store = storeFor(dataset);
      let stopped = false;
      const push = () => {
        const current: WorkflowView = { workflow, items: [...itemsOf(store, workflow).values()].map(view) };
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

    async history(dataset, workflow, record) {
      const item = itemsOf(storeFor(dataset), workflow).get(record);
      return item ? structuredClone(item.history) : [];
    },
  };
}
