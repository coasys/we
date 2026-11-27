/**
 * A write drawn before it lands, on a real executor: a reaction and an answer to an invitation,
 * through the operations the app runs for them.
 *
 * The app speculates each invocation over what its live reads hold, draws the writes it predicts,
 * then runs it for real with the same invocation id, so the real records have the predicted ids. The
 * reference backend's test of this cannot say whether AD4M's rows, arriving over the subscription
 * socket seconds later, replace the predicted ones or arrive beside them. This file asks.
 */
import { Ad4mClient } from '@coasys/ad4m';
import type { BackendPorts } from '@we/backend-shared';
import {
  clearPredictions,
  getEntity,
  getEntityForDataset,
  Involvement,
  predict,
  predictionLanded,
  runOperation,
  Signal,
  speculateOperation,
  withdrawPrediction,
} from '@we/entities';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';

interface Row {
  id: string;
  [field: string]: unknown;
}
interface Live {
  first: Promise<unknown>;
  getSnapshot(): { data?: { results: Row[] } };
  dispose(): void;
}
type Model = {
  create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
  query(d: unknown, q?: Record<string, unknown>): Live;
};

let opened: { client: Ad4mClient; ports: BackendPorts; agent: string; id: string; dataset: unknown } | undefined;

beforeAll(async () => {
  const { url, token } = inject('ad4mExecutor');
  const client = new Ad4mClient(url, token);
  const agent = (await client.agent.me()).did;
  const ports = createAd4mBackendPorts(client, { selfId: () => agent });
  const ref = await ports.lifecycle.create(`we-predicted-${Date.now()}`);
  await ports.schemas.installSpace(ref.handle, []);
  opened = { client, ports, agent, id: ref.id, dataset: ref.handle };
}, 180_000);

afterEach(() => clearPredictions());

afterAll(async () => {
  if (!opened) return;
  await opened.ports.lifecycle.remove(opened.id).catch(() => undefined);
  opened.client.close();
});

const ids = (live: Live) => (live.getSnapshot().data?.results ?? []).map((row) => row.id);

/** Wait until `test` holds, looking every 100 ms; fail after `ms`. */
async function until(test: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Speculate, draw, run, land, and watch the live read throughout: the predicted row is drawn at once,
 * stays drawn (never gone, never twice) until the real one has arrived, and the real one, read with
 * the prediction withdrawn, has the same id.
 */
async function drawnBeforeItLands(
  live: Live,
  entity: string,
  read: Record<string, unknown>,
  operation: string,
  args: Record<string, unknown>,
) {
  const { dataset, agent } = opened!;
  const invocationId = crypto.randomUUID();
  const invocation = { dataset, invoker: agent, invocationId, invokedAt: new Date().toISOString() };
  const { writes } = await speculateOperation(operation, args, invocation);
  const created = writes.find((w) => w.kind === 'create') as { id: string } | undefined;
  expect(created, 'the speculation predicts a create').toBeDefined();
  const id = created!.id;
  predict(dataset, invocationId, writes);
  // Drawn on the gesture: no round trip between the prediction and the read showing it.
  expect(ids(live)).toEqual([id]);

  const seen = new Set<number>();
  const watch = setInterval(() => seen.add(ids(live).filter((shown) => shown === id).length), 20);
  try {
    await runOperation(operation, args, invocation);
    predictionLanded(invocationId);
    // The backend's own answer, with no prediction laid over it, has the row.
    const backend = getEntityForDataset(entity, dataset) as unknown as {
      findAll(d: unknown, q: Record<string, unknown>): Promise<Row[]>;
    };
    await until(async () => (await backend.findAll(dataset, read)).some((row) => row.id === id));
    // And then the subscription carries it, which is what replaces the prediction.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } finally {
    clearInterval(watch);
  }
  expect([...seen], 'how many times the row was drawn, at every look').toEqual([1]);
  withdrawPrediction(invocationId);
  await until(() => JSON.stringify(ids(live)) === JSON.stringify([id]), 5_000);
}

describe('a write drawn before it lands, on AD4M', () => {
  it(
    'core.upsertSignal: the predicted reaction is replaced by the real one, same id',
    { timeout: 60_000 },
    async () => {
      const post = await (getEntity('CollectionBlock') as unknown as Model).create(opened!.dataset, { kind: 'post' });
      const live = (Signal as unknown as Model).query(opened!.dataset, {
        parent: { id: post.id, relation: 'signals' },
      });
      try {
        await live.first;
        const read = { parent: { id: post.id, relation: 'signals' } };
        await drawnBeforeItLands(live, 'Signal', read, 'core.upsertSignal', {
          node: post.id,
          signalType: 'like',
          value: 1,
        });
      } finally {
        live.dispose();
      }
    },
  );

  it('core.respond: the predicted answer is replaced by the real one, same id', { timeout: 60_000 }, async () => {
    const { dataset } = opened!;
    await (getEntity('InvolvementType') as unknown as Model).create(dataset, {
      name: 'Going',
      slug: 'going',
      reflexive: true,
    });
    const post = await (getEntity('CollectionBlock') as unknown as Model).create(dataset, { kind: 'post' });
    const live = (Involvement as unknown as Model).query(dataset, { where: { node: post.id } });
    try {
      await live.first;
      await drawnBeforeItLands(live, 'Involvement', { where: { node: post.id } }, 'core.respond', {
        node: post.id,
        kind: 'going',
      });
    } finally {
      live.dispose();
    }
  });
});
