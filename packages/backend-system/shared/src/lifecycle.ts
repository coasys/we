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

/** One way a shared dataset can sync, as `publish` accepts it. */
export interface SharingOption {
  /** What `publish` is given to choose it. Opaque — only the backend that listed it reads it. */
  id: string;
  /** The backend's own name for it — technical, for a detail line rather than a label. */
  name: string;
  /**
   * How a dataset published with it syncs: directly between members' devices, or through a server.
   * What a person choosing between options actually needs to know, so it is what a picker labels.
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
  /**
   * Every dataset this agent holds. A backend may answer from what it has already heard rather than
   * asking again; `fresh` asks again. Pass it where the question is whether something arrived that
   * an event may not have announced — a join the transport gave up on, say.
   */
  list(options?: { fresh?: boolean }): Promise<DatasetRef[]>;
  get(id: string): Promise<DatasetRef | null>;
  create(name: string): Promise<DatasetRef>;
  remove(id: string): Promise<void>;
  /**
   * Publish an existing local dataset for sharing. `sharing` chooses how it syncs, by the id of one
   * of `sharingOptions`; omit it (or pass '') for the first of them.
   */
  publish?(id: string, options?: { sharing?: string }): Promise<{ uri: string; sharedId: string }>;
  /**
   * Join a shared dataset. Accepts the backend's full URI or a bare shared id — normalization is
   * the adapter's dialect, not the caller's.
   */
  join?(idOrUri: string): Promise<DatasetRef>;
  /**
   * Resolves once a dataset holds what it shares — at once for one that has, or is not shared —
   * and rejects when it never can. A join returns before the dataset has synced, so until this
   * resolves it holds nothing of the shared data: read it, or write schema based on what it holds,
   * only after. Absent on a backend whose datasets are complete as soon as they exist.
   */
  whenSynced?(id: string): Promise<void>;
  /** Other agents holding a shared dataset (member roster), by dataset id. */
  members?(id: string): Promise<string[]>;
  /**
   * The ways `publish` can share a dataset, default first — the first is what `publish` picks when
   * given none. An option needing settings this deployment has not supplied is left out.
   */
  sharingOptions?(): Promise<SharingOption[]>;
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
 * The agent session — whether the backend's identity is present and usable, and signing up, in
 * and out around it. Connection *establishment* stays with the host-supplied connector (it
 * is platform-specific); this port is what the shell needs once a connection exists.
 *
 * `signUp` and `signIn` reject with {@link SessionTimeoutError} when the backend is still working
 * after the adapter has waited as long as it will, and with any other error when it refused.
 */
export interface AgentSessionPort {
  status(): Promise<AgentSessionStatus>;
  /**
   * Create this backend's identity from `credentials`, and leave the session signed in.
   *
   * The other half of `status().hasAgent === false`: without it the shell can detect a first run
   * but not resolve one, which is what left the desktop hosts stranded on a boot screen with no
   * way forward once the launcher stopped being in the picture. Every backend has some notion of
   * "no identity yet, make one", so it belongs beside signing in rather than in an adapter-specific
   * side channel.
   */
  signUp(credentials: AgentCredentials): Promise<void>;
  /** Sign in as the identity that exists. Rejects when the credentials are refused. */
  signIn(credentials: AgentCredentials): Promise<void>;
  /**
   * End the session this port began.
   *
   * Takes nothing, so the shell need not keep a password after signing in: a backend that needs one
   * to end a session keeps what `signIn` or `signUp` was given. Answers false when there was nothing
   * here to end — the session was already open when the app arrived, so nothing this port was given
   * can close it, and the caller ends the connection instead.
   */
  signOut(): Promise<boolean>;
  me(): Promise<AgentIdentity>;
}

/**
 * What proves who an agent is. A tagged union so a backend can take a kind of credential other than
 * a password without the shell's sign-in path changing shape — today every backend takes one.
 */
export type AgentCredentials = { kind: 'password'; password: string };
