/**
 * Flows in memory — enough of the semantics to test a surface that asks a group to agree, with no
 * process to start.
 *
 * What it keeps: a run starts in its flow's first state; a move happens once the state it enters
 * has as many distinct approvals, from agents its role counts, as the state asks for; approvals are
 * counted per move rather than per proposal, so twins add up; a move that happened consumes the
 * proposals that made it, so a later visit to the same state asks again; withdrawing the vote that
 * completed a move undoes it, because state is derived from the votes present every time it is read.
 *
 * What it does not: eligibility is judged against the role records as they are *now*, where a real
 * backend judges each vote as of the moment it was cast; and it never reports a run as stuck, because
 * it never refuses to choose between two moves — the earlier one wins. Both are simplifications a
 * test of a surface does not need, and reproducing them would make this a second engine to keep in
 * step with the first. Anything that depends on them belongs in a test against the real backend.
 */
import type {
  DatasetHandle,
  FlowDefinition,
  FlowMove,
  FlowPort,
  FlowProposal,
  FlowProposeResult,
  FlowRun,
  FlowSnapshot,
} from '@we/backend-shared';
import { runFor } from '@we/backend-shared';
import { getEntityForDataset } from '@we/entities';

interface StoredProposal {
  id: string;
  run: string;
  from: string;
  to: string;
  proposer: string;
  /** Voter and the tick they voted at, the proposer first. */
  votes: { did: string; at: number }[];
  rationale?: string;
  proposedAt: number;
}

interface StoredRun {
  id: string;
  flow: string;
  subject: string;
  startedAt: number;
}

interface FlowStore {
  flows: Map<string, FlowDefinition>;
  runs: StoredRun[];
  proposals: StoredProposal[];
  listeners: Set<() => void>;
}

interface Derived {
  state: string;
  /** Proposals consumed by a move that happened, in the order the moves happened. */
  settled: Set<string>;
  moves: FlowMove[];
}

export function createInMemoryFlowPort(selfId: () => string | undefined): FlowPort {
  const stores = new WeakMap<object, FlowStore>();
  // A tick rather than the clock: two writes in the same millisecond must still have an order.
  let tick = 0;
  let serial = 0;
  const now = () => ++tick;

  const storeFor = (dataset: DatasetHandle): FlowStore => {
    const key = dataset as object;
    let store = stores.get(key);
    if (!store) {
      store = { flows: new Map(), runs: [], proposals: [], listeners: new Set() };
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

  const runById = (store: FlowStore, id: string): StoredRun => {
    const run = store.runs.find((r) => r.id === id);
    if (!run) throw new Error(`flows: no run ${id}`);
    return run;
  };

  const flowOf = (store: FlowStore, run: StoredRun): FlowDefinition => {
    const flow = store.flows.get(run.flow);
    if (!flow) throw new Error(`flows: flow "${run.flow}" is not installed`);
    return flow;
  };

  // A to-one relation arrives as an id, a hydrated row, or a one-element list of either — the last
  // being how a record is written with one (`{ node: [id] }`).
  const idOf = (value: unknown): string | undefined => {
    const one = Array.isArray(value) ? value[0] : value;
    return typeof one === 'string' ? one : ((one as { id?: string } | null)?.id ?? undefined);
  };

  /** Everyone the state's role counts, for this run's subject. `null` when anybody counts. */
  async function eligible(dataset: DatasetHandle, flow: FlowDefinition, to: string, subject: string) {
    const role = flow.states.find((s) => s.name === to)?.role;
    if (!role) return null;
    const Entity = getEntityForDataset(role.entity, dataset) as
      { findAll(dataset: unknown): Promise<Record<string, unknown>[]> } | undefined;
    if (!Entity) return new Set<string>();
    const rows = await Entity.findAll(dataset);
    const dids = new Set<string>();
    for (const row of rows) {
      if (role.subjectField && idOf(row[role.subjectField]) !== subject) continue;
      if (role.where && Object.entries(role.where).some(([key, value]) => row[key] !== value)) continue;
      const did = row[role.agentField];
      if (typeof did === 'string' && did) dids.add(did);
    }
    return dids;
  }

  /**
   * Where a run stands: walk from the first state, taking whichever open move reached its approvals
   * earliest, until none has.
   */
  async function derive(dataset: DatasetHandle, store: FlowStore, run: StoredRun): Promise<Derived> {
    const flow = flowOf(store, run);
    let state = flow.states[0]?.name ?? '';
    const settled = new Set<string>();
    const moves: FlowMove[] = [];
    const roles = new Map<string, Set<string> | null>();
    const countedFor = async (to: string) => {
      if (!roles.has(to)) roles.set(to, await eligible(dataset, flow, to, run.subject));
      return roles.get(to)!;
    };
    const proposals = store.proposals.filter((p) => p.run === run.id);

    // Bounded by the proposals: every step consumes at least one, so the walk cannot cycle forever.
    for (let step = 0; step <= proposals.length; step++) {
      let best: { to: string; at: number; voters: string[]; ids: string[] } | undefined;
      const edges = new Set(flow.transitions.filter((t) => t.from === state).map((t) => t.to));
      const byTarget = new Map<string, StoredProposal[]>();
      for (const p of proposals) {
        if (settled.has(p.id) || p.from !== state || !edges.has(p.to)) continue;
        byTarget.set(p.to, [...(byTarget.get(p.to) ?? []), p]);
      }
      for (const [to, twins] of byTarget) {
        const needs = Math.max(1, flow.states.find((s) => s.name === to)?.approvals ?? 1);
        const counted = await countedFor(to);
        // Every counted vote across the twins, in the order it was cast; the first `needs` distinct
        // agents make the move, and only the proposals their votes sit on are consumed by it. A
        // proposal nobody needed survives to answer the next visit to this state — the real
        // backend's rule, and the reason a card sent back and forth is not asked twice.
        const pooled = twins
          .flatMap((p) => p.votes.map((vote) => ({ ...vote, proposal: p.id })))
          .filter((vote) => !counted || counted.has(vote.did))
          .sort((a, b) => a.at - b.at || (a.did < b.did ? -1 : 1));
        const voters: string[] = [];
        const ids: string[] = [];
        let at: number | undefined;
        for (const vote of pooled) {
          if (voters.includes(vote.did)) continue;
          voters.push(vote.did);
          if (!ids.includes(vote.proposal)) ids.push(vote.proposal);
          if (voters.length >= needs) {
            at = vote.at;
            break;
          }
        }
        if (at === undefined) continue;
        if (!best || at < best.at || (at === best.at && to < best.to)) best = { to, at, voters, ids };
      }
      if (!best) break;
      for (const id of best.ids) settled.add(id);
      moves.push({ from: state, to: best.to, voters: best.voters });
      state = best.to;
    }
    return { state, settled, moves };
  }

  async function snapshot(dataset: DatasetHandle, store: FlowStore, flow: string): Promise<FlowSnapshot> {
    const runs: FlowRun[] = [];
    const proposals: FlowProposal[] = [];
    for (const run of store.runs.filter((r) => r.flow === flow)) {
      const derived = await derive(dataset, store, run);
      runs.push({ id: run.id, subject: run.subject, state: derived.state, startedAt: run.startedAt });
      for (const p of store.proposals.filter((q) => q.run === run.id)) {
        proposals.push({
          id: p.id,
          run: p.run,
          from: p.from,
          to: p.to,
          proposer: p.proposer,
          voters: p.votes.map((v) => v.did),
          ...(p.rationale ? { rationale: p.rationale } : {}),
          proposedAt: p.proposedAt,
          settled: derived.settled.has(p.id),
        });
      }
    }
    return { runs, proposals };
  }

  return {
    async install(dataset, definition) {
      const store = storeFor(dataset);
      store.flows.set(definition.name, structuredClone(definition));
      notify(store);
    },

    async start(dataset, flow, subject) {
      const store = storeFor(dataset);
      if (!store.flows.has(flow)) throw new Error(`flows: flow "${flow}" is not installed`);
      const existing = runFor(
        store.runs.filter((r) => r.flow === flow).map((r) => ({ ...r, state: '' })),
        subject,
      );
      const stored = existing
        ? runById(store, existing.id)
        : (() => {
            const run = { id: `inmemory://flow-run/${++serial}`, flow, subject, startedAt: now() };
            store.runs.push(run);
            return run;
          })();
      if (!existing) notify(store);
      const derived = await derive(dataset, store, stored);
      return { id: stored.id, subject, state: derived.state, startedAt: stored.startedAt };
    },

    async propose(dataset, runId, to, rationale) {
      const store = storeFor(dataset);
      const did = me();
      const run = runById(store, runId);
      const flow = flowOf(store, run);
      const before = await derive(dataset, store, run);
      if (!flow.transitions.some((t) => t.from === before.state && t.to === to)) {
        throw new Error(`\`${to}\` is not reachable from \`${before.state}\``);
      }
      let target = store.proposals.find(
        (p) => p.run === runId && p.from === before.state && p.to === to && !before.settled.has(p.id),
      );
      let opened = false;
      let voted = false;
      if (!target) {
        const at = now();
        target = {
          id: `inmemory://flow-proposal/${++serial}`,
          run: runId,
          from: before.state,
          to,
          proposer: did,
          votes: [{ did, at }],
          ...(rationale ? { rationale } : {}),
          proposedAt: at,
        };
        store.proposals.push(target);
        opened = true;
        voted = true;
      } else if (!target.votes.some((v) => v.did === did)) {
        target.votes.push({ did, at: now() });
        voted = true;
      }
      const after = await derive(dataset, store, run);
      if (opened || voted) notify(store);
      const result: FlowProposeResult = {
        proposal: target.id,
        opened,
        voted,
        moves: after.moves.slice(before.moves.length),
        state: after.state,
        stalled: false,
      };
      return result;
    },

    async withdraw(dataset, proposalId) {
      const store = storeFor(dataset);
      const did = me();
      const proposal = store.proposals.find((p) => p.id === proposalId);
      if (!proposal) throw new Error(`flows: no proposal ${proposalId}`);
      if (proposal.proposer === did) {
        store.proposals = store.proposals.filter((p) => p !== proposal);
        notify(store);
        return proposal.votes.length;
      }
      const kept = proposal.votes.filter((v) => v.did !== did);
      if (kept.length === proposal.votes.length) throw new Error('flows: nothing of yours to withdraw here');
      const withdrawn = proposal.votes.length - kept.length;
      proposal.votes = kept;
      notify(store);
      return withdrawn;
    },

    async watch(dataset, flow, onChange) {
      const store = storeFor(dataset);
      let stopped = false;
      const push = () => {
        void snapshot(dataset, store, flow).then((s) => {
          if (!stopped) onChange(s);
        });
      };
      store.listeners.add(push);
      push();
      return () => {
        stopped = true;
        store.listeners.delete(push);
      };
    },
  };
}
