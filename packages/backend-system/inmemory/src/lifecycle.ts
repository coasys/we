/**
 * In-memory implementations of the lifecycle half of the backend contract — the reference
 * `DatasetLifecyclePort` and `AgentSessionPort`, and what lets the app shell's boot sequence,
 * dataset switching, and space create/join run in tests with no executor.
 *
 * Sharing is simulated: `publish` mints an `inmemory://` URI, and `join` resolves against a
 * registry of published datasets (pre-seedable, so a test can "join" a dataset another peer
 * published). Change handlers fire synchronously on the mutating call — push semantics, like the
 * query side's subscriptions.
 */
import type {
  AgentIdentity,
  AgentSessionPort,
  DatasetChangeHandlers,
  DatasetLifecyclePort,
  DatasetRef,
} from '@we/backend-shared';

export interface InMemoryDatasetSeed {
  id: string;
  name: string;
  sharedUri?: string;
}

export interface InMemoryLifecycle extends DatasetLifecyclePort {
  publish(id: string): Promise<string>;
  join(uri: string): Promise<DatasetRef>;
  /** Test helper: make a dataset joinable by URI without it existing locally yet. */
  seedShared(seed: InMemoryDatasetSeed & { sharedUri: string }): void;
  /** Test helper: simulate another client removing a dataset (fires onRemoved). */
  removeRemotely(id: string): void;
}

let datasetCounter = 0;

export function createInMemoryLifecycle(initial: InMemoryDatasetSeed[] = []): InMemoryLifecycle {
  /**
   * The handle exposes `uuid`/`sharedUrl` aliases alongside the neutral fields: the shell's
   * stores still read the proxy-shaped surface off their handles (a documented v1 compromise —
   * they hold handles, not DatasetRefs). The aliases make an in-memory handle satisfy exactly
   * what the shell reads.
   */
  type Entry = {
    id: string;
    uuid: string;
    name: string;
    sharedUri?: string;
    sharedUrl?: string;
    tables: Record<string, unknown[]>;
  };
  const datasets = new Map<string, Entry>();
  const joinable = new Map<string, Entry>();
  const subscribers = new Set<DatasetChangeHandlers>();

  const toRef = (e: Entry): DatasetRef => ({
    id: e.id,
    name: e.name,
    ...(e.sharedUri ? { sharedUri: e.sharedUri } : {}),
    // The handle doubles as the query side's table store — an in-memory "perspective".
    handle: e,
  });

  for (const seed of initial) {
    datasets.set(seed.id, { ...seed, uuid: seed.id, sharedUrl: seed.sharedUri, tables: {} });
  }

  const emit = (fn: (h: DatasetChangeHandlers) => void) => subscribers.forEach(fn);

  return {
    async list() {
      return [...datasets.values()].map(toRef);
    },

    async get(id) {
      const e = datasets.get(id);
      return e ? toRef(e) : null;
    },

    async create(name) {
      const id = `ds-${++datasetCounter}`;
      const entry: Entry = { id, uuid: id, name, tables: {} };
      datasets.set(entry.id, entry);
      const ref = toRef(entry);
      emit((h) => h.onAdded?.(ref));
      return ref;
    },

    async remove(id) {
      if (!datasets.delete(id)) return;
      emit((h) => h.onRemoved?.(id));
    },

    async publish(id) {
      const e = datasets.get(id);
      if (!e) throw new Error(`publish: no dataset with id ${id}`);
      e.sharedUri = `inmemory://${e.id}`;
      e.sharedUrl = e.sharedUri;
      joinable.set(e.sharedUri, e);
      emit((h) => h.onUpdated?.(toRef(e)));
      return e.sharedUri;
    },

    async join(uri) {
      const e = joinable.get(uri);
      if (!e) throw new Error(`join: nothing published at ${uri}`);
      if (!datasets.has(e.id)) {
        datasets.set(e.id, e);
        const ref = toRef(e);
        emit((h) => h.onAdded?.(ref));
      }
      return toRef(e);
    },

    async members() {
      return [];
    },

    subscribe(handlers) {
      subscribers.add(handlers);
      return () => subscribers.delete(handlers);
    },

    seedShared(seed) {
      joinable.set(seed.sharedUri, { ...seed, uuid: seed.id, sharedUrl: seed.sharedUri, tables: {} });
    },

    removeRemotely(id) {
      if (!datasets.delete(id)) return;
      emit((h) => h.onRemoved?.(id));
    },
  };
}

export interface InMemoryAgentOptions {
  id?: string;
  password?: string;
  /** Start locked (default) or already unlocked. */
  unlocked?: boolean;
  /** Start with no agent at all (first-run flow). */
  hasAgent?: boolean;
}

export function createInMemoryAgentSession(opts: InMemoryAgentOptions = {}): AgentSessionPort {
  const id = opts.id ?? 'did:test:me';
  const password = opts.password ?? 'password';
  const hasAgent = opts.hasAgent ?? true;
  let unlocked = opts.unlocked ?? false;

  return {
    async status() {
      return { hasAgent, unlocked };
    },

    async unlock(pw) {
      if (pw !== password) throw new Error('invalid password');
      unlocked = true;
    },

    async lock(pw) {
      if (pw !== password) throw new Error('invalid password');
      unlocked = false;
    },

    async me() {
      if (!unlocked) throw new Error('agent is locked');
      return { id, did: id } as AgentIdentity;
    },
  };
}
