/**
 * The identity port reads what the executor's `identity.*` calls answer, and
 * degrades on an executor that predates them.
 */
import type { DeviceView, IdentityLog, IdentityStatus, SignedHead } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

import { type Ad4mCustodyState, createAd4mIdentityPort, readKeyLog } from './identityPort';
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
          storeBehind: { since: 1_700_000_000, seq: 0 },
          store: { url: 'https://store.example', trusted: true },
        } satisfies IdentityStatus,
        devices: [
          { keyId: 'd1', sign: 'z6MkOne', bot: null, expires: null, addedSeq: 0, revokedSeq: null, thisDevice: true },
          { keyId: 'd2', sign: 'z6MkTwo', bot: null, expires: null, addedSeq: 1, revokedSeq: 2, thisDevice: false },
        ] satisfies DeviceView[],
      }),
    );
    expect(await port.status!()).toMatchObject({
      did: DID,
      keyId: 'd1',
      revoked: null,
      storeBehind: { since: 1_700_000_000, seq: 0 },
    });
    const devices = await port.devices!();
    expect(devices.map((d) => [d.keyId, d.thisDevice, d.revokedSeq])).toEqual([
      ['d1', true, null],
      ['d2', false, 2],
    ]);
  });

  it('keeps the bot mark and the end the key log gives each key', async () => {
    const port = createAd4mIdentityPort(
      client({
        devices: [
          { keyId: 'd1', sign: 'z6MkOne', bot: null, expires: null, addedSeq: 0, revokedSeq: null, thisDevice: true },
          {
            keyId: 'd3',
            sign: 'z6MkBot',
            bot: { can: ['read', 'write', 'fly'], expires: 1_790_000_000 },
            expires: 1_790_000_000,
            addedSeq: 3,
            revokedSeq: null,
            thisDevice: false,
          },
          {
            keyId: 'd4',
            sign: 'z6MkFour',
            bot: null,
            expires: 1_700_000_000,
            addedSeq: 4,
            revokedSeq: null,
            thisDevice: false,
          },
        ] satisfies DeviceView[],
      }),
    );
    const devices = await port.devices!();
    expect(devices.map((d) => [d.keyId, d.bot, d.expires])).toEqual([
      ['d1', null, null],
      ['d3', { can: ['read', 'write', 'fly'], expires: 1_790_000_000 }, 1_790_000_000],
      ['d4', null, 1_700_000_000],
    ]);
    // A mark that is not an object is still a mark: the key is a bot's, whatever else it says.
    const odd = await createAd4mIdentityPort(
      client({ devices: [{ keyId: 'd5', sign: 'z', bot: true, addedSeq: 5, revokedSeq: null, thisDevice: false }] }),
    ).devices!();
    expect(odd[0].bot).toEqual({ can: [], expires: null });
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

describe('the AD4M identity port with a custody service', () => {
  const custody = (state: Partial<Ad4mCustodyState> = {}) => ({
    open: vi.fn(async () => 'done' as const),
    publicState: vi.fn(
      async () => ({ did: DID, holdsMaster: { index: 0 }, unlock: 'os', ...state }) as Ad4mCustodyState,
    ),
  });

  it('offers no change without one', async () => {
    const port = createAd4mIdentityPort(client({ status: {} }));
    expect(port.change).toBeUndefined();
    expect(port.custody).toBeUndefined();
    expect(await port.capabilities()).toMatchObject({
      keyLog: true,
      masterKey: false,
      recoveryWords: false,
      linkDevice: false,
    });
  });

  it('runs a change through it, and reads its state in neutral terms', async () => {
    const host = custody({ blocked: '' });
    const port = createAd4mIdentityPort(client({ status: {} }), host);
    // The custody service takes the 12 words back too: replacing the master key, restoring.
    expect(await port.capabilities()).toMatchObject({ masterKey: true, recoveryWords: true, linkDevice: true });
    // A host that takes no words (the phone) keeps the master key and links devices, and offers
    // neither replacing the master key nor restoring.
    const phone = createAd4mIdentityPort(client({ status: {} }), { ...custody({}), takesWords: false });
    expect(await phone.capabilities()).toMatchObject({ masterKey: true, recoveryWords: false, linkDevice: true });
    expect(await port.change!({ kind: 'replace-master' })).toBe('done');
    expect(host.open).toHaveBeenCalledWith({ kind: 'replace-master' });
    expect(await port.change!({ kind: 'revoke', keyId: 'd2' })).toBe('done');
    expect(host.open).toHaveBeenCalledWith({ kind: 'revoke', keyId: 'd2' });
    // An empty reason is no reason: nothing blocks the change.
    expect(await port.custody!()).toEqual({
      did: DID,
      holdsMaster: true,
      unlock: 'os',
      blocked: null,
      devices: [],
      revokedHolders: [],
      requests: [],
      masterWaiting: false,
    });
  });

  it('reads the private record’s names, the waiting requests and a master key waiting here', async () => {
    const port = createAd4mIdentityPort(
      client({ status: {} }),
      custody({
        devices: [
          { keyId: 'd1', name: 'Desktop', kind: 'desktop-app', holdsMaster: true },
          { keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'offered' },
          { keyId: 'd3', name: 'Box', kind: 'server', holdsMaster: false },
        ],
        requests: [
          { id: 'r1', kind: 'send-master', by: 'd2', keyIds: [], expires: 99 },
          { id: 'r2', kind: 'confirm-revoke', by: 'd2', keyIds: ['d3'], expires: 99 },
          // A kind this app cannot answer is left for one that can.
          { id: 'r3', kind: 'rotate-everything', by: 'd2', keyIds: [], expires: 99 },
        ],
        revokedHolders: ['d4'],
        masterWaiting: true,
      }),
    );
    const view = await port.custody!();
    expect(view.devices.map((d) => [d.name, d.kind, d.holdsMaster])).toEqual([
      ['Desktop', 'desktop-app', 'yes'],
      ['Laptop', 'desktop-app', 'offered'],
      ['Box', 'server', 'no'],
    ]);
    expect(view.requests).toEqual([
      { id: 'r1', kind: 'send-master', by: 'd2', keyIds: [], expires: 99 },
      { id: 'r2', kind: 'confirm-revoke', by: 'd2', keyIds: ['d3'], expires: 99 },
    ]);
    expect(view.masterWaiting).toBe(true);
    expect(view.revokedHolders).toEqual(['d4']);
  });

  it('opens each device step in the custody service as asked', async () => {
    const host = custody();
    const port = createAd4mIdentityPort(client({ status: {} }), host);
    for (const change of [
      { kind: 'scan-device' },
      { kind: 'show-code' },
      { kind: 'take-master' },
      { kind: 'ask-master' },
      { kind: 'answer-request', id: 'r1' },
      { kind: 'rename', keyId: 'd2' },
    ] as const) {
      await port.change!(change);
      expect(host.open).toHaveBeenLastCalledWith(change);
    }
  });

  it('says why changes are blocked', async () => {
    const port = createAd4mIdentityPort(client({ status: {} }), custody({ holdsMaster: null, blocked: 'No store.' }));
    expect(await port.custody!()).toMatchObject({ holdsMaster: false, blocked: 'No store.' });
  });
});
