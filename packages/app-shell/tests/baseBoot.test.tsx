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
import type { BaseConnection, BaseHost } from '@shared/platform/baseHost';
import type { PlatformAdapter } from '@shared/platform/types';
import { render, screen } from '@solidjs/testing-library';
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
import type { BaseStore } from '../src/frameworks/solid/stores/BaseStore';
import type { WeSeedFile } from '../src/types/seed';

const HERE: BaseConnection = { id: 'this-device', kind: 'this-device', label: 'This computer', detail: 'Here' };
const SEED = { host: { ui: {} } } as unknown as WeSeedFile;
const PLATFORM = {} as PlatformAdapter;

async function until(check: () => boolean, ms = 2_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 5))) if (check()) return;
  throw new Error('timed out waiting');
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
