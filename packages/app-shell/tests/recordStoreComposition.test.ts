/**
 * The record store composed whole, as `composeStores` builds it, under each reactivity port: no part
 * reads a later one while the store is being built, every part's members are on the one store, the
 * parts reach each other through it (a form's write is placed by the canvas part), and where content
 * with no other home lives is what the space store lends — until the lender takes it back.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestPlatform } from '../src/shared/platform/testPlatform';
import { createRecordStore, type RecordStore } from '../src/shared/stores/RecordStore';
import { reactivityPorts } from './support/engines';
import { testOperations } from './support/operations';

const ME = 'did:key:z6MkRecordComposition';
const CANVAS = 'canvas-1';
const HOME = 'space-root';

type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  };
const childrenOf = (id: string) => ({ parent: { id, relation: 'children', entity: 'CollectionBlock' } });

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  let handle: unknown;

  beforeEach(async () => {
    const ports = createInMemoryBackendPorts(
      { selfId: () => ME },
      { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-records', name: 'Records' }] },
    );
    handle = (await ports.lifecycle.get('ds-records'))!.handle;
    await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
    await model('CollectionBlock').create(handle, { kind: 'space' }, { id: HOME });
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  function build(): RecordStore {
    const reactivity = makePort();
    let store!: RecordStore;
    disposers.push(
      reactivity.root(() => {
        store = createRecordStore({
          operations: testOperations,
          reactivity,
          toasts: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0 },
          sessionStore: { me: () => ({ did: ME }) } as never,
          datasetStore: {
            currentDataset: () => ({ id: 'ds-records', handle, name: 'Records' }),
            currentDatasetEntities: () => [],
            datasets: () => [],
          } as never,
          shapeStore: { spaceShapes: () => [] },
          platform: createTestPlatform(),
        });
      }),
    );
    return store;
  }

  async function make(store: RecordStore, title: string, canvas?: string): Promise<string> {
    if (canvas) store.createOnCanvas(canvas, 40, 40);
    else store.openRecordForm('TaskBlock');
    store.setRecordEntity('TaskBlock');
    store.setRecordField('title', title);
    await store.saveRecord();
    return store.lastCreatedId();
  }

  const titlesIn = async (id: string) =>
    (await model('TaskBlock').findAll(handle, childrenOf(id))).map((row) => row.title).sort();

  it('builds whole, with every part’s members on the one store', () => {
    const store = build();
    for (const member of [
      'creatableEntities', // kinds
      'rekeyConnection', // connections
      'placeOnCanvas', // the canvas
      'arrangeOnTree', // the tree
      'saveRecord', // forms
      'dropOnCanvas', // drops
      'provideContentHomes',
      'provideVocabularies',
    ] as const) {
      expect(store[member], member).toBeTypeOf('function');
    }
  });

  it('places what a form makes on a canvas through the canvas part', async () => {
    const store = build();
    await make(store, 'On the canvas', CANVAS);
    expect(await titlesIn(CANVAS)).toEqual(['On the canvas']);
    const placed = await model('Placement').findAll(handle, childrenOf(CANVAS));
    expect(placed.map((row) => [row.x, row.y])).toEqual([[40, 40]]);
  });

  it('puts content with no other home where it is lent to, and stops once the lender takes it back', async () => {
    const store = build();
    const takeBack = store.provideContentHomes({
      forCanvas: (canvas) => (canvas === CANVAS ? HOME : canvas),
      root: () => HOME,
    });
    await make(store, 'Loose');
    await make(store, 'Drawn on the space canvas', CANVAS);
    expect(await titlesIn(HOME)).toEqual(['Drawn on the space canvas', 'Loose']);
    expect(await titlesIn(CANVAS)).toEqual([]);

    takeBack();
    await make(store, 'After');
    expect(await titlesIn(HOME)).toEqual(['Drawn on the space canvas', 'Loose']);
    expect(await model('TaskBlock').findAll(handle, { where: { title: 'After' } })).toHaveLength(1);
  });
});
