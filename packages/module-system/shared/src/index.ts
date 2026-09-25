/**
 * The feature-module contract.
 *
 * Everything about **declaring, gating and mounting a module** — what a module says about itself,
 * and what the host lends it in return. This is the package a module author installs; it re-exports
 * the port types a module store is handed so that a module needs one dependency, not three.
 *
 * Read `module.ts` first (the definition), then `kernels.ts` (what a store may reach), then
 * `store.ts` (how a store says what is public).
 */

export { DEV_TOOLS_KEY, devToolsEnabled, setDevToolsMuted } from './devTools';
export type { InterpretationActivitySummary, InterpretationKernel } from './interpretation';
export { KERNEL_NAMES } from './kernels';
export { lintModule } from './lint';
export type { ModuleLint } from './lint';
export type {
  AgentDataKernel,
  ComposedDocument,
  CopiedIn,
  DocumentAccess,
  KernelName,
  LanguageModelKernel,
  LiveAnchor,
  LiveDecoration,
  MediaDevice,
  MediaKernel,
  ModuleKernels,
  PeerConnectionKernel,
  PresenceKernel,
  RecordQuery,
  RecordsKernel,
  SecretsKernel,
  TranscriptionKernel,
  ViewFrame,
  ViewKernel,
  WrittenDocument,
} from './kernels';
export {
  checkModuleCompatibility,
  defineModule,
  moduleCapabilities,
  modulePredicatePrefix,
  modulePredicateViolations,
  seedCapabilityToModule,
} from './module';
export type {
  ActivityShape,
  BlockContribution,
  ChromeReserve,
  CoreSlotAnchor,
  CreateEntityOptions,
  DatasetTarget,
  DockAspect,
  DockEdge,
  DockMin,
  DockSize,
  ModuleCompatibility,
  ModuleContributions,
  ModuleDataset,
  ModuleDatasetAccess,
  ModuleDefinition,
  ModuleEmbed,
  ModuleEntities,
  ModuleFunction,
  ModuleHost,
  ModuleHostProfile,
  ModuleIdentity,
  ModuleIdentityAccess,
  ModuleLauncher,
  ModuleManifest,
  ModulePart,
  ModulePermission,
  ModuleRequirements,
  ModuleScope,
  ModuleSetting,
  ModuleStoreDeps,
  PanelBid,
  PanelContribution,
  SettingLevel,
  SettingResolution,
  SlotAnchor,
  SlotContribution,
} from './module';
export { markAction, markState, memberDoc, memberKind, storeSurface } from './store';
export type { ModuleMemberKind, ModuleMemberSurface, ModuleStore, ModuleStoreSurface } from './store';

/**
 * Re-exported so a module declares one dependency rather than three. A module store is *handed*
 * these by the host through `ModuleStoreDeps`; it needs the types to describe what it received, and
 * `planEphemeral` to check the port it was lent actually meets its requirements.
 *
 * Deliberately a subset — this is the module-facing surface, not all of `@we/backend-shared`.
 */
export { activitiesOfType, planEphemeral } from '@we/backend-shared';
export type {
  Activity,
  DatasetHandle,
  EphemeralChannel,
  EphemeralGap,
  EphemeralPlan,
  EphemeralPort,
  EphemeralRequirements,
  EphemeralScope,
  Focus,
  MediaSettings,
  Peer,
} from '@we/backend-shared';
