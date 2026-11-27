/**
 * A `json` property holds a value: a list or an object is written as one and reads back as one,
 * through the class a store writes with and through the handle a template reads with alike.
 *
 * The cases write `Space` records, whose settings are `json` — `enabledViews` an ordered list,
 * `moduleSettings` an object keyed by group.
 */
import type { DatasetHandle, RendererDataBindings } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ConformanceHarness, ConformanceSubject } from './index';

export const JSON_VALUE_CASES = ['json.round-trips', 'json.replaced-whole'] as const;

export type JsonValueCase = (typeof JSON_VALUE_CASES)[number];

interface Row {
  id: string;
  [field: string]: unknown;
}

interface Model {
  create(dataset: DatasetHandle, data?: Record<string, unknown>): Promise<Row>;
  update(dataset: DatasetHandle, id: string, data: Record<string, unknown>): Promise<unknown>;
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Row[]>;
}

export function describeJsonValues(name: string, harness: ConformanceHarness, timeout: number): void {
  describe(`backend conformance: ${name} — json values`, () => {
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

    const Space = () => getEntity('Space') as unknown as Model;
    /** One space by id, read both ways: as a store reads it, and as a template does. */
    const readBoth = async (id: string) => {
      const reader = bindings.$getEntity!('Space') as unknown as Model;
      const [stored] = await Space().findAll(subject.dataset, { where: { id } });
      const [drawn] = await reader.findAll(subject.dataset, { where: { id } });
      return [stored, drawn];
    };

    const test = (id: JsonValueCase, title: string, body: () => Promise<void>) => {
      const gap = harness.knownGaps?.[id];
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, timeout);
      else it(title, body, timeout);
    };

    test('json.round-trips', 'a list and an object written to json properties read back as values', async () => {
      const created = await Space().create(subject.dataset, {
        name: 'Values',
        enabledViews: ['posts', 'board', 'calendar'],
        moduleSettings: { call: { recording: true, quality: 2 } },
      });
      for (const row of await readBoth(created.id)) {
        expect(row.enabledViews).toEqual(['posts', 'board', 'calendar']);
        expect(row.moduleSettings).toEqual({ call: { recording: true, quality: 2 } });
        // Never written, so absent: a json property has no default to read back.
        expect(row.archivedWorkflows ?? undefined).toBeUndefined();
      }
    });

    test(
      'json.replaced-whole',
      'an edit replaces the value whole, keeping a new order and an empty list, and an empty write clears it',
      async () => {
        const created = await Space().create(subject.dataset, {
          name: 'Edited',
          enabledViews: ['posts', 'board'],
          extractionTargets: ['TaskBlock'],
          moduleSettings: { call: { recording: true } },
        });
        await Space().update(subject.dataset, created.id, {
          enabledViews: ['board', 'posts'],
          extractionTargets: [],
          moduleSettings: '',
        });
        for (const row of await readBoth(created.id)) {
          expect(row.enabledViews).toEqual(['board', 'posts']);
          // An empty list is a value — "none" — which is not the same as never having said.
          expect(row.extractionTargets).toEqual([]);
          expect(row.moduleSettings ?? undefined).toBeUndefined();
        }
      },
    );
  });
}
