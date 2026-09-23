/**
 * Call session factory adapter — bridges the AD4M `NeighbourhoodProxy.createSession` API to the
 * call module's `createBackend` dependency.
 *
 * The call module declares a `CallBackend` structural interface (topology-agnostic, no AD4M
 * imports). AD4M's `Session` satisfies it structurally. This adapter provides a factory function
 * the host wires into the call module's `CallStoreDeps.createBackend` — so the module stays
 * backend-agnostic and the host does the AD4M-specific construction.
 *
 * COMPATIBILITY: this adapter compiles against the **published** `@coasys/ad4m`, which does not
 * yet export `Session` or `createSession`. Runtime capability gating ensures the adapter throws a
 * clear error when paired with an executor that lacks SFU support, rather than a cryptic type
 * mismatch. Once `@coasys/ad4m` publishes the SFU types, the local interfaces below can be
 * replaced with direct imports.
 */
import type { PerspectiveProxy } from '@coasys/ad4m';
import type { DatasetHandle } from '@we/backend-shared';

/**
 * Runtime capability interface — matches `NeighbourhoodProxy.createSession` added in the AD4M
 * `feat/embedded-sfu` branch. Defined locally so the adapter compiles against the published
 * `@coasys/ad4m` while working at runtime with an SFU-enabled executor.
 */
interface SessionCapableProxy {
  createSession(roomName: string, options?: { neighbourhoodUrl?: string; topology?: string }): Promise<unknown>;
  sfuConfig?(neighbourhoodUrl: string): Promise<{ mode?: string }>;
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
 * 3. Checks for `createSession` support at runtime
 * 4. Calls `createSession(callId)` to get a Session with auto topology resolution
 *
 * The Session handles mesh ↔ SFU topology switching, SDP negotiation, SFU cascade failover,
 * simulcast quality preferences, and data channel relay internally.
 *
 * @param _getBackendClient  Reactive accessor for the `Ad4mClient` — reserved for future use.
 * @param getCurrentDataset  Reactive accessor for the current dataset (perspective).
 * @param _getSelfId  Reactive accessor for the current agent DID — reserved for future use.
 */
export function createCallSessionFactory(
  _getBackendClient: () => unknown,
  getCurrentDataset: () => DatasetHandle | null,
  _getSelfId: () => string | null,
): (callId: string) => Promise<unknown> {
  return async (callId: string) => {
    const dataset = getCurrentDataset();
    if (!dataset) throw new Error('Cannot create call session — no active dataset');

    const proxy = dataset as PerspectiveProxy;
    const neighbourhoodUrl = proxy.sharedUrl ?? '';

    // Retrieve the proxy through PerspectiveProxy rather than constructing directly — avoids
    // constructor signature differences between published and SFU-enabled @coasys/ad4m builds.
    const nhProxy = proxy.getNeighbourhoodProxy();

    if (!nhProxy || !('createSession' in nhProxy)) {
      throw new Error('AD4M executor does not support Session — requires a build from feat/embedded-sfu');
    }

    const capable = nhProxy as unknown as SessionCapableProxy;

    // Read the moderator's topology choice from Social DNA.  Falls back to 'auto'
    // when the config has not been set or the executor lacks support.
    let topology = 'auto';
    if (capable.sfuConfig) {
      try {
        const config = await capable.sfuConfig(neighbourhoodUrl);
        if (config?.mode && config.mode !== 'mesh') {
          topology = config.mode;
        }
        // 'mesh' in the config means "never use SFU" — pass 'mesh' explicitly
        // so the Session resolver skips SFU discovery.
        if (config?.mode === 'mesh') topology = 'mesh';
      } catch {
        // Non-fatal — fall back to auto topology resolution.
      }
    }

    return await capable.createSession(callId, {
      neighbourhoodUrl,
      topology,
    });
  };
}
