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
  toRendererEntity,
  VERIFIED_AGAINST_AD4M,
  type Ad4mAdapterDeps,
} from './ad4mAdapter';
export { ad4mEphemeralCapabilities, createAd4mEphemeralPort } from './ad4mEphemeralAdapter';
export * from './agentHelpers';
// Compat re-exports — the manifest-entry types now live in the contract, and the model registry
// lives with the model layer (@we/entities); consumers migrate an import at a time.
export type { EntityManifestEntry, EntityManifestProperty } from '@we/backend-shared';
export {
  getEntity,
  getEntitiesForPerspective,
  getEntityPredicates,
  getEntityTargetClass,
  getRegisteredEntityNames,
  type EntityClass,
  registerDynamicEntities,
  registerEntity,
  unregisterEntity,
} from '@we/entities';
export { type NeutralManifestResult, toNeutralManifest } from './neutralManifest';
export * from './interpretationHints';
export * from './perspectiveHelpers';
export * from './sdnaEntities';
export * from './syncHelpers';
export {
  buildEntityFromEntry,
  compileManifest,
  type CompileManifestOptions,
  CORE_VOCABULARY,
  manifestToEntries,
} from './manifestCompiler';
export { createAd4mAgentSession, createAd4mDatasetLifecycle } from './lifecycleAdapter';
export { type Ad4mRuntimeOptions, createAd4mRuntimeAdmin } from './runtimeAdminAdapter';
export { createAd4mBackendPorts, createAd4mProfileDirectory, createAd4mSchemaPort } from './backendPortsAdapter';
export { connectToLocalExecutor, createLocalAd4mConnector, type LocalExecutorConnection } from './localExecutor';
export { createAd4mTranscriptionPort } from './transcriptionAdapter';
export {
  createAd4mInterpretationPort,
  runtimeSupportsAutoProcessing,
  runtimeSupportsInterpretation,
  transcriptScopeQuery,
} from './interpretationAdapter';
export { type Ad4mCapability, capabilitiesFromToken, createCapabilityCheck } from './capabilities';
