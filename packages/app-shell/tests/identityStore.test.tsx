/**
 * identityStore and deviceStore: what they read from the backend's identity port,
 * what they ask of the host's custody service, and that they never hold anything but public state.
 */
import type { CustodyPublic, IdentityHost, IdentityStep } from '@shared/platform/types';
import { render } from '@solidjs/testing-library';
import type { DeviceKeyView, IdentityPort, KeyLogView } from '@we/backend-shared';
import { NO_IDENTITY_CAPABILITIES } from '@we/backend-shared';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let identityHost: IdentityHost | undefined;
const [ports, setPorts] = createSignal<{ identity?: IdentityPort } | null>(null);
const [bootState, setBootState] = createSignal('ready');

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ isDesktop: true, isDevelopment: true, identity: identityHost }),
}));
vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ backendPorts: ports, bootState }),
}));

import { type DeviceStore, DeviceStoreProvider, useDeviceStore } from '../src/frameworks/solid/stores/DeviceStore';
import {
  type IdentityStore,
  IdentityStoreProvider,
  START_NOW_KEY,
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

/** A custody host that runs each step by changing the backend's state, as the identity window would. */
function custody(onStep: (step: IdentityStep) => void, holds: CustodyPublic['holdsMaster'] = null) {
  const steps: IdentityStep[] = [];
  let state: CustodyPublic = { did: null, holdsMaster: holds, unlock: 'passphrase' };
  const host: IdentityHost = {
    async open(step) {
      steps.push(step);
      onStep(step);
      state = { ...state, did: DID, holdsMaster: { index: 0 } };
      return 'done';
    },
    async publicState() {
      return state;
    },
  };
  return { host, steps };
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
  identityHost = undefined;
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

  it('asks the first-run question only where the shell keeps master keys', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    setPorts({ identity: b.port });
    // The web or Electron: no custody, no question, no way to change the identity.
    let stores = mount();
    await flush();
    await flush();
    expect(stores.identity.needsFirstRun()).toBe(false);
    expect(stores.identity.canChange()).toBe(false);
    await expect(stores.identity.makeIdentity()).rejects.toThrow();

    identityHost = custody(() => {}).host;
    stores = mount();
    await flush();
    await flush();
    expect(stores.identity.needsFirstRun()).toBe(true);
  });

  it('"Make my identity here" opens the window on create, then reads the new identity', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    setPorts({ identity: b.port });
    const c = custody((step) => {
      if (step.kind === 'create') {
        b.state.did = DID;
        b.state.events = [incept];
        b.state.devices = [devices[1]];
      }
    });
    identityHost = c.host;
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(identity.needsFirstRun()).toBe(true);
    expect(await identity.makeIdentity()).toBe('done');
    await flush();
    await flush();
    expect(c.steps).toEqual([{ kind: 'create' }]);
    expect(identity.did()).toBe(DID);
    expect(identity.needsFirstRun()).toBe(false);
    expect(identity.keyLog().map((r) => r.title)).toEqual(['Created your identity']);
    expect(identity.custody()?.holdsMaster).toEqual({ index: 0 });
    expect(deviceStore.devices().map((d) => d.label)).toEqual(['This computer']);
  });

  it('on a build with no identity store, asks the question but opens no window, and says why', async () => {
    setPorts({ identity: backend({ did: null, events: [], devices: [] }).port });
    const why = 'This build of Coasys has no identity store set up, so it cannot make or change an identity yet.';
    const opened: IdentityStep[] = [];
    identityHost = {
      async open(step) {
        opened.push(step);
        return 'done';
      },
      async publicState() {
        return { did: null, holdsMaster: null, unlock: 'passphrase', blocked: why };
      },
    };
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    // The first run still comes up, so the person learns why; "Make my identity here" is off.
    expect(identity.needsFirstRun()).toBe(true);
    expect(identity.changeBlocked()).toBe(why);
    expect(identity.canChange()).toBe(false);
    expect(deviceStore.canManage()).toBe(false);
    await expect(identity.makeIdentity()).rejects.toThrow(why);
    await expect(identity.open({ kind: 'add-device' })).rejects.toThrow(why);
    expect(opened).toEqual([]);
    expect(identity.busy()).toBe(false);
  });

  it('"Start now" puts the question away on this computer', async () => {
    setPorts({ identity: backend({ did: null, events: [], devices: [] }).port });
    identityHost = custody(() => {}).host;
    const { identity } = mount();
    await flush();
    await flush();
    identity.startWithoutIdentity();
    expect(identity.needsFirstRun()).toBe(false);
    expect(localStorage.getItem(START_NOW_KEY)).toBe('1');
  });

  it('reports a step the window cancelled, and reads again all the same', async () => {
    const b = backend({ did: null, events: [], devices: [] });
    setPorts({ identity: b.port });
    identityHost = {
      async open() {
        return 'cancelled';
      },
      async publicState() {
        return { did: null, holdsMaster: null, unlock: 'passphrase' };
      },
    };
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

    identityHost = custody(() => {}, { index: 0 }).host;
    stores = mount();
    await flush();
    await flush();
    expect(stores.devices.canManage()).toBe(true);
  });

  it('revoke opens the window on that key and reads the list again', async () => {
    const b = backend({ did: DID, events: [incept, add], devices });
    setPorts({ identity: b.port });
    const c = custody(
      (step) => {
        if (step.kind === 'revoke') {
          b.state.events = [
            ...b.state.events,
            { seq: 2, op: 'revoke', hash: 'QmHash2', added: [], revoked: [step.keyId] },
          ];
          b.state.devices = b.state.devices.map((d) => (d.keyId === step.keyId ? { ...d, revokedSeq: 2 } : d));
        }
      },
      { index: 0 },
    );
    identityHost = c.host;
    const { identity, devices: deviceStore } = mount();
    await flush();
    await flush();
    expect(await deviceStore.revoke('d2')).toBe('done');
    await flush();
    await flush();
    expect(c.steps).toEqual([{ kind: 'revoke', keyId: 'd2' }]);
    expect(deviceStore.devices().find((d) => d.keyId === 'd2')).toMatchObject({
      revoked: true,
      status: 'Revoked at #2',
    });
    expect(deviceStore.validCount()).toBe(1);
    expect(identity.keyLog()[0].title).toBe('Revoked d2');
  });

  it('add opens the window on add-device', async () => {
    setPorts({ identity: backend({ did: DID, events: [incept], devices: [devices[1]] }).port });
    const c = custody(() => {}, { index: 0 });
    identityHost = c.host;
    const { devices: deviceStore } = mount();
    await flush();
    await deviceStore.addDevice();
    expect(c.steps).toEqual([{ kind: 'add-device' }]);
  });
});
