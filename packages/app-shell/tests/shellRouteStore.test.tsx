/**
 * The shell overlay's query params.
 *
 * `ShellRouteStore` implements the same `RouteStore` contract the main router does, but over a
 * `MemoryRouter` — the overlay's URL is deliberately not the browser's, so profile and settings
 * never push history entries at the app behind them. That difference is exactly what made the
 * store's `params`/`setParam` easy to forget when the routing work added them: nothing in the type
 * system objected, because app-shell has no typecheck script (audit P3-1), and every
 * `{ $store: 'routeStore.params.x' }` inside a shell surface silently read `undefined`.
 *
 * These assert against the memory location rather than `window.location`, which is the whole
 * point: a shell param that leaked into the browser URL would be a different bug of equal size.
 */
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { render, waitFor } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

import type { RouteStore } from '../src/frameworks/solid/stores/RouteStore';
import {
  ShellRouteStoreProvider,
  ShellRouterRoot,
  useShellRouteStore,
} from '../src/frameworks/solid/stores/ShellRouteStore';

vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ takePendingPath: () => undefined }),
}));

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
