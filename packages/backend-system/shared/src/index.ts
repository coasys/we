/**
 * The backend contract.
 *
 * Everything about **getting data in and out, or talking to peers** — and nothing that knows what a
 * `SchemaNode` is. An adapter (`@we/backend-ad4m`, `@we/backend-inmemory`) implements these; the
 * shell and the modules consume them.
 *
 * Split out of `@we/schema-shared`, which had accreted five unrelated concerns into 9,000 LOC that
 * every module peer-depended on in full — `@we/module-call` needed four exports and pulled the whole
 * schema engine, indexer and validator to get them.
 *
 * This package imports nothing from the schema side, which is the property worth preserving: ports
 * and query are the base layer, and a backend should never need to know how a template renders.
 */

export type {
  DatasetHandle,
  QueryOptions,
  QuerySubscription,
  EntityClass,
  MutationApi,
  DataSource,
  QueryAdapter,
  RendererDataBindings,
  RendererStores,
} from './dataSource';

export { createInMemoryEphemeralPort, InMemoryBus, inMemoryEphemeralCapabilities, planEphemeral } from './ephemeral';
export type {
  EphemeralCapabilities,
  EphemeralChannel,
  EphemeralScope,
  EphemeralPort,
  EphemeralRequirements,
  EphemeralGap,
  EphemeralPlan,
  PublishResult,
} from './ephemeral';

export {
  applyFocusDepth,
  activitiesOfType,
  callRosters,
  createHeartbeatPresence,
  derivePeers,
  peerTone,
  peersInDataset,
  peersMatching,
  sortByPresence,
  DEFAULT_HEARTBEAT_INTERVAL,
  DEFAULT_THRESHOLDS,
} from './presence';
export type {
  Activity,
  Availability,
  Focus,
  FocusDepth,
  HeartbeatOptions,
  Liveness,
  LivenessThresholds,
  MediaSettings,
  Peer,
  PresenceTone,
  PresenceChannel,
  PresenceSource,
  PresenceState,
} from './presence';

export { setTraceSink, trace, tracing } from './trace';
export type { TraceSink } from './trace';

export {
  blockableEntities,
  extractableEntities,
  getEntity,
  getProperty,
  getRelation,
  modelManifestSchema,
  validateManifest,
} from './manifest';
export type {
  EntityManifest,
  EntitySchema,
  PropertySchema,
  RelationSchema,
  ScalarType,
  Cardinality,
  ManifestError,
} from './manifest';

export { queryIRSchema, filterSchema, validateQueryIR } from './queryIR';
export { validateQueryAgainstManifest } from './queryValidation';
export { planQuery } from './queryCapabilities';
export type { AdapterCapabilities, AggregateFn, Disposition, CapabilityGap, QueryPlan } from './queryCapabilities';
export { compileQuery, irToFlatQuery, whereUsesCombinator } from './queryCompiler';
export type { FlatQuery, CompileResult } from './queryCompiler';
export { executeQueryIR } from './queryEngine';
export type { Row, InMemoryDataset, InMemoryRelation } from './queryEngine';
export type {
  QueryIR,
  Filter,
  Op,
  Scalar,
  SortKey,
  Page,
  IncludeSpec,
  IncludeMap,
  Aggregation,
  Scope,
  IRError,
} from './queryIR';
export type {
  AgentIdentity,
  AgentSessionPort,
  AgentSessionStatus,
  DatasetChangeHandlers,
  DatasetLifecyclePort,
  DatasetRef,
} from './lifecycle';
export { manifestEntries } from './manifestEntry';
export type { EntityManifestEntry, EntityManifestProperty } from './manifestEntry';
export { ANONYMOUS_AGENT_NAME, displayName, isProfileEmpty } from './profileTypes';
export type { AgentProfileSummary, PublishProfileFields } from './profileTypes';
export type {
  BackendInterop,
  BackendPorts,
  BackendPortsContext,
  DataBindingDeps,
  EntityHintState,
  ProfileDirectoryPort,
  SchemaPort,
} from './backendPorts';
export type {
  AiModel,
  AiModelDraft,
  AiModelKind,
  AiModelSource,
  AiModelStatus,
  AiTask,
  AuthorizedApp,
  ConsentRequest,
  InstalledLanguage,
  RuntimeAdminPort,
  TokenizerSource,
} from './runtimeAdmin';
export type {
  IncludeExtras,
  IncludeOf,
  RecordDataKeys,
  RecordInstance,
  EntityStatic,
  PropertyKeysOf,
  RelatedEntity,
  RelationKeysOf,
  TypedIncludeMap,
  TypedIncludeProjection,
  TypedEntityQuery,
  TypedOrder,
  TypedWhere,
  WriteProperties,
} from './recordContract';
export type { LanguageModelPort } from './languageModel';
export type { TranscriptionRecord, TranscriptionPort, TranscriptionStream, TranscriptionTuning } from './transcription';
export type {
  InterpretationPort,
  InterpretationProposal,
  InterpretationRequest,
  InterpretationResult,
  TranscriptTurn,
  WatchRequest,
} from './interpretation';
export {
  byActivityInterest,
  INTERPRETATION_ACTIVITY_TTL_MS,
  isSettled,
  isStale,
  mergeActivity,
} from './interpretationActivity';
export type { InterpretationActivity, InterpretationLlmExchange, InterpretationPhase } from './interpretationActivity';
export { createInterpretationRelay, INTERPRETATION_ACTIVITY_CHANNEL } from './interpretationRelay';
export type { InterpretationRelay, RelayOptions } from './interpretationRelay';
