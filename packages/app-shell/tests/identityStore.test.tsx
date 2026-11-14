/**
 * identityStore and deviceStore: what they read from the backend's identity port, which changes
 * they ask it for, and that they never hold anything but public state.
 */
import { render } from '@solidjs/testing-library';
import type {
  DeviceKeyView,
  IdentityChange,
  IdentityChangeOutcome,
  IdentityCustodyView,
  IdentityPort,
  KeyLogView,
  ServingSessionEnded,
  ServingView,
} from '@we/backend-shared';
import { NO_IDENTITY_CAPABILITIES } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const [ports, setPorts] = createSignal<{ identity?: IdentityPort } | null>(null);
const [bootState, setBootState] = createSignal('ready');

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: ports,
    bootState,
    // As the session reads them from the port: linking a device needs a way to sign changes.
    identityCapabilities: () => ({
      ...NO_IDENTITY_CAPABILITIES,
      keyLog: true,
      devices: true,
      linkDevice: !!ports()?.identity?.change,
      switchDevice: !!ports()?.identity?.serving,
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

const DID = 'did:scid:coasys:1:QmScid';
const flush = () => new Promise((r) => setTimeout(r, 0));

const status = (did: string | null) => ({
  did,
  deviceKey: 'z6MkOne',
  keyId: did ? 'd1' : null,
  revoked: null,
  head: null,
  fork: null,
  storeBehind: null,
});

const incept: KeyLogView['events'][number] = {
  seq: 0,
  op: 'incept',
  hash: 'QmHash0',
  added: [{ id: 'd1', sign: 'z6MkOne' }],
  revoked: [],
};
const add: KeyLogView['events'][number] = {
  seq: 1,
  op: 'add',
  hash: 'QmHash1',
  added: [{ id: 'd2', sign: 'z6MkTwo' }],
  revoked: [],
};
const devices: DeviceKeyView[] = [
  { keyId: 'd2', sign: 'z6MkTwo', thisDevice: false, addedSeq: 1, revokedSeq: null },
  { keyId: 'd1', sign: 'z6MkOne', thisDevice: true, addedSeq: 0, revokedSeq: null },
];

/** A backend whose identity is whatever the test says, and which counts what it was asked. */
function backend(state: { did: string | null; events: KeyLogView['events']; devices: DeviceKeyView[] }) {
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
  };
  return { port, calls, state };
}

const NO_CUSTODY: IdentityCustodyView = { did: null, holdsMaster: false, unlock: 'passphrase', blocked: null };

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
  setBootState('ready');
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
    expect(identity.keyLog().map((r) => r.title)).toEqual(['Added d2', 'Created your identity']);
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
    expect(identity.keyLog().map((r) => r.title)).toEqual(['Created your identity']);
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

  it('revoke asks for that key and reads the list again', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    const c = custody(
      b.port,
      (change) => {
        if (change.kind === 'revoke') {
          b.state.events = [
            ...b.state.events,
            { seq: 2, op: 'revoke', hash: 'QmHash2', added: [], revoked: [change.keyId] },
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
      status: 'Revoked at #2',
    });
    expect(deviceStore.validCount()).toBe(1);
    expect(identity.keyLog()[0].title).toBe('Revoked d2');
  });

  it('add asks for add-device', async () => {
    const c = custody(backend({ did: DID, events: [incept], devices: [devices[1]] }).port, () => {}, true);
    setPorts({ identity: c.identity });
    const { devices: deviceStore } = mount();
    await flush();
    await deviceStore.addDevice();
    expect(c.changes).toEqual([{ kind: 'add-device' }]);
  });
});

describe('which device serves you', () => {
  /** A backend that can log in to servers: they are whatever the test lists, and refuse what it says. */
  function servingBackend(refuse: Record<string, { reason: string; message: string }> = {}) {
    const b = backend({ did: DID, events: [incept], devices: [devices[1]] });
    const calls: string[] = [];
    let servers: { id: string; name: string }[] = [];
    let current = 'this-computer';
    let end: ((ended: ServingSessionEnded) => void) | null = null;
    const view = (): ServingView => ({
      devices: [
        { id: 'this-computer', name: 'This computer', address: null, current: current === 'this-computer' },
        ...servers.map((s) => ({ id: s.id, name: s.name, address: s.id, current: current === s.id })),
      ],
      role: current === 'this-computer' ? null : 'operator',
      problem: null,
    });
    const port: IdentityPort = {
      ...b.port,
      serving: async () => view(),
      async addServer(address) {
        calls.push(`add:${address}`);
        if (refuse[address]) return { ok: false, ...refuse[address] };
        servers = [...servers, { id: address, name: new URL(address).host }];
        return { ok: true, id: address };
      },
      async removeServer(id) {
        calls.push(`remove:${id}`);
        servers = servers.filter((s) => s.id !== id);
      },
      async serveFrom(id) {
        calls.push(`serve:${id}`);
        current = id;
      },
      onSessionEnded(listener) {
        end = listener;
        return () => {
          end = null;
        };
      },
    };
    return {
      port,
      calls,
      end: (ended: ServingSessionEnded) => end?.(ended),
      serveHere: (id: string) => (current = id),
    };
  }

  it('is not offered where the backend cannot log in to a server', async () => {
    setPorts({ identity: backend({ did: DID, events: [incept], devices }).port });
    const { devices: deviceStore } = mount();
    await flush();
    expect(deviceStore.canSwitch()).toBe(false);
    expect(deviceStore.servers()).toEqual([]);
  });

  it('lists this computer, adds a server by its address and switches to it', async () => {
    const s = servingBackend();
    setPorts({ identity: s.port });
    const { devices: deviceStore } = mount();
    await flush();
    expect(deviceStore.canSwitch()).toBe(true);
    expect(deviceStore.servers()).toEqual([
      {
        id: 'this-computer',
        name: 'This computer',
        subtitle: 'Available while this computer is on',
        icon: 'desktop',
        current: true,
        canRemove: false,
      },
    ]);

    deviceStore.setServerAddress('  https://server.example:12000 ');
    const outcome = await deviceStore.addServer();
    expect(outcome).toEqual({ ok: true, id: 'https://server.example:12000' });
    expect(s.calls).toEqual(['add:https://server.example:12000']);
    expect(deviceStore.serverAddress()).toBe('');
    expect(deviceStore.servers()[1]).toMatchObject({
      name: 'server.example:12000',
      subtitle: 'https://server.example:12000',
      icon: 'cloud',
      current: false,
      canRemove: true,
    });

    await deviceStore.serveFrom('https://server.example:12000');
    expect(s.calls.at(-1)).toBe('serve:https://server.example:12000');
  });

  it('says why a server would not let this computer in, and lists nothing', async () => {
    const s = servingBackend({
      'https://other.example': { reason: 'not-known', message: "You don't have access to this host." },
    });
    setPorts({ identity: s.port });
    const { devices: deviceStore } = mount();
    await flush();
    deviceStore.setServerAddress('https://other.example');
    expect(await deviceStore.addServer()).toMatchObject({ ok: false, reason: 'not-known' });
    expect(deviceStore.serverError()).toBe("You don't have access to this host.");
    expect(deviceStore.servers()).toHaveLength(1);
    // The address stays, to be corrected.
    expect(deviceStore.serverAddress()).toBe('https://other.example');
  });

  it('marks the server serving now, its role, and forgets another', async () => {
    const s = servingBackend();
    setPorts({ identity: s.port });
    const { devices: deviceStore } = mount();
    await flush();
    for (const address of ['https://a.example', 'https://b.example']) {
      deviceStore.setServerAddress(address);
      await deviceStore.addServer();
    }
    s.serveHere('https://a.example');
    await deviceStore.refreshServers();
    expect(deviceStore.servingRole()).toBe('operator');
    expect(deviceStore.servers().map((r) => [r.id, r.current, r.canRemove])).toEqual([
      ['this-computer', false, false],
      ['https://a.example', true, false],
      ['https://b.example', false, true],
    ]);

    await deviceStore.removeServer('https://b.example');
    expect(deviceStore.servers()).toHaveLength(2);
  });

  it('says a revoked device was removed, wherever the person is, and goes back to this computer', async () => {
    const s = servingBackend();
    setPorts({ identity: s.port });
    const { devices: deviceStore } = mount();
    await flush();

    s.end({ reason: 'revoked', id: 'https://a.example', name: 'a.example' });
    expect(deviceStore.sessionEnded()).toMatchObject({
      reason: 'revoked',
      message: "You're signed out of a.example because this device was removed.",
    });
    const toast = toastService.toasts().find((t) => t.message === deviceStore.sessionEnded()?.message);
    expect(toast).toMatchObject({ tone: 'danger', duration: 0, action: { label: 'Switch to this computer' } });

    toast?.action?.run();
    await flush();
    expect(s.calls.at(-1)).toBe('serve:this-computer');
    toastService.remove(toast!.id);
  });

  it('says an ended session in plain words', async () => {
    const s = servingBackend();
    setPorts({ identity: s.port });
    const { devices: deviceStore } = mount();
    await flush();
    s.end({ reason: 'ended', id: 'https://a.example', name: 'a.example' });
    expect(deviceStore.sessionEnded()?.message).toBe("You're signed out of a.example.");
    for (const t of toastService.toasts()) toastService.remove(t.id);
  });
});
