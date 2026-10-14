/**
 * Call session factory adapter — bridges the AD4M `NeighbourhoodProxy.createSession` API to the
 * call module's `createBackend` dependency.
 *
 * The call module declares a `CallBackend` structural interface (topology-agnostic, no AD4M
 * imports). AD4M's `Session` satisfies it structurally. This adapter provides a factory function
 * the host wires into the call module's `CallStoreDeps.createBackend` — so the module stays
 * backend-agnostic and the host does the AD4M-specific construction.
 */
import type { IceServer, PerspectiveProxy, Session, SessionTopology, SfuConfig } from '@coasys/ad4m';
import type { DatasetHandle } from '@we/backend-shared';

import { type CallConfigMode, toCallConfig } from './callConfigAdapter';

/**
 * The topology a session is asked for, from the mode the space's creator chose.
 *
 * `mesh` means "never use an SFU" and is passed as it is. `sfu` and `auto` are both passed as
 * `auto` together with the config itself: the session's auto resolution follows the config's mode,
 * so `sfu` uses this executor's SFU and `auto` applies the SDK's rule (the SFU only when every
 * member is hosted here and the SFU is public). A space whose config could not be read is `auto`
 * with no config, which the SDK resolves by the same rule.
 */
function topologyFor(mode: CallConfigMode | undefined): SessionTopology {
  return mode === 'mesh' ? 'mesh' : 'auto';
}

/** The browser's ICE server shape, whose `urls` may be one string, as the SDK's, which is always a list. */
function toIceServer(server: RTCIceServer): IceServer {
  return {
    urls: Array.isArray(server.urls) ? server.urls : [server.urls],
    ...(server.username ? { username: server.username } : {}),
    ...(typeof server.credential === 'string' && server.credential ? { credential: server.credential } : {}),
  };
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
): (callId: string, options?: { iceServers?: RTCIceServer[] }) => Promise<Session> {
  return async (callId: string, options?: { iceServers?: RTCIceServer[] }) => {
    const dataset = getCurrentDataset();
    if (!dataset) throw new Error('Cannot create call session — no active dataset');

    const proxy = dataset as PerspectiveProxy;
    const neighbourhoodUrl = proxy.sharedUrl ?? '';
    const nhProxy = proxy.getNeighbourhoodProxy();

    // An executor that predates the SFU answers with an error here; auto resolution is right then.
    // With a config, the session's auto resolution follows its mode. A mode an older executor
    // stored (`designated`, `gateway`, `cascaded`) is handed on as `sfu`, which is what each meant.
    let sfuConfig: SfuConfig | undefined;
    let mode: CallConfigMode | undefined;
    try {
      const config = toCallConfig(await nhProxy.sfuConfig(neighbourhoodUrl));
      mode = config.mode;
      // Through `unknown`: WE's mode union and the SDK's need not be the same shape.
      sfuConfig = config as unknown as SfuConfig;
    } catch {
      // Non-fatal — fall back to auto topology resolution.
    }

    return await nhProxy.createSession(callId, {
      neighbourhoodUrl,
      topology: topologyFor(mode),
      ...(sfuConfig ? { sfuConfig } : {}),
      ...(options?.iceServers?.length ? { iceServers: options.iceServers.map(toIceServer) } : {}),
    });
  };
}
