/**
 * The backend contract.
 *
 * Everything about **getting data in and out, or talking to peers** — and nothing that knows what a
 * `SchemaNode` is. The adapters under `backend-system/` implement these; the shell and the modules
 * consume them.
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
export { RENDERER_BINDING_NAMES } from './dataSource';

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
  CONTAINMENT_PREDICATE,
  extractableEntities,
  getEntity,
  getProperty,
  getRelation,
  modelManifestSchema,
  resolvesPolymorphically,
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

/**
 * How one record names another that lives in a different dataset — the address a gathered item, an
 * embed and a deep link all hold. Here rather than in an adapter because an address only one
 * backend can write is not an address.
 */
export {
  datasetIdOf,
  datasetKey,
  HERE,
  datasetKindOf,
  formatAgentRef,
  formatRef,
  isPortableRef,
  parseRef,
  sameRef,
} from './recordRef';
export type { DatasetKind, RecordRef } from './recordRef';

export { queryIRSchema, filterSchema, validateQueryIR } from './queryIR';
export { validateQueryAgainstManifest } from './queryValidation';
export { planQuery } from './queryCapabilities';
export type { AdapterCapabilities, AggregateFn, Disposition, CapabilityGap, QueryPlan } from './queryCapabilities';
export { compileQuery, irToFlatQuery } from './queryCompiler';
export type { FlatQuery, CompileResult } from './queryCompiler';
export { routeQuery } from './queryRouting';
export { combineEntityRows, entityNamesOf, unionByFanOut } from './queryUnion';
export type { EntityRows, UnionPart } from './queryUnion';
export type { QueryDiagnostic, QueryRouting } from './queryRouting';
export { executeQueryIR } from './queryEngine';
export { rangeCompare, isRangeOp, RANGE_OPS } from './rangeCompare';
export type { RangeOp } from './rangeCompare';
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
  AgentCredentials,
  AgentSessionPort,
  AgentSessionStatus,
  DatasetChangeHandlers,
  DatasetLifecyclePort,
  DatasetRef,
  SharingOption,
} from './lifecycle';
export { isSessionTimeout, SessionTimeoutError } from './lifecycle';
export { manifestEntries } from './manifestEntry';
export type { EntityManifestEntry, EntityManifestProperty } from './manifestEntry';
export { NAME_CANDIDATES, nameFromProperties, namePropertyOf } from './recordName';
export type { NameableProperty } from './recordName';
export { ANONYMOUS_AGENT_NAME, displayName, isProfileEmpty } from './profileTypes';
export type { AgentProfileSummary, PublishProfileFields } from './profileTypes';
export type {
  BackendPorts,
  BackendPortsContext,
  DataBindingDeps,
  EntityHintState,
  ProfileDirectoryPort,
  ReferencePort,
  SchemaPort,
  UploadFile,
} from './backendPorts';
export type {
  AiApiProtocol,
  AiLocalModelSource,
  AiModel,
  AiModelDiscoveryQuery,
  AiModelDraft,
  AiModelKind,
  AiModelSource,
  AiModelSourceDraft,
  AiModelStatus,
  AiTask,
  ModelAdminPort,
  TokenizerSource,
} from './modelAdmin';
export type {
  AuthorizedApp,
  ConsentRequest,
  InstalledLanguage,
  PeerRecords,
  RuntimeAdminPort,
  UnsupportedCapability,
} from './runtimeAdmin';
export type {
  CreateOptions,
  IncludeExtras,
  IncludeOf,
  NewRecord,
  ParentRef,
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
export { RECORD_TYPE_KEY, recordTypeOf } from './recordContract';
export type {
  ConversationReply,
  ConversationRequest,
  ConversationTool,
  ConversationToolCall,
  ConversationTurn,
  LanguageModelPort,
  LanguageModelStatus,
} from './languageModel';
export {
  allowedMoves,
  approvalsFor,
  asksForMore,
  evidenceFor,
  isFinalState,
  itemFor,
  validateWorkflowDefinition,
} from './workflows';
export type {
  ApprovalsRequirement,
  WorkflowCapabilities,
  WorkflowDefinition,
  EvidenceRequirement,
  WorkflowItem,
  MoveOptions,
  MoveResult,
  WorkflowPort,
  Requirement,
  RequirementKind,
  AgentQuery,
  WorkflowState,
  Move,
  WorkflowSummary,
  Via,
  WorkflowTransition,
  WorkflowView,
  Proposal,
} from './workflows';
export type { CallPort, CallSessionOptions } from './call';
export { NO_IDENTITY_CAPABILITIES, readKeyLogEvent } from './identity';
export { SELF_PERSONS } from './persons';
export type { PersonPort } from './persons';
export type {
  DeviceKeyView,
  IdentityCapabilities,
  IdentityPort,
  IdentityStatusView,
  KeyLogDevice,
  KeyLogEvent,
  KeyLogFork,
  KeyLogHead,
  KeyLogView,
} from './identity';
export type {
  TranscriptionModelOffer,
  TranscriptionRecord,
  TranscriptionPort,
  TranscriptionStream,
  TranscriptionTuning,
} from './transcription';
export type {
  InterpretationPort,
  InterpretationProposal,
  InterpretationRequest,
  InterpretationResult,
  InterpretationScope,
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
