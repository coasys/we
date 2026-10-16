/**
 * Call session factory adapter — bridges the AD4M `NeighbourhoodProxy.createSession` API to the
 * call module's `createBackend` dependency.
 *
 * The call module declares a `CallBackend` structural interface (topology-agnostic, no AD4M
 * imports). AD4M's `Session` satisfies it structurally. This adapter provides a factory function
 * the host wires into the call module's `CallStoreDeps.createBackend` — so the module stays
 * backend-agnostic and the host does the AD4M-specific construction.
 */
import type { IceServer, PerspectiveProxy, Session, SessionTopology, SfuConfig, SfuMode } from '@coasys/ad4m';
import type { DatasetHandle } from '@we/backend-shared';

/**
 * The topology a session is asked for, from the mode the space's creator chose.
 *
 * Always `mesh` or `sfu`, never the session's `auto`: a call runs on what was asked for and never
 * migrates on its own. The three SFU modes run through this executor's SFU; no config (an executor
 * without SFU support) is mesh.
 */
function topologyFor(mode: SfuMode | undefined): SessionTopology {
  return !mode || mode === 'mesh' ? 'mesh' : 'sfu';
}

/** The browser's ICE server shape, whose `urls` may be one string, as the SDK's, which is always a list. */
function toIceServer(server: RTCIceServer): IceServer {
  return {
    urls: Array.isArray(server.urls) ? server.urls : [server.urls],
    ...(server.username ? { username: server.username } : {}),
    ...(typeof server.credential === 'string' && server.credential ? { credential: server.credential } : {}),
  };
}

/** What the call module asks of a session: its ICE servers, and the topology a running call is on. */
export interface CallSessionOptions {
  iceServers?: RTCIceServer[];
  topology?: 'mesh' | 'sfu';
}

/**
 * Build a factory function that creates a `CallBackend` (Session) for a given call room.
 *
 * Every argument is a **getter**, read at call time rather than captured — so the factory is safe
 * to construct before the backend connects, and it follows navigation between spaces. This matches
 * the late-binding contract every other module host service uses.
 *
 * At call time it:
 * 1. Reads the current dataset (perspective)
 * 2. Gets the `NeighbourhoodProxy` from the `PerspectiveProxy`
 * 3. Reads the moderator's topology choice
 * 4. Calls `createSession(callId)` to get a Session
 *
 * The Session handles mesh ↔ SFU topology switching, SDP negotiation, reconnecting to this
 * executor after a failed connection, simulcast quality preferences, and data channel relay
 * internally.
 *
 * @param _getBackendClient  Reactive accessor for the `Ad4mClient` — reserved for future use.
 * @param getCurrentDataset  Reactive accessor for the current dataset (perspective).
 * @param _getSelfId  Reactive accessor for the current agent DID — reserved for future use.
 */
export function createCallSessionFactory(
  _getBackendClient: () => unknown,
  getCurrentDataset: () => DatasetHandle | null,
  _getSelfId: () => string | null,
): (callId: string, options?: CallSessionOptions) => Promise<Session> {
  return async (callId: string, options?: CallSessionOptions) => {
    const dataset = getCurrentDataset();
    if (!dataset) throw new Error('Cannot create call session — no active dataset');

    const proxy = dataset as PerspectiveProxy;
    const neighbourhoodUrl = proxy.sharedUrl ?? '';
    const nhProxy = proxy.getNeighbourhoodProxy();

    // An executor that predates the SFU answers with an error here, and the call is a mesh.
    let sfuConfig: SfuConfig | undefined;
    try {
      sfuConfig = await nhProxy.sfuConfig(neighbourhoodUrl);
    } catch {
      // Non-fatal — no config means mesh.
    }

    return await nhProxy.createSession(callId, {
      neighbourhoodUrl,
      // A running call's own topology (a joiner's adoption, or a switch) wins over the space's.
      topology: options?.topology ?? topologyFor(sfuConfig?.mode),
      ...(sfuConfig ? { sfuConfig } : {}),
      ...(options?.iceServers?.length ? { iceServers: options.iceServers.map(toIceServer) } : {}),
    });
  };
}
