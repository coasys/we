/**
 * A snapshot keeps the rows it was given. `mutate` changes the table in place; the result a live
 * query already published must not change with it, or a consumer that compares rows by reference
 * sees the old snapshot and the new one as the same rows.
 */
import { describe, expect, it } from 'vitest';

import { createInMemoryBackend } from '../src';

describe('a live query on the in-memory backend', () => {
  it('holds rows detached from the table, so a later mutate leaves an earlier snapshot as it was', async () => {
    const backend = createInMemoryBackend({ id: 'ds', tables: { Item: [{ id: 'a', title: 'one' }] } });
    const entity = backend.stores.$getEntity('Item') as {
      query: (
        dataset: unknown,
        opts: Record<string, unknown>,
      ) => import('@we/backend-shared').LiveQuery<{ results: Record<string, unknown>[] }>;
    };
    const live = entity.query(undefined, {});
    const opened = await live.first;

    backend.mutate((tables) => {
      (tables.Item[0] as Record<string, unknown>).title = 'two';
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(opened.results[0].title).toBe('one');
    const next = live.getSnapshot().data!;
    expect(next.results[0].title).toBe('two');
    expect(next.results[0]).not.toBe(opened.results[0]);
    live.dispose();
  });
});
