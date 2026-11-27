/**
 * WE's own signal operations, run against the reference backend: one reaction per person per type,
 * edited in place, and a doubled pair healed by the next change.
 */
import { getEntity, runOperation } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ME = 'did:test:me';
const OTHER = 'did:test:other';

interface Row {
  id: string;
  [field: string]: unknown;
}
type Model = {
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
};
const Collection = () => getEntity('CollectionBlock') as unknown as Model;
const Signal = () => getEntity('Signal') as unknown as Model;

let dataset: unknown;
let post: Row;
let author = ME;

beforeEach(async () => {
  author = ME;
  const ports = createInMemoryBackendPorts(
    { selfId: () => author },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-signals', name: 'Signals' }] },
  );
  dataset = (await ports.lifecycle.get('ds-signals'))!.handle;
  post = await Collection().create(dataset, { kind: 'post' });
});

const signalsOn = (node: string) => Signal().findAll(dataset, { parent: { id: node, relation: 'signals' } });
const upsert = (value: number, signalType = 'like') =>
  runOperation('core.upsertSignal', { node: post.id, signalType, value }, { dataset, invoker: ME });
const withdraw = (signalType = 'like') =>
  runOperation('core.withdrawSignal', { node: post.id, signalType }, { dataset, invoker: ME });

describe('core.upsertSignal', () => {
  it('makes a reaction under the record, and edits it in place after', async () => {
    await upsert(1);
    const [first] = await signalsOn(post.id);
    expect(first).toMatchObject({ signalTypeId: 'like', value: 1, author: ME });
    await upsert(0);
    const after = await signalsOn(post.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: first!.id, value: 0 });
  });

  it('heals two reactions of one type to one, keeping the oldest', async () => {
    const parent = { parent: { id: post.id, relation: 'signals' } };
    const older = await Signal().create(dataset, { signalTypeId: 'like', value: 1 }, parent);
    await Signal().create(dataset, { signalTypeId: 'like', value: 1 }, parent);
    await upsert(3);
    const after = await signalsOn(post.id);
    expect(after.map((s) => [s.id, s.value])).toEqual([[older.id, 3]]);
  });

  it('leaves other types and other people alone', async () => {
    const parent = { parent: { id: post.id, relation: 'signals' } };
    await Signal().create(dataset, { signalTypeId: 'star', value: 4 }, parent);
    author = OTHER;
    await Signal().create(dataset, { signalTypeId: 'like', value: 1 }, parent);
    author = ME;
    await upsert(1);
    const after = await signalsOn(post.id);
    expect(after.map((s) => `${s.author}:${s.signalTypeId}:${s.value}`).sort()).toEqual([
      `${ME}:like:1`,
      `${ME}:star:4`,
      `${OTHER}:like:1`,
    ]);
  });
});

describe('core.withdrawSignal', () => {
  it('removes every copy of the invoker’s reaction of that type', async () => {
    const parent = { parent: { id: post.id, relation: 'signals' } };
    await Signal().create(dataset, { signalTypeId: 'like', value: 1 }, parent);
    await Signal().create(dataset, { signalTypeId: 'like', value: 1 }, parent);
    await Signal().create(dataset, { signalTypeId: 'star', value: 2 }, parent);
    await withdraw();
    expect((await signalsOn(post.id)).map((s) => s.signalTypeId)).toEqual(['star']);
  });

  it('is nothing to do when there is no reaction', async () => {
    await withdraw();
    expect(await signalsOn(post.id)).toEqual([]);
  });
});
