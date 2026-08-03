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
