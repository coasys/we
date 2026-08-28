/**
 * The shell overlay's query params.
 *
 * `ShellRouteStore` implements the same `RouteStore` contract the main router does, but over a
 * `MemoryRouter` — the overlay's URL is deliberately not the browser's, so profile and settings
 * never push history entries at the app behind them. That difference is exactly what made the
 * store's `params`/`setParam` easy to forget when the routing work added them: nothing in the type
 * system objected, because app-shell has no typecheck script (audit P3-1), and every
 * `{ $: 'routeStore.params.x' }` inside a shell surface silently read `undefined`.
 *
 * These assert against the memory location rather than `window.location`, which is the whole
 * point: a shell param that leaked into the browser URL would be a different bug of equal size.
 */
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { render, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouteStore } from '../src/frameworks/solid/stores/RouteStore';
import {
  ShellRouterRoot,
  ShellRouteStoreProvider,
  useShellRouteStore,
} from '../src/frameworks/solid/stores/ShellRouteStore';

/**
 * A stand-in for the store above the overlay, mutable so a test can steer it.
 *
 * Hoisted because `vi.mock` is: the factory runs before the module body, so it cannot close over an
 * ordinary `const`.
 */
const shellMock = vi.hoisted(() => ({
  pending: null as string | null,
  remembered: [] as string[],
}));

vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({
    takePendingPath: () => shellMock.pending,
    rememberShellPath: (path: string) => shellMock.remembered.push(path),
  }),
}));

beforeEach(() => {
  shellMock.pending = null;
  shellMock.remembered = [];
});

async function mountStore(initial = '/settings'): Promise<RouteStore> {
  let store!: RouteStore;
  const Grab = () => {
    store = useShellRouteStore();
    return null;
  };

  // A memory history seeded before mount — the overlay's location, entirely separate from the
  // browser's. There is no `initialEntries` on this router; the history *is* the seam.
  const history = createMemoryHistory();
  history.set({ value: initial });

  render(() => (
    <ShellRouteStoreProvider>
      <MemoryRouter root={ShellRouterRoot} history={history}>
        <Route path="*" component={Grab} />
      </MemoryRouter>
    </ShellRouteStoreProvider>
  ));

  // The store's signals start empty; ShellRouterRoot fills them from inside the router context.
  await waitFor(() => expect(store?.currentPath()).toBe(initial.split('?')[0]));
  return store;
}

describe('shellRouteStore params', () => {
  it('exposes the RouteStore param members at all', async () => {
    // The regression itself: these were simply absent from the object literal.
    const store = await mountStore();
    expect(typeof store.params).toBe('function');
    expect(typeof store.setParam).toBe('function');
  });

  it('reads params from the memory location', async () => {
    const store = await mountStore('/settings?tab=modules');
    expect(store.params()).toEqual({ tab: 'modules' });
  });

  it('setParam writes the reactive record, and null removes', async () => {
    const store = await mountStore();
    expect(store.params()).toEqual({});

    store.setParam('tab', 'modules');
    await waitFor(() => expect(store.params()).toEqual({ tab: 'modules' }));

    store.setParam('tab', null);
    await waitFor(() => expect(store.params()).toEqual({}));
  });

  it('keeps the overlay out of the browser URL', async () => {
    const before = window.location.href;
    const store = await mountStore();

    store.setParam('tab', 'modules');
    await waitFor(() => expect(store.params()).toEqual({ tab: 'modules' }));

    // A shell param reaching window.location would mean the overlay had stopped being isolated.
    expect(window.location.href).toBe(before);
  });

  it('leaves the path alone when only a param changes', async () => {
    const store = await mountStore();

    store.setParam('tab', 'modules');
    await waitFor(() => expect(store.params()).toEqual({ tab: 'modules' }));
    expect(store.currentPath()).toBe('/settings');
    expect(store.segments()).toEqual(['settings']);
  });
});

/**
 * Surviving a remount.
 *
 * The overlay's `MemoryRouter` is mounted inside `TemplateLayout`, which is the main Router's root
 * — so anything that rebuilds the main route table takes the overlay down with it, and a fresh
 * `MemoryRouter` starts at `/`. Removing a section from a space did exactly that: you were on that
 * space's settings page and landed on the account page, having asked for neither.
 *
 * The memory has to live in `ShellStore`, above the Router, because that is the only thing in the
 * chain that outlives the overlay. These assert the overlay's half of that contract: it reports
 * where it is, and it asks on the way back up.
 */
describe('shellRouteStore remount survival', () => {
  it('reports where it is, so something above it can put it back', async () => {
    await mountStore('/spaces/abc');

    await waitFor(() => expect(shellMock.remembered).toContain('/spaces/abc'));
  });

  it('keeps reporting as the overlay moves, not only once on mount', async () => {
    const store = await mountStore('/spaces');
    store.navigate('/spaces/abc');

    await waitFor(() => expect(shellMock.remembered.at(-1)).toBe('/spaces/abc'));
  });

  it('goes where it is sent on mount', async () => {
    // The restore path: nothing pending from a click, so the store above answers with where the
    // overlay was standing before it was torn down.
    shellMock.pending = '/spaces/abc';
    const store = await mountStore('/');

    await waitFor(() => expect(store.currentPath()).toBe('/spaces/abc'));
  });

  it('stays put when it is already where it was sent', async () => {
    shellMock.pending = '/spaces/abc';
    const store = await mountStore('/spaces/abc');

    await waitFor(() => expect(store.currentPath()).toBe('/spaces/abc'));
  });
});
