/**
 * baseStore: the app before a session, over a host of fakes — the order it asks things in (the
 * device's own backend, the identity, the first run, the connection), what it remembers, and how a
 * place that cannot be reached comes back as the offline state.
 */
import type { IdentityChangeOutcome, IdentityCustodyView } from '@we/backend-shared';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_CONNECTION_KEY,
  type BaseStorage,
  type BaseStore,
  type BaseStoreOptions,
  createBaseStore,
} from '../src/frameworks/solid/stores/BaseStore';
import { START_NOW_HERE_KEY } from '../src/frameworks/solid/stores/IdentityStore';
import type {
  BaseConnection,
  BaseExecutorState,
  BaseHost,
  BaseIdentitySource,
  BaseIdentityStep,
} from '../src/shared/platform/baseHost';

const DID = 'did:scid:coasys:1:QmTestIdentity';
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
async function until(check: () => boolean, ms = 2_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 5))) if (check()) return;
  throw new Error('timed out waiting');
}

const view = (over: Partial<IdentityCustodyView> = {}): IdentityCustodyView => ({
  did: null,
  holdsMaster: false,
  unlock: null,
  blocked: null,
  devices: [],
  revokedHolders: [],
  requests: [],
  masterWaiting: false,
  ...over,
});

const HERE: BaseConnection = { id: 'this-device', kind: 'this-device', label: 'This computer', detail: 'Here' };
const SERVER: BaseConnection = { id: 'server:a', kind: 'server', label: 'Test server', detail: 'https://a.test' };

function memoryStorage(seed: Record<string, string> = {}): BaseStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** An identity source whose state the test sets, and whose steps it answers. */
function fakeIdentity(
  initial: IdentityCustodyView,
  answer: (step: BaseIdentityStep) => IdentityChangeOutcome = () => 'done',
) {
  let state = initial;
  const opened: BaseIdentityStep[] = [];
  const source: BaseIdentitySource = {
    state: vi.fn(async () => state),
    doors: {
      make: { step: { kind: 'create' } },
      link: { step: { kind: 'show-code' } },
      words: { step: null, note: 'No words here.' },
    },
    open: async (step) => {
      opened.push(step);
      return answer(step);
    },
  };
  return { source, opened, set: (next: IdentityCustodyView) => (state = next) };
}

/** A backend this device runs, whose state the test moves. */
function fakeExecutor(initial: BaseExecutorState) {
  let state = initial;
  const listeners = new Set<(s: BaseExecutorState) => void>();
  const starts: number[] = [];
  return {
    executor: {
      state: () => state,
      subscribe: (l: (s: BaseExecutorState) => void) => (listeners.add(l), () => listeners.delete(l)),
      start: async () => void starts.push(Date.now()),
    },
    starts,
    move(next: BaseExecutorState) {
      state = next;
      for (const l of listeners) l(next);
    },
  };
}

function host(over: Partial<BaseHost> = {}): BaseHost {
  return {
    kind: 'computer',
    connections: async () => [HERE, SERVER],
    connector: async () => {
      throw new Error('not used: the test hands off through onHandOff');
    },
    ...over,
  };
}

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
});

function make(h: BaseHost, options: Partial<BaseStoreOptions> = {}) {
  const handedOff: BaseConnection[] = [];
  const storage = (options.storage as ReturnType<typeof memoryStorage>) ?? memoryStorage();
  let store!: BaseStore;
  createRoot((d) => {
    dispose = d;
    store = createBaseStore(h, {
      brand: { name: 'Test', mark: '' },
      onHandOff: async (c) => void handedOff.push(c),
      storage,
      identityRetryMs: 1,
      ...options,
    });
  });
  return { store, handedOff, storage };
}

describe('baseStore, the order of things', () => {
  it('asks nothing until the device backend is up, and says why it failed', async () => {
    const own = fakeExecutor({ phase: 'starting' });
    const identity = fakeIdentity(view());
    const { store } = make(host({ executor: own.executor, identity: identity.source }));
    await flush();
    expect(store.stage()).toBe('starting');
    expect(store.executorPhase()).toBe('starting');
    expect(identity.source.state).not.toHaveBeenCalled();

    own.move({ phase: 'failed', reason: 'The executor refused its settings.' });
    await flush();
    expect(store.stage()).toBe('failed');
    expect(store.executorReason()).toBe('The executor refused its settings.');

    await store.retry();
    expect(own.starts).toHaveLength(1);
    expect(store.stage()).toBe('starting');

    own.move({ phase: 'ready' });
    await until(() => store.stage() === 'first-run');
    expect(identity.source.state).toHaveBeenCalled();
  });

  it('asks the first run on a device that keeps no identity, and never on one that does', async () => {
    const none = make(host({ identity: fakeIdentity(view()).source }));
    await until(() => none.store.stage() === 'first-run');
    dispose?.();

    const some = make(host({ identity: fakeIdentity(view({ did: DID, holdsMaster: true, unlock: 'os' })).source }));
    await until(() => some.store.stage() === 'connect');
    expect(some.store.did()).toBe(DID);
    expect(some.store.holdsMaster()).toBe(true);
    expect(some.store.keepsLine()).toBe('This computer keeps your master key behind its own sign-in');
  });

  it('asks no first run where the device keeps no identity source (a browser)', async () => {
    const { store } = make(host({ kind: 'browser' }));
    await until(() => store.stage() === 'connect');
    expect(store.hasIdentity()).toBe(false);
    expect(store.doors().make.open).toBe(false);
    expect(store.doors().make.note).toMatch(/keeps no identity of its own/);
  });

  it('reads an identity source that is still starting again, then says it could not', async () => {
    let calls = 0;
    const source: BaseIdentitySource = {
      ...fakeIdentity(view()).source,
      state: async () => {
        calls += 1;
        if (calls < 3) throw new Error('not up yet');
        return view({ did: DID });
      },
    };
    const ok = make(host({ identity: source }), { identityAttempts: 5 });
    await until(() => ok.store.stage() === 'connect');
    expect(calls).toBe(3);
    dispose?.();

    const never: BaseIdentitySource = { ...source, state: async () => Promise.reject(new Error('custody is down')) };
    const failed = make(host({ identity: never }), { identityAttempts: 2 });
    await until(() => failed.store.error() !== '');
    expect(failed.store.error()).toBe('This computer could not read its identity: custody is down');
  });
});

describe('baseStore, the first run', () => {
  it('opens a door on the host and reads the identity again however the step ended', async () => {
    const identity = fakeIdentity(view());
    const { store } = make(host({ identity: identity.source }));
    await until(() => store.stage() === 'first-run');
    identity.set(view({ did: DID, holdsMaster: true, unlock: 'os' }));
    expect(await store.makeIdentity()).toBe('done');
    expect(identity.opened).toEqual([{ kind: 'create' }]);
    await until(() => store.stage() === 'connect');
    expect(store.lastOutcome()).toBe('done');
  });

  it('stays on the first run when a step was cancelled', async () => {
    const identity = fakeIdentity(view(), () => 'cancelled');
    const { store } = make(host({ identity: identity.source }));
    await until(() => store.stage() === 'first-run');
    expect(await store.linkIdentity()).toBe('cancelled');
    expect(identity.opened).toEqual([{ kind: 'show-code' }]);
    expect(store.stage()).toBe('first-run');
    expect(store.busy()).toBe(false);
  });

  it('opens nothing for a door the host keeps closed, and says why', async () => {
    const identity = fakeIdentity(view());
    const { store } = make(host({ identity: identity.source }));
    await until(() => store.stage() === 'first-run');
    expect(store.doors().words).toEqual({ open: false, note: 'No words here.' });
    expect(await store.useWords()).toBe('failed');
    expect(identity.opened).toEqual([]);
    expect(store.error()).toBe('No words here.');
  });

  it('closes making one where custody says no change can be made, and leaves the others', async () => {
    const identity = fakeIdentity(view({ blocked: 'The custody service is locked.' }));
    const { store } = make(host({ identity: identity.source }));
    await until(() => store.stage() === 'first-run');
    expect(store.doors().make).toEqual({ open: false, note: 'The custody service is locked.' });
    expect(store.doors().link.open).toBe(true);
  });

  it('remembers "Start now" for the whole device, and asks no first run after it', async () => {
    const storage = memoryStorage();
    const first = make(host({ identity: fakeIdentity(view()).source }), { storage });
    await until(() => first.store.stage() === 'first-run');
    await first.store.startNow();
    expect(storage.data.get(START_NOW_HERE_KEY)).toBe('1');
    expect(first.store.stage()).toBe('connect');
    dispose?.();

    const again = make(host({ identity: fakeIdentity(view()).source }), { storage });
    await until(() => again.store.stage() === 'connect');
  });

  it('asks no first run where the host says it was put off (the phone join page\'s "Not now")', async () => {
    const source = { ...fakeIdentity(view()).source, skipped: () => true };
    const { store } = make(host({ identity: source }));
    await until(() => store.stage() === 'connect');
  });
});

describe('baseStore, the connection', () => {
  it('hands off the one chosen and remembers it', async () => {
    const { store, handedOff, storage } = make(host());
    await until(() => store.stage() === 'connect');
    expect(store.connections().map((c) => [c.id, c.icon])).toEqual([
      ['this-device', 'laptop'],
      ['server:a', 'hard-drives'],
    ]);
    await store.choose('server:a');
    expect(handedOff).toEqual([SERVER]);
    expect(store.stage()).toBe('session');
    expect(storage.data.get(BASE_CONNECTION_KEY)).toBe('server:a');
  });

  it('goes straight to a remembered connection, unless the person asks to see the choice', async () => {
    const storage = memoryStorage({ [BASE_CONNECTION_KEY]: 'this-device' });
    const { store, handedOff } = make(host(), { storage });
    await until(() => store.stage() === 'session');
    expect(handedOff).toEqual([HERE]);
    expect(store.connections().find((c) => c.id === 'this-device')?.chosen).toBe(true);
  });

  it('takes the first place offered where the deployment draws no choice', async () => {
    const { store, handedOff } = make(host(), { takeFirst: true });
    await until(() => store.stage() === 'session');
    expect(handedOff).toEqual([HERE]);
  });

  it('shows the offline state for a remote place with no network, but connects here', async () => {
    const { store, handedOff } = make(host({ online: () => false }));
    await until(() => store.stage() === 'connect');
    await store.choose('server:a');
    expect(store.stage()).toBe('offline');
    expect(store.offlineReason()).toBe('This computer has no network. Test server cannot be reached until it has.');
    expect(handedOff).toEqual([]);
    await store.choose('this-device');
    expect(handedOff).toEqual([HERE]);
  });

  it('comes back offline when the host says the place could not be reached, else as an error', async () => {
    const unreachable = Object.assign(new Error('Failed to fetch'), { unreachable: true });
    const failures: unknown[] = [unreachable, new Error('Refused: wrong token')];
    const { store } = make(host({ isUnreachable: (e) => (e as { unreachable?: boolean }).unreachable === true }), {
      onHandOff: async () => {
        throw failures.shift();
      },
    });
    await until(() => store.stage() === 'connect');
    await store.choose('server:a');
    expect(store.stage()).toBe('offline');
    expect(store.offlineReason()).toBe('Test server could not be reached: Failed to fetch');

    // "Try again" reaches the same place again.
    await store.retry();
    expect(store.stage()).toBe('connect');
    expect(store.error()).toBe('Refused: wrong token');
  });

  it('says so for a place no longer offered', async () => {
    const { store } = make(host());
    await until(() => store.stage() === 'connect');
    await store.choose('server:gone');
    expect(store.error()).toBe('That place is no longer offered here.');
  });

  it('says so when the places cannot be read, and still draws the choice', async () => {
    const { store } = make(host({ connections: async () => Promise.reject(new Error('servers file unreadable')) }));
    await until(() => store.stage() === 'connect');
    expect(store.error()).toBe('The places to connect to could not be read: servers file unreadable');
  });

  it('takes the offline state back from a session the host lost', async () => {
    const { store } = make(host(), { takeFirst: true });
    await until(() => store.stage() === 'session');
    store.handBack('This computer could not be reached: socket closed');
    expect(store.stage()).toBe('offline');
    expect(store.offlineReason()).toBe('This computer could not be reached: socket closed');
    expect(store.busy()).toBe(false);
  });

  it('opens Devices and Security over the stage, read-only, and closes them on a choice', async () => {
    const identity = fakeIdentity(
      view({
        did: DID,
        holdsMaster: true,
        unlock: 'passphrase',
        devices: [
          { keyId: 'd1', name: 'Test laptop', kind: 'desktop-app', holdsMaster: 'yes' },
          { keyId: 'd2', name: '', kind: 'phone-app', holdsMaster: 'offered' },
        ],
      }),
    );
    const { store } = make(host({ identity: identity.source }));
    await until(() => store.stage() === 'connect');
    store.openPage('devices');
    expect(store.page()).toBe('devices');
    expect(store.devices()).toEqual([
      expect.objectContaining({
        keyId: 'd1',
        label: 'Test laptop',
        subtitle: 'd1 · Computer',
        master: 'Holds the master key',
      }),
      expect.objectContaining({
        keyId: 'd2',
        label: 'Device d2',
        subtitle: 'd2 · Phone',
        master: 'Master key offered, not yet taken',
      }),
    ]);
    expect(store.keepsLine()).toBe('This computer keeps your master key behind your passphrase');
    store.openPage('nonsense' as never);
    expect(store.page()).toBe('');
    store.openPage('security');
    await store.choose('this-device');
    expect(store.page()).toBe('');
  });
});
