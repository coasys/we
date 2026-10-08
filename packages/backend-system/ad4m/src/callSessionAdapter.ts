/**
 * Call session factory adapter — bridges the AD4M `NeighbourhoodProxy.createSession` API to the
 * call module's `createBackend` dependency.
 *
 * The call module declares a `CallBackend` structural interface (topology-agnostic, no AD4M
 * imports). AD4M's `Session` satisfies it structurally. This adapter provides a factory function
 * the host wires into the call module's `CallStoreDeps.createBackend` — so the module stays
 * backend-agnostic and the host does the AD4M-specific construction.
 */
import type { PerspectiveProxy, Session, SessionTopology, SfuMode } from '@coasys/ad4m';
import type { DatasetHandle } from '@we/backend-shared';

/**
 * The topology a session is asked for, from the mode the space's moderator chose.
 *
 * The session takes `mesh`, `sfu` or `auto`; the space's config has four modes. `mesh` means
 * "never use an SFU" and is passed as it is. The three SFU modes are passed as `auto`, which is
 * what the session already made of them: anything but `mesh` or `sfu` falls through to its
 * auto-discovery. Whether a space set to `designated` should instead insist on an SFU is a change
 * of behaviour, not of types, so it is not made here.
 */
function topologyFor(mode: SfuMode | undefined): SessionTopology {
  return mode === 'mesh' ? 'mesh' : 'auto';
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
): (callId: string) => Promise<Session> {
  return async (callId: string) => {
    const dataset = getCurrentDataset();
    if (!dataset) throw new Error('Cannot create call session — no active dataset');

    const proxy = dataset as PerspectiveProxy;
    const neighbourhoodUrl = proxy.sharedUrl ?? '';
    const nhProxy = proxy.getNeighbourhoodProxy();

    // An executor that predates the SFU, or a space with no config, answers with an error here;
    // auto resolution is right for both.
    let topology: SessionTopology = 'auto';
    try {
      topology = topologyFor((await nhProxy.sfuConfig(neighbourhoodUrl))?.mode);
    } catch {
      // Non-fatal — fall back to auto topology resolution.
    }

    return await nhProxy.createSession(callId, { neighbourhoodUrl, topology });
  };
}
