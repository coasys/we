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
import type { CallPort } from './call';
import type { DatasetHandle, RendererDataBindings } from './dataSource';
import type { EphemeralPort } from './ephemeral';
import type { IdentityPort } from './identity';
import type { InterpretationPort } from './interpretation';
import type { LanguageModelPort } from './languageModel';
import type { AgentSessionPort, DatasetLifecyclePort } from './lifecycle';
import type { EntityManifest } from './manifest';
import type { EntityManifestEntry } from './manifestEntry';
import type { ModelAdminPort } from './modelAdmin';
import type { AgentProfileSummary, PublishProfileFields } from './profileTypes';
import type { RuntimeAdminPort } from './runtimeAdmin';
import type { TranscriptionPort } from './transcription';
import type { WorkflowPort } from './workflows';

/**
 * Schema management on a dataset: installing the host's entity schemas, checking what a dataset
 * already holds, discovering foreign schemas, and compiling declared (manifest-form) entities
 * into this backend's installable representation.
 *
 * Schema payloads are opaque (`unknown`) — one backend compiles them to model classes, another
 * stores manifests directly. Only the adapter that minted a payload interprets it, the
 * same rule as `DatasetHandle`.
 */
export interface SchemaPort {
  /**
   * Install the host's root-dataset schemas — the app's configuration entities, and nothing else.
   * Idempotent.
   *
   * No module list. Agent-scoped module entities used to install here, which made the root hold the
   * agent's things as well as the app's settings; they now install into the personal space through
   * `installSpace` / `installModules`. What keeps them out of a shared space is which dataset the host
   * hands those calls, not which method it calls. See `ModuleDefinition.entities.scope`.
   */
  installRoot(dataset: DatasetHandle): Promise<void>;
  /** Install the host's space schemas plus the given module schemas. Idempotent. */
  installSpace(dataset: DatasetHandle, moduleSchemas: readonly unknown[]): Promise<void>;
  /** Install only the given module schemas (runs on every space switch — diffs before writing). */
  installModules(dataset: DatasetHandle, moduleSchemas: readonly unknown[]): Promise<void>;
  /**
   * Bring a dataset's space schemas up to date with the ones this build declares, for a dataset that
   * `installSpace` deliberately skips because it is already a host space.
   *
   * Covers both ways a stored schema can be behind: one that changed since it was installed, and one
   * this build declares that the dataset never had at all. The second matters as much as the first —
   * a dataset predating a newly added entity can answer no query about it.
   *
   * Runs on every space switch, so it must diff before writing. Returns the schemas it wrote, or an
   * empty array — the common case — when everything stored was already current.
   */
  refreshSpace(dataset: DatasetHandle): Promise<string[]>;
  /** Ensure one schema payload is installed. Idempotent. */
  ensure(dataset: DatasetHandle, schema: unknown): Promise<void>;
  /** Whether the host's core space schema is installed (the "is this a WE space" check). */
  hasCoreSchema(dataset: DatasetHandle): Promise<boolean>;
  /**
   * Start the reads a switch into this dataset is about to make, and answer nothing.
   *
   * A hint: a backend that shares or caches those reads lets the switch find them done; one that
   * does not leaves this out. Called on boot for the space the address names, while the system
   * datasets are still being brought up.
   */
  prepare?(dataset: DatasetHandle): void;
  /** Whether the dataset has any schema at all (the auto-install trigger check). */
  hasAnySchema(dataset: DatasetHandle): Promise<boolean>;
  /**
   * Discover schemas foreign to the host (another app's entities synced into the dataset),
   * registering them for name-based query resolution and returning their manifest entries.
   */
  foreignSchemas(dataset: DatasetHandle): Promise<EntityManifestEntry[]>;
  /**
   * Compile a declared manifest into this backend's installable schema payloads, registered for
   * name-based query resolution. Keys are entity names. `resolveExternal` resolves relation
   * targets defined outside the manifest (core vocabulary, sibling shapes) to this backend's own
   * payloads — pass through what the backend previously minted, never construct one.
   */
  declare(
    manifest: EntityManifest,
    opts: { moduleId: string; predicates?: Record<string, string>; resolveExternal?: (name: string) => unknown },
  ): Record<string, unknown>;
  /**
   * The same manifest, projected onto neutral entries — every property and relation with the
   * predicate this backend actually minted for it.
   *
   * The read half of `declare`, and needed because a query's `scope` is resolved against a list of
   * entries rather than against the compiled classes: an adapter looks `via` up by name and reads
   * its predicate. A module declaring a relation and then drilling into it had no way to be in that
   * list, so the drill-down failed with "no such relation in the current dataset's model
   * manifest" — which is a true statement about a list the entity was never added to.
   *
   * A port rather than a rule the host reapplies, because *this backend* decides what a declared
   * property is called on the wire — override, then core vocabulary, then minted under the module's
   * subtree — and a second implementation of that ordering is a second chance to disagree with it.
   */
  entries(
    manifest: EntityManifest,
    opts: { moduleId: string; predicates?: Record<string, string> },
  ): EntityManifestEntry[];
  /**
   * Compile a declared manifest and register its entities for name-based query resolution *in one
   * dataset only* — the space-shape path. A shape a space carries must resolve there and nowhere
   * else, which is exactly what module `declare` (global by design) must not do. Relation targets
   * outside the manifest resolve against what the dataset already knows (host vocabulary plus its
   * other dynamic entities). Does not install anything — pass the returned payloads to `ensure`.
   */
  declareInDataset(
    dataset: DatasetHandle,
    manifest: EntityManifest,
    opts: { moduleId: string },
  ): Record<string, unknown>;
  /**
   * The interpretation hints a dataset currently stores for one entity, or null when the entity
   * has no installed schema there. Property hints are keyed by property name, as the entity
   * declares it — how a backend stores a property is its own business.
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

/** A file to store, as `ProfileDirectoryPort.uploadFile` takes it. */
export interface UploadFile {
  /** The bytes, base64-encoded with no `data:` prefix. */
  base64: string;
  mimeType: string;
  name: string;
}

/** What `SchemaPort.interpretationHints` answers — one entity's stored hint state in one dataset. */
export interface EntityHintState {
  classHint?: string;
  /** Property hints keyed by property name. */
  propHints: Record<string, string>;
  /** Whether this dataset has customized the hints (they are space-owned there). */
  customized: boolean;
}

/**
 * The profile directory: read any agent's published profile, write the own profile, and store
 * binary payloads (avatars) retrievably. Backing storage is the backend's concern — an agent's
 * public dataset, a directory service, whatever the host has.
 */
export interface ProfileDirectoryPort {
  get(id: string): Promise<AgentProfileSummary>;
  publish(fields: PublishProfileFields): Promise<void>;
  /** Store a file; returns a URL the profile can reference. */
  uploadFile(file: UploadFile): Promise<string>;
}

/** What the host hands the backend to build the renderer's data bindings. */
export interface DataBindingDeps {
  currentDataset(): DatasetHandle | null;
  currentDatasetEntities(): EntityManifestEntry[];
  /** Reactive profile cache read — must be read inside the accessor (see `$identities`). */
  profiles(): Array<{ did?: string }>;
  /**
   * One agent, as a read that depends on that agent alone. Preferred over scanning `profiles()`.
   *
   * `$identities.get` is called once per `$agent` row, and a transcript is hundreds of rows. Against
   * `profiles()` — one array that is rebuilt whenever anybody lands — each of those reads depends on
   * the whole cache, so a single peer resolving wakes every row in the app. A host that can answer
   * per DID supplies this and the dependency narrows to the row's own agent.
   *
   * Optional because it is an optimisation, not a capability: a host without it keeps working
   * through `profiles()`, which is what the in-memory backend and the tests do.
   */
  profileFor?(id: string): { did?: string } | undefined;
  fetchProfile(id: string): Promise<void> | void;
  ephemeral: EphemeralPort;
}

/** Host context available when the ports are constructed. */
export interface BackendPortsContext {
  /** The authenticated agent's id, read lazily (undefined until the session is usable). */
  selfId(): string | undefined;
}

export interface BackendPorts {
  agentSession: AgentSessionPort;
  lifecycle: DatasetLifecyclePort;
  schemas: SchemaPort;
  profiles: ProfileDirectoryPort;
  ephemeral: EphemeralPort;
  /** Build the renderer's data bindings over host-supplied accessors. */
  dataBindings(deps: DataBindingDeps): RendererDataBindings;
  /**
   * Backend-process administration — trust, peer network, authorized apps, consent. Optional and
   * feature-detected member by member; see {@link RuntimeAdminPort}.
   */
  runtime?: RuntimeAdminPort;
  /**
   * The models the backend runs, and changing them. Optional, and feature-detected member by member;
   * see {@link ModelAdminPort}.
   */
  models?: ModelAdminPort;
  /**
   * Speech to text. Optional: a backend with no transcription model, or none at all, simply omits it
   * and anything that wanted to listen says so rather than failing silently.
   */
  transcription?: TranscriptionPort;
  /**
   * Text generation on the backend's own model. Optional on the same terms as transcription: a
   * node with no language model omits it, and anything that wanted to generate says so.
   */
  languageModel?: LanguageModelPort;
  /**
   * Turning what was said into typed records. Optional on the same terms as transcription — the two
   * are a pair, and a backend that can hear but not interpret is a normal thing to be.
   */
  interpretation?: InterpretationPort;
  /**
   * Rules over a record's state, and moves made under them. Optional: a backend that cannot enforce
   * rules omits it, and a surface that would have asked for agreement falls back to writing the state.
   */
  workflows?: WorkflowPort;
  /**
   * Who points at a value through one predicate — every message that mentions an agent. Optional: a
   * backend that cannot answer omits it, and a surface asking falls back to what it can read.
   */
  references?: ReferencePort;
  /**
   * Audio and video calls run by the backend. Optional: a backend without one omits it, and the call
   * module cannot build a session there.
   */
  call?: CallPort;
  /**
   * The person's identity beyond this session — passwords and passkeys, keys, devices, bots, plan.
   * Optional: absent, every part of Settings that needs it says "coming soon"; see
   * {@link IdentityPort}.
   */
  identity?: IdentityPort;
}

/**
 * The records that hold one value through one relation, newest first.
 *
 * The question a query cannot ask: "which messages mention this agent" is a relation whose target
 * is a DID rather than a record, so "has a linked record matching…" has nothing to match against.
 * Asked from the target's end it is one lookup on a store indexed by link, however many messages the
 * space holds — which is what makes a mentions inbox affordable rather than a scan.
 *
 * The relation is named as the holding entity declares it (`{ relation: 'mentions' }`), with
 * `entity` where the name alone does not decide — never by how a backend stores it.
 */
export interface ReferencePort {
  referrers(
    dataset: DatasetHandle,
    relation: { relation: string; entity?: string },
    target: string,
    opts?: { limit?: number },
  ): Promise<{ id: string; author: string; at: string }[]>;
}
