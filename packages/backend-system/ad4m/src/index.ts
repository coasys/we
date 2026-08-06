/**
 * The AD4M implementation of WE's backend contract.
 *
 * Everything that knows what a `PerspectiveProxy` is lives here: the query adapter and its
 * capability profile, the ephemeral port, agent identity, SDNA install, and the model registry.
 * Gathered from six files scattered through `app-shell/src/shared/`, where AD4M knowledge sat
 * beside host concerns and was consequently impossible to see the shape of.
 *
 * Dependencies point *inward* — this package is imported by the shell and imports nothing from it.
 * Where that edge previously ran backwards (`installSpaceSdna` reading the host's module registry)
 * the models are now passed in by the caller.
 */

export {
  ad4mCapabilities,
  createAd4mDataBindings,
  createAd4mQueryAdapter,
  toRendererModel,
  type Ad4mAdapterDeps,
} from './ad4mAdapter';
export { ad4mEphemeralCapabilities, createAd4mEphemeralPort } from './ad4mEphemeralAdapter';
export * from './agentHelpers';
// Compat re-exports — the manifest-entry types now live in the contract, and the model registry
// lives with the model layer (@we/models); consumers migrate an import at a time.
export type { ModelManifestEntry, ModelManifestProperty } from '@we/backend-shared';
export {
  getModel,
  getModelForPerspective,
  getModelPredicates,
  getModelTargetClass,
  getRegisteredModelNames,
  type ModelClass,
  registerDynamicModels,
  registerModel,
  unregisterModel,
} from '@we/models';
export { type NeutralManifestResult, toNeutralManifest } from './neutralManifest';
export * from './perspectiveHelpers';
export * from './sdnaModels';
export * from './syncHelpers';
export {
  buildModelFromEntry,
  compileManifest,
  type CompileManifestOptions,
  CORE_VOCABULARY,
  manifestToEntries,
} from './manifestCompiler';
export { createAd4mAgentSession, createAd4mDatasetLifecycle } from './lifecycleAdapter';
export { createAd4mRuntimeAdmin } from './runtimeAdminAdapter';
export { createAd4mBackendPorts, createAd4mProfileDirectory, createAd4mSchemaPort } from './backendPortsAdapter';
