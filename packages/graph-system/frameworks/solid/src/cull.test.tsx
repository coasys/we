/**
 * A canvas larger than its screen draws what is near the view, and mounts card content in turns.
 *
 * Drawing every card was what made a canvas of thousands slow to pan once it was readable: each card's
 * content is a document, and the page held all of them. These pin the three rules that replaced it —
 * cards and lines away from the view have no DOM, content is granted a few cards per frame, and a
 * surface that has never been measured still draws everything, as it always did.
 */
import { entityAddress } from '@we/graph-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { boxMeets, routeBox, sameSet } from './cull';
import { GraphView } from './GraphView.solid';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** jsdom lays nothing out; the surface is told its size the way the browser's observer would. */
function measured(width = 1000, height = 800) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: (entries: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width, height } }]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

const SIDE = 20;
const GAP = 300;
const id = (i: number) => entityAddress('ds', 'Note', `n${i}`);
const nodes = Array.from({ length: SIDE * SIDE }, (_, i) => ({
  id: id(i),
  kind: 'entity' as const,
  type: 'Note',
  label: `c${i}`,
  data: { x: (i % SIDE) * GAP, y: Math.floor(i / SIDE) * GAP },
}));
const LAST = SIDE * SIDE - 1;
const edges = [
  { id: 'near', source: id(0), target: id(1), type: 'rel' },
  { id: 'far', source: id(LAST - 1), target: id(LAST), type: 'rel' },
  // Both ends off screen once the camera is at the far corner, the line still crosses it.
  { id: 'across', source: id(0), target: id(LAST), type: 'rel' },
];

type Region = { x: number; y: number; width: number; height: number } | null;

/** Mounted, loaded, and only then framed — a load fits the camera to every card, over any region. */
async function mount(at: Region, settle = 100) {
  const [region, setRegion] = createSignal<Region>(null);
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => (
      <GraphView
        width="1000px"
        height="800px"
        seeds={{ literal: true, nodes, edges }}
        layout={{ type: 'manual' }}
        region={region()}
        nodeStyle={
          [{ style: { shape: 'card', width: 200, height: 120, content: 'body', contentMinZoom: 0.4 } }] as never
        }
        host={{ nodeContent: { body: () => <i class="body" /> } } as never}
      />
    ),
    host,
  );
  await vi.advanceTimersByTimeAsync(100);
  setRegion(at);
  await vi.advanceTimersByTimeAsync(settle);
  return { host, setRegion };
}

const drawn = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.we-graph__node')].map((n) => n.title);
const lines = (host: HTMLElement) => host.querySelectorAll('.we-graph__edges g, .we-graph__edge').length;
const bodies = (host: HTMLElement) => host.querySelectorAll('.body').length;

describe('culling a canvas larger than its screen', () => {
  it('draws only the cards near the view, and follows the camera', async () => {
    vi.useFakeTimers();
    measured();
    const { host, setRegion } = await mount({ x: 0, y: 0, width: 1000, height: 800 });

    const near = drawn(host);
    expect(near).toContain('c0');
    expect(near).not.toContain(`c${LAST}`);
    expect(near.length).toBeLessThan(nodes.length / 4);

    setRegion({ x: (SIDE - 4) * GAP, y: (SIDE - 4) * GAP, width: 1000, height: 800 });
    await vi.advanceTimersByTimeAsync(100);
    const far = drawn(host);
    expect(far).toContain(`c${LAST}`);
    expect(far).not.toContain('c0');
  });

  it('draws a line when its route comes near the view, wherever its ends are', async () => {
    vi.useFakeTimers();
    measured();
    const { host, setRegion } = await mount({ x: 0, y: 0, width: 1000, height: 800 });
    const atOrigin = lines(host);

    // In the middle, neither the pair at the origin nor the pair at the far corner is near —
    // only the line across the whole canvas passes through.
    setRegion({ x: (SIDE / 2) * GAP, y: (SIDE / 2) * GAP, width: 1000, height: 800 });
    await vi.advanceTimersByTimeAsync(100);
    const inMiddle = lines(host);
    expect(inMiddle).toBeGreaterThan(0);
    expect(inMiddle).toBeLessThan(atOrigin);
  });

  it('mounts content for the cards in view only, a few at a time', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    measured();
    const { host } = await mount({ x: 0, y: 0, width: 1000, height: 800 });
    // Let every frame of granting run.
    await vi.advanceTimersByTimeAsync(500);
    const settled = bodies(host);
    expect(settled).toBeGreaterThan(0);
    // Content is for what is on screen; the margin of drawn cards shows labels.
    expect(settled).toBeLessThan(drawn(host).length);
  });

  it('spreads content over several frames when a frame runs out of time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    // Every reading of the clock is 5 ms later, so a frame's budget is spent after a chunk or two.
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 5));
    measured();
    const { host } = await mount({ x: 0, y: 0, width: 1000, height: 800 }, 0);
    const counts: number[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      await vi.advanceTimersByTimeAsync(16);
      counts.push(bodies(host));
    }
    const final = counts.at(-1)!;
    expect(final).toBeGreaterThan(0);
    // It grew in steps rather than arriving in one frame.
    expect(counts[0]).toBeLessThan(final);
    expect(new Set(counts).size).toBeGreaterThan(2);
  });

  it('brings a card that changed while off screen up to date when it comes into view', async () => {
    vi.useFakeTimers();
    measured();
    const [label, setLabel] = createSignal('before');
    const [region, setRegion] = createSignal<Region>(null);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(
      () => (
        <GraphView
          width="1000px"
          height="800px"
          seeds={{
            literal: true,
            nodes: nodes.map((node, i) => (i === LAST ? { ...node, label: label() } : node)),
            edges: [],
          }}
          layout={{ type: 'manual' }}
          region={region()}
          nodeStyle={[{ style: { shape: 'card', width: 200, height: 120 } }] as never}
        />
      ),
      host,
    );
    await vi.advanceTimersByTimeAsync(100);
    setRegion({ x: 0, y: 0, width: 1000, height: 800 });
    await vi.advanceTimersByTimeAsync(100);
    expect(drawn(host)).not.toContain('before');

    setLabel('after');
    await vi.advanceTimersByTimeAsync(100);
    setRegion({ x: (SIDE - 4) * GAP, y: (SIDE - 4) * GAP, width: 1000, height: 800 });
    await vi.advanceTimersByTimeAsync(100);
    expect(drawn(host)).toContain('after');
    expect(drawn(host)).not.toContain('before');
  });

  it('draws everything on a surface that has never been measured', async () => {
    vi.useFakeTimers();
    const { host } = await mount(null);
    expect(drawn(host)).toHaveLength(nodes.length);
  });
});

describe('cull helpers', () => {
  it('compares sets by membership', () => {
    expect(sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameSet(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(sameSet(new Set([1]), new Set([1, 2]))).toBe(false);
  });

  it('bounds a route by all of its points', () => {
    expect(
      routeBox({
        from: { x: 0, y: 0 },
        to: { x: 10, y: 0 },
        control: { x: 5, y: -20 },
        segments: [{ control2: { x: 30, y: 4 }, to: { x: 12, y: 1 } }],
      }),
    ).toEqual({ minX: 0, minY: -20, maxX: 30, maxY: 4 });
  });

  it('counts touching boxes as meeting', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(boxMeets(a, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBe(true);
    expect(boxMeets(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
  });
});
