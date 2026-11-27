/**
 * One meaning for an empty value: `''` written to a scalar field means the field has no value.
 *
 * It means that whenever it is written — given at creation, standing as the field's declared
 * default, or written later to clear a value — so a record cannot be told apart by how its field
 * came to be empty. A query sees no value in every case: neither `{ field: '' }` nor
 * `{ field: { not: x } }` matches, as no comparison matches an absent value. The record still reads
 * back with its declared default, which is what a form shows.
 *
 * The cases run against `TaskBlock.assignee`, whose declared default is `''`. The suite's
 * `records.not-excludes-absent` asks the same of a field with no default.
 */
import type { DatasetHandle, RendererDataBindings } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

export const EMPTY_VALUE_CASES = ['empty.created-empty-is-absent', 'empty.cleared-is-absent'] as const;

export type EmptyValueCase = (typeof EMPTY_VALUE_CASES)[number];

interface Row {
  id: string;
  [field: string]: unknown;
}

interface Model {
  create(dataset: DatasetHandle, data?: Record<string, unknown>): Promise<Row>;
  update(dataset: DatasetHandle, id: string, data: Record<string, unknown>): Promise<unknown>;
}

interface Reader {
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Row[]>;
}

export function describeEmptyValues(name: string, harness: ConformanceHarness, timeout: number): void {
  describe(`backend conformance: ${name} — empty values`, () => {
    let subject: ConformanceSubject;
    let bindings: RendererDataBindings;

    beforeEach(async () => {
      subject = await harness.setup();
      bindings = subject.ports.dataBindings({
        currentDataset: () => subject.dataset,
        currentDatasetEntities: () => [],
        profiles: () => [],
        fetchProfile: () => {},
        ephemeral: subject.ports.ephemeral,
      });
      return () => harness.teardown?.(subject);
    }, timeout);

    const Task = () => getEntity('TaskBlock') as unknown as Model;
    const titles = async (where: Record<string, unknown>) => {
      const reader = bindings.$getEntity!('TaskBlock') as unknown as Reader;
      return (await reader.findAll(subject.dataset, { where })).map((r) => r.title as string).sort();
    };

    /** What every case asks: only the task somebody is on is found, by either comparison. */
    const expectOnlyAssigned = async () => {
      expect(await titles({ assignee: '' })).toEqual([]);
      expect(await titles({ assignee: { not: 'Ann' } })).toEqual(['Assigned']);
      expect(await titles({ assignee: { not: ['Ann', 'Cy'] } })).toEqual(['Assigned']);
      // Every one still reads back as the declared default.
      const reader = bindings.$getEntity!('TaskBlock') as unknown as Reader;
      for (const row of await reader.findAll(subject.dataset, {})) {
        if (row.title !== 'Assigned') expect(row.assignee ?? '', `${row.title as string}'s assignee`).toBe('');
      }
    };

    const test = (id: EmptyValueCase, title: string, body: () => Promise<void>) => {
      const gap = harness.knownGaps?.[id];
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, timeout);
      else it(title, body, timeout);
    };

    test(
      'empty.created-empty-is-absent',
      "a record created with '' or with a default of '' has no value for the field",
      async () => {
        await Task().create(subject.dataset, { title: 'Assigned', assignee: 'Bob' });
        await Task().create(subject.dataset, { title: 'Defaulted' });
        await Task().create(subject.dataset, { title: 'Given empty', assignee: '' });
        await expectOnlyAssigned();
      },
    );

    test('empty.cleared-is-absent', "a field edited to '' has no value, like one created empty", async () => {
      await Task().create(subject.dataset, { title: 'Assigned', assignee: 'Bob' });
      const cleared = await Task().create(subject.dataset, { title: 'Cleared', assignee: 'Ann' });
      await Task().update(subject.dataset, cleared.id, { assignee: '' });
      await expectOnlyAssigned();
    });
  });
}
