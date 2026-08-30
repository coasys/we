/**
 * routeStore's query-param machinery — the store half of the routing
 * conventions (docs/architecture/routing-and-view-state.md): reactive params,
 * push-vs-replace writes, and the per-path search memory that keeps a
 * kept-alive route's URL truthful after leaving and returning.
 */
import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RouteStoreProvider, { type RouteStore, useRouteStore } from '../src/frameworks/solid/stores/RouteStore';

function mountStore(): RouteStore {
  let store!: RouteStore;
  const Grab = () => {
    store = useRouteStore();
    return null;
  };
  render(() => (
    <RouteStoreProvider>
      <Grab />
    </RouteStoreProvider>
  ));
  return store;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/cards');
});

describe('routeStore params', () => {
  it('setParam writes the URL and the reactive record; null removes', () => {
    const store = mountStore();

    store.setParam('sort', 'likes');
    expect(window.location.search).toBe('?sort=likes');
    expect(store.params()).toEqual({ sort: 'likes' });

    store.setParam('sort', null);
    expect(window.location.search).toBe('');
    expect(store.params()).toEqual({});
  });

  it('replace by default, push on request', () => {
    const store = mountStore();
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    store.setParam('sort', 'likes');
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();

    store.setParam('type', 'users', { push: true });
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('navigate restores a path’s remembered search — and an explicit ? wins', () => {
    const store = mountStore();
    const nav = vi.fn();
    store.setNavigateFunction(nav as never); // takes the function itself now; it does its own wrapping

    // Set a param on /cards, leave, come back bare.
    store.setParam('sort', 'likes');
    window.history.replaceState(null, '', '/about');
    store.setCurrentPath('/about');

    store.navigate('/cards');
    expect(nav).toHaveBeenCalledWith('/cards?sort=likes', undefined);

    // Explicit search in the target is never overridden.
    store.navigate('/cards?sort=date');
    expect(nav).toHaveBeenLastCalledWith('/cards?sort=date', undefined);
  });

  it('clearing the param clears the memory — returning lands bare', () => {
    const store = mountStore();
    const nav = vi.fn();
    store.setNavigateFunction(nav as never); // takes the function itself now; it does its own wrapping

    store.setParam('sort', 'likes');
    store.setParam('sort', null); // back to default
    window.history.replaceState(null, '', '/about');
    store.setCurrentPath('/about');

    store.navigate('/cards');
    expect(nav).toHaveBeenCalledWith('/cards', undefined);
  });

  it('params arriving via a shared link are remembered from arrival', () => {
    window.history.replaceState(null, '', '/cards?type=users');
    const store = mountStore();
    const nav = vi.fn();
    store.setNavigateFunction(nav as never); // takes the function itself now; it does its own wrapping
    store.setCurrentPath('/cards'); // the router reporting arrival

    window.history.replaceState(null, '', '/about');
    store.setCurrentPath('/about');

    store.navigate('/cards');
    expect(nav).toHaveBeenCalledWith('/cards?type=users', undefined);
  });
});
