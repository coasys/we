/**
 * The host port: the operator half calls this executor's `host.*`; the tenant half logs in to another
 * host with a statement this computer's executor signs, keeps that session, and asks nothing until used.
 */
import type { Ad4mClient } from '@coasys/ad4m';
import { isNotAdmitted } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mHostPort } from '../src/hostPort';
import type { KeySigner, SignedKeyStatement } from '../src/keySession';

const HOST = 'https://cloud.example.org';

const proof = { statement: { v: 1 }, sig: 'zSig' } as unknown as SignedKeyStatement;

/** The signer a computer's executor is, recording what it was asked. */
function fakeSigner() {
  const asked: string[] = [];
  const signer: KeySigner = {
    signSession: async (request) => {
      asked.push(`${request.purpose}:${request.challenge}`);
      return proof;
    },
  };
  return { signer, asked };
}

/** A host's executor: the clients `connect` hands out, by token. */
function fakeHost(options: { refuseLogin?: boolean } = {}) {
  const connected: { url: string; token?: string }[] = [];
  const closed: (string | undefined)[] = [];
  const calls: string[] = [];
  let tokens = 0;
  const connect = (url: string, token?: string) => {
    connected.push({ url, token });
    let current = token;
    return {
      agent: {
        sessionChallenge: async () => ({ challenge: `c${++tokens}`, executor: 'did:key:z6MkHost', expiresAt: 0 }),
        loginWithKey: async () => {
          if (options.refuseLogin) throw new Error('RPC error 403: not-known');
          return {
            token: 'tenant-token',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            grantId: 'grant-1',
            role: 'tenant',
            did: 'did:key:z6MkAgent',
            scid: 'did:scid:coasys:1:Qm',
          };
        },
        renewSession: async () => ({ token: 'renewed', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
      },
      host: {
        usage: async () => {
          calls.push('usage');
          return { state: 'held' };
        },
        leave: async (keep: boolean) => {
          calls.push(`leave:${keep}`);
          return { kept: keep };
        },
      },
      data: {
        exportFile: async () => {
          calls.push('export');
          throw new Error('RPC error 403: not-admitted: this tenant is held');
        },
        importFile: async (file: Uint8Array) => {
          calls.push(`import:${file.length}`);
          return { linksWritten: 3, linksInvalid: 0, neighbourhoodUrls: [] };
        },
      },
      setToken: (t: string) => {
        current = t;
      },
      close: () => void closed.push(current),
    } as unknown as Ad4mClient;
  };
  return { connect, connected, closed, calls };
}

const local = {} as Ad4mClient;

describe('the tenant half of the host port', () => {
  it('logs in only on the first call, signing with the computer’s executor, and uses the token it was given', async () => {
    const host = fakeHost();
    const { signer, asked } = fakeSigner();
    const tenant = createAd4mHostPort(local, { connect: host.connect, signer }).tenant(HOST);

    expect(host.connected).toEqual([]);
    expect(await tenant.usage()).toEqual({ state: 'held' });
    expect(await tenant.leave(true)).toEqual({ kept: true });

    // One anonymous client for the challenge and the login, one with the token for the rest.
    expect(host.connected).toEqual([
      { url: HOST, token: undefined },
      { url: HOST, token: 'tenant-token' },
    ]);
    expect(asked).toEqual(['login:c1']);
    expect(host.calls).toEqual(['usage', 'leave:true']);
  });

  it('opens one session for calls made together', async () => {
    const host = fakeHost();
    const tenant = createAd4mHostPort(local, { connect: host.connect, signer: fakeSigner().signer }).tenant(HOST);
    await Promise.all([tenant.usage(), tenant.usage()]);
    expect(host.connected).toHaveLength(2);
  });

  it('says a refused login again on the next call, and does not keep a session that never opened', async () => {
    const host = fakeHost({ refuseLogin: true });
    const tenant = createAd4mHostPort(local, { connect: host.connect, signer: fakeSigner().signer }).tenant(HOST);
    await expect(tenant.usage()).rejects.toThrow('not-known');
    await expect(tenant.usage()).rejects.toThrow('not-known');
    // Two tries, two anonymous clients, each closed once it answered; no session client.
    expect(host.connected).toEqual([
      { url: HOST, token: undefined },
      { url: HOST, token: undefined },
    ]);
    expect(host.closed).toHaveLength(2);
  });

  it('tells a held tenant’s refusal apart, so the view shows the held words', async () => {
    const host = fakeHost();
    const tenant = createAd4mHostPort(local, { connect: host.connect, signer: fakeSigner().signer }).tenant(HOST);
    const refused = await tenant.exportFile().catch((e: unknown) => e);
    expect(isNotAdmitted(refused)).toBe(true);
    expect(isNotAdmitted(new Error('RPC error 403: not-a-tenant'))).toBe(false);
  });

  it('imports a file into the session', async () => {
    const host = fakeHost();
    const tenant = createAd4mHostPort(local, { connect: host.connect, signer: fakeSigner().signer }).tenant(HOST);
    expect(await tenant.importFile(new Uint8Array(5))).toMatchObject({ linksWritten: 3 });
    expect(host.calls).toEqual(['import:5']);
  });

  it('ends the session on leave and on close, and a later call logs in afresh', async () => {
    const host = fakeHost();
    const { signer, asked } = fakeSigner();
    const tenant = createAd4mHostPort(local, { connect: host.connect, signer }).tenant(HOST);
    await tenant.leave(false);
    await vi.waitFor(() => expect(host.closed).toContain('tenant-token'));

    await tenant.usage();
    expect(asked).toEqual(['login:c1', 'login:c2']);

    tenant.close();
    await vi.waitFor(() => expect(host.closed.filter((t) => t === 'tenant-token')).toHaveLength(2));
  });
});

describe('the operator half of the host port', () => {
  it('passes the calls to this executor, and answers removal as a boolean', async () => {
    const policy = {
      signup: 'by_invite',
      maxTenants: null,
      display: { name: 'n', run_by_coasys: false },
      pinned: [],
      choiceNeeded: false,
    };
    const client = {
      host: {
        info: vi.fn(async () => ({ name: 'n' })),
        policy: vi.fn(async () => policy),
        setPolicy: vi.fn(async () => policy),
        createInvite: vi.fn(async () => ({ inviteId: 'i', secret: 's', expiresAt: 1 })),
        listInvites: vi.fn(async () => []),
        revokeInvite: vi.fn(async () => true),
        tenants: vi.fn(async () => []),
        removeTenant: vi.fn(async () => ({ removed: true })),
      },
      agent: {},
    } as unknown as Ad4mClient;
    const { operator } = createAd4mHostPort(client, { signer: fakeSigner().signer });

    expect(await operator.policy()).toBe(policy);
    await operator.setPolicy({ signup: 'anyone', maxTenants: null, displayName: null });
    expect(client.host.setPolicy).toHaveBeenCalledWith({ signup: 'anyone', maxTenants: null, displayName: null });
    expect(await operator.createInvite(7, 'for Sam')).toMatchObject({ secret: 's' });
    expect(client.host.createInvite).toHaveBeenCalledWith(7, 'for Sam');
    expect(await operator.revokeInvite('i')).toBe(true);
    expect(await operator.removeTenant('t')).toBe(true);
    expect(client.host.removeTenant).toHaveBeenCalledWith('t');
  });
});
