import type { BackendPorts, BackendPortsContext } from '@we/backend-shared';

/**
 * Raw connection details for the running executor, for callers that need to reach it directly
 * rather than through the client — currently the embedded-app handshake, which forwards them into
 * an iframe so a hosted app can attach to the same agent.
 */
export interface BackendConnectionDetails {
  port: number;
  token: string;
  url?: string;
}

/**
 * How a host obtains a data-layer client.
 *
 * Split out of {@link PlatformAdapter}, which had grown to answer two unrelated questions: *where am
 * I running* (web / electron / tauri, dev or not, how to resolve an embedded app's URL) and *how do
 * I reach the data layer*. Those vary independently — the same web host reaches the executor through
 * a different mechanism than electron does, while resolving app URLs identically to neither — so
 * fusing them meant every host implemented one interface for two reasons and the platform contract
 * named a client type it has no business knowing about.
 *
 * The practical symptom: `platform/types.ts` imported `@coasys/ad4m` purely for a return type, so
 * every host that wanted `isDesktop` also named the data layer.
 */
/** Everything `initialize()` hands the shell — the connected client, the port bundle over it,
 * and (when the backend has something to forward) the raw connection details the embed bridge
 * relays to hosted apps. */
export interface BackendInitResult {
  client: unknown;
  ports: BackendPorts;
  connection?: BackendConnectionDetails;
  /**
   * End this app's connection to the backend, for backends where the session *is* the connection.
   *
   * Supplied by the connector rather than sitting on a port, because it is the connector that knows
   * how the connection was obtained and holds whatever has to be forgotten — a stored token, a
   * chosen host. The ports only ever see a connected client.
   *
   * Optional, and absent on the desktop hosts: they start the executor themselves, so ending a
   * session there means locking the agent or restarting the backend, both of which the shell can
   * already reach. It matters on web, where the agent may live on someone else's node and was never
   * unlocked with a password this app holds — leaving "log out" with nothing to do but show a
   * sign-in form for a lock that is not there.
   */
  disconnect?: () => Promise<void>;
}

export interface BackendConnector {
  /**
   * Perform this backend's entire connection choreography — spawn/attach, auth, credential
   * acquisition, any settling delays — and return the ready-to-use result. Called once during
   * boot. The shell holds no opinions about how a backend comes up; ordering quirks (an executor
   * that needs a moment to start, credentials that only exist after an auth UI) live with the
   * connector that owns them.
   */
  initialize(ctx: BackendPortsContext): Promise<BackendInitResult>;
}
