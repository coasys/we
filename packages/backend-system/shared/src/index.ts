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
  ModelClass,
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

export { modelManifestSchema, validateManifest, getEntity, getProperty, getRelation } from './manifest';
export type {
  ModelManifest,
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
