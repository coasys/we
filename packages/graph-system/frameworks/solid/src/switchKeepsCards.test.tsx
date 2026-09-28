/**
 * Freeform → tree through the real GraphView, with the host's answers arriving at chosen moments.
 *
 * The switch has emptied the screen and slid the tree back in from the side more than once, each time
 * from a different cause: a travel re-started mid-switch that sent the camera back to where it began, and
 * a seed option changed by the same click that laid the tree out before the renderer asked it to be framed.
 * So this drives the whole thing as the workshop does — layout, reframe, card style and the seed's own
 * options changing in one batch — and has the data arrive at different moments, changed or not, and counts
 * the cards on screen every frame. None may leave.
 */
import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphView } from './GraphView.solid';

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  // jsdom lays nothing out; the surface is told its size the way the browser's observer would.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: (entries: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 1400, height: 800 } }]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const SHAPES = [
  {
    name: 'CollectionBlock',
    identityProperty: 'title',
    properties: [{ name: 'title', type: 'string' }],
    relations: [
      { name: 'signals', target: 'Signal', cardinality: 'many' },
      { name: 'comments', target: '', cardinality: 'many' },
    ],
  },
  {
    name: 'Relationship',
    identityProperty: 'label',
    properties: [{ name: 'label', type: 'string' }],
    relations: [
      { name: 'source', target: '', cardinality: 'one' },
      { name: 'target', target: '', cardinality: 'one' },
    ],
  },
  {
    name: 'Placement',
    properties: [
      { name: 'nodeType', type: 'string' },
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
    ],
    relations: [{ name: 'node', target: '', cardinality: 'one' }],
  },
];

const IDS = ['p', 'a', 'b', 'c', 'q', 'x'];
const TABLES: Record<string, Record<string, unknown>[]> = {
  Placement: IDS.map((id, i) => ({
    id: `pl-${id}`,
    node: id,
    nodeType: 'CollectionBlock',
    x: 6000 + i * 260,
    y: 4000 + (i % 2) * 300,
  })),
  CollectionBlock: IDS.map((id) => ({ id, title: id, signals: [] })),
  Relationship: [
    { id: 'r1', source: 'p', target: 'a' },
    { id: 'r2', source: 'p', target: 'b' },
    { id: 'r3', source: 'p', target: 'c' },
    { id: 'r4', source: 'q', target: 'x' },
  ],
};

async function run(delay: number, withSimulate: boolean, change: 'none' | 'signals' | 'arrive' | 'both') {
  const tables = JSON.parse(JSON.stringify(TABLES)) as typeof TABLES;
  let latency = 0;
  const host = {
    query: async (request: { entity: string; where?: Record<string, unknown>; scope?: { anchorId?: string } }) => {
      if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
      const rows = tables[request.entity] ?? [];
      const where = request.where;
      if (where) {
        return rows.filter((row) =>
          Object.entries(where).every(([f, v]) => (Array.isArray(v) ? v.includes(row[f]) : row[f] === v)),
        );
      }
      if (request.scope?.anchorId && request.scope.anchorId !== 'b1') return [];
      return rows;
    },
    models: () => SHAPES,
    defaultDataset: () => 'ds',
  };
  const [tree, setTree] = createSignal(false);
  const el = document.createElement('div');
  document.body.append(el);
  Object.defineProperty(el, 'clientWidth', { value: 1400 });
  dispose = render(
    () => (
      <GraphView
        width="1400px"
        height="800px"
        host={host as never}
        seeds={{
          source: 'canvas',
          options: {
            canvas: 'b1',
            contains: ['CollectionBlock'],
            connections: 'Relationship',
            weigh: tree() ? { signalTypeId: 's1', mode: 'rating' } : null,
            ...(tree() && withSimulate ? { simulate: { people: [{ id: 'pretend:1', name: 'Ada' }] } } : {}),
          },
        }}
        layout={
          tree()
            ? ({
                type: 'forest',
                options: { card: { width: 180, height: 120 }, sortBy: 'weight', sortDirection: 'desc' },
              } as never)
            : ({ type: 'manual', options: { size: { width: 180, height: 135 } } } as never)
        }
        reframeOn={tree() ? 'md' : ''}
        nodeStyle={[{ style: { shape: 'card', width: tree() ? 180 : 200, height: 120 } }] as never}
      />
    ),
    el,
  );
  // The surface has no layout in jsdom, so its size is told to the engine the way the observer would.
  await vi.advanceTimersByTimeAsync(50);
  const layer = () => el.querySelector('.we-graph__layer') as HTMLElement;
  const visible = () => {
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(layer()?.style.transform ?? '');
    if (!m) return -1;
    const [cx, cy, zoom] = [Number(m[1]), Number(m[2]), Number(m[3])];
    let n = 0;
    for (const node of el.querySelectorAll<HTMLElement>('.we-graph__node')) {
      const t = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(node.style.transform);
      if (!t) continue;
      const sx = Number(t[1]) * zoom + cx;
      const sy = Number(t[2]) * zoom + cy;
      if (sx > -200 && sx < 1500 && sy > -150 && sy < 900) n += 1;
    }
    return n;
  };
  expect(visible()).toBe(IDS.length);
  latency = delay;
  if (change === 'signals' || change === 'both') {
    for (const [i, row] of tables.CollectionBlock.entries()) {
      row.signals = [
        { id: `s-${i}`, signalTypeId: 's1', value: (i * 7) % 5, author: 'did:peer', createdAt: '2026-01-01' },
      ];
    }
  }
  if (change === 'arrive' || change === 'both') {
    tables.CollectionBlock.push({ id: 'n', title: 'n', signals: [] });
    tables.Placement.push({ id: 'pl-n', node: 'n', nodeType: 'CollectionBlock', x: 9000, y: 9000 });
    tables.Relationship.push({ id: 'r5', source: 'q', target: 'n' });
  }
  batch(() => setTree(true));
  let least = Infinity;
  for (let t = 0; t <= 1400; t += 16) {
    await vi.advanceTimersByTimeAsync(16);
    least = Math.min(least, visible());
  }
  // Every card that was on screen stays on it, frame by frame; one arriving far away may join late.
  expect(least).toBeGreaterThanOrEqual(IDS.length);
}

describe('switching a freeform canvas to a tree', () => {
  for (const delay of [0, 150, 400]) {
    for (const change of ['none', 'both'] as const) {
      for (const simulate of [false, true]) {
        const what = `${change === 'none' ? 'the same data' : 'new cards and reactions'}${simulate ? ', pretend people added' : ''}`;
        it(`keeps every card on screen with ${what} back after ${delay}ms`, () => run(delay, simulate, change));
      }
    }
  }
});
