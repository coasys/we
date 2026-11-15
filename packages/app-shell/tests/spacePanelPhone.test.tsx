/**
 * A space's own panel on a phone covers the space's tree rather than sharing the window with it.
 *
 * A Coasys space is a row: the tree's lane, the view, and a lane on the right that folds while
 * nothing in it is open (`foldEmpty`) — the inspector, and the space's settings the gear in the
 * tree's header opens. Below `NARROW_VIEWPORT_PX` every lane asks for the whole row and gives way, so
 * at 390px the settings opened beside the tree and the two split the window: the tree's labels cut to
 * "Pe…", the settings' tabs to "T.". Below `sm` (`shellStore.narrowWindow`, the rule the phone's rail
 * and Settings follow) the lane that opened takes the whole row while it is open, and the tree has it
 * back when it closes. A desktop window keeps the two side by side.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelHost } from '../src/frameworks/solid/components/PanelHost';
import PanelLane from '../src/frameworks/solid/components/PanelLane';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { dockRegistry, registerHostDockStore, unregisterHostDockStore } from '../src/shared/registries/dockRegistry';
import { provideChromeBag, provideTemplateBag } from '../src/shared/registries/templateBag';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';
import { buildTemplateBag, CHROME_TIER } from '../src/shared/registries/templateSurface';

/** The space's settings: the host's panel, opened by the gear and closed from its own header. */
const [settingsOpen, setSettingsOpen] = createSignal(false);
const HOST = 'host-settings';

const text = (words: string) => ({ type: 'span', children: [words] });

const initialWidth = window.innerWidth;
const initialMatchMedia = window.matchMedia;
let release: (() => void)[] = [];

/** The window at a width, as both the shell's `narrowWindow` and a lane's media query see it. */
function resize(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.matchMedia = ((query: string) => {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);
    return {
      matches: width <= max,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }) as unknown as typeof window.matchMedia;
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/space/test');
  setSettingsOpen(false);
  registerHostDockStore(HOST, {
    edge: () => (settingsOpen() ? 'right' : null),
    close: () => setSettingsOpen(false),
  });
  dockRegistry.register({ id: `${HOST}:panel`, moduleId: HOST, edge: 'edge', close: 'close', node: text('Settings') });
  release = [provideTemplateBag({} as never)];
  // As the Coasys space declares them: the tree at home on the left, the settings on the right.
  setTemplatePanels(
    [
      { id: 'tree', node: text('Tree'), home: 'tree', grow: 1, fixed: true },
      { id: 'settings', module: HOST, home: 'inspector', title: 'Space settings', grow: 1, fixed: true, open: false },
    ],
    'coasys-space',
  );
});

afterEach(() => {
  cleanup();
  setTemplatePanels(undefined);
  dockRegistry.remove(`${HOST}:panel`);
  unregisterHostDockStore(HOST);
  release.forEach((done) => done());
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
  window.matchMedia = initialMatchMedia;
});

/** The space's row, with its lanes as the Coasys space lays them out. */
function mountSpace() {
  const Grab = () => {
    const store = useShellStore();
    release.push(provideChromeBag(buildTemplateBag({ shellStore: store } as never, { grants: CHROME_TIER }) as never));
    return null;
  };
  const { container } = render(() => (
    <ShellStoreProvider>
      <Grab />
      <div style={{ display: 'flex', width: '100%' }}>
        <PanelLane lane="tree" width="280px" minWidth="220px" resize="end" />
        <div style={{ flex: '1', 'min-width': '0' }} />
        <PanelLane lane="inspector" width="340px" minWidth="280px" resize="start" foldEmpty />
      </div>
      <PanelHost />
    </ShellStoreProvider>
  ));
  const lanes = [...container.querySelectorAll<HTMLElement>('[data-we-panel-lane]')];
  return { tree: lanes[0], panel: lanes[1] };
}

describe("a space's own panel at phone width", () => {
  it('covers the tree while it is open, and gives the tree the window back when it closes', async () => {
    resize(390);
    const { tree, panel } = mountSpace();
    // Nothing open: the tree has the window and the panel's lane is folded away.
    expect(tree.style.width).toBe('100%');
    expect(panel.style.width).toBe('0px');

    setSettingsOpen(true);
    await vi.waitFor(() => expect(panel.textContent).toContain('Settings'));
    // The whole row, and it does not give way, so the tree beside it does — to nothing.
    expect(panel.style.width).toBe('100%');
    expect(panel.style.flex).toBe('0 0 100%');
    expect(tree.style.minWidth).toBe('0px');
    expect(tree.style.flex).toBe('');
    // Its own close stays where it was: the section's header has one, and it is named for a screen
    // reader rather than being an icon alone.
    const close = [...panel.querySelectorAll('we-icon')].find(
      (icon) => (icon as HTMLElement & { name?: string }).name === 'x',
    );
    expect(close).toBeDefined();
    expect((close!.closest('we-button') as HTMLElement & { label?: string }).label).toBe('Close');

    setSettingsOpen(false);
    expect(panel.style.width).toBe('0px');
    expect(panel.style.flex).toBe('');
    expect(tree.style.width).toBe('100%');
  });

  it('follows the window across `sm`: a phone turned into a wider window puts the two side by side again', async () => {
    resize(390);
    const { panel } = mountSpace();
    setSettingsOpen(true);
    await vi.waitFor(() => expect(panel.textContent).toContain('Settings'));
    expect(panel.style.flex).toBe('0 0 100%');

    // Wider than `sm`, narrower than a lane can keep its width in: the lanes share, as they did.
    resize(700);
    expect(panel.style.flex).toBe('');
  });

  it('leaves a desktop window as it was: the panel beside the tree, at its own width', async () => {
    resize(1280);
    const { tree, panel } = mountSpace();
    setSettingsOpen(true);
    await vi.waitFor(() => expect(panel.textContent).toContain('Settings'));
    expect(panel.style.width).toBe('340px');
    expect(panel.style.flex).toBe('0 0 auto');
    expect(tree.style.width).toBe('280px');
    expect(tree.style.flex).toBe('0 0 auto');
  });
});
