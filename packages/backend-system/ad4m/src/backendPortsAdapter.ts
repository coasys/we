/**
 * The complete AD4M backend bundle — what an app's connector returns from
 * `BackendConnector.ports()`. One construction site for every port the shell consumes, so
 * "use AD4M" is a single line in the app and the shell names no backend at all.
 */
import type { Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';
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
import { type ModelClass, registerDynamicModels, registerModel } from '@we/models';
import { Space } from '@we/models/classes';

import { createAd4mDataBindings } from './ad4mAdapter';
import { createAd4mEphemeralPort } from './ad4mEphemeralAdapter';
import { createFileExpression, getProfile, publishProfileToPublicPerspective } from './agentHelpers';
import { createAd4mInterpretationPort } from './interpretationAdapter';
import { createAd4mAgentSession, createAd4mDatasetLifecycle } from './lifecycleAdapter';
import { compileManifest } from './manifestCompiler';
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
      const classes = compileManifest(manifest, opts);
      for (const [name, cls] of Object.entries(classes)) registerModel(name, cls as ModelClass);
      return classes;
    },

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

  const ephemeral = createAd4mEphemeralPort(ctx.selfId);

  return {
    agentSession: createAd4mAgentSession(backendClient),
    lifecycle: createAd4mDatasetLifecycle(backendClient),
    schemas: createAd4mSchemaPort(backendClient),
    profiles: createAd4mProfileDirectory(backendClient),
    runtime: createAd4mRuntimeAdmin(backendClient, options),
    transcription: createAd4mTranscriptionPort(backendClient),
    // Takes no client: interpretation is entirely a per-dataset operation, and every call already
    // carries the dataset handle it needs.
    interpretation: createAd4mInterpretationPort(),
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
