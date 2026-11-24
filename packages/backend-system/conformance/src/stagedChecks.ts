/**
 * The write check sees the transaction's own staged writes.
 *
 * A compound write makes a record and then writes to it again — creates a note and retitles it, makes
 * a board and arranges it — as one act. Reads inside the transaction see committed state only, so a
 * backend that answered a check's question "what does this record hold, and who made it?" with a
 * read found nothing for the second write, and a policy that lets only the author edit refused an
 * edit by the author of a record they had just made. The contract's rule (`EntityWrite.record`) is
 * that the check is told the record as the transaction has staged it, with the writer as its author.
 * It is the backend's to answer, so these cases ask it through a registered check and never pass a
 * record in.
 *
 * The policy here is the narrowest one that shows it: anyone may create, and only a record's author
 * may edit it.
 */
import type { DatasetHandle, OperationDefinition } from '@we/backend-shared';
import {
  type EntityWrite,
  getEntity,
  isOperationError,
  registerEntityWriteCheck,
  registerOperations,
  runEntityTransaction,
  runOperation,
  unregisterOperations,
  type WrittenRecord,
} from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

export const STAGED_CHECK_CASES = [
  'stagedChecks.create-then-edit',
  'stagedChecks.operation-create-then-update',
  'stagedChecks.operation-refused-rolls-back',
] as const;

export type StagedCheckCase = (typeof STAGED_CHECK_CASES)[number];

const NAMESPACE = 'conformance-staged';

const OPERATIONS: Record<string, OperationDefinition> = {
  writeTwice: {
    description: 'Make a note and retitle it in the same operation.',
    steps: [
      { create: { as: 'note', entity: 'CollectionBlock', fields: { kind: 'staged-note', title: 'first' } } },
      { update: { entity: 'CollectionBlock', id: { $: 'note.id' }, fields: { title: 'second' } } },
    ],
    returns: { $: 'note.id' },
  },
};

interface Row {
  id: string;
  [field: string]: unknown;
}

interface Instance extends Row {
  save(batch?: string): Promise<void>;
}

interface Model {
  create(dataset: DatasetHandle, data?: Record<string, unknown>, options?: { batchId?: string }): Promise<Instance>;
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Row[]>;
}

/** A refusal as the host's check raises one: the runner reads it by its name. */
const refusal = (message: string) => Object.assign(new Error(message), { name: 'PolicyRefusal' });

export function describeStagedChecks(name: string, harness: ConformanceHarness, timeout: number): void {
  describe(`backend conformance: ${name} — the write check sees the transaction's own writes`, () => {
    let subject: ConformanceSubject;
    /** Each edit the check was asked about, with the record it was told about. */
    let edits: { data?: Record<string, unknown>; record: WrittenRecord | null | undefined }[];
    /** Whether an edit by the record's author is refused too — the policy refusing every edit. */
    let refuseEveryEdit: boolean;

    beforeEach(async () => {
      subject = await harness.setup();
      edits = [];
      refuseEveryEdit = false;
      registerOperations(NAMESPACE, OPERATIONS);
      registerEntityWriteCheck(async (write: EntityWrite) => {
        if (write.entity !== 'CollectionBlock' || write.kind !== 'edit') return;
        const record = await write.record?.();
        edits.push({ data: write.data, record });
        if (refuseEveryEdit) throw refusal('Nobody may edit here.');
        if (!record || record.author !== subject.agent) throw refusal('Only its author may edit a record.');
      });
      return async () => {
        registerEntityWriteCheck(null);
        unregisterOperations(NAMESPACE);
        await harness.teardown?.(subject);
      };
    }, timeout);

    const Collection = () => getEntity('CollectionBlock') as unknown as Model;
    const notes = () => Collection().findAll(subject.dataset, { where: { kind: 'staged-note' } });

    const test = (id: StagedCheckCase, title: string, body: () => Promise<void>) => {
      const gap = harness.knownGaps?.[id];
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, timeout);
      else it(title, body, timeout);
    };

    test(
      'stagedChecks.create-then-edit',
      'an edit to a record created earlier in the same transaction is judged against it, by its author',
      async () => {
        const id = await runEntityTransaction(subject.dataset, async ({ batchId }) => {
          const note = await Collection().create(subject.dataset, { kind: 'staged-note', title: 'first' }, { batchId });
          note.title = 'second';
          await note.save(batchId);
          return note.id;
        });
        expect(edits).toHaveLength(1);
        expect(edits[0].record).toMatchObject({ id, title: 'first', author: subject.agent });
        const [row] = await notes();
        expect(row).toMatchObject({ id, title: 'second' });
      },
    );

    test(
      'stagedChecks.operation-create-then-update',
      'an operation that creates a record and updates it is allowed, with the invoker as its author',
      async () => {
        const id = await runOperation(
          `${NAMESPACE}.writeTwice`,
          {},
          { dataset: subject.dataset, invoker: subject.agent },
        );
        expect(edits).toHaveLength(1);
        expect(edits[0].record).toMatchObject({ id, title: 'first', author: subject.agent });
        const [row] = await notes();
        expect(row).toMatchObject({ id, title: 'second' });
      },
    );

    test(
      'stagedChecks.operation-refused-rolls-back',
      'an operation whose edit the policy refuses fails as refused, and its create does not land',
      async () => {
        refuseEveryEdit = true;
        const error = await runOperation(
          `${NAMESPACE}.writeTwice`,
          {},
          { dataset: subject.dataset, invoker: subject.agent },
        ).then(
          () => null,
          (thrown: unknown) => thrown,
        );
        expect(isOperationError(error)).toBe(true);
        expect(error).toMatchObject({ class: 'precondition', code: 'refused', message: 'Nobody may edit here.' });
        expect(await notes()).toEqual([]);
      },
    );
  });
}
