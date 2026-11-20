/**
 * The outcome map, offline (S2-8): the fixture's tree in `@we/backend-inmemory`, the
 * `acorn.mapView` part drawn by the real renderer. `GraphView` is the graph module's component,
 * which the app shell lends at run time, so here it is a stand-in that keeps the props it is
 * handed and draws one button per node — what is under test is what the part gives the graph and
 * what it does with a press on a card. Where the cards land is `mapLayout.test.ts`'s; the real
 * canvas is the live suite's.
 */
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { ACORN_MANIFEST, acornDatasetId, applyAcornFixture } from '@we/acorn-fixture';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { manifestEntries } from '@we/backend-shared';
import { getEntityForDataset } from '@we/entities';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { For, type JSX } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { ACORN_PARTS, acornModule } from '../src/index.ts';

const SELF = 'did:test:acorn-self';

const BIG = 'Acorn runs as a WE template'; // acorn-outcome-1: the root
const SMALL = 'Shell boots on the in-memory backend'; // acorn-outcome-2: Small, Achieved, siblingOrder 0
const UNCERTAIN = 'Outcome list reads live mounted records'; // acorn-outcome-3: Uncertain, siblingOrder 1

/** `resolveParts`, for the acorn parts only — a `$part` stands in for its node, recursively. */
function expandParts(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expandParts);
  const record = node as SchemaNode;
  if (record.type === '$part') {
    const id = (record.props as { id?: unknown } | undefined)?.id;
    const part = typeof id === 'string' ? ACORN_PARTS[id.split('.')[1]] : undefined;
    if (!part) throw new Error(`$part "${String(id)}" names no acorn part`);
    return expandParts(part.node);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) out[key] = expandParts(value);
  return out;
}

interface SeenNode {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
}
interface GraphProps {
  seeds?: { literal?: boolean; nodes?: SeenNode[]; edges?: Array<{ source: string; target: string }> };
  layout?: { type: string; options?: Record<string, unknown> };
  nodeStyle?: Array<{ when?: Record<string, unknown>; style: Record<string, unknown> }>;
  behaviours?: string[];
  onNodeClick?: (node: SeenNode) => void;
}

async function drawMap() {
  const ports = createInMemoryBackendPorts(
    { selfId: () => SELF },
    { datasets: [{ id: acornDatasetId, name: 'Acorn fixture' }] },
  );
  await applyAcornFixture(ports);
  const dataset = await ports.lifecycle.get(acornDatasetId);
  if (!dataset) throw new Error('fixture dataset missing after apply');
  const handle = dataset.handle;
  const bindings = ports.dataBindings({
    currentDataset: () => handle,
    currentDatasetEntities: () => manifestEntries(ACORN_MANIFEST),
    profiles: () => [],
    fetchProfile: () => {},
    ephemeral: ports.ephemeral,
  });
  const $sources: Record<string, (options: unknown) => unknown> = {};
  for (const fn of acornModule.contributes?.functions ?? []) $sources[fn.name] = fn.fn as (o: unknown) => unknown;
  const errors: string[] = [];
  const stores = { ...bindings, $sources, $onError: (m: string) => errors.push(m), $modelsPending: () => false };
  const entity = (name: string) => {
    const cls = getEntityForDataset(name, handle);
    if (!cls) throw new Error(`no ${name} class on the fixture dataset`);
    return cls;
  };

  // The last props the graph was handed — a literal seed is replaced whole when the data moves.
  let graph: GraphProps = {};
  const GraphView = (props: GraphProps) => {
    graph = props;
    return (
      <div data-graph>
        <For each={props.seeds?.nodes ?? []}>
          {(node) => (
            <button type="button" data-node={node.id} onClick={() => props.onNodeClick?.(node)}>
              {node.label}
            </button>
          )}
        </For>
      </div>
    );
  };
  const Passthrough = (props: { children?: JSX.Element }) => props.children;
  const view = render(() => (
    <RenderSchema
      node={expandParts(ACORN_PARTS.mapView.node) as SchemaNode}
      stores={stores as never}
      registry={{ Column: Passthrough, Row: Passthrough, GraphView: GraphView as never }}
      context={{}}
    />
  ));
  await waitFor(() => expect(cards(view.container)).toHaveLength(3));
  return { ...view, errors, entity, handle, graph: () => graph };
}

const cards = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>('[data-graph] [data-node]')].map((b) => b.textContent ?? '');
const card = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('[data-graph] [data-node]')].find((b) => b.textContent === label);
const dialog = (root: HTMLElement) => root.querySelector('we-modal') as HTMLElement | null;

describe('the outcome map', () => {
  it("hands the graph every outcome as a card and every connection as a line, laid out as Acorn's tree", async () => {
    const { container, unmount, errors, graph } = await drawMap();
    try {
      expect(cards(container).sort()).toEqual([BIG, SMALL, UNCERTAIN].sort());
      const { seeds, layout, nodeStyle, behaviours } = graph();
      expect(seeds?.literal).toBe(true);
      expect(seeds?.edges).toEqual([
        expect.objectContaining({ source: 'acorn-outcome-1', target: 'acorn-outcome-2', type: 'AcornConnection' }),
        expect.objectContaining({ source: 'acorn-outcome-1', target: 'acorn-outcome-3', type: 'AcornConnection' }),
      ]);
      expect(layout).toMatchObject({ type: 'forest', options: { sortBy: 'rank', unattached: 'trees' } });
      // Sibling order as Acorn has it: the Uncertain (siblingOrder 1) ranks before the Small (0).
      const rank = (id: string) => seeds?.nodes?.find((n) => n.id === id)?.data.rank as number;
      expect(rank('acorn-outcome-1')).toBeLessThan(rank('acorn-outcome-3'));
      expect(rank('acorn-outcome-3')).toBeLessThan(rank('acorn-outcome-2'));
      // Cards drawn by the host's record card, ringed by the computed status; pan, zoom and press only.
      expect(nodeStyle?.[0].style).toMatchObject({ shape: 'card', content: 'record' });
      expect(nodeStyle?.some((r) => r.when?.['data.status'] === 'Achieved')).toBe(true);
      expect(behaviours).toEqual(['pan-zoom', 'select']);
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("puts Acorn's computed scope and status on each card", async () => {
    const { unmount, graph } = await drawMap();
    try {
      const data = (id: string) => graph().seeds?.nodes?.find((n) => n.id === id)?.data;
      // One Small achieved, one Uncertain below: Uncertain and not achieved, as the expanded outcome says.
      expect(data('acorn-outcome-1')).toMatchObject({
        content: BIG,
        scopeType: 'Uncertain',
        achievementStatus: 'Not achieved',
        status: 'NotAchieved',
      });
      expect(data('acorn-outcome-2')).toMatchObject({ scopeType: 'Small', achievementStatus: 'Achieved' });
      expect(data('acorn-outcome-3')).toMatchObject({ scopeType: 'Uncertain', achievementStatus: 'Not achieved' });
    } finally {
      unmount();
    }
  });

  it('draws an outcome on no connection, and a connection made later, as the records arrive', async () => {
    const { container, unmount, entity, handle, graph } = await drawMap();
    try {
      const lone = (await entity('AcornOutcome').create(handle, {
        content: 'An outcome on its own',
        scopeType: 'Uncertain',
      })) as { id: string };
      await waitFor(() => expect(cards(container)).toContain('An outcome on its own'));
      expect(graph().seeds?.edges).toHaveLength(2);
      await entity('AcornConnection').create(handle, { parent: 'acorn-outcome-3', child: lone.id, siblingOrder: 0 });
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(3));
      expect(graph().seeds?.edges?.[2]).toMatchObject({ source: 'acorn-outcome-3', target: lone.id });
    } finally {
      unmount();
    }
  });

  it('a card opens the expanded outcome over the map, and closing it goes back', async () => {
    const { container, unmount, errors } = await drawMap();
    try {
      expect(dialog(container)).toBeNull();
      fireEvent.click(card(container, BIG)!);
      await waitFor(() => expect(dialog(container)?.textContent).toContain('Children 2'));
      expect(dialog(container)!.textContent).toContain(UNCERTAIN);
      // The dialog is the expanded outcome itself: the roll-up it computes from the children.
      expect(dialog(container)!.textContent).toContain(
        'From its children: Uncertain · Not achieved · 1/1 smalls · 1 uncertain',
      );
      (dialog(container) as unknown as { close: () => void }).close();
      await waitFor(() => expect(dialog(container)).toBeNull());
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });
});
