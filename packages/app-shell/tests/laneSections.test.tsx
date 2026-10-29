/**
 * A home lane holding any panel — a template's own, and one registered by the host or a module —
 * folding while nothing in it is open, and two panels sharing one place as tabs. Driven through the
 * real shell store and dock registry.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelHost } from '../src/frameworks/solid/components/PanelHost';
import PanelLane from '../src/frameworks/solid/components/PanelLane';
import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { dockRegistry, registerHostDockStore, unregisterHostDockStore } from '../src/shared/registries/dockRegistry';
import { slotRegistry } from '../src/shared/registries/slotRegistry';
import { provideChromeBag, provideTemplateBag } from '../src/shared/registries/templateBag';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';
import { buildTemplateBag, CHROME_TIER } from '../src/shared/registries/templateSurface';

/** A host panel — settings, say — whose open state is its own, with a close the lane's header calls. */
const [hostOpen, setHostOpen] = createSignal(false);
const HOST = 'host-thing';

const text = (words: string) => ({ type: 'span', children: [words] });

let release: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/space/test');
  setHostOpen(false);
  registerHostDockStore(HOST, { edge: () => (hostOpen() ? 'right' : null), close: () => setHostOpen(false) });
  dockRegistry.register({ id: `${HOST}:panel`, moduleId: HOST, edge: 'edge', close: 'close', node: text('Settings') });
  release = [provideTemplateBag({} as never)];
});

afterEach(() => {
  cleanup();
  setTemplatePanels(undefined);
  dockRegistry.remove(`${HOST}:panel`);
  unregisterHostDockStore(HOST);
  release.forEach((done) => done());
});

function mountLane(frame?: 'window' | 'flush' | 'none') {
  let store!: ShellStore;
  const Grab = () => {
    store = useShellStore();
    // Wrapped as the app wraps chrome's stores, so the frames read values rather than accessors.
    release.push(provideChromeBag(buildTemplateBag({ shellStore: store } as never, { grants: CHROME_TIER }) as never));
    return null;
  };
  const { container } = render(() => (
    <ShellStoreProvider>
      <Grab />
      <PanelLane lane="side" width="320px" resize="start" foldEmpty frame={frame} />
      <PanelHost />
    </ShellStoreProvider>
  ));
  return { store, lane: container.firstElementChild as HTMLElement };
}

/** Press a tab without moving it, as the tab strip's handle reports one. */
function pressTab(tab: Element) {
  const detail = { x: 0, y: 0, dx: 0, dy: 0 };
  // Bubbling and composed, as the handle dispatches them — the renderer listens for them delegated.
  tab.dispatchEvent(new CustomEvent('movestart', { detail, bubbles: true, composed: true }));
  tab.dispatchEvent(new CustomEvent('moveend', { detail, bubbles: true, composed: true }));
}

/** The tabs of every strip in the lane. */
const tabsIn = (lane: Element) =>
  [...lane.querySelectorAll('we-move-handle')].filter((handle) =>
    String((handle as HTMLElement & { label?: string }).label ?? '').includes('drag out of the stack'),
  );

describe('a lane holding any panel', () => {
  it("draws the host's panel at home in it, with its name and a close, and folds once it closes", async () => {
    setTemplatePanels([{ id: 'settings', module: HOST, home: 'side', title: 'Settings' }], 'coasys-space');
    const { lane } = mountLane();
    expect(lane.style.width).toBe('0px');

    setHostOpen(true);
    expect(lane.style.width).toBe('320px');
    await vi.waitFor(() => expect(lane.textContent).toContain('Settings'));
    // Flush, with a header for a panel that draws no heading of its own — its name and its close.
    expect(
      [...lane.querySelectorAll('we-icon')].some((icon) => (icon as HTMLElement & { name?: string }).name === 'x'),
    ).toBe(true);

    setHostOpen(false);
    expect(lane.style.width).toBe('0px');
  });

  it('starts a template panel declared `open: false` closed, and opens it on asking', async () => {
    setTemplatePanels([{ id: 'inspector', node: text('Inspector'), home: 'side', open: false }], 'coasys-space');
    const { store, lane } = mountLane();
    expect(lane.style.width).toBe('0px');

    store.openTemplatePanel('inspector');
    expect(lane.style.width).toBe('320px');
    await vi.waitFor(() => expect(lane.textContent).toContain('Inspector'));

    store.closeTemplatePanel('inspector');
    expect(lane.style.width).toBe('0px');
  });

  it('shares one place between two panels with the same order, as tabs, the last opened in front', async () => {
    setTemplatePanels(
      [
        { id: 'inspector', node: text('Inspector'), title: 'Inspector', home: 'side', order: 0 },
        { id: 'settings', module: HOST, home: 'side', order: 0, title: 'Settings' },
      ],
      'coasys-space',
    );
    const { store, lane } = mountLane();
    // What is showing, as against the tabs naming it — a tab behind the front is hidden, not gone.
    const visible = (el: Element) => !el.closest('[style*="display: none"]');
    const contents = () => [...lane.querySelectorAll('[data-we-dock-content] span')];
    const shown = () =>
      contents()
        .filter(visible)
        .map((span) => span.textContent);
    const mounted = () => contents().map((span) => span.textContent);
    await vi.waitFor(() => expect(shown()).toEqual(['Inspector']));

    setHostOpen(true);
    await vi.waitFor(() => expect(mounted()).toEqual(expect.arrayContaining(['Inspector', 'Settings'])));
    const tabs = tabsIn(lane);
    expect(tabs).toHaveLength(2);
    // Opened on purpose, so in front — and the inspector behind it still mounted, as a background tab keeps its state.
    expect(shown()).toEqual(['Settings']);
    expect(store.dockGeometry()['template:inspector']?.hidden).toBe(true);

    pressTab(tabs[0]);
    expect(shown()).toEqual(['Inspector']);
  });

  /*
    The crash: a call's window dropped into a lane, then a call started. Its panel holds a \`$slot\` that
    other modules fill — the transcript's button in the call's bar — and the lane drew it raw, a node
    type nothing renders, where the edge's frame composes it first.
  */
  it("composes a module's panel as its frame on an edge would, filling the slots other modules contribute to", async () => {
    slotRegistry.register({ id: 'test:hang-up', anchor: 'test-controls', node: text('Hang up') });
    dockRegistry.register({
      id: `${HOST}:panel`,
      moduleId: HOST,
      edge: 'edge',
      close: 'close',
      node: { type: 'Column', children: [text('Call'), { type: '$slot', props: { anchor: 'test-controls' } }] },
    });
    setTemplatePanels([{ id: 'call', module: HOST, home: 'side', title: 'Call' }], 'coasys-space');
    const { lane } = mountLane();

    setHostOpen(true);
    await vi.waitFor(() => expect(lane.textContent).toContain('Hang up'));
    slotRegistry.remove('test:hang-up');
  });

  /*
    The freeze: a call's stage stacked onto an inspector's section was stored as at home in that lane.
    Nothing declared it there, so the placement was not even scoped to the template — it followed its
    owner into every space, and a lane, which grows to fit what is in it, held a stage that sizes
    itself to its box. A lane holds only what an interface declared for one.
  */
  it('does not honour a lane placement for a panel nothing declared for a lane', () => {
    localStorage.setItem(
      'we-local:shell.dockPlacements',
      JSON.stringify({ [`${HOST}:panel`]: { snap: 'home', home: 'side', x: 0, y: 0, w: 320, h: 180 } }),
    );
    setTemplatePanels([{ id: 'inspector', node: text('Inspector'), home: 'side', open: false }], 'coasys-space');
    const { store, lane } = mountLane();

    setHostOpen(true);
    expect(lane.style.width).toBe('0px');
    expect(store.dockPlacement()[`${HOST}:panel`].snap).not.toBe('home');
  });

  /*
    The judder: the shell's list of what each lane holds is worked out again whenever any panel moves,
    and the lane drew its sections from the new entries — so every frame of dragging a call window
    unmounted and redrew the tree and the inspector beside it. A move elsewhere must leave a lane alone.
  */
  it('leaves its sections mounted while a panel elsewhere is dragged', async () => {
    setTemplatePanels([{ id: 'inspector', node: text('Inspector'), home: 'side' }], 'coasys-space');
    const { store, lane } = mountLane();
    setHostOpen(true);
    const content = () => lane.querySelector('[data-we-dock-content] span');
    await vi.waitFor(() => expect(content()?.textContent).toBe('Inspector'));
    const before = content();
    expect(before?.textContent).toBe('Inspector');

    store.beginDockMove(`${HOST}:panel`, 100, 100);
    for (let step = 1; step <= 5; step++) store.moveDock(`${HOST}:panel`, step * 10, step * 5);
    store.endDockMove(`${HOST}:panel`);

    expect(content()).toBe(before);
  });

  // How a section is framed, wherever it lives: its declaration, else its lane's, else flush.
  it('frames a section as its declaration says, else as its lane does', () => {
    setTemplatePanels(
      [
        { id: 'inspector', node: text('Inspector'), title: 'Inspector', home: 'side' },
        { id: 'bare', node: text('Bare'), title: 'Bare', home: 'side', frame: 'none' },
      ],
      'coasys-space',
    );
    const { store, lane } = mountLane('window');
    expect(store.panelFrames()['template:inspector']).toBe('window');
    expect(store.panelFrames()['template:bare']).toBe('none');
    // A window's titlebar — its grip — for the one that says nothing, none for the one that asks for none.
    const grips = [...lane.querySelectorAll('we-move-handle')].filter(
      (handle) => (handle as HTMLElement & { label?: string }).label === 'Move panel',
    );
    expect(grips).toHaveLength(1);
  });

  it('draws a flush section with no titlebar, its grip in the corner instead', () => {
    setTemplatePanels([{ id: 'inspector', node: text('Inspector'), title: 'Inspector', home: 'side' }], 'coasys-space');
    const { store, lane } = mountLane();
    expect(store.panelFrames()['template:inspector']).toBe('flush');
    const labels = [...lane.querySelectorAll('we-move-handle')].map(
      (h) => (h as HTMLElement & { label: string }).label,
    );
    expect(labels).toEqual(['Break out into a panel']);
  });

  it("tells a frame on an edge how its panel is framed, from the panel's declaration", () => {
    setTemplatePanels(
      [
        { id: 'tree', node: text('Tree'), snap: 'left', frame: 'flush' },
        { id: 'plain', node: text('Plain'), snap: 'right' },
      ],
      'coasys-space',
    );
    const { store } = mountLane();
    expect(store.panelFrames()).toEqual({ 'template:tree': 'flush' });
  });

  /*
    Breaking a section out is the ordinary move: it leaves the page once the pointer travels, under
    the pointer, and is carried from there. A press on a flush section's grip — whose whole meaning is
    "break this out" — sends it to its declared snap; a press on a window's titlebar is only a click.
  */
  it('breaks a section out of the page once a drag travels, under the pointer', () => {
    setTemplatePanels([{ id: 'inspector', node: text('Inspector'), home: 'side', snap: 'right' }], 'coasys-space');
    const { store } = mountLane();
    const id = 'template:inspector';

    store.beginDockMove(id, 600, 300);
    store.moveDock(id, 1, 0);
    expect(store.dockPlacement()[id].snap).toBe('home');
    store.moveDock(id, 40, 30);
    expect(store.dockGeometry()[id].home).toBeFalsy();
    // Carried from where the press was: its titlebar under the pointer.
    const left = parseFloat(store.dockGeometry()[id].left ?? '');
    store.moveDock(id, 60, 30);
    expect(parseFloat(store.dockGeometry()[id].left ?? '')).toBe(left + 20);
    store.endDockMove(id);
  });

  it('sends a section to its snap on a press of its break-out grip, and not on a press of its titlebar', () => {
    setTemplatePanels([{ id: 'inspector', node: text('Inspector'), home: 'side', snap: 'right' }], 'coasys-space');
    const { store } = mountLane();
    const id = 'template:inspector';

    store.beginDockMove(id, 200, 100);
    store.endDockMove(id);
    expect(store.dockPlacement()[id].snap).toBe('home');

    store.beginDockMove(id, 200, 100, true);
    store.endDockMove(id);
    expect(store.dockPlacement()[id].snap).toBe('right');
  });
});
