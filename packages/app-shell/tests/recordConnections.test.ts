/**
 * The record store's connections part: a line held from the moment it is drawn until the graph draws
 * it, let go of when its write fails, and keyed by its ends' titles as they read now.
 *
 * Run once under each reactivity port, against the in-memory backend holding the connections.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity, registerEntityWriteCheck } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecordConnections, type RecordConnections } from '../src/shared/stores/records/connections';
import { operationRunner } from '../src/shared/stores/records/context';
import { createRecordKinds } from '../src/shared/stores/records/kinds';

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

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

  it('draws a line until the graph draws it, then lets it go', async () => {
    const connections = build();
    const writing = connections.withHold({ kind: 'added', source: 't1', target: 't2' }, () =>
      connections.connect(handle, ends),
    );
    expect(connections.pendingConnections().added).toEqual([expect.objectContaining({ source: 't1', target: 't2' })]);
    const id = await writing;
    expect(id).toBeTruthy();
    connections.observeConnections([{ id, source: 't1', target: 't2' }]);
    expect(connections.pendingConnections().added).toEqual([]);
  });

  it('lets go of a line whose write failed, and says so to the caller', async () => {
    const connections = build();
    registerEntityWriteCheck((write) => {
      if (write.entity === 'Relationship' && write.kind === 'create')
        throw Object.assign(new Error('refused'), { name: 'PolicyRefusal' });
    });
    await expect(
      connections.withHold({ kind: 'added', source: 't1', target: 't2' }, () => connections.connect(handle, ends)),
    ).rejects.toThrow();
    expect(connections.pendingConnections().added).toEqual([]);
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
