/**
 * Each composed store graph runs declared operations with its own queues, speculations and
 * predictions. Two compositions in one process — two tests, two hosts — must not draw each other's
 * pending writes: a prediction made in one is a promise about that one's screen.
 *
 * Composed whole, by `composeStores`, on the test port and the test platform over one in-memory
 * backend; nothing is booted, since nothing here reads past the operation runner and the entity
 * stand-ins.
 */
import { createInMemoryBackendPorts, runInMemoryTransaction } from '@we/backend-inmemory';
import { boundPredictions, CollectionBlock, registerTransactionRunner, Signal } from '@we/entities';
import { afterEach, describe, expect, it } from 'vitest';

import { composeStores } from '../src/shared/composeStores';
import type { StoreRegistry } from '../src/shared/stores/storeRegistry';
import { neutralProfileHost } from './support/profileHost';

const ME = 'did:test:me';

interface Row {
  id: string;
  [field: string]: unknown;
}

const disposers: (() => void)[] = [];
afterEach(() => {
  registerTransactionRunner(runInMemoryTransaction);
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

/** One composition, as a host makes it, over the given backend ports. */
function compose(ports: ReturnType<typeof createInMemoryBackendPorts>): StoreRegistry {
  const env = neutralProfileHost.open(['/']);
  const backend = { initialize: () => Promise.resolve({ client: {}, ports }) } as never;
  let registry!: StoreRegistry;
  disposers.push(env.reactivity.root(() => (registry = composeStores({ ...env, backend }))));
  disposers.push(() => env.close());
  return registry;
}

describe('operations per composition', () => {
  it('keeps one composition’s predictions out of another’s, and its stand-ins’ reads', async () => {
    const ports = createInMemoryBackendPorts(
      { selfId: () => ME },
      { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-two', name: 'Two' }] },
    );
    const dataset = (await ports.lifecycle.get('ds-two'))!.handle;
    const post = (await (CollectionBlock as unknown as { create: (d: unknown, f: object) => Promise<Row> }).create(
      dataset,
      { kind: 'post' },
    )) as Row;
    const signalsOn = () =>
      (Signal as unknown as { findAll: (d: unknown, q: object) => Promise<Row[]> }).findAll(dataset, {
        parent: { id: post.id, relation: 'signals' },
      });

    const first = compose(ports);
    const second = compose(ports);
    expect(first.operations).not.toBe(second.operations);
    expect(first.operations.predictions).not.toBe(second.operations.predictions);
    // The entity stand-ins draw the composition living last.
    expect(boundPredictions()).toBe(second.operations.predictions);

    // The first composition's press, held before it lands so its prediction stays drawn.
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    registerTransactionRunner((ds, fn) => landed.then(() => runInMemoryTransaction(ds, fn)));
    const pressed = first.operations.invoke(
      'core.upsertSignal',
      { node: post.id, signalType: 'like', value: 1 },
      { dataset, invoker: ME },
    );
    for (let i = 0; i < 50 && !first.operations.predictions.for(dataset).length; i++)
      await new Promise((r) => setTimeout(r, 1));

    expect(first.operations.predictions.for(dataset)).toHaveLength(1);
    expect(second.operations.predictions.for(dataset)).toEqual([]);
    expect(second.operations.predictions.any()).toBe(false);
    // A store of the second composition reading through the stand-ins sees nothing pending.
    expect(await signalsOn()).toEqual([]);

    land();
    await pressed;
  });

  it('gives the stand-ins back to the composition before once the later one is gone', () => {
    const ports = createInMemoryBackendPorts({ selfId: () => ME }, { agent: { id: ME, unlocked: true }, datasets: [] });
    const before = boundPredictions();
    const first = compose(ports);
    const second = compose(ports);
    expect(boundPredictions()).toBe(second.operations.predictions);
    disposers.pop()!();
    disposers.pop()!();
    expect(boundPredictions()).toBe(first.operations.predictions);
    for (const dispose of disposers.splice(0).reverse()) dispose();
    expect(boundPredictions()).toBe(before);
  });
});
