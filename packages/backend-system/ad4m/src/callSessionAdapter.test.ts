/**
 * Call session adapter — unit tests.
 *
 * Verifies that the session factory correctly:
 * - Reads the moderator's SFU config before creating a session
 * - Passes the correct topology to `createSession`
 * - Passes 'mesh' explicitly when the config says mesh, and an SFU mode as 'auto'
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
    The session takes mesh, sfu or auto, and resolves anything else as auto. The three SFU modes
    were passed through as they were, which the session read as auto; passing auto says so.
  */
  it('reads config and passes an SFU mode as auto', async () => {
    const ds = mockDataset({ sfuConfigMode: 'designated' });
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

  it('passes cascaded as auto too', async () => {
    const ds = mockDataset({ sfuConfigMode: 'cascaded' });
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('call-4');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-4', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'auto',
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
