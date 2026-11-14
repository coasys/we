/**
 * The phone's key-login connector: what the key login leaves in storage, which token the client WE
 * keeps on dials with after a renewal, and how a session the executor refuses ends.
 *
 * `@coasys/ad4m` is replaced by a small double that keeps the facts under test true to the ad4m
 * sources (checked at 95cefb35a): `Ad4mClient` takes its token at construction, `setToken` replaces
 * it for every later call and the next connection (`core/src/Ad4mClient.ts:152-155`,
 * `core/src/apiClient.ts:204`), and `onAuthFailed` calls back once when the executor refuses the
 * token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceKeyPlugin, SignedSessionStatement } from './deviceKey';
import { RENEW_BEFORE_MS } from './keySession';
import { unusedPlugin } from './unusedPlugin.testing';

/** A `localStorage` for the test, as the WebView's. */
class MemoryStorage {
  private map = new Map<string, string>();
  entries() {
    return [...this.map.entries()];
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const agent = {
  challenges: 0,
  renewals: 0,
  sessionChallenge: vi.fn(async () => ({
    challenge: `c${++agent.challenges}`,
    executor: 'did:key:z6MkExecutor',
    expiresAt: 0,
  })),
  loginWithKey: vi.fn(async () => ({
    token: 'token-1',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    grantId: 'grant-1',
    role: 'tenant' as const,
    did: 'did:key:z6MkAgent',
    scid: 'did:scid:coasys:1:QmIdentity',
  })),
  renewSession: vi.fn(async () => ({
    token: `token-${++agent.renewals + 1}`,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })),
  logout: vi.fn(async () => {}),
  /** The executor's answer for the session's agent: unlocked, unless a test says otherwise. */
  status: vi.fn(async () => ({ isInitialized: true, isUnlocked: true })),
};

/** Every client built, the last one the one WE keeps; for a test to act as the executor on. */
const clients: {
  baseUrl: string;
  token?: string;
  closed: boolean;
  refuseToken(reason: string): void;
}[] = [];

vi.mock('@coasys/ad4m', () => {
  class Ad4mClient {
    agent = agent;
    closed = false;
    private authFailed = new Set<(reason: string) => void>();
    constructor(
      public baseUrl: string,
      public token?: string,
    ) {
      clients.push(this);
    }
    /** What the real one dials with from here on (`core/src/Ad4mClient.ts:152-155`). */
    setToken(token: string) {
      this.token = token;
    }
    onAuthFailed(callback: (reason: string) => void) {
      this.authFailed.add(callback);
      return () => this.authFailed.delete(callback);
    }
    /** The executor refused the client's token: each callback hears it. */
    refuseToken(reason: string) {
      for (const callback of this.authFailed) callback(reason);
    }
    close() {
      this.closed = true;
    }
  }
  return { Ad4mClient };
});

vi.mock('@we/backend-ad4m', () => ({
  createAd4mBackendPorts: (client: unknown, _ctx: unknown, options: unknown) => ({ client, options }),
  capabilitiesFromToken: () => [],
}));
vi.mock('@we/seed-file', () => ({ default: { ad4m: {} } }));

function plugin(): DeviceKeyPlugin {
  return {
    ...unusedPlugin(),
    status: async () => ({
      keys: { sign: 'z6MkPhone', enc: 'z6LSPhone', didKey: 'did:key:z6MkPhone' },
      identity: { scid: 'QmIdentity', did: 'did:scid:coasys:1:QmIdentity', seq: 3 },
      pending: null,
      protection: 'tee',
    }),
    create: async () => {
      throw new Error('not used');
    },
    join: async () => {
      throw new Error('not used');
    },
    waitJoined: async () => {
      throw new Error('not used');
    },
    signSession: async (request): Promise<SignedSessionStatement> => ({
      statement: {
        v: 1,
        purpose: request.purpose,
        scid: 'did:scid:coasys:1:QmIdentity',
        key: 'z6MkPhone',
        executor: request.executor,
        audience: new URL(request.url).origin,
        challenge: request.challenge,
        client: { kind: 'native' },
        ...(request.grant ? { grant: request.grant } : {}),
        issuedAt: 1,
      },
      sig: 'z-signed',
    }),
  };
}

const ctx = {} as never;

describe('createDeviceKeyConnector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    agent.challenges = 0;
    agent.renewals = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens its own client with the key session, and writes nothing to storage', async () => {
    // A password session on host A from before, as the ordinary connector keeps it.
    const storage = new MemoryStorage();
    storage.setItem('0.13.1/ad4m-token', 'password-token-for-A');
    storage.setItem('0.13.1/ad4m-url', 'https://a.example');
    vi.stubGlobal('localStorage', storage);
    const before = storage.entries();
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    const connector = createDeviceKeyConnector({ plugin, keyHost: () => 'https://b.example' });

    const result = await connector.initialize(ctx);
    const client = result.client as { baseUrl: string; token?: string };
    expect([client.baseUrl, client.token]).toEqual(['https://b.example', 'token-1']);
    expect(result.connection).toEqual({ port: 443, token: 'token-1', url: 'https://b.example' });
    // The ordinary connector's pair is A's token with A's URL, as it was: nothing of B is beside it.
    expect(storage.entries()).toEqual(before);
  });

  it('refuses a key session whose agent is locked there, and closes the client', async () => {
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    agent.status.mockResolvedValueOnce({ isInitialized: true, isUnlocked: false });
    const connector = createDeviceKeyConnector({ plugin, keyHost: () => 'https://b.example' });
    await expect(connector.initialize(ctx)).rejects.toThrow(
      'b.example didn’t accept this phone’s sign-in (its agent is locked).',
    );
    expect(clients.at(-1)?.closed).toBe(true);

    agent.status.mockRejectedValueOnce(new Error('RPC error 401: unauthorized'));
    await expect(connector.initialize(ctx)).rejects.toThrow(
      'b.example didn’t accept this phone’s sign-in (RPC error 401: unauthorized).',
    );
    expect(clients.at(-1)?.closed).toBe(true);
  });

  it('hands the embedded-app handshake the port the URL names, or its scheme’s', async () => {
    const { portOf } = await import('./deviceKeyConnector');
    expect(portOf('https://b.example')).toBe(443);
    expect(portOf('http://b.example')).toBe(80);
    expect(portOf('http://127.0.0.1:12600')).toBe(12600);
  });

  describe('a key login that cannot reach the executor', () => {
    const offline = () => new TypeError('Failed to fetch');
    function clock() {
      let t = 0;
      const waits: number[] = [];
      return {
        waits,
        now: () => t,
        waitToRetry: async (ms: number) => {
          waits.push(ms);
          t += ms;
        },
      };
    }

    it('tries again, and logs in once the network is back', async () => {
      const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      agent.sessionChallenge.mockRejectedValueOnce(offline()).mockRejectedValueOnce(offline());
      const time = clock();
      const connector = createDeviceKeyConnector({ plugin, keyHost: () => 'https://b.example', ...time });
      const result = await connector.initialize(ctx);
      expect((result.client as { token?: string }).token).toBe('token-1');
      expect(time.waits).toEqual([1_000, 2_000]);
    });

    it('says the phone is offline rather than asking for a password', async () => {
      const { createDeviceKeyConnector, KeyLoginUnreachable, UNREACHABLE_MS, RETRY_MAX_MS } =
        await import('./deviceKeyConnector');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      agent.sessionChallenge.mockRejectedValue(offline());
      try {
        const time = clock();
        const connector = createDeviceKeyConnector({ plugin, keyHost: () => 'https://b.example', ...time });
        const failed = await connector.initialize(ctx).catch((e: unknown) => e);
        expect(failed).toBeInstanceOf(KeyLoginUnreachable);
        expect((failed as Error).message).toContain('b.example');
        expect((failed as Error).message).toBe(
          'Can’t reach b.example. Check that this phone is online, then try again. It stays signed in.',
        );
        // Doubling waits, capped, for the minute and no longer.
        expect(time.waits.slice(0, 5)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000]);
        expect(Math.max(...time.waits)).toBe(RETRY_MAX_MS);
        expect(time.waits.reduce((a, b) => a + b, 0)).toBe(UNREACHABLE_MS);
      } finally {
        agent.sessionChallenge.mockReset();
        agent.sessionChallenge.mockImplementation(async () => ({
          challenge: `c${++agent.challenges}`,
          executor: 'did:key:z6MkExecutor',
          expiresAt: 0,
        }));
      }
    });

    it('refuses at once, with the reason, when the executor refuses the key', async () => {
      const { createDeviceKeyConnector, KeyLoginRefused } = await import('./deviceKeyConnector');
      const refusal = new Error('RPC error 403: not-known');
      agent.loginWithKey.mockRejectedValueOnce(refusal);
      const time = clock();
      const connector = createDeviceKeyConnector({ plugin, keyHost: () => 'https://b.example', ...time });
      const failed = await connector.initialize(ctx).catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(KeyLoginRefused);
      expect((failed as Error).message).toBe(
        'b.example didn’t accept this phone’s sign-in (RPC error 403: not-known).',
      );
      expect((failed as Error).cause).toBe(refusal);
      expect(time.waits).toEqual([]);
    });

    it('tells a failure of the network from a refusal', async () => {
      const { isUnreachable } = await import('./deviceKeyConnector');
      expect(isUnreachable(new TypeError('Failed to fetch'), true)).toBe(true);
      expect(isUnreachable(new TypeError('Load failed'), true)).toBe(true);
      expect(
        isUnreachable(Object.assign(new Error('RPC error 503: WebSocket connection closed'), { status: 503 }), true),
      ).toBe(true);
      expect(
        isUnreachable(Object.assign(new Error("RPC call 'x' timed out after 30000ms"), { status: 408 }), true),
      ).toBe(true);
      expect(isUnreachable(new Error('RPC error 503: store-unavailable'), true)).toBe(true);
      // Whatever it was, a WebView that knows it is offline is offline.
      expect(isUnreachable(new Error('anything'), false)).toBe(true);
      for (const reason of ['not-known', 'signature', 'key', 'audience', 'challenge', 'no-public-origin']) {
        expect(isUnreachable(Object.assign(new Error(`RPC error 403: ${reason}`), { status: 403 }), true)).toBe(false);
      }
    });
  });

  // The gap the review of #436 at 110995400 found: the `Ad4mClient` built by `connect()` kept the
  // token it was constructed with, and the ports and the renewal hold that client, so the first
  // dial after the original token expired went out with it. `onToken` now hands it the new one.
  it('dials with the renewed token after a renewal', async () => {
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    const connector = createDeviceKeyConnector({ plugin, keyHost: () => 'https://b.example' });
    const result = await connector.initialize(ctx);
    const client = result.client as { token?: string };
    expect(client.token).toBe('token-1');

    // Five minutes before the hour is up, the session is renewed.
    await vi.advanceTimersByTimeAsync(3600_000 - RENEW_BEFORE_MS + 1);
    expect(agent.renewSession).toHaveBeenCalledTimes(1);
    // What WE's ports dial with from here on is the client they were handed: it must carry the
    // new token, or the first reconnect after the old one expires is refused.
    expect((result.client as { token?: string }).token).toBe('token-2');
  });
});

describe('a phone in no identity yet', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const unjoined = (pending: boolean) => (): DeviceKeyPlugin => ({
    ...plugin(),
    status: async () => ({
      keys: pending ? { sign: 'z6MkPhone', enc: 'z6LSPhone', didKey: 'did:key:z6MkPhone' } : null,
      identity: null,
      pending: pending ? { did: 'did:scid:coasys:1:Qm', offerId: 'o1', store: 'https://s', matchCode: 'K2P' } : null,
      protection: 'none',
    }),
  });

  it('refuses, and leaves the page where it is, with no identity, no executor or no answer from the plugin', async () => {
    const { createDeviceKeyConnector, KeyLoginRefused } = await import('./deviceKeyConnector');
    const nav = { here: () => '/', assign: vi.fn() };
    const silent = (): DeviceKeyPlugin => ({
      ...plugin(),
      status: async () => {
        throw new Error('bridge gone');
      },
    });
    const cases = [
      { plugin: unjoined(false), keyHost: () => 'https://b.example' },
      { plugin: unjoined(true), keyHost: () => 'https://b.example' },
      { plugin, keyHost: () => null },
      { plugin: () => null, keyHost: () => 'https://b.example' },
      { plugin: silent, keyHost: () => 'https://b.example' },
    ];
    for (const deps of cases) {
      const before = clients.length;
      const failed = await createDeviceKeyConnector({ ...deps, nav })
        .initialize(ctx)
        .catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(KeyLoginRefused);
      // Nothing was dialled, and the page was not left.
      expect(clients.length).toBe(before);
    }
    expect(nav.assign).not.toHaveBeenCalled();
  });

  it('hands Settings the phone’s custody service once signed in', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    const connector = createDeviceKeyConnector({ plugin, keyHost: () => 'https://b.example' });
    const result = await connector.initialize(ctx);
    const options = (
      result.ports as unknown as { options: { custody?: { takesWords?: boolean; publicState?: unknown } } }
    ).options;
    expect(typeof options.custody?.publicState).toBe('function');
    // The phone takes the 12 words as a computer does: Settings offers replacing the master key.
    expect(options.custody?.takesWords).toBeUndefined();
    await result.disconnect!();
  });
});

describe('a key session that ends by itself', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    agent.renewSession.mockClear();
    agent.logout.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function boot() {
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    const onSessionEnded = vi.fn();
    const connector = createDeviceKeyConnector({
      plugin,
      keyHost: () => 'https://b.example',
      onSessionEnded,
    });
    const result = await connector.initialize(ctx);
    return { result, onSessionEnded, client: clients.at(-1)! };
  }

  it('is reported once when the executor refuses the token, and renewing stops', async () => {
    const { onSessionEnded, client } = await boot();
    await vi.advanceTimersByTimeAsync(10_000);
    client.refuseToken('expired');
    client.refuseToken('expired');
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(onSessionEnded.mock.calls[0][0]).toMatchObject({ cause: 'refused', error: 'expired' });
    expect(onSessionEnded.mock.calls[0][0].endedAt - onSessionEnded.mock.calls[0][0].openedAt).toBe(10_000);

    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    expect(agent.renewSession).not.toHaveBeenCalled();
  });

  it('is reported when no renewal succeeds before the session expires', async () => {
    const refused = new Error('signature');
    agent.renewSession.mockImplementation(async () => {
      throw refused;
    });
    try {
      const { onSessionEnded } = await boot();
      await vi.advanceTimersByTimeAsync(3600_000 - RENEW_BEFORE_MS + 1);
      expect(onSessionEnded).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(RENEW_BEFORE_MS);
      expect(onSessionEnded).toHaveBeenCalledTimes(1);
      expect(onSessionEnded.mock.calls[0][0]).toMatchObject({ cause: 'expired', error: refused });
    } finally {
      agent.renewSession.mockReset();
    }
  });

  it('is not reported when the person logs out', async () => {
    const { result, onSessionEnded, client } = await boot();
    await result.disconnect!();
    expect(agent.logout).toHaveBeenCalledTimes(1);
    expect(client.closed).toBe(true);
    // The token the logout ended is refused from then on; that is not a session ending by itself.
    client.refuseToken('unauthorized');
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it('starts WE again, and the boot after one that ended at once skips the key login', async () => {
    const { createDeviceKeyConnector, KeyLoginRefused, startAgain, takeEndedTooSoon, TOO_SOON_MS } =
      await import('./deviceKeyConnector');
    const storage = new MemoryStorage();
    const reload = vi.fn();

    // A session that lasted: a fresh boot logs straight back in.
    startAgain({ cause: 'expired', openedAt: 0, endedAt: 3600_000 }, storage, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeEndedTooSoon(storage)).toBe(false);

    // One refused as soon as it opened: the next boot refuses the key login, once, and the base
    // app hands the connection choice back.
    startAgain({ cause: 'refused', openedAt: Date.now() - TOO_SOON_MS + 1, endedAt: Date.now() }, storage, reload);
    expect(reload).toHaveBeenCalledTimes(2);
    vi.stubGlobal('sessionStorage', storage);
    const status = vi.fn(plugin().status);
    const connector = createDeviceKeyConnector({
      plugin: () => ({ ...plugin(), status }),
      keyHost: () => 'https://b.example',
    });
    await expect(connector.initialize(ctx)).rejects.toBeInstanceOf(KeyLoginRefused);
    expect(status).not.toHaveBeenCalled();
    expect(takeEndedTooSoon(storage)).toBe(false);
    // And only once: the boot after that logs in.
    expect((await connector.initialize(ctx)).client).toBe(clients.at(-1));
  });

  it('keeps its loop guard where there is no sessionStorage, and only for a while', async () => {
    const { guardStorage, startAgain, takeEndedTooSoon, TOO_SOON_MS, TOO_SOON_NOTE_MS } =
      await import('./deviceKeyConnector');
    // A WebView whose sessionStorage throws on use: the note goes to localStorage.
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('SecurityError');
      },
    });
    const local = new MemoryStorage();
    vi.stubGlobal('localStorage', local);
    expect(guardStorage()).toBe(local);
    const reload = vi.fn();
    startAgain({ cause: 'refused', openedAt: 1_000, endedAt: 1_000 + TOO_SOON_MS - 1 }, undefined, reload);
    expect(local.getItem('we-phone/key-session-ended-too-soon')).toBe(String(1_000 + TOO_SOON_MS - 1));
    expect(takeEndedTooSoon(undefined, 1_000 + TOO_SOON_MS)).toBe(true);
    expect(takeEndedTooSoon(undefined, 1_000 + TOO_SOON_MS)).toBe(false);

    // One left from long ago is forgotten, not obeyed.
    startAgain({ cause: 'refused', openedAt: 0, endedAt: 10 }, undefined, reload);
    expect(takeEndedTooSoon(undefined, 10 + TOO_SOON_NOTE_MS)).toBe(false);
    expect(local.getItem('we-phone/key-session-ended-too-soon')).toBeNull();
    // Nor is one that is not a time.
    local.setItem('we-phone/key-session-ended-too-soon', 'yes');
    expect(takeEndedTooSoon(undefined, 10)).toBe(false);
  });
});
