import { afterEach, describe, expect, it, vi } from 'vitest';

import { serverHost } from './ad4mConnector';

// The module builds its connector on import, which reads `window`.
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window = {};
});

// The seed file is a build-time alias of the app's bundler; this test needs none of it.
vi.mock('@we/seed-file', () => ({ default: { ad4m: {} } }));

describe('the server host the renderer hands the backend', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reloads the window on restart and never settles, as the host contract says', async () => {
    const reload = vi.fn();
    const noop = vi.fn(async () => undefined);
    vi.stubGlobal('window', {
      location: { reload },
      electron: { servers: { list: noop, add: noop, remove: noop, choose: noop } },
    });

    const settled = vi.fn();
    void serverHost()!.restart().then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
  });
});
