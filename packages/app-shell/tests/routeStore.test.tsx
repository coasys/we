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

  it('writes a URI value readably, and reads it back the same', () => {
    // A record id is a URI. Encoded, the address said `ad4m%3A%2F%2Fobj%2Fx` where a link to the
    // same call says `ad4m://obj/x`.
    const store = mountStore();

    store.setParam('call', 'ad4m://obj/x');

    expect(window.location.search).toBe('?call=ad4m://obj/x');
    expect(store.params()).toEqual({ call: 'ad4m://obj/x' });
  });

  it('still encodes what a query cannot hold', () => {
    const store = mountStore();

    store.setParam('q', 'a&b=c #d');

    expect(store.params()).toEqual({ q: 'a&b=c #d' });
    expect(window.location.search).not.toContain('&b=');
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

  /*
    A record id is a URI. Pasted into a path it is several segments and the route never matches;
    pasted into a query by hand, one holding `&`, `+` or `#` reads back as something else. Handed to
    navigate as a query value, it reads back exactly, and stays readable in the address.
  */
  it('navigate writes query values so any id reads back exactly', () => {
    const store = mountStore();
    const nav = vi.fn();
    store.setNavigateFunction(nav as never);

    store.navigate('./board', { query: { id: 'ad4m://obj/xkav' } });
    expect(nav).toHaveBeenLastCalledWith('./board?id=ad4m://obj/xkav', undefined);

    const awkward = 'literal://string:a+b&c=d#e%20f';
    store.navigate('./board', { query: { id: awkward } });
    const [written] = nav.mock.lastCall!;
    expect(new URL(written, 'http://x/').searchParams.get('id')).toBe(awkward);
  });

  it('navigate adds to a query already in the path, leaves out empty values and passes the rest on', () => {
    const store = mountStore();
    const nav = vi.fn();
    store.setNavigateFunction(nav as never);

    store.navigate('/flows?new=1', { query: { id: 'ad4m://obj/x', card: '', other: undefined }, replace: true });
    expect(nav).toHaveBeenLastCalledWith('/flows?new=1&id=ad4m://obj/x', { replace: true });
  });

  /*
    Two boards are one path with different ids. Presence compares pages, so a page that left the id
    out would show everybody on any board as here.
  */
  it('page is the path and the record it is about, and nothing else in the query', () => {
    window.history.replaceState(null, '', '/space/x/board?id=ad4m://obj/a&sort=new');
    const store = mountStore();
    store.setCurrentPath('/space/x/board', '?id=ad4m://obj/a&sort=new');
    expect(store.page()).toBe('/space/x/board?id=ad4m://obj/a');

    store.setCurrentPath('/space/x/board', '?id=ad4m://obj/b');
    expect(store.page()).toBe('/space/x/board?id=ad4m://obj/b');

    store.setCurrentPath('/space/x', '?sort=new');
    expect(store.page()).toBe('/space/x');
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

  /*
    A discarded router's navigation can land in `history` after its replacement has mounted, leaving
    the address bar on a page the app is not showing. A parameter write must extend what is on
    screen: reading the bar here turned "clear the selected card" into `/about` with no query, and
    the call the canvas was about went with it.
  */
  it('setParam extends the router’s location, not a stale address bar', () => {
    window.history.replaceState(null, '', '/space/x/canvas?call=c1&card=k1');
    const store = mountStore();
    store.setCurrentPath('/space/x/canvas', '?call=c1&card=k1');

    window.history.replaceState(null, '', '/space/x/about'); // the stray write
    store.setParam('card', null);

    expect(window.location.pathname).toBe('/space/x/canvas');
    expect(window.location.search).toBe('?call=c1');
    expect(store.params()).toEqual({ call: 'c1' });
  });

  it('navigate is not refused for the page a stale address bar names', () => {
    window.history.replaceState(null, '', '/space/x/canvas');
    const store = mountStore();
    const nav = vi.fn();
    store.setNavigateFunction(nav as never);
    store.setCurrentPath('/space/x/canvas', '');

    window.history.replaceState(null, '', '/space/x/about');
    store.navigate('/space/x/about');
    expect(nav).toHaveBeenCalledWith('/space/x/about', undefined);
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
