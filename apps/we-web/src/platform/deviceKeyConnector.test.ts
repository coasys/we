/**
 * The phone's connector around ad4m-connect: what the key login leaves in storage, and which
 * token the client WE keeps on dials with after a renewal.
 *
 * `@coasys/ad4m` and `@coasys/ad4m-connect/core` are replaced by small doubles that keep the
 * two facts under test true to the pinned sources (dc5964ba4): `Ad4mClient` takes its token at
 * construction and has no way to change it (`core/src/apiClient.ts:140-148`, `:205`: every dial
 * uses that token; `:175`: "a new token needs a new client"); `Ad4mConnect`'s constructor restores
 * the stored `ad4m-token` (`connect/src/core.ts:104`), `connect()` builds the client from
 * `this.token` and writes `ad4m-url` (`:197`, `:213`), and `disconnect()` removes the stored token
 * (`:345-346`). Storage keys are prefixed with the connect package's version (`connect/src/utils.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceKeyPlugin, SignedSessionStatement } from './deviceKey';
import { RENEW_BEFORE_MS } from './keySession';

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
    close() {}
  }
  return { Ad4mClient };
});

vi.mock('@coasys/ad4m-connect/core', async () => {
  const { Ad4mClient } = (await vi.importMock('@coasys/ad4m')) as {
    Ad4mClient: new (u: string, t?: string) => unknown;
  };
  class Ad4mConnect {
    url: string;
    token: string;
    port = 12600;
    authState = 'unauthenticated';
    ad4mClient: unknown;
    constructor(options: { url?: string }) {
      this.url = options.url ?? localStorage.getItem(key('ad4m-url')) ?? 'http://localhost:12600';
      this.token = localStorage.getItem(key('ad4m-token')) ?? '';
    }
    get baseUrl() {
      return this.url;
    }
    async connect() {
      localStorage.setItem(key('ad4m-url'), this.url);
      this.ad4mClient = new Ad4mClient(this.baseUrl, this.token);
      this.authState = 'authenticated';
      return this.ad4mClient;
    }
    async disconnect() {
      this.ad4mClient = undefined;
      this.token = '';
      localStorage.removeItem(key('ad4m-token'));
      this.authState = 'unauthenticated';
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

  // Known gap (review of #436 at 110995400): `onToken` sets `core.token` only. The `Ad4mClient`
  // built by `connect()` keeps the token it was constructed with, and the ports and the renewal
  // hold that client, so the first dial after the original token expires goes out with it. The
  // fix is a client that can take a new token, or a rebuild of the client and everything that
  // holds it; when it lands, this becomes `it(...)`.
  it.fails('dials with the renewed token after a renewal', async () => {
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
