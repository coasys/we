/**
 * WE's stores in a React tree, through the binding beside this file: RouteStore and ClockStore read,
 * an action called from a click, and the component drawn again when what it read changes. Under
 * every engine, since React only sees what the binding hands it.
 */
import type { ReactivityPort } from '@we/reactivity';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppClocks } from '../../src/shared/clocks';
import { createTestPlatform } from '../../src/shared/platform/testPlatform';
import { type ClockStore, createClockStore } from '../../src/shared/stores/ClockStore';
import { createRouteStore, type RouteStore } from '../../src/shared/stores/RouteStore';
import { reactivityPorts } from '../support/engines';
import { StoresProvider, useStore, useValue } from './useStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe.each(reactivityPorts)('stores in React, on %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  let routeStore: RouteStore;
  let clockStore: ClockStore;
  let disposeStores: () => void;
  let container: HTMLElement;
  let root: Root;
  let renders: number;

  function Page() {
    renders++;
    const route = useStore('routeStore');
    const clocks = useStore('clockStore');
    const path = useValue(route.currentPath);
    const clock = useValue(clocks.clocks).main;
    return createElement(
      'main',
      null,
      createElement('p', { id: 'path' }, path),
      createElement('p', { id: 'speed' }, String(clock?.speed ?? 'none')),
      createElement('button', { id: 'go', onClick: () => route.navigate('/about') }, 'About'),
    );
  }

  const text = (id: string) => container.querySelector(`#${id}`)!.textContent;
  const press = (id: string) =>
    act(() =>
      container.querySelector<HTMLElement>(`#${id}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );

  beforeEach(async () => {
    reactivity = makePort();
    const platform = createTestPlatform({ url: '/home' });
    const clocks = createAppClocks(platform);
    disposeStores = reactivity.root(() => {
      routeStore = createRouteStore({ reactivity, platform });
      clockStore = createClockStore({ reactivity, clocks });
      reactivity.onCleanup(() => clocks.dispose());
    });
    // The host's router: write the address, then say where it is.
    routeStore.setNavigateFunction((to) => {
      if (typeof to === 'number') return;
      platform.history.push(to);
      routeStore.setCurrentPath(platform.location().pathname, platform.location().search);
    });
    routeStore.setCurrentPath('/home');
    renders = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root.render(
        createElement(StoresProvider, { stores: { routeStore, clockStore }, reactivity }, createElement(Page)),
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    disposeStores();
  });

  it('draws what the stores hold', () => {
    expect(text('path')).toBe('/home');
    expect(text('speed')).toBe('none');
  });

  it('calls a store action from a press and draws the store’s answer', async () => {
    await press('go');
    expect(text('path')).toBe('/about');
  });

  it('draws again when a store changes underneath it, and only then', async () => {
    const before = renders;
    await act(() => routeStore.setCurrentPath('/home'));
    expect(renders).toBe(before);
    await act(() => clockStore.setSpeed('main', 2));
    expect(text('speed')).toBe('2');
    expect(renders).toBe(before + 1);
  });

  it('stops listening when it unmounts', async () => {
    await act(() => root.unmount());
    root = createRoot(container);
    const before = renders;
    await act(() => routeStore.setCurrentPath('/elsewhere'));
    expect(renders).toBe(before);
  });
});
