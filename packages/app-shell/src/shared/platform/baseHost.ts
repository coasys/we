/**
 * The host before a session: what the app can do on this device while no backend is connected.
 *
 * WE used to boot by connecting first — `SessionStore` awaits the connector, and nothing renders until
 * it answers. A deployment that wants to ask something before that (who you are, where your data is)
 * had nowhere to ask it. The base host is that place: a {@link BaseHost} says what this device can
 * reach with no session at all, the base app (`BaseApp`, drawing a bundle's `base` template against
 * `baseStore`) asks the person, and the connection they choose is handed to WE's `App` in the same
 * page.
 *
 * Framework-neutral, and backend-neutral: a host implements it over whatever it has — the desktop's
 * custody service and executor, the phone's device key, the browser's AD4M Connect — and the store
 * above learns none of those names. Words, passphrases and keys never cross it: a step that needs one
 * opens the host's own identity window, and what comes back is how the step ended.
 */
import type { IdentityChange, IdentityChangeOutcome, IdentityCustodyView } from '@we/backend-shared';

import type { BackendConnector } from '../backend';

/**
 * A step of the host's identity window: one of WE's identity changes, or `join` — a device of no
 * identity yet joining one by the offer another device shows (the phone's page, `?join`).
 */
export type BaseIdentityStep = IdentityChange | { kind: 'join' };

/** One of the three ways in, as this host offers it: the step it opens, or why it has none. */
export type BaseDoor = { step: BaseIdentityStep } | { step: null; note: string };

/** The identity as this device keeps it, read with no session. */
export interface BaseIdentitySource {
  /**
   * The public facts: which identity this device's custody speaks for, whether it keeps a master key,
   * its devices. Rejects while the source cannot answer yet (a custody service still starting).
   */
  state(): Promise<IdentityCustodyView>;
  /**
   * "Make my identity here", "Link to my identity" and "Use my 12 words", as this host offers each.
   * Read again whenever the host's own backend ({@link BaseHost.executor}) changes, so a host's doors
   * may follow it: the desktop's stay closed until its executor's agent is unlocked.
   */
  readonly doors: { make: BaseDoor; link: BaseDoor; words: BaseDoor };
  /**
   * Opens the host's identity window on a step and resolves with how it ended. A host whose window is
   * a page of its own (the phone's) leaves this page, and the promise never settles.
   */
  open(step: BaseIdentityStep): Promise<IdentityChangeOutcome>;
  /** Whether the person already said "Not now" here in the host's own words (the phone's join page). */
  skipped?(): boolean;
}

/** Where a session can be had, as the connection choice lists it. */
export interface BaseConnection {
  /** Stable for this host: what the choice is remembered by. */
  id: string;
  /**
   * `this-device` — a backend this device runs itself. `server` — one the person added by its address.
   * `key-host` — the executor this device's key logs in to. `connect` — the host's own connect screen,
   * which asks where.
   */
  kind: 'this-device' | 'server' | 'key-host' | 'connect';
  label: string;
  detail: string;
}

/**
 * The backend this device runs, where it runs one: starting, up, or failed to start and why. Up, it may
 * say how its agent is: `unlocked`, or `locked` until the person signs in. Absent where the host does
 * not make the agent itself.
 */
export type BaseExecutorState =
  { phase: 'starting' } | { phase: 'ready'; agent?: 'unlocked' | 'locked' } | { phase: 'failed'; reason: string };

export interface BaseExecutor {
  state(): BaseExecutorState;
  /** Called on every change of state; returns the unsubscribe. */
  subscribe(listener: (state: BaseExecutorState) => void): () => void;
  /** Starts it again after a failure. Resolves once the attempt is under way; the state says how it went. */
  start(): Promise<void>;
}

/** How a connection came to be handed off. */
export interface BaseHandOff {
  /** The person picked it from the list just now; absent for a resume, "Try again" or coming online. */
  chosen?: boolean;
}

export interface BaseHost {
  /** What this device is, for the sentences about it. */
  kind: 'computer' | 'phone' | 'browser';
  /** The identity this device keeps without a session; absent where it keeps none (a browser). */
  identity?: BaseIdentitySource;
  /** The backend this device runs itself; absent where it runs none. */
  executor?: BaseExecutor;
  /** The places a session can be had from here. */
  connections(): Promise<BaseConnection[]>;
  /**
   * The connector for one of them, handed to WE's `App` once it is chosen. `chosen` when the person
   * picked it from the list just now, rather than the app resuming the remembered one or trying it
   * again: a host that checks a remembered place before resuming it skips that check for a choice.
   */
  connector(connection: BaseConnection, how?: BaseHandOff): Promise<BackendConnector>;
  /**
   * Whether a connector's failure means the place could not be reached — the device offline, the
   * server down — rather than a refusal. Such a failure comes back to the base app's offline state,
   * with a way to try again, instead of ending on the session's error screen.
   */
  isUnreachable?(error: unknown): boolean;
  /** Whether the device has a network at all; absent means it is not known, and assumed. */
  online?(): boolean;
}
