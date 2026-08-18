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
  DataBindingDeps,
  DatasetChangeHandlers,
  DatasetLifecyclePort,
  DatasetRef,
  EphemeralPort,
  ModelManifest,
  PresenceState,
  ProfileDirectoryPort,
  RendererDataBindings,
  SchemaPort,
} from '@we/backend-shared';
import { createInMemoryEphemeralPort, InMemoryBus } from '@we/backend-shared';
import { getModel, getModelForPerspective, registerModel } from '@we/models';
import { CORE_MANIFEST } from '@we/models/generated/coreManifest';

import { compileEntities, type EntityRuntime } from './entities';
import { inMemoryQueryAdapter } from './queryAdapter';

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
  // Declared hint defaults by entity, captured at declare time; customizations by dataset+entity.
  // Same observable contract as the AD4M port: reads answer the declared hints until a set() marks
  // them customized, and reset() returns to the declared ones.
  const declaredHints = new Map<string, { classHint?: string; propHints: Record<string, string> }>();
  const customized = new Map<string, { classHint?: string; propHints: Record<string, string> }>();
  const key = (dataset: unknown, entity: string) =>
    `${(dataset as { id?: string } | undefined)?.id ?? 'default'}::${entity}`;

  const seedDeclaredHints = (manifest: Parameters<SchemaPort['declare']>[0]) => {
    for (const [name, entity] of Object.entries(manifest.entities)) {
      const propHints: Record<string, string> = {};
      for (const spec of Object.values(entity.properties)) {
        // Keyed by predicate to match the port contract; a declaration without one has no stable
        // storage key, so its hint is unreachable through this surface — as on AD4M, where the
        // minted predicate is the key.
        if (spec.interpretationHint && spec.predicate) propHints[spec.predicate] = spec.interpretationHint;
      }
      declaredHints.set(name, {
        ...(entity.interpretationHint ? { classHint: entity.interpretationHint } : {}),
        propHints,
      });
    }
  };

  return {
    installRoot: async () => {},
    installSpace: async () => {},
    installModules: async () => {},
    // Nothing to bring up to date: entities here are compiled from the manifest this build ships,
    // so a stored shape can never predate the declared one.
    refreshSpace: async () => [],
    ensure: async () => {},
    hasCoreSchema: async () => true,
    hasAnySchema: async () => true,
    foreignSchemas: async () => [],
    declare: (manifest) => {
      seedDeclaredHints(manifest);
      const compiled = compileEntities(manifest, runtime);
      for (const [name, cls] of Object.entries(compiled)) registerModel(name, cls as never);
      return compiled;
    },

    declareInDataset(dataset, manifest) {
      // Rows need no per-dataset schema separation here — the runtime resolves entities by name at
      // query time — so dataset-scoped declaration degrades to a plain declare.
      void dataset;
      seedDeclaredHints(manifest);
      const compiled = compileEntities(manifest, runtime);
      for (const [name, cls] of Object.entries(compiled)) registerModel(name, cls as never);
      return compiled;
    },

    async interpretationHints(dataset, entity) {
      const declared = declaredHints.get(entity);
      if (!declared) return null;
      const custom = customized.get(key(dataset, entity));
      return custom
        ? { ...(custom.classHint !== undefined ? { classHint: custom.classHint } : {}), propHints: custom.propHints, customized: true }
        : { ...(declared.classHint !== undefined ? { classHint: declared.classHint } : {}), propHints: { ...declared.propHints }, customized: false };
    },

    async setInterpretationHints(dataset, entity, hints) {
      const declared = declaredHints.get(entity);
      if (!declared) throw new Error(`setInterpretationHints: no declared entity "${entity}"`);
      const k = key(dataset, entity);
      const current = customized.get(k) ?? {
        ...(declared.classHint !== undefined ? { classHint: declared.classHint } : {}),
        propHints: { ...declared.propHints },
      };
      if (hints.classHint !== undefined) {
        if (hints.classHint) current.classHint = hints.classHint;
        else delete current.classHint;
      }
      for (const [predicate, hint] of Object.entries(hints.propHints ?? {})) {
        if (hint) current.propHints[predicate] = hint;
        else delete current.propHints[predicate];
      }
      customized.set(k, current);
    },

    async resetInterpretationHints(dataset, entity) {
      customized.delete(key(dataset, entity));
    },
  };
}

/**
 * Map-backed profile directory; uploads echo a retrievable inmemory URL.
 *
 * `seed` pre-populates other agents' profiles — the one thing `publish` cannot do, since it writes
 * only `ctx.selfId()`'s record, as the real directory does. Without it every peer resolves to a
 * blank, and a feed, a member list or a presence roster renders as a column of identical
 * initial-less avatars: structurally correct and visually useless. Anything rendering more than one
 * person needs this, which is most of what WE renders.
 */
export function createInMemoryProfileDirectory(
  ctx: BackendPortsContext,
  seed: readonly AgentProfileSummary[] = [],
): ProfileDirectoryPort {
  const profiles = new Map<string, AgentProfileSummary>(seed.map((p) => [p.did, p]));
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
  /**
   * Other agents' published profiles, by DID. See {@link createInMemoryProfileDirectory} — the
   * directory can only publish the *self* profile, so peers have no other way to exist.
   */
  profiles?: readonly AgentProfileSummary[];
  /**
   * Peers to report as present, and what they are doing.
   *
   * The ephemeral bus carries one agent — this process — so presence is otherwise always a roster
   * of one. `presenceStore.onlineHere` is read directly by templates (the channel header in the
   * Discord-shaped template, for one), and a roster showing only yourself is the same failure as a
   * feed of one author: it renders, and shows nothing about how the design holds up.
   *
   * These beat on the same channel a real peer's heartbeat uses, so nothing about the store is
   * special-cased — see {@link startSeededPresence} for why they have to keep beating.
   */
  presence?: readonly SeededPeer[];
}

/**
 * A peer to announce on the ephemeral bus — a {@link PresenceState} without the two fields the
 * heartbeat owns (`agentId` comes from `did`, `updatedAt` is stamped on every beat).
 *
 * `focus` is what decides whether a peer shows up at all: `presenceStore.online` filters on
 * `focus.datasetUri` and `onlineHere` further filters on `focus.path`. A seeded peer with no focus
 * is present in the abstract and visible nowhere.
 */
export interface SeededPeer extends Omit<PresenceState, 'agentId' | 'updatedAt'> {
  did: string;
}

/**
 * Beat seeded peers onto a dataset's presence channel until every scope over it is disposed.
 *
 * Repeating rather than announcing once, for two reasons. Presence is self-healing by design —
 * `derivePeers` ages every state out on a TTL — so a single delivery would show a roster that
 * empties itself a few seconds later, and a screenshot would then depend on when it was taken. And
 * a subscriber that has not attached yet receives nothing, so a one-shot at connect races the
 * store's own setup.
 *
 * Refcounted per dataset because a leaked interval keeps a vitest run alive forever, which is a
 * worse failure than the one this exists to fix.
 */
function startSeededPresence(bus: InMemoryBus, dataset: unknown, peers: readonly SeededPeer[]): () => void {
  // Keyed by bus *and* dataset. `keyFor` counts from zero per bus, so the first dataset of every
  // bundle is `ds-0` — a registry keyed on that alone has two independent backends sharing an entry,
  // and the second one silently never beats. Found by the tests below running in sequence.
  const beats = seededPresence.get(bus) ?? new Map<string, PresenceBeat>();
  seededPresence.set(bus, beats);

  const key = bus.keyFor(dataset);
  const existing = beats.get(key);
  if (existing) {
    existing.refs += 1;
    return () => release(beats, key);
  }

  const beat = () => {
    for (const { did, ...state } of peers) {
      bus.deliver(key, 'presence', did, { ...state, agentId: did, updatedAt: Date.now() } satisfies PresenceState);
    }
  };

  // Faster than the app's own 5s DEFAULT_HEARTBEAT_INTERVAL, deliberately. That interval is tuned
  // for the cost of a broadcast over a real network; there is no network here, and what matters
  // instead is how long after load a screenshot has to wait for the roster to fill. A subscriber
  // always attaches *after* the scope it subscribes through is created, so the first beat cannot be
  // synchronous — one second is the ceiling on that gap, and still far inside the 15s idle
  // threshold, so a seeded peer reads `online` in every render.
  const timer = setInterval(beat, 1_000);
  beats.set(key, { refs: 1, timer });
  // Harmless for a subscriber that is somehow already attached, and free otherwise.
  beat();
  return () => release(beats, key);
}

interface PresenceBeat {
  refs: number;
  timer: ReturnType<typeof setInterval>;
}

/** Weak on the bus so a discarded bundle takes its beats with it. */
const seededPresence = new WeakMap<InMemoryBus, Map<string, PresenceBeat>>();

function release(beats: Map<string, PresenceBeat>, key: string): void {
  const entry = beats.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  clearInterval(entry.timer);
  beats.delete(key);
}

/**
 * The complete in-memory backend — what a test (or a backend-less demo host) returns from
 * `BackendConnector.ports()`.
 *
 * Connecting registers the core entities, which is when `Space`, `AgentSettings` and the rest
 * resolve to something that works. That mirrors the AD4M connector: entities exist because a
 * backend supplied them, never because a module was imported.
 *
 * The data plane is real, not stubbed: `dataBindings` exposes the same binding surface the AD4M
 * adapter does ($getModel, $queryAdapter, model mutations, $identities, $ephemeral), backed by the
 * row-backed entities and the shared query engine, and `ephemeral` is the shared in-process bus.
 * That is what makes this bundle a conformance surface rather than a boot-only stub — a suite
 * running against these ports can exercise queries and mutations, not just lifecycle.
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

  // One bus per bundle; the per-agent port is constructed lazily so the agent id is read after
  // the session unlocks (mirrors the AD4M port's lazy selfId).
  const bus = new InMemoryBus();
  const ephemeral: EphemeralPort = (dataset) => {
    const scope = createInMemoryEphemeralPort(bus, ctx.selfId() ?? 'did:inmemory:anonymous')(dataset);
    if (!scope || !opts.presence?.length) return scope;

    // Seeded peers beat for as long as somebody is listening to this dataset, and the scope's own
    // dispose is the only signal for that — hence the wrap rather than starting them at connect.
    const stop = startSeededPresence(bus, dataset, opts.presence);
    return {
      ...scope,
      dispose() {
        stop();
        scope.dispose();
      },
    };
  };

  const mutationDataset = (deps: DataBindingDeps, opts?: Record<string, unknown>): unknown => {
    const explicit = opts?.perspective as { handle?: unknown } | undefined;
    if (explicit && typeof explicit === 'object' && 'handle' in explicit) return explicit.handle;
    return deps.currentDataset();
  };

  return {
    agentSession: createInMemoryAgentSession(opts.agent),
    lifecycle,
    schemas,
    profiles: createInMemoryProfileDirectory(ctx, opts.profiles),
    ephemeral,
    dataBindings: (deps) => ({
      $currentDataset: deps.currentDataset,
      // @we/models' ModelClass and the contract's ModelClass<unknown> are structurally
      // compatible but declared separately; the cast bridges the two declarations.
      $getModel: (name) => getModel(name) as unknown as ReturnType<NonNullable<RendererDataBindings['$getModel']>>,
      $getModelForPerspective: (name, dataset) =>
        getModelForPerspective(name, dataset) as ReturnType<
          NonNullable<RendererDataBindings['$getModelForPerspective']>
        >,
      $queryAdapter: inMemoryQueryAdapter,
      $identities: {
        get: (id) => deps.profiles().find((p) => p.did === id) as Record<string, unknown> | undefined,
        fetch: (id) => void deps.fetchProfile(id),
      },
      $ephemeral: deps.ephemeral,
      model: {
        async create(model, data, mutationOpts) {
          const cls = getModel(model) as unknown as {
            create(dataset: unknown, data?: Record<string, unknown>): Promise<{ id: string }>;
          };
          return cls.create(mutationDataset(deps, mutationOpts), data);
        },
        async update(model, id, data, mutationOpts) {
          const cls = getModel(model) as unknown as {
            update(dataset: unknown, id: string, data: Record<string, unknown>): Promise<unknown>;
          };
          return cls.update(mutationDataset(deps, mutationOpts), id, data);
        },
        async delete(model, id, mutationOpts) {
          const cls = getModel(model) as unknown as {
            findOne(dataset: unknown, query?: Record<string, unknown>): Promise<{ delete(): Promise<void> } | null>;
          };
          const instance = await cls.findOne(mutationDataset(deps, mutationOpts), { where: { id } });
          await instance?.delete();
        },
      },
    }),
  };
}
