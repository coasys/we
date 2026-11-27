/**
 * The record store's drops part on its own: a record of this space dropped on a canvas is placed and
 * can be taken back, a thing that is not a record here is refused in words, and a post from a space
 * this agent does not hold arrives as a quote with an undo.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecordCanvas, type RecordCanvas } from '../src/shared/stores/records/canvas';
import { createRecordConnections } from '../src/shared/stores/records/connections';
import { canvasChildren, operationRunner } from '../src/shared/stores/records/context';
import { createRecordDrops, type RecordDrops } from '../src/shared/stores/records/drops';
import { createRecordKinds } from '../src/shared/stores/records/kinds';
import { reactivityPorts } from './support/engines';

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
  let said: string[];

  function build(): { drops: RecordDrops; canvas: RecordCanvas } {
    const sessionStore = { me: () => ({ did: 'did:key:z6Mk' }) } as never;
    let built!: { drops: RecordDrops; canvas: RecordCanvas };
    disposers.push(
      reactivity.root(() => {
        const context = {
          reactivity,
          toasts: {
            info: () => 0,
            success: (m: string) => said.push(m),
            warning: () => 0,
            error: (m: string) => said.push(m),
          },
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
        const canvas = createRecordCanvas({ ...context, connections, contentHome: (c) => c });
        built = { drops: createRecordDrops({ ...context, kinds, canvas, contentHome: (c) => c }), canvas };
      }),
    );
    return built;
  }

  const placements = () => model('Placement').findAll(handle, { parent: canvasChildren(CANVAS) });

  beforeEach(async () => {
    reactivity = makePort();
    said = [];
    const ports = createInMemoryBackendPorts(
      { selfId: () => 'did:key:z6Mk' },
      { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-drops', name: 'Drops' }] },
    );
    handle = (await ports.lifecycle.get('ds-drops'))!.handle;
    await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('places a record of this space where it landed, and takes it off again on undo', async () => {
    const { drops, canvas } = build();
    await drops.dropOnCanvas(CANVAS, { entity: 'TaskBlock', id: 't1', x: 40, y: 50 });
    expect((await placements()).map((row) => [row.node, row.x, row.y])).toEqual([['t1', 40, 50]]);
    await canvas.undoCanvas(CANVAS);
    expect(await placements()).toEqual([]);
  });

  it('refuses a thing that is not a record here', async () => {
    const { drops } = build();
    await drops.dropOnCanvas(CANVAS, { entity: 'Agent', id: 'did:key:z6Other', x: 0, y: 0 });
    expect(said).toEqual(['That is not something a canvas can hold.']);
    expect(await placements()).toEqual([]);
  });

  it('quotes a post from a space this agent does not hold, offering an undo', async () => {
    const { drops } = build();
    await drops.bringIn({
      items: [
        { ref: { entity: 'CollectionBlock', id: 'elsewhere-post', dataset: 'n:another-space' }, label: 'Their post' },
      ],
    });
    expect(said).toEqual(['Quoted here']);
    const posts = (await model('CollectionBlock').findAll(handle)).filter((row) => row.kind === 'post');
    expect(posts).toHaveLength(1);
  });

  it('leaves a thing already in this space alone', async () => {
    const { drops } = build();
    await drops.bringIn({ items: [{ ref: { entity: 'CollectionBlock', id: CANVAS, dataset: 'p:ds' } }] });
    expect(said).toEqual([]);
  });
});
