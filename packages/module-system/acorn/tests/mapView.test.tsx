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
  onNodeArrange?: (
    payload: {
      id: string;
      into: 'child' | 'sibling' | 'loose';
      targetId?: string;
      targetType?: string;
      before?: boolean;
      order?: string[];
      x: number;
      y: number;
    } & Rec,
  ) => void;
  onSelectionChange?: (ids: string[]) => void;
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
  /** An AcornConnection update is acknowledged at once but reaches the store only on `flush()`. */
  lagUpdates?: boolean;
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
  const updates: Array<{ entity: string; id: string; fields: Record<string, unknown> }> = [];
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
    update: (name: string, id: string, fields: Record<string, unknown>) => {
      updates.push({ entity: name, id, fields });
      const land = () => entity(name).update(handle, id, fields);
      if (name === 'AcornConnection' && options.lagUpdates) {
        deferred.push(land);
        return Promise.resolve({ id, ...fields });
      }
      return land();
    },
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
  // A Column is a box that hears the keys pressed inside it, as the real one does (its rest props land on its div).
  const Box = (props: { children?: JSX.Element; onKeyDown?: (event: KeyboardEvent) => void }) => (
    <div data-column onKeyDown={(event) => props.onKeyDown?.(event)}>
      {props.children}
    </div>
  );
  const view = render(() => (
    <RenderSchema
      node={expandParts(ACORN_PARTS.mapView.node) as SchemaNode}
      stores={stores as never}
      registry={{ Column: Box as never, Row: Passthrough, GraphView: GraphView as never }}
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
  return { ...view, errors, entity, handle, creates, updates, flush, release, graph: () => graph };
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
      // Cards drawn by the host's record card, ringed by the computed status. A click selects, as in
      // Acorn; a drag moves a card in the tree (S2-9b); a double-click opens; pan-zoom last, the background fallback.
      expect(nodeStyle?.[0].style).toMatchObject({ shape: 'card', content: 'record' });
      expect(nodeStyle?.some((r) => r.when?.['data.status'] === 'Achieved')).toBe(true);
      expect(behaviours).toEqual(['node-double-click', 'select', 'arrange-nodes', 'pan-zoom']);
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

  it('a draft typed while the last outcome saves is kept; the one saved is cleared', async () => {
    const { container, unmount, all, release } = await editMap({ holdCreates: true });
    const value = () => (createField(container) as unknown as { value?: string }).value;
    try {
      type(createField(container)!, 'Saved first');
      fireEvent.click(createButton(container)!);
      // The field stays open while the create is in flight: the next outcome is typed meanwhile.
      type(createField(container)!, 'Typed while saving');
      await waitFor(() => expect(value()).toBe('Typed while saving'));
      release();
      await waitFor(async () =>
        expect((await all('AcornOutcome')).some((o) => o.content === 'Saved first')).toBe(true),
      );
      await waitFor(() => expect(cards(container)).toContain('Saved first'));
      expect(value()).toBe('Typed while saving');
      // Unchanged since it was submitted: cleared on success.
      fireEvent.click(createButton(container)!);
      release();
      await waitFor(() => expect(cards(container)).toContain('Typed while saving'));
      await waitFor(() => expect(value()).toBe(''));
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

/** A card dragged to another place in the tree, as the real graph's `arrange-nodes` reports it. */
const arrange = (
  graph: GraphProps,
  id: string,
  drop: { into: 'child' | 'sibling'; target: string; before?: boolean; order: string[] },
) =>
  graph.onNodeArrange?.({
    id: addressOf(graph, id)!,
    recordId: id,
    recordType: 'AcornOutcome',
    into: drop.into,
    targetId: drop.target,
    targetType: 'AcornOutcome',
    ...(drop.before === undefined ? {} : { before: drop.before }),
    order: drop.order,
    x: 0,
    y: 0,
  });
/** Shift+← or Shift+→ pressed on the map with a card selected. */
const shiftArrow = (root: HTMLElement, graph: GraphProps, id: string, key: 'ArrowLeft' | 'ArrowRight') => {
  graph.onSelectionChange?.([addressOf(graph, id)!]);
  const box = root.querySelector('[data-graph]')!.closest('[data-column]')!;
  fireEvent.keyDown(box, { key, shiftKey: true });
};
/** The children of the fixture's root as the map draws them, left to right. */
const drawnUnder = (graph: GraphProps, parent: string) => {
  const nodes = graph.seeds?.nodes ?? [];
  const kids = (graph.seeds?.edges ?? [])
    .filter((e) => rec(e.source).recordId === parent)
    .map((e) => nodes.find((n) => n.id === e.target)!);
  return kids.sort((a, b) => Number(a.data.rank) - Number(b.data.rank)).map((n) => rec(n.id).recordId);
};

// The fixture: acorn-outcome-1 over 3 (siblingOrder 1) and 2 (siblingOrder 0), drawn 3 then 2.
describe('moving cards on the outcome map (S2-9b)', () => {
  async function moveMap(options: MapHostOptions = {}) {
    const map = await drawMap(options);
    const all = async () =>
      (await map.entity('AcornConnection').findAll(map.handle, {})) as Array<Record<string, unknown> & { id: string }>;
    const line = async (child: string) => (await all()).find((c) => c.child === child)!;
    return { ...map, all, line };
  }

  it('lets a card be dragged: arrange-nodes after select, so a click still selects, and the keys heard around the graph', async () => {
    const { unmount, graph, container } = await moveMap();
    try {
      const behaviours = graph().behaviours ?? [];
      expect(behaviours).toContain('arrange-nodes');
      // A press arrange-nodes claims never reaches what follows it; select claims nothing on the press.
      expect(behaviours.indexOf('select')).toBeLessThan(behaviours.indexOf('arrange-nodes'));
      expect(typeof graph().onNodeArrange).toBe('function');
      expect(typeof graph().onSelectionChange).toBe('function');
      expect(container.querySelector('[data-graph]')!.closest('[data-column]')).toBeTruthy();
    } finally {
      unmount();
    }
  });

  it('a card dragged under another parent moves its line there: one update, parent and siblingOrder', async () => {
    const { unmount, line, graph, updates, creates, errors } = await moveMap();
    try {
      const before = await line('acorn-outcome-2');
      arrange(graph(), 'acorn-outcome-2', { into: 'child', target: 'acorn-outcome-3', order: ['acorn-outcome-2'] });
      await waitFor(async () => expect((await line('acorn-outcome-2')).parent).toBe('acorn-outcome-3'));
      const after = await line('acorn-outcome-2');
      expect(after).toMatchObject({ id: before.id, parent: 'acorn-outcome-3', siblingOrder: 0 });
      expect(updates).toHaveLength(1);
      expect(creates).toEqual([]);
      await waitFor(() => expect(drawnUnder(graph(), 'acorn-outcome-3')).toEqual(['acorn-outcome-2']));
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('a card dragged along its row is reordered: to the far left in one write', async () => {
    const { unmount, line, graph, updates } = await moveMap();
    try {
      arrange(graph(), 'acorn-outcome-2', {
        into: 'sibling',
        target: 'acorn-outcome-3',
        before: true,
        order: ['acorn-outcome-2', 'acorn-outcome-3'],
      });
      await waitFor(async () => expect((await line('acorn-outcome-2')).siblingOrder).toBe(2));
      expect(updates).toHaveLength(1);
      await waitFor(() =>
        expect(drawnUnder(graph(), 'acorn-outcome-1')).toEqual(['acorn-outcome-2', 'acorn-outcome-3']),
      );
    } finally {
      unmount();
    }
  });

  it("Shift+← swaps a selected card with its left neighbour, as stock's alterSiblingOrder does", async () => {
    const { container, unmount, line, graph, updates } = await moveMap();
    try {
      shiftArrow(container, graph(), 'acorn-outcome-2', 'ArrowLeft');
      await waitFor(async () => expect((await line('acorn-outcome-3')).siblingOrder).toBe(0));
      expect((await line('acorn-outcome-2')).siblingOrder).toBe(1);
      expect(updates.map((u) => u.fields)).toEqual([{ siblingOrder: 1 }, { siblingOrder: 0 }]);
      await waitFor(() =>
        expect(drawnUnder(graph(), 'acorn-outcome-1')).toEqual(['acorn-outcome-2', 'acorn-outcome-3']),
      );
      // And back with Shift+→.
      shiftArrow(container, graph(), 'acorn-outcome-2', 'ArrowRight');
      await waitFor(() =>
        expect(drawnUnder(graph(), 'acorn-outcome-1')).toEqual(['acorn-outcome-3', 'acorn-outcome-2']),
      );
    } finally {
      unmount();
    }
  });

  it('an arrow without Shift, or Shift+← at the end of the row, writes nothing', async () => {
    const { container, unmount, graph, updates } = await moveMap();
    try {
      graph().onSelectionChange?.([addressOf(graph(), 'acorn-outcome-2')!]);
      fireEvent.keyDown(container.querySelector('[data-graph]')!.closest('[data-column]')!, { key: 'ArrowLeft' });
      shiftArrow(container, graph(), 'acorn-outcome-3', 'ArrowLeft');
      await new Promise((r) => setTimeout(r, 20));
      expect(updates).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('a move is drawn at once, and the next waits until it reads back', async () => {
    const { container, unmount, line, graph, updates, flush } = await moveMap({ lagUpdates: true });
    try {
      shiftArrow(container, graph(), 'acorn-outcome-2', 'ArrowLeft');
      await waitFor(() => expect(updates).toHaveLength(2));
      // Not read back yet, and drawn as written.
      expect((await line('acorn-outcome-2')).siblingOrder).toBe(0);
      await waitFor(() =>
        expect(drawnUnder(graph(), 'acorn-outcome-1')).toEqual(['acorn-outcome-2', 'acorn-outcome-3']),
      );
      // A second Shift+→ before the read-back is refused, rather than planned from the drawn row.
      shiftArrow(container, graph(), 'acorn-outcome-2', 'ArrowRight');
      await new Promise((r) => setTimeout(r, 20));
      expect(updates).toHaveLength(2);
      expect(container.textContent).toContain('Still saving');
      await flush();
      await waitFor(async () => expect((await line('acorn-outcome-2')).siblingOrder).toBe(1));
      expect(drawnUnder(graph(), 'acorn-outcome-1')).toEqual(['acorn-outcome-2', 'acorn-outcome-3']);
      // Read back: it moves again.
      shiftArrow(container, graph(), 'acorn-outcome-2', 'ArrowRight');
      await waitFor(() => expect(updates).toHaveLength(4));
    } finally {
      unmount();
    }
  });

  /*
    Lal's two cases. A move or a connect holds the map until it reads back, not only until its write
    returns: a second move of the same line would plan from the first's optimistic value, and a move
    made while a connect waits would change the stored lines the connect's guard compares with.
  */
  it('a second move while the first waits for read-back is refused, so the first is not lost', async () => {
    const { container, unmount, all, line, entity, handle, graph, updates, creates, flush } = await moveMap({
      lagUpdates: true,
    });
    try {
      // r = 1 over 3 (B), 2 (A) and X (C).
      const x = (await entity('AcornOutcome').create(handle, { content: 'X', scopeType: 'Uncertain' })) as {
        id: string;
      };
      await entity('AcornConnection').create(handle, { parent: 'acorn-outcome-1', child: x.id, siblingOrder: -1 });
      await waitFor(() => expect(drawnUnder(graph(), 'acorn-outcome-1')).toHaveLength(3));
      // A under B: the update returns, the read-back waits.
      arrange(graph(), 'acorn-outcome-2', { into: 'child', target: 'acorn-outcome-3', order: ['acorn-outcome-2'] });
      await waitFor(() => expect(updates).toHaveLength(1));
      await waitFor(() => expect(drawnUnder(graph(), 'acorn-outcome-3')).toEqual(['acorn-outcome-2']));
      // A under C before it reads back: refused, the first move still drawn.
      arrange(graph(), 'acorn-outcome-2', { into: 'child', target: x.id, order: ['acorn-outcome-2'] });
      await new Promise((r) => setTimeout(r, 20));
      expect(updates).toHaveLength(1);
      expect(container.textContent).toContain('Still saving');
      expect(drawnUnder(graph(), 'acorn-outcome-3')).toEqual(['acorn-outcome-2']);
      // A connect waits for it too.
      connect(graph(), x.id, 'acorn-outcome-3');
      await new Promise((r) => setTimeout(r, 20));
      expect(creates.filter((c) => c.entity === 'AcornConnection')).toEqual([]);
      await flush();
      await waitFor(async () => expect((await line('acorn-outcome-2')).parent).toBe('acorn-outcome-3'));
      // Read back: the map is free again, and B under A is the loop it is.
      arrange(graph(), 'acorn-outcome-3', { into: 'child', target: 'acorn-outcome-2', order: ['acorn-outcome-3'] });
      await waitFor(() => expect(container.textContent).toContain('loop'));
      expect(updates).toHaveLength(1);
      const lines = (await all()).map((c) => [c.parent, c.child]);
      expect(lines).toContainEqual(['acorn-outcome-3', 'acorn-outcome-2']);
      expect(lines).not.toContainEqual(['acorn-outcome-2', 'acorn-outcome-3']);
    } finally {
      unmount();
    }
  });

  it('a move while a connect waits for read-back is refused, and the connect still guards its line', async () => {
    const { container, unmount, all, entity, handle, graph, updates, creates, flush } = await moveMap({
      lagUpdates: true,
      lagConnections: true,
    });
    try {
      const lines = () => creates.filter((c) => c.entity === 'AcornConnection');
      const x = (await entity('AcornOutcome').create(handle, { content: 'X', scopeType: 'Uncertain' })) as {
        id: string;
      };
      await entity('AcornConnection').create(handle, { parent: 'acorn-outcome-1', child: x.id, siblingOrder: -1 });
      await waitFor(() => expect(drawnUnder(graph(), 'acorn-outcome-1')).toHaveLength(3));
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      await waitFor(() => expect(lines()).toHaveLength(1));
      // An unrelated reparent before the line reads back: refused.
      arrange(graph(), x.id, { into: 'child', target: 'acorn-outcome-2', order: [x.id] });
      await new Promise((r) => setTimeout(r, 20));
      expect(updates).toEqual([]);
      expect(container.textContent).toContain('Still saving');
      // The line in flight still guards: the reverse is a loop, the same again already under.
      connect(graph(), 'acorn-outcome-3', 'acorn-outcome-2');
      await waitFor(() => expect(container.textContent).toContain('loop'));
      connect(graph(), 'acorn-outcome-2', 'acorn-outcome-3');
      await waitFor(() => expect(container.textContent).toContain('already under'));
      expect(lines()).toHaveLength(1);
      await flush();
      await waitFor(() => expect(graph().seeds?.edges).toHaveLength(4));
      // Read back: the move goes through now.
      arrange(graph(), x.id, { into: 'child', target: 'acorn-outcome-2', order: [x.id] });
      await waitFor(() => expect(updates).toHaveLength(1));
      const stored = (await all()).map((c) => [c.parent, c.child]);
      expect(stored).not.toContainEqual(['acorn-outcome-3', 'acorn-outcome-2']);
    } finally {
      unmount();
    }
  });

  it('refuses a drag into a loop, saying why, and writes nothing', async () => {
    const { container, unmount, graph, updates, creates } = await moveMap();
    try {
      arrange(graph(), 'acorn-outcome-1', { into: 'child', target: 'acorn-outcome-2', order: ['acorn-outcome-1'] });
      await waitFor(() => expect(container.textContent).toContain('loop'));
      expect(updates).toEqual([]);
      expect(creates).toEqual([]);
    } finally {
      unmount();
    }
  });

  it('a root dragged under a card gets a line, on the right of its new siblings', async () => {
    const { container, unmount, all, entity, handle, graph, creates } = await moveMap();
    try {
      const x = (await entity('AcornOutcome').create(handle, { content: 'X', scopeType: 'Uncertain' })) as {
        id: string;
      };
      await waitFor(() => expect(cards(container)).toContain('X'));
      arrange(graph(), x.id, {
        into: 'sibling',
        target: 'acorn-outcome-2',
        before: false,
        order: ['acorn-outcome-3', 'acorn-outcome-2', x.id],
      });
      await waitFor(async () => expect((await all()).some((c) => c.child === x.id)).toBe(true));
      expect(creates.map((c) => c.fields)).toEqual([{ parent: 'acorn-outcome-1', child: x.id, siblingOrder: -1 }]);
    } finally {
      unmount();
    }
  });
});
