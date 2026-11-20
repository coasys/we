/**
 * Where a record came from, for a record whose class does not say.
 *
 * A bot installs its own classes, and they do not declare `extractedFrom`, so a call's action items
 * read as coming from nowhere: the canvas dimmed every one of them with that call selected. The
 * link is there, owned by the call, and these pin that it is read from that side.
 */
import type { EntityClass, QueryOptions } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { fillUndeclaredReverse, reverseReadsOf, withUndeclaredReverse } from '../src/undeclaredReverse';

type Row = Record<string, unknown>;

const CALL = { id: 'call-1', name: 'Monday', extracted: ['item-1', 'task-1'] };

/** A holder class answering with the given rows, recording what it was asked. */
function holder(rows: Row[] | Error) {
  const asked: QueryOptions[] = [];
  const Model: EntityClass = {
    query: () => {
      throw new Error('a holder is only read once');
    },
    findAll: async (_dataset, opts) => {
      asked.push(opts);
      if (rows instanceof Error) throw rows;
      return rows;
    },
  };
  return { Model, asked };
}

describe('the reverse relations a node carries that can be read from their forward side', () => {
  it('are the ones a particular class owns the link for', () => {
    const reads = reverseReadsOf();
    expect(reads).toContainEqual({
      relation: 'extractedFrom',
      holder: 'CollectionBlock',
      via: 'extracted',
      predicate: 'we://extracted',
    });
    expect(reads).toContainEqual({
      relation: 'partOf',
      holder: 'CollectionBlock',
      via: 'children',
      predicate: 'ad4m://has_child',
    });
  });

  it('leave out a relation whose forward half every node has, since there is no class to ask', () => {
    const relations = reverseReadsOf().map((read) => read.relation);
    expect(relations).not.toContain('respondsTo');
    expect(relations).not.toContain('inThread');
  });
});

describe('a row without a reverse relation it asked to include', () => {
  it('is given the collection that links to it', async () => {
    const calls = holder([CALL]);
    const rows: Row[] = [{ id: 'item-1' }];
    await fillUndeclaredReverse(rows, { include: { extractedFrom: true } }, {}, { holder: () => calls.Model });
    expect(rows[0].extractedFrom).toBe(CALL);
    expect(calls.asked).toEqual([{ parent: { ids: ['item-1'], predicate: 'we://extracted', direction: 'in' } }]);
  });

  it('is asked about in one read for the whole page, and only where the class left it off', async () => {
    const calls = holder([CALL]);
    const declaredEmpty: Row = { id: 'task-2', extractedFrom: null };
    const declared: Row = { id: 'task-1', extractedFrom: { id: 'call-1' } };
    const rows: Row[] = [{ id: 'item-1' }, { id: 'item-2' }, declaredEmpty, declared];
    await fillUndeclaredReverse(rows, { include: { extractedFrom: true } }, {}, { holder: () => calls.Model });
    expect(calls.asked).toHaveLength(1);
    expect((calls.asked[0].parent as { ids: string[] }).ids).toEqual(['item-1', 'item-2']);
    expect(rows[0].extractedFrom).toBe(CALL);
    // Nothing points at it: what the relation reads as on a record made by hand.
    expect(rows[1].extractedFrom).toBeNull();
    expect(declaredEmpty.extractedFrom).toBeNull();
    expect(declared.extractedFrom).toEqual({ id: 'call-1' });
  });

  it('carries what the include asked of the record it hydrates', async () => {
    const calls = holder([CALL]);
    await fillUndeclaredReverse(
      [{ id: 'item-1' }],
      { include: { extractedFrom: { properties: ['name'], polymorphic: true } } },
      {},
      { holder: () => calls.Model },
    );
    expect(calls.asked[0]).toEqual({
      properties: ['name'],
      parent: { ids: ['item-1'], predicate: 'we://extracted', direction: 'in' },
    });
  });

  it('reads as nothing, rather than failing the read, when the holder cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows: Row[] = [{ id: 'item-1' }];
    await fillUndeclaredReverse(
      rows,
      { include: { extractedFrom: true } },
      {},
      { holder: () => holder(new Error('offline')).Model },
    );
    expect(rows[0].extractedFrom).toBeNull();
    warn.mockRestore();
  });
});

describe('a model handle that answers undeclared reverse relations', () => {
  it('leaves a read that asks for none of them untouched', async () => {
    const calls = holder([CALL]);
    const page = [{ id: 'item-1' }];
    const Model: EntityClass = { query: vi.fn(), findAll: async () => page };
    const wrapped = withUndeclaredReverse(Model, { holder: () => calls.Model });
    expect(await wrapped.findAll({}, { include: { signals: true } })).toBe(page);
    expect(calls.asked).toEqual([]);
  });

  it('hands a live read its answers in the order they arrived, however long each took to fill', async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const calls: EntityClass = {
      query: vi.fn(),
      findAll: async () => {
        // The first fill is held up until the second answer has arrived.
        if (reads++ === 0) await slow;
        return [CALL];
      },
    };
    let emit!: (rows: Row[]) => void;
    const Model: EntityClass = {
      query: () => ({
        subscribe: (cb) => {
          emit = cb as (rows: Row[]) => void;
          return Promise.resolve([]);
        },
        dispose: () => {},
      }),
      findAll: vi.fn(),
    };
    const wrapped = withUndeclaredReverse(Model, { holder: () => calls });
    const seen: string[] = [];
    await wrapped.query({}, { include: { extractedFrom: true } }).subscribe((rows) => {
      seen.push((rows as Row[]).map((row) => row.id).join(','));
    });
    emit([{ id: 'item-1' }]);
    emit([{ id: 'item-1' }, { id: 'task-1' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['item-1', 'item-1,task-1']);
  });
});
