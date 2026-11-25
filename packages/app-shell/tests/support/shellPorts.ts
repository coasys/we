/**
 * Building the shell store under a reactivity port, for the tests that run it under each one.
 *
 * The host state the store reads and publishes — the app's frame, lane frames, the panel instances
 * on screen — is made over the same port, so nothing in the store's graph is Solid's when the test
 * port is the one under test. The store is built inside a root, as a composition root builds it.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';

import { createAppFrame } from '../../src/shared/registries/appFrame';
import { createLaneFrames } from '../../src/shared/registries/homeLanes';
import { createPanelInstances } from '../../src/shared/registries/panelInstances';
import { createShellStore, type ShellStore, type ShellStoreDeps } from '../../src/shared/stores/ShellStore';

export const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

export interface BuiltShell {
  store: ShellStore;
  host: ShellStoreDeps['host'] & ReturnType<typeof createAppFrame> & ReturnType<typeof createPanelInstances>;
  dispose: () => void;
}

export function buildShell(
  reactivity: ReactivityPort,
  deps: Partial<Omit<ShellStoreDeps, 'reactivity'>> = {},
): BuiltShell {
  const host = {
    ...createAppFrame(reactivity),
    ...createLaneFrames(reactivity),
    ...createPanelInstances(reactivity),
  };
  let store!: ShellStore;
  const dispose = reactivity.root(() => {
    store = createShellStore({ reactivity, host, ...deps });
  });
  return { store, host, dispose };
}
