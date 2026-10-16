/**
 * Call config adapter — unit tests.
 *
 * Verifies that the adapter correctly:
 * - Probes for SFU capability on the neighbourhood proxy
 * - Reads config via `sfuConfig(neighbourhoodUrl)`
 * - Writes config via `setSfuConfig(neighbourhoodUrl, config)`
 * - Falls back to defaults when the read fails
 * - Reports unsupported where there is no shared space to configure
 */
import { describe, expect, it, vi } from 'vitest';

import { type CallConfig, createCallConfigAccessors, DEFAULT_CALL_CONFIG } from './callConfigAdapter';

/** Build a mock dataset that looks like a shared PerspectiveProxy with SFU support. */
function mockDataset(overrides?: { sharedUrl?: string; sfuConfig?: CallConfig; setSfuResult?: boolean }) {
  const {
    sharedUrl = 'neighbourhood://test-space',
    sfuConfig = { ...DEFAULT_CALL_CONFIG },
    setSfuResult = true,
  } = overrides ?? {};

  const nhProxy: Record<string, unknown> = {
    sfuConfig: vi.fn().mockResolvedValue(sfuConfig),
    setSfuConfig: vi.fn().mockResolvedValue(setSfuResult),
  };

  return {
    sharedUrl,
    getNeighbourhoodProxy: () => nhProxy,
    /** Direct access to the mock for assertions. */
    _nhProxy: nhProxy,
  };
}

describe('callConfigSupported', () => {
  it('returns true for a shared space', () => {
    const ds = mockDataset();
    const { callConfigSupported } = createCallConfigAccessors(() => ds as never);
    expect(callConfigSupported()).toBe(true);
  });

  it('returns false when no dataset exists', () => {
    const { callConfigSupported } = createCallConfigAccessors(() => null);
    expect(callConfigSupported()).toBe(false);
  });

  it('returns false for a personal space (no sharedUrl)', () => {
    const ds = mockDataset({ sharedUrl: '' });
    const { callConfigSupported } = createCallConfigAccessors(() => ds as never);
    expect(callConfigSupported()).toBe(false);
  });
});

describe('getCallConfig', () => {
  it('reads config from the neighbourhood proxy', async () => {
    // The policy plus the executor's own node settings, which a read reports.
    const config: CallConfig = {
      mode: 'designated',
      fallback: 'mesh',
      maxMeshParticipants: 4,
      sfuPeers: ['did:key:z6MkPeer'],
      maxParticipantsPerNode: 20,
    };
    const ds = mockDataset({ sfuConfig: config });
    const { getCallConfig } = createCallConfigAccessors(() => ds as never);

    const result = await getCallConfig();

    expect(result).toEqual(config);
    expect(ds._nhProxy.sfuConfig).toHaveBeenCalledWith('neighbourhood://test-space');
  });

  it('returns defaults when the read fails', async () => {
    const ds = mockDataset();
    (ds._nhProxy.sfuConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RPC failed'));
    const { getCallConfig } = createCallConfigAccessors(() => ds as never);

    const result = await getCallConfig();

    expect(result).toEqual(DEFAULT_CALL_CONFIG);
  });

  it('throws when no dataset exists', async () => {
    const { getCallConfig } = createCallConfigAccessors(() => null);
    await expect(getCallConfig()).rejects.toThrow('no active dataset');
  });
});

describe('setCallConfig', () => {
  it('writes config through the neighbourhood proxy', async () => {
    const ds = mockDataset();
    const { setCallConfig } = createCallConfigAccessors(() => ds as never);

    const config: CallConfig = {
      mode: 'gateway',
      fallback: 'mesh',
      maxMeshParticipants: 10,
    };

    const ok = await setCallConfig(config);

    expect(ok).toBe(true);
    expect(ds._nhProxy.setSfuConfig).toHaveBeenCalledWith('neighbourhood://test-space', config);
  });

  it('returns false when the proxy rejects the write', async () => {
    const ds = mockDataset({ setSfuResult: false });
    const { setCallConfig } = createCallConfigAccessors(() => ds as never);

    const ok = await setCallConfig({ ...DEFAULT_CALL_CONFIG });

    expect(ok).toBe(false);
  });
});
