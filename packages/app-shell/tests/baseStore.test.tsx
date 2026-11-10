/**
 * baseStore: the app before a session, over a host of fakes — the order it asks things in (the
 * device's own backend, the identity, the first run, the connection), what it remembers, and how a
 * place that cannot be reached comes back as the offline state.
 */
import type { IdentityChangeOutcome, IdentityCustodyView } from '@we/backend-shared';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { credential } from '../src/frameworks/solid/credential';
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

  it('names an identity a failed step made and could not publish, and forgets it once published', async () => {
    const identity = fakeIdentity(view(), () => {
      // The custody service kept the identity it made, then the publish failed.
      identity.set(view({ pending: DID }));
      return 'failed';
    });
    const { store } = make(host({ identity: identity.source }));
    await until(() => store.stage() === 'first-run');
    expect(store.unpublished()).toBe('');
    expect(await store.makeIdentity()).toBe('failed');
    // Still the first run (no identity speaks for this device yet), but not "nothing changed".
    expect(store.stage()).toBe('first-run');
    expect(store.lastOutcome()).toBe('failed');
    expect(store.unpublished()).toBe(DID);

    identity.set(view({ did: DID, holdsMaster: true }));
    await store.refresh();
    expect(store.unpublished()).toBe('');
  });

  it('closes making one where custody says no change can be made, and leaves the others', async () => {
    const identity = fakeIdentity(view({ blocked: 'The custody service is locked.' }));
    const { store } = make(host({ identity: identity.source }));
    await until(() => store.stage() === 'first-run');
    expect(store.doors().make).toEqual({ open: false, note: 'The custody service is locked.' });
    expect(store.doors().link.open).toBe(true);
  });

  it("reads a host's doors again when its own backend changes: they may follow it", async () => {
    // The desktop's close while its executor's agent is locked (`apps/coasys/src/hosts/desktop.ts`).
    const own = fakeExecutor({ phase: 'ready', agent: 'locked' });
    const identity = fakeIdentity(view());
    const closed = { step: null, note: 'Locked.' } as const;
    const source: BaseIdentitySource = {
      ...identity.source,
      get doors() {
        const s = own.executor.state();
        const open = s.phase === 'ready' && s.agent !== 'locked';
        return open ? identity.source.doors : { make: closed, link: closed, words: closed };
      },
    };
    const { store } = make(host({ executor: own.executor, identity: source }));
    await until(() => store.stage() === 'first-run');
    expect(store.doors().make).toEqual({ open: false, note: 'Locked.' });
    expect(await store.makeIdentity()).toBe('failed');
    expect(identity.opened).toEqual([]);

    own.move({ phase: 'ready', agent: 'unlocked' });
    await flush();
    expect(store.doors().make.open).toBe(true);
    expect(await store.makeIdentity()).toBe('done');
    expect(identity.opened).toEqual([{ kind: 'create' }]);
  });

  /*
    Lal's P2 on #438: an identity that could not be read is not "no identity". The first run is not
    offered for it; the reason is shown and "Try again" reads it again.
  */
  it('offers no first run for an identity it could not read, and reads it again on "Try again"', async () => {
    const identity = fakeIdentity(view({ did: DID }));
    const state = identity.source.state as ReturnType<typeof vi.fn>;
    state.mockRejectedValueOnce(new Error('This phone cannot reach your identity store: StoreDown'));
    const { store } = make(host({ kind: 'phone', identity: identity.source }), { identityAttempts: 1 });
    await until(() => store.stage() === 'connect');
    expect(store.error()).toBe(
      'This phone could not read its identity: This phone cannot reach your identity store: StoreDown',
    );
    await store.retry();
    await until(() => store.error() === '');
    expect(store.stage()).toBe('connect');
    expect(state).toHaveBeenCalledTimes(2);
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

  /*
    Lal's P2 on #438: the host asks a remembered place first, so that a relaunch whose place is gone
    lands on the offline state. A person choosing a place from the list is not resuming, and the host
    is told so (the browser's AD4M Connect then opens its own screen, where a new address goes).
  */
  it('tells the host a place was chosen by the person, and not when it resumes or tries again', async () => {
    const calls: [string, boolean][] = [];
    const unreachable = Object.assign(new Error('Failed to fetch'), { unreachable: true });
    const { store } = make(host({ isUnreachable: (e) => (e as { unreachable?: boolean }).unreachable === true }), {
      storage: memoryStorage({ [BASE_CONNECTION_KEY]: 'server:a' }),
      onHandOff: async (c, how) => {
        calls.push([c.id, how?.chosen === true]);
        if (!how?.chosen) throw unreachable;
      },
    });
    await until(() => store.stage() === 'offline');
    await store.retry();
    expect(store.stage()).toBe('offline');
    await store.showConnections();
    await store.choose('server:a');
    expect(store.stage()).toBe('session');
    expect(calls).toEqual([
      ['server:a', false],
      ['server:a', false],
      ['server:a', true],
    ]);
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

  /*
    Lal's review of #438: the desktop's executor says how its agent is at each start, and WE's sign-in
    unlocks a locked one after that. Coming back to the base app — the offline state, "Choose another
    place" — or opening a door asks the executor again, so the doors follow the agent as it is now.
  */
  describe('an agent unlocked after the start said it was locked', () => {
    /** The executor the host reports, whose agent is `truth` when asked again (`refresh`). */
    function lockedThenUnlocked() {
      let truth: 'locked' | 'unlocked' = 'locked';
      const own = fakeExecutor({ phase: 'ready', agent: 'locked' });
      const refreshes: number[] = [];
      const executor = {
        ...own.executor,
        refresh: async () => {
          refreshes.push(Date.now());
          own.move({ phase: 'ready', agent: truth });
        },
      };
      const identity = fakeIdentity(view({ did: DID }));
      const gated: BaseIdentitySource = {
        ...identity.source,
        get doors() {
          const now = executor.state();
          const note = 'The agent is locked.';
          return now.phase === 'ready' && now.agent === 'unlocked'
            ? identity.source.doors
            : { make: { step: null, note }, link: { step: null, note }, words: { step: null, note } };
        },
      };
      return { executor, identity, gated, refreshes, signIn: () => (truth = 'unlocked') };
    }

    it('opens the doors when the session hands back to the offline state', async () => {
      const t = lockedThenUnlocked();
      const { store } = make(host({ identity: t.gated, executor: t.executor }), { takeFirst: true });
      await until(() => store.stage() === 'session');
      expect(store.doors().make.open).toBe(false);
      t.signIn();
      store.handBack('This computer could not be reached: socket closed');
      await until(() => store.doors().make.open);
      expect(store.doors().link.open).toBe(true);
    });

    it('opens the doors when the person goes back to the choice', async () => {
      const t = lockedThenUnlocked();
      const { store } = make(host({ identity: t.gated, executor: t.executor }));
      await until(() => store.stage() === 'connect');
      t.signIn();
      await store.showConnections();
      expect(store.doors().make.open).toBe(true);
    });

    it('asks again before deciding whether a door opens', async () => {
      const t = lockedThenUnlocked();
      const { store } = make(host({ identity: t.gated, executor: t.executor }));
      await until(() => store.stage() === 'connect');
      t.signIn();
      expect(await store.makeIdentity()).toBe('done');
      expect(t.identity.opened).toEqual([{ kind: 'create' }]);
    });
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

/*
  A desktop with no keyring it can use (no Secret Service, or one still locked past custody's 90 s):
  the executor's agent is made, or unlocked, with the WE password instead, asked for here before
  anything else. The password is typed in the host's own field (`CredentialField`) and read from it
  (`credential`), never passed by a template, and the field is cleared once it is sent.
*/
describe('baseStore, the WE password where no keyring could be used', () => {
  const PASSWORD = 'test-password';
  afterEach(() => credential.clear());

  /** The executor the host reports, asking for the password; `agentPassword` is the one that unlocks it. */
  function noKeyring(need: 'needs-password' | 'needs-new-password', agentPassword = PASSWORD) {
    const own = fakeExecutor({ phase: 'ready', agent: need });
    const given: string[] = [];
    const executor = {
      ...own.executor,
      givePassword: async (password: string) => {
        given.push(password);
        if (need === 'needs-new-password' || password === agentPassword) {
          own.move({ phase: 'ready', agent: 'unlocked' });
          return 'unlocked' as const;
        }
        return 'wrong' as const;
      },
    };
    return { own, executor, given };
  }

  it('asks a first start for a new password, twice, and makes the agent with it', async () => {
    const t = noKeyring('needs-new-password');
    const identity = fakeIdentity(view());
    const { store } = make(host({ identity: identity.source, executor: t.executor }));
    await until(() => store.stage() === 'password');
    expect(store.passwordIsNew()).toBe(true);
    expect(identity.source.state).not.toHaveBeenCalled();

    // Typed once, or twice and not the same: nothing is sent, and the field says why.
    credential.set(PASSWORD);
    expect(store.passwordEntered()).toBe(true);
    expect(store.passwordConfirmed()).toBe(false);
    await store.submitPassword();
    credential.setConfirmation('something else');
    await store.submitPassword();
    expect(t.given).toEqual([]);
    expect(credential.touched()).toBe(true);
    expect(store.stage()).toBe('password');

    credential.setConfirmation(PASSWORD);
    expect(store.passwordConfirmed()).toBe(true);
    await store.submitPassword();
    expect(t.given).toEqual([PASSWORD]);
    // Cleared once sent.
    expect(credential.read()).toBe('');
    expect(store.passwordEntered()).toBe(false);
    await until(() => store.stage() === 'first-run');
  });

  it('asks for the password of an agent made with one, and unlocks it', async () => {
    const t = noKeyring('needs-password');
    const { store } = make(host({ identity: fakeIdentity(view({ did: DID })).source, executor: t.executor }));
    await until(() => store.stage() === 'password');
    expect(store.passwordIsNew()).toBe(false);
    credential.set(PASSWORD);
    await store.submitPassword();
    expect(t.given).toEqual([PASSWORD]);
    await until(() => store.stage() === 'connect');
  });

  it('says a wrong password was wrong and asks again, with the agent still waiting on it', async () => {
    const t = noKeyring('needs-password');
    const { store } = make(host({ identity: fakeIdentity(view({ did: DID })).source, executor: t.executor }));
    await until(() => store.stage() === 'password');
    credential.set('not-the-password');
    await store.submitPassword();
    expect(store.passwordWrong()).toBe(true);
    expect(store.stage()).toBe('password');
    expect(credential.read()).toBe('');
    expect(store.busy()).toBe(false);

    // Typing again takes the verdict back; the right one goes on.
    store.clearPasswordWrong();
    expect(store.passwordWrong()).toBe(false);
    credential.set(PASSWORD);
    await store.submitPassword();
    await until(() => store.stage() === 'connect');
    expect(t.given).toEqual(['not-the-password', PASSWORD]);
  });

  it('sends nothing with nothing typed', async () => {
    const t = noKeyring('needs-password');
    const { store } = make(host({ identity: fakeIdentity(view({ did: DID })).source, executor: t.executor }));
    await until(() => store.stage() === 'password');
    await store.submitPassword();
    expect(t.given).toEqual([]);
  });

  it('says why a password could not be given, and clears it', async () => {
    const t = noKeyring('needs-password');
    const executor = {
      ...t.executor,
      givePassword: async () => Promise.reject(new Error('not from this window')),
    };
    const { store } = make(host({ identity: fakeIdentity(view({ did: DID })).source, executor }));
    await until(() => store.stage() === 'password');
    credential.set(PASSWORD);
    await store.submitPassword();
    expect(store.error()).toBe('not from this window');
    expect(store.stage()).toBe('password');
    expect(credential.read()).toBe('');
  });

  it('leaves the password to WE’s own sign-in where the deployment draws no base', async () => {
    const t = noKeyring('needs-password');
    const { store, handedOff } = make(host({ executor: t.executor }), { takeFirst: true });
    await until(() => store.stage() === 'session');
    expect(handedOff).toEqual([HERE]);
    expect(t.given).toEqual([]);
  });
});
