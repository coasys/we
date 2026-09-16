/**
 * The host services a module store may borrow, bound late — and the kernels built over them.
 *
 * ## Why this exists at all
 *
 * Modules are registered in `PlatformProvider`, which sits *above* `StoreProvider`: the launcher
 * template has to be in the registry before the stores render, so registration cannot wait. But the
 * ports a module wants (transport, presence, the current dataset) all live in stores that do not
 * exist yet at that moment.
 *
 * Rather than reorder the tree, the deps handed to a module store are **stable objects whose methods
 * dereference at call time**. A module holds `deps.kernels.presence` forever; what it points at is
 * filled in when `PresenceStoreProvider` mounts. Every accessor answers safely before then, which is
 * the same degrade-don't-throw contract the kernels already require for a personal space with no
 * neighbourhood.
 *
 * ## Kernels
 *
 * Each kernel in `ModuleKernels` is built here once, as a forwarding wrapper over the slice of
 * services a host store publishes. The registry then hands each module only the kernels its manifest
 * named — see `depsFor` in `moduleRegistry.ts`. What this file decides is what a host *implements*;
 * `HOST_KERNELS` is that list, and it is what registration compares a manifest against.
 */
import type {
  Activity,
  DatasetHandle,
  EphemeralPort,
  InterpretationPort,
  InterpretationProposal,
  InterpretationResult,
  LanguageModelPort,
  Peer,
  TranscriptionPort,
} from '@we/backend-shared';
import type {
  AgentDataKernel,
  CreateEntityOptions,
  DatasetTarget,
  InterpretationActivitySummary,
  KernelName,
  ModuleDatasetAccess,
  ModuleIdentityAccess,
  ModuleKernels,
  ModuleStoreDeps,
  RecordQuery,
} from '@we/module-shared';

/** What a store publishes here once it is live. All optional: a host need not provide any of it. */
export interface ModuleHostServices {
  dataset?: () => DatasetHandle | null;
  datasetUri?: () => string | null;
  /**
   * Resolve a dataset URI a module named, or `undefined` when this agent does not hold it.
   *
   * Distinguishes "not named" from "named and not found", because those must not have the same
   * outcome: the first means the space on screen, and the second must refuse rather than silently
   * write somewhere else.
   */
  datasetByUri?: (uri: string) => DatasetHandle | undefined;
  /**
   * The call record the address names, when the interface on screen is about one.
   *
   * A module store has no route access, deliberately, and the answer lives in the address because
   * the address is what survives a reload. So the one thing that reads routes publishes it, once.
   */
  callOnScreen?: () => string | null;
  selfId?: () => string | null;
  ephemeral?: EphemeralPort;
  presence?: {
    peers: () => Peer[];
    setActivity: (activity: Activity) => void;
    clearActivity: (type: string, id?: string) => void;
  };
  transcription?: TranscriptionPort;
  interpretation?: InterpretationPort;
  languageModel?: LanguageModelPort;
  /** Where a module's `notify` lands — a toast, in this host. */
  notify?: (tone: 'success' | 'warning' | 'error', message: string) => void;
  /**
   * Gather a collection's children and interpret them, published by whichever store can read the
   * dataset's models. Separate from `interpretation` because the port takes turns and only the host
   * can produce them.
   */
  interpretCollection?: (collectionId: string) => Promise<InterpretationResult>;
  /** The suggestions staged on one collection's contents. Absent means a host that cannot narrow. */
  proposalsForCollection?: (dataset: DatasetHandle, collectionId: string) => Promise<InterpretationProposal[]>;
  /** What one call extracts and what else it could. Absent reads as an empty list. */
  extractionTargets?: (collectionId: string) => { entity: string; selected: boolean }[];
  setExtractionTarget?: (collectionId: string, entity: string, on: boolean) => Promise<void>;
  watchCollection?: (collectionId: string) => Promise<void>;
  unwatchCollection?: (collectionId: string) => Promise<void>;
  reconcileCollection?: (collectionId: string) => Promise<number>;
  /**
   * What follows a pass, on the host's side: today, once a collection holds a task, give it a board
   * to be arranged on. A pass runs on exactly one node, so it is the right writer; creating the board
   * when somebody opens a route would race every member who opened the tab.
   */
  ensureBoardFor?: (collectionId: string, dataset?: string) => Promise<string>;
  /** Live extraction activity for the current space, published by the store that holds the feed. */
  interpretationActivity?: () => InterpretationActivitySummary[];
  /** Whether the backend can interpret, as the store learned it from the backend itself. Reactive. */
  interpretationAvailable?: () => boolean;
  /** Whether a call is extracted as it happens — its participants' answer, else the space's. */
  autoInterpretEnabled?: (collectionId?: string) => boolean;
  setAutoInterpret?: (collectionId: string, on: boolean) => Promise<void>;
  interpretationDetailShared?: () => boolean;
  interpretationProposalsRevision?: () => number;
  /** The profile cache, so a module can put a face to an agent id. */
  identities?: ModuleIdentityAccess;
  /** Naming and reaching spaces, for a module whose state can outlive the space on screen. */
  datasets?: ModuleDatasetAccess;
  /** Write a record — the host's `record.create`, in imperative form. Honours `options.dataset`. */
  createEntity?: (
    entity: string,
    fields: Record<string, unknown>,
    options?: CreateEntityOptions,
  ) => Promise<string | null>;
  linkEntity?: (entity: string, id: string, relation: string, value: string, options?: DatasetTarget) => Promise<void>;
  updateEntity?: (
    entity: string,
    id: string,
    fields: Record<string, unknown>,
    options?: DatasetTarget,
  ) => Promise<void>;
  removeEntity?: (entity: string, id: string, options?: DatasetTarget) => Promise<void>;
  /** Read records once — the read half of the records kernel. */
  findEntities?: (entity: string, query?: RecordQuery, options?: DatasetTarget) => Promise<Record<string, unknown>[]>;
  /** Read records and keep reading. Returns the unsubscribe. */
  subscribeEntities?: (
    entity: string,
    query: RecordQuery,
    cb: (rows: Record<string, unknown>[]) => void,
    options?: DatasetTarget,
  ) => () => void;
  /** This agent's own records, in the root dataset. */
  agentData?: AgentDataKernel;
  /** How the current dataset is named in a record reference. */
  datasetRefKey?: () => string;
}

const services: ModuleHostServices = {};

/**
 * Publish a slice of host services to registered modules.
 *
 * Merges rather than replaces, because the slices arrive from different stores at different times.
 * Returns the withdrawal, and withdraws only what is still ours — a provider that unmounts must take
 * back only the entries it still owns, or its cleanup would blank its replacement's.
 */
export function provideModuleHostServices(slice: ModuleHostServices): () => void {
  Object.assign(services, slice);
  const mine = Object.entries(slice) as [keyof ModuleHostServices, unknown][];
  return () => {
    for (const [key, value] of mine) {
      if (services[key] === value) delete services[key];
    }
  };
}

/** Test seam: drop everything between cases so one test's bindings cannot leak into the next. */
export function resetModuleHostServices(): void {
  for (const key of Object.keys(services)) delete services[key as keyof ModuleHostServices];
  publishedMedia = null;
  mediaListeners.clear();
}

/**
 * The dataset a module's call means: the one it named, or the space on screen.
 *
 * Three answers, not two: unnamed means here, named-and-found means there, and named-and-missing
 * means nowhere. Falling back is the bug this exists to fix — a transcript written into whichever
 * space the reader had wandered to.
 */
function targeted(target?: DatasetTarget): DatasetHandle | null {
  if (!target?.dataset) return services.dataset?.() ?? null;
  const found = services.datasetByUri?.(target.dataset);
  if (!found) {
    console.warn(`module host: no dataset for "${target.dataset}" — refusing rather than writing elsewhere`);
    return null;
  }
  return found;
}

/*
  What a module is capturing, for another to hear.

  Held here rather than read off a module's store by a declared key, so the two never reference each
  other and the host never scans stores for a magic member. One publisher: a second replaces the
  first and says so, since a transcriber hearing two streams at once would be worse than hearing the
  newer one.
*/
let publishedMedia: MediaStream | null = null;
let publishedBy: string | null = null;
const mediaListeners = new Set<(stream: MediaStream | null) => void>();

/** The kernels this host implements — what a manifest's `requires.kernels` is checked against. */
export const HOST_KERNELS: readonly KernelName[] = [
  'records',
  'agentData',
  'presence',
  'ephemeral',
  'media',
  'peerConnection',
  'transcription',
  'languageModel',
  'interpretation',
  'secrets',
];

/**
 * Build the deps bag handed to every module store.
 *
 * `signal` and `effect` come from the framework, because only the host knows which one it is running.
 * Everything else reads through the late-bound registry above. The registry narrows `kernels` per
 * module and injects `state`, `action`, `onDispose` and `settings`; the placeholders here are what a
 * store built with the bag directly — a test — gets.
 */
export function createModuleStoreDeps(framework: {
  signal: <T>(initial: T) => [() => T, (next: T) => void];
  effect: (fn: () => void) => void;
}): ModuleStoreDeps {
  // A signal for the published stream, so a consumer reading `input()` inside a derived value re-runs
  // when the publisher changes it.
  const [mediaInput, setMediaInput] = framework.signal<MediaStream | null>(null);
  mediaListeners.add(setMediaInput);

  const kernels: Partial<ModuleKernels> = {
    records: {
      create: async (entity, fields, options) => (await services.createEntity?.(entity, fields, options)) ?? null,
      link: async (entity, id, relation, value, target) => {
        await services.linkEntity?.(entity, id, relation, value, target);
      },
      update: async (entity, id, fields, target) => {
        await services.updateEntity?.(entity, id, fields, target);
      },
      remove: async (entity, id, target) => {
        await services.removeEntity?.(entity, id, target);
      },
      find: async (entity, query, target) => (await services.findEntities?.(entity, query, target)) ?? [],
      subscribe: (entity, query, cb, target) => services.subscribeEntities?.(entity, query, cb, target) ?? (() => {}),
    },

    // Forwarded rather than captured: a module store is built before the root dataset has been found.
    agentData: {
      ready: () => services.agentData?.ready() ?? false,
      create: async (entity, fields, options) => (await services.agentData?.create(entity, fields, options)) ?? null,
      find: async (entity, query) => (await services.agentData?.find(entity, query)) ?? [],
      update: async (entity, id, fields) => {
        await services.agentData?.update(entity, id, fields);
      },
      remove: async (entity, id) => {
        await services.agentData?.remove(entity, id);
      },
    },

    presence: {
      peers: () => services.presence?.peers() ?? [],
      setActivity: (activity) => services.presence?.setActivity(activity),
      clearActivity: (type, id) => services.presence?.clearActivity(type, id),
    },

    // A stable function that forwards, so a module capturing the port at construction still reaches
    // the real one once it exists.
    ephemeral: (handle) => services.ephemeral?.(handle) ?? null,

    media: {
      getUserMedia: (constraints) => {
        const devices = globalThis.navigator?.mediaDevices;
        if (!devices) return Promise.reject(new Error('media: this host has no media devices'));
        return devices.getUserMedia(constraints);
      },
      getDisplayMedia: (constraints) => {
        const devices = globalThis.navigator?.mediaDevices;
        if (!devices?.getDisplayMedia) return Promise.reject(new Error('media: this host cannot share a screen'));
        return devices.getDisplayMedia(constraints);
      },
      publish: (stream) => {
        publishedMedia = stream;
        for (const listener of mediaListeners) listener(stream);
      },
      input: mediaInput,
    },

    peerConnection: {
      create: (configuration) => {
        if (typeof RTCPeerConnection === 'undefined') throw new Error('peerConnection: this host has no WebRTC');
        return new RTCPeerConnection(configuration);
      },
    },

    // The wrapper is always present so late binding works; `available` is how a module asks whether
    // there is anything behind it.
    transcription: {
      available: () => services.transcription !== undefined && (services.transcription.available?.() ?? true),
      models: async () => (await services.transcription?.models()) ?? [],
      open: async (modelId, onText, tuning) => {
        const port = services.transcription;
        if (!port) throw new Error('transcription: this backend cannot transcribe');
        return port.open(modelId, onText, tuning);
      },
      offeredModel: () => services.transcription?.offeredModel?.() ?? null,
      installOfferedModel: async () => {
        const install = services.transcription?.installOfferedModel;
        if (!install) throw new Error('transcription: this backend cannot install a model');
        return install();
      },
    },

    languageModel: {
      available: async () => (await services.languageModel?.available()) ?? false,
      prompt: async (system, input) => {
        const port = services.languageModel;
        if (!port) throw new Error('languageModel: this backend has no language model');
        return port.prompt(system, input);
      },
    },

    // Binds the dataset as well as forwarding, so a module never handles a dataset handle. Resolved
    // per call rather than captured: a module store outlives a space switch.
    interpretation: {
      // The store's answer first, the port's second, and "a port exists" last — the last of the three
      // is what used to run, and it is true on every node including one that has never heard of the
      // feature.
      available: () =>
        services.interpretationAvailable?.() ??
        services.interpretation?.available?.() ??
        services.interpretation !== undefined,
      autoEnabled: (collectionId) => services.autoInterpretEnabled?.(collectionId) ?? false,
      setAuto: async (collectionId, on) => {
        const set = services.setAutoInterpret;
        if (!set) throw new Error('interpretation: this host cannot record a call’s extraction settings');
        await set(collectionId, on);
      },
      targets: (collectionId) => services.extractionTargets?.(collectionId) ?? [],
      setTarget: async (collectionId, entity, on) => {
        const set = services.setExtractionTarget;
        if (!set) throw new Error('interpretation: this host cannot record a call’s extraction targets');
        await set(collectionId, entity, on);
      },
      runOnCollection: async (collectionId) => {
        const run = services.interpretCollection;
        if (!run) throw new Error('interpretation: this backend cannot interpret');
        return run(collectionId);
      },
      watchCollection: async (collectionId) => {
        const start = services.watchCollection;
        if (!start) throw new Error('interpretation: this backend cannot run a standing watch');
        return start(collectionId);
      },
      unwatchCollection: async (collectionId) => {
        await services.unwatchCollection?.(collectionId);
      },
      reconcileCollection: async (collectionId) => (await services.reconcileCollection?.(collectionId)) ?? 0,
      // What follows a pass, in order: attach what it left unattached, then whatever host policy
      // follows from the collection's new contents. Each half best-effort on its own — a board that
      // could not be made is not a failed extraction.
      passSettled: async (collectionId) => {
        try {
          await services.reconcileCollection?.(collectionId);
        } catch (error) {
          console.warn('moduleHostServices: could not reconcile a settled pass', error);
        }
        try {
          await services.ensureBoardFor?.(collectionId);
        } catch (error) {
          console.warn('moduleHostServices: could not act on a settled pass', error);
        }
      },
      activity: () => services.interpretationActivity?.() ?? [],
      detailShared: () => services.interpretationDetailShared?.() ?? false,
      proposalsRevision: () => services.interpretationProposalsRevision?.() ?? 0,
      proposals: async (target, collection) => {
        const dataset = targeted(target);
        if (!dataset || !services.interpretation) return [];
        if (collection && services.proposalsForCollection) return services.proposalsForCollection(dataset, collection);
        return services.interpretation.proposals(dataset);
      },
      accept: async (id, property, target) => {
        const dataset = targeted(target);
        if (!dataset || !services.interpretation) return false;
        return services.interpretation.accept(dataset, id, property);
      },
      reject: async (id, property, target) => {
        const dataset = targeted(target);
        if (!dataset || !services.interpretation) return false;
        return services.interpretation.reject(dataset, id, property);
      },
    },
    // `secrets` is built per module by the registry, which knows the module's group.
  };

  return {
    signal: framework.signal,
    effect: framework.effect,
    // Placeholders the registry replaces per module; present so a store built straight from this bag
    // — a test — has the markers to hand.
    state: ((accessor: unknown, _doc: string) => (typeof accessor === 'function' ? accessor : () => accessor)) as never,
    action: ((fn: unknown) => fn) as never,

    dataset: () => services.dataset?.() ?? null,
    datasetUri: () => services.datasetUri?.() ?? null,
    callOnScreen: () => services.callOnScreen?.() ?? null,
    datasetRefKey: () => services.datasetRefKey?.() ?? '',
    selfId: () => services.selfId?.() ?? null,
    notify: (tone, message) => services.notify?.(tone, message),
    datasets: {
      get: (uri) => services.datasets?.get(uri),
      open: (uri) => services.datasets?.open(uri),
      openRef: (ref) => services.datasets?.openRef(ref),
      onRemoved: (cb) => services.datasets?.onRemoved?.(cb) ?? (() => {}),
    },
    identities: {
      get: (agentId) => services.identities?.get(agentId),
      fetch: (agentId) => services.identities?.fetch(agentId),
    },

    kernels,
  };
}

/** Who published the media stream other modules hear, or null. For the settings screen and tests. */
export function mediaPublisher(): string | null {
  return publishedBy;
}

/** The stream some module is capturing, or null — the non-reactive read, for host code. */
export function publishedMediaInput(): MediaStream | null {
  return publishedMedia;
}

/** Record who is publishing, so a second publisher can be reported. Called by the registry's media wrapper. */
export function notePublisher(moduleId: string, stream: MediaStream | null): void {
  if (stream && publishedBy && publishedBy !== moduleId) {
    console.warn(`media: "${moduleId}" is publishing audio while "${publishedBy}" already was; the newer stream wins`);
  }
  publishedBy = stream ? moduleId : publishedBy === moduleId ? null : publishedBy;
}
