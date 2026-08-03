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
  /** Backend-local id (AD4M: the perspective uuid). Stable within this backend. */
  id: string;
  name: string;
  /** Global shared URI once published/joined (AD4M: `neighbourhood://<cid>`). Absent when local. */
  sharedUri?: string;
  /**
   * The scheme-less global id (AD4M: the neighbourhood CID) — what shared records store and
   * compare. Minted by the adapter alongside `sharedUri` so no consumer ever parses a URI.
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
  /** Publish an existing local dataset for sharing. Returns its shared URI and scheme-less id. */
  publish?(id: string): Promise<{ uri: string; sharedId: string }>;
  /**
   * Join a shared dataset. Accepts the backend's full URI or a bare shared id — normalization is
   * the adapter's dialect, not the caller's.
   */
  join?(idOrUri: string): Promise<DatasetRef>;
  /** Other agents holding a shared dataset (member roster), by dataset id. */
  members?(id: string): Promise<string[]>;
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
 * The agent session — whether the backend's identity is present and usable, and the unlock/lock
 * operations around it. Connection *establishment* stays with the host-supplied connector (it is
 * platform-specific); this port is what the shell needs once a connection exists.
 */
export interface AgentSessionPort {
  status(): Promise<AgentSessionStatus>;
  unlock(password: string): Promise<void>;
  lock(password: string): Promise<void>;
  me(): Promise<AgentIdentity>;
}
