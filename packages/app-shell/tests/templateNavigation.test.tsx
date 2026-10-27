/**
 * Where a template's links go, through the real router.
 *
 * Mounted the way `TemplateProvider` and `TemplateLayout` mount a template: its routes built by
 * `buildRoutes` under the space prefix, the router's `navigate` lent to `routeStore` by the root
 * layout, and the template's chrome rendered beside the routes with the root's base. Then a press,
 * and the address it lands on.
 *
 * The pieces each had tests; this path through all of them had none, which is how five back buttons
 * that did nothing, and a resolver that ran only for paths known at render time, went unnoticed.
 */
import { buildRoutes } from '@solid/utils/buildRoutes';
import { Route, Router, useLocation, useNavigate } from '@solidjs/router';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { type SchemaNode, SPACE_ROUTE_DEPTH, SPACE_ROUTE_PATH } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { createEffect, onCleanup, type ParentProps } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';

import RouteStoreProvider, { type RouteStore, useRouteStore } from '../src/frameworks/solid/stores/RouteStore';

const go = (id: string, to: string): SchemaNode => ({
  type: 'button',
  props: { id, onClick: { $invoke: 'routeStore.navigate', args: [to] } },
  children: [id],
});

/** A template whose chrome and pages link to each other in every way the rule allows. Plain elements,
 * so nothing here depends on the component registry. */
const template: SchemaNode = {
  type: 'div',
  children: [go('chrome-board', './board'), go('chrome-home', '.'), { type: '$routes' }],
  routes: [
    { path: '/', type: 'div', children: [go('list-board', './board')] },
    {
      path: '/board',
      type: 'div',
      children: [
        go('board-up', '..'),
        go('board-home', '~/'),
        go('board-wall', '../wall'),
        go('board-self', '.'),
        go('board-child', './cards'),
        { type: 'a', props: { id: 'board-link', href: '~/wall' }, children: ['wall'] },
      ],
    },
    { path: '/wall', type: 'div', children: ['wall'] },
  ] as never,
};

function mount(): RouteStore {
  let routeStore!: RouteStore;
  function Grab() {
    routeStore = useRouteStore();
    return null;
  }
  const stores = () => ({ routeStore }) as never;
  function Layout(props: ParentProps) {
    const navigate = useNavigate();
    const location = useLocation();
    onCleanup(routeStore.setNavigateFunction(navigate));
    createEffect(() => routeStore.setCurrentPath(location.pathname, location.search));
    return (
      <RenderSchema
        node={template}
        stores={stores()}
        registry={{}}
        context={{ $nav: { baseDepth: SPACE_ROUTE_DEPTH } }}
        children={props.children as never}
      />
    );
  }
  render(() => (
    <RouteStoreProvider>
      <Grab />
      <Router root={Layout}>
        {buildRoutes(stores(), [
          { path: SPACE_ROUTE_PATH, type: 'div', children: [{ type: '$routes' }], routes: template.routes } as never,
        ])}
        <Route path="*" component={() => null} />
      </Router>
    </RouteStoreProvider>
  ));
  return routeStore;
}

const press = (id: string) => fireEvent.click(document.getElementById(id)!);
const shown = (id: string) => waitFor(() => expect(document.getElementById(id)).not.toBeNull());
const at = (path: string) => waitFor(() => expect(window.location.pathname).toBe(path));

beforeEach(() => window.history.replaceState(null, '', '/space/abc'));

describe('a link in a template’s chrome', () => {
  it('is from the template’s root', async () => {
    mount();
    await shown('chrome-board');
    press('chrome-board');
    await at('/space/abc/board');
    press('chrome-home');
    await at('/space/abc');
  });
});

describe('a link on one of its pages', () => {
  it('is from that page: up, home, and across', async () => {
    mount();
    await shown('list-board');
    press('list-board');
    await at('/space/abc/board');

    press('board-wall');
    await at('/space/abc/wall');

    window.history.pushState(null, '', '/space/abc/board');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await shown('board-up');
    press('board-up');
    await at('/space/abc');

    press('list-board');
    await at('/space/abc/board');
    press('board-home');
    await at('/space/abc');
  });

  it('goes below itself with ./, from the page and not from the root', async () => {
    window.history.replaceState(null, '', '/space/abc/board');
    mount();
    await shown('board-child');
    press('board-child');
    await at('/space/abc/board/cards');
  });

  it('stays put for ., which is the page it is on', async () => {
    window.history.replaceState(null, '', '/space/abc/board');
    mount();
    await shown('board-self');
    press('board-self');
    await new Promise((r) => setTimeout(r, 20));
    expect(window.location.pathname).toBe('/space/abc/board');
  });

  it('draws a relative href as the address a press would go to', async () => {
    window.history.replaceState(null, '', '/space/abc/board');
    mount();
    await waitFor(() => expect(document.getElementById('board-link')?.getAttribute('href')).toBe('/space/abc/wall'));
  });
});
