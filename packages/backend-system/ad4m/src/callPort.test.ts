/**
 * The call port on AD4M — unit tests.
 *
 * Sessions:
 * - Reads the space's SFU config before creating a session
 * - Passes 'mesh' when the config says mesh, and an SFU mode as 'sfu' — never 'auto'
 * - Falls back to 'mesh' when the config read fails
 * - Lets a running call's topology override the space's
 *
 * Policy:
 * - Reads config via `sfuConfig(neighbourhoodUrl)`, and falls back to defaults when that fails
 * - Writes config via `setSfuConfig(neighbourhoodUrl, config)`
 * - Reports nothing to configure where there is no shared space
 *
 * Which dataset a call is in is the host's decision, tested beside it in `@we/app-shell`.
 */
import { describe, expect, it, vi } from 'vitest';

import { type CallConfig, createAd4mCallPort, DEFAULT_CALL_CONFIG } from './callPort';

/** Build a mock dataset that looks like a shared PerspectiveProxy. */
function mockDataset(overrides?: { sharedUrl?: string; sfuConfig?: CallConfig; setSfuResult?: boolean }) {
  const {
    sharedUrl = 'neighbourhood://test-space',
    sfuConfig = { ...DEFAULT_CALL_CONFIG },
    setSfuResult = true,
  } = overrides ?? {};

  const session = { join: vi.fn(), leave: vi.fn(), destroy: vi.fn() };
  const nhProxy: Record<string, ReturnType<typeof vi.fn>> = {
    createSession: vi.fn().mockResolvedValue(session),
    sfuConfig: vi.fn().mockResolvedValue(sfuConfig),
    setSfuConfig: vi.fn().mockResolvedValue(setSfuResult),
  };

  return {
    sharedUrl,
    getNeighbourhoodProxy: () => nhProxy,
    /** Direct access to the mocks for assertions. */
    _nhProxy: nhProxy,
    _session: session,
  };
}

const mode = (m: CallConfig['mode']): CallConfig => ({ ...DEFAULT_CALL_CONFIG, mode: m });

describe('createSession', () => {
  /*
    The session takes mesh, sfu or auto. Only mesh and sfu are asked for: a call runs on what was
    chosen and never migrates on its own.
  */
  it('reads config and passes an SFU mode as sfu, with the config', async () => {
    const ds = mockDataset({ sfuConfig: mode('designated') });

    const session = await createAd4mCallPort().createSession(ds as never, 'test-call-123');

    expect(session).toBe(ds._session);
    expect(ds._nhProxy.sfuConfig).toHaveBeenCalledWith('neighbourhood://test-space');
    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('test-call-123', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'sfu',
      sfuConfig: mode('designated'),
    });
  });

  it('passes mesh explicitly when config mode says mesh', async () => {
    const ds = mockDataset({ sfuConfig: mode('mesh') });

    await createAd4mCallPort().createSession(ds as never, 'call-1');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-1', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'mesh',
      sfuConfig: mode('mesh'),
    });
  });

  it('falls back to mesh when sfuConfig read fails', async () => {
    const ds = mockDataset();
    ds._nhProxy.sfuConfig.mockRejectedValue(new Error('config unavailable'));

    await createAd4mCallPort().createSession(ds as never, 'call-2');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-2', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'mesh',
    });
  });

  it('passes cascaded as sfu too', async () => {
    const ds = mockDataset({ sfuConfig: mode('cascaded') });

    await createAd4mCallPort().createSession(ds as never, 'call-4');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-4', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'sfu',
      sfuConfig: mode('cascaded'),
    });
  });

  it("passes a running call's topology over the space's", async () => {
    // A joiner adopting the call's topology, or a switch made in the call.
    const ds = mockDataset({ sfuConfig: mode('mesh') });

    await createAd4mCallPort().createSession(ds as never, 'call-6', { topology: 'sfu' });

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-6', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'sfu',
      sfuConfig: mode('mesh'),
    });
  });

  it('passes the ICE servers the call module chose, in the SDK shape', async () => {
    // The browser's shape allows one URL as a string; the SDK's is always a list.
    const ds = mockDataset();
    ds._nhProxy.sfuConfig.mockRejectedValue(new Error('config unavailable'));

    await createAd4mCallPort().createSession(ds as never, 'call-5', {
      iceServers: [
        { urls: 'turn:relay.example.org:3478', username: 'alice', credential: 's3cret' },
        { urls: ['stun:a.example.org', 'stun:b.example.org'] },
      ],
    });

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-5', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'mesh',
      iceServers: [
        { urls: ['turn:relay.example.org:3478'], username: 'alice', credential: 's3cret' },
        { urls: ['stun:a.example.org', 'stun:b.example.org'] },
      ],
    });
  });
});

describe('configurable', () => {
  it('is true for a shared space', () => {
    expect(createAd4mCallPort().configurable(mockDataset() as never)).toBe(true);
  });

  it('is false for a personal space (no sharedUrl)', () => {
    expect(createAd4mCallPort().configurable(mockDataset({ sharedUrl: '' }) as never)).toBe(false);
  });
});

describe('config', () => {
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

    expect(await createAd4mCallPort().config(ds as never)).toEqual(config);
    expect(ds._nhProxy.sfuConfig).toHaveBeenCalledWith('neighbourhood://test-space');
  });

  it('returns defaults when the read fails', async () => {
    const ds = mockDataset();
    ds._nhProxy.sfuConfig.mockRejectedValue(new Error('RPC failed'));

    expect(await createAd4mCallPort().config(ds as never)).toEqual(DEFAULT_CALL_CONFIG);
  });

  it('throws for a personal space, which has no policy to read', async () => {
    await expect(createAd4mCallPort().config(mockDataset({ sharedUrl: '' }) as never)).rejects.toThrow(
      'not a shared space',
    );
  });
});

describe('setConfig', () => {
  it('writes config through the neighbourhood proxy', async () => {
    const ds = mockDataset();
    const config: CallConfig = { mode: 'gateway', fallback: 'mesh', maxMeshParticipants: 10 };

    expect(await createAd4mCallPort().setConfig(ds as never, config)).toBe(true);
    expect(ds._nhProxy.setSfuConfig).toHaveBeenCalledWith('neighbourhood://test-space', config);
  });

  it('returns false when the proxy rejects the write', async () => {
    const ds = mockDataset({ setSfuResult: false });

    expect(await createAd4mCallPort().setConfig(ds as never, { ...DEFAULT_CALL_CONFIG })).toBe(false);
  });
});
