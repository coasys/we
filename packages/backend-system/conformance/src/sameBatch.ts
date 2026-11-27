/**
 * A relation write addressed by id to a record created earlier in the same transaction.
 *
 * A compound write makes records and links them as one act: a board and its columns, a post and the
 * blocks it holds. The links are written by the record's id, through the entity's `addRelation` and
 * `setRelation`, onto records the same transaction has only just created — which a read inside the
 * transaction cannot see. A backend whose relation writes began by reading the record found nothing
 * there and wrote nothing, without an error, and the board committed with no columns. So these cases
 * create both ends inside one transaction, link them by id, and read the relation back once it has
 * committed.
 *
 * `CollectionBlock.children` is the relation: every backend's core schema holds it, and it is ordered,
 * so a whole-list write can be read back in the order it was given.
 */
import type { DatasetHandle } from '@we/backend-shared';
import { getEntity, runEntityTransaction } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

export const SAME_BATCH_CASES = ['sameBatch.add-relation', 'sameBatch.set-relation'] as const;

export type SameBatchCase = (typeof SAME_BATCH_CASES)[number];

interface Row {
  id: string;
  [field: string]: unknown;
}

interface Model {
  create(dataset: DatasetHandle, data?: Record<string, unknown>, options?: { batchId?: string }): Promise<Row>;
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Row[]>;
  addRelation(dataset: DatasetHandle, id: string, relation: string, targetId: string, batch?: string): Promise<void>;
  setRelation(
    dataset: DatasetHandle,
    id: string,
    relation: string,
    ids: readonly string[],
    batch?: string,
  ): Promise<void>;
}

export function describeSameBatch(name: string, harness: ConformanceHarness, timeout: number): void {
  describe(`backend conformance: ${name} — relation writes in the batch that created the record`, () => {
    let subject: ConformanceSubject;

    beforeEach(async () => {
      subject = await harness.setup();
      return () => harness.teardown?.(subject);
    }, timeout);

    const Collection = () => getEntity('CollectionBlock') as unknown as Model;

    /** The ids under `id`'s children, in their order, as a read after the commit sees them. */
    const childrenOf = async (id: string) => {
      const [row] = await Collection().findAll(subject.dataset, { where: { id }, include: { children: true } });
      return ((row?.children ?? []) as Row[]).map((child) => child.id);
    };

    const test = (id: SameBatchCase, title: string, body: () => Promise<void>) => {
      const gap = harness.knownGaps?.[id];
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, timeout);
      else it(title, body, timeout);
    };

    test(
      'sameBatch.add-relation',
      'a record linked by id under one created in the same transaction is there once it commits',
      async () => {
        const board = await runEntityTransaction(subject.dataset, async ({ batchId }) => {
          const created = await Collection().create(subject.dataset, { kind: 'board' }, { batchId });
          const column = await Collection().create(subject.dataset, { kind: 'column' }, { batchId });
          await Collection().addRelation(subject.dataset, created.id, 'children', column.id, batchId);
          return { id: created.id, column: column.id };
        });
        expect(await childrenOf(board.id)).toEqual([board.column]);
      },
    );

    test(
      'sameBatch.set-relation',
      'a whole list set by id on a record created in the same transaction reads back in its order',
      async () => {
        const board = await runEntityTransaction(subject.dataset, async ({ batchId }) => {
          const created = await Collection().create(subject.dataset, { kind: 'board' }, { batchId });
          const first = await Collection().create(subject.dataset, { kind: 'column' }, { batchId });
          const second = await Collection().create(subject.dataset, { kind: 'column' }, { batchId });
          await Collection().setRelation(subject.dataset, created.id, 'children', [second.id, first.id], batchId);
          return { id: created.id, order: [second.id, first.id] };
        });
        expect(await childrenOf(board.id)).toEqual(board.order);
      },
    );
  });
}
