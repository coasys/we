/**
 * The phone's custody service as Settings reads it: the plugin's answers in the custody service's
 * shape, and a change that leaves for the identity page.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DeviceKeyPlugin, DeviceRequestView, PhoneDeviceView, PhoneIdentityView } from './deviceKey';
import { identityPageUrl, phoneCustodyHost } from './phoneCustody';

const DID = 'did:scid:coasys:1:QmIdentity';

const status = (over: Partial<PhoneIdentityView> = {}): PhoneIdentityView => ({
  did: DID,
  keyId: 'd2',
  fingerprint: 'AbCd 1234',
  revoked: null,
  masterIndex: null,
  protection: 'tee',
  store: 'https://store.example',
  head: 3,
  biometrics: true,
  ...over,
});

const device = (over: Partial<PhoneDeviceView>): PhoneDeviceView => ({
  keyId: 'd1',
  fingerprint: 'x',
  name: 'Laptop',
  kind: 'desktop-app',
  addedSeq: 0,
  revokedSeq: null,
  thisDevice: false,
  holdsMaster: 'no',
  masterIndex: null,
  mayKeepMaster: true,
  bot: false,
  ...over,
});

const request = (over: Partial<DeviceRequestView>): DeviceRequestView => ({
  id: 'r1',
  kind: 'send-master',
  by: 'd3',
  device: 'Tablet',
  fingerprint: 'y',
  code: 'K2P 9QX',
  targets: [],
  targetKeys: [],
  rotate: false,
  expires: 1_800_000_000,
  problem: null,
  ...over,
});

function plugin(answers: {
  status?: PhoneIdentityView | Error;
  devices?: PhoneDeviceView[];
  requests?: DeviceRequestView[];
  waiting?: boolean | Error;
  /** The identity's status in order: one per `identityStatus` call, the last one repeated. */
  statuses?: Array<PhoneIdentityView | Error>;
  /** An identity made here and not published yet. */
  pending?: string | null;
  /** What `finishPending` answers. */
  finish?: string | null | Error;
}) {
  const statuses = [...(answers.statuses ?? [])];
  const p = {
    identityStatus: vi.fn(async () => {
      const next = statuses.length > 1 ? statuses.shift() : statuses[0];
      const answer = next ?? answers.status;
      if (answer instanceof Error) throw answer;
      return answer ?? status();
    }),
    pendingIdentity: vi.fn(async () => ({ did: answers.pending ?? null })),
    finishPending: vi.fn(async () => {
      if (answers.finish instanceof Error) throw answers.finish;
      return { did: answers.finish ?? null };
    }),
    devices: vi.fn(async () => ({ devices: answers.devices ?? [] })),
    requests: vi.fn(async () => ({ requests: answers.requests ?? [] })),
    masterWaiting: vi.fn(async () => {
      if (answers.waiting instanceof Error) throw answers.waiting;
      return { waiting: answers.waiting ?? false };
    }),
  };
  return p as typeof p & DeviceKeyPlugin;
}

const refusal = (code: string, message = code) => Object.assign(new Error(message), { code });

describe('the phone custody host', () => {
  it('takes the 12 words, as a computer does', () => {
    // Absent means it does: Settings offers replacing the master key and restoring here.
    expect(phoneCustodyHost(plugin({})).takesWords).toBeUndefined();
  });

  it('publishes an identity made here and not published yet, then reads it as this phone’s', async () => {
    const p = plugin({ statuses: [refusal('NoIdentity'), status({ masterIndex: 0 })], pending: DID, finish: DID });
    expect(await phoneCustodyHost(p).publicState()).toMatchObject({
      did: DID,
      holdsMaster: { index: 0 },
      thisDevice: { keyId: 'd2', kind: 'phone-app' },
    });
    expect(p.finishPending).toHaveBeenCalledTimes(1);
    expect(p.identityStatus).toHaveBeenCalledTimes(2);
  });

  it('names an identity it could not publish yet as pending, and tries again at the next read', async () => {
    const p = plugin({ status: refusal('NoIdentity'), pending: DID, finish: refusal('Unavailable', 'store down') });
    const host = phoneCustodyHost(p);
    expect(await host.publicState()).toEqual({
      did: null,
      pending: DID,
      holdsMaster: null,
      unlock: null,
      thisDevice: { keyId: null, kind: 'phone-app' },
    });
    await host.publicState();
    expect(p.finishPending).toHaveBeenCalledTimes(2);
  });

  it('asks nothing of the store when no identity was made here', async () => {
    const p = plugin({ status: refusal('NoIdentity') });
    expect(await phoneCustodyHost(p).publicState()).toMatchObject({ did: null });
    expect(p.pendingIdentity).toHaveBeenCalledTimes(1);
    expect(p.finishPending).not.toHaveBeenCalled();

    // A plugin that cannot say whether one waits: no identity this read, not a read that failed.
    const unsaid = plugin({ status: refusal('NoIdentity') });
    unsaid.pendingIdentity.mockRejectedValueOnce(refusal('Rpc'));
    expect(await phoneCustodyHost(unsaid).publicState()).toMatchObject({ did: null });
    expect(unsaid.finishPending).not.toHaveBeenCalled();
  });

  it('reads the devices, who keeps the master key, and the requests the phone can answer', async () => {
    const host = phoneCustodyHost(
      plugin({
        status: status({ masterIndex: 0 }),
        devices: [
          device({ keyId: 'd1', name: 'Laptop', holdsMaster: 'offered' }),
          device({ keyId: 'd2', name: 'Phone', kind: null, holdsMaster: 'yes', thisDevice: true }),
          device({ keyId: 'd3', name: 'Tablet', holdsMaster: 'no' }),
          // Revoked, and the log let it keep the master key: a holder still out there.
          device({ keyId: 'd4', name: 'Old', holdsMaster: 'yes', revokedSeq: 5, mayKeepMaster: true }),
          device({ keyId: 'd5', name: 'Gone', revokedSeq: 6, mayKeepMaster: false }),
        ],
        requests: [
          request({ id: 'r1' }),
          request({ id: 'r2', kind: 'confirm-revoke', targets: ['Tablet'], targetKeys: ['d3'] }),
          request({ id: 'r3', problem: 'It asks for a rotation, which needs the 12 words.' }),
        ],
      }),
    );
    expect(await host.publicState()).toEqual({
      did: DID,
      holdsMaster: { index: 0 },
      unlock: 'os',
      devices: [
        { keyId: 'd1', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'offered' },
        { keyId: 'd2', name: 'Phone', kind: '', holdsMaster: true },
        { keyId: 'd3', name: 'Tablet', kind: 'desktop-app', holdsMaster: false },
      ],
      requests: [
        { id: 'r1', kind: 'send-master', by: 'd3', keyIds: [], expires: 1_800_000_000 },
        { id: 'r2', kind: 'confirm-revoke', by: 'd3', keyIds: ['d3'], expires: 1_800_000_000 },
      ],
      revokedHolders: ['d4'],
      masterWaiting: false,
      // The phone's own key is this device, not the key of the executor it reaches.
      thisDevice: { keyId: 'd2', kind: 'phone-app' },
    });
  });

  it('says what the phone answers waits, where it keeps a key too, and offers none it cannot see', async () => {
    const waits = plugin({ waiting: true });
    expect(await phoneCustodyHost(waits).publicState()).toMatchObject({ holdsMaster: null, masterWaiting: true });

    // A phone that keeps a key can still owe the record its mark for it: "Take" makes the mark.
    const owes = plugin({ status: status({ masterIndex: 1 }), waiting: true });
    expect(await phoneCustodyHost(owes).publicState()).toMatchObject({
      holdsMaster: { index: 1 },
      masterWaiting: true,
    });
    expect(owes.masterWaiting).toHaveBeenCalledTimes(1);

    const current = plugin({ status: status({ masterIndex: 1 }), waiting: false });
    expect(await phoneCustodyHost(current).publicState()).toMatchObject({ masterWaiting: false });

    const unread = plugin({ waiting: new Error('store-unavailable') });
    expect(await phoneCustodyHost(unread).publicState()).toMatchObject({ masterWaiting: false });
  });

  it('is in no identity before the phone joins one', async () => {
    for (const code of ['NoIdentity', 'NoKeys']) {
      expect(await phoneCustodyHost(plugin({ status: refusal(code) })).publicState()).toEqual({
        did: null,
        holdsMaster: null,
        unlock: null,
        // Still the phone: the executor's key is not this device even before the phone joins.
        thisDevice: { keyId: null, kind: 'phone-app' },
      });
    }
  });

  it('blocks changes on a phone that cannot reach its store, or was removed', async () => {
    const offline = await phoneCustodyHost(plugin({ status: refusal('Rpc', 'store-unavailable') })).publicState();
    expect(offline.blocked).toMatch(/Can’t load your devices\. Try again later\. \(store-unavailable\)/);
    expect(offline.thisDevice).toEqual({ keyId: null, kind: 'phone-app' });

    const removed = plugin({ status: status({ revoked: 7 }) });
    const state = await phoneCustodyHost(removed).publicState();
    expect(state.blocked).toMatch(/This phone was removed/);
    expect(state.did).toBe(DID);
    expect(removed.devices).not.toHaveBeenCalled();
  });

  it('runs a change on the identity page, coming back to where Settings was', async () => {
    const nav = { here: () => '/settings/identity?tab=devices', assign: vi.fn() };
    const host = phoneCustodyHost(plugin({}), nav);
    let ended = false;
    void host.open({ kind: 'revoke', keyId: 'd3' }).then(() => (ended = true));
    await Promise.resolve();
    // The page leaves; the change never ends here.
    expect(ended).toBe(false);
    const url = new URL(nav.assign.mock.calls[0][0], 'https://localhost');
    expect(url.pathname).toBe('/mobile/identity.html');
    expect(JSON.parse(url.searchParams.get('change')!)).toEqual({ kind: 'revoke', keyId: 'd3' });
    expect(url.searchParams.get('back')).toBe('/settings/identity?tab=devices');
  });

  it('addresses the join page', () => {
    const url = new URL(identityPageUrl('join', '/'), 'https://localhost');
    expect(url.searchParams.has('join')).toBe(true);
    expect(url.searchParams.has('change')).toBe(false);
    expect(url.searchParams.get('back')).toBe('/');
  });
});
