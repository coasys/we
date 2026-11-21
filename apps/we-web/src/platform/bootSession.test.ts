/**
 * The boot session an embedding host hands WE: read once, taken off `window`, never stored, and
 * turned into a connector over the host's own token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const made = vi.hoisted(() => ({
  clients: [] as { base: string; token: string; calls: string[] }[],
  fail: false,
}));

vi.mock('@coasys/ad4m', async (importActual) => ({
  ...(await importActual<typeof import('@coasys/ad4m')>()),
  Ad4mClient: class {
    calls: string[] = [];
    agent = {
      status: async () => {
        this.calls.push('status');
        if (made.fail) throw new Error('The token was refused');
        return { isInitialized: true, isUnlocked: true };
      },
      logout: async () => void this.calls.push('logout'),
    };
    runtime = { multiUserEnabled: async () => true };
    constructor(
      readonly base: string,
      readonly token: string,
    ) {
      made.clients.push(this);
    }
    close() {
      this.calls.push('close');
    }
  },
}));

const ports = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock('@we/backend-ad4m', async (importActual) => ({
  ...(await importActual<typeof import('@we/backend-ad4m')>()),
  createAd4mBackendPorts: (_client: unknown, _ctx: unknown, options: Record<string, unknown>) => {
    ports.options.push(options);
    return {};
  },
}));
vi.mock('@we/seed-file', () => ({ default: { ad4m: {} } }));
vi.mock('@coasys/connect', () => ({ getAd4mConnect: () => ({}) }));

import { createSessionConnector, takeBootSession } from './bootSession';

afterEach(() => {
  made.clients = [];
  made.fail = false;
  ports.options = [];
  vi.restoreAllMocks();
});

const windowWith = (value: unknown) => ({ __WE_AD4M_SESSION: value }) as unknown as Window;

describe('takeBootSession', () => {
  it('reads the session once and removes it from the window', () => {
    const win = windowWith({ url: 'http://127.0.0.1:12000', token: 't' });
    expect(takeBootSession(win)).toEqual({ url: 'http://127.0.0.1:12000', token: 't' });
    expect(win.__WE_AD4M_SESSION).toBeUndefined();
    expect(takeBootSession(win)).toBeNull();
  });

  it('is null, quietly, where the host set nothing', () => {
    const error = vi.spyOn(console, 'error');
    expect(takeBootSession(windowWith(undefined))).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('writes nothing to storage', () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    takeBootSession(windowWith({ url: 'https://node.example.org', token: 't' }));
    vi.unstubAllGlobals();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    ['no token', { url: 'http://127.0.0.1:12000' }],
    ['an empty token', { url: 'http://127.0.0.1:12000', token: '' }],
    ['no url', { token: 't' }],
    ['a url that is not an executor', { url: 'file:///etc/passwd', token: 't' }],
    ['a string', 'http://127.0.0.1:12000'],
    ['null', null],
  ])('refuses, and says so, %s', (_name, value) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const win = windowWith(value);
    expect(takeBootSession(win)).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(win.__WE_AD4M_SESSION).toBeUndefined();
  });
});

describe('the boot session connector', () => {
  it('connects to the host’s executor with the host’s token, over http for a ws url', async () => {
    const connector = createSessionConnector({ url: 'ws://127.0.0.1:12000/graphql', token: 'host-token' });
    const result = await connector.initialize({} as never);
    expect(made.clients).toMatchObject([{ base: 'http://127.0.0.1:12000', token: 'host-token' }]);
    expect(result.connection).toEqual({ port: 12000, token: 'host-token', url: 'http://127.0.0.1:12000' });
    expect(ports.options.at(-1)).toMatchObject({ operator: true, unlockedAtConnect: true, administersNode: false });
  });

  it('stops the boot when the executor refuses the token', async () => {
    made.fail = true;
    const connector = createSessionConnector({ url: 'https://node.example.org', token: 'stale' });
    await expect(connector.initialize({} as never)).rejects.toThrow('The token was refused');
    expect(ports.options).toEqual([]);
  });

  it('logs out and closes the client on disconnect', async () => {
    const connector = createSessionConnector({ url: 'https://node.example.org', token: 't' });
    const result = await connector.initialize({} as never);
    await result.disconnect?.();
    expect(made.clients[0]!.calls).toEqual(['status', 'logout', 'close']);
  });
});
