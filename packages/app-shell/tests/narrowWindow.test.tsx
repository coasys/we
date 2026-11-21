/**
 * `shellStore.narrowWindow` — whether the window is a phone held upright.
 *
 * WE's chrome reads it to stop the sidebar opening under a touch: a tap reports the pointer
 * arriving and nothing reports it leaving, so a rail that opens on hover stayed open over the page.
 * The chrome is outside every surface, so it cannot use `smUpProps`; this is the window's own answer,
 * at the same `sm` breakpoint the surfaces use.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { NARROW_WINDOW_PX } from '../src/shared/dockGeometry';
import { TEMPLATE_SURFACE } from '../src/shared/registries/templateSurface';

const initialWidth = window.innerWidth;

function resize(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

function mountShellStore(): ShellStore {
  let store!: ShellStore;
  const Grab = () => {
    store = useShellStore();
    return null;
  };
  render(() => (
    <ShellStoreProvider>
      <Grab />
    </ShellStoreProvider>
  ));
  return store;
}

afterEach(() => {
  cleanup();
  resize(initialWidth);
});

describe('shellStore.narrowWindow', () => {
  it('is the sm breakpoint, the one a surface flips its own layout at', () => {
    expect(NARROW_WINDOW_PX).toBe(640);
  });

  it('is true for a phone held upright and false for a desktop window', () => {
    resize(1280);
    const shell = mountShellStore();
    expect(shell.narrowWindow()).toBe(false);
    resize(412);
    expect(shell.narrowWindow()).toBe(true);
    resize(NARROW_WINDOW_PX);
    expect(shell.narrowWindow()).toBe(false);
  });

  it('is chrome-tier state: an app template reads it, a space template answers to its surface', () => {
    expect(TEMPLATE_SURFACE.shellStore?.narrowWindow).toEqual({ group: 'host-layout', kind: 'state' });
  });
});
