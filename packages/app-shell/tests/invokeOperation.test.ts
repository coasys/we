/**
 * The host's one way to run an operation: the speculative run drawn before the real one lands, the
 * `serial` queue, and a failure said once.
 */
import { createInMemoryBackendPorts, runInMemoryTransaction } from '@we/backend-inmemory';
import {
  clearPredictions,
  CollectionBlock,
  getEntity,
  predictionsFor,
  registerTransactionRunner,
  Signal,
} from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { invokeOperation } from '../src/shared/invokeOperation';

const ME = 'did:test:me';

interface Row {
  id: string;
  [field: string]: unknown;
}

let dataset: unknown;
let post: Row;

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-invoke', name: 'Invoke' }] },
  );
  dataset = (await ports.lifecycle.get('ds-invoke'))!.handle;
  post = (await (CollectionBlock as unknown as { create: (d: unknown, f: object) => Promise<Row> }).create(dataset, {
    kind: 'post',
  })) as Row;
});
afterEach(() => clearPredictions());

const signalsOn = () =>
  (Signal as unknown as { findAll: (d: unknown, q: object) => Promise<Row[]> }).findAll(dataset, {
    parent: { id: post.id, relation: 'signals' },
  });

describe('invokeOperation', () => {
  it('draws the write before it lands, and the real row arrives with the predicted id', async () => {
    const live = (
      Signal as unknown as {
        query: (
          d: unknown,
          q: object,
        ) => { first: Promise<unknown>; getSnapshot: () => { data?: { results: Row[] } }; dispose: () => void };
      }
    ).query(dataset, {
      parent: { id: post.id, relation: 'signals' },
    });
    await live.first;
    // The real run waits until told, as one does for a round trip.
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    registerTransactionRunner((ds, fn) => landed.then(() => runInMemoryTransaction(ds, fn)));
    const pressed = invokeOperation(
      'core.upsertSignal',
      { node: post.id, signalType: 'like', value: 1 },
      { dataset, invoker: ME },
    );
    // Before the real run has returned, the read already carries the reaction.
    for (let i = 0; i < 50 && !predictionsFor(dataset).length; i++) await new Promise((r) => setTimeout(r, 1));
    const drawn = live.getSnapshot().data?.results.map((r) => r.id);
    // Nothing is stored yet: the backend's own class reads only what is.
    const stored = getEntity('Signal') as unknown as { findAll: (d: unknown, q: object) => Promise<Row[]> };
    expect(await stored.findAll(dataset, { parent: { id: post.id, relation: 'signals' } })).toEqual([]);
    land();
    await pressed;
    registerTransactionRunner(runInMemoryTransaction);
    const [made] = await signalsOn();
    expect(drawn).toEqual([made.id]);
    live.dispose();
  });
});
