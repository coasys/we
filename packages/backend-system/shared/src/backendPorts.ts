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
import type { AgentSessionPort, DatasetLifecyclePort } from './lifecycle';
import type { ModelManifest } from './manifest';
import type { ModelManifestEntry } from './manifestEntry';
import type { AgentProfileSummary, PublishProfileFields } from './profileTypes';

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
  /** Optional remediation for duplicated schema installs (backend-specific failure mode). */
  dedupe?(dataset: DatasetHandle): Promise<{ removed: number; authors: string[] }>;
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
}
