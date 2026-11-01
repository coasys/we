/**
 * The Electron platform's identity: the preload's bridge where the main process runs a custody
 * service, and none where it does not (Windows), so the app starts without the identity screens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function platformWith(identity: unknown) {
  vi.resetModules();
  vi.stubGlobal('window', { electron: { identity } });
  return (await import('./electronPlatform')).electronPlatform;
}

describe('the Electron platform', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hands the shell the preload’s identity host', async () => {
    const outcome = 'done' as const;
    const bridge = { open: vi.fn(async () => outcome), publicState: vi.fn(async () => ({ did: null })) };
    const platform = await platformWith(bridge);
    expect(await platform.identity?.open({ kind: 'create' })).toBe('done');
    expect(bridge.open).toHaveBeenCalledWith({ kind: 'create' });
    expect(await platform.identity?.publicState()).toEqual({ did: null });
  });

  it('has no identity where the main process keeps no custody service', async () => {
    const platform = await platformWith(undefined);
    expect(platform.identity).toBeUndefined();
  });
});
