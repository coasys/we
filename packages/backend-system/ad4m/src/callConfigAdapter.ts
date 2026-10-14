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
import type { IceServer, NeighbourhoodProxy, PerspectiveProxy, SfuConfig } from '@coasys/ad4m';
import type { DatasetHandle } from '@we/backend-shared';

// ── Types ───────────────────────────────────────────────────────────────
//
// The SDK's own, under the names the rest of WE reads — except the mode, which is WE's own. The
// SDK's mode union has changed shape (four modes, then three), and executors still hold the old
// values; owning the union here and mapping at this boundary means the rest of WE only ever sees
// the three below, whichever SDK it is built against and whatever an older executor stored.

/**
 * How a space's calls connect: `mesh` peer to peer, `sfu` through this executor's SFU, `auto` the
 * SFU when every member is hosted on this executor and its SFU can be reached, mesh otherwise.
 */
export type CallConfigMode = 'mesh' | 'sfu' | 'auto';

export type CallConfigIceServer = IceServer;

/**
 * Per-neighbourhood call configuration, stored as a link in the neighbourhood. A read also carries
 * the executor's own node settings, which the SDK's type describes. `fallback` is left out: it is
 * not stored and nothing reads it.
 */
export type CallConfig = Omit<SfuConfig, 'mode' | 'fallback'> & { mode: CallConfigMode };

/** The configuration a space has until its creator stores one — what the executor reports then too. */
export const DEFAULT_CALL_CONFIG: CallConfig = {
  mode: 'auto',
  maxMeshParticipants: 6,
};

/**
 * A mode as an executor answered it, as one of the three. Older executors stored three SFU modes —
 * `designated`, `gateway`, `cascaded` — which all ran the call on the caller's own executor's SFU,
 * and a current executor reads them as `sfu`; so does this, for an executor that still reports
 * them. Anything else, absent included, is the default.
 */
export function toCallConfigMode(raw: unknown): CallConfigMode {
  if (raw === 'mesh' || raw === 'sfu' || raw === 'auto') return raw;
  if (raw === 'designated' || raw === 'gateway' || raw === 'cascaded') return 'sfu';
  return DEFAULT_CALL_CONFIG.mode;
}

/** An SDK config, with its mode mapped to one of WE's three. */
export function toCallConfig(config: SfuConfig): CallConfig {
  const { fallback: _fallback, ...rest } = config as SfuConfig & { fallback?: unknown };
  return { ...rest, mode: toCallConfigMode((config as { mode?: unknown }).mode) } as CallConfig;
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
        return toCallConfig(await nhProxy.sfuConfig(neighbourhoodUrl));
      } catch (error) {
        console.warn('call config: could not read SFU config, using defaults', error);
        return { ...DEFAULT_CALL_CONFIG };
      }
    },

    async setCallConfig(config: unknown): Promise<boolean> {
      const { nhProxy, neighbourhoodUrl } = resolveProxy();
      // Through `unknown`: WE's mode union and the SDK's need not be the same shape (see above).
      return await nhProxy.setSfuConfig(neighbourhoodUrl, config as unknown as SfuConfig);
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
