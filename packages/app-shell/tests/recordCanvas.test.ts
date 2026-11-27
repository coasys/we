/**
 * The record store's canvas part on its own: a card's look drawn before its write lands and let go of
 * when the write fails, a move undone, a route made and taken away, and a type's colour cleared without
 * making a style for nothing.
 *
 * Run once under each reactivity port, against the in-memory backend holding the canvas.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity, registerEntityWriteCheck } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecordCanvas, type RecordCanvas } from '../src/shared/stores/records/canvas';
import { createRecordConnections } from '../src/shared/stores/records/connections';
import { canvasChildren, operationRunner } from '../src/shared/stores/records/context';
import { createRecordKinds } from '../src/shared/stores/records/kinds';

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const CANVAS = 'canvas-1';
type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  };

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  let handle: unknown;
  let errors: string[];

  function build(): RecordCanvas {
    const sessionStore = { me: () => ({ did: 'did:key:z6Mk' }) } as never;
    let canvas!: RecordCanvas;
    disposers.push(
      reactivity.root(() => {
        const context = {
          reactivity,
          toasts: { info: () => 0, success: () => 0, warning: () => 0, error: (m: string) => errors.push(m) },
          sessionStore,
          datasetStore: {
            currentDataset: () => ({ id: 'ds', handle, name: 'Space' }),
            currentDatasetEntities: () => [],
            datasets: () => [],
          } as never,
          runOp: operationRunner(sessionStore),
        };
        const kinds = createRecordKinds({ ...context, shapeStore: { spaceShapes: () => [] } });
        const connections = createRecordConnections({ ...context, kinds });
        canvas = createRecordCanvas({ ...context, connections, contentHome: (c) => c });
      }),
    );
    return canvas;
  }

  const placements = () => model('Placement').findAll(handle, { parent: canvasChildren(CANVAS) });

  beforeEach(async () => {
    reactivity = makePort();
    errors = [];
    const ports = createInMemoryBackendPorts(
      { selfId: () => 'did:key:z6Mk' },
      { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-canvas', name: 'Canvas' }] },
    );
    handle = (await ports.lifecycle.get('ds-canvas'))!.handle;
    await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
  });

  afterEach(() => {
    registerEntityWriteCheck(null);
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('draws a colour from the gesture, before the write lands', async () => {
    const canvas = build();
    await canvas.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    const writing = canvas.setCardStyle(CANVAS, 'n1', 'color', 'red');
    expect(canvas.pendingCardStyle().n1).toMatchObject({ color: 'red' });
    await writing;
    expect((await placements())[0].color).toBe('red');
  });

  it('lets go of a look whose write failed, and says so', async () => {
    const canvas = build();
    await canvas.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    registerEntityWriteCheck((write) => {
      if (write.entity === 'Placement' && write.kind === 'edit')
        throw Object.assign(new Error('refused'), { name: 'PolicyRefusal' });
    });
    await canvas.setCardStyle(CANVAS, 'n1', 'color', 'red');
    expect(canvas.pendingCardStyle().n1?.color).toBeUndefined();
    expect(errors).toEqual(['Could not save that.']);
    expect(canvas.canvasHistory().canUndo).toBe(true); // the placement, not the failed colour
  });

  it('undoes a move as one entry, and records none for a move the data refused', async () => {
    const canvas = build();
    await canvas.placeOnCanvas(CANVAS, 'n1', 'TaskBlock', 10, 10);
    await canvas.dragOnCanvas(CANVAS, { recordId: 'n1', recordType: 'TaskBlock', x: 400, y: 300 });
    await canvas.undoCanvas(CANVAS);
    expect((await placements()).map((row) => [row.x, row.y])).toEqual([[10, 10]]);
    await canvas.dragOnCanvas(CANVAS, { recordId: 'n1', recordType: 'TaskBlock', x: 5, y: 5, opened: true });
    expect(canvas.canvasHistory().canRedo).toBe(true);
  });

  it('makes a route for a bend, and takes it away when the line is straightened', async () => {
    const canvas = build();
    const routes = () => model('EdgeRoute').findAll(handle, { parent: canvasChildren(CANVAS) });
    await canvas.rerouteOnCanvas(CANVAS, { recordId: 'c1', points: [{ along: 0.5, across: 0.2 }] });
    expect(await routes()).toHaveLength(1);
    await canvas.rerouteOnCanvas(CANVAS, { recordId: 'c1', points: [] });
    expect(await routes()).toHaveLength(0);
  });

  it('clears a type’s colour without making a style where there was none', async () => {
    const canvas = build();
    const styles = () => model('TypeStyle').findAll(handle, { parent: canvasChildren(CANVAS) });
    await canvas.setTypeColor(CANVAS, 'TaskBlock', '');
    expect(await styles()).toEqual([]);
    await canvas.setTypeColor(CANVAS, 'TaskBlock', { detail: '#f00' });
    expect((await styles()).map((row) => row.color)).toEqual(['#f00']);
    expect(errors).toEqual([]);
  });
});
