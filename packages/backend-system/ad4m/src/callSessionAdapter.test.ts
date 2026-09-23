/**
 * Call session adapter — unit tests.
 *
 * Verifies that the session factory correctly:
 * - Reads the moderator's SFU config before creating a session
 * - Passes the correct topology to `createSession`
 * - Falls back to 'auto' when the config read fails
 * - Passes 'mesh' explicitly when the config says mesh
 * - Throws when no dataset exists
 * - Throws when the executor lacks session support
 */
import { describe, expect, it, vi } from 'vitest';

import { createCallSessionFactory } from './callSessionAdapter';

/** Build a mock dataset that looks like a shared PerspectiveProxy. */
function mockDataset(overrides?: {
  sharedUrl?: string;
  sfuConfigMode?: string;
  hasSfuConfig?: boolean;
  hasCreateSession?: boolean;
}) {
  const {
    sharedUrl = 'neighbourhood://test-space',
    sfuConfigMode = 'auto',
    hasSfuConfig = true,
    hasCreateSession = true,
  } = overrides ?? {};

  const session = { join: vi.fn(), leave: vi.fn(), destroy: vi.fn() };
  const nhProxy: Record<string, unknown> = {};

  if (hasCreateSession) {
    nhProxy.createSession = vi.fn().mockResolvedValue(session);
  }
  if (hasSfuConfig) {
    nhProxy.sfuConfig = vi.fn().mockResolvedValue({ mode: sfuConfigMode });
  }

  return {
    sharedUrl,
    getNeighbourhoodProxy: () => nhProxy,
    _nhProxy: nhProxy,
    _session: session,
  };
}

describe('createCallSessionFactory', () => {
  it('reads config and passes topology to createSession', async () => {
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
      topology: 'designated',
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
    const ds = mockDataset({ hasSfuConfig: true });
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

  it('falls back to auto when executor lacks sfuConfig method', async () => {
    const ds = mockDataset({ hasSfuConfig: false });
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('call-3');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-3', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'auto',
    });
  });

  it('passes cascaded topology through', async () => {
    const ds = mockDataset({ sfuConfigMode: 'cascaded' });
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );

    await factory('call-4');

    expect(ds._nhProxy.createSession).toHaveBeenCalledWith('call-4', {
      neighbourhoodUrl: 'neighbourhood://test-space',
      topology: 'cascaded',
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

  it('throws when executor lacks createSession support', async () => {
    const ds = mockDataset({ hasCreateSession: false });
    const factory = createCallSessionFactory(
      () => null,
      () => ds as never,
      () => null,
    );
    await expect(factory('call-y')).rejects.toThrow('does not support Session');
  });
});
