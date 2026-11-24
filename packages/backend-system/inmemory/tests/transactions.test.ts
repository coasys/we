/**
 * A write group on this backend: staged, made at the end, all of it or none, and heard once.
 *
 * The shared suite asks the same of every backend in terms of records that do or do not exist. These
 * ask what only this one can be held to exactly: that a live query hears a commit once and a failed
 * group not at all, that a write can name a record created earlier in its group, and that a group
 * failing halfway through its own commit puts back what the writes before the failure made.
 */
import { type EntityManifest, isRecordExists } from '@we/backend-shared';
import { registerEntityWriteCheck } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileEntities, runInMemoryTransaction } from '../src/entities';

const MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    Collection: {
      properties: { title: { type: 'string' } },
      relations: { children: { target: 'Note', cardinality: 'many', ordered: true } },
    },
    Note: { properties: { text: { type: 'string' } }, relations: {} },
  },
};

const { Collection, Note } = compileEntities(MANIFEST, { selfId: () => 'did:test:me' });

let dataset: { id: string; tables: Record<string, unknown[]> };

beforeEach(() => {
  dataset = { id: 'ds-transactions', tables: {} };
});

afterEach(() => registerEntityWriteCheck(null));

const texts = async () => (await Note.findAll(dataset)).map((note) => note.text).sort();

/** Every result a live query on notes is handed, after its first. */
async function pushes() {
  const seen: unknown[][] = [];
  const live = Note.query(dataset, {});
  await live.first;
  live.subscribe((snapshot) => {
    if (snapshot.status === 'ready' && snapshot.data && !snapshot.initial) seen.push(snapshot.data.results);
  });
  return { seen, dispose: () => live.dispose() };
}

describe('the in-memory transaction', () => {
  it('makes nothing until the callback resolves, then everything, and is heard once', async () => {
    const { seen, dispose } = await pushes();
    await runInMemoryTransaction(dataset, async (tx) => {
      await Note.create(dataset, { text: 'one' }, { batchId: tx.batchId });
      await Note.create(dataset, { text: 'two' }, { batchId: tx.batchId });
      expect(await texts()).toEqual([]);
      expect(seen).toEqual([]);
    });
    expect(await texts()).toEqual(['one', 'two']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(2);
    dispose();
  });

  it('makes nothing, and tells nobody, when the callback throws', async () => {
    await Note.create(dataset, { text: 'kept' });
    const { seen, dispose } = await pushes();
    const failure = new Error('stop');
    await expect(
      runInMemoryTransaction(dataset, async (tx) => {
        await Note.create(dataset, { text: 'lost' }, { batchId: tx.batchId });
        const kept = (await Note.findOne(dataset, { where: { text: 'kept' } }))!;
        kept.text = 'changed';
        await kept.save(tx.batchId);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await texts()).toEqual(['kept']);
    expect(seen).toEqual([]);
    dispose();
  });

  it('lets a write name a record created earlier in the group', async () => {
    const id = await runInMemoryTransaction(dataset, async (tx) => {
      const board = await Collection.create(dataset, { title: 'Board' }, { batchId: tx.batchId });
      const note = await Note.create(dataset, { text: 'card' }, { batchId: tx.batchId });
      await Collection.addRelation(dataset, board.id, 'children', note.id, tx.batchId);
      board.title = 'Renamed';
      await board.save(tx.batchId);
      return board.id;
    });
    const board = await Collection.findOne(dataset, { where: { id }, include: { children: true } });
    expect(board?.title).toBe('Renamed');
    expect((board?.children as { text: string }[]).map((note) => note.text)).toEqual(['card']);
  });

  it('puts back what the commit had made when a later write in it is refused', async () => {
    registerEntityWriteCheck((write) => {
      if (write.entity === 'Note' && write.kind === 'create' && write.data?.text === 'refused') {
        throw new Error('refused');
      }
    });
    const { seen, dispose } = await pushes();
    await expect(
      runInMemoryTransaction(dataset, async (tx) => {
        await Note.create(dataset, { text: 'first' }, { batchId: tx.batchId });
        await Note.create(dataset, { text: 'refused' }, { batchId: tx.batchId });
      }),
    ).rejects.toThrow('refused');
    expect(await texts()).toEqual([]);
    expect(seen).toEqual([]);
    dispose();
  });

  it('refuses a second create onto an id the same group already used, and makes neither', async () => {
    await expect(
      runInMemoryTransaction(dataset, async (tx) => {
        await Note.create(dataset, { text: 'a' }, { batchId: tx.batchId, id: 'urn:test:1' });
        await Note.create(dataset, { text: 'b' }, { batchId: tx.batchId, id: 'urn:test:1' });
      }),
    ).rejects.toSatisfy(isRecordExists);
    expect(await texts()).toEqual([]);
  });

  it('refuses a create onto an id a record of another entity holds', async () => {
    await Collection.create(dataset, { title: 'x' }, { id: 'urn:test:2' });
    await expect(Note.create(dataset, { text: 'y' }, { id: 'urn:test:2' })).rejects.toSatisfy(isRecordExists);
  });

  it('refuses an id written as a field', async () => {
    await expect(Note.create(dataset, { id: 'urn:test:3', text: 'z' })).rejects.toThrow(/"id" option/);
  });
});
