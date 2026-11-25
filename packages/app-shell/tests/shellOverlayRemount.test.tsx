/**
 * The overlay surviving a remount, with both real stores wired together.
 *
 * `shellRouterRoot.test.tsx` mocks `ShellStore`; `shellPathMemory.test.tsx` drives `ShellStore`
 * directly with no router. Both passed while the feature was still broken, because the bug lived in
 * the *interaction*: effects run in creation order, so the overlay's location effect fired before
 * `onMount` — with the fresh `MemoryRouter`'s `/` — and overwrote the remembered path with the very
 * thing the restore was about to read. The answer was destroyed by the question.
 *
 * So this one mocks nothing, and remounts the router subtree the way `TemplateLayout` does when the
 * main route table is rebuilt.
 */
import { MemoryRouter, Route } from '@solidjs/router';
import { render, waitFor } from '@solidjs/testing-library';
import { solidReactivity } from '@we/reactivity-solid';
import { createSignal, Show } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { shellHost } from '../src/frameworks/solid/hostState';
import { ShellRouterRoot } from '../src/frameworks/solid/layouts/ShellRouterRoot';
import { StoreRegistryContext } from '../src/frameworks/solid/stores/useStore';
import type { RouteStore } from '../src/shared/stores/RouteStore';
import { createShellRouteStore } from '../src/shared/stores/ShellRouteStore';
import type { ShellStore } from '../src/shared/stores/ShellStore';
import { createShellStore } from '../src/shared/stores/ShellStore';

/**
 * Mount the overlay under a key we control, standing in for the main Router's `routeKey`.
 *
 * The shell store is made outside the keyed part, exactly as it is in the real tree — it is composed
 * at `BootController`, above `TemplateProvider` — while the overlay's route store and everything
 * below it are made inside, because in the real tree all of that is built by `TemplateLayout`.
 */
function mountOverlay() {
  let shell!: ShellStore;
  let route: RouteStore | undefined;
  const [routeKey, setRouteKey] = createSignal(1);

  render(() => {
    shell = createShellStore({ reactivity: solidReactivity, host: shellHost });
    return (
      <StoreRegistryContext.Provider value={{ shellStore: shell }}>
        {/* The key is taken as an argument, mirroring `TemplateProvider`'s `{(_key) => …}`. A child
          that ignores it is not re-invoked on a change, so the subtree would never rebuild and the
          test would assert nothing. */}
        <Show when={routeKey()} keyed>
          {(_key) => {
            const shellRoute = createShellRouteStore({ reactivity: solidReactivity });
            route = shellRoute;
            return (
              <MemoryRouter root={(props) => <ShellRouterRoot store={shellRoute}>{props.children}</ShellRouterRoot>}>
                <Route path="*" component={() => null} />
              </MemoryRouter>
            );
          }}
        </Show>
      </StoreRegistryContext.Provider>
    );
  });

  return {
    shell,
    at: () => route?.currentPath(),
    /** What removing a section does: the main route table changes, so everything under it rebuilds. */
    rebuildRouteTable: () => setRouteKey((n) => n + 1),
  };
}

describe('shell overlay across a route-table rebuild', () => {
  it('comes back where it was', async () => {
    const overlay = mountOverlay();
    overlay.shell.openShellView('settings');
    await waitFor(() => expect(overlay.at()).toBe('/'));

    overlay.shell.rememberShellPath('/spaces/abc');
    // Not a mocked report: this is the same call the overlay's own effect makes as it navigates.
    await waitFor(() => expect(overlay.shell.takePendingPath()).toBe('/spaces/abc'));

    overlay.rebuildRouteTable();

    // Without the fix this lands on '/', which in Settings is the account page — the reported bug.
    await waitFor(() => expect(overlay.at()).toBe('/spaces/abc'));
  });

  it('survives more than one rebuild in a row', async () => {
    // Toggling three sections is three rebuilds, and the second must not be restored from whatever
    // the first left behind.
    const overlay = mountOverlay();
    overlay.shell.openShellView('settings');
    await waitFor(() => expect(overlay.at()).toBe('/'));
    overlay.shell.rememberShellPath('/spaces/abc');

    overlay.rebuildRouteTable();
    await waitFor(() => expect(overlay.at()).toBe('/spaces/abc'));

    overlay.rebuildRouteTable();
    await waitFor(() => expect(overlay.at()).toBe('/spaces/abc'));
  });

  it('still honours a path named at open time', async () => {
    const overlay = mountOverlay();
    overlay.shell.openShellView('settings');
    await waitFor(() => expect(overlay.at()).toBe('/'));
    overlay.shell.rememberShellPath('/spaces/abc');
    overlay.shell.closeShellView();

    // The About pencil naming a different space must win over where settings was last left.
    overlay.shell.openShellView('settings', '/spaces/xyz');
    overlay.rebuildRouteTable();

    await waitFor(() => expect(overlay.at()).toBe('/spaces/xyz'));
  });
});
