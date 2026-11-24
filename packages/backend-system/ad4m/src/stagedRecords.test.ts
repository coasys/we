/**
 * The write check sees what the batch has staged: a record created earlier in the batch, with the
 * writer as its author, an edit laid over a committed record, and a delete.
 *
 * Against a stand-in with the shape the patches touch — `save` (a create without a snapshot, an edit
 * with one), `delete`, `changedFields`, a static `transaction` and `findOne` answering only for
 * committed records. The real methods need an executor; the live conformance run holds the real ones
 * to the same rule.
 */
import type { Ad4mModel } from '@coasys/ad4m';
import { type EntityWrite, registerEntityWriteCheck, type WrittenRecord } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installStagedRecords } from './stagedRecords';
import { installWriteChecks } from './writeChecks';

const ME = 'did:test:me';

/** Records a read can see — the committed ones, as a read returns them, author included. */
let committed: Map<string, Record<string, unknown>>;
let nextBatch: number;

class FakeModel {
  static async findOne(_perspective: unknown, query: { where: { id: string } }): Promise<FakeModel | null> {
    const row = committed.get(query.where.id);
    if (!row) return null;
    const instance = Object.assign(new FakeModel(null, query.where.id), row);
    instance._snapshot = { ...row };
    return instance;
  }

  static async transaction<R>(_perspective: unknown, fn: (tx: { batchId: string }) => Promise<R>): Promise<R> {
    return fn({ batchId: `batch-${++nextBatch}` });
  }

  _snapshot?: Record<string, unknown>;
  author?: string;
  title?: string;

  constructor(
    public _perspective: unknown,
    public id: string,
  ) {}

  changedFields(): string[] {
    const self = this as unknown as Record<string, unknown>;
    return ['title'].filter((key) => self[key] !== this._snapshot?.[key]);
  }

  /** Without a batch it lands now; with one nothing is readable, as on the executor. */
  async save(batchId?: string): Promise<void> {
    if (!batchId) committed.set(this.id, { id: this.id, title: this.title, author: ME });
    this._snapshot = { title: this.title };
  }

  async delete(batchId?: string): Promise<void> {
    if (!batchId) committed.delete(this.id);
  }
}

installStagedRecords(FakeModel as unknown as typeof Ad4mModel, () => ME);
installWriteChecks(FakeModel as unknown as typeof Ad4mModel);

const Model = FakeModel as unknown as {
  transaction<R>(perspective: unknown, fn: (tx: { batchId: string }) => Promise<R>): Promise<R>;
  findOne(perspective: unknown, query: { where: { id: string } }): Promise<FakeModel | null>;
};

/** Each write the check was asked about, with the record it was told about. */
let asked: { kind: string; record: WrittenRecord | null | undefined }[];

beforeEach(() => {
  committed = new Map();
  nextBatch = 0;
  asked = [];
  registerEntityWriteCheck(async (write: EntityWrite) => {
    asked.push({ kind: write.kind, record: await write.record?.() });
  });
});

afterEach(() => registerEntityWriteCheck(null));

describe('inside a batch, the record a check is told about', () => {
  it('is the one the batch created, with the writer as its author', async () => {
    await Model.transaction(null, async ({ batchId }) => {
      const note = new FakeModel(null, 'note');
      note.title = 'first';
      await note.save(batchId);
      note.title = 'second';
      await note.save(batchId);
      await note.delete(batchId);
    });
    expect(asked).toEqual([
      { kind: 'create', record: null },
      { kind: 'edit', record: expect.objectContaining({ id: 'note', title: 'first', author: ME }) },
      { kind: 'delete', record: expect.objectContaining({ id: 'note', title: 'second', author: ME }) },
    ]);
  });

  it('carries an edit the batch made to a committed record, whichever instance makes the next write', async () => {
    committed.set('note', { id: 'note', title: 'old', author: 'did:test:other' });
    await Model.transaction(null, async ({ batchId }) => {
      const one = (await Model.findOne(null, { where: { id: 'note' } }))!;
      one.title = 'edited';
      await one.save(batchId);
      const two = (await Model.findOne(null, { where: { id: 'note' } }))!;
      await two.delete(batchId);
    });
    expect(asked[1]).toEqual({
      kind: 'delete',
      record: expect.objectContaining({ title: 'edited', author: 'did:test:other' }),
    });
  });

  it('is gone once the batch deleted it', async () => {
    committed.set('note', { id: 'note', title: 'old', author: ME });
    await Model.transaction(null, async ({ batchId }) => {
      const one = (await Model.findOne(null, { where: { id: 'note' } }))!;
      await one.delete(batchId);
      const two = (await Model.findOne(null, { where: { id: 'note' } }))!;
      two.title = 'after';
      await two.save(batchId);
    });
    expect(asked[1]).toEqual({ kind: 'edit', record: null });
  });

  it('is not what another batch staged, nor what a settled one did', async () => {
    const note = new FakeModel(null, 'note');
    let first = '';
    await Model.transaction(null, async ({ batchId }) => {
      first = batchId;
      note.title = 'staged';
      await note.save(batchId);
    });
    // Another batch, and a late write under the settled one's id, see only what is committed — and
    // this stand-in commits nothing for a batch, so neither is told of an author.
    note.title = 'later';
    await Model.transaction(null, ({ batchId }) => note.save(batchId));
    note.title = 'late';
    await note.save(first);
    expect(asked.slice(1)).toEqual([
      { kind: 'edit', record: expect.objectContaining({ title: 'staged', author: undefined }) },
      { kind: 'edit', record: expect.objectContaining({ title: 'later', author: undefined }) },
    ]);
  });
});
