/**
 * The phone's key session, over a fake executor and a fake plugin: what is signed, what the
 * executor is asked, and when a renewal happens.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DeviceKeyPlugin, SessionSignRequest, SignedSessionStatement } from './deviceKey';
import { deviceKeyPlugin } from './deviceKey';
import { keyLoginTarget } from './deviceKeyConnector';
import { KEY_HOST_KEY, readKeyHost, rememberKeyHost } from './keyHost';
import {
  keepRenewed,
  type KeySession,
  type KeySessionAgent,
  loginWithDeviceKey,
  RENEW_BEFORE_MS,
  type RenewalClock,
  RETRY_MS,
} from './keySession';
import { unusedPlugin } from './unusedPlugin.testing';

const URL_ = 'http://127.0.0.1:12600';
const EXECUTOR = 'did:key:z6MkExecutor';
const SCID = 'did:scid:coasys:1:QmIdentity';

function fakePlugin(overrides: Partial<DeviceKeyPlugin> = {}) {
  const signed: SessionSignRequest[] = [];
  const plugin: DeviceKeyPlugin = {
    ...unusedPlugin(),
    status: async () => ({
      keys: { sign: 'z6MkPhone', enc: 'z6LSPhone', didKey: 'did:key:z6MkPhone' },
      identity: { scid: 'QmIdentity', did: SCID, seq: 3 },
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
    signSession: async (request): Promise<SignedSessionStatement> => {
      signed.push(request);
      return {
        statement: {
          v: 1,
          purpose: request.purpose,
          scid: SCID,
          key: 'z6MkPhone',
          executor: request.executor,
          audience: new URL(request.url).origin,
          challenge: request.challenge,
          client: { kind: 'native' },
          ...(request.grant ? { grant: request.grant } : {}),
          issuedAt: 1,
        },
        sig: `z-signed-${signed.length}`,
      };
    },
    ...overrides,
  };
  return { plugin, signed };
}

function fakeAgent(now: () => number) {
  let challenges = 0;
  const logins: unknown[] = [];
  const renewals: SignedSessionStatement[] = [];
  let refuseRenewals = 0;
  const agent: KeySessionAgent = {
    sessionChallenge: async () => ({ challenge: `challenge-${++challenges}`, executor: EXECUTOR, expiresAt: 0 }),
    loginWithKey: async (proof, app) => {
      logins.push({ proof, app });
      return session(now());
    },
    renewSession: async (proof) => {
      if (refuseRenewals > 0) {
        refuseRenewals--;
        throw new Error('store-unavailable');
      }
      renewals.push(proof);
      return { token: `token-${renewals.length + 1}`, expiresAt: Math.floor(now() / 1000) + 3600 };
    },
  };
  return {
    agent,
    logins,
    renewals,
    refuse: (n: number) => {
      refuseRenewals = n;
    },
  };
}

function session(nowMs: number): KeySession {
  return {
    token: 'token-1',
    expiresAt: Math.floor(nowMs / 1000) + 3600,
    grantId: 'grant-1',
    role: 'app',
    did: 'did:key:z6MkHostAgent',
    scid: SCID,
  };
}

/** A clock the test moves by hand; timers fire when it passes them. */
function manualClock(start = 1_700_000_000_000) {
  let now = start;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  const clock: RenewalClock = {
    now: () => now,
    setTimeout: (run, ms) => {
      const id = ++ids;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  return {
    clock,
    now: () => now,
    pending: () => timers.map((t) => t.at - now),
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((t) => t !== next);
        now = next.at;
        next.run();
        // Let the renewal's awaits settle.
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      now = until;
    },
  };
}

describe('loginWithDeviceKey', () => {
  it('signs a login for the challenge and the URL it dials, and logs in with it', async () => {
    const { plugin, signed } = fakePlugin();
    const { agent, logins } = fakeAgent(() => 0);
    const app = { appName: 'WE', appDesc: 'd', appDomain: 'ad4m.weco.io' };

    const result = await loginWithDeviceKey(plugin, agent, URL_, app);

    expect(signed).toEqual([{ purpose: 'login', executor: EXECUTOR, url: URL_, challenge: 'challenge-1' }]);
    expect(logins).toHaveLength(1);
    const { proof, app: sentApp } = logins[0] as { proof: SignedSessionStatement; app: unknown };
    expect(proof.statement.audience).toBe(URL_);
    expect(proof.statement.grant).toBeUndefined();
    expect(sentApp).toBe(app);
    expect(result.grantId).toBe('grant-1');
  });

  it('passes a refusal on, so the connector can fall back', async () => {
    const { plugin } = fakePlugin();
    const { agent } = fakeAgent(() => 0);
    agent.loginWithKey = async () => {
      throw new Error('not-known');
    };
    await expect(
      loginWithDeviceKey(plugin, agent, URL_, { appName: 'a', appDesc: 'b', appDomain: 'c' }),
    ).rejects.toThrow('not-known');
  });
});

describe('keepRenewed', () => {
  it('renews five minutes before each expiry, naming the grant, and hands on each new token', async () => {
    const time = manualClock();
    const { plugin, signed } = fakePlugin();
    const { agent, renewals } = fakeAgent(time.now);
    const tokens: string[] = [];
    const renewal = keepRenewed({
      plugin,
      agent,
      url: URL_,
      session: session(time.now()),
      onToken: (t) => tokens.push(t),
      clock: time.clock,
    });

    expect(time.pending()).toEqual([3600_000 - RENEW_BEFORE_MS]);
    await time.advance(3600_000 - RENEW_BEFORE_MS - 1);
    expect(renewals).toHaveLength(0);

    await time.advance(1);
    expect(signed).toEqual([
      { purpose: 'renew', executor: EXECUTOR, url: URL_, challenge: 'challenge-1', grant: 'grant-1' },
    ]);
    expect(renewals[0].statement.grant).toBe('grant-1');
    expect(tokens).toEqual(['token-2']);
    expect(renewal.expiresAt()).toBe(Math.floor(time.now() / 1000) + 3600);

    // And again an hour on, from the renewed expiry.
    await time.advance(3600_000 - RENEW_BEFORE_MS);
    expect(tokens).toEqual(['token-2', 'token-3']);
    expect(signed.map((s) => s.challenge)).toEqual(['challenge-1', 'challenge-2']);
    renewal.stop();
  });

  it('tries a failed renewal again while the session has time, and says when it ran out', async () => {
    const time = manualClock();
    const { plugin } = fakePlugin();
    const fake = fakeAgent(time.now);
    const expired = vi.fn();
    const tokens: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fake.refuse(2);
    keepRenewed({
      plugin,
      agent: fake.agent,
      url: URL_,
      session: session(time.now()),
      onToken: (t) => tokens.push(t),
      onExpired: expired,
      clock: time.clock,
    });
    await time.advance(3600_000 - RENEW_BEFORE_MS);
    expect(time.pending()).toEqual([RETRY_MS]);
    await time.advance(RETRY_MS);
    expect(tokens).toEqual([]);
    await time.advance(RETRY_MS);
    expect(tokens).toEqual(['token-2']);
    expect(expired).not.toHaveBeenCalled();

    // Refused until the end: it stops, and says so.
    fake.refuse(1000);
    await time.advance(3600_000);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(time.pending()).toEqual([]);
  });

  it('asks nothing once stopped', async () => {
    const time = manualClock();
    const { plugin, signed } = fakePlugin();
    const { agent } = fakeAgent(time.now);
    const renewal = keepRenewed({
      plugin,
      agent,
      url: URL_,
      session: session(time.now()),
      onToken: () => {},
      clock: time.clock,
    });
    renewal.stop();
    await time.advance(2 * 3600_000);
    expect(signed).toEqual([]);
    expect(time.pending()).toEqual([]);
  });
});

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

  it('calls the identity flows by the names and with the options the Kotlin plugin reads', async () => {
    const calls: unknown[][] = [];
    const plugin = deviceKeyPlugin({
      isPluginAvailable: (name) => name === 'DeviceKey',
      nativePromise: async (...args) => {
        calls.push(args);
        return {};
      },
    })!;
    await plugin.startMake();
    await plugin.startRestore();
    await plugin.startRotate();
    await plugin.identityStep({ flow: 'f1', input: { input: 'confirm-words', first: 'apple', second: 'zoo' } });
    await plugin.identityStep({ flow: 'f1', input: { input: 'lock-out', keyIds: ['d1'], name: 'Phone' } });
    await plugin.identityCancel({ flow: 'f1' });
    await plugin.pendingIdentity();
    await plugin.finishPending();
    await plugin.retryMasterPushes();
    await plugin.setSecure({ on: true });
    expect(calls).toEqual([
      ['DeviceKey', 'startMake', {}],
      ['DeviceKey', 'startRestore', {}],
      ['DeviceKey', 'startRotate', {}],
      ['DeviceKey', 'identityStep', { flow: 'f1', input: { input: 'confirm-words', first: 'apple', second: 'zoo' } }],
      ['DeviceKey', 'identityStep', { flow: 'f1', input: { input: 'lock-out', keyIds: ['d1'], name: 'Phone' } }],
      ['DeviceKey', 'identityCancel', { flow: 'f1' }],
      ['DeviceKey', 'pendingIdentity', {}],
      ['DeviceKey', 'finishPending', {}],
      ['DeviceKey', 'retryMasterPushes', {}],
      ['DeviceKey', 'setSecure', { on: true }],
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
