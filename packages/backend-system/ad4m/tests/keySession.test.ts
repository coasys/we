/**
 * The key session, over a fake executor and a fake signer: what is signed, what the executor is asked,
 * and when a renewal happens. And the computer's signer, which has its own executor sign.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  executorSigner,
  keepRenewed,
  type KeySession,
  type KeySessionAgent,
  type KeySigner,
  loginWithDeviceKey,
  originOf,
  RENEW_BEFORE_MS,
  type RenewalClock,
  RETRY_MS,
  type SessionSignRequest,
  type SignedKeyStatement,
} from '../src/keySession';

const URL_ = 'http://127.0.0.1:12600';
const EXECUTOR = 'did:key:z6MkExecutor';
const SCID = 'did:scid:coasys:1:QmIdentity';

function fakeSigner() {
  const signed: SessionSignRequest[] = [];
  const signer: KeySigner = {
    signSession: async (request): Promise<SignedKeyStatement> => {
      signed.push(request);
      return {
        statement: {
          v: 1,
          purpose: request.purpose,
          scid: SCID,
          key: 'z6MkDevice',
          executor: request.executor,
          audience: originOf(request.url),
          challenge: request.challenge,
          client: { kind: 'native' },
          ...(request.grant ? { grant: request.grant } : {}),
          issuedAt: 1,
        },
        sig: `z-signed-${signed.length}`,
      };
    },
  };
  return { signer, signed };
}

function fakeAgent(now: () => number) {
  let challenges = 0;
  const logins: { proof: SignedKeyStatement; app: unknown }[] = [];
  const renewals: SignedKeyStatement[] = [];
  let refuseRenewals = 0;
  const agent = {
    sessionChallenge: async () => ({ challenge: `challenge-${++challenges}`, executor: EXECUTOR, expiresAt: 0 }),
    loginWithKey: async (proof: SignedKeyStatement, app: unknown) => {
      logins.push({ proof, app });
      return session(now());
    },
    renewSession: async (proof: SignedKeyStatement) => {
      if (refuseRenewals > 0) {
        refuseRenewals--;
        throw new Error('store-unavailable');
      }
      renewals.push(proof);
      return { token: `token-${renewals.length + 1}`, expiresAt: Math.floor(now() / 1000) + 3600 };
    },
  } as unknown as KeySessionAgent;
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
    role: 'tenant',
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
    const { signer, signed } = fakeSigner();
    const { agent, logins } = fakeAgent(() => 0);
    const app = { appName: 'WE', appDesc: 'd', appDomain: 'ad4m.weco.io' };

    const result = await loginWithDeviceKey(signer, agent, URL_, app);

    expect(signed).toEqual([{ purpose: 'login', executor: EXECUTOR, url: URL_, challenge: 'challenge-1' }]);
    expect(logins).toHaveLength(1);
    expect(logins[0].proof.statement.audience).toBe(URL_);
    expect(logins[0].proof.statement.grant).toBeUndefined();
    expect(logins[0].app).toBe(app);
    expect(result.grantId).toBe('grant-1');
  });

  it('passes a refusal on, so the connector can fall back', async () => {
    const { signer } = fakeSigner();
    const { agent } = fakeAgent(() => 0);
    (agent as { loginWithKey: unknown }).loginWithKey = async () => {
      throw new Error('not-known');
    };
    await expect(
      loginWithDeviceKey(signer, agent, URL_, { appName: 'a', appDesc: 'b', appDomain: 'c' }),
    ).rejects.toThrow('not-known');
  });
});

describe('keepRenewed', () => {
  it('renews five minutes before each expiry, naming the grant, and hands on each new token', async () => {
    const time = manualClock();
    const { signer, signed } = fakeSigner();
    const { agent, renewals } = fakeAgent(time.now);
    const tokens: string[] = [];
    const renewal = keepRenewed({
      signer,
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
    const { signer } = fakeSigner();
    const fake = fakeAgent(time.now);
    const expired = vi.fn();
    const tokens: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fake.refuse(2);
    keepRenewed({
      signer,
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
    const { signer, signed } = fakeSigner();
    const { agent } = fakeAgent(time.now);
    const renewal = keepRenewed({
      signer,
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

describe('originOf', () => {
  it('is the origin the executor checks: ws as http, default ports and paths left out', () => {
    expect(originOf('https://Cloud.Example.org/rpc?x=1')).toBe('https://cloud.example.org');
    expect(originOf('wss://cloud.example.org:443')).toBe('https://cloud.example.org');
    expect(originOf('ws://127.0.0.1:12600/ws')).toBe('http://127.0.0.1:12600');
    expect(originOf('http://127.0.0.1:80')).toBe('http://127.0.0.1');
  });

  it('refuses what is not a URL', () => {
    expect(() => originOf('not a url')).toThrow();
  });
});

describe('executorSigner', () => {
  it('has this computer’s executor sign a native statement for the host it dials', async () => {
    const asked: unknown[] = [];
    const answer = { statement: { v: 1 }, sig: 'zSig' } as unknown as SignedKeyStatement;
    const signer = executorSigner(
      {
        signSessionStatement: async (statement: unknown) => {
          asked.push(statement);
          return answer;
        },
      } as never,
      () => 1_700_000_123_456,
    );

    const login = await signer.signSession({
      purpose: 'login',
      executor: EXECUTOR,
      url: 'https://Cloud.example.org/',
      challenge: 'c1',
    });
    await signer.signSession({
      purpose: 'renew',
      executor: EXECUTOR,
      url: 'https://cloud.example.org',
      challenge: 'c2',
      grant: 'g1',
    });

    expect(login).toBe(answer);
    expect(asked).toEqual([
      {
        v: 1,
        purpose: 'login',
        executor: EXECUTOR,
        audience: 'https://cloud.example.org',
        challenge: 'c1',
        client: { kind: 'native' },
        issuedAt: 1_700_000_123,
      },
      {
        v: 1,
        purpose: 'renew',
        executor: EXECUTOR,
        audience: 'https://cloud.example.org',
        challenge: 'c2',
        client: { kind: 'native' },
        grant: 'g1',
        issuedAt: 1_700_000_123,
      },
    ]);
  });
});
