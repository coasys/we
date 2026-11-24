/**
 * The host's write check is asked before each of `Ad4mModel`'s write methods, and a refused write
 * never reaches the method.
 *
 * Against a stand-in with the shape the patch touches: the real
 * methods need an executor. The stand-in's `save()` writes a relation the way the real one does, so
 * the case that a save's own relation writes pass unchecked is the real call order.
 */
import { type EntityWrite, registerEntityWriteCheck } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWriteChecks } from './writeChecks';

const written = vi.fn();

class FakeModel {
  static getModelMetadata() {
    return { className: 'Note', relations: { owner: { maxCount: 1 }, children: {} } };
  }
  static async findOne(_perspective: unknown, query: { where: { id: string } }) {
    const found = new FakeModel(query.where.id);
    found.text = 'stored';
    found.author = 'did:ann';
    return found;
  }

  _perspective = { uuid: 'p-1' };
  _snapshot?: Record<string, unknown>;
  author?: string;
  text?: string;
  children?: string[];
  owner?: string;

  constructor(public id?: string) {}

  changedFields(): string[] {
    const snapshot = this._snapshot ?? {};
    const self = this as unknown as Record<string, unknown>;
    // By value, as the real one compares a normalised copy.
    return Object.keys(snapshot).filter((key) => JSON.stringify(self[key]) !== JSON.stringify(snapshot[key]));
  }

  /** As the real one: write the fields, then the relations through `setRelationValues`. */
  async save(): Promise<void> {
    written('save');
    if (this.children) await this.setRelationValues('children', this.children);
    this._snapshot = { text: this.text, children: this.children };
  }
  async delete(): Promise<void> {
    written('delete');
  }
  async setRelationValues(key: string, _value: unknown): Promise<void> {
    written(`set:${key}`);
  }
  async addRelationValue(key: string, _value: unknown): Promise<void> {
    written(`add:${key}`);
  }
  async removeRelationValue(key: string, _value: unknown): Promise<void> {
    written(`remove:${key}`);
  }
}

installWriteChecks(FakeModel as never);

let writes: EntityWrite[];
let refuse: (write: EntityWrite) => boolean;

beforeEach(() => {
  written.mockReset();
  writes = [];
  refuse = () => false;
  registerEntityWriteCheck(async (write) => {
    writes.push(write);
    if (refuse(write)) throw new Error('refused');
  });
});

afterEach(() => registerEntityWriteCheck(null));

const loaded = () => {
  const note = new FakeModel('n-1');
  note.text = 'before';
  note.author = 'did:ann';
  note.children = ['a'];
  note._snapshot = { text: 'before', children: ['a'] };
  return note;
};

describe('adding to a single-valued relation, which replaces its member', () => {
  const kinds = () => writes.map((w) => `${w.kind}:${w.relation}`);

  it('also checks a remove when it displaces another member, and refuses when remove is denied', async () => {
    const note = loaded();
    note.owner = 'did:old';
    note._snapshot = { ...note._snapshot, owner: 'did:old' };
    await note.addRelationValue('owner', 'did:new');
    expect(kinds()).toEqual(['add:owner', 'remove:owner']);
    refuse = (w) => w.kind === 'remove';
    written.mockReset();
    await expect(note.addRelationValue('owner', 'did:new')).rejects.toThrow('refused');
    expect(written).not.toHaveBeenCalled();
  });

  it('checks a remove even when the snapshot says empty: a relation write does not update the snapshot', async () => {
    // Read empty, then two adds: the second replaces the first while the snapshot still says empty.
    const note = loaded();
    note._snapshot = { ...note._snapshot, owner: null };
    refuse = (w) => w.kind === 'remove';
    await expect(note.addRelationValue('owner', 'did:first')).rejects.toThrow('refused');
    await expect(note.addRelationValue('owner', 'did:second')).rejects.toThrow('refused');
    expect(written).not.toHaveBeenCalled();
  });

  it('checks only add on a collection', async () => {
    await loaded().addRelationValue('children', 'b');
    expect(kinds()).toEqual(['add:children']);
  });
});

describe('setting a list, which the snapshot cannot diff', () => {
  it('checks a remove on successive sets after an empty read: the first set does not update the snapshot', async () => {
    const note = loaded();
    note._snapshot = { ...note._snapshot, children: [] };
    refuse = (w) => w.kind === 'remove';
    await expect(note.setRelationValues('children', ['a'])).rejects.toThrow('refused');
    await expect(note.setRelationValues('children', [])).rejects.toThrow('refused');
    expect(written).not.toHaveBeenCalled();
  });
});

describe('the write check on the production adapter', () => {
  it('checks a save of a new instance as a create, and its own relation writes not at all', async () => {
    const note = new FakeModel();
    note.text = 'hello';
    note.children = ['a', 'b'];
    await note.save();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ entity: 'Note', kind: 'create', data: { text: 'hello', children: ['a', 'b'] } });
    expect(written.mock.calls.flat()).toEqual(['save', 'set:children']);
  });

  it('checks a save of a read instance as an edit of what changed, with the record as it stood', async () => {
    const note = loaded();
    note.text = 'after';
    await note.save();
    expect(writes[0]).toMatchObject({ kind: 'edit', id: 'n-1', data: { text: 'after' } });
    expect(await writes[0].record!()).toMatchObject({ text: 'before', author: 'did:ann' });
  });

  it('asks nothing of a save that changes nothing', async () => {
    await loaded().save();
    expect(writes).toEqual([]);
  });

  it('never reaches the method when the check refuses', async () => {
    refuse = () => true;
    const note = loaded();
    note.text = 'after';
    await expect(note.save()).rejects.toThrow('refused');
    await expect(note.delete()).rejects.toThrow('refused');
    await expect(note.addRelationValue('children', 'b')).rejects.toThrow('refused');
    expect(written).not.toHaveBeenCalled();
  });

  it('reads the record for a delete of an instance that was never read', async () => {
    await new FakeModel('n-2').delete();
    expect(writes[0]).toMatchObject({ kind: 'delete', id: 'n-2' });
    expect(await writes[0].record!()).toMatchObject({ id: 'n-2', text: 'stored', author: 'did:ann' });
  });

  it('checks a relation write as an add or a remove, and setting a list as both unless it empties it', async () => {
    const note = loaded();
    await note.addRelationValue('children', 'b');
    await note.removeRelationValue('children', 'a');
    await note.setRelationValues('children', ['a', 'c']);
    await note.setRelationValues('children', []); // adds nothing
    expect(writes.map((w) => `${w.kind}:${w.relation}`)).toEqual([
      'add:children',
      'remove:children',
      'add:children',
      'remove:children',
      'remove:children',
    ]);
  });
});
