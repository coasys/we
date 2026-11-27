/**
 * The shell overlay's route store, on its own: the same `RouteStore` contract the main router keeps,
 * over the overlay's own address rather than the browser's.
 *
 * A plain store test, run once under each reactivity port. The router is a stand-in for the
 * overlay's `MemoryRouter`: `navigate` moves a location held here and reports it back through
 * `setCurrentPath` and `setSearch`, which is what the router binding does with the real one. How the
 * binding fills the store from a mounted router is `shellRouterRoot.test.tsx`.
 */
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createShellRouteStore, type ShellRouteStore } from '../src/shared/stores/ShellRouteStore';
import { reactivityPorts } from './support/engines';

describe.each(reactivityPorts)('shellRouteStore, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  const disposers: (() => void)[] = [];

  /** The store and a memory router lent to it, starting at `initial`. */
  function mountStore(initial = '/settings') {
    let store!: ShellRouteStore;
    disposers.push(port.root(() => (store = createShellRouteStore({ reactivity: port }))));
    const entries = [initial];
    const calls: { to: string | number; options?: Record<string, unknown> }[] = [];
    const report = () => {
      const [path, query] = entries.at(-1)!.split('?');
      store.setCurrentPath(path);
      store.setSearch(query ? `?${query}` : '');
    };
    const navigate = (to: string | number, options?: Record<string, unknown>) => {
      calls.push({ to, options });
      if (typeof to === 'number') {
        if (entries.length > 1) entries.pop();
      } else if (options?.replace) entries[entries.length - 1] = to;
      else entries.push(to);
      report();
    };
    const takeBack = store.setNavigateFunction(navigate);
    report();
    return { store, calls, takeBack, navigate };
  }

  beforeEach(() => {
    port = makePort();
    window.history.replaceState(null, '', '/space/abc/board');
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.restoreAllMocks();
  });

  it('resolves a relative path against the overlay’s address, not the page behind it', () => {
    const { store } = mountStore('/settings/ai');
    store.navigate('../modules', { base: { depth: 2 } });
    expect(store.currentPath()).toBe('/settings/modules');
    expect(store.resolve('./x', { base: { depth: 1 } })).toBe('/settings/x');

    store.navigate('~/profile');
    expect(store.currentPath()).toBe('/profile');
    expect(window.location.pathname).toBe('/space/abc/board');
  });

  it('writes a query for the caller and hands the rest to the router', () => {
    const { store, calls } = mountStore('/spaces');
    store.navigate('/spaces/abc', { query: { id: 'ad4m://obj/x' }, replace: true, fresh: true });
    expect(calls.at(-1)).toEqual({ to: '/spaces/abc?id=ad4m://obj/x', options: { replace: true } });
    expect(store.page()).toBe('/spaces/abc?id=ad4m://obj/x');
  });

  it('reads params from its own location', () => {
    const { store } = mountStore('/settings?tab=modules');
    expect(store.params()).toEqual({ tab: 'modules' });
  });

  it('setParam writes the reactive record without a history entry, and null removes', () => {
    const { store, calls } = mountStore();
    expect(store.params()).toEqual({});

    store.setParam('tab', 'modules');
    expect(store.params()).toEqual({ tab: 'modules' });
    expect(calls.at(-1)?.options).toEqual({ replace: true });

    store.setParam('tab', null);
    expect(store.params()).toEqual({});
    store.setParam('tab', 'ai', { push: true });
    expect(calls.at(-1)?.options).toEqual({ replace: false });
  });

  it('keeps the overlay out of the browser URL, and the path alone when only a param changes', () => {
    const before = window.location.href;
    const { store } = mountStore();
    store.setParam('tab', 'modules');
    expect(window.location.href).toBe(before);
    expect(store.currentPath()).toBe('/settings');
    expect(store.segments()).toEqual(['settings']);
    expect(store.templateSegments()).toEqual(['settings']);
  });

  it('goes back through its own history, not the browser’s', () => {
    const back = vi.spyOn(window.history, 'back');
    const { store } = mountStore('/spaces');
    store.navigate('/spaces/abc');
    store.back();
    expect(store.currentPath()).toBe('/spaces');
    expect(back).not.toHaveBeenCalled();
  });

  it('takes back only the navigate it was lent, and warns with none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, takeBack } = mountStore();
    const second = vi.fn();
    store.setNavigateFunction(second);
    takeBack();
    store.navigate('/profile');
    expect(second).toHaveBeenCalledWith('/profile', undefined);

    const takeBackSecond = store.setNavigateFunction(second);
    takeBackSecond();
    store.navigate('/profile');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('wakes nothing that reads segments or params when the router repeats its location', () => {
    const { store } = mountStore('/settings?tab=ai');
    const seen: string[] = [];
    disposers.push(port.root(() => port.effect(() => void seen.push(store.currentPath()))));
    const paramsSeen: Record<string, string>[] = [];
    disposers.push(port.root(() => port.effect(() => void paramsSeen.push(store.params()))));
    const before = [seen.length, paramsSeen.length];
    store.setCurrentPath('/settings');
    store.setSearch('?tab=ai');
    expect([seen.length, paramsSeen.length]).toEqual(before);
  });
});
