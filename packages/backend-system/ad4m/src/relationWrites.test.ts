/**
 * The contract's relation writes reach a record created earlier in the same batch, which no read
 * can see until the batch commits.
 *
 * Against a stand-in with the shape the patch touches: `save`, which every create ends in, a static
 * `transaction` that opens and settles a batch as the SDK's does, `findOne` answering only for
 * committed records, and a generated accessor per relation. The real methods need an executor.
 */
import type { Ad4mModel } from '@coasys/ad4m';
import { beforeEach, describe, expect, it } from 'vitest';

import { installRelationWrites } from './relationWrites';
import { installStagedRecords } from './stagedRecords';

/** What reached an accessor: the record it was called on, the value and the batch. */
let written: { on: FakeModel; verb: string; value: unknown; batch?: string }[];
/** Records a read can see — the committed ones. */
let committed: Map<string, FakeModel>;
let reads: string[];
let nextBatch: number;

class FakeModel {
  static async findOne(_perspective: unknown, query: { where: { id: string } }): Promise<FakeModel | null> {
    reads.push(query.where.id);
    return committed.get(query.where.id) ?? null;
  }

  static async transaction<R>(_perspective: unknown, fn: (tx: { batchId: string }) => Promise<R>): Promise<R> {
    const batchId = `batch-${++nextBatch}`;
    const staged: FakeModel[] = [];
    pending.set(batchId, staged);
    try {
      const result = await fn({ batchId });
      for (const record of staged) committed.set(record.id, record);
      return result;
    } finally {
      pending.delete(batchId);
    }
  }

  static async create(perspective: unknown, data: { id: string }, options: { batchId: string }): Promise<FakeModel> {
    const instance = new this(perspective, data.id);
    await instance.save(options.batchId);
    return instance;
  }

  _snapshot?: Record<string, unknown>;

  constructor(
    public _perspective: unknown,
    public id: string,
  ) {}

  /** As the real one: a batch's write is staged until it commits; without one it lands now. */
  async save(batchId?: string): Promise<void> {
    if (batchId) pending.get(batchId)?.push(this);
    else committed.set(this.id, this);
    this._snapshot = {};
  }

  async addChildren(value: unknown, batch?: string): Promise<void> {
    written.push({ on: this, verb: 'add', value, batch });
  }
  async setChildren(value: unknown, batch?: string): Promise<void> {
    written.push({ on: this, verb: 'set', value, batch });
  }
  async removeChildren(value: unknown, batch?: string): Promise<void> {
    written.push({ on: this, verb: 'remove', value, batch });
  }
}

const pending = new Map<string, FakeModel[]>();

installRelationWrites(FakeModel as unknown as typeof Ad4mModel);
installStagedRecords(FakeModel as unknown as typeof Ad4mModel, () => 'did:test:me');

interface RelationStatics {
  transaction<R>(perspective: unknown, fn: (tx: { batchId: string }) => Promise<R>): Promise<R>;
  create(perspective: unknown, data: { id: string }, options: { batchId: string }): Promise<FakeModel>;
  addRelation(dataset: unknown, id: string, relation: string, targetId: string, batch?: string): Promise<void>;
  setRelation(dataset: unknown, id: string, relation: string, ids: readonly string[], batch?: string): Promise<void>;
  removeRelation(dataset: unknown, id: string, relation: string, targetId: string, batch?: string): Promise<void>;
}
const Model = FakeModel as unknown as RelationStatics;
const dataset = { uuid: 'p-1' };

beforeEach(() => {
  written = [];
  committed = new Map();
  reads = [];
  nextBatch = 0;
});

describe('a relation write onto a record created in the same batch', () => {
  it('is written onto the instance the batch created, without a read', async () => {
    await Model.transaction(dataset, async ({ batchId }) => {
      const board = await Model.create(dataset, { id: 'board' }, { batchId });
      await Model.create(dataset, { id: 'column' }, { batchId });
      await Model.addRelation(dataset, 'board', 'children', 'column', batchId);
      expect(written).toEqual([{ on: board, verb: 'add', value: 'column', batch: batchId }]);
    });
    expect(reads).toEqual([]);
  });

  it('sets the whole list the same way', async () => {
    await Model.transaction(dataset, async ({ batchId }) => {
      const board = await Model.create(dataset, { id: 'board' }, { batchId });
      await Model.setRelation(dataset, 'board', 'children', ['a', 'b'], batchId);
      expect(written).toEqual([{ on: board, verb: 'set', value: ['a', 'b'], batch: batchId }]);
    });
    expect(reads).toEqual([]);
  });

  it('still refuses a relation the record cannot be written through', async () => {
    const run = Model.transaction(dataset, async ({ batchId }) => {
      await Model.create(dataset, { id: 'board' }, { batchId });
      await Model.addRelation(dataset, 'board', 'columns', 'column', batchId);
    });
    await expect(run).rejects.toThrow(/"columns" cannot be written on FakeModel.*Writable relations: children/);
  });
});

describe('a relation write onto any other record', () => {
  it('loads the committed record and writes through it', async () => {
    const board = new FakeModel(dataset, 'board');
    await board.save();
    await Model.transaction(dataset, async ({ batchId }) => {
      await Model.addRelation(dataset, 'board', 'children', 'column', batchId);
    });
    expect(reads).toEqual(['board']);
    expect(written).toEqual([{ on: board, verb: 'add', value: 'column', batch: 'batch-1' }]);
  });

  it('writes nothing, and does not throw, when the record is not there', async () => {
    await Model.transaction(dataset, ({ batchId }) => Model.addRelation(dataset, 'gone', 'children', 'x', batchId));
    await Model.removeRelation(dataset, 'gone', 'children', 'x');
    expect(written).toEqual([]);
  });

  it('is not one a different batch created', async () => {
    await Model.transaction(dataset, async ({ batchId: first }) => {
      await Model.create(dataset, { id: 'board' }, { batchId: first });
      await Model.transaction(dataset, ({ batchId: second }) =>
        Model.addRelation(dataset, 'board', 'children', 'x', second),
      );
    });
    expect(reads).toEqual(['board']);
    expect(written).toEqual([]);
  });

  it('forgets what a batch created once it settles, committed or discarded', async () => {
    let batch = '';
    await Model.transaction(dataset, async ({ batchId }) => {
      batch = batchId;
      await Model.create(dataset, { id: 'kept' }, { batchId });
    });
    const failed = Model.transaction(dataset, async ({ batchId }) => {
      await Model.create(dataset, { id: 'dropped' }, { batchId });
      throw new Error('a later step failed');
    });
    await expect(failed).rejects.toThrow('a later step failed');

    // Committed, the record is read like any other; discarded, there is nothing to write onto.
    await Model.addRelation(dataset, 'kept', 'children', 'x', batch);
    await Model.addRelation(dataset, 'dropped', 'children', 'x', 'batch-2');
    expect(reads).toEqual(['kept', 'dropped']);
    expect(written.map((w) => [w.on.id, w.verb])).toEqual([['kept', 'add']]);
  });
});
