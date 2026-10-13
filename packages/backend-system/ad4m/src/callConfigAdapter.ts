/**
 * Call configuration adapter — reads and writes SFU config through the
 * AD4M `NeighbourhoodProxy` API.
 *
 * The neighbourhood stores the call policy (mode and mesh limit) as a link,
 * not a WE module setting: every member's executor reads the same policy, and
 * only the neighbourhood's creator may write it. A read also reports the
 * executor's own node settings, which a write must not send back. This adapter provides the read/write
 * path that the call module and Space Settings UI use to manage topology
 * defaults.
 */
import type { IceServer, NeighbourhoodProxy, PerspectiveProxy, SfuConfig, SfuMode } from '@coasys/ad4m';
import type { DatasetHandle } from '@we/backend-shared';

// ── Types ───────────────────────────────────────────────────────────────
//
// The SDK's own, under the names the rest of WE reads. Aliases rather than copies: a field the
// SDK adds, renames or narrows is a type error here instead of a silent mismatch at runtime.

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

// ── Adapter factory ─────────────────────────────────────────────────────

/**
 * Build accessor functions that read and write the call configuration for
 * the current neighbourhood.
 *
 * Every argument follows the late-binding pattern: a **getter** read at call
 * time, safe to construct before the backend connects.
 *
 * @param getCurrentDataset  Reactive accessor for the current dataset (perspective).
 */
export function createCallConfigAccessors(getCurrentDataset: () => DatasetHandle | null): {
  getCallConfig: () => Promise<CallConfig>;
  setCallConfig: (config: unknown) => Promise<boolean>;
  callConfigSupported: () => boolean;
} {
  /** Resolve the neighbourhood proxy of the current shared space. */
  function resolveProxy(): { nhProxy: NeighbourhoodProxy; neighbourhoodUrl: string } {
    const dataset = getCurrentDataset();
    if (!dataset) throw new Error('Cannot access call config — no active dataset');

    const proxy = dataset as PerspectiveProxy;
    const neighbourhoodUrl = proxy.sharedUrl ?? '';
    if (!neighbourhoodUrl) throw new Error('Cannot access call config — not a shared space');

    return { nhProxy: proxy.getNeighbourhoodProxy(), neighbourhoodUrl };
  }

  return {
    async getCallConfig(): Promise<CallConfig> {
      const { nhProxy, neighbourhoodUrl } = resolveProxy();
      try {
        return await nhProxy.sfuConfig(neighbourhoodUrl);
      } catch (error) {
        console.warn('call config: could not read SFU config, using defaults', error);
        return { ...DEFAULT_CALL_CONFIG };
      }
    },

    async setCallConfig(config: unknown): Promise<boolean> {
      const { nhProxy, neighbourhoodUrl } = resolveProxy();
      return await nhProxy.setSfuConfig(neighbourhoodUrl, config as CallConfig);
    },

    /**
     * Synchronous probe — is there a shared space to configure? Whether its executor can store the
     * config is only known by asking, which getCallConfig does, falling back to the defaults.
     */
    callConfigSupported(): boolean {
      try {
        resolveProxy();
        return true;
      } catch {
        return false;
      }
    },
  };
}
