/**
 * The complete AD4M backend bundle — what an app's connector returns from
 * `BackendConnector.ports()`. One construction site for every port the shell consumes, so
 * "use AD4M" is a single line in the app and the shell names no backend at all.
 */
import type { Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel } from '@coasys/ad4m';
import type {
  BackendPorts,
  BackendPortsContext,
  DataBindingDeps,
  DatasetHandle,
  EntityManifest,
  EntityManifestEntry,
  ProfileDirectoryPort,
  SchemaPort,
} from '@we/backend-shared';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';
import {
  type EntityClass,
  getEntitiesForPerspective,
  mergeDynamicEntities,
  registerDynamicEntities,
  registerEntity,
  registerFileStore,
  registerTransactionRunner,
} from '@we/entities';

import { createAd4mDataBindings } from './ad4mAdapter';
import { createAd4mEphemeralPort } from './ad4mEphemeralAdapter';
import { createFileExpression, getProfile, publishProfileToPublicPerspective } from './agentHelpers';
import { installClearOnEmpty } from './clearOnEmpty';
import { Space } from './entities';
import { createAd4mInterpretationPort } from './interpretationAdapter';
import { readInterpretationHints, resetInterpretationHints, writeInterpretationHints } from './interpretationHints';
import { type Ad4mHttpConnection, createAd4mLanguageModelPort } from './languageModelPort';
import { type Ad4mLifecycleOptions, createAd4mAgentSession, createAd4mDatasetLifecycle } from './lifecycleAdapter';
import { compileManifest, manifestToEntries } from './manifestCompiler';
import { buildEntityClasses, buildEntityManifest, getForeignShacl } from './perspectiveHelpers';
import { installRelationWrites } from './relationWrites';
import { type Ad4mRuntimeOptions, createAd4mRuntimeAdmin } from './runtimeAdminAdapter';
import {
  deduplicateSpaceSdna,
  ensureEntityRegistered,
  installModuleSdna,
  installRootSdna,
  installSpaceSdna,
  isEntityRegistered,
  refreshSpaceSdna,
  ROOT_MODELS,
  SPACE_MODELS,
} from './sdnaEntities';
import { getFluxSubgroupMessages } from './syncHelpers';
import { createAd4mTranscriptionPort } from './transcriptionAdapter';

const proxy = (dataset: DatasetHandle) => dataset as PerspectiveProxy;

export function createAd4mSchemaPort(backendClient: unknown): SchemaPort {
  const client = backendClient as Ad4mClient;
  void client; // schema install operates on dataset handles; the client stays for future needs

  return {
    installRoot: (dataset) => installRootSdna(proxy(dataset)),
    installSpace: (dataset, moduleSchemas) => installSpaceSdna(proxy(dataset), moduleSchemas),
    installModules: (dataset, moduleSchemas) => installModuleSdna(proxy(dataset), moduleSchemas),
    refreshSpace: (dataset) => refreshSpaceSdna(proxy(dataset)),
    ensure: (dataset, schema) => ensureEntityRegistered(proxy(dataset), schema as never),
    hasCoreSchema: (dataset) => isEntityRegistered(proxy(dataset), Space as never),
    hasAnySchema: async (dataset) => (await proxy(dataset).getShaclNames()).length > 0,

    async foreignSchemas(dataset): Promise<EntityManifestEntry[]> {
      const shapes = await getForeignShacl(proxy(dataset));
      registerDynamicEntities(proxy(dataset).uuid, buildEntityClasses(shapes));
      return buildEntityManifest(shapes);
    },

    declare(manifest: EntityManifest, opts) {
      const classes = compileManifest(manifest, {
        ...(opts as Parameters<typeof compileManifest>[1]),
        // A module manifest holds only its own entities, so a relation it INHERITS — `signals`,
        // the one typed edge on WeNode — names a class the manifest cannot see. Without a
        // resolver the target thunk answers undefined, the shape loses `sh:class` and
        // `ad4m:targetClassName`, and `include: { signals: true }` on that entity then fails the
        // whole query at read time ("the relation declares no target class"). No dataset here, so
        // this reads the global registry, where the native classes are registered before any
        // module compiles — and the thunk is lazy, so the order does not matter either way.
        resolveExternal: (name) =>
          (opts.resolveExternal?.(name) ?? getEntitiesForPerspective(name)) as typeof Ad4mModel | undefined,
      });
      for (const [name, cls] of Object.entries(classes)) registerEntity(name, cls as EntityClass);
      return classes;
    },

    // The read half of `declare`, through the very function `compileManifest` builds its classes
    // from — so the predicate a `scope` resolves against and the one the class writes cannot differ.
    entries: (manifest: EntityManifest, opts) => manifestToEntries(manifest, opts as never),

    declareInDataset(dataset, manifest: EntityManifest, opts) {
      const classes = compileManifest(manifest, {
        ...opts,
        // Core vocabulary and the dataset's other dynamic entities are legitimate relation
        // targets; getEntitiesForPerspective already prefers native classes, so a shape cannot
        // resolve a target to a shadowed core name.
        // The registry hands back the neutral class handle; this compiler is AD4M's own, so the
        // narrowing is definitionally sound here — everything registered on this backend IS one.
        resolveExternal: (name) => getEntitiesForPerspective(name, dataset) as typeof Ad4mModel | undefined,
      });
      mergeDynamicEntities(proxy(dataset).uuid, classes as Record<string, EntityClass>);
      return classes;
    },

    interpretationHints: (dataset, entity) => readInterpretationHints(proxy(dataset), entity),
    setInterpretationHints: (dataset, entity, hints) => writeInterpretationHints(proxy(dataset), entity, hints),
    resetInterpretationHints: (dataset, entity) => resetInterpretationHints(proxy(dataset), entity),

    dedupe: (dataset) => deduplicateSpaceSdna(proxy(dataset)),
  };
}

export function createAd4mProfileDirectory(backendClient: unknown): ProfileDirectoryPort {
  return {
    get: (id) => getProfile(id, backendClient),
    publish: (fields) => publishProfileToPublicPerspective(fields, backendClient),
    uploadFile: (serialized) => createFileExpression(backendClient, serialized),
  };
}

/**
 * How to reach the executor over plain HTTP, for the surfaces its RPC client does not cover.
 *
 * `Ad4mClient` keeps its base URL and token private, and a tool-calling conversation goes through
 * `/v1/chat/completions` rather than an RPC. So the connector — which chose both — hands them over.
 */
export interface Ad4mConnectionOptions {
  connection?: () => Ad4mHttpConnection | null;
}

export function createAd4mBackendPorts(
  backendClient: unknown,
  ctx: BackendPortsContext,
  // Everything a host knows about the connection that the ports cannot see for themselves: whether
  // the node is ours to administer (`Ad4mRuntimeOptions`), and the deployment's sharing
  // infrastructure (`Ad4mLifecycleOptions`).
  options: Ad4mRuntimeOptions & Ad4mLifecycleOptions & Ad4mConnectionOptions = {},
): BackendPorts {
  // `''` clears a property, which is what four separate call sites in WE already assumed and none
  // of them got. Installed before any model is registered so every class inherits it — generated,
  // manifest-compiled or built from foreign SHACL. See `clearOnEmpty.ts` for what it repairs.
  installClearOnEmpty(Ad4mModel);
  // And the relation writes, for the same reason and in the same place: the contract can say
  // "this relation's membership is now that list", and every model class — generated, compiled
  // or built from foreign SHACL — inherits the ability to carry it out. See `relationWrites.ts`.
  installRelationWrites(Ad4mModel);
  // Register the native model classes for name-based $query resolution. Previously a module-load
  // side effect in the shell; it belongs to the backend choice. Use .className (set by @Model)
  // rather than .name — bundlers mangle the native .name in production builds.
  for (const M of [...ROOT_MODELS, ...SPACE_MODELS]) {
    registerEntity((M as { className?: string }).className ?? M.name, M as unknown as EntityClass);
  }
  // Batching, registered beside the models it batches: the neutral runEntityTransaction resolves
  // to AD4M's own transaction here, and to individual writes on a backend without one.
  registerTransactionRunner((dataset, run) =>
    Ad4mModel.transaction(dataset as PerspectiveProxy, (tx) => run({ batchId: tx.batchId })),
  );
  // File storage the same way: format:'file' properties resolve their bytes through this backend's
  // file-storage language, and the address shape is this backend's own.
  registerFileStore({
    store: (dataset, file) => (dataset as PerspectiveProxy).createExpression(file, FILE_STORAGE_LANGUAGE),
    fetch: async (dataset, address) => {
      const expr = await (dataset as PerspectiveProxy).getExpression(address);
      if (!expr?.data) return null;
      const data = typeof expr.data === 'string' ? JSON.parse(expr.data) : expr.data;
      return data?.data_base64 && data?.file_type ? data : null;
    },
  });

  const ephemeral = createAd4mEphemeralPort(ctx.selfId);

  return {
    agentSession: createAd4mAgentSession(backendClient),
    lifecycle: createAd4mDatasetLifecycle(backendClient, options),
    schemas: createAd4mSchemaPort(backendClient),
    profiles: createAd4mProfileDirectory(backendClient),
    runtime: createAd4mRuntimeAdmin(backendClient, options),
    transcription: createAd4mTranscriptionPort(backendClient, options),
    languageModel: createAd4mLanguageModelPort(backendClient, options.connection),
    // Takes no client: interpretation is entirely a per-dataset operation, and every call already
    // carries the dataset handle it needs.
    interpretation: createAd4mInterpretationPort(ctx.selfId),
    ephemeral,
    dataBindings: (deps: DataBindingDeps) =>
      createAd4mDataBindings({
        currentPerspective: () => (deps.currentDataset() as PerspectiveProxy | null) ?? null,
        currentPerspectiveEntities: deps.currentDatasetEntities,
        agents: deps.profiles,
        fetchAgent: deps.fetchProfile,
        ephemeralPort: deps.ephemeral,
      }),
    interop: {
      fluxSubgroupMessages: getFluxSubgroupMessages,
    },
  };
}
