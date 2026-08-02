import type { Ad4mClient } from '@coasys/ad4m';

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
export interface BackendConnector {
  /** Build and return a configured client. Called once during boot. */
  connect(): Promise<Ad4mClient>;

  /**
   * Optional: the raw connection details, for hosts that must hand them to something other than the
   * client. Absent on connectors with nothing to forward.
   */
  connectionDetails?(): Promise<BackendConnectionDetails>;
}
