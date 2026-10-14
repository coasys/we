/**
 * Call session adapter — unit tests.
 *
 * Verifies that the session factory correctly:
 * - Reads the moderator's SFU config before creating a session
 * - Passes the correct topology to `createSession`
 * - Passes 'mesh' explicitly when the config says mesh, and 'sfu' or 'auto' as 'auto'
 * - Hands a retired SFU mode on as 'sfu'
 * - Falls back to 'auto' when the config read fails
 * - Throws when no dataset exists
 */
import { describe, expect, it, vi } from 'vitest';

import { createCallSessionFactory } from './callSessionAdapter';

/** Build a mock dataset that looks like a shared PerspectiveProxy. */
function mockDataset(overrides?: { sharedUrl?: string; sfuConfigMode?: string }) {
  const { sharedUrl = 'neighbourhood://test-space', sfuConfigMode = 'mesh' } = overrides ?? {};

  const session = { join: vi.fn(), leave: vi.fn(), destroy: vi.fn() };
  const nhProxy: Record<string, unknown> = {
    createSession: vi.fn().mockResolvedValue(session),
    sfuConfig: vi.fn().mockResolvedValue({ mode: sfuConfigMode }),
  };

  return {
    sharedUrl,
    getNeighbourhoodProxy: () => nhProxy,
    _nhProxy: nhProxy,
    _session: session,
  };
}

describe('createCallSessionFactory', () => {
  /*
    The session takes mesh, sfu or auto. sfu and auto go as auto with the config beside it: the
    session's auto resolution follows the config, so the space's choice decides the topology.
  */
  it('reads config and passes sfu as auto, with the config', async () => {
    const ds = mockDataset({ sfuConfigMode: 'sfu' });
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('test-call-123');

    expect(ds._nhProxy.sfuConfig).toHaveBeenCalledWith('neighbourhood://test-space');
    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('test-call-123', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'auto',
      sfuConfig: { mode: 'sfu' },
    });
  });

  it('passes mesh explicitly when config mode says mesh', async () => {
    const ds = mockDataset({ sfuConfigMode: 'mesh' });
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('call-1');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-1', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'mesh',
      sfuConfig: { mode: 'mesh' },
    });
  });

  it('falls back to auto when sfuConfig read fails', async () => {
    const ds = mockDataset();
    (ds._nhProxy.sfuConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('config unavailable'));
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('call-2');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-2', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'auto',
    });
  });

  it('passes auto as auto, with the config, so the SDK applies its rule', async () => {
    const ds = mockDataset({ sfuConfigMode: 'auto' });
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('call-3');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-3', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'auto',
      sfuConfig: { mode: 'auto' },
    });
  });

  it.each(['designated', 'gateway', 'cascaded'])(
    'hands a retired mode (%s) from an older executor on as sfu',
    async (legacy) => {
      const ds = mockDataset({ sfuConfigMode: legacy });
      const factory = createCallSessionFactory(
        () => null,
        () => ds as never,
        () => null,
      );

      await factory('call-4');

      expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-4', {
        neighbourhoodUrl: 'neighbourhood://test-space',
        topology: 'auto',
        sfuConfig: { mode: 'sfu' },
      });
    },
  );

  it('passes the ICE servers the call module chose, in the SDK shape', async () => {
    // The browser's shape allows one URL as a string; the SDK's is always a list.
    const ds = mockDataset();
    (ds._nhProxy.sfuConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('config unavailable'));
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('call-5', {
      iceServers: [
        { urls: 'turn:relay.example.org:3478', username: 'alice', credential: 's3cret' },
        { urls: ['stun:a.example.org', 'stun:b.example.org'] },
      ],
    });

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-5', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'auto',
      iceServers: [
        { urls: ['turn:relay.example.org:3478'], username: 'alice', credential: 's3cret' },
        { urls: ['stun:a.example.org', 'stun:b.example.org'] },
      ],
    });
  });

  it('throws when no dataset exists', async () => {
    const factory = createCallSessionFactory(
      () => null,
      () => null,
      () => null,
    );
    await expect(factory('call-x')).rejects.toThrow('no active dataset');
  });
});
