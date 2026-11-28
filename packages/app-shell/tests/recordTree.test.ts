/**
 * The record store's tree part on its own, over the canvas and connection parts it writes through: a
 * drop onto another card moves the connection the card hangs by and seats it in its row, an undo puts
 * both back, and a drop that would put a card inside itself is refused in words.
 *
 * Run once under each reactivity port, against the in-memory backend holding the spine.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecordCanvas, type RecordCanvas } from '../src/shared/stores/records/canvas';
import { createRecordConnections } from '../src/shared/stores/records/connections';
import { canvasChildren, operationRunner } from '../src/shared/stores/records/context';
import { createRecordKinds } from '../src/shared/stores/records/kinds';
import { createRecordTree, type RecordTree } from '../src/shared/stores/records/tree';
import { reactivityPorts } from './support/engines';
import { testOperations } from './support/operations';

const CANVAS = 'canvas-1';
const SPINE = 'kind-1';
type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
    findOne(p: unknown, query: Record<string, unknown>): Promise<Row | null>;
  };

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  let handle: unknown;
  let said: string[];

  function build(): { tree: RecordTree; canvas: RecordCanvas } {
    const sessionStore = { me: () => ({ did: 'did:key:z6Mk' }) } as never;
    let built!: { tree: RecordTree; canvas: RecordCanvas };
    disposers.push(
      reactivity.root(() => {
        const context = {
          reactivity,
          toasts: {
            info: (m: string) => said.push(m),
            success: () => 0,
            warning: () => 0,
            error: (m: string) => said.push(m),
          },
          sessionStore,
          datasetStore: {
            currentDataset: () => ({ id: 'ds', handle, name: 'Space' }),
            currentDatasetEntities: () => [],
            datasets: () => [],
          } as never,
          operations: testOperations,
          runOp: operationRunner(sessionStore, testOperations),
        };
        const shapeStore = { spaceShapes: () => [] };
        const kinds = createRecordKinds({ ...context, shapeStore });
        const connections = createRecordConnections({ ...context, kinds });
        const canvas = createRecordCanvas({ ...context, connections, contentHome: (c) => c });
        built = { tree: createRecordTree({ ...context, shapeStore, kinds, connections, canvas }), canvas };
      }),
    );
    return built;
  }

  const link = (id: string, source: string, target: string) =>
    model('Relationship').create(
      handle,
      { relationshipTypeId: SPINE, source, target, sourceType: 'Card', targetType: 'Card' },
      { id },
    );
  const parentOf = async (card: string) =>
    (await model('Relationship').findAll(handle)).find((entry) => entry.target === card)?.source;
  const rankOf = async (card: string) =>
    ((await model('Placement').findOne(handle, { where: { id: `row-${card}` } }))?.rank as number | undefined) ?? 0;

  beforeEach(async () => {
    reactivity = makePort();
    said = [];
    const ports = createInMemoryBackendPorts(
      { selfId: () => 'did:key:z6Mk' },
      { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-tree', name: 'Tree' }] },
    );
    handle = (await ports.lifecycle.get('ds-tree'))!.handle;
    await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
    await link('pa', 'p', 'a');
    await link('pb', 'p', 'b');
    await link('qx', 'q', 'x');
    for (const [card, rank] of [['p'], ['q'], ['x'], ['a', 1024], ['b', 2048]] as [string, number?][])
      await model('Placement').create(
        handle,
        { nodeType: 'Card', node: card, ...(rank ? { rank } : {}) },
        { id: `row-${card}`, parent: canvasChildren(CANVAS) },
      );
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('moves a card under another, and puts it and its rank back on undo', async () => {
    const { tree, canvas } = build();
    await tree.arrangeOnTree(CANVAS, SPINE, {
      recordId: 'b',
      recordType: 'Card',
      into: 'child',
      targetId: 'x',
      targetType: 'Card',
      order: ['b'],
    });
    expect(await parentOf('b')).toBe('x');
    await canvas.undoCanvas(CANVAS);
    expect(await parentOf('b')).toBe('p');
    expect(await rankOf('b')).toBe(2048);
  });

  it('refuses to put a card inside itself, and says so', async () => {
    const { tree } = build();
    await tree.arrangeOnTree(CANVAS, SPINE, {
      recordId: 'q',
      recordType: 'Card',
      into: 'child',
      targetId: 'x',
      targetType: 'Card',
    });
    expect(said).toEqual(['That would put a card inside itself.']);
    expect(await parentOf('x')).toBe('q');
  });

  it('reorders a card among its siblings without touching its connection', async () => {
    const { tree } = build();
    await tree.arrangeOnTree(CANVAS, SPINE, {
      recordId: 'b',
      recordType: 'Card',
      into: 'sibling',
      targetId: 'a',
      targetType: 'Card',
      before: true,
      order: ['b', 'a'],
    });
    expect(await parentOf('b')).toBe('p');
    expect(await rankOf('b')).toBeLessThan(await rankOf('a'));
  });
});
