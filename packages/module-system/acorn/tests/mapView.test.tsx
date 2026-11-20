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
import { parseAddress } from '@we/graph-protocol';
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
interface SeenEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  reifiedAs?: string;
}
interface GraphProps {
  seeds?: { literal?: boolean; nodes?: SeenNode[]; edges?: SeenEdge[] };
  layout?: { type: string; options?: Record<string, unknown> };
  nodeStyle?: Array<{ when?: Record<string, unknown>; style: Record<string, unknown> }>;
  behaviours?: string[];
  nodeActions?: Array<{ id: string; icon?: string; title?: string; tone?: string }>;
  onNodeClick?: (node: SeenNode & Rec) => void;
  onNodeDoubleClick?: (node: SeenNode & Rec) => void;
  onNodeAction?: (payload: { action: string; id: string; x: number; y: number } & Rec) => void;
  onEdgeCreate?: (payload: { sourceId: string; targetId: string; sourceType: string; targetType: string }) => void;
  onDeleteSelection?: (payload: { kind?: 'node' | 'edge'; count: number; records?: Rec[] } & Partial<Rec>) => void;
}
interface Rec {
  recordId: string;
  recordType: string;
}

/** What the real graph puts on a payload for a node: the record its address names. */
const rec = (address: string | undefined): Rec => {
  const at = address ? parseAddress(address) : null;
  if (at?.kind !== 'entity' || !at.id || !at.type) throw new Error(`${address} names no record`);
  return { recordId: at.id, recordType: at.type };
};

/**
 * How the host's creates behave. `lagConnections`: an AcornConnection create is acknowledged at
 * once but reaches the store only on `flush()` — the subscription stays without it meanwhile, as a
 * slow mount's does. `holdCreates`: an AcornOutcome create neither lands nor settles until
 * `release()`. `failConnections`: that many AcornConnection creates are refused.
 */
interface MapHostOptions {
  lagConnections?: boolean;
  holdCreates?: boolean;
  failConnections?: number;
}

async function drawMap(options: MapHostOptions = {}) {
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
  const entity = (name: string) => {
    const cls = getEntityForDataset(name, handle);
    if (!cls) throw new Error(`no ${name} class on the fixture dataset`);
    return cls;
  };
  // `record.*` as `TemplateProvider` runs them: the dataset's class.
  const creates: Array<{ entity: string; fields: Record<string, unknown> }> = [];
  const deferred: Array<() => Promise<unknown>> = [];
  const held: Array<() => void> = [];
  let refusals = options.failConnections ?? 0;
  const record = {
    create: (name: string, fields: Record<string, unknown>) => {
      creates.push({ entity: name, fields });
      const land = () => entity(name).create(handle, fields);
      if (name === 'AcornConnection' && refusals > 0) {
        refusals--;
        return Promise.reject(new Error('connection refused'));
      }
      if (name === 'AcornConnection' && options.lagConnections) {
        deferred.push(land);
        return Promise.resolve({ id: `lagged-${creates.length}`, ...fields });
      }
      if (name === 'AcornOutcome' && options.holdCreates)
        return new Promise((resolve) => held.push(() => resolve(land())));
      return land();
    },
    update: (name: string, id: string, fields: Record<string, unknown>) => entity(name).update(handle, id, fields),
    delete: (name: string, id: string) => entity(name).delete(handle, id),
  };
  const stores = {
    ...bindings,
    record,
    $sources,
    $onError: (m: string) => errors.push(m),
    $modelsPending: () => false,
  };

  // The last props the graph was handed — a literal seed is replaced whole when the data moves.
  let graph: GraphProps = {};
  const GraphView = (props: GraphProps) => {
    graph = props;
    return (
      <div data-graph>
        <For each={props.seeds?.nodes ?? []}>
          {(node) => (
            <button
              type="button"
              data-node={node.id}
              onClick={() => props.onNodeClick?.({ ...node, ...rec(node.id) })}
              onDblClick={() => props.onNodeDoubleClick?.({ ...node, ...rec(node.id) })}
            >
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
  /** The lagging writes — the first `n`, or all — landed in the order they were made. */
  const flush = async (n = Infinity) => {
    for (let i = 0; i < n && deferred.length; i++) await deferred.shift()!();
  };
  /** The held writes, settled in the order they were made. */
  const release = () => {
    while (held.length) held.shift()!();
  };
  return { ...view, errors, entity, handle, creates, flush, release, graph: () => graph };
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
      expect(seeds?.edges?.map((e) => [rec(e.source).recordId, rec(e.target).recordId, e.type])).toEqual([
        ['acorn-outcome-1', 'acorn-outcome-2', 'AcornConnection'],
        ['acorn-outcome-1', 'acorn-outcome-3', 'AcornConnection'],
      ]);
      expect(layout).toMatchObject({ type: 'forest', options: { sortBy: 'rank', unattached: 'trees' } });
      // Sibling order as Acorn has it: the Uncertain (siblingOrder 1) ranks before the Small (0).
      const rank = (id: string) => seeds?.nodes?.find((n) => rec(n.id).recordId === id)?.data.rank as number;
      expect(rank('acorn-outcome-1')).toBeLessThan(rank('acorn-outcome-3'));
      expect(rank('acorn-outcome-3')).toBeLessThan(rank('acorn-outcome-2'));
      // Cards drawn by the host's record card, ringed by the computed status. Click selects, as in
      // Acorn; a double-click opens; pan-zoom last, the background fallback.
      expect(nodeStyle?.[0].style).toMatchObject({ shape: 'card', content: 'record' });
      expect(nodeStyle?.some((r) => r.when?.['data.status'] === 'Achieved')).toBe(true);
      expect(behaviours).toEqual(['node-double-click', 'select', 'pan-zoom']);
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("puts Acorn's computed scope and status on each card", async () => {
    const { unmount, graph } = await drawMap();
    try {
      const data = (id: string) => graph().seeds?.nodes?.find((n) => rec(n.id).recordId === id)?.data;
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
      const late = graph().seeds!.edges![2];
      expect([rec(late.source).recordId, rec(late.target).recordId]).toEqual(['acorn-outcome-3', lone.id]);
    } finally {
      unmount();
    }
  });

  it('a double-click on a card opens the expanded outcome over the map, and closing it goes back', async () => {
    const { container, unmount, errors } = await drawMap();
    try {
      expect(dialog(container)).toBeNull();
      // A click selects, as in Acorn: nothing opens.
      fireEvent.click(card(container, BIG)!);
      expect(dialog(container)).toBeNull();
      fireEvent.dblClick(card(container, BIG)!);
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

/** What a `we-input` dispatches as somebody types: `input`, the value as detail. */
const type = (el: Element, value: string) =>
  el.dispatchEvent(new CustomEvent('input', { detail: value, bubbles: true, composed: true }));
const labelled = (root: HTMLElement, tag: string, label: string) =>
  [...root.querySelectorAll(tag)].find((el) => (el as unknown as { label?: string }).label === label) as
    HTMLElement | undefined;
const createField = (root: HTMLElement) =>
  labelled(root, 'we-input', 'New outcome') ?? labelled(root, 'we-input', 'New child outcome');
const createButton = (root: HTMLElement) =>
  [...root.querySelectorAll('we-button')].find((b) => /^Add (outcome|child)$/.test((b.textContent ?? '').trim())) as
    HTMLElement | undefined;

/** The graph's address for an outcome, as the seed names it. */
const addressOf = (graph: GraphProps, id: string) => graph.seeds?.nodes?.find((n) => rec(n.id).recordId === id)?.id;
/** A card's action bar pressed, as the real graph reports it. */
const act = (graph: GraphProps, action: string, id: string) =>
  graph.onNodeAction?.({ action, id: addressOf(graph, id)!, x: 0, y: 0, recordId: id, recordType: 'AcornOutcome' });
/** A line drawn from one card's connect dot to another card, as the real graph reports it. */
const connect = (graph: GraphProps, parent: string, child: string) =>
  graph.onEdgeCreate?.({ sourceId: parent, targetId: child, sourceType: 'AcornOutcome', targetType: 'AcornOutcome' });

describe('editing the outcome map (S2-9)', () => {
  async function editMap(options: MapHostOptions = {}) {
    const map = await drawMap(options);
    const all = async (name: string) =>
      (await map.entity(name).findAll(map.handle, {})) as Array<Record<string, unknown> & { id: string }>;
    return { ...map, all };
  }

  it('offers the edit controls: a create row, a card action bar, connect dots, Delete', async () => {
    const { container, unmount, graph } = await editMap();
    try {
      expect(createField(container)).toBeTruthy();
      expect(createButton(container)?.textContent?.trim()).toBe('Add outcome');
      expect(graph().nodeActions?.map((a) => a.id)).toEqual(['add-child', 'open', 'delete']);
      expect(graph().nodeActions?.find((a) => a.id === 'delete')?.tone).toBe('danger');
      // Bound, so the graph draws connect dots on a selected card and answers the Delete key.
      expect(typeof graph().onEdgeCreate).toBe('function');
      expect(typeof graph().onDeleteSelection).toBe('function');
    } finally {
      unmount();
    }
  });

  it('creates a root outcome: Uncertain, on no connection — a tree of its own', async () => {
    const { container, unmount, all, graph, errors } = await editMap();
    try {
      const connections = (await all('AcornConnection')).length;
      type(createField(container)!, '  A new root  ');
      fireEvent.click(createButton(container)!);
      await waitFor(() => expect(cards(container)).toContain('A new root'));
      const made = (await all('AcornOutcome')).find((o) => o.content === 'A new root')!;
      expect(made.scopeType).toBe('Uncertain');
      expect(await all('AcornConnection')).toHaveLength(connections);
      expect(graph().seeds?.edges?.some((e) => rec(e.target).recordId === made.id)).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("creates a child from a card's action bar: Uncertain, under it, on the right of its siblings", async () => {
    const { container, unmount, all, graph, errors } = await editMap();
    try {
      act(graph(), 'add-child', 'acorn-outcome-1');
      await waitFor(() => expect(container.textContent).toContain(`New child of “${BIG}”`));
      expect(createButton(container)?.textContent?.trim()).toBe('Add child');
      type(createField(container)!, 'A new child');
      fireEvent.click(createButton(container)!);
      await waitFor(async () =>
        expect(
          (await all('AcornConnection')).some((c) => c.parent === 'acorn-outcome-1' && c.siblingOrder === -1),
        ).toBe(true),
      );
      const made = (await all('AcornOutcome')).find((o) => o.content === 'A new child')!;
      expect(made.scopeType).toBe('Uncertain');
      // The fixture's siblings are at 0 and 1: the new one is one below the lowest, drawn rightmost.
      const link = (await all('AcornConnection')).find((c) => c.child === made.id)!;
      expect(link).toMatchObject({ parent: 'acorn-outcome-1', siblingOrder: -1 });
      // Back to making roots once the child is linked.
      await waitFor(() => expect(createButton(container)?.textContent?.trim()).toBe('Add outcome'));
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(3));
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('a child under way can be called off, back to a root', async () => {
    const { container, unmount, graph } = await editMap();
    try {
      act(graph(), 'add-child', 'acorn-outcome-3');
      await waitFor(() => expect(container.textContent).toContain(`New child of “${UNCERTAIN}”`));
      fireEvent.click(labelled(container, 'we-button', 'Make a root outcome instead')!);
      await waitFor(() => expect(createButton(container)?.textContent?.trim()).toBe('Add outcome'));
    } finally {
      unmount();
    }
  });

  it('connects two outcomes, dragged-from above dragged-to, on the right of its new siblings', async () => {
    const { unmount, all, graph, errors } = await editMap();
    try {
      // Small (acorn-outcome-2) has no children: the first is at 0.
      connect(graph(), 'acorn-outcome-3', 'acorn-outcome-2');
      await waitFor(async () => expect(await all('AcornConnection')).toHaveLength(3));
      const made = (await all('AcornConnection')).find((c) => c.parent === 'acorn-outcome-3')!;
      expect(made).toMatchObject({ child: 'acorn-outcome-2', siblingOrder: 0 });
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(3));
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('refuses a self-connection, a child already under, and a loop — and writes nothing', async () => {
    const { container, unmount, all, graph } = await editMap();
    try {
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-2');
      await waitFor(() => expect(container.textContent).toContain('itself'));
      connect(graph(), 'acorn-outcome-1', 'acorn-outcome-2');
      await waitFor(() => expect(container.textContent).toContain('already under'));
      connect(graph(), 'acorn-outcome-3', 'acorn-outcome-1');
      await waitFor(() => expect(container.textContent).toContain('loop'));
      expect(await all('AcornConnection')).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  it('deletes a selected connection with Delete: the line goes, both outcomes stay', async () => {
    const { container, unmount, all, graph, errors } = await editMap();
    try {
      const line = graph().seeds!.edges!.find((e) => rec(e.target).recordId === 'acorn-outcome-3')!;
      graph().onDeleteSelection?.({ kind: 'edge', count: 1, ...rec(line.reifiedAs) });
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(1));
      expect((await all('AcornConnection')).map((c) => c.child)).toEqual(['acorn-outcome-2']);
      expect(cards(container).sort()).toEqual([BIG, SMALL, UNCERTAIN].sort());
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('deletes an outcome from its action bar: its lines go, its children stay as roots', async () => {
    const { container, unmount, all, graph, errors } = await editMap();
    try {
      act(graph(), 'delete', 'acorn-outcome-1');
      await waitFor(() => expect(cards(container)).not.toContain(BIG));
      expect((await all('AcornOutcome')).map((o) => o.id)).not.toContain('acorn-outcome-1');
      expect(cards(container).sort()).toEqual([SMALL, UNCERTAIN].sort());
      // No line is drawn to an outcome that is gone (the mount removes them with it — see the part).
      expect(graph().seeds?.edges).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('deletes a selected outcome with Delete; with several selected it says so and deletes none', async () => {
    const { container, unmount, all, graph } = await editMap();
    try {
      graph().onDeleteSelection?.({
        kind: 'node',
        count: 2,
        records: [rec(addressOf(graph(), 'acorn-outcome-2')), rec(addressOf(graph(), 'acorn-outcome-3'))],
      });
      await waitFor(() => expect(container.textContent).toContain('one outcome at a time'));
      expect(await all('AcornOutcome')).toHaveLength(3);
      graph().onDeleteSelection?.({ kind: 'node', count: 1, ...rec(addressOf(graph(), 'acorn-outcome-2')) });
      await waitFor(() => expect(cards(container)).not.toContain(SMALL));
      expect((await all('AcornOutcome')).map((o) => o.id).sort()).toEqual(['acorn-outcome-1', 'acorn-outcome-3']);
    } finally {
      unmount();
    }
  });

  /*
    A line is written at once but reads back later. Until it does, the map's validation still has
    it: a reverse line would close a loop through it, and the same line again would be a second
    record of one connection.
  */
  it('a line dragged back the other way before the first reads back is refused as a loop', async () => {
    const { container, unmount, all, creates, flush, graph } = await editMap({ lagConnections: true });
    try {
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      await waitFor(() => expect(creates.filter((c) => c.entity === 'AcornConnection')).toHaveLength(1));
      connect(graph(), 'acorn-outcome-3', 'acorn-outcome-2');
      await waitFor(() => expect(container.textContent).toContain('loop'));
      expect(creates.filter((c) => c.entity === 'AcornConnection')).toHaveLength(1);
      await flush();
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(3));
      const lines = (await all('AcornConnection')).map((c) => [c.parent, c.child]);
      expect(lines).toContainEqual(['acorn-outcome-2', 'acorn-outcome-3']);
      expect(lines).not.toContainEqual(['acorn-outcome-3', 'acorn-outcome-2']);
    } finally {
      unmount();
    }
  });

  it('the same line dragged twice before the first reads back is written once', async () => {
    const { container, unmount, all, creates, flush, graph } = await editMap({ lagConnections: true });
    try {
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      await waitFor(() => expect(creates.filter((c) => c.entity === 'AcornConnection')).toHaveLength(1));
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      await waitFor(() => expect(container.textContent).toContain('already under'));
      expect(creates.filter((c) => c.entity === 'AcornConnection')).toHaveLength(1);
      await flush();
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(3));
      const twoToThree = (await all('AcornConnection')).filter(
        (c) => c.parent === 'acorn-outcome-2' && c.child === 'acorn-outcome-3',
      );
      expect(twoToThree).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it('two lines in flight are both held until the last reads back', async () => {
    const { container, unmount, creates, entity, handle, flush, graph } = await editMap({ lagConnections: true });
    try {
      const lines = () => creates.filter((c) => c.entity === 'AcornConnection');
      const x = (await entity('AcornOutcome').create(handle, { content: 'X', scopeType: 'Uncertain' })) as {
        id: string;
      };
      await waitFor(() => expect(cards(container)).toContain('X'));
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      connect(graph(), 'acorn-outcome-3', x.id);
      await waitFor(() => expect(lines()).toHaveLength(2));
      // The first reads back; the second has not, and X is still under 2 through it.
      await flush(1);
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(3));
      connect(graph(), x.id, 'acorn-outcome-2');
      await waitFor(() => expect(container.textContent).toContain('loop'));
      expect(lines()).toHaveLength(2);
      await flush();
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(4));
    } finally {
      unmount();
    }
  });

  it('a refused line is not held: the same line can be dragged again', async () => {
    const { container, unmount, all, creates, graph } = await editMap({ failConnections: 1 });
    try {
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      await waitFor(() => expect(container.textContent).toContain('Could not connect'));
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      await waitFor(async () =>
        expect(
          (await all('AcornConnection')).some((c) => c.parent === 'acorn-outcome-2' && c.child === 'acorn-outcome-3'),
        ).toBe(true),
      );
      expect(creates.filter((c) => c.entity === 'AcornConnection')).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  it("the action bar's Open opens the expanded outcome", async () => {
    const { container, unmount, graph } = await editMap();
    try {
      act(graph(), 'open', 'acorn-outcome-3');
      await waitFor(() => expect(dialog(container)?.textContent).toContain(UNCERTAIN));
    } finally {
      unmount();
    }
  });
});
