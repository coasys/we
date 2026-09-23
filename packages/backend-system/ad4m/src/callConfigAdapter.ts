/**
 * Call configuration adapter — reads and writes SFU config through the
 * AD4M `NeighbourhoodProxy` API.
 *
 * The SFU configuration lives on the neighbourhood's Social DNA, not on the
 * WE module settings system.  This adapter provides the read/write path that
 * the call module and Space Settings UI use to manage topology defaults.
 *
 * COMPATIBILITY: compiles against the **published** `@coasys/ad4m`, which does
 * not export SFU types yet.  Runtime capability gating ensures clear errors
 * when paired with an executor that lacks SFU support.  Once `@coasys/ad4m`
 * publishes the SFU types, the local interfaces below can become direct imports.
 */
import type { PerspectiveProxy } from '@coasys/ad4m';
import type { DatasetHandle } from '@we/backend-shared';

// ── Local type mirrors ──────────────────────────────────────────────────
//
// Mirrors of `SfuTypes.ts` from `@coasys/ad4m` feat/embedded-sfu.
// Kept minimal — only the fields the settings UI reads and writes.

export type CallConfigMode = 'mesh' | 'designated' | 'gateway' | 'cascaded';

export interface CallConfigIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * Per-neighbourhood call configuration.  Field-for-field mirror of `SfuConfig`
 * in `@coasys/ad4m/neighbourhood/SfuTypes`.
 */
export interface CallConfig {
  mode: CallConfigMode;
  designatedPeer?: string;
  fallback: CallConfigMode;
  maxMeshParticipants: number;
  sfuPeers: string[];
  maxParticipantsPerNode?: number;
  preferredSfuDid?: string;
  iceServers?: CallConfigIceServer[];
}

/** An SFU-capable executor discovered via presence in the neighbourhood. */
export interface CallSfuNode {
  did: string;
  bindAddress: string;
}

/** Default configuration — pure mesh, no SFU. */
export const DEFAULT_CALL_CONFIG: CallConfig = {
  mode: 'mesh',
  fallback: 'mesh',
  maxMeshParticipants: 6,
  sfuPeers: [],
};

// ── Runtime capability interfaces ───────────────────────────────────────

interface ConfigCapableProxy {
  sfuConfig(neighbourhoodUrl: string): Promise<CallConfig>;
  setSfuConfig(neighbourhoodUrl: string, config: CallConfig): Promise<boolean>;
  availableSfuNodes(): Promise<CallSfuNode[]>;
}

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
  getAvailableSfuNodes: () => Promise<CallSfuNode[]>;
  callConfigSupported: () => boolean;
} {
  /** Resolve the neighbourhood proxy and verify SFU capability. */
  function resolveProxy(): { nhProxy: ConfigCapableProxy; neighbourhoodUrl: string } {
    const dataset = getCurrentDataset();
    if (!dataset) throw new Error('Cannot access call config — no active dataset');

    const proxy = dataset as PerspectiveProxy;
    const neighbourhoodUrl = proxy.sharedUrl ?? '';
    if (!neighbourhoodUrl) throw new Error('Cannot access call config — not a shared space');

    const nhProxy = proxy.getNeighbourhoodProxy();
    if (!nhProxy || !('sfuConfig' in nhProxy)) {
      throw new Error('AD4M executor does not support call configuration — requires a build from feat/embedded-sfu');
    }

    return { nhProxy: nhProxy as unknown as ConfigCapableProxy, neighbourhoodUrl };
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

    async getAvailableSfuNodes(): Promise<CallSfuNode[]> {
      const { nhProxy } = resolveProxy();
      try {
        return await nhProxy.availableSfuNodes();
      } catch {
        return [];
      }
    },

    /** Synchronous probe — does the current dataset support call config at all? */
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
