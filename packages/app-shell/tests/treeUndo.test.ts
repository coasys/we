/**
 * Undoing a card dragged to another place in a tree.
 *
 * A tree drop writes the structure the layout reads — a connection moved to a new parent, made, or deleted
 * — and the ranks that order a row. None of it went into the canvas's undo history, so Ctrl+Z after a drop
 * into the wrong branch did nothing at all. These are the closures that put it back, run against the in-memory
 * backend holding the connections and the placements, and the rule they keep is the canvas's: an undo is a new
 * forward write, and a card a peer has moved since is left where they put it.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity, registerEntityWriteCheck } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CANVAS = 'canvas-1';
const SPINE = 'kind-1';

type Row = Record<string, unknown> & { id: string };
type Model = {
  create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
  findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  findOne(p: unknown, query: Record<string, unknown>): Promise<Row | null>;
  update(p: unknown, id: string, data: Record<string, unknown>): Promise<unknown>;
};
const model = (name: string) => getEntity(name) as unknown as Model;

/*
  The in-memory backend holds the connections and the placements: the canvas writes are declared
  operations run by the real runner.
*/
let handle: unknown;

const datasetStub = {
  currentDataset: () => ({ id: 'ds', handle, name: 'Space' }),
  datasets: () => [],
  personalDataset: () => null,
  currentDatasetEntities: () => [],
};
const sessionStub = { me: () => ({ did: 'did:key:z6Mk' }) };
const shapeStub = {
  spaceShapes: () => [],
  interpretationCandidates: () => [],
  interpretationCandidatesLoaded: () => true,
};

import { createRecordStore, type RecordStore } from '../src/shared/stores/RecordStore';

/*
  Run once under each reactivity port: Solid's, and the test port, which runs a new effect at once
  where Solid defers it. Each store is built in a root of its own and disposed after its case.
*/
const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];
let reactivity: ReactivityPort;
const disposers: (() => void)[] = [];

/** What the store says aloud, kept so a case can ask what was said. */
const toasts = {
  info: (_message: string) => undefined as unknown,
  success: (_message: string) => undefined as unknown,
  warning: (_message: string) => undefined as unknown,
  error: (_message: string) => undefined as unknown,
};

function mount(): RecordStore {
  let store!: RecordStore;
  disposers.push(
    reactivity.root(() => {
      store = createRecordStore({
        reactivity,
        toasts,
        datasetStore: datasetStub as never,
        sessionStore: sessionStub as never,
        shapeStore: shapeStub as never,
      });
    }),
  );
  return store;
}

const link = (id: string, source: string, target: string) =>
  model('Relationship').create(
    handle,
    { relationshipTypeId: SPINE, source, target, sourceType: 'Card', targetType: 'Card' },
    { id },
  );
const place = (node: string, rank?: number) =>
  model('Placement').create(
    handle,
    { nodeType: 'Card', node, ...(rank ? { rank } : {}) },
    { id: `row-${node}`, parent: { id: CANVAS, relation: 'children', entity: 'CollectionBlock' } },
  );
const links = () => model('Relationship').findAll(handle);
const linkOf = async (id: string) => (await model('Relationship').findOne(handle, { where: { id } }))!;
const parentOf = async (card: string) => (await links()).find((entry) => entry.target === card)?.source;
const rankOf = async (card: string) =>
  ((await model('Placement').findOne(handle, { where: { id: `row-${card}` } }))?.rank as number | undefined) ?? 0;
/** A peer's write, straight to the backend — so the store records nothing for it. */
const peer = async (id: string, fields: Record<string, unknown>) => {
  const found = (await model('Relationship').findOne(handle, { where: { id } })) as Row & { save(): Promise<void> };
  Object.assign(found, fields);
  await found.save();
};

/** p over a and b; q over x — every card placed, a and b ranked. */
beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:key:z6Mk' },
    { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-tree', name: 'Tree' }] },
  );
  handle = (await ports.lifecycle.get('ds-tree'))!.handle;
  await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
  await link('pa', 'p', 'a');
  await link('pb', 'p', 'b');
  await link('qx', 'q', 'x');
  for (const card of ['p', 'q', 'x', 'z']) await place(card);
  await place('a', 1024);
  await place('b', 2048);
});

afterEach(() => registerEntityWriteCheck(null));

const drop = (store: RecordStore, payload: Record<string, unknown>) =>
  store.arrangeOnTree(CANVAS, SPINE, { recordId: 'b', recordType: 'Card', ...payload });

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  beforeEach(() => {
    reactivity = makePort();
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  describe('undoing a tree drop', () => {
    it('moves a card back to the parent it came from, and its rank back with it', async () => {
      const store = mount();
      await drop(store, { into: 'child', targetId: 'x', targetType: 'Card', order: ['b'] });
      expect(await parentOf('b')).toBe('x');

      await store.undoCanvas(CANVAS);
      expect(await parentOf('b')).toBe('p');
      expect(await rankOf('b')).toBe(2048);

      await store.redoCanvas(CANVAS);
      expect(await parentOf('b')).toBe('x');
    });

    it('puts a row back in the order it had', async () => {
      const store = mount();
      await drop(store, { into: 'sibling', targetId: 'a', targetType: 'Card', before: true, order: ['b', 'a'] });
      expect(await rankOf('b')).toBeLessThan(await rankOf('a'));

      await store.undoCanvas(CANVAS);
      expect(await rankOf('a')).toBeLessThan(await rankOf('b'));
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
      expect(await parentOf('z')).toBe('x');

      await store.undoCanvas(CANVAS);
      expect(await parentOf('z')).toBeUndefined();

      await store.redoCanvas(CANVAS);
      expect(await parentOf('z')).toBe('x');
    });

    it('puts back a card taken out of its tree', async () => {
      const store = mount();
      await drop(store, { into: 'loose' });
      expect(await parentOf('b')).toBeUndefined();

      await store.undoCanvas(CANVAS);
      expect(await parentOf('b')).toBe('p');

      await store.redoCanvas(CANVAS);
      expect(await parentOf('b')).toBeUndefined();
    });

    it('leaves a card alone when a peer has moved it since', async () => {
      const store = mount();
      await drop(store, { into: 'child', targetId: 'x', targetType: 'Card', order: ['b'] });
      await peer('pb', { source: 'q' });

      await store.undoCanvas(CANVAS);
      expect(await parentOf('b')).toBe('q');
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
    /** A card the double can read a title off, as `TaskBlock` names one by its identity property. */
    const card = (id: string, title: string) => model('TaskBlock').create(handle, { title }, { id });

    it('names both ends by title on a connection a tree drop makes', async () => {
      await card('x', 'Ship the release');
      await card('z', 'Write the notes');
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'z',
        recordType: 'TaskBlock',
        into: 'child',
        targetId: 'x',
        targetType: 'TaskBlock',
        order: ['z'],
      });
      const made = (await links()).find((entry) => entry.target === 'z');
      expect(made?.connection).toBe('Ship the release \u2192 Write the notes');
    });

    it('falls back to an end’s id where its type names nothing', async () => {
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'z',
        recordType: 'Card',
        into: 'child',
        targetId: 'x',
        targetType: 'Card',
        order: ['z'],
      });
      expect((await links()).find((entry) => entry.target === 'z')?.connection).toBe('x \u2192 z');
    });

    it('follows the end a tree drop moves, and moves back on undo', async () => {
      await peer('pb', { label: 'depends on' });
      const store = mount();
      await drop(store, { into: 'child', targetId: 'x', targetType: 'Card', order: ['b'] });
      expect((await linkOf('pb')).connection).toBe('x \u2192 b: depends on');

      await store.undoCanvas(CANVAS);
      expect((await linkOf('pb')).connection).toBe('p \u2192 b: depends on');
    });

    it('follows a relabel', async () => {
      const store = mount();
      await store.updateRecordField('Relationship', 'pb', 'label', 'blocks');
      expect((await linkOf('pb')).connection).toBe('p \u2192 b: blocks');
    });

    it('follows a record it joins being renamed', async () => {
      await card('q', 'Old name');
      await peer('qx', { sourceType: 'TaskBlock' });
      const store = mount();
      await store.updateRecordField('TaskBlock', 'q', 'title', 'New name');
      expect((await linkOf('qx')).connection).toBe('New name \u2192 x');
    });
  });

  describe('connections written and not yet seen', () => {
    /** What the graph would report drawing from its own data, in records. */
    const drawn = async () =>
      (await links()).map(({ id, source, target }) => ({
        id,
        source: String(source ?? ''),
        target: String(target ?? ''),
      }));

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

      store.observeConnections((await drawn()).filter((line) => line.id !== id));
      expect(store.pendingConnections().added).toHaveLength(1);
      store.observeConnections(await drawn());
      expect(store.pendingConnections().added).toHaveLength(0);
    });

    it('stops drawing a deleted connection at once, and forgets it once it is gone', async () => {
      const store = mount();
      await store.deleteRecords([{ recordId: 'pa', recordType: 'Relationship' }]);
      expect(store.pendingConnections().removed).toEqual(['pa']);

      // The graph still drawing it from an answer that predates the delete.
      store.observeConnections([...(await drawn()), { id: 'pa', source: 'p', target: 'a' }]);
      expect(store.pendingConnections().removed).toEqual(['pa']);
      store.observeConnections(await drawn());
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
      store.observeConnections(await drawn());
      expect(store.pendingConnections().moved).toEqual([]);
    });

    it('lets go of a line whose write failed', async () => {
      const store = mount();
      registerEntityWriteCheck((write) => {
        if (write.entity === 'Relationship' && write.kind === 'create')
          throw Object.assign(new Error('refused'), { name: 'PolicyRefusal' });
      });
      await store.connectNodesNow({ sourceId: 'a', sourceType: 'Card', targetId: 'x', targetType: 'Card' } as never);
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
});
