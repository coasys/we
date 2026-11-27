/**
 * The record store's connections part: a line drawn from the moment it is drawn and never when its
 * write will be refused, and keyed by its ends' titles as they read now.
 *
 * Run once under each reactivity port, against the in-memory backend holding the connections.
 */
import { createInMemoryBackendPorts, runInMemoryTransaction } from '@we/backend-inmemory';
import {
  clearPredictions,
  getEntity,
  predictionsFor,
  registerEntityWriteCheck,
  registerTransactionRunner,
} from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecordConnections, type RecordConnections } from '../src/shared/stores/records/connections';
import { operationRunner } from '../src/shared/stores/records/context';
import { createRecordKinds } from '../src/shared/stores/records/kinds';
import { reactivityPorts } from './support/engines';

/** Hold every write until `land`, as a round trip would; put back after each test. */
function holdWrites(): () => void {
  let land!: () => void;
  const landed = new Promise<void>((resolve) => (land = resolve));
  registerTransactionRunner((ds, fn) => landed.then(() => runInMemoryTransaction(ds, fn)));
  return land;
}

type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findOne(p: unknown, query: Record<string, unknown>): Promise<Row | null>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  };

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  let handle: unknown;

  function build(): RecordConnections {
    const sessionStore = { me: () => ({ did: 'did:key:z6Mk' }) } as never;
    let connections!: RecordConnections;
    disposers.push(
      reactivity.root(() => {
        const context = {
          reactivity,
          toasts: { info: () => 0, success: () => 0, warning: () => 0, error: () => 0 },
          sessionStore,
          datasetStore: {
            currentDataset: () => ({ id: 'ds', handle, name: 'Space' }),
            currentDatasetEntities: () => [],
            datasets: () => [],
          } as never,
          runOp: operationRunner(sessionStore),
        };
        const kinds = createRecordKinds({ ...context, shapeStore: { spaceShapes: () => [] } });
        connections = createRecordConnections({ ...context, kinds });
      }),
    );
    return connections;
  }

  beforeEach(async () => {
    reactivity = makePort();
    const ports = createInMemoryBackendPorts(
      { selfId: () => 'did:key:z6Mk' },
      { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-links', name: 'Links' }] },
    );
    handle = (await ports.lifecycle.get('ds-links'))!.handle;
    await model('TaskBlock').create(handle, { title: 'Launch' }, { id: 't1' });
    await model('TaskBlock').create(handle, { title: 'Guide' }, { id: 't2' });
  });

  afterEach(() => {
    registerEntityWriteCheck(null);
    registerTransactionRunner(runInMemoryTransaction);
    clearPredictions();
    for (const dispose of disposers.splice(0)) dispose();
  });

  const ends = { source: 't1', sourceType: 'TaskBlock', target: 't2', targetType: 'TaskBlock' };

  it('keys a connection by its ends’ titles and its label', async () => {
    const connections = build();
    const key = await connections.keyFor(
      handle,
      { id: 't1', type: 'TaskBlock' },
      { id: 't2', type: 'TaskBlock' },
      'blocks',
    );
    expect(key).toBe('Launch → Guide: blocks');
    // A record of no kind this space has is named by its id.
    expect(await connections.keyFor(handle, { id: 'x', type: 'Nothing' }, { id: 't2', type: 'TaskBlock' })).toBe(
      'x → Guide',
    );
  });

  it('draws a line from the gesture, with the id the write then gives it', async () => {
    const connections = build();
    const land = holdWrites();
    const writing = connections.connect(handle, ends);
    for (let i = 0; i < 40 && !predictionsFor(handle).length; i++) await new Promise((r) => setTimeout(r, 0));
    const [drawn] = predictionsFor(handle).flatMap((p) => p.writes);
    expect(drawn).toMatchObject({ kind: 'create', entity: 'Relationship', fields: { source: 't1', target: 't2' } });
    land();
    expect(await writing).toBe((drawn as { id: string }).id);
  });

  it('never draws a line whose write is refused, and says so to the caller', async () => {
    const connections = build();
    registerEntityWriteCheck((write) => {
      if (write.entity === 'Relationship' && write.kind === 'create')
        throw Object.assign(new Error('refused'), { name: 'PolicyRefusal' });
    });
    await expect(connections.connect(handle, ends)).rejects.toThrow();
    expect(predictionsFor(handle)).toEqual([]);
  });

  it('rekeys a connection after a record it joins is renamed', async () => {
    const connections = build();
    const id = await connections.connect(handle, ends, { key: 'Launch → Guide' });
    const task = (await model('TaskBlock').findOne(handle, { where: { id: 't1' } })) as Row & { save(): Promise<void> };
    task.title = 'Lift-off';
    await task.save();
    await connections.rekeyConnectionsOf(handle, 't1');
    expect((await model('Relationship').findOne(handle, { where: { id } }))?.connection).toBe('Lift-off → Guide');
  });
});
