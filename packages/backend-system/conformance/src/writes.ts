/**
 * Writes a caller groups or names: a create onto an id the caller chose, and a transaction.
 *
 * A compound write — several records made as one act — leans on two promises from the contract. A
 * create can be given the id its record will have, so a later step names the record without reading
 * it back, and a second create onto that id is refused rather than overwriting the first. And a
 * transaction is all or nothing: when its callback throws, nothing it wrote is there to read, and
 * while it runs, its own reads see what was committed before it, never what it has staged.
 *
 * The cases write `Space` records, which every backend's space schema holds and which carry nothing
 * that could make a create fail for some other reason.
 */
import { type DatasetHandle, isRecordExists } from '@we/backend-shared';
import { getEntity, runEntityTransaction } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

export const WRITE_CASES = [
  'writes.create-with-id',
  'writes.create-onto-existing-id',
  'writes.transaction-commits',
  'writes.transaction-throw-writes-nothing',
  'writes.transaction-reads-committed',
] as const;

export type WriteCase = (typeof WRITE_CASES)[number];

interface Row {
  id: string;
  [field: string]: unknown;
}

interface Model {
  create(
    dataset: DatasetHandle,
    data?: Record<string, unknown>,
    options?: { id?: string; batchId?: string },
  ): Promise<Row>;
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Row[]>;
}

/** An id a caller could have derived: a URI, which is the form every backend can store. */
const chosenId = () => `urn:uuid:${crypto.randomUUID()}`;

export function describeWriteCases(name: string, harness: ConformanceHarness, timeout: number): void {
  describe(`backend conformance: ${name} — grouped and named writes`, () => {
    let subject: ConformanceSubject;

    beforeEach(async () => {
      subject = await harness.setup();
      return () => harness.teardown?.(subject);
    }, timeout);

    const Space = () => getEntity('Space') as unknown as Model;
    const named = async (spaceName: string) =>
      (await Space().findAll(subject.dataset, { where: { name: spaceName } })).map((row) => row.id);

    const test = (id: WriteCase, title: string, body: () => Promise<void>) => {
      const gap = harness.knownGaps?.[id];
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, timeout);
      else it(title, body, timeout);
    };

    test('writes.create-with-id', 'a create given an id makes the record under that id', async () => {
      const id = chosenId();
      const created = await Space().create(subject.dataset, { name: 'Chosen' }, { id });
      expect(created.id).toBe(id);
      const found = await Space().findAll(subject.dataset, { where: { id } });
      expect(found.map((row) => [row.id, row.name])).toEqual([[id, 'Chosen']]);
    });

    test(
      'writes.create-onto-existing-id',
      'a second create onto the same id is refused, and the first record is left as it was',
      async () => {
        const id = chosenId();
        await Space().create(subject.dataset, { name: 'First' }, { id });
        const second = Space().create(subject.dataset, { name: 'Second' }, { id });
        await expect(second).rejects.toSatisfy(isRecordExists);
        const found = await Space().findAll(subject.dataset, { where: { id } });
        expect(found.map((row) => row.name)).toEqual(['First']);
        expect(await named('Second')).toEqual([]);
      },
    );

    test('writes.transaction-commits', 'every write a transaction makes is there once it resolves', async () => {
      await runEntityTransaction(subject.dataset, async (tx) => {
        await Space().create(subject.dataset, { name: 'Grouped' }, { batchId: tx.batchId });
        await Space().create(subject.dataset, { name: 'Grouped' }, { batchId: tx.batchId });
      });
      expect(await named('Grouped')).toHaveLength(2);
    });

    test(
      'writes.transaction-throw-writes-nothing',
      'a transaction whose callback throws after two writes leaves neither, and rethrows',
      async () => {
        const failure = new Error('the third step failed');
        const run = runEntityTransaction(subject.dataset, async (tx) => {
          await Space().create(subject.dataset, { name: 'Abandoned' }, { batchId: tx.batchId });
          await Space().create(subject.dataset, { name: 'Abandoned' }, { batchId: tx.batchId });
          throw failure;
        });
        await expect(run).rejects.toBe(failure);
        expect(await named('Abandoned')).toEqual([]);
      },
    );

    test(
      'writes.transaction-reads-committed',
      "a read inside a transaction sees what was committed before it, not the transaction's own writes",
      async () => {
        await Space().create(subject.dataset, { name: 'Before' });
        const seen = await runEntityTransaction(subject.dataset, async (tx) => {
          await Space().create(subject.dataset, { name: 'During' }, { batchId: tx.batchId });
          return { before: await named('Before'), during: await named('During') };
        });
        expect(seen.before).toHaveLength(1);
        expect(seen.during).toEqual([]);
        expect(await named('During')).toHaveLength(1);
      },
    );
  });
}
