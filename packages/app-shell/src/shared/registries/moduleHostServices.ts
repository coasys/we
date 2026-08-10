/**
 * The host services a module store may borrow, bound late.
 *
 * ## Why this exists at all
 *
 * Modules are registered in `PlatformProvider`, which sits *above* `StoreProvider` — the launcher
 * template has to be in the registry before the stores render, so registration cannot wait. But the
 * ports a module wants (transport, presence, the current dataset) all live in stores that do not
 * exist yet at that moment.
 *
 * Rather than reorder the tree, the deps handed to a module store are **stable objects whose methods
 * dereference at call time**. A module holds `deps.presence` forever; what it points at is filled in
 * when `PresenceStoreProvider` mounts. Every accessor answers safely before then — `peers()` returns
 * an empty array, `ephemeral()` returns `null` — which is the same degrade-don't-throw contract the
 * ports already require for a personal space with no neighbourhood.
 *
 * The alternative — activating modules after the stores mount — was rejected because it splits
 * registration into two phases with different capabilities, and "which phase am I in" is exactly the
 * kind of implicit state the last round of seam bugs came from.
 */
import type { Activity, DatasetHandle, EphemeralPort, Peer, TranscriptionPort } from '@we/backend-shared';
import type { CreateEntityOptions, ModuleIdentityAccess, ModuleStoreDeps } from '@we/module-shared';

import { moduleRegistry, moduleStores } from './moduleRegistry';

/** What a store publishes here once it is live. All optional: a host need not provide any of it. */
export interface ModuleHostServices {
  dataset?: () => DatasetHandle | null;
  datasetUri?: () => string | null;
  selfId?: () => string | null;
  ephemeral?: EphemeralPort;
  presence?: {
    peers: () => Peer[];
    setActivity: (activity: Activity) => void;
    clearActivity: (type: string, id?: string) => void;
  };
  transcription?: TranscriptionPort;
  /** The profile cache, so a module can put a face to an agent id. See `ModuleIdentityAccess`. */
  identities?: ModuleIdentityAccess;
  /** Write a record into the current dataset — the host's `model.create`, in imperative form. */
  createEntity?: (
    entity: string,
    fields: Record<string, unknown>,
    options?: CreateEntityOptions,
  ) => Promise<string | null>;
  /** Add one value to a to-many relation on an existing record. See `ModuleStoreDeps.linkEntity`. */
  linkEntity?: (entity: string, id: string, relation: string, value: string) => Promise<void>;
}

const services: ModuleHostServices = {};

/**
 * Publish a slice of host services to registered modules.
 *
 * Merges rather than replaces, because the slices arrive from different stores at different times —
 * `DatasetStore`/`SessionStore` have the dataset and the transport, `PresenceStore` has the roster.
 */
export function provideModuleHostServices(slice: ModuleHostServices): void {
  Object.assign(services, slice);
}

/** Test seam: drop everything between cases so one test's bindings cannot leak into the next. */
export function resetModuleHostServices(): void {
  for (const key of Object.keys(services)) delete services[key as keyof ModuleHostServices];
}

/**
 * Build the deps bag handed to every module store.
 *
 * `signal` and `effect` come from the framework, because only the host knows which one it is running.
 * Everything else reads through the late-bound registry above.
 */
export function createModuleStoreDeps(framework: {
  signal: <T>(initial: T) => [() => T, (next: T) => void];
  effect: (fn: () => void) => void;
}): ModuleStoreDeps {
  return {
    signal: framework.signal,
    effect: framework.effect,

    dataset: () => services.dataset?.() ?? null,
    datasetUri: () => services.datasetUri?.() ?? null,
    selfId: () => services.selfId?.() ?? null,

    // A stable function that forwards, so a module capturing `deps.ephemeral` at construction still
    // reaches the real port once one exists.
    ephemeral: (handle) => services.ephemeral?.(handle) ?? null,

    presence: {
      peers: () => services.presence?.peers() ?? [],
      setActivity: (activity) => services.presence?.setActivity(activity),
      clearActivity: (type, id) => services.presence?.clearActivity(type, id),
    },

    // Forwarding wrappers rather than the ports themselves, so a module that captured its deps at
    // construction still reaches whatever the host has bound by the time it calls — the same
    // late-binding contract as `ephemeral` above.
    transcription: {
      models: async () => (await services.transcription?.models()) ?? [],
      open: async (modelId, onText, tuning) => {
        const port = services.transcription;
        if (!port) throw new Error('transcription: this backend cannot transcribe');
        return port.open(modelId, onText, tuning);
      },
    },

    // Forwarding, like the ports above: a module store is built before `ProfileStore` mounts, so
    // capturing the directory itself would capture nothing.
    identities: {
      get: (agentId) => services.identities?.get(agentId),
      fetch: (agentId) => services.identities?.fetch(agentId),
    },

    audioInput: () => audioInput(),

    createEntity: async (entity, fields, options) => (await services.createEntity?.(entity, fields, options)) ?? null,

    linkEntity: async (entity, id, relation, value) => {
      await services.linkEntity?.(entity, id, relation, value);
    },
  };
}

/**
 * The audio a module has published via {@link ModuleDefinition.audioSource}.
 *
 * Resolved on every read rather than captured, because the producing module's store may not exist
 * when a consumer is constructed, and the stream itself comes and goes as calls start and end.
 */
function audioInput(): MediaStream | null {
  for (const { definition } of moduleRegistry.all()) {
    if (!definition.audioSource) continue;
    const store = moduleStores[definition.id] as Record<string, unknown> | undefined;
    const source = store?.[definition.audioSource];
    if (typeof source !== 'function') continue;
    return ((source as () => unknown)() as MediaStream | null) ?? null;
  }
  return null;
}
