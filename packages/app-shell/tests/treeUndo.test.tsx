/**
 * Undoing a card dragged to another place in a tree.
 *
 * A tree drop writes the structure the layout reads — a connection moved to a new parent, made, or deleted
 * — and the ranks that order a row. None of it went into the canvas's undo history, so Ctrl+Z after a drop
 * into the wrong branch did nothing at all. These are the closures that put it back, run against a stand-in
 * holding the connections and the placements, and the rule they keep is the canvas's: an undo is a new
 * forward write, and a card a peer has moved since is left where they put it.
 */
import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CANVAS = 'canvas-1';
const SPINE = 'kind-1';

interface Link {
  id: string;
  relationshipTypeId: string;
  source?: string;
  target?: string;
  sourceType?: string;
  targetType?: string;
  connection?: string;
  label?: string;
}

interface Row {
  id: string;
  node: string;
  rank?: number;
  parent: string;
}

const { world, Placement, Relationship } = vi.hoisted(() => {
  const state = { links: new Map<string, Link>(), rows: new Map<string, Row>(), next: 0 };
  /** A link as the ORM hands one back: a live instance whose ends move through accessors. */
  const live = (link: Link) =>
    Object.assign(link, {
      setSource: async (value: string) => void (state.links.get(link.id)!.source = value),
      setTarget: async (value: string) => void (state.links.get(link.id)!.target = value),
    });
  return {
    world: state,
    Placement: {
      findAll: async (_p: unknown, query: { parent?: { id: string } }) =>
        [...state.rows.values()].filter((row) => row.parent === query.parent?.id),
      update: async (_p: unknown, id: string, patch: Partial<Row>) => void Object.assign(state.rows.get(id)!, patch),
      delete: async (_p: unknown, id: string) => void state.rows.delete(id),
      create: async () => ({}),
    },
    Relationship: {
      findAll: async (_p: unknown, query: { where: { relationshipTypeId: string } }) =>
        [...state.links.values()].filter((link) => link.relationshipTypeId === query.where.relationshipTypeId),
      findOne: async (_p: unknown, query: { where: { id: string } }) => {
        const link = state.links.get(query.where.id);
        return link ? live(link) : null;
      },
      create: async (_p: unknown, data: Omit<Link, 'id'>) => {
        // A relation handed as a one-element array is stored as its one value, as the ORM does.
        const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
        const link: Link = { ...data, source: one(data.source), target: one(data.target), id: `link-${state.next++}` };
        state.links.set(link.id, link);
        return live(link);
      },
      update: async (_p: unknown, id: string, patch: Partial<Link>) => void Object.assign(state.links.get(id)!, patch),
      delete: async (_p: unknown, id: string) => void state.links.delete(id),
    },
  };
});

vi.mock('@we/entities', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@we/entities');
  return {
    ...actual,
    Placement,
    EdgeRoute: { findAll: async () => [], create: async () => ({}), update: async () => ({}), delete: async () => {} },
    TypeStyle: { findAll: async () => [], create: async () => ({}), update: async () => ({}) },
    runEntityTransaction: async (_p: unknown, fn: (tx: { batchId: string }) => Promise<unknown>) =>
      fn({ batchId: 'batch-1' }),
    getEntity: () => Relationship,
    getEntityForDataset: () => undefined,
  };
});

vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  useDatasetStore: () => ({
    currentDataset: () => ({ id: 'ds', handle: {}, name: 'Space' }),
    datasets: () => [],
    personalDataset: () => null,
  }),
}));
vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:key:z6Mk' }) }),
}));
vi.mock('../src/frameworks/solid/stores/ShapeStore', () => ({
  useShapeStore: () => ({ spaceShapes: () => [], extractionCandidates: () => [] }),
  BLOCK_ICONS: {},
}));

import {
  connectionKey,
  type RecordStore,
  RecordStoreProvider,
  useRecordStore,
} from '../src/frameworks/solid/stores/RecordStore';

function mount(): RecordStore {
  let store!: RecordStore;
  function Capture() {
    store = useRecordStore();
    return null;
  }
  render(() => (
    <RecordStoreProvider>
      <Capture />
    </RecordStoreProvider>
  ));
  return store;
}

const link = (id: string, source: string, target: string) =>
  world.links.set(id, { id, relationshipTypeId: SPINE, source, target, sourceType: 'Card', targetType: 'Card' });
const place = (node: string, rank?: number) =>
  world.rows.set(`row-${node}`, { id: `row-${node}`, node, parent: CANVAS, ...(rank ? { rank } : {}) });
const parentOf = (card: string) => [...world.links.values()].find((entry) => entry.target === card)?.source;
const rankOf = (card: string) => world.rows.get(`row-${card}`)?.rank ?? 0;

/** p over a and b; q over x — every card placed, a and b ranked. */
beforeEach(() => {
  world.links.clear();
  world.rows.clear();
  world.next = 0;
  link('pa', 'p', 'a');
  link('pb', 'p', 'b');
  link('qx', 'q', 'x');
  for (const card of ['p', 'q', 'x', 'z']) place(card);
  place('a', 1024);
  place('b', 2048);
});

const drop = (store: RecordStore, payload: Record<string, unknown>) =>
  store.arrangeOnTree(CANVAS, SPINE, { recordId: 'b', recordType: 'Card', ...payload });

describe('undoing a tree drop', () => {
  it('moves a card back to the parent it came from, and its rank back with it', async () => {
    const store = mount();
    await drop(store, { into: 'child', targetId: 'x', targetType: 'Card', order: ['b'] });
    expect(parentOf('b')).toBe('x');

    await store.undoCanvas(CANVAS);
    expect(parentOf('b')).toBe('p');
    expect(rankOf('b')).toBe(2048);

    await store.redoCanvas(CANVAS);
    expect(parentOf('b')).toBe('x');
  });

  it('puts a row back in the order it had', async () => {
    const store = mount();
    await drop(store, { into: 'sibling', targetId: 'a', targetType: 'Card', before: true, order: ['b', 'a'] });
    expect(rankOf('b')).toBeLessThan(rankOf('a'));

    await store.undoCanvas(CANVAS);
    expect(rankOf('a')).toBeLessThan(rankOf('b'));
  });

  it('takes away a connection the drop made, and makes it again on redo', async () => {
    const store = mount();
    await store.arrangeOnTree(CANVAS, SPINE, {
      recordId: 'z',
      recordType: 'Card',
      into: 'child',
      targetId: 'x',
      targetType: 'Card',
      order: ['z'],
    });
    expect(parentOf('z')).toBe('x');

    await store.undoCanvas(CANVAS);
    expect(parentOf('z')).toBeUndefined();

    await store.redoCanvas(CANVAS);
    expect(parentOf('z')).toBe('x');
  });

  it('puts back a card taken out of its tree', async () => {
    const store = mount();
    await drop(store, { into: 'loose' });
    expect(parentOf('b')).toBeUndefined();

    await store.undoCanvas(CANVAS);
    expect(parentOf('b')).toBe('p');

    await store.redoCanvas(CANVAS);
    expect(parentOf('b')).toBeUndefined();
  });

  it('leaves a card alone when a peer has moved it since', async () => {
    const store = mount();
    await drop(store, { into: 'child', targetId: 'x', targetType: 'Card', order: ['b'] });
    world.links.get('pb')!.source = 'q';

    await store.undoCanvas(CANVAS);
    expect(parentOf('b')).toBe('q');
  });
});

/**
 * Connections held ahead of the data: drawn from the moment of the gesture, and dropped once the graph
 * reports its own data says the same — see `holdConnection`.
 */
/**
 * The dedup key an extraction pass reads.
 *
 * The executor shows a model only the connections whose key is set, so a tree built by hand with none
 * was invisible to the pass meant to extend it — and a key naming an end that has since moved would
 * tell that pass the card was still where it used to be.
 */
describe('a connection’s key', () => {
  it('is written on a connection a tree drop makes', async () => {
    const store = mount();
    await store.arrangeOnTree(CANVAS, SPINE, {
      recordId: 'z',
      recordType: 'Card',
      into: 'child',
      targetId: 'x',
      targetType: 'Card',
      order: ['z'],
    });
    const made = [...world.links.values()].find((entry) => entry.target === 'z');
    expect(made?.connection).toBe('x \u2192 z');
  });

  it('follows the end a tree drop moves, and moves back on undo', async () => {
    world.links.get('pb')!.label = 'depends on';
    const store = mount();
    await drop(store, { into: 'child', targetId: 'x', targetType: 'Card', order: ['b'] });
    expect(world.links.get('pb')?.connection).toBe('x \u2192 b: depends on');

    await store.undoCanvas(CANVAS);
    expect(world.links.get('pb')?.connection).toBe('p \u2192 b: depends on');
  });

  it('names both ends by id, and leaves the label off when there is none', () => {
    expect(connectionKey('we://a', 'we://b', '  contradicts ')).toBe('we://a \u2192 we://b: contradicts');
    expect(connectionKey('we://a', 'we://b', '')).toBe('we://a \u2192 we://b');
    expect(connectionKey('we://a', 'we://b')).toBe('we://a \u2192 we://b');
  });
});

describe('connections written and not yet seen', () => {
  /** What the graph would report drawing from its own data, in records. */
  const drawn = () =>
    [...world.links.values()].map(({ id, source, target }) => ({ id, source: source ?? '', target: target ?? '' }));

  it('draws a line somebody drew at once, and stops when the graph draws the real one', async () => {
    const store = mount();
    const writing = store.connectNodesNow({
      sourceId: 'a',
      sourceType: 'Card',
      targetId: 'x',
      targetType: 'Card',
    } as never);
    // Before the write has come back.
    expect(store.pendingConnections().added).toEqual([expect.objectContaining({ source: 'a', target: 'x' })]);
    const id = await writing;

    store.observeConnections(drawn().filter((line) => line.id !== id));
    expect(store.pendingConnections().added).toHaveLength(1);
    store.observeConnections(drawn());
    expect(store.pendingConnections().added).toHaveLength(0);
  });

  it('stops drawing a deleted connection at once, and forgets it once it is gone', async () => {
    const store = mount();
    await store.deleteRecords([{ recordId: 'pa', recordType: 'Relationship' }]);
    expect(store.pendingConnections().removed).toEqual(['pa']);

    store.observeConnections(drawn());
    expect(store.pendingConnections().removed).toEqual(['pa']);
    world.links.delete('pa');
    store.observeConnections(drawn());
    expect(store.pendingConnections().removed).toEqual([]);
  });

  it('draws a re-attached end at its new card until the connection says so', async () => {
    const store = mount();
    const writing = store.retargetOnCanvas(CANVAS, {
      recordId: 'pb',
      recordType: 'Relationship',
      end: 'source',
      nodeId: 'q',
      nodeType: 'Card',
    });
    expect(store.pendingConnections().moved).toEqual([{ id: 'pb', end: 'source', to: 'q' }]);
    await writing;
    store.observeConnections(drawn());
    expect(store.pendingConnections().moved).toEqual([]);
  });

  it('lets go of a line whose write failed', async () => {
    const store = mount();
    const create = Relationship.create;
    Relationship.create = async () => {
      throw new Error('refused');
    };
    try {
      await store.connectNodesNow({ sourceId: 'a', sourceType: 'Card', targetId: 'x', targetType: 'Card' } as never);
    } finally {
      Relationship.create = create;
    }
    expect(store.pendingConnections().added).toEqual([]);
  });

  it('leaves a tree drop’s new line to the graph, which is already drawing it from the held card', async () => {
    const store = mount();
    await store.arrangeOnTree(CANVAS, SPINE, {
      recordId: 'z',
      recordType: 'Card',
      into: 'child',
      targetId: 'x',
      targetType: 'Card',
      order: ['z'],
    });
    expect(store.pendingConnections().added).toEqual([]);
  });
});
