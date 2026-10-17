/**
 * The call port on AD4M — sessions through `NeighbourhoodProxy.createSession`, and the call policy a
 * neighbourhood stores as a link.
 *
 * The call module declares a `CallBackend` structural interface (topology-agnostic, no AD4M
 * imports). AD4M's `Session` satisfies it structurally, so `createSession` hands it over as it is.
 *
 * The policy (mode and mesh limit) is a link in the neighbourhood, not a WE module setting: every
 * member's executor reads the same policy, and only the neighbourhood's creator may write it. A read
 * also reports the executor's own node settings, which a write must not send back.
 */
import type { IceServer, PerspectiveProxy, SessionTopology, SfuConfig, SfuMode } from '@coasys/ad4m';
import type { CallPort, DatasetHandle } from '@we/backend-shared';

// The SDK's own types, under the names the rest of WE reads. Aliases rather than copies: a field
// the SDK adds, renames or narrows is a type error here instead of a silent mismatch at runtime.

export type CallConfigMode = SfuMode;

export type CallConfigIceServer = IceServer;

/** Per-neighbourhood call configuration, stored as a link in the neighbourhood. */
export type CallConfig = SfuConfig;

/** Default configuration — pure mesh, no SFU. */
export const DEFAULT_CALL_CONFIG: CallConfig = {
  mode: 'mesh',
  fallback: 'mesh',
  maxMeshParticipants: 6,
};

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

/** The neighbourhood a dataset is shared as. A personal space has none, and so no call policy. */
function neighbourhoodOf(dataset: DatasetHandle) {
  const proxy = dataset as PerspectiveProxy;
  return { nhProxy: proxy.getNeighbourhoodProxy(), neighbourhoodUrl: proxy.sharedUrl ?? '' };
}

function sharedNeighbourhoodOf(dataset: DatasetHandle) {
  const found = neighbourhoodOf(dataset);
  if (!found.neighbourhoodUrl) throw new Error('Cannot access call config — not a shared space');
  return found;
}

export function createAd4mCallPort(): CallPort {
  return {
    /**
     * The Session handles mesh ↔ SFU topology switching, SDP negotiation, reconnecting to this
     * executor after a failed connection, simulcast quality preferences, and data channel relay
     * internally.
     */
    async createSession(dataset, callId, options) {
      const { nhProxy, neighbourhoodUrl } = neighbourhoodOf(dataset);

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
    },

    async config(dataset) {
      const { nhProxy, neighbourhoodUrl } = sharedNeighbourhoodOf(dataset);
      try {
        return await nhProxy.sfuConfig(neighbourhoodUrl);
      } catch (error) {
        console.warn('call config: could not read SFU config, using defaults', error);
        return { ...DEFAULT_CALL_CONFIG };
      }
    },

    async setConfig(dataset, config) {
      const { nhProxy, neighbourhoodUrl } = sharedNeighbourhoodOf(dataset);
      return await nhProxy.setSfuConfig(neighbourhoodUrl, config as CallConfig);
    },

    /**
     * Whether there is a shared space to configure. Whether its executor can store the config is
     * only known by asking, which `config` does, falling back to the defaults.
     */
    configurable(dataset) {
      return Boolean((dataset as PerspectiveProxy).sharedUrl);
    },
  };
}
