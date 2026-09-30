/**
 * Where a shell overlay was standing, remembered above the thing that keeps forgetting.
 *
 * The overlay's `MemoryRouter`, and the `ShellRouteStore` that mirrors it, are both mounted inside
 * `TemplateLayout` — which is the main Router's root. So anything that rebuilds the main route table
 * tears the overlay down, and a fresh `MemoryRouter` comes back up at `/`.
 *
 * That was invisible until sections became data: removing one from a space rebuilds the route table,
 * and a member doing it from that space's settings page was thrown to the account page mid-edit,
 * having asked for nothing of the sort.
 *
 * `ShellStore` sits above the Router and is the only link in the chain that outlives the overlay, so
 * it is where the answer has to live. The overlay's half of the contract is covered in
 * `shellRouteStore.test.tsx`; this is the store's half.
 */
import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';

import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';

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

describe('shell overlay path memory', () => {
  it('hands back the remembered path when the overlay remounts with nothing pending', () => {
    const shell = mountShellStore();

    shell.openShellView('settings');
    expect(shell.takePendingPath()).toBe(null);

    // The overlay navigates to a space's settings and reports each move.
    shell.rememberShellPath('/spaces/abc');

    // Now the main route table is rebuilt: the overlay is destroyed and asks again on the way back
    // up. Without the memory this is null, and a MemoryRouter with no instruction starts at '/'.
    expect(shell.takePendingPath()).toBe('/spaces/abc');
  });

  it('answers more than once, because a remount can happen more than once', () => {
    const shell = mountShellStore();
    shell.openShellView('settings');
    shell.rememberShellPath('/spaces/abc');

    expect(shell.takePendingPath()).toBe('/spaces/abc');
    expect(shell.takePendingPath()).toBe('/spaces/abc');
  });

  it('lets an explicit path win over the remembered one', () => {
    // A gear naming a space must land on that space, not on wherever settings was left last.
    const shell = mountShellStore();
    shell.openShellView('settings');
    shell.rememberShellPath('/spaces/abc');
    shell.closeShellView();

    shell.openShellView('settings', '/spaces/xyz');

    expect(shell.takePendingPath()).toBe('/spaces/xyz');
  });

  it('reopens a view where it was left when no path is named', () => {
    const shell = mountShellStore();
    shell.openShellView('settings');
    shell.rememberShellPath('/spaces/abc');
    shell.closeShellView();

    shell.openShellView('settings');

    expect(shell.takePendingPath()).toBe('/spaces/abc');
  });

  it('keeps each view’s place separate', () => {
    // Profile and settings are different overlays; one reopening must not inherit the other's page.
    const shell = mountShellStore();
    shell.openShellView('settings');
    shell.rememberShellPath('/spaces/abc');
    shell.closeShellView();

    shell.openShellView('profile');

    expect(shell.takePendingPath()).toBe(null);
  });
});
