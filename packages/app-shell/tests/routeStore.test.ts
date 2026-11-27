/**
 * routeStore's query-param machinery — the store half of the routing
 * conventions (docs/architecture/routing-and-view-state.md): reactive params,
 * push-vs-replace writes, and the per-path search memory that keeps a
 * kept-alive route's URL truthful after leaving and returning.
 *
 * A plain store test, run once under each engine (Solid, the test port, Vue). Nothing is mounted:
 * the address and its history are the test platform's.
 */
import type { ReactivityPort } from '@we/reactivity';
import { resolveHref } from '@we/schema-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestPlatform, type TestPlatform } from '../src/shared/platform/testPlatform';
import { createRouteStore, type RouteStore } from '../src/shared/stores/RouteStore';
import { reactivityPorts } from './support/engines';

describe.each(reactivityPorts)('routeStore, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  let platform: TestPlatform;
  const disposers: (() => void)[] = [];

  /** The store inside a root of its own, as the host builds it; disposed after each test. */
  function mountStore(): RouteStore {
    let store!: RouteStore;
    disposers.push(port.root(() => (store = createRouteStore({ reactivity: port, platform }))));
    return store;
  }

  beforeEach(() => {
    port = makePort();
    platform = createTestPlatform({ url: '/cards' });
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.restoreAllMocks();
  });

  describe('reactivity', () => {
    it('a write that changes no parameter wakes nothing that reads params', () => {
      const store = mountStore();
      const seen: Record<string, string>[] = [];
      disposers.push(port.root(() => port.effect(() => void seen.push(store.params()))));
      const before = seen.length;

      store.setParam('sort', 'likes');
      expect(seen.length).toBe(before + 1);
      // The same parameter again, and a report of the same location: nothing new to read.
      store.setParam('sort', 'likes');
      store.setCurrentPath('/cards', '?sort=likes');
      expect(seen.length).toBe(before + 1);
      expect(seen.at(-1)).toEqual({ sort: 'likes' });
    });

    it('derives segments, templateSegments and page from what the router reports', () => {
      const store = mountStore();
      const pages: string[] = [];
      disposers.push(port.root(() => port.effect(() => void pages.push(store.page()))));

      store.setCurrentPath('/space/abc/board', '?id=x');
      expect(store.segments()).toEqual(['space', 'abc', 'board']);
      expect(store.templateSegments()).toEqual(['board']);
      expect(pages.at(-1)).toBe('/space/abc/board?id=x');
    });

    it('keeps a lent navigate as the function it is, and takes back only its own', () => {
      const store = mountStore();
      const first = vi.fn();
      const second = vi.fn();
      const takeBackFirst = store.setNavigateFunction(first);
      store.setNavigateFunction(second);

      // The first router going away must not empty the slot its replacement fills.
      takeBackFirst();
      store.navigate('/wall');
      expect(second).toHaveBeenCalledWith('/wall', undefined);
      expect(first).not.toHaveBeenCalled();
    });

    it('stops listening to Back and Forward when its owner is disposed', () => {
      const store = mountStore();
      disposers.splice(0).forEach((dispose) => dispose());

      platform.setUrl('/cards?sort=new');
      platform.emit('popstate', {} as PopStateEvent);
      expect(store.params()).toEqual({});
    });
  });

  describe('routeStore params', () => {
    it('setParam writes the URL and the reactive record; null removes', () => {
      const store = mountStore();

      store.setParam('sort', 'likes');
      expect(platform.location().search).toBe('?sort=likes');
      expect(store.params()).toEqual({ sort: 'likes' });

      store.setParam('sort', null);
      expect(platform.location().search).toBe('');
      expect(store.params()).toEqual({});
    });

    it('writes a URI value readably, and reads it back the same', () => {
      // A record id is a URI. Encoded, the address said `ad4m%3A%2F%2Fobj%2Fx` where a link to the
      // same call says `ad4m://obj/x`.
      const store = mountStore();

      store.setParam('call', 'ad4m://obj/x');

      expect(platform.location().search).toBe('?call=ad4m://obj/x');
      expect(store.params()).toEqual({ call: 'ad4m://obj/x' });
    });

    it('still encodes what a query cannot hold', () => {
      const store = mountStore();

      store.setParam('q', 'a&b=c #d');

      expect(store.params()).toEqual({ q: 'a&b=c #d' });
      expect(platform.location().search).not.toContain('&b=');
    });

    it('replace by default, push on request', () => {
      const store = mountStore();
      const pushSpy = vi.spyOn(platform.history, 'push');
      const replaceSpy = vi.spyOn(platform.history, 'replace');

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
      platform.setUrl('/about');
      store.setCurrentPath('/about');

      store.navigate('/cards');
      expect(nav).toHaveBeenCalledWith('/cards?sort=likes', undefined);

      // Explicit search in the target is never overridden.
      store.navigate('/cards?sort=date');
      expect(nav).toHaveBeenLastCalledWith('/cards?sort=date', undefined);
    });

    /*
    Going to what a page draws with nothing in its query. Restored, the remembered query showed
    another view of the page: a space remembering `?channel=` opened that channel, not the Feed a
    bot notice's Open was for.
  */
    it('a fresh navigate restores no remembered search', () => {
      const store = mountStore();
      const nav = vi.fn();
      store.setNavigateFunction(nav as never);

      store.setParam('sort', 'likes');
      platform.setUrl('/about');
      store.setCurrentPath('/about');

      store.navigate('/cards', { fresh: true });
      expect(nav).toHaveBeenLastCalledWith('/cards', undefined);
    });

    it('a fresh navigate leaves the same page under another query', () => {
      const store = mountStore();
      const nav = vi.fn();
      store.setNavigateFunction(nav as never);
      store.setCurrentPath('/cards', '?sort=likes');

      // Without fresh this is the page already on screen, and nothing moves.
      store.navigate('/cards');
      expect(nav).not.toHaveBeenCalled();

      store.navigate('/cards', { fresh: true });
      expect(nav).toHaveBeenLastCalledWith('/cards', undefined);

      // Already there with no query: nothing to do.
      nav.mockClear();
      store.setCurrentPath('/cards', '');
      store.navigate('/cards', { fresh: true });
      expect(nav).not.toHaveBeenCalled();
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
      // Resolved from the root, which outside a space is `/`.
      expect(nav).toHaveBeenLastCalledWith('/board?id=ad4m://obj/xkav', undefined);

      const awkward = 'literal://string:a+b&c=d#e%20f';
      store.navigate('./board', { query: { id: awkward } });
      const [written] = nav.mock.lastCall!;
      expect(new URL(written, 'http://x/').searchParams.get('id')).toBe(awkward);

      // An interpreted record's id carries its source already encoded. Pasted after a `?` by hand it
      // read back decoded — another id — so nothing compared against it ever matched.
      const interpreted = 'we://interpreted/ad4m%3A%2F%2Fobj%2Fefz/actionitem/480f';
      store.navigate('/space/s1/workflows', { query: { card: interpreted } });
      const url = new URL(nav.mock.lastCall![0] as string, 'http://x/');
      store.setCurrentPath(url.pathname, url.search);
      expect(store.params().card).toBe(interpreted);
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
      platform.setUrl('/space/x/board?id=ad4m://obj/a&sort=new');
      const store = mountStore();
      store.setCurrentPath('/space/x/board', '?id=ad4m://obj/a&sort=new');
      expect(store.page()).toBe('/space/x/board?id=ad4m://obj/a');

      store.setCurrentPath('/space/x/board', '?id=ad4m://obj/b');
      expect(store.page()).toBe('/space/x/board?id=ad4m://obj/b');

      store.setCurrentPath('/space/x', '?sort=new');
      expect(store.page()).toBe('/space/x');
    });

    /*
    A relative path is resolved here, against the router's own address: from the route the node is in
    (the base the renderer hands over), or from the template's root, which is the space.
  */
    it('resolves a relative path from the route it was written in, or from the template’s root', () => {
      platform.setUrl('/space/abc/board?id=x');
      const store = mountStore();
      const nav = vi.fn();
      store.setNavigateFunction(nav as never);
      store.setCurrentPath('/space/abc/board', '?id=x');

      store.navigate('..', { base: { depth: 3 } });
      expect(nav).toHaveBeenLastCalledWith('/space/abc', undefined);
      store.navigate('./cards', { base: { depth: 3 } });
      expect(nav).toHaveBeenLastCalledWith('/space/abc/board/cards', undefined);
      store.navigate('~/wall');
      expect(nav).toHaveBeenLastCalledWith('/space/abc/wall', undefined);
      // No base: from the root, never from wherever the router happens to sit.
      store.navigate('./wall');
      expect(nav).toHaveBeenLastCalledWith('/space/abc/wall', undefined);
      store.navigate('/settings');
      expect(nav).toHaveBeenLastCalledWith('/settings', undefined);
    });

    it('a link drawn from its profile members leads where navigate goes', () => {
      platform.setUrl('/space/abc/board');
      const store = mountStore();
      const nav = vi.fn();
      store.setNavigateFunction(nav as never);
      store.setCurrentPath('/space/abc/board');
      const link = (to: string, depth?: number) =>
        resolveHref(to, {
          currentPath: store.currentPath(),
          segments: store.segments(),
          templateSegments: store.templateSegments(),
          ...(depth !== undefined && { depth }),
        });

      expect(link('..', 3)).toBe('/space/abc');
      expect(link('~/wall')).toBe('/space/abc/wall');
      expect(nav).not.toHaveBeenCalled();
      store.navigate('..', { base: { depth: 3 } });
      expect(nav).toHaveBeenCalledWith('/space/abc', undefined);
    });

    it('clearing the param clears the memory — returning lands bare', () => {
      const store = mountStore();
      const nav = vi.fn();
      store.setNavigateFunction(nav as never); // takes the function itself now; it does its own wrapping

      store.setParam('sort', 'likes');
      store.setParam('sort', null); // back to default
      platform.setUrl('/about');
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
      platform.setUrl('/space/x/canvas?call=c1&card=k1');
      const store = mountStore();
      store.setCurrentPath('/space/x/canvas', '?call=c1&card=k1');

      platform.setUrl('/space/x/about'); // the stray write
      store.setParam('card', null);

      expect(platform.location().pathname).toBe('/space/x/canvas');
      expect(platform.location().search).toBe('?call=c1');
      expect(store.params()).toEqual({ call: 'c1' });
    });

    it('navigate is not refused for the page a stale address bar names', () => {
      platform.setUrl('/space/x/canvas');
      const store = mountStore();
      const nav = vi.fn();
      store.setNavigateFunction(nav as never);
      store.setCurrentPath('/space/x/canvas', '');

      platform.setUrl('/space/x/about');
      store.navigate('/space/x/about');
      expect(nav).toHaveBeenCalledWith('/space/x/about', undefined);
    });

    it('params arriving via a shared link are remembered from arrival', () => {
      platform.setUrl('/cards?type=users');
      const store = mountStore();
      const nav = vi.fn();
      store.setNavigateFunction(nav as never); // takes the function itself now; it does its own wrapping
      store.setCurrentPath('/cards'); // the router reporting arrival

      platform.setUrl('/about');
      store.setCurrentPath('/about');

      store.navigate('/cards');
      expect(nav).toHaveBeenCalledWith('/cards?type=users', undefined);
    });
  });
});
