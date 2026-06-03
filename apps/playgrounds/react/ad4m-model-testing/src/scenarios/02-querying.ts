// Phase 3c — validates JSON-first Query<T> and fluent ModelQueryBuilder
import type { PerspectiveProxy } from '@coasys/ad4m';

import { assert, test, wipePerspective } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestPost } from '../models/TestPost';

export const scenario: ScenarioModule = {
  name: '02 — Querying',
  run: async (perspective: PerspectiveProxy) => {
    await wipePerspective(perspective);
    await TestPost.register(perspective);

    // Seed three posts with distinct titles for ordering / filtering tests
    const p1 = await TestPost.create(perspective, { title: 'Alpha', body: 'first' });
    const p2 = await TestPost.create(perspective, { title: 'Beta', body: 'second' });
    const p3 = await TestPost.create(perspective, { title: 'Gamma', body: 'third' });

    return [
      await test('findAll() with where.id returns only the matching instance', async () => {
        const results = await TestPost.findAll(perspective, { where: { id: p1.id } });
        assert(results.length === 1, `Expected 1, got ${results.length}`);
        assert(results[0].title === 'Alpha', `Expected 'Alpha', got '${results[0].title}'`);
      }),

      await test('findAll() with order: title ASC sorts alphabetically', async () => {
        const results = await TestPost.findAll(perspective, { order: { title: 'ASC' } });
        const titles = results.map((r) => r.title);
        const sorted = [...titles].sort();
        assert(JSON.stringify(titles) === JSON.stringify(sorted), `Not sorted ASC: ${JSON.stringify(titles)}`);
      }),

      await test('findAll() with order: title DESC reverse-sorts', async () => {
        const results = await TestPost.findAll(perspective, { order: { title: 'DESC' } });
        const titles = results.map((r) => r.title);
        const reversed = [...titles].sort().reverse();
        assert(JSON.stringify(titles) === JSON.stringify(reversed), `Not sorted DESC: ${JSON.stringify(titles)}`);
      }),

      await test('findAll() with limit returns at most that many results', async () => {
        const results = await TestPost.findAll(perspective, { limit: 2 });
        assert(results.length <= 2, `Expected ≤2, got ${results.length}`);
      }),

      await test('findAll() with offset skips the first N results', async () => {
        const all = await TestPost.findAll(perspective);
        const paged = await TestPost.findAll(perspective, { offset: 1 });
        assert(paged.length === all.length - 1, `Expected ${all.length - 1}, got ${paged.length}`);
      }),

      await test('findOne() returns the matching instance or null', async () => {
        const found = await TestPost.findOne(perspective, { where: { id: p2.id } });
        assert(found !== null, 'findOne should return a result');
        assert(found.title === 'Beta', `Expected 'Beta', got '${found?.title}'`);
        const missing = await TestPost.findOne(perspective, { where: { id: 'literal://string:no-such-id' } });
        assert(missing === null, 'findOne should return null for missing id');
      }),

      await test('fluent .query().where().get() matches JSON findAll()', async () => {
        const json = await TestPost.findAll(perspective, { where: { id: p3.id } });
        const fluent = await TestPost.query(perspective).where({ id: p3.id }).get();
        assert(json.length === fluent.length, `Result count mismatch: JSON=${json.length} fluent=${fluent.length}`);
        assert(
          json.every((j, i) => j.id === fluent[i].id),
          'ID mismatch between JSON and fluent results',
        );
      }),

      await test('Query<T> objects are composable with spread', async () => {
        const base = { order: { title: 'ASC' as const } };
        const withLimit = { ...base, limit: 2 };
        const results = await TestPost.findAll(perspective, withLimit);
        assert(results.length <= 2, `Expected ≤2, got ${results.length}`);
        const titles = results.map((r) => r.title);
        const sorted = [...titles].sort();
        assert(JSON.stringify(titles) === JSON.stringify(sorted), `Not sorted: ${JSON.stringify(titles)}`);
      }),
    ];
  },
};
