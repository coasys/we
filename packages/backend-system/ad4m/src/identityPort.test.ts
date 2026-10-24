/**
 * The identity port reads what the executor's `identity.*` calls answer (identity slice 1), and
 * degrades on an executor that predates them.
 */
import type { DeviceView, IdentityLog, IdentityStatus, SignedHead } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mIdentityPort, readKeyLog } from './identityPort';
import { missingExecutorMethods, resetMissingExecutorMethods } from './missingMethods';

const DID = 'did:scid:coasys:1:QmScid';

const incept = {
  format: 'coasys-kel/1',
  scid: 'QmScid',
  seq: 0,
  prev: null,
  op: 'incept',
  kind: 'human',
  master: 'z6MkMaster',
  next: 'QmNext',
  add: [{ id: 'd1', sign: 'z6MkOne', enc: 'z6LSOne', life: 'standing' }],
  proof: [],
};
const add = {
  format: 'coasys-kel/1',
  scid: 'QmScid',
  seq: 1,
  prev: 'QmHash0',
  op: 'add',
  add: [{ id: 'd2', sign: 'z6MkTwo' }],
  offer: 'o',
  coSig: 's',
};
const revoke = { format: 'coasys-kel/1', scid: 'QmScid', seq: 2, prev: 'QmHash1', op: 'revoke', revoke: ['d2'] };
const head: SignedHead = {
  scid: 'QmScid',
  seq: 2,
  hash: 'QmHash2',
  time: 1_760_000_000,
  store: 'did:key:z6MkStore',
  sig: 'x',
};

function client(answers: Partial<Record<'status' | 'log' | 'devices', unknown>>, fail?: Error) {
  const call = (name: 'status' | 'log' | 'devices') =>
    vi.fn(async () => {
      if (fail) throw fail;
      return answers[name];
    });
  return { identity: { status: call('status'), log: call('log'), devices: call('devices') } };
}

describe('the AD4M identity port', () => {
  it('reads a log, each event with its own hash from the next event and the head', async () => {
    const port = createAd4mIdentityPort(
      client({ log: { did: DID, events: [incept, add, revoke], head, fork: null } satisfies IdentityLog }),
    );
    const log = await port.log!(DID);
    expect(log.events.map((e) => [e.seq, e.op, e.hash])).toEqual([
      [0, 'incept', 'QmHash0'],
      [1, 'add', 'QmHash1'],
      [2, 'revoke', 'QmHash2'],
    ]);
    expect(log.events[0].added).toEqual([{ id: 'd1', sign: 'z6MkOne' }]);
    expect(log.events[2].revoked).toEqual(['d2']);
    expect(log.head).toMatchObject({ seq: 2, store: 'did:key:z6MkStore' });
  });

  it('asks the executor to refresh the log from the store', async () => {
    const c = client({ log: { did: DID, events: [], head: null } });
    await createAd4mIdentityPort(c).log!(DID);
    expect(c.identity.log).toHaveBeenCalledWith(DID, 0, true);
  });

  it('reads the status and the devices', async () => {
    const port = createAd4mIdentityPort(
      client({
        // Typed against the SDK, so a field the executor stops sending fails here first.
        status: {
          did: DID,
          deviceKey: 'z6MkOne',
          deviceEnc: 'z6LS',
          keyId: 'd1',
          revoked: null,
          head,
          fork: null,
        } satisfies IdentityStatus,
        devices: [
          { keyId: 'd1', sign: 'z6MkOne', bot: null, expires: null, addedSeq: 0, revokedSeq: null, thisDevice: true },
          { keyId: 'd2', sign: 'z6MkTwo', bot: null, expires: null, addedSeq: 1, revokedSeq: 2, thisDevice: false },
        ] satisfies DeviceView[],
      }),
    );
    expect(await port.status!()).toMatchObject({ did: DID, keyId: 'd1', revoked: null });
    const devices = await port.devices!();
    expect(devices.map((d) => [d.keyId, d.thisDevice, d.revokedSeq])).toEqual([
      ['d1', true, null],
      ['d2', false, 2],
    ]);
  });

  it('turns the key log and devices on against an executor that answers', async () => {
    const port = createAd4mIdentityPort(client({ status: { did: null, deviceKey: 'z6Mk' } }));
    const caps = await port.capabilities();
    expect(caps.keyLog).toBe(true);
    expect(caps.devices).toBe(true);
    // Changing the identity is the custody service's, never the backend's.
    expect(caps.linkDevice).toBe(false);
  });

  it('leaves every capability off on an executor that predates the identity calls, and records why', async () => {
    resetMissingExecutorMethods();
    const port = createAd4mIdentityPort(client({}, new Error('Unknown type: identity.status')));
    const caps = await port.capabilities();
    expect(Object.values(caps).every((on) => on === false)).toBe(true);
    expect(missingExecutorMethods().map((m) => m.method)).toContain('identity.status');
  });

  it('keeps a malformed event as an unknown one rather than failing the log', () => {
    const log = readKeyLog({ did: DID, events: [incept, 'nonsense'], head: null });
    expect(log.events.map((e) => e.op)).toEqual(['incept', 'unknown']);
  });

  it('passes forks on', () => {
    let handler: ((event: unknown) => void) | undefined;
    const c = { ...client({}), on: (_type: 'identity-fork', h: (event: unknown) => void) => ((handler = h), () => {}) };
    const seen: unknown[] = [];
    createAd4mIdentityPort(c).onFork!((fork) => seen.push(fork));
    handler!({ did: DID, seq: 3, ours: 'QmA', theirs: 'QmB' });
    expect(seen).toEqual([{ seq: 3, ours: 'QmA', theirs: 'QmB' }]);
  });
});
