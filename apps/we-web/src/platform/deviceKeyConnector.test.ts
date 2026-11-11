/**
 * The phone's connector around ad4m-connect: what the key login leaves in storage, and which
 * token the client WE keeps on dials with after a renewal.
 *
 * `@coasys/ad4m` and `@coasys/ad4m-connect/core` are replaced by small doubles that keep the
 * two facts under test true to the pinned sources (dbde6f6eb): `Ad4mClient` takes its token at
 * construction and `setToken` replaces it for every later call and the next connection
 * (`core/src/Ad4mClient.ts:152-155`, `core/src/apiClient.ts:194`); `Ad4mConnect`'s constructor
 * restores the stored `ad4m-token` (`connect/src/core.ts:104`), `connect()` builds the client from
 * `this.token` and writes `ad4m-url` (`:197`, `:213`), and `disconnect()` removes the stored token
 * (`:344-345`). Storage keys are prefixed with the connect package's version (`connect/src/utils.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceKeyPlugin, SignedSessionStatement } from './deviceKey';
import { RENEW_BEFORE_MS } from './keySession';
import { unusedPlugin } from './unusedPlugin.testing';

const CONNECT_VERSION = '0.13.1-staging.6';
const key = (name: string) => `${CONNECT_VERSION}/${name}`;

/** A `localStorage` for the test, as the WebView's. */
class MemoryStorage {
  private map = new Map<string, string>();
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
};

vi.mock('@coasys/ad4m', () => {
  class Ad4mClient {
    agent = agent;
    constructor(
      public baseUrl: string,
      public token?: string,
    ) {}
    /** What the real one dials with from here on (`core/src/Ad4mClient.ts:152-155`). */
    setToken(token: string) {
      this.token = token;
    }
    close() {}
  }
  return { Ad4mClient };
});

vi.mock('@coasys/ad4m-connect/core', async () => {
  const { Ad4mClient } = (await vi.importMock('@coasys/ad4m')) as {
    Ad4mClient: new (u: string, t?: string) => unknown;
  };
  // An EventTarget, as the real one is: every auth state is dispatched as `authstatechange`
  // (`connect/src/core.ts:803-805`).
  class Ad4mConnect extends EventTarget {
    /** The last one built, for a test to act as the executor on. */
    static last: Ad4mConnect | undefined;
    url: string;
    token: string;
    port = 12600;
    authState = 'unauthenticated';
    ad4mClient: unknown;
    constructor(options: { url?: string }) {
      super();
      this.url = options.url ?? localStorage.getItem(key('ad4m-url')) ?? 'http://localhost:12600';
      this.token = localStorage.getItem(key('ad4m-token')) ?? '';
      Ad4mConnect.last = this;
    }
    get baseUrl() {
      return this.url;
    }
    private notify(state: string) {
      this.authState = state;
      this.dispatchEvent(new CustomEvent('authstatechange', { detail: state }));
    }
    async connect() {
      localStorage.setItem(key('ad4m-url'), this.url);
      this.ad4mClient = new Ad4mClient(this.baseUrl, this.token);
      this.notify('authenticated');
      return this.ad4mClient;
    }
    async disconnect() {
      this.ad4mClient = undefined;
      this.token = '';
      localStorage.removeItem(key('ad4m-token'));
      this.notify('unauthenticated');
    }
    /** The executor refused the client's token: `watchAuth` → `discardToken` (`:252-268`). */
    refuseToken() {
      this.token = '';
      localStorage.removeItem(key('ad4m-token'));
      this.notify('unauthenticated');
    }
  }
  return { default: Ad4mConnect };
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

const fallback = { initialize: vi.fn(async () => ({}) as never) };
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

  it('leaves no password session behind when it logs in with the key', async () => {
    // A password session on host A from before, as ad4m-connect keeps it.
    localStorage.setItem(key('ad4m-token'), 'password-token-for-A');
    localStorage.setItem(key('ad4m-url'), 'https://a.example');
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    const connector = createDeviceKeyConnector(fallback, { plugin, keyHost: () => 'https://b.example' });

    const result = await connector.initialize(ctx);
    expect(fallback.initialize).not.toHaveBeenCalled();
    expect((result.client as { token?: string }).token).toBe('token-1');
    expect(localStorage.getItem(key('ad4m-url'))).toBe('https://b.example');
    // The ordinary connector, next time this boot falls back, restores the stored pair: A's
    // token must not be there to be sent to B.
    expect(localStorage.getItem(key('ad4m-token'))).toBeNull();
    const Ad4mConnect = (await import('@coasys/ad4m-connect/core')).default;
    const later = new Ad4mConnect({ appInfo: {} as never, capabilities: [] });
    expect([later.url, later.token]).toEqual(['https://b.example', '']);
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
      const ordinary = { initialize: vi.fn(async () => ({}) as never) };
      const connector = createDeviceKeyConnector(ordinary, { plugin, keyHost: () => 'https://b.example', ...time });
      const result = await connector.initialize(ctx);
      expect((result.client as { token?: string }).token).toBe('token-1');
      expect(ordinary.initialize).not.toHaveBeenCalled();
      expect(time.waits).toEqual([1_000, 2_000]);
    });

    it('says the phone is offline rather than asking for a password', async () => {
      const { createDeviceKeyConnector, KeyLoginUnreachable, UNREACHABLE_MS, RETRY_MAX_MS } =
        await import('./deviceKeyConnector');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      agent.sessionChallenge.mockRejectedValue(offline());
      try {
        const time = clock();
        const ordinary = { initialize: vi.fn(async () => ({}) as never) };
        const connector = createDeviceKeyConnector(ordinary, { plugin, keyHost: () => 'https://b.example', ...time });
        const failed = await connector.initialize(ctx).catch((e: unknown) => e);
        expect(failed).toBeInstanceOf(KeyLoginUnreachable);
        expect((failed as Error).message).toContain('b.example');
        expect((failed as Error).message).toContain('offline');
        expect(ordinary.initialize).not.toHaveBeenCalled();
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

    it('still falls back to the connect screen when the executor refuses', async () => {
      const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      agent.loginWithKey.mockRejectedValueOnce(new Error('RPC error 403: not-known'));
      const time = clock();
      const ordinary = { initialize: vi.fn(async () => ({ client: 'fallback' }) as never) };
      const connector = createDeviceKeyConnector(ordinary, { plugin, keyHost: () => 'https://b.example', ...time });
      expect((await connector.initialize(ctx)).client).toBe('fallback');
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
    const connector = createDeviceKeyConnector(fallback, { plugin, keyHost: () => 'https://b.example' });
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

  it('is sent to the identity page to join, and comes back where it was', async () => {
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    for (const pending of [false, true]) {
      const nav = { here: () => '/', assign: vi.fn() };
      const ordinary = { initialize: vi.fn(async () => ({}) as never) };
      const connector = createDeviceKeyConnector(ordinary, {
        plugin: unjoined(pending),
        keyHost: () => null,
        joinDeclined: () => false,
        nav,
      });
      let booted = false;
      void connector.initialize(ctx).then(() => (booted = true));
      await vi.waitFor(() => expect(nav.assign).toHaveBeenCalledTimes(1));
      expect(nav.assign).toHaveBeenCalledWith('/mobile/identity.html?join=&back=%2F');
      // The page is left: nothing boots behind it.
      expect(booted).toBe(false);
      expect(ordinary.initialize).not.toHaveBeenCalled();
    }
  });

  it('boots to the ordinary sign-in once the person said “Not now”, or where the plugin does not answer', async () => {
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    const { JOIN_DECLINED_KEY } = await import('./keyHost');
    localStorage.setItem(JOIN_DECLINED_KEY, '1');
    const nav = { here: () => '/', assign: vi.fn() };
    const ordinary = { initialize: vi.fn(async () => ({ client: 'fallback' }) as never) };
    // The default reads the note the join page left.
    const declined = createDeviceKeyConnector(ordinary, { plugin: unjoined(false), keyHost: () => null, nav });
    expect((await declined.initialize(ctx)).client).toBe('fallback');

    const silent = createDeviceKeyConnector(ordinary, {
      plugin: () => ({
        ...plugin(),
        status: async () => {
          throw new Error('bridge gone');
        },
      }),
      keyHost: () => null,
      joinDeclined: () => false,
      nav,
    });
    expect((await silent.initialize(ctx)).client).toBe('fallback');
    expect(nav.assign).not.toHaveBeenCalled();
  });

  it('hands Settings the phone’s custody service once signed in', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { createDeviceKeyConnector } = await import('./deviceKeyConnector');
    const connector = createDeviceKeyConnector(fallback, { plugin, keyHost: () => 'https://b.example' });
    const result = await connector.initialize(ctx);
    const options = (result.ports as unknown as { options: { custody?: { takesWords?: boolean } } }).options;
    expect(options.custody?.takesWords).toBe(false);
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
    const Ad4mConnect = (await import('@coasys/ad4m-connect/core')).default as unknown as {
      last: { refuseToken(): void };
    };
    const onSessionEnded = vi.fn();
    const connector = createDeviceKeyConnector(fallback, {
      plugin,
      keyHost: () => 'https://b.example',
      onSessionEnded,
    });
    const result = await connector.initialize(ctx);
    return { result, onSessionEnded, core: Ad4mConnect.last };
  }

  it('is reported once when the executor refuses the token, and renewing stops', async () => {
    const { onSessionEnded, core } = await boot();
    await vi.advanceTimersByTimeAsync(10_000);
    core.refuseToken();
    core.refuseToken();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(onSessionEnded.mock.calls[0][0]).toMatchObject({ cause: 'refused' });
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
    const { result, onSessionEnded } = await boot();
    await result.disconnect!();
    expect(agent.logout).toHaveBeenCalledTimes(1);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it('starts WE again, and the boot after one that ended at once skips the key login', async () => {
    const { createDeviceKeyConnector, startAgain, takeEndedTooSoon, TOO_SOON_MS } =
      await import('./deviceKeyConnector');
    const storage = new MemoryStorage();
    const reload = vi.fn();

    // A session that lasted: a fresh boot logs straight back in.
    startAgain({ cause: 'expired', openedAt: 0, endedAt: 3600_000 }, storage, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeEndedTooSoon(storage)).toBe(false);

    // One refused as soon as it opened: the next boot shows the connect screen, once.
    startAgain({ cause: 'refused', openedAt: Date.now() - TOO_SOON_MS + 1, endedAt: Date.now() }, storage, reload);
    expect(reload).toHaveBeenCalledTimes(2);
    vi.stubGlobal('sessionStorage', storage);
    const ordinary = { initialize: vi.fn(async () => ({ client: 'fallback' }) as never) };
    const status = vi.fn(plugin().status);
    const connector = createDeviceKeyConnector(ordinary, {
      plugin: () => ({ ...plugin(), status }),
      keyHost: () => 'https://b.example',
    });
    expect((await connector.initialize(ctx)).client).toBe('fallback');
    expect(status).not.toHaveBeenCalled();
    expect(takeEndedTooSoon(storage)).toBe(false);
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
