/**
 * Call config adapter — unit tests.
 *
 * Verifies that the adapter correctly:
 * - Probes for SFU capability on the neighbourhood proxy
 * - Reads config via `sfuConfig(neighbourhoodUrl)`
 * - Writes config via `setSfuConfig(neighbourhoodUrl, config)`
 * - Discovers SFU nodes via `availableSfuNodes()`
 * - Falls back to defaults when the read fails
 * - Reports unsupported when the proxy lacks the capability
 */
import { describe, expect, it, vi } from 'vitest';

import { type CallConfig, type CallSfuNode, createCallConfigAccessors, DEFAULT_CALL_CONFIG } from './callConfigAdapter';

/** Build a mock dataset that looks like a shared PerspectiveProxy with SFU support. */
function mockDataset(overrides?: {
  sharedUrl?: string;
  sfuConfig?: CallConfig;
  setSfuResult?: boolean;
  sfuNodes?: CallSfuNode[];
  hasSfuSupport?: boolean;
}) {
  const {
    sharedUrl = 'neighbourhood://test-space',
    sfuConfig = { ...DEFAULT_CALL_CONFIG },
    setSfuResult = true,
    sfuNodes = [],
    hasSfuSupport = true,
  } = overrides ?? {};

  const nhProxy: Record<string, unknown> = {};
  if (hasSfuSupport) {
    nhProxy.sfuConfig = vi.fn().mockResolvedValue(sfuConfig);
    nhProxy.setSfuConfig = vi.fn().mockResolvedValue(setSfuResult);
    nhProxy.availableSfuNodes = vi.fn().mockResolvedValue(sfuNodes);
  }

  return {
    sharedUrl,
    getNeighbourhoodProxy: () => nhProxy,
    /** Direct access to the mock for assertions. */
    _nhProxy: nhProxy,
  };
}

describe('callConfigSupported', () => {
  it('returns true when the proxy has sfuConfig', () => {
    const ds = mockDataset();
    const { callConfigSupported } = createCallConfigAccessors(() => ds as never);
    expect(callConfigSupported()).toBe(true);
  });

  it('returns false when no dataset exists', () => {
    const { callConfigSupported } = createCallConfigAccessors(() => null);
    expect(callConfigSupported()).toBe(false);
  });

  it('returns false when the proxy lacks SFU support', () => {
    const ds = mockDataset({ hasSfuSupport: false });
    const { callConfigSupported } = createCallConfigAccessors(() => ds as never);
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
    const config: CallConfig = {
      mode: 'designated',
      designatedPeer: 'did:key:z6MkSFU',
      fallback: 'mesh',
      maxMeshParticipants: 4,
      sfuPeers: [],
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
      fallback: 'designated',
      maxMeshParticipants: 10,
      sfuPeers: ['did:key:z6MkA'],
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

describe('getAvailableSfuNodes', () => {
  it('returns nodes from the proxy', async () => {
    const nodes: CallSfuNode[] = [
      { did: 'did:key:z6MkA', bindAddress: '10.0.0.1:8443' },
      { did: 'did:key:z6MkB', bindAddress: '10.0.0.2:8443' },
    ];
    const ds = mockDataset({ sfuNodes: nodes });
    const { getAvailableSfuNodes } = createCallConfigAccessors(() => ds as never);

    const result = await getAvailableSfuNodes();

    expect(result).toEqual(nodes);
  });

  it('returns an empty array when the scan fails', async () => {
    const ds = mockDataset();
    (ds._nhProxy.availableSfuNodes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('scan failed'));
    const { getAvailableSfuNodes } = createCallConfigAccessors(() => ds as never);

    const result = await getAvailableSfuNodes();

    expect(result).toEqual([]);
  });
});
