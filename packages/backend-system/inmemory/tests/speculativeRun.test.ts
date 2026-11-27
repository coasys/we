/**
 * A speculative run against the reference backend: it writes nothing, predicts the writes the real
 * run then makes with the same ids, reads what is still pending, and predicts nothing when the run
 * would fail.
 */
import {
  bindPredictions,
  createPredictions,
  getEntity,
  onSpeculationMiss,
  runOperation,
  Signal as SignalProxy,
  speculateOperation,
  withPredictedPages,
} from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ME = 'did:test:me';

interface Row {
  id: string;
  [field: string]: unknown;
}
type Model = {
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
  query(d: unknown, q?: Record<string, unknown>): ReturnType<typeof withPredictedPages<Row>>;
};
const Collection = () => getEntity('CollectionBlock') as unknown as Model;
// The entity as the app reaches it, whose reads draw what is pending.
const Signal = () => SignalProxy as unknown as Model;

let dataset: unknown;
let post: Row;
// The host's predictions, bound to the entity stand-ins as a composition binds its own.
const predictions = createPredictions();
let unbind: () => void;

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-speculate', name: 'Speculate' }] },
  );
  dataset = (await ports.lifecycle.get('ds-speculate'))!.handle;
  post = await Collection().create(dataset, { kind: 'post' });
  unbind = bindPredictions(predictions);
});
afterEach(() => {
  predictions.clear();
  unbind();
});

const invocation = (id: string) => ({
  dataset,
  invoker: ME,
  invocationId: id,
  invokedAt: '2026-11-26T10:00:00.000Z',
  predictions,
});
const signalsOn = () => Signal().findAll(dataset, { parent: { id: post.id, relation: 'signals' } });

describe('speculateOperation', () => {
  it('writes nothing, and predicts the create the real run then makes with the same id', async () => {
    const args = { node: post.id, signalType: 'like', value: 1 };
    const { writes } = await speculateOperation('core.upsertSignal', args, invocation('inv-1'));
    expect(await signalsOn()).toEqual([]);
    expect(writes).toMatchObject([
      {
        kind: 'create',
        entity: 'Signal',
        fields: { signalTypeId: 'like', value: 1, author: ME },
        parent: { id: post.id, relation: 'signals' },
      },
    ]);
    await runOperation('core.upsertSignal', args, invocation('inv-1'));
    const [made] = await signalsOn();
    expect(made.id).toBe((writes[0] as { id: string }).id);
  });

  it('predicts nothing for a run that fails on a precondition', async () => {
    await expect(
      speculateOperation('core.setInvolvement', { node: post.id, agent: ME, kind: 'nope', on: true }, invocation('i')),
    ).rejects.toMatchObject({ class: 'precondition', code: 'unknownKind', declared: true });
  });

  it('reads the predictions still pending, so a second press is predicted from the first', async () => {
    const first = await speculateOperation(
      'core.upsertSignal',
      { node: post.id, signalType: 'like', value: 1 },
      invocation('inv-1'),
    );
    predictions.predict(dataset, 'inv-1', first.writes);
    const second = await speculateOperation(
      'core.withdrawSignal',
      { node: post.id, signalType: 'like' },
      invocation('inv-2'),
    );
    expect(second.writes).toEqual([{ kind: 'delete', entity: 'Signal', id: (first.writes[0] as { id: string }).id }]);
  });

  it('is drawn in a live read until the real row of the same id replaces it', async () => {
    const live = Signal().query(dataset, { parent: { id: post.id, relation: 'signals' } });
    await live.first;
    const args = { node: post.id, signalType: 'like', value: 1 };
    const { writes } = await speculateOperation('core.upsertSignal', args, invocation('inv-1'));
    predictions.predict(dataset, 'inv-1', writes);
    const id = (writes[0] as { id: string }).id;
    expect(live.getSnapshot().data?.results.map((r) => r.id)).toEqual([id]);
    await runOperation('core.upsertSignal', args, invocation('inv-1'));
    predictions.landed('inv-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [row] = live.getSnapshot().data?.results ?? [];
    expect(row).toMatchObject({ id, value: 1, author: ME });
    live.dispose();
  });

  it('reports a read nothing held answered, to a listener only while one is set', async () => {
    const misses: unknown[] = [];
    onSpeculationMiss((miss) => misses.push(miss));
    try {
      await speculateOperation('core.upsertSignal', { node: post.id, signalType: 'like', value: 1 }, invocation('i1'));
    } finally {
      onSpeculationMiss(null);
    }
    expect(misses).toContainEqual(expect.objectContaining({ operation: 'core.upsertSignal', entity: 'Signal' }));
    const before = misses.length;
    await speculateOperation('core.upsertSignal', { node: post.id, signalType: 'like', value: 1 }, invocation('i2'));
    expect(misses).toHaveLength(before);
  });
});
