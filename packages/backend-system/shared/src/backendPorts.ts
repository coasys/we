/**
 * The full backend bundle a host's connector supplies — everything backend-specific the shell
 * consumes, in one typed object. The shell imports only this contract; the *app* chooses the
 * backend by returning an implementation from its `BackendConnector.ports()`.
 *
 * The surfaces here were read off what the executor-free boot suite had to mock: schema install
 * and the profile directory were the two capabilities the contract didn't yet name. With them
 * named, a complete backend is exactly: these ports plus the query adapter — and the boot suite
 * doubles as the conformance test.
 */
import type { DatasetHandle, RendererDataBindings } from './dataSource';
import type { EphemeralPort } from './ephemeral';
import type { InterpretationPort } from './interpretation';
import type { AgentSessionPort, DatasetLifecyclePort } from './lifecycle';
import type { ModelManifest } from './manifest';
import type { ModelManifestEntry } from './manifestEntry';
import type { AgentProfileSummary, PublishProfileFields } from './profileTypes';
import type { RuntimeAdminPort } from './runtimeAdmin';
import type { TranscriptionPort } from './transcription';

/**
 * Schema management on a dataset: installing the host's entity schemas, checking what a dataset
 * already holds, discovering foreign schemas, and compiling declared (manifest-form) entities
 * into this backend's installable representation.
 *
 * Schema payloads are opaque (`unknown`) — for AD4M they are decorated model classes; another
 * backend stores manifests directly. Only the adapter that minted a payload interprets it, the
 * same rule as `DatasetHandle`.
 */
export interface SchemaPort {
  /** Install the host's root-dataset schemas (personal config entities). Idempotent. */
  installRoot(dataset: DatasetHandle): Promise<void>;
  /** Install the host's space schemas plus the given module schemas. Idempotent. */
  installSpace(dataset: DatasetHandle, moduleSchemas: readonly unknown[]): Promise<void>;
  /** Install only the given module schemas (runs on every space switch — diffs before writing). */
  installModules(dataset: DatasetHandle, moduleSchemas: readonly unknown[]): Promise<void>;
  /**
   * Bring a dataset's already-installed space schemas up to date with the ones this build declares,
   * for a dataset that `installSpace` deliberately skips because it is already a host space.
   *
   * Runs on every space switch, so it must diff before writing. Returns the schemas it updated, or
   * an empty array — the common case — when everything stored was already current.
   */
  refreshSpace(dataset: DatasetHandle): Promise<string[]>;
  /** Ensure one schema payload is installed. Idempotent. */
  ensure(dataset: DatasetHandle, schema: unknown): Promise<void>;
  /** Whether the host's core space schema is installed (the "is this a WE space" check). */
  hasCoreSchema(dataset: DatasetHandle): Promise<boolean>;
  /** Whether the dataset has any schema at all (the auto-install trigger check). */
  hasAnySchema(dataset: DatasetHandle): Promise<boolean>;
  /**
   * Discover schemas foreign to the host (another app's entities synced into the dataset),
   * registering them for name-based query resolution and returning their manifest entries.
   */
  foreignSchemas(dataset: DatasetHandle): Promise<ModelManifestEntry[]>;
  /**
   * Compile a declared manifest into this backend's installable schema payloads, registered for
   * name-based query resolution. Keys are entity names.
   */
  declare(
    manifest: ModelManifest,
    opts: { moduleId: string; predicates?: Record<string, string> },
  ): Record<string, unknown>;
  /**
   * The interpretation hints a dataset currently stores for one entity, or null when the entity
   * has no installed schema there. Property hints are keyed by predicate — the stable storage
   * key; hosts map display names to predicates through the manifest entries they already hold.
   */
  interpretationHints(dataset: DatasetHandle, entity: string): Promise<EntityHintState | null>;
  /**
   * Customize an entity's interpretation hints in one dataset — a partial update (only the keys
   * given are touched; an empty-string hint removes that hint), marking the entity's hints as
   * space-owned so schema refreshes stop reverting them. Rejects when the entity has no schema
   * installed in the dataset.
   */
  setInterpretationHints(
    dataset: DatasetHandle,
    entity: string,
    hints: { classHint?: string; propHints?: Record<string, string> },
  ): Promise<void>;
  /**
   * Reset an entity's hints in one dataset to what its declaration ships, clearing the
   * space-owned marker — after which release improvements flow again.
   */
  resetInterpretationHints(dataset: DatasetHandle, entity: string): Promise<void>;
  /** Optional remediation for duplicated schema installs (backend-specific failure mode). */
  dedupe?(dataset: DatasetHandle): Promise<{ removed: number; authors: string[] }>;
}

/** What `SchemaPort.interpretationHints` answers — one entity's stored hint state in one dataset. */
export interface EntityHintState {
  classHint?: string;
  /** Property hints keyed by predicate (the storage key, not the display name). */
  propHints: Record<string, string>;
  /** Whether this dataset has customized the hints (they are space-owned there). */
  customized: boolean;
}

/**
 * The profile directory: read any agent's published profile, write the own profile, and store
 * binary payloads (avatars) retrievably. Backing storage is the backend's concern — public
 * dataset on AD4M, whatever another host has.
 */
export interface ProfileDirectoryPort {
  get(id: string): Promise<AgentProfileSummary>;
  publish(fields: PublishProfileFields): Promise<void>;
  /** Store a serialized file payload; returns a URL the profile can reference. */
  uploadFile(serialized: string): Promise<string>;
}

/** What the host hands the backend to build the renderer's data bindings. */
export interface DataBindingDeps {
  currentDataset(): DatasetHandle | null;
  currentDatasetModels(): ModelManifestEntry[];
  /** Reactive profile cache read — must be read inside the accessor (see `$identities`). */
  profiles(): Array<{ did?: string }>;
  fetchProfile(id: string): Promise<void> | void;
  ephemeral: EphemeralPort;
}

/** Host context available when the ports are constructed. */
export interface BackendPortsContext {
  /** The authenticated agent's id, read lazily (undefined until the session is usable). */
  selfId(): string | undefined;
}

/**
 * Ecosystem-specific interop the shell feature-detects — dialect queries against apps that share
 * the backend but not the host's schema conventions. Absent members degrade like presence.
 */
export interface BackendInterop {
  fluxSubgroupMessages?(
    dataset: DatasetHandle,
    subgroupId: string,
  ): Promise<Array<{ id: string; author: string; timestamp: string; body: string }>>;
}

export interface BackendPorts {
  agentSession: AgentSessionPort;
  lifecycle: DatasetLifecyclePort;
  schemas: SchemaPort;
  profiles: ProfileDirectoryPort;
  ephemeral: EphemeralPort;
  /** Build the renderer's data bindings over host-supplied accessors. */
  dataBindings(deps: DataBindingDeps): RendererDataBindings;
  interop?: BackendInterop;
  /**
   * Backend-process administration — trust, peer network, authorized apps, consent. Optional and
   * feature-detected member by member; see {@link RuntimeAdminPort}.
   */
  runtime?: RuntimeAdminPort;
  /**
   * Speech to text. Optional: a backend with no transcription model, or none at all, simply omits it
   * and anything that wanted to listen says so rather than failing silently.
   */
  transcription?: TranscriptionPort;
  /**
   * Turning what was said into typed records. Optional on the same terms as transcription — the two
   * are a pair, and a backend that can hear but not interpret is a normal thing to be.
   */
  interpretation?: InterpretationPort;
}
