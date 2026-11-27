/**
 * Undoing what this agent did to a canvas.
 *
 * The data layer here is the in-memory backend holding `Placement` rows, because what is being tested is the
 * round trip through it: a move records where the card *was*, an undo writes that back, and a peer
 * who has moved the card in between is left alone. None of that is observable from the history
 * package on its own — it holds closures, and these are the closures.
 *
 * The rule under test is the one that makes undo safe on a shared, last-write-wins data layer:
 * **an undo is a new forward write, guarded by what it expects to find.** Not a rollback, and never
 * a snapshot of the whole canvas.
 */
import { render } from '@solidjs/testing-library';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CANVAS = 'canvas-1';

type Row = Record<string, unknown> & { id: string };
type Model = {
  create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
  findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  findOne(p: unknown, query: Record<string, unknown>): Promise<Row | null>;
  update(p: unknown, id: string, data: Record<string, unknown>): Promise<unknown>;
};
const model = (name: string) => getEntity(name) as unknown as Model;

/*
  The in-memory backend, the reference, holds the placements: the canvas writes are declared
  operations run by the real runner, so a stand-in would only test itself.
*/
let handle: unknown;
const datasetStub = {
  currentDataset: () => ({ id: 'ds', handle, name: 'Space' }),
  datasets: () => [],
  personalDataset: () => null,
  currentDatasetEntities: () => [],
};

/*
  The decision `bringOne` delegates to, stubbed so `dropOnCanvas`'s "from another space" branch
  actually reaches its placement. Without it the branch returns null and the test below would pass
  because nothing happened at all, which is the sort of green that means nothing.
*/
vi.mock('../src/shared/bringIn', () => ({
  bringIn: async () => ({ id: 'brought-1', entity: 'TaskBlock', mode: 'copy', from: '' }),
}));

vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({ useDatasetStore: () => datasetStub }));
vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:key:z6Mk' }) }),
}));
vi.mock('../src/frameworks/solid/stores/ShapeStore', () => ({
  useShapeStore: () => ({
    spaceShapes: () => [],
    interpretationCandidates: () => [],
    interpretationCandidatesLoaded: () => true,
  }),
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
  return store;
}

const placements = () =>
  model('Placement').findAll(handle, { parent: { id: CANVAS, relation: 'children', entity: 'CollectionBlock' } });

/** The row a node's card is drawn from. */
const rowOf = async (nodeId: string) => (await placements()).find((entry) => entry.node === nodeId);

/** Where a node's card currently sits. */
const spotOf = async (nodeId: string) => {
  const row = await rowOf(nodeId);
  return row ? { x: row.x, y: row.y } : null;
};

/** A peer's write, straight to the backend rather than through the store — so it records no entry here. */
const peer = async (nodeId: string, fields: Record<string, unknown>) =>
  model('Placement').update(handle, (await rowOf(nodeId))!.id, fields);

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:key:z6Mk' },
    { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-canvas', name: 'Canvas' }] },
  );
  handle = (await ports.lifecycle.get('ds-canvas'))!.handle;
  await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
});

describe('undoing a move', () => {
  it('puts the card back where it was', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);
    expect(await spotOf('n1')).toEqual({ x: 400, y: 300 });

    await store.undoCanvas(CANVAS);

    expect(await spotOf('n1')).toEqual({ x: 10, y: 10 });
    expect(store.canvasHistory().canRedo).toBe(true);
  });

  it('puts it forward again on redo', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);
    await store.undoCanvas(CANVAS);

    await store.redoCanvas(CANVAS);

    expect(await spotOf('n1')).toEqual({ x: 400, y: 300 });
  });

  it('takes a card off the canvas again when it was not on it before', async () => {
    // The undo of "this was dropped here" is not a placement at the origin — it is no placement.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);

    await store.undoCanvas(CANVAS);

    expect(await spotOf('n1')).toBeNull();
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

    await peer('n1', { x: 900, y: 900 });
    await store.undoCanvas(CANVAS);

    expect(await spotOf('n1')).toEqual({ x: 900, y: 900 });
  });

  // A card only an opening put on the canvas — a note's blocks — written as a placement joined the
  // canvas in its own right, and stayed behind, cut off, when the note closed.
  it('writes nothing for a card that is on the canvas only because its parent was opened', async () => {
    const store = mount();
    await store.dragOnCanvas(CANVAS, { recordId: 'b1', recordType: 'TextBlock', x: 40, y: 40, opened: true });
    expect(await spotOf('b1')).toBeNull();
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
    expect(await spotOf('n2')).toEqual({ x: 100, y: 500 });
    // One entry for the gesture, not one per card — which is what makes the single press below
    // restore both rather than half of them.
    expect(store.canvasHistory().undoLabel).toBe('move 2 cards');

    await store.undoCanvas(CANVAS);

    expect(await spotOf('n1')).toEqual({ x: 0, y: 0 });
    expect(await spotOf('n2')).toEqual({ x: 100, y: 0 });
  });

  it('replays nothing once another canvas is the one being asked about', async () => {
    /*
      The canvas travels with the press rather than being set separately, which is what makes this
      impossible to get wrong: there is no "point the stack here" call for a template to forget, and
      a press on another canvas cannot reach an entry belonging to this one.
    */
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 400, 300);
    expect(store.canvasHistory().canUndo).toBe(true);

    await store.undoCanvas('canvas-2');

    expect(await spotOf('n1')).toEqual({ x: 400, y: 300 });
    expect(store.canvasHistory().canUndo).toBe(false);
  });
});

describe('taking cards off a canvas', () => {
  it('removes a whole selection in one act, and puts it all back', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n2', 'TaskBlock', 20, 20);

    await store.removeFromCanvas(CANVAS, ['n1', 'n2']);
    expect(await spotOf('n1')).toBeNull();
    expect(await spotOf('n2')).toBeNull();

    await store.undoCanvas(CANVAS);

    expect(await spotOf('n1')).toEqual({ x: 10, y: 10 });
    expect(await spotOf('n2')).toEqual({ x: 20, y: 20 });
  });

  it('restores what each card was wearing, not just where it sat', async () => {
    // A placement carries the size, colour and shape too, so a restore that returned a card to the
    // right spot stripped of its presentation would be worse than not offering the undo.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.setCardStyle(CANVAS, 'n1', 'color', 'warning-500');

    await store.removeFromCanvas(CANVAS, 'n1');
    await store.undoCanvas(CANVAS);

    expect((await rowOf('n1'))?.color).toBe('warning-500');
  });

  it('takes one id as readily as a list', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);

    await store.removeFromCanvas(CANVAS, 'n1');

    expect(await spotOf('n1')).toBeNull();
  });
});

describe('restyling a selection', () => {
  it('gives every card the value, and puts each one back to its own', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.placeOnCanvas(CANVAS, 'n2', 'TaskBlock', 20, 20);
    await store.setCardStyle(CANVAS, 'n1', 'color', 'accent-500');
    await store.setCardStyle(CANVAS, 'n2', 'color', 'success-500');

    await store.setCardStyle(CANVAS, ['n1', 'n2'], 'color', 'danger-500');
    const colours = async () => [(await rowOf('n1'))?.color, (await rowOf('n2'))?.color];
    expect(await colours()).toEqual(['danger-500', 'danger-500']);

    await store.undoCanvas(CANVAS);

    expect(await colours()).toEqual(['accent-500', 'success-500']);
  });
});

describe('restyling one card', () => {
  it('undoes a shape change', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.setCardStyle(CANVAS, 'n1', 'cardShape', 'note');

    expect((await rowOf('n1'))?.cardShape).toBe('note');
    expect(store.canvasHistory().canUndo).toBe(true);

    await store.undoCanvas(CANVAS);

    expect((await rowOf('n1'))?.cardShape).toBe('we:unset');
  });

  it('undoes a resize, putting back all four fields it wrote', async () => {
    /*
      A resize writes a width, a height and both coordinates as one act — the position travels with
      the size because resizing from one edge has to hold the other still. A baseline that carried
      only the first of those would put back a card of the right size in the wrong place.
    */
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.setCardStyle(CANVAS, 'n1', 'width', 120);
    await store.setCardStyle(CANVAS, 'n1', 'height', 90);

    await store.resizeOnCanvas(CANVAS, { recordId: 'n1', width: 300, height: 200, x: 60, y: 50 });
    expect(await rowOf('n1')).toMatchObject({ width: 300, height: 200, x: 60, y: 50 });
    expect(store.canvasHistory().undoLabel).toBe('resize card');

    await store.undoCanvas(CANVAS);

    expect(await rowOf('n1')).toMatchObject({ width: 120, height: 90, x: 10, y: 10 });
  });

  it('returns a card to having no shape of its own', async () => {
    // "Back to nothing" has to be sayable: an empty string is what the ORM's update skips, so the
    // way back is the sentinel the canvas seed drops.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.setCardStyle(CANVAS, 'n1', 'cardShape', 'note');

    await store.undoCanvas(CANVAS);

    expect((await rowOf('n1'))?.cardShape).toBe('we:unset');
  });
});

describe('a peer who changed the same card', () => {
  /*
    The rule that keeps one agent's undo from overwriting another's work. Moves were guarded from
    the start; the presentation writes were not, which meant recolouring a card, a peer recolouring
    it, and pressing Ctrl+Z put your colour back over theirs.
  */
  it('keeps their colour rather than putting yours back', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.setCardStyle(CANVAS, 'n1', 'color', 'accent-500');

    await peer('n1', { color: 'success-500' });
    await store.undoCanvas(CANVAS);

    expect((await rowOf('n1'))?.color).toBe('success-500');
  });

  it('keeps their size rather than redoing yours', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.resizeOnCanvas(CANVAS, { recordId: 'n1', width: 300, height: 200, x: 10, y: 10 });
    await store.undoCanvas(CANVAS);

    await peer('n1', { width: 555 });
    await store.redoCanvas(CANVAS);

    expect((await rowOf('n1'))?.width).toBe(555);
  });

  it('refuses all four fields of a resize when one of them has moved', async () => {
    // All or nothing per card: putting half a resize back leaves a card at the old size in the new
    // place, which is a worse answer than leaving it alone.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.resizeOnCanvas(CANVAS, { recordId: 'n1', width: 300, height: 200, x: 60, y: 50 });

    await peer('n1', { height: 999 });
    await store.undoCanvas(CANVAS);

    expect(await rowOf('n1')).toMatchObject({ width: 300, x: 60, y: 50 });
  });

  it('does not put a card back on the canvas they have already restored', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await store.removeFromCanvas(CANVAS, 'n1');

    /*
      The peer's write goes straight to the backend rather than through the store, which is what
      makes it somebody *else's*: a placement made through the store would record an entry of its
      own and the undo below would replay that one instead.
    */
    await model('Placement').create(
      handle,
      { nodeType: 'TaskBlock', x: 400, y: 400, node: ['n1'] },
      { id: 'peer-row', parent: { id: CANVAS, relation: 'children', entity: 'CollectionBlock' } },
    );
    await store.undoCanvas(CANVAS);

    // One row, theirs — not a second one beside it disagreeing about where the card is.
    expect(await placements()).toEqual([expect.objectContaining({ id: 'peer-row', node: 'n1', x: 400, y: 400 })]);
  });

  it('still lets a fresh gesture decide, whatever a peer did', async () => {
    // Only a *replay* carries an expectation. Choosing a colour now is somebody deciding now.
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await peer('n1', { color: 'success-500' });

    await store.setCardStyle(CANVAS, 'n1', 'color', 'danger-500');

    expect((await rowOf('n1'))?.color).toBe('danger-500');
  });
});

describe('records being made', () => {
  /*
    The history is arrangement only, and a creation is not arrangement. An entry for one would undo
    by removing the placement — leaving the new record behind, and, where the canvas owns it, parked
    back in the corner by the tray. Both creating paths write their placement without recording one.
  */
  it('leaves no entry for a record brought in from another space', async () => {
    const store = mount();
    await store.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    // A restyle, so the label on top is one a stray placement entry could not be mistaken for —
    // two "move card" entries look identical and the assertion below would hold either way.
    await store.setCardStyle(CANVAS, 'n1', 'color', 'accent-500');
    expect(store.canvasHistory().undoLabel).toBe('restyle card');

    await store.dropOnCanvas(CANVAS, { entity: 'TaskBlock', id: 'n2', dataset: 'elsewhere', x: 5, y: 5 });

    // It really was placed — the branch ran — and it still recorded nothing.
    expect(await spotOf('brought-1')).toEqual({ x: 5, y: 5 });
    expect(store.canvasHistory().undoLabel).toBe('restyle card');
  });

  it('still records a record that was only placed, which is an arrangement act', async () => {
    const store = mount();

    await store.dropOnCanvas(CANVAS, { entity: 'TaskBlock', id: 'n2', x: 5, y: 5 });

    expect(store.canvasHistory().undoLabel).toBe('move card');
  });
});

describe('deleting records', () => {
  it('deletes every record in the list', async () => {
    const store = mount();
    await model('TaskBlock').create(handle, { title: 'One' }, { id: 'r1' });
    await model('EventBlock').create(handle, { title: 'Two', startDate: '2026-11-24' }, { id: 'r2' });

    await store.deleteRecords([
      { recordId: 'r1', recordType: 'TaskBlock' },
      { recordId: 'r2', recordType: 'EventBlock' },
    ]);

    expect(await model('TaskBlock').findOne(handle, { where: { id: 'r1' } })).toBeNull();
    expect(await model('EventBlock').findOne(handle, { where: { id: 'r2' } })).toBeNull();
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
    await model('TaskBlock').create(handle, { title: 'One' }, { id: 'r1' });

    await store.deleteRecords([{ recordId: '', recordType: 'TaskBlock' }, { recordType: 'TaskBlock' }, undefined!]);

    expect(await model('TaskBlock').findAll(handle)).toHaveLength(1);
  });
});
