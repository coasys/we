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
  AgentProfileSummary,
  AgentSessionPort,
  BackendPorts,
  BackendPortsContext,
  DatasetChangeHandlers,
  DatasetLifecyclePort,
  DatasetRef,
  ModelManifest,
  ProfileDirectoryPort,
  SchemaPort,
} from '@we/backend-shared';
import { registerModel } from '@we/models';
import { CORE_MANIFEST } from '@we/models/generated/coreManifest';

import { compileEntities, type EntityRuntime } from './entities';

export interface InMemoryDatasetSeed {
  id: string;
  name: string;
  sharedUri?: string;
}

export interface InMemoryLifecycle extends DatasetLifecyclePort {
  publish(id: string): Promise<{ uri: string; sharedId: string }>;
  join(uri: string): Promise<DatasetRef>;
  /** Test helper: make a dataset joinable by URI without it existing locally yet. */
  seedShared(seed: InMemoryDatasetSeed & { sharedUri: string }): void;
  /** Test helper: simulate another client removing a dataset (fires onRemoved). */
  removeRemotely(id: string): void;
}

let datasetCounter = 0;

export function createInMemoryLifecycle(initial: InMemoryDatasetSeed[] = []): InMemoryLifecycle {
  type Entry = {
    id: string;
    name: string;
    sharedUri?: string;
    tables: Record<string, unknown[]>;
  };
  const datasets = new Map<string, Entry>();
  const joinable = new Map<string, Entry>();
  const subscribers = new Set<DatasetChangeHandlers>();

  const toRef = (e: Entry): DatasetRef => ({
    id: e.id,
    name: e.name,
    ...(e.sharedUri ? { sharedUri: e.sharedUri, sharedId: e.sharedUri.replace('inmemory://', '') } : {}),
    // The handle doubles as the query side's table store — an in-memory "dataset".
    handle: e,
  });

  for (const seed of initial) {
    datasets.set(seed.id, { ...seed, tables: {} });
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
      const entry: Entry = { id: `ds-${++datasetCounter}`, name, tables: {} };
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
      joinable.set(e.sharedUri, e);
      emit((h) => h.onUpdated?.(toRef(e)));
      return { uri: e.sharedUri, sharedId: e.id };
    },

    async join(idOrUri) {
      const uri = idOrUri.includes('://') ? idOrUri : `inmemory://${idOrUri}`;
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
      joinable.set(seed.sharedUri, { ...seed, tables: {} });
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
  let password = opts.password ?? 'password';
  let hasAgent = opts.hasAgent ?? true;
  let unlocked = opts.unlocked ?? false;

  return {
    async status() {
      return { hasAgent, unlocked };
    },

    /**
     * Creating an identity takes over the passphrase from that point on, so a test can generate
     * with one password and then lock/unlock with it — the same lifecycle a real agent has.
     * Refusing when one already exists mirrors the executor, where `generate` on a live agent is
     * a caller error rather than a silent key replacement.
     */
    async generate(pw) {
      if (hasAgent) throw new Error('an agent already exists');
      password = pw;
      hasAgent = true;
      unlocked = true;
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

// ─── Schema + profile ports, and the full bundle ──────────────────────────────

/**
 * The in-memory schema port. Installs are no-ops because rows need no schema written ahead of
 * them — the shape of a table is whatever its manifest says, resolved at query time. Presence
 * checks answer "core schema installed" so the shell treats every dataset as a WE space.
 *
 * `declare` is the part that carries weight: it compiles a module's manifest into row-backed
 * entities and registers them by name, which is the same contract the AD4M port fulfils by
 * compiling that manifest into decorated classes. A module declaring an entity gets a working
 * one here without knowing either backend exists.
 */
export function createInMemorySchemaPort(runtime: EntityRuntime): SchemaPort {
  return {
    installRoot: async () => {},
    installSpace: async () => {},
    installModules: async () => {},
    ensure: async () => {},
    hasCoreSchema: async () => true,
    hasAnySchema: async () => true,
    foreignSchemas: async () => [],
    declare: (manifest) => {
      const compiled = compileEntities(manifest, runtime);
      for (const [name, cls] of Object.entries(compiled)) registerModel(name, cls as never);
      return compiled;
    },
  };
}

/** Map-backed profile directory; uploads echo a retrievable inmemory URL. */
export function createInMemoryProfileDirectory(ctx: BackendPortsContext): ProfileDirectoryPort {
  const profiles = new Map<string, AgentProfileSummary>();
  let uploadCounter = 0;

  const blank = (did: string): AgentProfileSummary => ({ did, firstName: '', lastName: '', handle: '', bio: '' });

  return {
    async get(id) {
      return profiles.get(id) ?? blank(id);
    },
    async publish(fields) {
      const id = ctx.selfId();
      if (!id) throw new Error('publish: no authenticated agent');
      const current = profiles.get(id) ?? blank(id);
      const next = { ...current };
      if ('firstName' in fields) next.firstName = fields.firstName ?? '';
      if ('lastName' in fields) next.lastName = fields.lastName ?? '';
      if ('handle' in fields) next.handle = fields.handle ?? '';
      if ('bio' in fields) next.bio = fields.bio ?? '';
      if ('avatarExpressionUrl' in fields) next.avatar = fields.avatarExpressionUrl;
      if ('coverImageExpressionUrl' in fields) next.coverImage = fields.coverImageExpressionUrl;
      if ('location' in fields) next.location = fields.location ?? undefined;
      profiles.set(id, next);
    },
    async uploadFile() {
      return `inmemory://file-${++uploadCounter}`;
    },
  };
}

export interface InMemoryBackendPortsOptions {
  agent?: InMemoryAgentOptions;
  datasets?: InMemoryDatasetSeed[];
  /**
   * The entity vocabulary to compile and register on connect. Defaults to the host's own core
   * manifest, which is what makes `Space.findAll(...)` work in a test with no executor running.
   */
  entities?: ModelManifest | null;
}

/**
 * The complete in-memory backend — what a test (or a backend-less demo host) returns from
 * `BackendConnector.ports()`. Ephemeral reports the capability absent.
 *
 * Connecting registers the core entities, which is when `Space`, `AgentSettings` and the rest
 * resolve to something that works. That mirrors the AD4M connector: entities exist because a
 * backend supplied them, never because a module was imported.
 */
export function createInMemoryBackendPorts(
  ctx: BackendPortsContext,
  opts: InMemoryBackendPortsOptions = {},
): BackendPorts & { lifecycle: InMemoryLifecycle } {
  const lifecycle = createInMemoryLifecycle(opts.datasets);
  const runtime: EntityRuntime = { selfId: () => ctx.selfId() };
  const schemas = createInMemorySchemaPort(runtime);

  const manifest = opts.entities === undefined ? CORE_MANIFEST : opts.entities;
  if (manifest) schemas.declare(manifest, { moduleId: 'core' });

  return {
    agentSession: createInMemoryAgentSession(opts.agent),
    lifecycle,
    schemas,
    profiles: createInMemoryProfileDirectory(ctx),
    ephemeral: () => null,
    dataBindings: (deps) => ({ $currentDataset: deps.currentDataset, $ephemeral: deps.ephemeral }),
  };
}
