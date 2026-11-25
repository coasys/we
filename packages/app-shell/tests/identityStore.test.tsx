/**
 * identityStore and deviceStore: what they read from the backend's identity port, which changes
 * they ask it for, and that they never hold anything but public state.
 */
import { render } from '@solidjs/testing-library';
import type {
  DeviceKeyView,
  DeviceNameView,
  IdentityChange,
  IdentityChangeOutcome,
  IdentityCustodyView,
  IdentityPort,
  KeyLogView,
} from '@we/backend-shared';
import { NO_IDENTITY_CAPABILITIES, UnlinkUncertainError } from '@we/backend-shared';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const [ports, setPorts] = createSignal<{ identity?: IdentityPort } | null>(null);
const [bootState, setBootState] = createSignal('ready');
const DID = 'did:scid:coasys:1:QmScid';
const RETIRED_DID = 'did:key:z6MkRetired';
const NEW_DID = 'did:key:z6MkRekeyed';
/** What `agent.me` answers: the executor's re-key changes it. */
const agent = { did: RETIRED_DID };
const [me, setMe] = createSignal<{ did: string }>({ did: RETIRED_DID });
/** What the session's `refreshMe` throws, when the test has reading the agent again fail. */
let refreshMeFails: Error | null = null;

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: ports,
    bootState,
    me,
    refreshMe: async () => {
      if (refreshMeFails) throw refreshMeFails;
      setMe({ did: agent.did });
    },
    // As the session reads them from the port: linking a device needs a way to sign changes.
    identityCapabilities: () => ({
      ...NO_IDENTITY_CAPABILITIES,
      keyLog: true,
      devices: true,
      linkDevice: !!ports()?.identity?.change,
      recoveryWords: !!ports()?.identity?.change,
    }),
  }),
}));

import { type DeviceStore, DeviceStoreProvider, useDeviceStore } from '../src/frameworks/solid/stores/DeviceStore';
import {
  type IdentityStore,
  IdentityStoreProvider,
  startNowKey,
  useIdentityStore,
} from '../src/frameworks/solid/stores/IdentityStore';

const flush = () => new Promise((r) => setTimeout(r, 0));

const status = (did: string | null) => ({
  did,
  deviceKey: 'z6MkOne',
  keyId: did ? 'd1' : null,
  revoked: null,
  unlinked: null,
  head: null,
  fork: null,
  storeBehind: null,
});

const incept: KeyLogView['events'][number] = {
  seq: 0,
  op: 'incept',
  hash: 'QmHash0',
  added: [{ id: 'd1', sign: 'z6MkOne' }],
  unlinked: [],
  revoked: [],
};
const add: KeyLogView['events'][number] = {
  seq: 1,
  op: 'add',
  hash: 'QmHash1',
  added: [{ id: 'd2', sign: 'z6MkTwo' }],
  unlinked: [],
  revoked: [],
};
const devices: DeviceKeyView[] = [
  { keyId: 'd2', sign: 'z6MkTwo', thisDevice: false, addedSeq: 1, unlinkedSeq: null, revokedSeq: null },
  { keyId: 'd1', sign: 'z6MkOne', thisDevice: true, addedSeq: 0, unlinkedSeq: null, revokedSeq: null },
];

/** A backend whose identity is whatever the test says, and which counts what it was asked. */
function backend(state: {
  did: string | null;
  events: KeyLogView['events'];
  devices: DeviceKeyView[];
  /** What `unlinkSelf` rejects with, when the test has the executor refuse. */
  refuse?: Error;
  /** `unlinkSelf` answers once this settles, when the test holds it in flight. */
  gate?: Promise<void>;
}) {
  const calls: string[] = [];
  const port: IdentityPort = {
    capabilities: () => ({ ...NO_IDENTITY_CAPABILITIES, keyLog: true, devices: true }),
    async status() {
      calls.push('status');
      return status(state.did);
    },
    async log(did) {
      calls.push(`log:${did}`);
      return { did, events: state.events, head: null, fork: null };
    },
    async devices() {
      calls.push('devices');
      return state.devices;
    },
    async unlinkSelf() {
      calls.push('unlinkSelf');
      await state.gate;
      if (state.refuse) throw state.refuse;
      // The executor re-keys the agent: this computer speaks for no identity from then on, and
      // `agent.me` answers the new DID.
      state.did = null;
      agent.did = NEW_DID;
    },
  };
  return { port, calls, state };
}

const NO_CUSTODY: IdentityCustodyView = {
  did: null,
  holdsMaster: false,
  unlock: 'passphrase',
  blocked: null,
  devices: [],
  endedHolders: [],
  requests: [],
  masterWaiting: false,
  encMismatch: false,
};

/** The port able to sign changes: `custody` and `change` answered by the test. */
function signing(
  port: IdentityPort,
  options: {
    custody: () => Promise<IdentityCustodyView>;
    change: (change: IdentityChange) => Promise<IdentityChangeOutcome>;
  },
): IdentityPort {
  return { ...port, custody: options.custody, change: options.change };
}

/** Changes that run by changing the backend's state, as the backend's own window would. */
function custody(port: IdentityPort, onChange: (change: IdentityChange) => void, holds = false) {
  const changes: IdentityChange[] = [];
  let state: IdentityCustodyView = { ...NO_CUSTODY, holdsMaster: holds };
  const identity = signing(port, {
    custody: async () => state,
    async change(change) {
      changes.push(change);
      onChange(change);
      state = { ...state, did: DID, holdsMaster: true };
      return 'done';
    },
  });
  return { identity, changes };
}

function mount(): { identity: IdentityStore; devices: DeviceStore } {
  let identity!: IdentityStore;
  let deviceStore!: DeviceStore;
  function Capture() {
    identity = useIdentityStore();
    deviceStore = useDeviceStore();
    return null;
  }
  render(() => (
    <IdentityStoreProvider>
      <DeviceStoreProvider>
        <Capture />
      </DeviceStoreProvider>
    </IdentityStoreProvider>
  ));
  return { identity, devices: deviceStore };
}

beforeEach(() => {
  setPorts(null);
  agent.did = RETIRED_DID;
  setMe({ did: RETIRED_DID });
  setBootState('ready');
  refreshMeFails = null;
  localStorage.clear();
});

describe('identityStore', () => {
  it('shows the did:scid and the key log, newest first, d1 marked This computer', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    setPorts({ identity: b.port });
    const { identity } = mount();
    await flush();
    await flush();
    expect(identity.did()).toBe(DID);
    expect(identity.keyId()).toBe('d1');
    expect(identity.keyLog().map((r) => r.title)).toEqual(['Added d2', 'Created identity']);
    expect(identity.keyLog()[1].detail).toBe('with d1 · This computer');
    expect(identity.keyLog()[1].thisComputer).toBe(true);
    expect(b.calls).toContain(`log:${DID}`);
  });

  it('waits for the session before asking anything', async () => {
    setBootState('login');
    const b = backend({ did: DID, events: [incept], devices });
    setPorts({ identity: b.port });
    const { identity } = mount();
    await flush();
    expect(b.calls).toEqual([]);
    expect(identity.statusLoaded()).toBe(false);
    setBootState('ready');
    await flush();
    await flush();
    expect(identity.statusLoaded()).toBe(true);
  });

  it('asks the first-run question only where this computer can sign changes', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    setPorts({ identity: b.port });
    // The web, or Windows: no custody, no question, no way to change the identity.
    let stores = mount();
    await flush();
    await flush();
    expect(stores.identity.needsFirstRun()).toBe(false);
    expect(stores.identity.canChange()).toBe(false);
    expect(await stores.identity.makeIdentity()).toBe('failed');

    setPorts({ identity: custody(b.port, () => {}).identity });
    stores = mount();
    await flush();
    await flush();
    expect(stores.identity.needsFirstRun()).toBe(true);
  });

  it('"Make my identity here" asks for create, then reads the new identity', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    const c = custody(b.port, (change) => {
      if (change.kind === 'create') {
        b.state.did = DID;
        b.state.events = [incept];
        b.state.devices = [devices[1]];
      }
    });
    setPorts({ identity: c.identity });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(identity.needsFirstRun()).toBe(true);
    expect(await identity.makeIdentity()).toBe('done');
    await flush();
    await flush();
    expect(c.changes).toEqual([{ kind: 'create' }]);
    expect(identity.did()).toBe(DID);
    expect(identity.needsFirstRun()).toBe(false);
    expect(identity.keyLog().map((r) => r.title)).toEqual(['Created identity']);
    expect(identity.custody()?.holdsMaster).toBe(true);
    expect(deviceStore.devices().map((d) => d.label)).toEqual(['This computer']);
  });

  it('where changes are blocked, asks the question but starts no change, and says why', async () => {
    const why = 'This network has no identity store, so this computer cannot make or change an identity.';
    const opened: IdentityChange[] = [];
    setPorts({
      identity: signing(backend({ did: null, events: [], devices: [] }).port, {
        custody: async () => ({ ...NO_CUSTODY, blocked: why }),
        async change(change) {
          opened.push(change);
          return 'done';
        },
      }),
    });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    // The first run still comes up, so the person learns why; "Make my identity here" is off.
    expect(identity.needsFirstRun()).toBe(true);
    expect(identity.changeBlocked()).toBe(why);
    expect(identity.canChange()).toBe(false);
    expect(deviceStore.canManage()).toBe(false);
    // Refused without starting anything, and said where the screen can show it.
    expect(await identity.makeIdentity()).toBe('failed');
    expect(identity.error()).toBe(why);
    expect(await identity.open({ kind: 'add-device' })).toBe('failed');
    expect(opened).toEqual([]);
    expect(identity.busy()).toBe(false);
  });

  it('offers no change while the backend has not said this computer can sign one', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    setPorts({
      identity: signing(b.port, {
        custody: async () => {
          throw new Error('the custody service is not running');
        },
        change: async () => 'done',
      }),
    });
    const { identity } = mount();
    await flush();
    await flush();
    expect(identity.custody()).toBeNull();
    expect(identity.canChange()).toBe(false);
    expect(identity.needsFirstRun()).toBe(false);
  });

  it('says why a change failed, after reading everything again', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    setPorts({
      identity: signing(b.port, {
        custody: async () => NO_CUSTODY,
        change: async () => {
          throw new Error('the custody service stopped');
        },
      }),
    });
    const { identity } = mount();
    await flush();
    await flush();
    const before = b.calls.length;
    expect(await identity.makeIdentity()).toBe('failed');
    expect(identity.lastOutcome()).toBe('failed');
    expect(identity.error()).toBe('the custody service stopped');
    expect(identity.busy()).toBe(false);
    expect(b.calls.length).toBeGreaterThan(before);
  });

  it('draws nothing of one account after switching to another whose backend fails', async () => {
    setPorts({ identity: backend({ did: DID, events: [incept, add], devices }).port });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(identity.did()).toBe(DID);
    expect(deviceStore.devices()).toHaveLength(2);

    const broken: IdentityPort = {
      unlinkSelf: async () => {},
      capabilities: () => NO_IDENTITY_CAPABILITIES,
      status: async () => {
        throw new Error('no answer');
      },
    };
    setPorts({ identity: broken });
    await flush();
    await flush();
    expect(identity.did()).toBe('');
    expect(identity.keyLog()).toEqual([]);
    expect(identity.statusLoaded()).toBe(false);
    expect(identity.error()).toBe('no answer');
    expect(deviceStore.devices()).toEqual([]);
  });

  it('drops a reply from a backend the session has already left', async () => {
    let answer!: (value: ReturnType<typeof status>) => void;
    const slow: IdentityPort = {
      unlinkSelf: async () => {},
      capabilities: () => NO_IDENTITY_CAPABILITIES,
      status: () => new Promise((resolve) => (answer = resolve)),
    };
    setPorts({ identity: slow });
    const { identity } = mount();
    await flush();
    setPorts({ identity: backend({ did: null, events: [], devices: [] }).port });
    await flush();
    await flush();
    answer(status(DID));
    await flush();
    expect(identity.did()).toBe('');
  });

  it('takes the fork banner down once the backend no longer reports one', async () => {
    let forked = true;
    const b = backend({ did: DID, events: [incept], devices });
    setPorts({
      identity: {
        ...b.port,
        async status() {
          return { ...status(DID), fork: forked ? { seq: 1, ours: 'QmA', theirs: 'QmB' } : null };
        },
      },
    });
    const { identity } = mount();
    await flush();
    await flush();
    expect(identity.forked()).toBe(true);
    forked = false;
    await identity.refresh();
    expect(identity.forked()).toBe(false);
  });

  it('"Start now" puts the question away on this computer', async () => {
    setPorts({ identity: custody(backend({ did: null, events: [], devices: [] }).port, () => {}).identity });
    const { identity } = mount();
    await flush();
    await flush();
    identity.startWithoutIdentity();
    expect(identity.needsFirstRun()).toBe(false);
    expect(localStorage.getItem(startNowKey('z6MkOne'))).toBe('1');
  });

  it('remembers "Start now" for the account it was chosen in, not every account here', async () => {
    localStorage.setItem(startNowKey('z6MkSomeoneElse'), '1');
    setPorts({ identity: custody(backend({ did: null, events: [], devices: [] }).port, () => {}).identity });
    const { identity } = mount();
    await flush();
    await flush();
    expect(identity.needsFirstRun()).toBe(true);
  });

  it('reports a change the person cancelled, and reads again all the same', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    setPorts({
      identity: signing(b.port, { custody: async () => NO_CUSTODY, change: async () => 'cancelled' }),
    });
    const { identity } = mount();
    await flush();
    await flush();
    const before = b.calls.length;
    expect(await identity.makeIdentity()).toBe('cancelled');
    expect(identity.lastOutcome()).toBe('cancelled');
    expect(identity.busy()).toBe(false);
    expect(b.calls.length).toBeGreaterThan(before);
    expect(identity.needsFirstRun()).toBe(true);
  });
});

describe('deviceStore', () => {
  it('lists the devices, this computer first, and offers add and revoke only with the master key here', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    setPorts({ identity: b.port });
    let stores = mount();
    await flush();
    await flush();
    expect(stores.devices.devices().map((d) => [d.label, d.canRevoke])).toEqual([
      ['This computer', false],
      ['Device d2', true],
    ]);
    expect(stores.devices.canManage()).toBe(false);

    setPorts({ identity: custody(b.port, () => {}, true).identity });
    stores = mount();
    await flush();
    await flush();
    expect(stores.devices.canManage()).toBe(true);
  });

  it('on a phone, marks the phone’s key and not the key of the computer it reaches', async () => {
    // The backend is the computer's (d1, which it marks as its own); the phone's custody is d2.
    const b = backend({ did: DID, events: [incept, add], devices });
    const state: IdentityCustodyView = {
      ...NO_CUSTODY,
      did: DID,
      holdsMaster: true,
      unlock: 'os',
      devices: [{ keyId: 'd1', name: 'Desktop', kind: 'desktop-app', holdsMaster: 'no' }],
      requests: [{ id: 'r1', kind: 'confirm-revoke', by: 'd1', keyIds: ['d2'], expires: 99 }],
      thisDevice: { keyId: 'd2', kind: 'phone-app', form: 'phone' },
    };
    setPorts({ identity: signing(b.port, { custody: async () => state, change: async () => 'done' }) });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.devices().map((d) => [d.keyId, d.label, d.icon, d.thisDevice, d.canRevoke])).toEqual([
      ['d2', 'This phone', 'device-mobile', true, false],
      ['d1', 'Desktop', 'laptop', false, true],
    ]);
    expect(identity.keyLog().map((r) => [r.title, r.detail])).toEqual([
      ['Added this phone', 'd2 · This phone'],
      ['Created identity', 'with d1'],
    ]);
    expect(deviceStore.requests()[0].title).toBe('Desktop asks to remove This phone');
    // `unlinkSelf` would retire the backend's key (d1), not the phone's: the phone's row offers no unlink,
    // and neither the confirm nor the call can be reached.
    expect(deviceStore.devices().map((d) => [d.keyId, d.canUnlink])).toEqual([
      ['d2', false],
      ['d1', true],
    ]);
    expect(await deviceStore.unlinkThisComputer()).toBe('failed');
    expect(b.calls).not.toContain('unlinkSelf');
    expect(deviceStore.confirmingUnlink()).toBe(false);
    expect(deviceStore.error()).toContain("can't unlink itself");
  });

  it('revoke asks for that key and reads the list again', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    const c = custody(
      b.port,
      (change) => {
        if (change.kind === 'revoke') {
          b.state.events = [
            ...b.state.events,
            { seq: 2, op: 'revoke', hash: 'QmHash2', added: [], unlinked: [], revoked: [change.keyId] },
          ];
          b.state.devices = b.state.devices.map((d) => (d.keyId === change.keyId ? { ...d, revokedSeq: 2 } : d));
        }
      },
      true,
    );
    setPorts({ identity: c.identity });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(await deviceStore.revoke('d2')).toBe('done');
    await flush();
    await flush();
    expect(c.changes).toEqual([{ kind: 'revoke', keyId: 'd2' }]);
    expect(deviceStore.devices().find((d) => d.keyId === 'd2')).toMatchObject({
      revoked: true,
      status: 'Revoked',
    });
    expect(deviceStore.validCount()).toBe(1);
    expect(identity.keyLog()[0].title).toBe('Revoked d2');
  });

  it('leaves a bot key out of the devices and their count: Bots manages it', async () => {
    const botKey: DeviceKeyView = {
      keyId: 'd3',
      sign: 'z6MkBot',
      thisDevice: false,
      addedSeq: 2,
      unlinkedSeq: null,
      revokedSeq: null,
      bot: { can: ['read', 'write'], expires: 4_000_000_000 },
      expires: 4_000_000_000,
    };
    setPorts({ identity: backend({ did: DID, events: [incept, add], devices: [...devices, botKey] }).port });
    const { devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.devices().map((d) => d.keyId)).toEqual(['d1', 'd2']);
    expect(deviceStore.validCount()).toBe(2);
  });

  it('unlink asks for that key and the device reads Unlinked', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    const c = custody(
      b.port,
      (change) => {
        if (change.kind === 'unlink') {
          b.state.events = [
            ...b.state.events,
            { seq: 2, op: 'unlink', hash: 'QmHash2', added: [], unlinked: [change.keyId], revoked: [] },
          ];
          b.state.devices = b.state.devices.map((d) => (d.keyId === change.keyId ? { ...d, unlinkedSeq: 2 } : d));
        }
      },
      true,
    );
    setPorts({ identity: c.identity });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(await deviceStore.unlink('d2')).toBe('done');
    await flush();
    await flush();
    expect(c.changes).toEqual([{ kind: 'unlink', keyId: 'd2' }]);
    expect(deviceStore.devices().find((d) => d.keyId === 'd2')).toMatchObject({
      unlinked: true,
      revoked: false,
      status: 'Unlinked',
    });
    expect(deviceStore.validCount()).toBe(1);
    expect(identity.keyLog()[0].title).toBe('Unlinked d2');
  });

  describe('unlinking this computer', () => {
    const named = (d2Master: 'yes' | 'no' | 'offered') => [
      { keyId: 'd1', name: '', kind: 'desktop-app', holdsMaster: 'yes' as const },
      { keyId: 'd2', name: '', kind: 'server', holdsMaster: d2Master },
    ];
    /** This computer's own port: no master key needed, `unlinkSelf` answered by the backend. */
    function setup(holds: boolean, d2Master: 'yes' | 'no' | 'offered' = 'no') {
      const b = backend({ did: DID, events: [incept, add], devices });
      const c = custody(b.port, () => {}, holds);
      const view = c.identity.custody!;
      c.identity.custody = async () => ({ ...(await view()), holdsMaster: holds, devices: named(d2Master) });
      setPorts({ identity: c.identity });
      return { b, c, ...mount() };
    }

    it('confirms in the app first: no custody window, no call, until the person agrees', async () => {
      const { b, c, devices: deviceStore } = setup(false);
      await flush();
      await flush();
      expect(deviceStore.canManage()).toBe(false);
      expect(deviceStore.devices().map((d) => [d.keyId, d.thisDevice, d.canUnlink])).toEqual([
        ['d1', true, true],
        ['d2', false, true],
      ]);
      expect(deviceStore.confirmingUnlink()).toBe(false);
      expect(await deviceStore.unlink('d1')).toBe('cancelled');
      expect(deviceStore.confirmingUnlink()).toBe(true);
      expect(c.changes).toEqual([]);
      expect(b.calls).not.toContain('unlinkSelf');
      deviceStore.cancelUnlink();
      expect(deviceStore.confirmingUnlink()).toBe(false);
      expect(b.calls).not.toContain('unlinkSelf');
    });

    it('calls the port on confirm, with no custody window, then reads the status again, which shows no identity here', async () => {
      const { b, c, identity, devices: deviceStore } = setup(false);
      await flush();
      await flush();
      await deviceStore.unlink('d1');
      const reads = b.calls.filter((call) => call === 'status').length;
      expect(await deviceStore.unlinkThisComputer()).toBe('done');
      await flush();
      expect(b.calls.filter((call) => call === 'unlinkSelf')).toHaveLength(1);
      expect(c.changes).toEqual([]);
      expect(deviceStore.confirmingUnlink()).toBe(false);
      expect(b.calls.filter((call) => call === 'status').length).toBeGreaterThan(reads);
      expect(identity.did()).toBe('');
      expect(identity.keyId()).toBe('');
      expect(deviceStore.devices()).toEqual([]);
      expect(deviceStore.error()).toBe('');
    });

    it("reads the session's own agent again, so the shell holds the new DID and not the retired one", async () => {
      const { devices: deviceStore } = setup(false);
      await flush();
      await flush();
      expect(me().did).toBe(RETIRED_DID);
      await deviceStore.unlink('d1');
      expect(await deviceStore.unlinkThisComputer()).toBe('done');
      expect(me().did).toBe(NEW_DID);
    });

    it('warns that no master key is left when this computer keeps it and no other active device does', async () => {
      const { devices: deviceStore } = setup(true, 'no');
      await flush();
      await flush();
      expect(deviceStore.unlinkLeavesNoMaster()).toBe(true);
    });

    it.each([
      ['another device keeps it', true, 'yes'],
      ['another device is being sent it', true, 'offered'],
      ['this computer does not keep it', false, 'no'],
    ] as const)('does not warn about the master key when %s', async (_why, holds, d2) => {
      const { devices: deviceStore } = setup(holds, d2);
      await flush();
      await flush();
      expect(deviceStore.unlinkLeavesNoMaster()).toBe(false);
    });

    it('does not count a device that is unlinked or revoked as keeping the master key', async () => {
      const { b, devices: deviceStore } = setup(true, 'yes');
      b.state.devices = b.state.devices.map((d) => (d.keyId === 'd2' ? { ...d, unlinkedSeq: 2 } : d));
      await deviceStore.refresh();
      await flush();
      expect(deviceStore.unlinkLeavesNoMaster()).toBe(true);
    });

    it('says why the executor refused, in the error slot, and stays linked', async () => {
      const { b, identity, devices: deviceStore } = setup(false);
      b.state.refuse = new Error('This computer is already unlinked.');
      await flush();
      await flush();
      await deviceStore.unlink('d1');
      expect(await deviceStore.unlinkThisComputer()).toBe('failed');
      expect(deviceStore.error()).toBe('This computer is already unlinked.');
      expect(deviceStore.confirmingUnlink()).toBe(false);
      expect(identity.did()).toBe(DID);
      expect(me().did).toBe(RETIRED_DID);
    });

    it('says an unlink with no definite answer may have happened, reads the status again, and can be tried again', async () => {
      const { b, identity, devices: deviceStore } = setup(false);
      b.state.refuse = new UnlinkUncertainError('This computer may already be unlinked. Check again, or try again.');
      await flush();
      await flush();
      await deviceStore.unlink('d1');
      const reads = b.calls.filter((call) => call === 'status').length;
      expect(await deviceStore.unlinkThisComputer()).toBe('uncertain');
      expect(deviceStore.error()).toBe('This computer may already be unlinked. Check again, or try again.');
      expect(b.calls.filter((call) => call === 'status').length).toBeGreaterThan(reads);
      expect(deviceStore.unlinking()).toBe(false);
      // The status still lists this computer: the row offers the unlink again.
      expect(identity.did()).toBe(DID);
      expect(deviceStore.devices().find((d) => d.thisDevice)?.canUnlink).toBe(true);
      await deviceStore.unlink('d1');
      expect(deviceStore.confirmingUnlink()).toBe(true);
      b.state.refuse = undefined;
      expect(await deviceStore.unlinkThisComputer()).toBe('done');
      expect(b.calls.filter((call) => call === 'unlinkSelf')).toHaveLength(2);
    });

    it('frees the device buttons when reading again after the unlink throws', async () => {
      const { devices: deviceStore } = setup(false);
      await flush();
      await flush();
      await deviceStore.unlink('d1');
      refreshMeFails = new Error('the agent could not be read');
      await expect(deviceStore.unlinkThisComputer()).rejects.toThrow('the agent could not be read');
      expect(deviceStore.unlinking()).toBe(false);
      expect(deviceStore.confirmingUnlink()).toBe(false);
    });

    describe('while the unlink is in flight', () => {
      function inFlight() {
        const s = setup(false);
        let release!: () => void;
        s.b.state.gate = new Promise<void>((resolve) => (release = resolve));
        return { ...s, release };
      }

      it('sends one call for a repeated confirm, and keeps the confirm up until it settles', async () => {
        const { b, devices: deviceStore, release } = inFlight();
        await flush();
        await flush();
        await deviceStore.unlink('d1');
        const first = deviceStore.unlinkThisComputer();
        expect(deviceStore.unlinking()).toBe(true);
        expect(deviceStore.confirmingUnlink()).toBe(true);
        expect(await deviceStore.unlinkThisComputer()).toBe('cancelled');
        await flush();
        expect(b.calls.filter((call) => call === 'unlinkSelf')).toHaveLength(1);
        release();
        expect(await first).toBe('done');
        expect(deviceStore.unlinking()).toBe(false);
        expect(deviceStore.confirmingUnlink()).toBe(false);
        expect(b.calls.filter((call) => call === 'unlinkSelf')).toHaveLength(1);
      });

      it('opens no identity step (replace the master key, restore, remove it) until it settles', async () => {
        const { devices: deviceStore, release } = inFlight();
        await flush();
        await flush();
        await deviceStore.unlink('d1');
        const first = deviceStore.unlinkThisComputer();
        expect(await deviceStore.replaceMaster()).toBe('cancelled');
        expect(await deviceStore.restore()).toBe('cancelled');
        expect(await deviceStore.removeMaster()).toBe('cancelled');
        release();
        expect(await first).toBe('done');
      });

      it('cannot be raised again, and cancelling after the submit does nothing', async () => {
        const { b, devices: deviceStore, release } = inFlight();
        await flush();
        await flush();
        await deviceStore.unlink('d1');
        const first = deviceStore.unlinkThisComputer();
        deviceStore.cancelUnlink();
        expect(deviceStore.confirmingUnlink()).toBe(true);
        expect(await deviceStore.unlink('d1')).toBe('cancelled');
        expect(deviceStore.confirmingUnlink()).toBe(true);
        release();
        await first;
        expect(b.calls.filter((call) => call === 'unlinkSelf')).toHaveLength(1);
      });
    });
  });

  it('reads this computer unlinked from the status, as it reads it revoked, and offers no master key request then', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    const linked = b.port.status!;
    b.port.status = async () => ({ ...(await linked()), unlinked: 2 });
    setPorts({ identity: custody(b.port, () => {}, false).identity });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(identity.thisDeviceUnlinked()).toBe(true);
    expect(identity.thisDeviceRevoked()).toBe(false);
    expect(deviceStore.canAskMaster()).toBe(false);
  });

  it('unlinking another device leaves this computer linked', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    const c = custody(b.port, () => {}, true);
    setPorts({ identity: c.identity });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(await deviceStore.unlink('d2')).toBe('done');
    await flush();
    await flush();
    expect(identity.did()).toBe(DID);
    expect(identity.keyId()).toBe('d1');
  });

  it('add asks for add-device', async () => {
    const c = custody(backend({ did: DID, events: [incept], devices: [devices[1]] }).port, () => {}, true);
    setPorts({ identity: c.identity });
    const { devices: deviceStore } = mount();
    await flush();
    await deviceStore.addDevice();
    expect(c.changes).toEqual([{ kind: 'add-device' }]);
  });

  it('names each device from the private record, says who keeps the master key, and lists requests', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    const state: IdentityCustodyView = {
      ...NO_CUSTODY,
      did: DID,
      holdsMaster: true,
      unlock: 'os',
      devices: [
        { keyId: 'd1', name: 'Desktop', kind: 'desktop-app', holdsMaster: 'yes' },
        { keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'offered' },
      ],
      requests: [{ id: 'r1', kind: 'send-master', by: 'd2', keyIds: [], expires: 99 }],
    };
    const changes: IdentityChange[] = [];
    setPorts({
      identity: signing(b.port, {
        custody: async () => state,
        async change(change) {
          changes.push(change);
          return 'done';
        },
      }),
    });
    const { devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.devices().map((d) => [d.label, d.master])).toEqual([
      ['Desktop', 'Has master key'],
      ['Laptop', 'Master key sent'],
    ]);
    expect(deviceStore.requests()).toEqual([
      {
        id: 'r1',
        kind: 'send-master',
        title: 'Laptop asks for the master key',
        detail: 'It could then add and remove devices.',
      },
    ]);
    expect(deviceStore.canAskMaster()).toBe(false);

    await deviceStore.answerRequest('r1');
    await deviceStore.rename('d2');
    await deviceStore.scanDevice();
    expect(changes).toEqual([
      { kind: 'answer-request', id: 'r1' },
      { kind: 'rename', keyId: 'd2' },
      { kind: 'scan-device' },
    ]);
  });

  it('on a linked device without the master key: no requests, ask for the key, and take it once sent', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    let state: IdentityCustodyView = {
      ...NO_CUSTODY,
      did: null,
      unlock: 'os',
      // Requests are the holder's to answer; a device without the key does not list them.
      requests: [{ id: 'r1', kind: 'send-master', by: 'd2', keyIds: [], expires: 99 }],
    };
    const changes: IdentityChange[] = [];
    setPorts({
      identity: signing(b.port, {
        custody: async () => state,
        async change(change) {
          changes.push(change);
          if (change.kind === 'ask-master') state = { ...state, masterWaiting: true };
          if (change.kind === 'take-master') state = { ...state, did: DID, holdsMaster: true, masterWaiting: false };
          return 'done';
        },
      }),
    });
    const { devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.canManage()).toBe(false);
    expect(deviceStore.requests()).toEqual([]);
    expect(deviceStore.canShowCode()).toBe(false);
    expect(deviceStore.canAskMaster()).toBe(true);

    await deviceStore.askMaster();
    expect(deviceStore.masterWaiting()).toBe(true);
    expect(deviceStore.canAskMaster()).toBe(false);
    await deviceStore.takeMaster();
    expect(changes).toEqual([{ kind: 'ask-master' }, { kind: 'take-master' }]);
    expect(deviceStore.masterWaiting()).toBe(false);
    expect(deviceStore.canManage()).toBe(true);
    expect(deviceStore.requests().map((r) => r.id)).toEqual(['r1']);
  });

  it('on a computer that lost its enc key: says so, offers no master key step, and claims no names', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    const state: IdentityCustodyView = {
      ...NO_CUSTODY,
      did: DID,
      unlock: 'os',
      // Neither can open here; a stale record or a waiting master key must not be offered as if it could.
      devices: [{ keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'yes' }],
      masterWaiting: true,
      encMismatch: true,
    };
    setPorts({
      identity: signing(b.port, { custody: async () => state, change: async () => 'done' }),
    });
    const { devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.encMismatch()).toBe(true);
    expect(deviceStore.masterWaiting()).toBe(false);
    expect(deviceStore.canAskMaster()).toBe(false);
    expect(deviceStore.devices().map((d) => [d.label, d.master])).toEqual([
      ['This computer', ''],
      ['Device d2', ''],
    ]);
  });

  it('on a computer that lost its enc key: still warns of a revoked holder from the key log, and offers the words', async () => {
    const revokedD2 = devices.map((d) => (d.keyId === 'd2' ? { ...d, revokedSeq: 2 } : d));
    const revoke = { seq: 2, op: 'revoke', hash: 'QmHash2', added: [], unlinked: [], revoked: ['d2'] };
    const b = backend({ did: DID, events: [incept, add, revoke], devices: revokedD2 });
    const state: IdentityCustodyView = {
      ...NO_CUSTODY,
      did: DID,
      unlock: 'os',
      // The record's word that d2 took the master key cannot be read here; the key log's can.
      devices: [{ keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'yes' }],
      endedHolders: ['d2'],
      encMismatch: true,
    };
    setPorts({ identity: signing(b.port, { custody: async () => state, change: async () => 'done' }) });
    const { devices: deviceStore } = mount();
    await flush();
    await flush();
    const d2 = deviceStore.devices().find((d) => d.keyId === 'd2')!;
    expect(d2.label).toBe('Device d2');
    expect(d2.master).toBe('May still have your master key. Replace it to lock this device out.');
    expect(d2.replaceMaster).toBe(true);
    // The words sign a rotation, and the new key is kept here: nothing sent to this computer is needed.
    expect(deviceStore.canReplaceMaster()).toBe(true);
    expect(deviceStore.canAskMaster()).toBe(false);
  });

  it('offers "Show code" on a computer of no identity, and reads the identity once it joined', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    const changes: IdentityChange[] = [];
    setPorts({
      identity: signing(b.port, {
        custody: async () => ({ ...NO_CUSTODY, unlock: 'os' }),
        async change(change) {
          changes.push(change);
          b.state.did = DID;
          b.state.events = [incept, add];
          b.state.devices = devices;
          return 'done';
        },
      }),
    });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.canShowCode()).toBe(true);
    expect(await deviceStore.showCode()).toBe('done');
    await flush();
    expect(changes).toEqual([{ kind: 'show-code' }]);
    expect(identity.did()).toBe(DID);
    expect(deviceStore.canShowCode()).toBe(false);
  });

  it('offers "Restore with recovery phrase" beside "Show code", and reads the identity it restored', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    const changes: IdentityChange[] = [];
    let state: IdentityCustodyView = { ...NO_CUSTODY, unlock: 'os' };
    setPorts({
      identity: signing(b.port, {
        custody: async () => state,
        async change(change) {
          changes.push(change);
          b.state.did = DID;
          b.state.events = [incept, add];
          b.state.devices = devices;
          state = { ...state, did: DID, holdsMaster: true };
          return 'done';
        },
      }),
    });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.canRestore()).toBe(true);
    expect(deviceStore.canShowCode()).toBe(true);
    // Nothing to replace or remove before there is an identity here.
    expect(deviceStore.canReplaceMaster()).toBe(false);
    expect(deviceStore.canRemoveMaster()).toBe(false);
    expect(await deviceStore.restore()).toBe('done');
    await flush();
    expect(changes).toEqual([{ kind: 'restore' }]);
    expect(identity.did()).toBe(DID);
    expect(deviceStore.canRestore()).toBe(false);
    // The only copy of the master key is here: sign out does not offer to remove it.
    expect(deviceStore.canRemoveMaster()).toBe(false);
  });

  it('offers to remove the master key on sign out only where another active device keeps it', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    let laptop: DeviceNameView['holdsMaster'] = 'offered';
    setPorts({
      identity: signing(b.port, {
        custody: async () => ({
          ...NO_CUSTODY,
          did: DID,
          holdsMaster: true,
          unlock: 'os',
          devices: [{ keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: laptop }],
        }),
        change: async () => 'done',
      }),
    });
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    // Sent and not yet taken: this is still the only copy the custody service counts.
    expect(deviceStore.canRemoveMaster()).toBe(false);
    laptop = 'yes';
    await identity.refresh();
    expect(deviceStore.canRemoveMaster()).toBe(true);
    // A holder that is no longer linked keeps no copy the identity can use.
    b.state.devices = devices.map((d) => (d.keyId === 'd2' ? { ...d, unlinkedSeq: 2 } : d));
    await deviceStore.refresh();
    await identity.refresh();
    expect(deviceStore.canRemoveMaster()).toBe(false);
  });

  it('offers no words without a custody service to take them', async () => {
    setPorts({ identity: backend({ did: null, events: [], devices: [] }).port });
    const { devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(deviceStore.canRestore()).toBe(false);
    expect(deviceStore.canReplaceMaster()).toBe(false);
  });

  it('replaces the master key on a device that does not keep it, and the revoked holder stops warning', async () => {
    const revokedD2 = devices.map((d) => (d.keyId === 'd2' ? { ...d, revokedSeq: 2 } : d));
    const revoke = { seq: 2, op: 'revoke', hash: 'QmHash2', added: [], unlinked: [], revoked: ['d2'] };
    const b = backend({ did: DID, events: [incept, add, revoke], devices: revokedD2 });
    let state: IdentityCustodyView = { ...NO_CUSTODY, did: DID, unlock: 'os', endedHolders: ['d2'] };
    const changes: IdentityChange[] = [];
    setPorts({
      identity: signing(b.port, {
        custody: async () => state,
        async change(change) {
          changes.push(change);
          if (change.kind === 'replace-master') {
            b.state.events = [
              ...b.state.events,
              { seq: 3, op: 'rotate', hash: 'QmHash3', added: [], unlinked: [], revoked: [] },
            ];
            // The record may still list the old holder: the rotation, not the record, settles it.
            state = {
              ...state,
              holdsMaster: true,
              endedHolders: [],
              devices: [{ keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'yes' }],
            };
          }
          if (change.kind === 'remove-master') state = { ...state, holdsMaster: false };
          return 'done';
        },
      }),
    });
    const { devices: deviceStore } = mount();
    await flush();
    await flush();
    const d2 = () => deviceStore.devices().find((d) => d.keyId === 'd2')!;
    expect(d2().master).toContain('Replace it to lock this device out');
    expect(d2().replaceMaster).toBe(true);
    // Not keeping the master key is the point: the lost device kept it.
    expect(deviceStore.canManage()).toBe(false);
    expect(deviceStore.canReplaceMaster()).toBe(true);
    expect(deviceStore.canRemoveMaster()).toBe(false);

    expect(await deviceStore.replaceMaster()).toBe('done');
    await flush();
    await flush();
    expect(d2()).toMatchObject({ master: '', replaceMaster: false });
    // The revoked laptop keeps no copy the identity can use, so the new key here is the only one.
    expect(deviceStore.canRemoveMaster()).toBe(false);
    expect(await deviceStore.removeMaster()).toBe('done');
    await flush();
    expect(changes).toEqual([{ kind: 'replace-master' }, { kind: 'remove-master' }]);
  });
});
