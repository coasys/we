/**
 * BaseBoot: the hand-off from the app before a session to WE's app in the same page, and back.
 *
 * WE's `App` and the platform provider are stood in for: what is under test is which connector the
 * app is mounted with, that it is mounted only once a connection is chosen, and that a place that
 * could not be reached takes the page back to the base app's offline state. The base template is the
 * real one (`baseFallback`), drawn by the real renderer.
 */
import type { BackendConnector } from '@shared/backend/types';
import type { BundlePieces } from '@shared/bundles/bundlePieces';
import type { BaseConnection, BaseExecutorState, BaseHost } from '@shared/platform/baseHost';
import type { PlatformAdapter } from '@shared/platform/types';
import { render, screen } from '@solidjs/testing-library';
import type { IdentityCustodyView } from '@we/backend-shared';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mounted = vi.hoisted(() => ({ backends: [] as BackendConnector[], apps: 0 }));

vi.mock('../src/frameworks/solid/App', () => ({
  default: () => {
    mounted.apps += 1;
    return <div data-testid="we-app">WE's app</div>;
  },
}));

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  PlatformProvider: (props: { backend: BackendConnector; children: JSX.Element }) => {
    mounted.backends.push(props.backend);
    return <>{props.children}</>;
  },
}));

import { BaseBoot, deploymentBase, handBackOnUnreachable } from '../src/frameworks/solid/base/BaseApp';
import { NEW_PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../src/frameworks/solid/credential';
import type { BaseStore } from '../src/frameworks/solid/stores/BaseStore';
import type { WeSeedFile } from '../src/types/seed';

const HERE: BaseConnection = { id: 'this-device', kind: 'this-device', label: 'This computer', detail: 'Here' };
const SEED = { host: { ui: {} } } as unknown as WeSeedFile;
const PLATFORM = {} as PlatformAdapter;

async function until(check: () => boolean, ms = 2_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 5))) if (check()) return;
  throw new Error('timed out waiting');
}

type Node = { id?: string; type?: string; props?: Record<string, unknown>; children?: unknown[] };

/** The first node of a template, at any depth and in any `$if` branch, that `match` accepts. */
function findNode(node: unknown, match: (n: Node) => boolean): Node | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNode(item, match);
      if (found) return found;
    }
    return undefined;
  }
  const n = node as Node;
  if (typeof n.type === 'string' && match(n)) return n;
  for (const value of Object.values(n)) {
    const found = findNode(value, match);
    if (found) return found;
  }
  return undefined;
}

const connector = (initialize: BackendConnector['initialize']): BackendConnector =>
  ({ initialize }) as BackendConnector;
const unreachable = (e: unknown) => (e as Error)?.message === 'Failed to fetch';

afterEach(() => {
  mounted.backends = [];
  mounted.apps = 0;
  localStorage.clear();
});

describe('handBackOnUnreachable', () => {
  const host = { kind: 'computer', isUnreachable: unreachable } as BaseHost;

  it('passes a session through untouched', async () => {
    const session = { client: {}, ports: {} };
    const wrapped = handBackOnUnreachable(
      connector(async () => session as never),
      host,
      HERE,
      () => {},
    );
    expect(await wrapped.initialize({} as never)).toBe(session);
  });

  it('hands an unreachable place back, and leaves every other failure to the session', async () => {
    const back = vi.fn();
    const lost = handBackOnUnreachable(
      connector(async () => Promise.reject(new Error('Failed to fetch'))),
      host,
      HERE,
      back,
    );
    void lost.initialize({} as never);
    await until(() => back.mock.calls.length === 1);
    expect(back).toHaveBeenCalledWith('This computer could not be reached: Failed to fetch');

    const refused = handBackOnUnreachable(
      connector(async () => Promise.reject(new Error('Wrong token'))),
      host,
      HERE,
      back,
    );
    await expect(refused.initialize({} as never)).rejects.toThrow('Wrong token');
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('deploymentBase', () => {
  const pieces = (over: Partial<BundlePieces>): BundlePieces => ({
    bundleId: 'b',
    version: '1',
    name: 'Test app',
    icon: '',
    shells: [],
    sections: [],
    pages: [],
    themes: [],
    recordTypes: [],
    starters: [],
    ...over,
  });
  const app = { id: 'b--app', type: 'Column', meta: { name: 'App', role: 'app' } } as never;
  const base = { id: 'b--base', type: 'Column', meta: { name: 'Base', role: 'base' } } as never;

  it("is the base of the deployment's app, under its brand and first theme", () => {
    const found = deploymentBase(SEED, [
      pieces({ app, base, themes: [{ id: 'b--dark', name: 'Dark', overrides: {} } as never] }),
    ]);
    expect(found?.template).toBe(base);
    expect(found?.brand.name).toBe('Test app');
    expect(found?.theme?.id).toBe('b--dark');
  });

  it('is none for an app with no base, or a seed naming another app', () => {
    expect(deploymentBase(SEED, [pieces({ app })])).toBeUndefined();
    const other = { host: { ui: { app: 'elsewhere' } } } as unknown as WeSeedFile;
    expect(deploymentBase(other, [pieces({ app, base })])).toBeUndefined();
  });
});

describe('BaseBoot', () => {
  function boot(over: Partial<BaseHost>) {
    let store!: BaseStore;
    const made: BaseConnection[] = [];
    const host: BaseHost = {
      kind: 'computer',
      connections: async () => [HERE],
      connector: async (c) => (made.push(c), connector(async () => ({ client: {}, ports: {} }) as never)),
      isUnreachable: unreachable,
      ...over,
    };
    render(() => <BaseBoot host={host} platform={PLATFORM} seed={SEED} base={null} onStore={(s) => (store = s)} />);
    return { store: () => store, made };
  }

  it("mounts WE's app in the same page with the host's connector for the place chosen", async () => {
    const { store, made } = boot({});
    await until(() => mounted.apps === 1);
    expect(made).toEqual([HERE]);
    expect(store().stage()).toBe('session');
    expect(screen.getByTestId('we-app')).toBeTruthy();
    expect(mounted.backends).toHaveLength(1);
  });

  it('draws the executor failing to start, and the app only once it is up', async () => {
    let listener: ((s: { phase: 'ready' }) => void) | null = null;
    const { store } = boot({
      executor: {
        state: () => ({ phase: 'failed', reason: 'The executor refused its settings.' }),
        subscribe: (l) => ((listener = l as never), () => {}),
        start: async () => {},
      },
    });
    await until(() => screen.queryByText('The executor refused its settings.') !== null);
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(mounted.apps).toBe(0);
    listener!({ phase: 'ready' });
    await until(() => mounted.apps === 1);
    expect(store().stage()).toBe('session');
  });

  it('takes the page back from the app when the executor stops under it, and starts it again', async () => {
    let listener: ((s: BaseExecutorState) => void) | null = null;
    const start = vi.fn(async () => {});
    const { store } = boot({
      executor: {
        state: () => ({ phase: 'ready' }),
        subscribe: (l) => ((listener = l), () => {}),
        start,
      },
    });
    await until(() => mounted.apps === 1);
    listener!({ phase: 'failed', reason: 'The executor was stopped outside the app.', stopped: true });
    await until(() => screen.queryByTestId('we-app') === null);
    expect(store().stage()).toBe('failed');
    expect(screen.getByText('The executor was stopped outside the app.')).toBeTruthy();
    // WE's own base, under the deployment's name: no "Electron", no "Try again" for a stop.
    expect(screen.getByText(`Start ${store().brand().name} again`)).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    // The button's action (a synthetic click is refused by the gesture gate, as it should be).
    await store().retry();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("says a failed Make made the identity, in the deployment's own base, rather than that nothing changed", async () => {
    const empty: IdentityCustodyView = {
      did: null,
      holdsMaster: false,
      unlock: 'os',
      blocked: null,
      devices: [],
      revokedHolders: [],
      requests: [],
      masterWaiting: false,
    };
    let state = empty;
    let store!: BaseStore;
    const host: BaseHost = {
      kind: 'computer',
      connections: async () => [HERE],
      connector: async () => connector(async () => ({ client: {}, ports: {} }) as never),
      identity: {
        state: async () => state,
        doors: {
          make: { step: { kind: 'create' } },
          link: { step: { kind: 'show-code' } },
          words: { step: { kind: 'restore' } },
        },
        // The custody service made and kept the identity; its publish did not go through.
        open: async () => ((state = { ...empty, pending: 'did:scid:coasys:1:QmTest' }), 'failed'),
      },
    };
    const base = deploymentBase(SEED);
    expect(base?.template.meta?.role).toBe('base');
    render(() => <BaseBoot host={host} platform={PLATFORM} seed={SEED} onStore={(s) => (store = s)} />);
    await until(() => screen.queryByText(/Make my identity here/) !== null);
    expect(await store.makeIdentity()).toBe('failed');
    await until(() => screen.queryByText(/is not published yet/) !== null);
    expect(screen.queryByText(/Nothing was changed/)).toBeNull();
  });

  /*
    Lal's review of coasys/we#438: with the executor down the custody view has no `pending` either,
    so a Make that kept the master key and failed to publish was told "Nothing was changed". Nothing
    tells the base that a failed step changed nothing, so it does not say so.
  */
  it('says a failed step did not finish, and never that nothing was changed', async () => {
    const empty: IdentityCustodyView = {
      did: null,
      holdsMaster: false,
      unlock: 'os',
      blocked: null,
      devices: [],
      revokedHolders: [],
      requests: [],
      masterWaiting: false,
    };
    let store!: BaseStore;
    const host: BaseHost = {
      kind: 'computer',
      connections: async () => [HERE],
      connector: async () => connector(async () => ({ client: {}, ports: {} }) as never),
      identity: {
        state: async () => empty,
        doors: {
          make: { step: { kind: 'create' } },
          link: { step: { kind: 'show-code' } },
          words: { step: { kind: 'restore' } },
        },
        // Failed, with no `pending` to say whether the key was kept (the executor was down).
        open: async () => 'failed',
      },
    };
    render(() => <BaseBoot host={host} platform={PLATFORM} seed={SEED} onStore={(s) => (store = s)} />);
    await until(() => screen.queryByText(/Make my identity here/) !== null);
    expect(await store.makeIdentity()).toBe('failed');
    await until(() => screen.queryByText('That did not finish; try again.') !== null);
    expect(screen.queryByText(/Nothing was changed/)).toBeNull();
  });

  /*
    Lal's review of coasys/we#438: an identity that could not be read is drawn on the connection
    choice with its reason, and that screen had no "Try again", so the only way to read it again was
    to relaunch. Pressing it here reads the identity again.
  */
  it('offers "Try again" beside a reason on the connection choice, and reads the identity again', async () => {
    let store!: BaseStore;
    let reads = 0;
    const host: BaseHost = {
      kind: 'computer',
      connections: async () => [HERE],
      connector: async () => connector(async () => ({ client: {}, ports: {} }) as never),
      identity: {
        state: async () => {
          reads += 1;
          throw new Error('the custody service did not answer');
        },
        doors: {
          make: { step: { kind: 'create' } },
          link: { step: { kind: 'show-code' } },
          words: { step: { kind: 'restore' } },
        },
        open: async () => 'failed',
      },
    };
    render(() => <BaseBoot host={host} platform={PLATFORM} seed={SEED} onStore={(s) => (store = s)} />);
    await until(() => screen.queryByText(/could not read its identity/) !== null, 15_000);
    expect(store.stage()).toBe('connect');
    expect(screen.getByText('Where should Coasys run for you?')).toBeTruthy();
    expect(screen.getByText('Try again').closest('we-button')).toBeTruthy();
    // The press itself needs a trusted event (the base app's gesture gate), which jsdom cannot make:
    // what the drawn control invokes is read from the deployment's own base, and invoked as a press would.
    const connect = findNode(deploymentBase(SEED)!.template, (n) => n.id === 'base__connect');
    const button = connect && findNode(connect, (n) => n.type === 'we-button' && n.children?.[0] === 'Try again');
    expect(button?.props?.onClick).toEqual({ $invoke: 'baseStore.retry' });
    const before = reads;
    await store.retry();
    expect(reads).toBeGreaterThan(before);
  }, 40_000);

  /*
    A computer with no keyring the app can use: the deployment's own base asks for the WE password in
    the host's field, twice on a first start, and Continue gives what the field holds to the host.
  */
  describe('the WE password, where no keyring could be used', () => {
    const empty: IdentityCustodyView = {
      did: null,
      holdsMaster: false,
      unlock: 'os',
      blocked: null,
      devices: [],
      revokedHolders: [],
      requests: [],
      masterWaiting: false,
    };

    function noKeyring(agent: 'needs-password' | 'needs-new-password', answer: 'unlocked' | 'wrong') {
      let store!: BaseStore;
      const given: string[] = [];
      const host: BaseHost = {
        kind: 'computer',
        connections: async () => [HERE],
        connector: async () => connector(async () => ({ client: {}, ports: {} }) as never),
        executor: {
          state: () => ({ phase: 'ready', agent }),
          subscribe: () => () => {},
          start: async () => {},
          givePassword: async (password) => (given.push(password), answer),
        },
        identity: {
          state: async () => empty,
          doors: {
            make: { step: { kind: 'create' } },
            link: { step: { kind: 'show-code' } },
            words: { step: { kind: 'restore' } },
          },
          open: async () => 'failed',
        },
      };
      render(() => <BaseBoot host={host} platform={PLATFORM} seed={SEED} onStore={(s) => (store = s)} />);
      return { store: () => store, given };
    }

    const type = (input: Element, value: string) =>
      input.dispatchEvent(new CustomEvent('input', { detail: value, bubbles: true, composed: true }));
    const fields = () => [...document.querySelectorAll('we-input[type="password"]')];

    it('asks a first start for a new password twice, and gives it to the host', async () => {
      const { store, given } = noKeyring('needs-new-password', 'unlocked');
      await until(() => screen.queryByText('Choose your WE password') !== null);
      expect(screen.getByText(/keyring is not available, so your WE password protects your agent/)).toBeTruthy();
      expect(fields()).toHaveLength(2);
      const [first, again] = fields();
      // Under the floor: not given, and the drawn field says why. Typed twice only catches a typo.
      type(first, 'short');
      type(again, 'short');
      expect(store().passwordConfirmed()).toBe(false);
      await store().submitPassword();
      expect(given).toEqual([]);
      const [passwordField] = [...document.querySelectorAll('we-form-field')];
      expect((passwordField as unknown as { error: string }).error).toBe(
        `Use at least ${NEW_PASSWORD_MIN_LENGTH} characters`,
      );
      for (const field of fields())
        expect((field as unknown as { maxlength: number }).maxlength).toBe(PASSWORD_MAX_LENGTH);
      type(first, 'test-password');
      type(again, 'test-password');
      expect(store().passwordConfirmed()).toBe(true);
      // The press itself needs a trusted event (the base app's gesture gate): what the drawn Continue
      // invokes is read from the deployment's own base, and invoked as a press would.
      const step = findNode(deploymentBase(SEED)!.template, (n) => n.id === 'base__password');
      const button = step && findNode(step, (n) => n.type === 'we-button' && n.children?.[0] === 'Continue');
      expect(button?.props?.onClick).toEqual({ $invoke: 'baseStore.submitPassword' });
      await store().submitPassword();
      expect(given).toEqual(['test-password']);
    });

    it('asks for the password of an agent made with one in one field, and says when it is wrong', async () => {
      const { store, given } = noKeyring('needs-password', 'wrong');
      await until(() => screen.queryByText('Enter your WE password') !== null);
      expect(fields()).toHaveLength(1);
      type(fields()[0], 'not-the-password');
      await store().submitPassword();
      expect(given).toEqual(['not-the-password']);
      await until(() => screen.queryByText('That password did not unlock your agent. Try again.') !== null);
      expect(store().stage()).toBe('password');
    });
  });

  it('takes the page back to the offline state when the place cannot be reached', async () => {
    const { store } = boot({
      connector: async () => connector(async () => Promise.reject(new Error('Failed to fetch'))),
    });
    await until(() => mounted.backends.length === 1);
    // The app's boot reaches the backend; here, the test plays that part.
    void mounted.backends[0].initialize({} as never);
    await until(() => store().stage() === 'offline');
    await until(() => screen.queryByText('You are offline') !== null);
    expect(screen.queryByTestId('we-app')).toBeNull();
    expect(screen.getByText('This computer could not be reached: Failed to fetch')).toBeTruthy();
  });
});
