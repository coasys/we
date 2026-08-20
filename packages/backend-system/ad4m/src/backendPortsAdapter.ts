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
  ModelManifest,
  ModelManifestEntry,
  ProfileDirectoryPort,
  SchemaPort,
} from '@we/backend-shared';
import { FILE_STORAGE_LANGUAGE } from '@we/models';
import {
  getModelForPerspective,
  mergeDynamicModels,
  type ModelClass,
  registerDynamicModels,
  registerFileStore,
  registerModel,
  registerTransactionRunner,
} from '@we/models';

import { createAd4mDataBindings } from './ad4mAdapter';
import { createAd4mEphemeralPort } from './ad4mEphemeralAdapter';
import { createFileExpression, getProfile, publishProfileToPublicPerspective } from './agentHelpers';
import { createAd4mInterpretationPort } from './interpretationAdapter';
import { readInterpretationHints, resetInterpretationHints, writeInterpretationHints } from './interpretationHints';
import { createAd4mLanguageModelPort } from './languageModelPort';
import { createAd4mAgentSession, createAd4mDatasetLifecycle } from './lifecycleAdapter';
import { compileManifest } from './manifestCompiler';
import { Space } from './models';
import { buildModelClasses, buildModelManifest, getForeignShacl } from './perspectiveHelpers';
import { type Ad4mRuntimeOptions, createAd4mRuntimeAdmin } from './runtimeAdminAdapter';
import {
  deduplicateSpaceSdna,
  ensureModelRegistered,
  installModuleSdna,
  installRootSdna,
  installSpaceSdna,
  isModelRegistered,
  refreshSpaceSdna,
  ROOT_MODELS,
  SPACE_MODELS,
} from './sdnaModels';
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
    ensure: (dataset, schema) => ensureModelRegistered(proxy(dataset), schema as never),
    hasCoreSchema: (dataset) => isModelRegistered(proxy(dataset), Space as never),
    hasAnySchema: async (dataset) => (await proxy(dataset).getShaclNames()).length > 0,

    async foreignSchemas(dataset): Promise<ModelManifestEntry[]> {
      const shapes = await getForeignShacl(proxy(dataset));
      registerDynamicModels(proxy(dataset).uuid, buildModelClasses(shapes));
      return buildModelManifest(shapes);
    },

    declare(manifest: ModelManifest, opts) {
      const classes = compileManifest(manifest, opts as Parameters<typeof compileManifest>[1]);
      for (const [name, cls] of Object.entries(classes)) registerModel(name, cls as ModelClass);
      return classes;
    },

    declareInDataset(dataset, manifest: ModelManifest, opts) {
      const classes = compileManifest(manifest, {
        ...opts,
        // Core vocabulary and the dataset's other dynamic entities are legitimate relation
        // targets; getModelForPerspective already prefers native classes, so a shape cannot
        // resolve a target to a shadowed core name.
        // The registry hands back the neutral class handle; this compiler is AD4M's own, so the
        // narrowing is definitionally sound here — everything registered on this backend IS one.
        resolveExternal: (name) => getModelForPerspective(name, dataset) as typeof Ad4mModel | undefined,
      });
      mergeDynamicModels(proxy(dataset).uuid, classes as Record<string, ModelClass>);
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

export function createAd4mBackendPorts(
  backendClient: unknown,
  ctx: BackendPortsContext,
  // Everything a host knows about the connection that the ports cannot see for themselves. Only
  // runtime administration cares so far — see `Ad4mRuntimeOptions.administersNode`.
  options: Ad4mRuntimeOptions = {},
): BackendPorts {
  // Register the native model classes for name-based $query resolution. Previously a module-load
  // side effect in the shell; it belongs to the backend choice. Use .className (set by @Model)
  // rather than .name — bundlers mangle the native .name in production builds.
  for (const M of [...ROOT_MODELS, ...SPACE_MODELS]) {
    registerModel((M as { className?: string }).className ?? M.name, M as unknown as ModelClass);
  }
  // Batching, registered beside the models it batches: the neutral runModelTransaction resolves
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
    lifecycle: createAd4mDatasetLifecycle(backendClient),
    schemas: createAd4mSchemaPort(backendClient),
    profiles: createAd4mProfileDirectory(backendClient),
    runtime: createAd4mRuntimeAdmin(backendClient, options),
    transcription: createAd4mTranscriptionPort(backendClient),
    languageModel: createAd4mLanguageModelPort(backendClient),
    // Takes no client: interpretation is entirely a per-dataset operation, and every call already
    // carries the dataset handle it needs.
    interpretation: createAd4mInterpretationPort(ctx.selfId),
    ephemeral,
    dataBindings: (deps: DataBindingDeps) =>
      createAd4mDataBindings({
        currentPerspective: () => (deps.currentDataset() as PerspectiveProxy | null) ?? null,
        currentPerspectiveModels: deps.currentDatasetModels,
        agents: deps.profiles,
        fetchAgent: deps.fetchProfile,
        ephemeralPort: deps.ephemeral,
      }),
    interop: {
      fluxSubgroupMessages: getFluxSubgroupMessages,
    },
  };
}
