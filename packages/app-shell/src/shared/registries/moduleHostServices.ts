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
import type {
  Activity,
  DatasetHandle,
  EphemeralPort,
  InterpretationPort,
  InterpretationResult,
  Peer,
  TranscriptionPort,
} from '@we/backend-shared';
import type {
  AgentDataAccess,
  CreateEntityOptions,
  InterpretationActivitySummary,
  ModuleDatasetAccess,
  ModuleIdentityAccess,
  ModuleStoreDeps,
} from '@we/module-shared';

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
  interpretation?: InterpretationPort;
  /**
   * Gather a collection's children and interpret them, published by whichever store can read the
   * dataset's models. Separate from `interpretation` because the port takes turns and only the host
   * can produce them — see `shared/interpretation/transcriptTurns.ts`.
   */
  interpretCollection?: (collectionId: string, request: { classes: string[] }) => Promise<InterpretationResult>;
  watchCollection?: (collectionId: string, request: { classes: string[] }) => Promise<void>;
  unwatchCollection?: (collectionId: string) => Promise<void>;
  reconcileCollection?: (collectionId: string, request: { classes: string[] }) => Promise<number>;
  /**
   * Live extraction activity for the current space, published by the store that holds the feed.
   *
   * Separate from `interpretation` for the same reason `interpretCollection` is: the port reports
   * only what this node can see, and merging in what peers report needs the ephemeral transport and
   * the profile cache — neither of which the port has, and both of which the host does.
   */
  interpretationActivity?: () => InterpretationActivitySummary[];
  /**
   * Whether the backend can interpret, as the store learned it from the backend itself.
   *
   * Published separately from the port's own `available()` because the answer arrives
   * asynchronously and has to be *reactive*: a module reads it inside a derived value, and the
   * probe resolves a round trip after the dataset changes. A plain port call would be read once and
   * never re-read.
   */
  interpretationAvailable?: () => boolean;
  /**
   * Whether this space shares the model exchange between peers — the space setting, reactive.
   *
   * What a module reads to explain a peer's row that cannot be opened. Separate from the rows
   * themselves because a row without detail is not evidence about the setting: see
   * `InterpretationStore` on why the two were conflated and what that showed.
   */
  interpretationDetailShared?: () => boolean;
  /** The profile cache, so a module can put a face to an agent id. See `ModuleIdentityAccess`. */
  identities?: ModuleIdentityAccess;
  /** Naming and reaching spaces, for a module whose state can outlive the space on screen. */
  datasets?: ModuleDatasetAccess;
  /** Write a record into the current dataset — the host's `model.create`, in imperative form. */
  createEntity?: (
    entity: string,
    fields: Record<string, unknown>,
    options?: CreateEntityOptions,
  ) => Promise<string | null>;
  /** Add one value to a to-many relation on an existing record. See `ModuleStoreDeps.linkEntity`. */
  linkEntity?: (entity: string, id: string, relation: string, value: string) => Promise<void>;
  /** This agent's own records, in the root dataset. See `AgentDataAccess`. */
  agentData?: AgentDataAccess;
  /** How the current dataset is named in a record reference. See `ModuleStoreDeps.datasetRefKey`. */
  datasetRefKey?: () => string;
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
    datasetRefKey: () => services.datasetRefKey?.() ?? '',
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
      // The wrapper is always present so late binding works; this is how a module asks whether
      // there is anything behind it. Without it, `if (!transcription)` never fired and a backend
      // that cannot transcribe at all told the user to go and install a model.
      available: () => services.transcription !== undefined,
      models: async () => (await services.transcription?.models()) ?? [],
      open: async (modelId, onText, tuning) => {
        const port = services.transcription;
        if (!port) throw new Error('transcription: this backend cannot transcribe');
        return port.open(modelId, onText, tuning);
      },
    },

    // Binds the dataset as well as forwarding, so a module never handles a dataset handle. The
    // dataset is resolved per call rather than captured, for the same reason the port is: a module
    // store outlives a space switch, and a captured handle would keep writing into the space the
    // user has left.
    interpretation: {
      // Asks the port rather than testing for its presence. The host always publishes a forwarding
      // wrapper so late binding works, which makes `!== undefined` true even on a backend that
      // cannot interpret — the trap the transcription wrapper above still falls into. Delegating to
      // `available()` lets the forwarder answer for the backend actually connected.
      /*
        The store's answer first, the port's second, and "a port exists" last.

        That order is the fix for what shipped: the last of the three is what actually ran, because
        the adapter implemented no `available()` at all — so the question "can this node interpret"
        was answered by "is a port object present", which is true on every node including one whose
        executor has never heard of the feature.
      */
      available: () =>
        services.interpretationAvailable?.() ??
        services.interpretation?.available?.() ??
        services.interpretation !== undefined,
      runOnCollection: async (collectionId, request) => {
        const run = services.interpretCollection;
        if (!run) throw new Error('interpretation: this backend cannot interpret');
        return run(collectionId, request);
      },
      /*
        Keep interpreting this collection as it grows — the standing counterpart to
        `runOnCollection`.

        A module names a collection and nothing else: no watch id, no dataset, no classes→URI
        conversion, no SPARQL. That is what makes this consistent with the contract's refusal to
        hand a module a watch rather than a hole in it — the registration is the host's, shared with
        every peer, and outlives the module store that asked for it.

        Rejects on a backend that cannot hold one, so a module can offer the affordance only where
        it means something instead of silently doing nothing.
      */
      watchCollection: async (collectionId, request) => {
        const start = services.watchCollection;
        if (!start) throw new Error('interpretation: this backend cannot run a standing watch');
        return start(collectionId, request);
      },
      unwatchCollection: async (collectionId) => {
        await services.unwatchCollection?.(collectionId);
      },
      reconcileCollection: async (collectionId, request) =>
        (await services.reconcileCollection?.(collectionId, request)) ?? 0,
      /*
        Reads through on every call rather than capturing, like every accessor here — a module store
        outlives a space switch, and a captured array would keep showing the passes of the space the
        user has left.

        Empty when the store has not published yet, which a module must read as "nothing running".
        It is indistinguishable from a backend that cannot report progress, and deliberately so:
        neither is a state worth a module branching on.
      */
      activity: () => services.interpretationActivity?.() ?? [],
      // False until the store publishes, which reads as "not shared" — the conservative answer,
      // and the one the footnote it gates should give while the setting is still unknown.
      detailShared: () => services.interpretationDetailShared?.() ?? false,
      proposals: async () => {
        const dataset = services.dataset?.();
        if (!dataset || !services.interpretation) return [];
        return services.interpretation.proposals(dataset);
      },
      accept: async (id, property) => {
        const dataset = services.dataset?.();
        if (!dataset || !services.interpretation) return false;
        return services.interpretation.accept(dataset, id, property);
      },
      reject: async (id, property) => {
        const dataset = services.dataset?.();
        if (!dataset || !services.interpretation) return false;
        return services.interpretation.reject(dataset, id, property);
      },
    },

    // Forwarding, like the ports above: a module store is built before `ProfileStore` mounts, so
    // capturing the directory itself would capture nothing.
    datasets: {
      get: (uri) => services.datasets?.get(uri),
      open: (uri) => services.datasets?.open(uri),
    },

    identities: {
      get: (agentId) => services.identities?.get(agentId),
      fetch: (agentId) => services.identities?.fetch(agentId),
    },

    audioInput: () => audioInput(),

    createEntity: async (entity, fields, options) => (await services.createEntity?.(entity, fields, options)) ?? null,

    // Forwarded rather than captured, like every other port here: a module store is built before
    // the root dataset has been found, and an agent-scoped module reading it at construction would
    // capture nothing and never notice.
    agentData: {
      ready: () => services.agentData?.ready() ?? false,
      create: async (entity, fields, options) => (await services.agentData?.create(entity, fields, options)) ?? null,
      find: async (entity, query) => (await services.agentData?.find(entity, query)) ?? [],
      remove: async (entity, id) => {
        await services.agentData?.remove(entity, id);
      },
    },

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
