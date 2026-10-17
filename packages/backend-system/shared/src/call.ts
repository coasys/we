/**
 * Calls, as a backend capability: building a session for one call, and the space's call policy.
 *
 * The call module already speaks to a session structurally — `CallBackend` in `@we/module-call` —
 * and never names a backend. What was missing was the host's half: the app reached its backend's
 * call API by importing it by name, where every other capability arrives here, on `BackendPorts`,
 * and is read late. This is that half.
 *
 * ## Every operation names its dataset
 *
 * A call is in one space, and that is not always the space on screen: a call outlives navigation,
 * and somebody following a topology switch from another space has to reconnect into the call's own.
 * So the port never reads "the current space". The host decides which dataset a call is in, and
 * refuses rather than guessing when it does not hold it.
 *
 * ## What it returns is the backend's
 *
 * `createSession` answers with the backend's own session object, which the call module checks
 * against its `CallBackend` shape. Typed `unknown` here because that shape belongs to the module,
 * and the contract must not depend on a module. The policy is `unknown` for the same reason: the
 * call module parses it.
 */
import type { DatasetHandle } from './dataSource';

/** What a call asks of a session beyond its id. */
export interface CallSessionOptions {
  /** The ICE servers the call module chose for this call. */
  iceServers?: RTCIceServer[];
  /**
   * The topology a running call is on, which wins over the space's policy — a joiner adopting the
   * call's, or everyone following a switch. Absent, the backend starts on what the policy says.
   */
  topology?: 'mesh' | 'sfu';
}

export interface CallPort {
  /** Build a session for one call in one dataset. Rejects when the dataset cannot hold a call. */
  createSession(dataset: DatasetHandle, callId: string, options?: CallSessionOptions): Promise<unknown>;
  /**
   * The dataset's call policy, as its creator stored it. A backend that cannot read one answers its
   * defaults rather than failing, so a call can still start.
   */
  config(dataset: DatasetHandle): Promise<unknown>;
  /** Store the dataset's call policy. Resolves false when the backend refuses the write. */
  setConfig(dataset: DatasetHandle, config: unknown): Promise<boolean>;
  /** Whether the dataset has a call policy to configure at all — a personal space has none. */
  configurable(dataset: DatasetHandle): boolean;
}
