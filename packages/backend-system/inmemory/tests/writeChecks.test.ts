/**
 * Every write this backend makes asks the registered check first, and a refused write writes nothing.
 *
 * Each way a record can be written is covered here, because a write path that skips the check is a
 * hole nothing upstream can see: a create, an edit through the static and through an instance, a
 * delete both ways, and a relation write through the contract and through an accessor. The writes a
 * create makes for itself — its named relations, its parent link — are checked as the create.
 */
import type { EntityManifest } from '@we/backend-shared';
import { type EntityWrite, registerEntityWriteCheck } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileEntities } from '../src/entities';

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
let writes: EntityWrite[];
let refuse: (write: EntityWrite) => boolean;

beforeEach(() => {
  dataset = { id: 'ds-checks', tables: {} };
  writes = [];
  refuse = () => false;
  registerEntityWriteCheck(async (write) => {
    writes.push(write);
    if (refuse(write)) throw new Error(`refused ${write.entity}.${write.kind}`);
  });
});

afterEach(() => registerEntityWriteCheck(null));

const kinds = () => writes.map((w) => `${w.entity}.${w.kind}${w.relation ? `:${w.relation}` : ''}`);

describe('the write check', () => {
  it('is asked before a create, and a refused create writes nothing', async () => {
    refuse = (w) => w.kind === 'create';
    await expect(Note.create(dataset, { text: 'hi' })).rejects.toThrow('refused Note.create');
    expect(await Note.findAll(dataset)).toEqual([]);
    expect(writes[0]).toMatchObject({ entity: 'Note', kind: 'create', data: { text: 'hi' } });
  });

  it('checks a create as a whole, not the relation writes it makes for itself', async () => {
    const note = await Note.create(dataset, { text: 'one' });
    const list = await Collection.create(dataset, { title: 'List', children: [note.id] });
    await Note.create(dataset, { text: 'two' }, { parent: { id: list.id, relation: 'children' } });
    expect(kinds()).toEqual(['Note.create', 'Collection.create', 'Note.create']);
    // And the instance a create hands back is checked like any other afterwards.
    await (list as unknown as { addChildren(id: string): Promise<void> }).addChildren(note.id);
    expect(kinds().at(-1)).toBe('Collection.add:children');
  });

  it('is asked before an edit either way, with the record as it stood', async () => {
    const note = await Note.create(dataset, { text: 'before' });
    refuse = (w) => w.kind === 'edit';
    await expect(Note.update(dataset, note.id, { text: 'after' })).rejects.toThrow();
    note.text = 'after';
    await expect(note.save()).rejects.toThrow();
    expect((await Note.findOne(dataset, { where: { id: note.id } }))?.text).toBe('before');

    const edit = writes.find((w) => w.kind === 'edit')!;
    expect(edit).toMatchObject({ id: note.id, data: { text: 'after' } });
    expect(await edit.record!()).toMatchObject({ text: 'before', author: 'did:test:me' });
  });

  it('asks nothing of a save that changes nothing', async () => {
    const note = await Note.create(dataset, { text: 'same' });
    writes = [];
    await note.save();
    expect(writes).toEqual([]);
  });

  it('is asked before a delete either way', async () => {
    const one = await Note.create(dataset, { text: 'one' });
    const two = await Note.create(dataset, { text: 'two' });
    refuse = (w) => w.kind === 'delete';
    await expect(Note.delete(dataset, one.id)).rejects.toThrow();
    await expect(two.delete()).rejects.toThrow();
    expect(await Note.count(dataset)).toBe(2);
  });

  it('is asked before a relation write, through the contract and through an accessor', async () => {
    const list = await Collection.create(dataset, { title: 'List' });
    const note = await Note.create(dataset, { text: 'one' });
    refuse = (w) => w.kind === 'add';
    await expect(Collection.addRelation(dataset, list.id, 'children', note.id)).rejects.toThrow();
    await expect(Collection.setRelation(dataset, list.id, 'children', [note.id])).rejects.toThrow();
    expect((await Collection.findOne(dataset, { where: { id: list.id } }))?.children).toEqual([]);

    refuse = () => false;
    await Collection.addRelation(dataset, list.id, 'children', note.id);
    refuse = (w) => w.kind === 'remove';
    await expect(Collection.removeRelation(dataset, list.id, 'children', note.id)).rejects.toThrow();
    expect((await Collection.findOne(dataset, { where: { id: list.id } }))?.children).toEqual([note.id]);
  });
});
