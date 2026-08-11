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
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { createHost } from './host';
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

  it('shows an empty state rather than a blank canvas', async () => {
    const container = mount({
      seeds: { source: 'query', options: { entity: 'Nonexistent' } },
      layout: { type: 'grid' },
    });
    await settle();

    expect(nodes(container)).toHaveLength(0);
    expect(container.textContent).toContain('Nothing to show yet');
  });
});
