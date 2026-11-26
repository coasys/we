/**
 * A class becomes one canvas card, or it becomes nothing.
 *
 * The card is made by `writeCanvasCard`, the write group `RecordStore.createCardOnCanvas` calls:
 * one `runEntityTransaction`, `createBlocks` (`kind: 'card'`, anchored to the content home, joined
 * to the batch), then a placement in that same batch when a point was given. The card's id is the
 * one the registered collection model's `create` assigns.
 *
 * This file supplies that model and a transaction runner. Writes carrying the batch token stay
 * staged until the callback settles; a throw discards the batch, which is the rollback
 * `runEntityTransaction` actually gives a backend that registered one. The default runner — no
 * token, each write commits alone — is not what is installed here, and the class path does not
 * pretend to clean up after it.
 *
 * CollectionBlock has no class field and no template field. The class IRI and the template id are
 * read back from the port's sidecar, not from the block.
 */
import { type BlockEntityStatic, registerBlock } from '@we/block-shared';
import { type EntityClass, getEntity, registerEntity, registerTransactionRunner, unregisterEntity } from '@we/entities';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLASS_SURFACE_FIXTURE, isValidTemplateId } from '../src/shared/registries/templateRegistry';
import {
  type CanvasCardPort,
  classCardSidecar,
  type ClassSurfaceBinding,
  createClassTemplateCard,
} from '../src/shared/registries/templateSurface';

const FIXTURE = CLASS_SURFACE_FIXTURE[0];

interface Row {
  id: string;
  entity: 'CollectionBlock' | 'Placement';
  kind: string;
  mode: string;
  editorState: unknown;
  textContent: string;
  children: string[];
  nodeType?: string;
  x?: number;
  y?: number;
  node?: string;
}

interface Membership {
  parentId: string;
  childId: string;
}

interface Batch {
  cards: Map<string, Row>;
  placements: Map<string, Row>;
  memberships: Membership[];
}

interface Store {
  committed: Map<string, Row>;
  batches: Map<string, Batch>;
  leaks: string[];
  creates: number;
  batchSeq: number;
}

const stores = new WeakMap<object, Store>();
let cardSeq = 0;
let placementSeq = 0;
let failPlacement = false;
let gate: Promise<void> | null = null;
let releaseGate: () => void = () => {};
let entered = 0;
let previousPlacement: EntityClass | undefined;
let hadPlacement = false;

function storeOf(dataset: unknown): Store {
  if (typeof dataset !== 'object' || dataset === null) throw new Error('fixture dataset handle must be an object');
  let store = stores.get(dataset);
  if (!store) {
    store = { committed: new Map(), batches: new Map(), leaks: [], creates: 0, batchSeq: 0 };
    stores.set(dataset, store);
  }
  return store;
}

function linkChild(store: Store, parentId: string, childId: string): void {
  const parent = store.committed.get(parentId);
  if (!parent) throw new Error(`fixture: parent ${parentId} is not committed`);
  if (!parent.children.includes(childId)) parent.children.push(childId);
}

function rememberMembership(batch: Batch, parentId: string | undefined, childId: string): void {
  if (!parentId) return;
  if (batch.memberships.some((link) => link.parentId === parentId && link.childId === childId)) return;
  batch.memberships.push({ parentId, childId });
}

class FixtureCollection {
  readonly id: string;
  kind = '';
  mode = '';
  editorState: unknown = null;
  textContent = '';
  author = '';
  createdAt: unknown = null;
  updatedAt: unknown = null;

  constructor(
    private readonly store: Store,
    private readonly batchId: string | undefined,
    private readonly parentId: string | undefined,
  ) {
    this.id = `fixture-card-${++cardSeq}`;
  }

  async save(batch?: string): Promise<void> {
    const row: Row = {
      id: this.id,
      entity: 'CollectionBlock',
      kind: this.kind,
      mode: this.mode,
      editorState: this.editorState,
      textContent: this.textContent,
      children: [],
    };
    const token = batch ?? this.batchId;
    const staged = token ? this.store.batches.get(token) : undefined;
    if (staged) {
      staged.cards.set(this.id, row);
      rememberMembership(staged, this.parentId, this.id);
      return;
    }
    this.store.leaks.push('card-save-outside-batch');
    this.store.committed.set(this.id, row);
    if (this.parentId) linkChild(this.store, this.parentId, this.id);
  }

  async delete(): Promise<void> {
    this.store.committed.delete(this.id);
  }

  static async create(
    dataset: unknown,
    _data: Record<string, unknown>,
    options?: { batchId?: string; parent?: { id?: string } },
  ): Promise<FixtureCollection> {
    const store = storeOf(dataset);
    store.creates += 1;
    if (!options?.batchId) store.leaks.push('card-no-batch');
    const block = new FixtureCollection(store, options?.batchId, options?.parent?.id);
    entered += 1;
    if (gate) await gate;
    return block;
  }
}

class FixturePlacement {
  static async create(
    dataset: unknown,
    data: { nodeType?: string; x?: number; y?: number; node?: unknown },
    options?: { batchId?: string; parent?: { id?: string } },
  ): Promise<{ id: string }> {
    const store = storeOf(dataset);
    const nodeId = Array.isArray(data.node)
      ? String(data.node[0] ?? '')
      : typeof data.node === 'string'
        ? data.node
        : '';
    if (!options?.batchId) store.leaks.push('placement-no-batch');
    const batch = options?.batchId ? store.batches.get(options.batchId) : undefined;
    if (!batch?.cards.has(nodeId)) store.leaks.push('card-not-in-batch');
    if (nodeId && store.committed.has(nodeId)) store.leaks.push('card-committed-early');
    const parent = options?.parent?.id ? store.committed.get(options.parent.id) : undefined;
    if (nodeId && parent?.children.includes(nodeId)) store.leaks.push('membership-committed-early');

    const id = `fixture-placement-${++placementSeq}`;
    const row: Row = {
      id,
      entity: 'Placement',
      kind: '',
      mode: '',
      editorState: null,
      textContent: '',
      children: [],
      nodeType: data.nodeType,
      x: data.x,
      y: data.y,
      node: nodeId,
    };
    if (batch) {
      batch.placements.set(id, row);
      rememberMembership(batch, options?.parent?.id, id);
    } else {
      store.committed.set(id, row);
      if (options?.parent?.id) linkChild(store, options.parent.id, id);
    }
    if (failPlacement) throw new Error('placement failed');
    return { id };
  }
}

function installFixture(): void {
  registerBlock({
    nodeTypes: ['root', 'collection'],
    model: FixtureCollection as unknown as BlockEntityStatic,
    entity: 'CollectionBlock',
  });
  registerEntity('Placement', FixturePlacement as unknown as EntityClass);
  registerTransactionRunner(async (dataset, run) => {
    const store = storeOf(dataset);
    const batchId = `batch-${++store.batchSeq}`;
    store.batches.set(batchId, { cards: new Map(), placements: new Map(), memberships: [] });
    try {
      const result = await run({ batchId });
      const batch = store.batches.get(batchId)!;
      for (const card of batch.cards.values()) store.committed.set(card.id, card);
      for (const placement of batch.placements.values()) store.committed.set(placement.id, placement);
      for (const link of batch.memberships) linkChild(store, link.parentId, link.childId);
      store.batches.delete(batchId);
      return result;
    } catch (error) {
      store.batches.delete(batchId);
      throw error;
    }
  });
}

function seed(dataset: object, id: string): void {
  storeOf(dataset).committed.set(id, {
    id,
    entity: 'CollectionBlock',
    kind: 'canvas',
    mode: '',
    editorState: null,
    textContent: '',
    children: [],
  });
}

function portFor(dataset: object, contentHome?: (canvas: string) => string | undefined): CanvasCardPort {
  return contentHome ? { dataset, contentHome } : { dataset };
}

function request(classIri: string, surface: string = FIXTURE.surface) {
  return { classIri, surface, canvas: 'canvas-1' };
}

const cards = (dataset: object) =>
  [...storeOf(dataset).committed.values()].filter((row) => row.entity === 'CollectionBlock' && row.kind === 'card');
const placements = (dataset: object) =>
  [...storeOf(dataset).committed.values()].filter((row) => row.entity === 'Placement');
const childrenOf = (dataset: object, id: string) => storeOf(dataset).committed.get(id)?.children ?? [];

function hold(): void {
  gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
}

function release(): void {
  const done = releaseGate;
  gate = null;
  done();
}

beforeAll(() => {
  try {
    previousPlacement = getEntity('Placement') as EntityClass;
    hadPlacement = true;
  } catch {
    hadPlacement = false;
  }
  installFixture();
});

afterAll(() => {
  if (hadPlacement && previousPlacement) registerEntity('Placement', previousPlacement);
  else unregisterEntity('Placement');
});

beforeEach(() => {
  cardSeq = 0;
  placementSeq = 0;
  failPlacement = false;
  gate = null;
  releaseGate = () => {};
  entered = 0;
});

describe('instantiating a card from its class template', () => {
  it('a class without a matching surface template creates no partial card', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);

    const missing = await createClassTemplateCard(
      request('we://NotInTheFixture'),
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );
    expect(missing).toEqual({ status: 'no-template', classIri: 'we://NotInTheFixture', surface: 'card' });

    const twin = await createClassTemplateCard(request('flux://Topic'), CLASS_SURFACE_FIXTURE, isValidTemplateId, port);
    expect(twin).toEqual({ status: 'no-template', classIri: 'flux://Topic', surface: 'card' });

    const otherSurface = await createClassTemplateCard(
      request(FIXTURE.classIri, 'detail'),
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );
    expect(otherSurface.status).toBe('no-template');

    const labelled: ClassSurfaceBinding = { ...FIXTURE, templateId: 'Acorn' };
    const unknown = await createClassTemplateCard(request(FIXTURE.classIri), [labelled], isValidTemplateId, port);
    expect(unknown.status).toBe('no-template');

    const again: ClassSurfaceBinding = { ...FIXTURE, templateId: 'workshop' };
    const disagreed = await createClassTemplateCard(
      request(FIXTURE.classIri),
      [FIXTURE, again],
      (id) => id === FIXTURE.templateId || id === 'workshop',
      port,
    );
    expect(disagreed.status).toBe('no-template');

    expect(storeOf(dataset).creates).toBe(0);
    expect(cards(dataset)).toEqual([]);
    expect(placements(dataset)).toEqual([]);
    expect(childrenOf(dataset, 'canvas-1')).toEqual([]);
    expect(classCardSidecar(port)).toEqual([]);
    expect(storeOf(dataset).leaks).toEqual([]);
  });

  it('a valid binding creates one card, its parent membership, and its placement', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);
    const result = await createClassTemplateCard(
      { ...request(FIXTURE.classIri), at: { x: 3, y: 4 } },
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.card.classIri).toBe(FIXTURE.classIri);
    expect(result.card.templateId).toBe(FIXTURE.templateId);
    expect(result.card.id).toMatch(/^fixture-card-\d+$/);
    expect(result.card.id).not.toBe(result.card.templateId);
    expect(result.card.id).not.toBe(result.card.classIri);

    expect(cards(dataset)).toEqual([
      expect.objectContaining({
        id: result.card.id,
        entity: 'CollectionBlock',
        kind: 'card',
        mode: 'document',
        editorState: expect.objectContaining({ name: 'editor-state.json', file_type: 'application/json' }),
      }),
    ]);
    expect(cards(dataset)[0]).not.toHaveProperty('classIri');
    expect(cards(dataset)[0]).not.toHaveProperty('templateId');
    expect(cards(dataset)[0]).not.toHaveProperty('displayName');

    const placed = placements(dataset);
    expect(placed).toEqual([
      expect.objectContaining({
        node: result.card.id,
        nodeType: 'CollectionBlock',
        x: 3,
        y: 4,
      }),
    ]);
    expect(childrenOf(dataset, 'canvas-1')).toEqual([result.card.id, placed[0].id]);
    expect(classCardSidecar(port)).toEqual([
      { id: result.card.id, classIri: FIXTURE.classIri, surface: 'card', templateId: FIXTURE.templateId },
    ]);
    expect(storeOf(dataset).creates).toBe(1);
    expect(storeOf(dataset).leaks).toEqual([]);
  });

  it('parents the card on the content home and the placement on the canvas', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    seed(dataset, 'notes');
    const port = portFor(dataset, () => 'notes');
    const result = await createClassTemplateCard(
      { ...request(FIXTURE.classIri), at: { x: 1, y: 2 } },
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    const placed = placements(dataset);
    expect(childrenOf(dataset, 'notes')).toEqual([result.card.id]);
    expect(childrenOf(dataset, 'canvas-1')).toEqual([placed[0].id]);
    expect(placed[0]).toMatchObject({ node: result.card.id, x: 1, y: 2 });
    expect(storeOf(dataset).leaks).toEqual([]);
  });

  it('creates the card with no placement when nobody gave a point', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);
    const result = await createClassTemplateCard(
      request(FIXTURE.classIri),
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(placements(dataset)).toEqual([]);
    expect(childrenOf(dataset, 'canvas-1')).toEqual([result.card.id]);
    expect(storeOf(dataset).leaks).toEqual([]);
  });

  it('keeps class data separate from template identity', async () => {
    const topic: ClassSurfaceBinding = {
      classIri: 'we://Topic',
      displayName: 'Topic',
      surface: 'card',
      templateId: 'acorn',
    };
    const fluxTopic: ClassSurfaceBinding = {
      classIri: 'flux://Topic',
      displayName: 'Topic',
      surface: 'card',
      templateId: 'workshop',
    };
    const known = (id: string) => id === 'acorn' || id === 'workshop';
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);
    const result = await createClassTemplateCard(request(topic.classIri), [topic, fluxTopic], known, port);

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.card.classIri).toBe('we://Topic');
    expect(result.card.templateId).toBe('acorn');
    expect(result.card.classIri).not.toBe(result.card.templateId);
    expect(result.card.id).not.toBe(result.card.templateId);
    expect(result.card.id).not.toBe(result.card.classIri);
    expect(result.card.templateId).not.toBe(fluxTopic.templateId);
    expect(result.card.classIri).not.toBe(topic.displayName);
    expect(result.card.templateId).not.toBe(topic.displayName);
    expect(cards(dataset)[0]).not.toHaveProperty('displayName');
    expect(cards(dataset)[0]).not.toHaveProperty('classIri');
    expect(classCardSidecar(port)).toEqual([
      { id: result.card.id, classIri: 'we://Topic', surface: 'card', templateId: 'acorn' },
    ]);
    expect(classCardSidecar(port)[0]).not.toHaveProperty('displayName');
  });

  it('a double submission creates one card, and the first request wins', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);
    hold();
    const pending = Promise.all([
      createClassTemplateCard(
        { ...request(FIXTURE.classIri), at: { x: 1, y: 2 } },
        CLASS_SURFACE_FIXTURE,
        isValidTemplateId,
        port,
      ),
      createClassTemplateCard(
        { ...request(FIXTURE.classIri), at: { x: 9, y: 9 } },
        CLASS_SURFACE_FIXTURE,
        isValidTemplateId,
        port,
      ),
    ]);
    await vi.waitFor(() => {
      expect(entered).toBe(1);
    });
    release();
    const [first, second] = await pending;

    expect(entered).toBe(1);
    expect(first).toEqual(second);
    expect(first.status).toBe('created');
    expect(cards(dataset)).toHaveLength(1);
    expect(placements(dataset)).toEqual([expect.objectContaining({ x: 1, y: 2 })]);
    expect(storeOf(dataset).creates).toBe(1);
    if (first.status === 'created')
      expect(classCardSidecar(port)).toEqual([
        { id: first.card.id, classIri: FIXTURE.classIri, surface: 'card', templateId: FIXTURE.templateId },
      ]);
  });

  it('a failed create leaves no card, and a later one still creates', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);
    failPlacement = true;
    await expect(
      createClassTemplateCard(
        { ...request(FIXTURE.classIri), at: { x: 3, y: 4 } },
        CLASS_SURFACE_FIXTURE,
        isValidTemplateId,
        port,
      ),
    ).rejects.toThrow('placement failed');

    expect(storeOf(dataset).creates).toBe(1);
    expect(cards(dataset)).toEqual([]);
    expect(placements(dataset)).toEqual([]);
    expect(childrenOf(dataset, 'canvas-1')).toEqual([]);
    expect(classCardSidecar(port)).toEqual([]);
    expect(storeOf(dataset).leaks).toEqual([]);
    expect(storeOf(dataset).batches.size).toBe(0);

    failPlacement = false;
    const again = await createClassTemplateCard(
      { ...request(FIXTURE.classIri), at: { x: 5, y: 6 } },
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );
    expect(again.status).toBe('created');
    if (again.status !== 'created') return;
    expect(cards(dataset)).toHaveLength(1);
    expect(placements(dataset)).toEqual([expect.objectContaining({ node: again.card.id, x: 5, y: 6 })]);
    expect(childrenOf(dataset, 'canvas-1')).toEqual([again.card.id, placements(dataset)[0].id]);
    expect(classCardSidecar(port)).toEqual([
      { id: again.card.id, classIri: FIXTURE.classIri, surface: 'card', templateId: FIXTURE.templateId },
    ]);
    expect(storeOf(dataset).leaks).toEqual([]);
  });

  it('creates two cards for two classes on one canvas', async () => {
    const other: ClassSurfaceBinding = { ...FIXTURE, classIri: 'fixture://class-surface/other', displayName: 'Other' };
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);
    const known = (id: string) => id === FIXTURE.templateId;
    hold();
    const pending = Promise.all([
      createClassTemplateCard({ ...request(FIXTURE.classIri), at: { x: 1, y: 1 } }, [FIXTURE, other], known, port),
      createClassTemplateCard({ ...request(other.classIri), at: { x: 2, y: 2 } }, [FIXTURE, other], known, port),
    ]);
    await vi.waitFor(() => {
      expect(entered).toBe(2);
    });
    release();
    const [topic, rest] = await pending;

    expect(topic.status).toBe('created');
    expect(rest.status).toBe('created');
    if (topic.status !== 'created' || rest.status !== 'created') return;
    expect(topic.card.id).not.toBe(rest.card.id);
    expect(topic.card.classIri).toBe(FIXTURE.classIri);
    expect(rest.card.classIri).toBe(other.classIri);
    expect(cards(dataset)).toHaveLength(2);
    expect(placements(dataset)).toHaveLength(2);
    expect(childrenOf(dataset, 'canvas-1')).toEqual(
      expect.arrayContaining([topic.card.id, rest.card.id, ...placements(dataset).map((row) => row.id)]),
    );
    expect(childrenOf(dataset, 'canvas-1')).toHaveLength(4);
    expect(classCardSidecar(port)).toEqual(
      expect.arrayContaining([
        { id: topic.card.id, classIri: FIXTURE.classIri, surface: 'card', templateId: FIXTURE.templateId },
        { id: rest.card.id, classIri: other.classIri, surface: 'card', templateId: FIXTURE.templateId },
      ]),
    );
  });

  it('creates two cards for one class on two canvases', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    seed(dataset, 'canvas-2');
    const port = portFor(dataset);
    hold();
    const pending = Promise.all([
      createClassTemplateCard(
        { ...request(FIXTURE.classIri), canvas: 'canvas-1', at: { x: 1, y: 1 } },
        CLASS_SURFACE_FIXTURE,
        isValidTemplateId,
        port,
      ),
      createClassTemplateCard(
        { ...request(FIXTURE.classIri), canvas: 'canvas-2', at: { x: 8, y: 8 } },
        CLASS_SURFACE_FIXTURE,
        isValidTemplateId,
        port,
      ),
    ]);
    await vi.waitFor(() => {
      expect(entered).toBe(2);
    });
    release();
    const [onFirst, onSecond] = await pending;

    expect(onFirst.status).toBe('created');
    expect(onSecond.status).toBe('created');
    if (onFirst.status !== 'created' || onSecond.status !== 'created') return;
    expect(onFirst.card.id).not.toBe(onSecond.card.id);
    expect(childrenOf(dataset, 'canvas-1')).toContain(onFirst.card.id);
    expect(childrenOf(dataset, 'canvas-2')).toContain(onSecond.card.id);
    expect(childrenOf(dataset, 'canvas-1')).not.toContain(onSecond.card.id);
    expect(placements(dataset)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: onFirst.card.id, x: 1, y: 1 }),
        expect.objectContaining({ node: onSecond.card.id, x: 8, y: 8 }),
      ]),
    );
  });

  it('a settled success is another card, with its own id', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    const port = portFor(dataset);
    const first = await createClassTemplateCard(
      { ...request(FIXTURE.classIri), at: { x: 1, y: 1 } },
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );
    const second = await createClassTemplateCard(
      { ...request(FIXTURE.classIri), at: { x: 2, y: 3 } },
      CLASS_SURFACE_FIXTURE,
      isValidTemplateId,
      port,
    );

    expect(first.status).toBe('created');
    expect(second.status).toBe('created');
    if (first.status !== 'created' || second.status !== 'created') return;
    expect(first.card.id).not.toBe(second.card.id);
    expect(cards(dataset).map((row) => row.id)).toEqual([first.card.id, second.card.id]);
    expect(classCardSidecar(port).map((row) => row.id)).toEqual([first.card.id, second.card.id]);
    expect(storeOf(dataset).creates).toBe(2);
    expect(storeOf(dataset).leaks).toEqual([]);
  });

  it('two ports do not share an in-flight create, even on one dataset', async () => {
    const dataset = {};
    seed(dataset, 'canvas-1');
    const firstPort = portFor(dataset);
    const secondPort = portFor(dataset);
    hold();
    const pending = Promise.all([
      createClassTemplateCard(request(FIXTURE.classIri), CLASS_SURFACE_FIXTURE, isValidTemplateId, firstPort),
      createClassTemplateCard(request(FIXTURE.classIri), CLASS_SURFACE_FIXTURE, isValidTemplateId, secondPort),
    ]);
    await vi.waitFor(() => {
      expect(entered).toBe(2);
    });
    release();
    const [first, second] = await pending;

    expect(first.status).toBe('created');
    expect(second.status).toBe('created');
    if (first.status !== 'created' || second.status !== 'created') return;
    expect(first.card.id).not.toBe(second.card.id);
    expect(cards(dataset)).toHaveLength(2);
    expect(classCardSidecar(firstPort).map((row) => row.id)).toEqual([first.card.id]);
    expect(classCardSidecar(secondPort).map((row) => row.id)).toEqual([second.card.id]);
  });
});
