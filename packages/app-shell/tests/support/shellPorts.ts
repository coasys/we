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

import { createTestPlatform, type TestPlatform } from '../../src/shared/platform/testPlatform';
import { createAppFrame } from '../../src/shared/registries/appFrame';
import { createLaneFrames } from '../../src/shared/registries/homeLanes';
import { createPanelInstances } from '../../src/shared/registries/panelInstances';
import { createShellArrangement } from '../../src/shared/stores/shell/arrangement';
import { createShellDockDrag } from '../../src/shared/stores/shell/dockDrag';
import { createShellDocks } from '../../src/shared/stores/shell/docks';
import { createShellPrompts } from '../../src/shared/stores/shell/prompts';
import { createShellTemplatePanels } from '../../src/shared/stores/shell/templatePanels';
import { createShellViews } from '../../src/shared/stores/shell/views';
import { createShellStore, type ShellStore, type ShellStoreDeps } from '../../src/shared/stores/ShellStore';

export const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

/**
 * A key press as the window delivers one, for a test platform to send: what a store's key handler
 * reads, and `preventDefault` remembered as `defaultPrevented`.
 */
export function keydown(init: Partial<Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>>) {
  let prevented = false;
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...init,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
  } as unknown as KeyboardEvent;
}

export interface BuiltShell {
  store: ShellStore;
  /** The window the store was built in: a test platform, unless the test gave its own. */
  platform: ShellStoreDeps['platform'];
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
  const platform = deps.platform ?? createTestPlatform();
  const dispose = reactivity.root(() => {
    store = createShellStore({ reactivity, host, ...deps, platform });
  });
  return { store, platform, host, dispose };
}

/** Each part built on its own, in the order the store composes them — for the parts' own tests. */
export function buildParts(
  reactivity: ReactivityPort,
  platform: TestPlatform & Pick<ShellStoreDeps['platform'], 'screenSources'> = createTestPlatform(),
) {
  const host = {
    ...createAppFrame(reactivity),
    ...createLaneFrames(reactivity),
    ...createPanelInstances(reactivity),
  };
  let parts!: {
    views: ReturnType<typeof createShellViews>;
    prompts: ReturnType<typeof createShellPrompts>;
    arrangement: ReturnType<typeof createShellArrangement>;
    docks: ReturnType<typeof createShellDocks>;
    drag: ReturnType<typeof createShellDockDrag>;
    templatePanels: ReturnType<typeof createShellTemplatePanels>;
  };
  const dispose = reactivity.root(() => {
    const views = createShellViews({ reactivity, platform });
    const prompts = createShellPrompts({ reactivity, platform });
    const arrangement = createShellArrangement({ reactivity, platform, host });
    const docks = createShellDocks({ reactivity, platform, host, views, arrangement });
    const drag = createShellDockDrag({ reactivity, platform, arrangement, docks });
    const templatePanels = createShellTemplatePanels({ reactivity, views, arrangement, docks });
    parts = { views, prompts, arrangement, docks, drag, templatePanels };
  });
  return { ...parts, platform, host, dispose };
}
