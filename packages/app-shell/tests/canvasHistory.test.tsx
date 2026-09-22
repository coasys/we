/**
 * Undoing what this agent did to a canvas.
 *
 * The data layer here is a stand-in holding `Placement` rows, because what is being tested is the
 * round trip through it: a move records where the card *was*, an undo writes that back, and a peer
 * who has moved the card in between is left alone. None of that is observable from the history
 * package on its own — it holds closures, and these are the closures.
 *
 * The rule under test is the one that makes undo safe on a shared, last-write-wins data layer:
 * **an undo is a new forward write, guarded by what it expects to find.** Not a rollback, and never
 * a snapshot of the whole canvas.
 */
import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CANVAS = 'canvas-1';

interface Row {
  id: string;
  node?: string;
  nodeType?: string;
  x?: number;
  y?: number;
  color?: string;
  parent?: string;
}

/*
  Hoisted, because `vi.mock`'s factory is: anything the factory closes over has to be created before
  the mock is registered, and a plain `const` at the top of the file is not — it is still in its
  temporal dead zone when the factory runs, which fails as "Cannot access before initialization"
  from inside an unrelated module's import.
*/
const { store: world, Placement } = vi.hoisted(() => {
  const state = { rows: new Map<string, Row>(), nextId: 0, deleted: [] as string[] };
  return {
    store: state,
    Placement: {
      create: async (_p: unknown, data: Record<string, unknown>, options?: { parent?: { id: string } }) => {
        const row: Row = {
          ...(data as Row),
          // The ORM takes a relation as a list and stores the single target.
          node: Array.isArray(data.node) ? (data.node[0] as string) : (data.node as string),
          id: `placement-${state.nextId++}`,
          parent: options?.parent?.id,
        };
        state.rows.set(row.id, row);
        return row;
      },
      findAll: async (_p: unknown, query: { parent?: { id: string } }) =>
        [...state.rows.values()].filter((row) => row.parent === query.parent?.id),
      update: async (_p: unknown, id: string, patch: Partial<Row>) => {
        Object.assign(state.rows.get(id)!, patch);
      },
      delete: async (_p: unknown, id: string) => void state.rows.delete(id),
    },
  };
});

vi.mock('@we/entities', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@we/entities');
  return {
    ...actual,
    Placement,
    TypeStyle: { findAll: async () => [], create: async () => ({}), update: async () => ({}) },
    runEntityTransaction: async (_p: unknown, fn: (tx: { batchId: string }) => Promise<unknown>) =>
      fn({ batchId: 'batch-1' }),
    getEntity: () => ({
      findOne: async (_p: unknown, query: { where: { id: string } }) => ({
        id: query.where.id,
        delete: async () => void world.deleted.push(query.where.id),
      }),
    }),
    getEntitiesForPerspective: () => undefined,
  };
});

const datasetStub = {
  currentDataset: () => ({ id: 'ds', handle: {}, name: 'Space' }),
  datasets: () => [],
  personalDataset: () => null,
};

vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({ useDatasetStore: () => datasetStub }));
vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:key:z6Mk' }) }),
}));
vi.mock('../src/frameworks/solid/stores/ShapeStore', () => ({
  useShapeStore: () => ({ spaceShapes: () => [], extractionCandidates: () => [] }),
  BLOCK_ICONS: {},
}));

import { type RecordStore, RecordStoreProvider, useRecordStore } from '../src/frameworks/solid/stores/RecordStore';

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
  store.scopeCanvasHistory(CANVAS);
  return store;
}

/** Where a node's card currently sits, as the stand-in holds it. */
const spotOf = (nodeId: string) => {
  const row = [...world.rows.values()].find((entry) => entry.node === nodeId);
  return row ? { x: row.x, y: row.y } : null;
};

/** The row a node's card is drawn from, for the fields `spotOf` does not carry. */
const rowOf = (nodeId: string) => [...world.rows.values()].find((entry) => entry.node === nodeId);

beforeEach(() => {
  world.rows.clear();
  world.nextId = 0;
  world.deleted.length = 0;
});

describe('undoing a move', () => {
  it('puts the card back where it was', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);
    expect(spotOf('n1')).toEqual({ x: 400, y: 300 });

    await store.undoCanvas();

    expect(spotOf('n1')).toEqual({ x: 10, y: 10 });
    expect(store.canvasHistory().canRedo).toBe(true);
  });

  it('puts it forward again on redo', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);
    await store.undoCanvas();

    await store.redoCanvas();

    expect(spotOf('n1')).toEqual({ x: 400, y: 300 });
  });

  it('takes a card off the canvas again when it was not on it before', async () => {
    // The undo of "this was dropped here" is not a placement at the origin — it is no placement.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);

    await store.undoCanvas();

    expect(spotOf('n1')).toBeNull();
  });

  it('leaves a card alone when a peer has moved it since', async () => {
    /*
      The rule that makes this safe on shared data. The entry says it left the card at (400, 300);
      somebody else has since put it at (900, 900), so putting (10, 10) back would discard a change
      this agent never saw.
    */
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);

    const row = rowOf('n1')!;
    row.x = 900;
    row.y = 900;
    await store.undoCanvas();

    expect(spotOf('n1')).toEqual({ x: 900, y: 900 });
  });

  it('undoes a multi-card drag on one press', async () => {
    // Twelve cards dragged as one have to come back as one press. A stack that recorded them
    // separately would need twelve, which is not undo, it is counting.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 0, 0);
    await store.placeOnCanvas(CANVAS, 'n2', 'TaskBlock', 100, 0);

    await store.dragOnCanvas(CANVAS, {
      recordId: 'n1',
      recordType: 'TaskBlock',
      x: 0,
      y: 500,
      carried: [{ recordId: 'n2', recordType: 'TaskBlock', x: 100, y: 500 }],
    });
    expect(spotOf('n2')).toEqual({ x: 100, y: 500 });
    // One entry for the gesture, not one per card — which is what makes the single press below
    // restore both rather than half of them.
    expect(store.canvasHistory().undoLabel).toBe('move 2 cards');

    await store.undoCanvas();

    expect(spotOf('n1')).toEqual({ x: 0, y: 0 });
    expect(spotOf('n2')).toEqual({ x: 100, y: 0 });
  });

  it('forgets everything when the canvas changes', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);
    expect(store.canvasHistory().canUndo).toBe(true);

    store.scopeCanvasHistory('canvas-2');

    expect(store.canvasHistory().canUndo).toBe(false);
  });
});

describe('taking cards off a canvas', () => {
  it('removes a whole selection in one act, and puts it all back', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n2', 'TaskBlock', 20, 20);

    await store.removeFromCanvas(CANVAS, ['n1', 'n2']);
    expect(spotOf('n1')).toBeNull();
    expect(spotOf('n2')).toBeNull();

    await store.undoCanvas();

    expect(spotOf('n1')).toEqual({ x: 10, y: 10 });
    expect(spotOf('n2')).toEqual({ x: 20, y: 20 });
  });

  it('restores what each card was wearing, not just where it sat', async () => {
    // A placement carries the size, colour and shape too, so a restore that returned a card to the
    // right spot stripped of its presentation would be worse than not offering the undo.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.setCardStyle(CANVAS, 'n1', 'color', 'warning-500');

    await store.removeFromCanvas(CANVAS, 'n1');
    await store.undoCanvas();

    expect(rowOf('n1')?.color).toBe('warning-500');
  });

  it('takes one id as readily as a list', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);

    await store.removeFromCanvas(CANVAS, 'n1');

    expect(spotOf('n1')).toBeNull();
  });
});

describe('restyling a selection', () => {
  it('gives every card the value, and puts each one back to its own', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n2', 'TaskBlock', 20, 20);
    await store.setCardStyle(CANVAS, 'n1', 'color', 'primary-500');
    await store.setCardStyle(CANVAS, 'n2', 'color', 'success-500');

    await store.setCardStyle(CANVAS, ['n1', 'n2'], 'color', 'danger-500');
    const colourOf = (node: string) => rowOf(node)?.color;
    expect([colourOf('n1'), colourOf('n2')]).toEqual(['danger-500', 'danger-500']);

    await store.undoCanvas();

    expect([colourOf('n1'), colourOf('n2')]).toEqual(['primary-500', 'success-500']);
  });
});

describe('deleting records', () => {
  it('deletes every record in the list', async () => {
    const store = mount();

    await store.deleteRecords([
      { recordId: 'r1', recordType: 'TaskBlock' },
      { recordId: 'r2', recordType: 'EventBlock' },
    ]);

    expect(world.deleted).toEqual(['r1', 'r2']);
  });

  it('drops the undo history, rather than leaving entries that would resurrect a ghost', async () => {
    /*
      A move entry naming a deleted record would replay into nothing — or worse, write a placement
      for it and put a card nobody can open back on the canvas. Forgetting is cheaper and safer than
      filtering, and a delete is rare.
    */
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);
    expect(store.canvasHistory().canUndo).toBe(true);

    await store.deleteRecords([{ recordId: 'n1', recordType: 'TaskBlock' }]);

    expect(store.canvasHistory().canUndo).toBe(false);
  });

  it('ignores rows that name no record', async () => {
    const store = mount();

    await store.deleteRecords([{ recordId: '', recordType: 'TaskBlock' }, { recordType: 'TaskBlock' }, undefined!]);

    expect(world.deleted).toEqual([]);
  });
});
