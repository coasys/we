/**
 * A key session against fake executors: this computer's, which signs, and a server, which hands out
 * challenges, checks statements, renews grants and ends them the way the real one does — a refusal
 * is an `RpcError`-shaped rejection with the executor's word as its body.
 */
import type { SignedKeyStatement, UnsignedKeyStatement } from '@coasys/ad4m';
import { THIS_COMPUTER_ID } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { type Ad4mServerHost, createAd4mIdentityPort } from './identityPort';
import {
  type ConnectRemote,
  describeRefusal,
  KeySessionError,
  type KeySessionRemote,
  normalizeServerAddress,
  openKeySession,
  refusalReason,
  tokenSocket,
  tryKeyLogin,
  withToken,
} from './keySession';
import { createLocalAd4mConnector } from './localExecutor';

const SCID = 'did:scid:coasys:1:QmPerson';
const SERVER = 'did:key:z6MkServer';
const ADDRESS = 'http://127.0.0.1:12100';

class FakeRpcError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`RPC error ${status}: ${body}`);
  }
}

/** This computer's executor: signs with its device key, as `scid`. */
function fakeSigner(key = 'z6MkDevice') {
  const signed: UnsignedKeyStatement[] = [];
  return {
    signed,
    agent: {
      signSessionStatement: vi.fn(async (statement: UnsignedKeyStatement): Promise<SignedKeyStatement> => {
        signed.push(statement);
        return { statement: { ...statement, scid: SCID, key }, sig: `sig-by-${key}` };
      }),
    },
  };
}

/** A server whose operator is SCID, unless `role` says otherwise. */
function fakeServer(
  options: { role?: 'operator' | 'tenant'; down?: boolean; notKnown?: boolean; origin?: string } = {},
) {
  const origin = options.origin ?? ADDRESS;
  let clock = Math.floor(Date.now() / 1000);
  let nextChallenge = 0;
  let nextToken = 0;
  const challenges = new Set<string>();
  const tokens = new Map<string, string>(); // token → grant
  const grants = new Set<string>();
  const revokedKeys = new Set<string>();
  const clients: {
    token: (() => string) | null;
    /** What the SDK's HTTP side holds (`ApiClient.getToken()`): set at dial, moved only by `setToken`. */
    httpToken: string | null;
    closed: boolean;
    authFailed: ((r: string) => void)[];
  }[] = [];
  const loggedOut: string[] = [];

  const check = ({ statement }: SignedKeyStatement) => {
    if (!challenges.delete(statement.challenge)) throw new FakeRpcError(403, 'challenge');
    if (statement.executor !== SERVER) throw new FakeRpcError(403, 'audience');
    // The executor half of the relay fix (ad4m#1617): a statement for another origin is refused.
    if (statement.audience !== origin) throw new FakeRpcError(403, 'audience');
    if (revokedKeys.has(statement.key)) throw new FakeRpcError(403, 'key');
    if (options.notKnown) throw new FakeRpcError(403, 'not-known');
  };
  const issue = (grant: string) => {
    const token = `token-${++nextToken}`;
    tokens.set(token, grant);
    return token;
  };

  const connect = (address: string, token?: () => string): KeySessionRemote => {
    expect(address).toBe(origin);
    const state = {
      token: token ?? null,
      httpToken: token ? token() : null,
      closed: false,
      authFailed: [] as ((r: string) => void)[],
    };
    clients.push(state);
    const live = () => {
      const grant = state.token ? tokens.get(state.token()) : undefined;
      if (!grant || !grants.has(grant)) throw new FakeRpcError(401, 'token expired or revoked');
      return grant;
    };
    return {
      agent: {
        sessionChallenge: async () => {
          if (options.down) throw new FakeRpcError(503, 'connection failed');
          const challenge = `ch-${++nextChallenge}`;
          challenges.add(challenge);
          return { challenge, executor: SERVER, expiresAt: clock + 60 };
        },
        loginWithKey: async (proof) => {
          check(proof);
          const grant = `grant-${grants.size + 1}-${nextToken}`;
          grants.add(grant);
          return {
            token: issue(grant),
            expiresAt: clock + 3600,
            grantId: grant,
            role: options.role ?? 'operator',
            did: 'did:key:z6MkAgent',
            scid: SCID,
          };
        },
        renewSession: async (proof) => {
          const grant = live();
          check(proof);
          if (proof.statement.grant !== grant) throw new FakeRpcError(403, 'grant');
          return { token: issue(grant), expiresAt: clock + 3600 };
        },
        logout: async () => {
          const grant = live();
          grants.delete(grant);
          loggedOut.push(grant);
          return true;
        },
      },
      // The SDK client's event subscription, which the ports open over the session's client.
      ...{ on: () => () => {} },
      setToken: (next: string) => {
        state.httpToken = next;
      },
      onAuthFailed: (callback) => {
        state.authFailed.push(callback);
        return () => {};
      },
      close: () => {
        state.closed = true;
      },
    };
  };

  return {
    connect,
    clients,
    grants,
    loggedOut,
    tokens,
    now: () => clock,
    advance: (seconds: number) => {
      clock += seconds;
    },
    /** The person revokes the device key: its grants end and its sockets close with 1008. */
    revoke(key: string) {
      revokedKeys.add(key);
      grants.clear();
      for (const client of clients)
        if (client.token && !client.closed) client.authFailed.forEach((cb) => cb('revoked'));
    },
    /** The key is revoked, and nothing has told this session yet: its grant still answers. */
    revokeKeyOnly(key: string) {
      revokedKeys.add(key);
    },
    /** The grant ends some other way (logged out everywhere from another device). */
    endGrants() {
      grants.clear();
      for (const client of clients)
        if (client.token && !client.closed) client.authFailed.forEach((cb) => cb('revoked'));
    },
  };
}

/** Timers the test runs by hand. */
function fakeTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  return {
    pending,
    setTimer: (run: () => void, ms: number) => {
      pending.set(++next, { run, ms });
      return next;
    },
    clearTimer: (id: unknown) => {
      pending.delete(id as number);
    },
    /** Runs the one pending timer, returning the delay it was set for. */
    async fire() {
      expect(pending.size).toBe(1);
      const [[id, timer]] = [...pending];
      pending.delete(id);
      timer.run();
      await flush();
      return timer.ms;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function open(server: ReturnType<typeof fakeServer>, signer = fakeSigner(), timers = fakeTimers()) {
  return openKeySession(signer, ADDRESS, {
    connect: server.connect,
    now: server.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
}

describe('a key session on a server', () => {
  it('logs in with a statement this computer signs for the server’s challenge', async () => {
    const server = fakeServer();
    const signer = fakeSigner();
    const session = await open(server, signer);

    expect(signer.signed).toEqual([
      {
        v: 1,
        purpose: 'login',
        executor: SERVER,
        audience: ADDRESS,
        challenge: 'ch-1',
        client: { kind: 'native' },
        issuedAt: server.now(),
      },
    ]);
    expect(session.role).toBe('operator');
    expect(session.scid).toBe(SCID);
    expect(session.token()).toBe('token-1');
    // The anonymous client the login used is closed; the session's client carries the token.
    expect(server.clients[0].closed).toBe(true);
    expect(server.clients[1].token?.()).toBe('token-1');
  });

  it('calls a session on a server it does not run an agent one', async () => {
    const session = await open(fakeServer({ role: 'tenant' }));
    expect(session.role).toBe('agent');
  });

  it('renews before the hour is up, naming its grant, and the next dial carries the new token', async () => {
    const server = fakeServer();
    const signer = fakeSigner();
    const timers = fakeTimers();
    const session = await open(server, signer, timers);
    const grant = [...server.grants][0];

    // Renewal is set for five minutes before the token runs out.
    expect([...timers.pending.values()][0].ms).toBe((3600 - 300) * 1000);
    server.advance(3300);
    await timers.fire();

    expect(signer.signed[1]).toMatchObject({
      purpose: 'renew',
      grant,
      executor: SERVER,
      audience: ADDRESS,
      challenge: 'ch-2',
    });
    expect(session.token()).toBe('token-2');
    expect(session.expiresAt()).toBe(server.now() + 3600);
    expect(server.clients[1].token?.()).toBe('token-2');
    // The HTTP side (the transcription stream's header) is moved too, not left on the first token.
    expect(server.clients[1].httpToken).toBe('token-2');
    // And the next one is scheduled from the new expiry.
    expect([...timers.pending.values()][0].ms).toBe((3600 - 300) * 1000);
  });

  it('tries a failed renewal again while the token lasts, and ends the session once it cannot', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const session = await open(server, fakeSigner(), timers);
    const ended = vi.fn();
    session.onEnded(ended);

    // The server is restarting: renewing fails with no reason of the executor's.
    server.advance(3300);
    const failing = (session.client as KeySessionRemote).agent;
    const real = failing.sessionChallenge;
    failing.sessionChallenge = async () => {
      throw new FakeRpcError(503, 'connection failed');
    };
    expect(await timers.fire()).toBe(3300 * 1000);
    expect([...timers.pending.values()][0].ms).toBe(60 * 1000);
    expect(ended).not.toHaveBeenCalled();

    // Back before the token runs out: the retry renews.
    failing.sessionChallenge = real;
    server.advance(60);
    await timers.fire();
    expect(session.token()).toBe('token-2');
    expect(ended).not.toHaveBeenCalled();

    // Down again, late: 50 s of token left by this clock. The other clock may differ by the
    // tolerated skew (120 s), so the session keeps trying at the usual interval while that fits.
    failing.sessionChallenge = async () => {
      throw new FakeRpcError(503, 'connection failed');
    };
    server.advance(3550);
    await timers.fire();
    expect(ended).not.toHaveBeenCalled();
    expect([...timers.pending.values()][0].ms).toBe(60 * 1000);

    // 110 s of the skew left: once more at the interval, then halfway each time (50 s left: 25 s),
    // until none of the skew is left either, and it ends.
    server.advance(60);
    await timers.fire();
    expect([...timers.pending.values()][0].ms).toBe(60 * 1000);
    server.advance(60);
    await timers.fire();
    expect(ended).not.toHaveBeenCalled();
    expect([...timers.pending.values()][0].ms).toBe(25 * 1000);
    for (let tries = 0; tries < 10 && timers.pending.size > 0; tries++) {
      server.advance([...timers.pending.values()][0].ms / 1000);
      await timers.fire();
    }
    expect(ended).toHaveBeenCalledWith('ended');
    expect(timers.pending.size).toBe(0);
  });

  it('keeps retrying while the server’s token lasts when the server’s clock is behind ours', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    // This computer's clock is 90 s ahead of the server's.
    const session = await openKeySession(fakeSigner(), ADDRESS, {
      connect: server.connect,
      now: () => server.now() + 90,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const ended = vi.fn();
    session.onEnded(ended);
    const agent = (session.client as KeySessionRemote).agent;
    const real = agent.sessionChallenge;
    agent.sessionChallenge = async () => {
      throw new FakeRpcError(503, 'connection failed');
    };

    // By our clock the token ran out 10 s ago; by the server's it has 80 s left.
    const expiresAt = session.expiresAt();
    server.advance(expiresAt - server.now() - 80);
    await timers.fire();
    expect(ended).not.toHaveBeenCalled();
    const delay = [...timers.pending.values()][0].ms / 1000;
    expect(delay).toBe(60);

    // The server is back at the retry, which falls while its token still lasts (20 s left).
    agent.sessionChallenge = real;
    server.advance(delay);
    expect(server.now()).toBeLessThan(expiresAt);
    await timers.fire();
    expect(session.token()).toBe('token-2');
    expect(ended).not.toHaveBeenCalled();
  });

  it('ends a session once even a skewed clock cannot leave it any token', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const session = await openKeySession(fakeSigner(), ADDRESS, {
      connect: server.connect,
      now: () => server.now() + 90,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const ended = vi.fn();
    session.onEnded(ended);
    (session.client as KeySessionRemote).agent.sessionChallenge = async () => {
      throw new FakeRpcError(503, 'connection failed');
    };
    server.advance(session.expiresAt() - server.now() + 100);
    await timers.fire();
    expect(ended).toHaveBeenCalledWith('ended');
  });

  it('does not let a second close() return before the first one’s logout settles', async () => {
    const server = fakeServer();
    const session = await open(server);
    const agent = (session.client as KeySessionRemote).agent;
    let release!: () => void;
    agent.logout = () => new Promise<boolean>((resolve) => (release = () => resolve(true)));

    const first = session.close();
    let secondDone = false;
    const second = session.close().then(() => (secondDone = true));
    await flush();
    expect(secondDone).toBe(false);

    release();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
  });

  it('renews on the final try before the expiry when the server is back', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const session = await open(server, fakeSigner(), timers);
    const ended = vi.fn();
    session.onEnded(ended);
    const agent = (session.client as KeySessionRemote).agent;
    const real = agent.sessionChallenge;
    agent.sessionChallenge = async () => {
      throw new FakeRpcError(503, 'connection failed');
    };
    server.advance(3590);
    await timers.fire();
    expect(ended).not.toHaveBeenCalled();

    agent.sessionChallenge = real;
    server.advance(5);
    await timers.fire();
    expect(session.token()).toBe('token-2');
    expect(ended).not.toHaveBeenCalled();
  });

  it('reads a renewal the server answers 401 as ended or revoked by asking, not as ended at once', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const session = await open(server, fakeSigner('z6MkDevice'), timers);
    const ended = vi.fn();
    session.onEnded(ended);

    // The grant is gone and the key removed, and no socket told this session: the renewal gets a 401.
    server.grants.clear();
    server.revokeKeyOnly('z6MkDevice');
    server.advance(3300);
    await timers.fire();
    await flush();
    await flush();

    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith('revoked');
  });

  it('does not read a 401 from this computer’s signer as a refused token, and tries the renewal again', async () => {
    const server = fakeServer();
    const signer = fakeSigner();
    const timers = fakeTimers();
    const session = await open(server, signer, timers);
    const ended = vi.fn();
    session.onEnded(ended);
    const grant = [...server.grants][0];

    signer.agent.signSessionStatement.mockRejectedValueOnce(new FakeRpcError(401, 'unauthorized'));
    server.advance(3300);
    await timers.fire();
    await flush();
    await flush();

    // No probe: the signer was asked for the login and the failed renewal only, and the session lives.
    expect(signer.agent.signSessionStatement).toHaveBeenCalledTimes(2);
    expect(ended).not.toHaveBeenCalled();
    expect(server.grants.has(grant)).toBe(true);
    expect(timers.pending.size).toBe(1);
  });

  it('sends no probe login when closed while the probe’s statement is signed', async () => {
    const server = fakeServer();
    const signer = fakeSigner();
    const session = await open(server, signer);
    const ended = vi.fn();
    session.onEnded(ended);
    const tokensBefore = server.tokens.size;

    let sign!: () => void;
    const signNow = signer.agent.signSessionStatement.getMockImplementation()!;
    signer.agent.signSessionStatement.mockImplementationOnce(
      (statement) => new Promise((resolve) => (sign = () => resolve(signNow(statement)))),
    );
    // The server ends the grant: the socket reports a refused token, which starts the probe.
    server.endGrants();
    await vi.waitFor(() => expect(signer.agent.signSessionStatement).toHaveBeenCalledTimes(2));

    // close() waits for the probe, so the statement is signed while it is closing.
    const closing = session.close();
    sign();
    await closing;

    // The probe never sent its login: no grant exists, none was issued, nobody was told it ended.
    expect(server.tokens.size).toBe(tokensBefore);
    expect(server.grants.size).toBe(0);
    expect(ended).not.toHaveBeenCalled();
  });

  it('waits, when closed, for a probe login already sent, and logs that grant out before it returns', async () => {
    const server = fakeServer();
    let held = false;
    let land!: () => void;
    // The probe's login is in flight when close() runs: the server answers only once `land` is called.
    const connect: typeof server.connect = (address, token) => {
      const remote = server.connect(address, token);
      if (token || !held) return remote;
      const login = remote.agent.loginWithKey;
      remote.agent.loginWithKey = (proof, app) =>
        new Promise((resolve, reject) => (land = () => login(proof, app).then(resolve, reject)));
      return remote;
    };
    const session = await openKeySession(fakeSigner(), ADDRESS, { connect, now: server.now, ...fakeTimers() });
    held = true;

    server.endGrants();
    await vi.waitFor(() => expect(land).toBeDefined());
    let closed = false;
    const closing = session.close().then(() => (closed = true));
    await flush();
    expect(closed).toBe(false);

    land();
    await closing;

    // The probe's grant was issued and logged out before close() returned: none is left open.
    expect(server.grants.size).toBe(0);
    expect(server.loggedOut).toHaveLength(1);
  });

  it('waits for a probe in flight even when the session already ended on its own', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    let held = false;
    let land!: () => void;
    const connect: typeof server.connect = (address, token) => {
      const remote = server.connect(address, token);
      if (token) {
        // The server says the grant is gone when the session renews: the session ends itself.
        remote.agent.renewSession = () => Promise.reject(new FakeRpcError(403, 'grant'));
        return remote;
      }
      if (!held) return remote;
      const login = remote.agent.loginWithKey;
      remote.agent.loginWithKey = (proof, app) =>
        new Promise((resolve, reject) => (land = () => login(proof, app).then(resolve, reject)));
      return remote;
    };
    const session = await openKeySession(fakeSigner(), ADDRESS, { connect, now: server.now, ...timers });
    const ended = vi.fn();
    session.onEnded(ended);
    held = true;

    server.endGrants();
    await vi.waitFor(() => expect(land).toBeDefined());
    await timers.fire();
    expect(ended).toHaveBeenCalledWith('ended');

    let closed = false;
    const closing = session.close().then(() => (closed = true));
    await flush();
    expect(closed).toBe(false);

    land();
    await closing;
    expect(server.grants.size).toBe(0);
    expect(server.loggedOut).toHaveLength(1);
  });

  it('gives up waiting for a server that does not answer the logout, so a switch is not held up', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const connect: typeof server.connect = (address, token) => {
      const remote = server.connect(address, token);
      if (token) remote.agent.logout = () => new Promise(() => {});
      return remote;
    };
    const session = await openKeySession(fakeSigner(), ADDRESS, { connect, now: server.now, ...timers });

    let closed = false;
    const closing = session.close().then(() => (closed = true));
    await flush();
    expect(closed).toBe(false);

    expect(await timers.fire()).toBe(5000);
    await closing;
    expect(server.clients[1].closed).toBe(true);
  });

  it('tells every listener, and closes its client, even when one listener throws', async () => {
    const server = fakeServer();
    const session = await open(server);
    const first = vi.fn(() => {
      throw new Error('listener failed');
    });
    const second = vi.fn();
    session.onEnded(first);
    session.onEnded(second);

    server.revokeKeyOnly('z6MkDevice');
    server.endGrants();
    await flush();
    await flush();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('revoked');
    expect(server.clients[1].closed).toBe(true);
  });

  it('logs out on the server when closed, and says nothing ended', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const session = await open(server, fakeSigner(), timers);
    const ended = vi.fn();
    session.onEnded(ended);
    const grant = [...server.grants][0];

    await session.close();

    expect(server.loggedOut).toEqual([grant]);
    expect(server.grants.size).toBe(0);
    expect(server.clients[1].closed).toBe(true);
    expect(timers.pending.size).toBe(0);
    expect(ended).not.toHaveBeenCalled();
  });

  it('sends no renewal when closed while the renewal statement is signed', async () => {
    const server = fakeServer();
    const signer = fakeSigner();
    const timers = fakeTimers();
    const session = await open(server, signer, timers);
    const remote = (session.client as KeySessionRemote).agent;
    const renewSession = vi.spyOn(remote, 'renewSession');

    // The renewal's statement waits on this computer's executor.
    let sign!: () => void;
    const signNow = signer.agent.signSessionStatement.getMockImplementation()!;
    signer.agent.signSessionStatement.mockImplementationOnce(
      (statement) => new Promise((resolve) => (sign = () => resolve(signNow(statement)))),
    );
    server.advance(3300);
    const firing = timers.fire();
    await vi.waitFor(() => expect(signer.agent.signSessionStatement).toHaveBeenCalledTimes(2));

    await firing;
    await session.close();
    sign();
    await flush();

    expect(renewSession).not.toHaveBeenCalled();
    expect(timers.pending.size).toBe(0);
  });

  it('reads a socket closed on a revoked device as this device removed', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const session = await open(server, fakeSigner('z6MkDevice'), timers);
    const ended = vi.fn();
    session.onEnded(ended);

    server.revoke('z6MkDevice');
    await flush();
    await flush();

    expect(ended).toHaveBeenCalledWith('revoked');
    expect(server.clients[1].closed).toBe(true);
    expect(timers.pending.size).toBe(0);
  });

  it('asks which way with the origin, not the address as typed, so a revoked device reads as removed', async () => {
    // The session was opened with an address the person typed, with a path and upper case; the
    // server knows only the origin as its audience. The probe after a refused token must dial and
    // sign for that origin, as the login did, or the server's `audience` refusal hides the `key` one.
    const server = fakeServer({ origin: 'https://home.example' });
    const timers = fakeTimers();
    const session = await openKeySession(fakeSigner('z6MkDevice'), 'HTTPS://Home.Example:443/x', {
      connect: server.connect,
      now: server.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const ended = vi.fn();
    session.onEnded(ended);

    server.revoke('z6MkDevice');
    await flush();
    await flush();

    expect(ended).toHaveBeenCalledWith('revoked');
    expect(server.clients.map((client) => client.closed)).toEqual([true, true, true]);
  });

  it('reads a session ended from elsewhere as ended, and leaves no grant of its own asking', async () => {
    const server = fakeServer();
    const session = await open(server);
    const ended = vi.fn();
    session.onEnded(ended);

    server.endGrants();
    await flush();
    await flush();

    expect(ended).toHaveBeenCalledWith('ended');
    // The login that asked was logged straight out.
    expect(server.grants.size).toBe(0);
  });

  it('ends as revoked when a renewal is refused for the key', async () => {
    const server = fakeServer();
    const timers = fakeTimers();
    const session = await open(server, fakeSigner('z6MkDevice'), timers);
    const ended = vi.fn();
    session.onEnded(ended);

    // Revoked while the socket happened to be down: the renewal is what finds out.
    server.revokeKeyOnly('z6MkDevice');
    server.advance(3300);
    await timers.fire();

    expect(ended).toHaveBeenCalledWith('revoked');
  });

  it('refuses with the server’s reason in words a person reads', async () => {
    const server = fakeServer();
    server.revoke('z6MkDevice');
    const error = await open(server).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeySessionError);
    expect((error as KeySessionError).reason).toBe('key');
    expect((error as KeySessionError).message).toMatch(/removed/);
  });

  it('calls a server that does not answer unreachable', async () => {
    const error = await open(fakeServer({ down: true })).catch((e: unknown) => e);
    expect((error as KeySessionError).reason).toBe('unreachable');
  });

  it('names the origin it dialled as the audience, whatever executor the server’s challenge names', async () => {
    // A server relaying the person's real server's challenge and DID: the statement still names
    // the origin this computer dialled, so the real server refuses it as not addressed to it.
    const RELAY = 'https://relay.example:8443';
    const signer = fakeSigner();
    const dialled: string[] = [];
    const relay = (address: string): KeySessionRemote => {
      dialled.push(address);
      return {
        agent: {
          sessionChallenge: async () => ({ challenge: 'ch-real', executor: SERVER, expiresAt: 0 }),
          loginWithKey: async () => {
            throw new FakeRpcError(403, 'audience');
          },
          renewSession: async () => ({ token: '', expiresAt: 0 }),
          logout: async () => true,
        },
        onAuthFailed: () => () => {},
        setToken: () => {},
        close: () => {},
      };
    };

    const error = await tryKeyLogin(signer, 'HTTPS://Relay.Example:8443/api', { connect: relay }).catch(
      (e: unknown) => e,
    );
    expect((error as KeySessionError).reason).toBe('audience');
    expect(dialled).toEqual([RELAY]);
    expect(signer.signed).toEqual([expect.objectContaining({ executor: SERVER, audience: RELAY })]);
  });

  it('gives a server that relays a login to the person’s real server no token there', async () => {
    // The attacker's server answers with the real server's challenge (and so its DID), and hands
    // the signed statement on: the statement names the attacker's origin, which the real refuses.
    const EVIL = 'https://evil.example';
    const real = fakeServer();
    const signer = fakeSigner();
    const relay = (address: string): KeySessionRemote => {
      expect(address).toBe(EVIL);
      const onward = real.connect(ADDRESS);
      return { ...onward, close: () => {} };
    };

    const error = await tryKeyLogin(signer, EVIL, { connect: relay }).catch((e: unknown) => e);
    expect((error as KeySessionError).reason).toBe('audience');
    expect((error as KeySessionError).message).toBe(
      "The host doesn't list https://evil.example as its address. Whoever runs it can add it with --public-origin.",
    );
    expect(signer.signed).toEqual([expect.objectContaining({ executor: SERVER, audience: EVIL })]);
    expect(real.tokens.size).toBe(0);
    expect(real.grants.size).toBe(0);
  });

  it('gives a server that relays a renewal to the person’s real server no token there', async () => {
    const EVIL = 'https://evil.example';
    const real = fakeServer();
    const own = fakeServer({ origin: EVIL });
    // The attacker holds a session of its own on the real server, to pass the renewal through.
    const attacker = await openKeySession(fakeSigner('z6MkAttacker'), ADDRESS, {
      connect: real.connect,
      now: real.now,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    const onward = real.connect(ADDRESS, () => attacker.token());
    const issued = real.tokens.size;

    // It lets this computer in itself, then relays the real server's challenge at renewal.
    let relaying = false;
    const relay = (address: string, token?: () => string): KeySessionRemote => {
      const mine = own.connect(address, token);
      return {
        ...mine,
        agent: {
          ...mine.agent,
          sessionChallenge: () => (relaying ? onward.agent.sessionChallenge() : mine.agent.sessionChallenge()),
          renewSession: (proof) => (relaying ? onward.agent.renewSession(proof) : mine.agent.renewSession(proof)),
        },
      };
    };
    const signer = fakeSigner();
    const timers = fakeTimers();
    const session = await openKeySession(signer, EVIL, {
      connect: relay,
      now: own.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    relaying = true;
    await timers.fire();

    expect(signer.signed.at(-1)).toMatchObject({ purpose: 'renew', executor: SERVER, audience: EVIL });
    expect(real.tokens.size).toBe(issued);
    expect(session.token()).toBe('token-1');
    await session.close();
    await attacker.close();
  });

  it('refuses plain http to another computer before anything is signed or dialled', async () => {
    const signer = fakeSigner();
    const connect = vi.fn();
    for (const address of ['http://192.168.1.20:12000', 'http://my-server.example:12000']) {
      const error = await openKeySession(signer, address, { connect }).catch((e: unknown) => e);
      expect((error as KeySessionError).reason).toBe('insecure');
      const tried = await tryKeyLogin(signer, address, { connect }).catch((e: unknown) => e);
      expect((tried as KeySessionError).reason).toBe('insecure');
    }
    expect(signer.agent.signSessionStatement).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('reports a trial login whose logout cannot be confirmed, and still closes its client', async () => {
    const server = fakeServer();
    for (const failure of ['rejects', 'false'] as const) {
      const closeCalls = vi.fn();
      const wrapped: ConnectRemote = (address, token) => {
        const remote = server.connect(address, token);
        if (token) {
          remote.agent.logout = async () => {
            if (failure === 'rejects') throw new Error('socket closed');
            return false;
          };
          const close = remote.close.bind(remote);
          remote.close = () => {
            closeCalls();
            close();
          };
        }
        return remote;
      };
      const error = await tryKeyLogin(fakeSigner(), ADDRESS, { connect: wrapped, now: server.now }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(KeySessionError);
      expect((error as KeySessionError).reason).toBe('logout');
      expect((error as KeySessionError).message).toMatch(/didn't close/);
      expect(closeCalls).toHaveBeenCalledTimes(1);
    }
  });

  it('tries a login and logs straight out', async () => {
    const server = fakeServer();
    const role = await tryKeyLogin(fakeSigner(), ADDRESS, { connect: server.connect, now: server.now });
    expect(role).toBe('operator');
    expect(server.grants.size).toBe(0);
    expect(server.loggedOut).toHaveLength(1);
    expect(server.clients.every((client) => client.closed)).toBe(true);
  });
});

describe('reading a refusal', () => {
  it('takes the executor’s word from the body', () => {
    expect(refusalReason(new FakeRpcError(403, 'not-known'))).toBe('not-known');
    expect(refusalReason(new FakeRpcError(403, 'local-only: signSessionStatement'))).toBe('local-only');
    expect(refusalReason(new FakeRpcError(503, 'store-unavailable'))).toBe('store-unavailable');
    expect(refusalReason(new Error('RPC error 403: grant'))).toBe('grant');
  });

  // A server with no `public_origins` set, the usual first remote setup.
  it('tells a server with no public origin how to set one', () => {
    const reason = refusalReason(new FakeRpcError(403, 'no-public-origin: set public_origins (--public-origin)'));
    expect(reason).toBe('no-public-origin');
    expect(describeRefusal(reason, 'https://home.example')).toMatch(
      /doesn't list https:\/\/home\.example as its address\. Whoever runs it can add it with --public-origin/,
    );
  });

  // A network listener with no public origins rejects the challenge itself.
  it('gives a challenge refused with no audience the same --public-origin guidance', () => {
    const reason = refusalReason(new FakeRpcError(403, 'no-audience: listener has no public origins'));
    expect(reason).toBe('no-audience');
    expect(describeRefusal(reason, 'https://home.example')).toMatch(/can add it with --public-origin/);
  });

  it('calls a failure with no word of the executor’s unreachable or refused', () => {
    expect(refusalReason(new FakeRpcError(503, 'connection failed'))).toBe('unreachable');
    expect(refusalReason(new TypeError('fetch failed'))).toBe('unreachable');
    expect(refusalReason(new FakeRpcError(500, 'boom'))).toBe('refused');
  });
});

describe('a server’s address', () => {
  it('keeps the origin, adding https:// when none is given', () => {
    expect(normalizeServerAddress('192.168.1.20:12000')).toBe('https://192.168.1.20:12000');
    expect(normalizeServerAddress('my-server.example:12000')).toBe('https://my-server.example:12000');
    expect(normalizeServerAddress('https://Home.Example:443/x')).toBe('https://home.example');
    expect(normalizeServerAddress(' https://home.example/ ')).toBe('https://home.example');
    expect(normalizeServerAddress('http://localhost:12100/api/v1')).toBe('http://localhost:12100');
  });

  it('refuses what is not an http address', () => {
    expect(() => normalizeServerAddress('ftp://x')).toThrow(KeySessionError);
    expect(() => normalizeServerAddress('http://')).toThrow(KeySessionError);
  });

  it('allows plain http only to this computer', () => {
    expect(normalizeServerAddress('http://127.0.0.1:12100')).toBe('http://127.0.0.1:12100');
    expect(normalizeServerAddress('http://127.8.9.10:1')).toBe('http://127.8.9.10:1');
    expect(normalizeServerAddress('http://[::1]:12100')).toBe('http://[::1]:12100');
    expect(normalizeServerAddress('http://LOCALHOST:12100')).toBe('http://localhost:12100');
    for (const address of [
      'http://192.168.1.20:12000',
      'http://my-server.example:12000',
      'http://localhost.evil.example',
      'http://127.0.0.1.evil.example',
      'http://[::2]:1',
    ]) {
      expect(() => normalizeServerAddress(address)).toThrow(
        expect.objectContaining({ reason: 'insecure', message: expect.stringMatching(/https:\/\//) }),
      );
    }
  });
});

describe('the session’s socket', () => {
  it('dials with the token current at each dial', () => {
    expect(withToken('ws://h:1/api/v1/ws?token=old', 'new')).toBe('ws://h:1/api/v1/ws?token=new');
    expect(withToken('ws://h:1/api/v1/ws', 'a b')).toBe('ws://h:1/api/v1/ws?token=a+b');

    const dialled: string[] = [];
    const original = globalThis.WebSocket;
    globalThis.WebSocket = class {
      constructor(url: string) {
        dialled.push(url);
      }
    } as unknown as typeof WebSocket;
    try {
      let token = 'one';
      const Socket = tokenSocket(() => token);
      new Socket('ws://h:1/api/v1/ws?token=one');
      token = 'two';
      new Socket('ws://h:1/api/v1/ws?token=one');
    } finally {
      globalThis.WebSocket = original;
    }
    expect(dialled).toEqual(['ws://h:1/api/v1/ws?token=one', 'ws://h:1/api/v1/ws?token=two']);
  });
});

/** The host's list of servers, kept in memory: a desktop host keeps it in its account registry. */
function fakeHost(servers: { address: string; name: string }[] = [], serving: string | null = null) {
  const state = { servers: [...servers], serving };
  const host: Ad4mServerHost & { state: typeof state } = {
    state,
    list: async () => ({ servers: [...state.servers], serving: state.serving }),
    add: vi.fn(async (server: { address: string; name: string }) => {
      state.servers.push(server);
    }),
    remove: vi.fn(async (address: string) => {
      state.servers = state.servers.filter((server) => server.address !== address);
    }),
    choose: vi.fn(async (address: string | null) => {
      state.serving = address;
    }),
    restart: vi.fn(async () => {}),
  };
  return host;
}

/** This computer's executor: its identity reads, and the device key that signs. */
function fakeLocal(did: string | null = SCID, key = 'z6MkDevice') {
  const signer = fakeSigner(key);
  return {
    ...signer,
    on: vi.fn(() => () => {}),
    identity: {
      status: vi.fn(async () => ({ did, deviceKey: key, keyId: 'd1', revoked: null, head: null, fork: null })),
      log: vi.fn(),
      devices: vi.fn(async () => []),
    },
  };
}

const ctx = { selfId: () => 'did:key:z6MkAgent' };

describe('choosing which device serves the account (the identity port)', () => {
  it('offers switching only where it can sign a login, for a key that speaks for somebody', async () => {
    const server = fakeServer();
    const serving = (local: ReturnType<typeof fakeLocal>) => ({
      host: fakeHost(),
      signer: local,
      current: null,
      problem: null,
      connect: server.connect,
    });
    const local = fakeLocal();
    expect((await createAd4mIdentityPort(local, undefined, serving(local)).capabilities()).switchDevice).toBe(true);
    const nobody = fakeLocal(null);
    expect((await createAd4mIdentityPort(nobody, undefined, serving(nobody)).capabilities()).switchDevice).toBe(false);
    const port = createAd4mIdentityPort(local);
    expect((await port.capabilities()).switchDevice).toBe(false);
    expect(port.serving).toBeUndefined();
  });

  it('adds a server once it lets this computer in, under its host, and lists it beside this computer', async () => {
    const server = fakeServer();
    const host = fakeHost();
    const local = fakeLocal();
    const port = createAd4mIdentityPort(local, undefined, {
      host,
      signer: local,
      current: null,
      problem: null,
      connect: server.connect,
    });

    expect(await port.addServer!('http://127.0.0.1:12100/')).toEqual({ ok: true, id: ADDRESS });
    // The login that proved it was logged straight out.
    expect(server.grants.size).toBe(0);
    expect(host.add).toHaveBeenCalledWith({ address: ADDRESS, name: '127.0.0.1:12100' });
    expect(await port.serving!()).toEqual({
      devices: [
        { id: THIS_COMPUTER_ID, name: 'This computer', address: null, current: true },
        { id: ADDRESS, name: '127.0.0.1:12100', address: ADDRESS, current: false },
      ],
      role: null,
      problem: null,
    });
  });

  it('keeps no server that does not let this computer in, and says why', async () => {
    const host = fakeHost();
    const local = fakeLocal();
    const port = createAd4mIdentityPort(local, undefined, {
      host,
      signer: local,
      current: null,
      problem: null,
      connect: fakeServer({ notKnown: true }).connect,
    });

    const outcome = await port.addServer!(ADDRESS);
    expect(outcome).toMatchObject({ ok: false, reason: 'not-known' });
    expect((outcome as { message: string }).message).toMatch(/don't have access to this host/);
    expect(await port.addServer!('ftp://nope')).toMatchObject({ ok: false, reason: 'address' });
    const insecure = await port.addServer!('http://my-server.example:12000');
    expect(insecure).toMatchObject({ ok: false, reason: 'insecure' });
    expect((insecure as { message: string }).message).toMatch(/https:\/\//);
    expect(local.agent.signSessionStatement).toHaveBeenCalledTimes(1);
    expect(host.add).not.toHaveBeenCalled();
  });

  it('answers an add whose host list or store fails, rather than rejecting', async () => {
    const local = fakeLocal();
    const server = fakeServer();
    const base = { signer: local, current: null, problem: null, connect: server.connect };
    const listFails = fakeHost();
    listFails.list = async () => {
      throw new Error('registry unreadable');
    };
    const a = createAd4mIdentityPort(local, undefined, { host: listFails, ...base });
    // Plain words for the person: what the list threw stays out of them.
    expect(await a.addServer!(ADDRESS)).toMatchObject({ ok: false, message: "Couldn't add that host. Try again." });

    const addFails = fakeHost();
    addFails.add = vi.fn(async () => {
      throw new Error('disk full');
    });
    const b = createAd4mIdentityPort(local, undefined, { host: addFails, ...base });
    expect(await b.addServer!(ADDRESS)).toMatchObject({ ok: false, message: "Couldn't add that host. Try again." });
  });

  it('keeps the session open when the choice cannot be recorded, and restarts only once it is', async () => {
    const server = fakeServer();
    const local = fakeLocal();
    const host = fakeHost([{ address: ADDRESS, name: 'home' }], ADDRESS);
    const session = await openKeySession(local, ADDRESS, { connect: server.connect, now: server.now });
    const port = createAd4mIdentityPort(local, undefined, {
      host,
      signer: local,
      current: { session, name: 'home' },
      problem: null,
      connect: server.connect,
    });
    host.choose = vi.fn(async () => {
      throw new Error('registry is read-only');
    });
    await expect(port.serveFrom!(THIS_COMPUTER_ID)).rejects.toThrow(/read-only/);
    expect(server.loggedOut).toHaveLength(0);
    expect(server.clients.at(-1)?.closed).toBe(false);
    expect(host.restart).not.toHaveBeenCalled();
  });

  it('shows this computer with the stored problem when the host list keeps failing', async () => {
    const local = fakeLocal();
    const host = fakeHost();
    host.list = async () => {
      throw new Error('registry unreadable');
    };
    const result = await createLocalAd4mConnector(async () => ({ port: 12000, token: 'admin' }), {
      startupDelayMs: 0,
      servers: host,
      connectRemote: fakeServer().connect,
      connectLocal: async () => ({ client: local }),
    }).initialize(ctx);
    const view = await result.ports.identity!.serving!();
    expect(view.devices).toEqual([{ id: THIS_COMPUTER_ID, name: 'This computer', address: null, current: true }]);
    // The person reads plain words; what the list threw is not one of them.
    expect(view.problem).toBe("Can't load your hosts right now.");
  });

  it('switches to a listed server, and back to this computer, logging out of the server it leaves', async () => {
    const server = fakeServer();
    const local = fakeLocal();
    const host = fakeHost([{ address: ADDRESS, name: 'home' }]);
    const here = createAd4mIdentityPort(local, undefined, {
      host,
      signer: local,
      current: null,
      problem: null,
      connect: server.connect,
    });
    await here.serveFrom!(ADDRESS);
    expect(host.choose).toHaveBeenLastCalledWith(ADDRESS);
    await expect(here.serveFrom!('http://elsewhere:1')).rejects.toThrow(/Can't find the host/);

    const session = await openKeySession(local, ADDRESS, { connect: server.connect, now: server.now });
    const there = createAd4mIdentityPort(local, undefined, {
      host,
      signer: local,
      current: { session, name: 'home' },
      problem: null,
      connect: server.connect,
    });
    expect((await there.serving!()).devices.map((d) => [d.id, d.current])).toEqual([
      [THIS_COMPUTER_ID, false],
      [ADDRESS, true],
    ]);
    expect((await there.serving!()).role).toBe('operator');
    await expect(there.removeServer!(ADDRESS)).rejects.toThrow(/This host is in use/);

    // Choosing the server above restarted once; leaving it is a new restart.
    expect(host.restart).toHaveBeenCalledTimes(1);
    await there.serveFrom!(THIS_COMPUTER_ID);
    expect(server.loggedOut).toHaveLength(1);
    expect(host.choose).toHaveBeenLastCalledWith(null);
    expect(host.restart).toHaveBeenCalledTimes(2);
  });

  it('tells whoever listens that the server ended the session, even one that listens later', async () => {
    const server = fakeServer();
    const local = fakeLocal();
    const session = await openKeySession(local, ADDRESS, { connect: server.connect, now: server.now });
    const port = createAd4mIdentityPort(local, undefined, {
      host: fakeHost([{ address: ADDRESS, name: 'home' }], ADDRESS),
      signer: local,
      current: { session, name: 'home' },
      problem: null,
      connect: server.connect,
    });
    const early = vi.fn();
    port.onSessionEnded!(early);

    server.revoke('z6MkDevice');
    await flush();
    await flush();

    const ended = { reason: 'revoked', id: ADDRESS, name: 'home' };
    expect(early).toHaveBeenCalledWith(ended);
    const late = vi.fn();
    port.onSessionEnded!(late);
    expect(late).toHaveBeenCalledWith(ended);
  });
});

describe('the desktop connector, with a server chosen', () => {
  function connector(server: ReturnType<typeof fakeServer>, host: Ad4mServerHost, local = fakeLocal()) {
    return createLocalAd4mConnector(async () => ({ port: 12000, token: 'admin' }), {
      startupDelayMs: 0,
      servers: host,
      connectRemote: server.connect,
      connectLocal: async () => ({ client: local }),
    });
  }

  it('serves the app from the server, with this computer still holding the identity', async () => {
    const server = fakeServer();
    const local = fakeLocal();
    const result = await connector(server, fakeHost([{ address: ADDRESS, name: 'home' }], ADDRESS), local).initialize(
      ctx,
    );

    expect(result.client).not.toBe(local);
    expect(server.clients.at(-1)?.token?.()).toBe(result.connection.token);
    expect(result.connection).toMatchObject({ port: 12100, url: ADDRESS });
    expect('host' in result && result.host).toEqual({ id: ADDRESS, name: 'home', url: ADDRESS });
    expect(result.ports.runtime?.onThisMachine).toBe(false);
    // The operator gets the server's own settings, less what only its own machine may touch.
    expect(result.ports.runtime?.executorConfig).toBeTypeOf('function');
    expect(result.ports.runtime?.exportDatabase).toBeUndefined();
    const view = await result.ports.identity!.serving!();
    expect(view.role).toBe('operator');
    expect(view.devices.find((d) => d.current)?.id).toBe(ADDRESS);
    // The identity reads stay on this computer's executor.
    await result.ports.identity!.capabilities();
    expect(local.identity.status).toHaveBeenCalled();

    await result.ports.identity!.serveFrom!(THIS_COMPUTER_ID);
  });

  it('says plainly why a chosen server failed when the failure is not a refusal', async () => {
    const result = await createLocalAd4mConnector(async () => ({ port: 12000, token: 'admin' }), {
      startupDelayMs: 0,
      servers: fakeHost([{ address: ADDRESS, name: 'home' }], ADDRESS),
      connectRemote: () => {
        throw new TypeError('WebSocket ECONNRESET at ws.ts:41');
      },
      connectLocal: async () => ({ client: fakeLocal() }),
    }).initialize(ctx);
    const view = await result.ports.identity!.serving!();
    expect(view.problem).toBe("Can't use home, so this computer is in use. The host didn't let you sign in.");
  });

  it('hands over the token in force when it is read, not the one the session started with', async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer();
      const result = await connector(server, fakeHost([{ address: ADDRESS, name: 'home' }], ADDRESS)).initialize(ctx);
      const first = result.connection.token;

      // The session renews five minutes before the hour is up; the embed bridge reads after that.
      server.advance(3300);
      await vi.advanceTimersByTimeAsync(3300 * 1000);

      expect(result.connection.token).not.toBe(first);
      expect(result.connection.token).toBe(server.clients.at(-1)?.token?.());
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives an agent the server serves no settings of the server', async () => {
    const result = await connector(
      fakeServer({ role: 'tenant' }),
      fakeHost([{ address: ADDRESS, name: 'home' }], ADDRESS),
    ).initialize(ctx);
    expect(result.ports.runtime?.onThisMachine).toBe(false);
    expect(result.ports.runtime?.executorConfig).toBeUndefined();
    expect(result.ports.runtime?.restartExecutor).toBeUndefined();
    expect((await result.ports.identity!.serving!()).role).toBe('agent');
    await result.ports.identity!.serveFrom!(THIS_COMPUTER_ID);
  });

  it('stays on this computer, saying why, when the chosen server refuses it', async () => {
    const local = fakeLocal();
    const result = await connector(
      fakeServer({ notKnown: true }),
      fakeHost([{ address: ADDRESS, name: 'home' }], ADDRESS),
      local,
    ).initialize(ctx);

    expect(result.client).toBe(local);
    expect(result.connection).toEqual({ port: 12000, token: 'admin' });
    expect(result.ports.runtime?.onThisMachine).toBeUndefined();
    const view = await result.ports.identity!.serving!();
    expect(view.devices.find((d) => d.current)?.id).toBe(THIS_COMPUTER_ID);
    expect(view.problem).toMatch(/^Can't use home, so this computer is in use\. .*don't have access to this host/);
  });

  it('does not dial a stored plain-http server on another computer, and says why', async () => {
    const stored = 'http://192.168.1.20:12000';
    const local = fakeLocal();
    const connectRemote = vi.fn();
    const host = fakeHost([{ address: stored, name: 'old' }], stored);
    const result = await createLocalAd4mConnector(async () => ({ port: 12000, token: 'admin' }), {
      startupDelayMs: 0,
      servers: host,
      connectRemote,
      connectLocal: async () => ({ client: local }),
    }).initialize(ctx);

    expect(result.client).toBe(local);
    expect(connectRemote).not.toHaveBeenCalled();
    expect(local.agent.signSessionStatement).not.toHaveBeenCalled();
    const view = await result.ports.identity!.serving!();
    expect(view.devices.find((d) => d.current)?.id).toBe(THIS_COMPUTER_ID);
    expect(view.problem).toMatch(/^Can't use old, so this computer is in use\. .*https:\/\//);
    // It stays listed, so it can be removed (and added again as https).
    await result.ports.identity!.removeServer!(stored);
    expect(host.state.servers).toEqual([]);
  });

  it('stays on this computer when none is chosen', async () => {
    const local = fakeLocal();
    const result = await connector(fakeServer(), fakeHost([{ address: ADDRESS, name: 'home' }]), local).initialize(ctx);
    expect(result.client).toBe(local);
    expect((await result.ports.identity!.serving!()).problem).toBeNull();
  });
});
