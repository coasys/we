/**
 * The lanes at the window's edges: a panel pushing the content aside is framed inside its edge's
 * lane, as thick as the room the content gives up — and a drag that takes it out of the lane carries
 * on once the lane's frame, and the grip with it, is gone. Driven through the real shell store and
 * dock registry; where the lanes are on screen is the browser harness's (`dockLanes`).
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EdgeLanes } from '../src/frameworks/solid/components/EdgeLanes';
import { PanelHost } from '../src/frameworks/solid/components/PanelHost';
import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import {
  DOCK_FRAME_ATTR,
  dockFrame,
  dockRegistry,
  registerHostDockStore,
  unregisterHostDockStore,
} from '../src/shared/registries/dockRegistry';
import { provideChromeBag } from '../src/shared/registries/templateBag';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';
import { buildTemplateBag, CHROME_TIER } from '../src/shared/registries/templateSurface';

const HOST = 'edge-test';
const ID = `${HOST}:panel`;

let release: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/space/test');
  registerHostDockStore(HOST, { edge: () => 'right', size: () => 'md', float: () => false });
  const entry = { id: ID, moduleId: HOST, edge: 'edge', size: 'size', float: 'float', node: { type: 'Column' } };
  dockRegistry.register({ ...entry, node: dockFrame(entry as never, { type: 'span', children: ['Notes'] }) } as never);
  setTemplatePanels(
    [{ id: 'panel', module: HOST, dock: 'panel', snap: 'right', displace: true, box: { width: 320 } }],
    'edge-test',
  );
});

afterEach(() => {
  cleanup();
  setTemplatePanels(undefined);
  dockRegistry.remove(ID);
  unregisterHostDockStore(HOST);
  release.forEach((done) => done());
  release = [];
});

function mount() {
  let store!: ShellStore;
  const Chrome = () => {
    store = useShellStore();
    release.push(provideChromeBag(buildTemplateBag({ shellStore: store } as never, { grants: CHROME_TIER }) as never));
    return (
      <>
        <EdgeLanes />
        <PanelHost />
      </>
    );
  };
  render(() => (
    <ShellStoreProvider>
      <Chrome />
    </ShellStoreProvider>
  ));
  return { store, lane: () => document.querySelector<HTMLElement>('[data-we-edge-lanes="right"]') };
}

describe('the lanes at the edges', () => {
  it('frames a panel pushing the content aside inside its edge’s lane, as thick as the room it takes', async () => {
    const { store, lane } = mount();
    expect(store.dockGeometry()[ID]?.inLane).toBe(true);
    expect(lane()?.querySelector(`[${DOCK_FRAME_ATTR}="${ID}"]`)).not.toBeNull();
    // The content slot is a lazily loaded component.
    await vi.waitFor(() => expect(lane()?.textContent).toContain('Notes'));
    expect((lane()?.firstElementChild as HTMLElement).style.width).toBe(`${store.contentInset().right}px`);
  });

  /*
    A drag out of a lane takes the panel out of the lane — and its frame, and the grip being dragged,
    with it. The grip's own events stop there; the window's go on.
  */
  it('carries a drag on from the window once the panel has left its lane', () => {
    const { store, lane } = mount();
    store.beginDockMove(ID, 1000, 10);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 200 }));
    expect(store.dockGeometry()[ID]?.inLane).toBeFalsy();
    expect(store.dockGeometry()[ID]?.floating).toBe(true);
    expect(lane()).toBeNull();

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 250 }));
    const left = parseFloat(store.dockGeometry()[ID]?.left ?? '');
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 250 }));
    expect(store.movingDock()).toBeNull();
    // Landed where it was let go, and nothing more follows the pointer.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100 }));
    expect(parseFloat(store.dockGeometry()[ID]?.left ?? '')).toBe(left);
  });

  it('draws the grip on its inner edge, which sets the lane’s thickness', () => {
    const { store, lane } = mount();
    const before = store.contentInset().right;
    // A lane of one seat has no divider: its only grip is its inner edge.
    const edge = lane()?.querySelector<HTMLElement>('we-resize-handle');
    expect(edge).not.toBeNull();

    edge!.dispatchEvent(new CustomEvent('resizestart', { detail: { delta: 0 } }));
    // Leftward, into the content, on a right-hand lane: thicker.
    edge!.dispatchEvent(new CustomEvent('resize', { detail: { delta: -50 } }));
    edge!.dispatchEvent(new CustomEvent('resizeend', { detail: { delta: -50 } }));
    expect(store.contentInset().right).toBe(before + 50);
  });

  it('becomes one strip when put away, naming its panels, which opens the lane on a press', () => {
    const { store, lane } = mount();
    vi.useFakeTimers();
    store.toggleStowLane(ID);
    vi.runAllTimers();
    vi.useRealTimers();

    const buttons = lane()?.querySelectorAll('we-button[label="Open"]') ?? [];
    expect(buttons).toHaveLength(1);
    // No grips on a lane put away: the strip is the whole of it.
    expect(lane()?.querySelectorAll('we-resize-handle')).toHaveLength(0);

    (buttons[0] as HTMLElement).click();
    expect(store.dockGeometry()[ID]?.stowed).toBeFalsy();
  });
});
