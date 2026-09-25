/**
 * The lifecycle half of the backend contract: how a host manages *which datasets exist* and
 * *whether the agent's session is usable* — as opposed to `dataSource.ts`, which is how the
 * renderer reads data out of a dataset that already exists.
 *
 * Read directly off the app shell's store surfaces (DatasetStore, SpaceStore, SessionStore):
 * everything those stores currently do through a concrete backend client is expressible against
 * these two ports, which is what lets their guts be adapter-filled — and what lets boot, dataset
 * switching, and space create/join run in tests against the in-memory implementation with no
 * executor.
 *
 * `DatasetRef` deliberately pairs a *described* surface (id/name/sharedUri — the fields the shell
 * reads for sidebars, ordering, and routing) with the *opaque* `DatasetHandle` that query and
 * model calls consume. The contract stays honest about both needs: lifecycle UIs need metadata,
 * data access needs the backend's native handle, and only the adapter that minted the handle ever
 * looks inside it.
 */
import type { DatasetHandle } from './dataSource';

export interface DatasetRef {
  /** Backend-local id. Stable within this backend, and meaningless on another agent's machine. */
  id: string;
  name: string;
  /** Global shared URI once published/joined, scheme included. Absent when local. */
  sharedUri?: string;
  /**
   * The scheme-less global id — what shared records store and compare. Minted by the adapter alongside `sharedUri` so no consumer ever parses a URI.
   */
  sharedId?: string;
  /** The opaque handle query/model calls consume. See `DatasetHandle`. */
  handle: DatasetHandle;
}

export interface DatasetChangeHandlers {
  /** A dataset appeared (created locally or synced in from another client/peer). */
  onAdded?: (ref: DatasetRef) => void;
  /** A dataset's metadata changed (rename, share-state transition). */
  onUpdated?: (ref: DatasetRef) => void;
  /** A dataset was removed, by any client. */
  onRemoved?: (id: string) => void;
}

/** A template a shared dataset's sync layer can be instantiated from, as `publish` accepts it. */
export interface LinkLanguageTemplate {
  address: string;
  /** The backend's own name for it — technical, for a detail line rather than a label. */
  name: string;
  /**
   * How a dataset published with it syncs: directly between members' devices, or through a server.
   * What a person choosing between templates actually needs to know, so it is what a picker labels.
   */
  kind: 'peer-to-peer' | 'server';
  /** The server it syncs through, for `kind: 'server'`. */
  serverUrl?: string;
}

/**
 * Dataset lifecycle — list/create/remove/share the containers themselves.
 *
 * `publish` and `join` are optional: a backend with no sharing concept (single-user, in-memory
 * test host) simply omits them, and callers degrade the same way they do for `presence`.
 */
export interface DatasetLifecyclePort {
  list(): Promise<DatasetRef[]>;
  get(id: string): Promise<DatasetRef | null>;
  create(name: string): Promise<DatasetRef>;
  remove(id: string): Promise<void>;
  /**
   * Publish an existing local dataset for sharing. Pass `linkLanguageTemplate` to choose
   * which link language backs the shared dataset; omit (or pass '') to use the first of
   * `linkLanguageTemplates`.
   */
  publish?(id: string, linkLanguageTemplate?: string): Promise<{ uri: string; sharedId: string }>;
  /**
   * Join a shared dataset. Accepts the backend's full URI or a bare shared id — normalization is
   * the adapter's dialect, not the caller's.
   */
  join?(idOrUri: string): Promise<DatasetRef>;
  /** Other agents holding a shared dataset (member roster), by dataset id. */
  members?(id: string): Promise<string[]>;
  /**
   * The templates `publish` can use, default first — the first is what `publish` picks when given
   * none. Templates needing parameters `publish` cannot supply are
   * left out.
   */
  linkLanguageTemplates?(): Promise<LinkLanguageTemplate[]>;
  /** Subscribe to change events. Returns an unsubscribe function. */
  subscribe(handlers: DatasetChangeHandlers): () => void;
}

/** The authenticated identity, by id — richer profile data is the identity directory's concern. */
export interface AgentIdentity {
  id: string;
  [k: string]: unknown;
}

export interface AgentSessionStatus {
  /** An agent exists on this backend (false → first-run/create flow). */
  hasAgent: boolean;
  /** The agent is unlocked and the session is usable. */
  unlocked: boolean;
}

/**
 * The backend did not finish an agent-session call in time.
 *
 * Distinct from a refusal, and the reason it is its own type: a timed-out unlock says nothing about
 * the password. Reporting it as "Incorrect password" sent people to retype a password that was
 * right, against a backend that was still starting. Adapters throw this so the shell can tell the
 * two apart without knowing the backend's transport or its error codes.
 */
export class SessionTimeoutError extends Error {
  constructor(message = 'The backend did not finish in time') {
    super(message);
    this.name = 'SessionTimeoutError';
  }
}

/** By name as well as by class, so a second copy of this package in a bundle still matches. */
export function isSessionTimeout(err: unknown): err is SessionTimeoutError {
  return err instanceof SessionTimeoutError || (err instanceof Error && err.name === 'SessionTimeoutError');
}

/**
 * The agent session — whether the backend's identity is present and usable, and the create/unlock/
 * lock operations around it. Connection *establishment* stays with the host-supplied connector (it
 * is platform-specific); this port is what the shell needs once a connection exists.
 *
 * `generate` and `unlock` reject with {@link SessionTimeoutError} when the backend is still working
 * after the adapter has waited as long as it will, and with any other error when it refused.
 */
export interface AgentSessionPort {
  status(): Promise<AgentSessionStatus>;
  /**
   * Create this backend's identity, encrypted under `password`, and leave it unlocked.
   *
   * The other half of `status().hasAgent === false`: without it the shell can detect a first run
   * but not resolve one, which is what left the desktop hosts stranded on a boot screen with no
   * way forward once the launcher stopped being in the picture. Every backend has some notion of
   * "no identity yet, make one", so it belongs beside unlock rather than in an adapter-specific
   * side channel.
   */
  generate(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(password: string): Promise<void>;
  me(): Promise<AgentIdentity>;
}
