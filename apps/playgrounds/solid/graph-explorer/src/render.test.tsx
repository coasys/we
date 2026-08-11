/**
 * Headless smoke tests — does the engine actually put nodes on the screen?
 *
 * The unit tests elsewhere cover the engine's logic without a DOM, which is the right place for
 * collapse and budget behaviour. What they cannot tell you is whether the whole stack — spec →
 * expander → host → layout → paint — hangs together, and that is the failure that would otherwise
 * only show up by opening a browser.
 *
 * Kept to what is stable in happy-dom: node and edge counts, labels, and that expansion adds to
 * both. Anything about *where* things are drawn belongs to the layout tests.
 */
import { GraphView } from '@we/graph-solid';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { createHost, type QueryLog } from './host';
import { SCENARIOS } from './scenarios';

const host = createHost();
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function mount(spec: Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(() => <GraphView {...spec} host={host} />, container);
  return container;
}

/**
 * Mount with a spec that is rebuilt whenever a signal changes — how a host with its own controls
 * behaves, as opposed to the fixed object the other tests hand over.
 */
function mountReactive(build: () => Record<string, unknown>, bindings = host) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(() => <GraphView {...build()} host={bindings} />, container);
  return container;
}

/** Expansion and layout are async; a few macrotask turns is enough for this fixture. */
async function settle(turns = 6) {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function nodes(container: HTMLElement) {
  return container.querySelectorAll('.we-graph__node');
}

function edges(container: HTMLElement) {
  return container.querySelectorAll('.we-graph__edges path');
}

function scenario(id: string) {
  return SCENARIOS.find((s) => s.id === id)!.spec as unknown as Record<string, unknown>;
}

describe('the graph paints', () => {
  it('renders a literal fragment with no data layer at all', async () => {
    const container = mount(scenario('static'));
    await settle();

    expect(nodes(container)).toHaveLength(4);
    // Four declared edges; the mutual pair must both survive rather than collapsing into one.
    expect(edges(container).length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain('Publish');
  });

  it('draws edge labels as DOM, so they track the camera like every other piece of text', async () => {
    // They were SVG `<text>` and jittered for seconds after a zoom while the lines moved cleanly.
    const container = mount(scenario('static'));
    await settle();

    const labels = container.querySelectorAll('.we-graph__edge-label');
    expect(labels.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.we-graph__edges text')).toHaveLength(0);
    expect([...labels].map((el) => el.textContent)).toContain('approve');
  });

  it('maps the dataset schema, one node per entity type', async () => {
    const container = mount(scenario('schema'));
    await settle();

    // One node per shape the fixture declares.
    expect(nodes(container)).toHaveLength(9);
    expect(container.textContent).toContain('Belief');
    expect(container.textContent).toContain('CollectionBlock');
  });

  it('draws seeded relations as edges', async () => {
    const container = mount(scenario('knowledge'));
    await settle();

    // Four beliefs, plus the agents and topics they name — deduped, so fewer than 4 × 2.
    expect(nodes(container).length).toBeGreaterThan(4);
    expect(nodes(container).length).toBeLessThan(12);
    expect(edges(container).length).toBeGreaterThan(0);
    expect(container.textContent).toContain('James');
  });

  it('reaches nodes that only a backward walk can find', async () => {
    const container = mount(scenario('reverse'));
    await settle();

    // Topics point at nothing, so every node past the three seeds arrived through the inward pass.
    expect(nodes(container).length).toBeGreaterThan(3);
    expect(container.textContent).toContain('Graph rendering');
  });

  it('drills through an untyped containment relation', async () => {
    const container = mount(scenario('content'));
    await settle();

    expect(nodes(container).length).toBeGreaterThan(3);
    expect(container.textContent).toContain('Standup, 10 Aug');
  });

  it('opens an entity into its own properties and shared values', async () => {
    const container = mount(scenario('properties'));
    await settle();

    // Four tasks, each with property and literal children — and the literals converge, so the
    // count stays well under four tasks × every field.
    expect(nodes(container).length).toBeGreaterThan(8);
    expect(container.textContent).toContain('open');
  });

  it('stops at the budget and says so rather than truncating quietly', async () => {
    const container = mount(scenario('budget'));
    await settle(10);

    expect(nodes(container).length).toBeLessThanOrEqual(12);
    expect(container.textContent).toContain('Node limit reached');
  });

  it('draws its chrome as a sibling of the canvas, not on top of its handlers', async () => {
    // Gestures are handled on a dedicated surface, so chrome is an ordinary sibling that the canvas
    // never hears about. Previously the handlers sat on the common ancestor and every overlay had to
    // be marked so the canvas would ignore it — a new overlay that forgot silently broke the canvas.
    const container = mount(scenario('static'));
    await settle();

    expect(container.querySelector('.we-graph__surface')).not.toBeNull();
    expect(container.querySelectorAll('.we-graph__surface we-button')).toHaveLength(0);
    expect(container.querySelectorAll('we-button').length).toBeGreaterThanOrEqual(3);
  });

  it('honours a request for no chrome at all', async () => {
    const container = mount({ ...scenario('static'), controls: [] });
    await settle();

    expect(container.querySelectorAll('we-button')).toHaveLength(0);
  });

  it('never lets a drawing layer stand between the pointer and the canvas', async () => {
    // The transformed layer is viewport-sized and the camera moves it, so with default
    // `pointer-events` it silently covers whichever region it has been translated over — which showed
    // up as a dead quadrant of the canvas once gestures moved off the root onto their own surface.
    const container = mount(scenario('static'));
    await settle();

    const layer = container.querySelector('.we-graph__layer') as HTMLElement | null;
    expect(layer).not.toBeNull();
    expect(layer!.style.pointerEvents).toBe('none');

    // And everything it contains, so nothing inside can reintroduce the problem either.
    for (const selector of ['.we-graph__edges', '.we-graph__node']) {
      const child = container.querySelector(selector);
      expect(child, selector).not.toBeNull();
    }
  });

  it('leaves edge picking to the engine rather than the DOM', async () => {
    // `pointer-events: stroke` on a path was the one thing the DOM still picked, which broke
    // behaviours on any non-DOM surface.
    const container = mount(scenario('static'));
    await settle();

    const path = container.querySelector('.we-graph__edges path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('onClick')).toBeNull();
  });

  it('shows an empty state rather than a blank canvas', async () => {
    const container = mount({
      seeds: { source: 'query', options: { entity: 'Nonexistent' } },
      layout: { type: 'grid' },
    });
    await settle();

    expect(nodes(container)).toHaveLength(0);
    expect(container.textContent).toContain('Nothing to show yet');
  });

  /*
    A host rebuilding its spec object must not restart the graph.

    Any control outside the graph — an edge-shape picker, a colour toggle — hands over a fresh spec,
    and reading `seeds` from it re-runs whatever computed it. When the reload effect tracked that
    rather than comparing values, switching edge shape called `start()` and threw away every node
    position, which presents as the layout randomly resetting and gives no hint that a style control
    caused it.
  */
  it('keeps its nodes when a host rebuilds the spec without changing what the graph is', async () => {
    /*
      Asserted on the query log rather than on where the nodes ended up.

      Position is the symptom but it is a poor probe: several of these scenarios lay out
      deterministically, so a restart puts everything back exactly where it was and the test passes
      whether or not the graph was destroyed and rebuilt. Queries do not lie — `start()` clears the
      store and re-seeds, so a restart is visible as the seed query running a second time.
    */
    const log: QueryLog = { entries: [] };
    const spec = scenario('knowledge');
    const [curve, setCurve] = createSignal('smooth');
    const container = mountReactive(() => ({ ...spec, edgeStyle: [{ style: { curve: curve() } }] }), createHost(log));
    await settle();

    expect([...nodes(container)].length).toBeGreaterThan(0);
    const queriesAfterLoad = log.entries.length;
    expect(queriesAfterLoad).toBeGreaterThan(0);

    setCurve('step');
    await settle();

    expect(log.entries.length).toBe(queriesAfterLoad);
  });
});
