/**
 * What the phone's key login needs before it dials: the `DeviceKey` plugin reached through the native
 * bridge, the host it was told to use, and a joined identity.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DeviceKeyPlugin, SignedSessionStatement } from './deviceKey';
import { deviceKeyPlugin } from './deviceKey';
import { keyLoginTarget } from './deviceKeyConnector';
import { KEY_HOST_KEY, readKeyHost, rememberKeyHost } from './keyHost';
import { unusedPlugin } from './unusedPlugin.testing';

const URL_ = 'http://127.0.0.1:12600';
const SCID = 'did:scid:coasys:1:QmIdentity';

function fakePlugin(overrides: Partial<DeviceKeyPlugin> = {}) {
  const plugin: DeviceKeyPlugin = {
    ...unusedPlugin(),
    status: async () => ({
      keys: { sign: 'z6MkPhone', enc: 'z6LSPhone', didKey: 'did:key:z6MkPhone' },
      identity: { scid: 'QmIdentity', did: SCID, seq: 3 },
      pending: null,
      protection: 'tee',
    }),
    signSession: async (request): Promise<SignedSessionStatement> => ({
      statement: {
        v: 1,
        purpose: request.purpose,
        scid: SCID,
        key: 'z6MkPhone',
        executor: request.executor,
        audience: new URL(request.url).origin,
        challenge: request.challenge,
        client: { kind: 'native' },
        issuedAt: 1,
      },
      sig: 'z-signed',
    }),
    ...overrides,
  };
  return { plugin };
}

describe('deviceKeyPlugin', () => {
  it('is null without the native bridge or without the plugin', () => {
    expect(deviceKeyPlugin(undefined)).toBeNull();
    expect(deviceKeyPlugin({ isPluginAvailable: () => false, nativePromise: async () => ({}) })).toBeNull();
  });

  it('calls the plugin by name through the bridge', async () => {
    const calls: unknown[][] = [];
    const plugin = deviceKeyPlugin({
      isPluginAvailable: (name) => name === 'DeviceKey',
      nativePromise: async (...args) => {
        calls.push(args);
        return { progress: { state: 'waiting', detail: 'claimed' } };
      },
    });
    expect(plugin).not.toBeNull();
    await plugin!.waitJoined({ seconds: 5 });
    await plugin!.status();
    expect(calls).toEqual([
      ['DeviceKey', 'waitJoined', { seconds: 5 }],
      ['DeviceKey', 'status', {}],
    ]);
  });
});

describe('keyLoginTarget', () => {
  it('logs in by key only with the plugin, an executor URL and a joined identity', async () => {
    const { plugin } = fakePlugin();
    expect(await keyLoginTarget({ plugin: () => plugin, keyHost: () => URL_ })).toEqual({ plugin, url: URL_ });
    expect(await keyLoginTarget({ plugin: () => null, keyHost: () => URL_ })).toBeNull();
    expect(await keyLoginTarget({ plugin: () => plugin, keyHost: () => null })).toBeNull();

    const notJoined = fakePlugin({
      status: async () => ({ keys: null, identity: null, pending: null, protection: 'none' }),
    }).plugin;
    expect(await keyLoginTarget({ plugin: () => notJoined, keyHost: () => URL_ })).toBeNull();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = fakePlugin({
      status: async () => {
        throw new Error('Damaged');
      },
    }).plugin;
    expect(await keyLoginTarget({ plugin: () => broken, keyHost: () => URL_ })).toBeNull();
  });

  it('says what protection the sealing key has, and warns when it is not secure hardware', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const joined = fakePlugin().plugin;
      const software = {
        ...joined,
        status: async () => ({ ...(await joined.status()), protection: 'software' as const }),
      };
      // Accepted at every level: software still logs in.
      expect(await keyLoginTarget({ plugin: () => software, keyHost: () => URL_ })).not.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('software protection'));

      expect(await keyLoginTarget({ plugin: () => joined, keyHost: () => URL_ })).not.toBeNull();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('tee protection'));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('the key host', () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  }

  it('keeps an http(s) URL under its own key, and forgets it', () => {
    const storage = memory();
    expect(readKeyHost(storage)).toBeNull();
    rememberKeyHost('https://node.example.org/', storage);
    expect(storage.map.get(KEY_HOST_KEY)).toBe('https://node.example.org');
    expect(readKeyHost(storage)).toBe('https://node.example.org');
    rememberKeyHost(null, storage);
    expect(readKeyHost(storage)).toBeNull();
  });

  it('refuses what is not http(s)', () => {
    const storage = memory();
    expect(() => rememberKeyHost('javascript:alert(1)', storage)).toThrow();
    storage.map.set(KEY_HOST_KEY, 'file:///etc/passwd');
    expect(readKeyHost(storage)).toBeNull();
  });
});
