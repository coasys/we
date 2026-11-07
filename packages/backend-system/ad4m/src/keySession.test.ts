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
  const clients: { token: (() => string) | null; closed: boolean; authFailed: ((r: string) => void)[] }[] = [];
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
    const state = { token: token ?? null, closed: false, authFailed: [] as ((r: string) => void)[] };
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

    // Down again, until past the expiry.
    failing.sessionChallenge = async () => {
      throw new FakeRpcError(503, 'connection failed');
    };
    server.advance(3550);
    await timers.fire();
    expect(ended).toHaveBeenCalledWith('ended');
    expect(timers.pending.size).toBe(0);
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
      'That server does not list https://evil.example as its address. Its operator sets it with --public-origin.',
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
      /does not list https:\/\/home\.example as its address\. Its operator sets it with --public-origin/,
    );
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
    expect((outcome as { message: string }).message).toMatch(/does not know you/);
    expect(await port.addServer!('ftp://nope')).toMatchObject({ ok: false, reason: 'address' });
    const insecure = await port.addServer!('http://my-server.example:12000');
    expect(insecure).toMatchObject({ ok: false, reason: 'insecure' });
    expect((insecure as { message: string }).message).toMatch(/https:\/\//);
    expect(local.agent.signSessionStatement).toHaveBeenCalledTimes(1);
    expect(host.add).not.toHaveBeenCalled();
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
    await expect(here.serveFrom!('http://elsewhere:1')).rejects.toThrow(/No server/);

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
    await expect(there.removeServer!(ADDRESS)).rejects.toThrow(/serves this session/);

    await there.serveFrom!(THIS_COMPUTER_ID);
    expect(server.loggedOut).toHaveLength(1);
    expect(host.choose).toHaveBeenLastCalledWith(null);
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
    expect(view.problem).toMatch(/^home is not serving you: .*does not know you/);
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
    expect(view.problem).toMatch(/^old is not serving you: .*https:\/\//);
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
