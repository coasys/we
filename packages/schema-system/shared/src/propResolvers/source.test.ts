/**
 * `$source` — computed rows, reachable from JSON by name.
 *
 * The behaviour worth pinning is mostly about what it *is not*: not a subscription, so it resolves
 * anywhere a value does; not a fetch, so a failure is a reported empty list rather than a thrown
 * render; and not privileged, so its options go through the ordinary resolver and can be tokens.
 */
import { describe, expect, it } from 'vitest';

import { resolveProp } from './index';
import { REACTIVE_ACCESSOR } from './reactive';

const days = (options: Record<string, unknown>) =>
  Array.from({ length: Number(options.count ?? 0) }, (_, index) => ({ day: index + 1 }));

const stores = { $sources: { days } };

/** Resolvers return accessors for reactive results; unwrap the way the renderer does. */
function rows(value: unknown, context: Record<string, unknown> = {}, s: Record<string, unknown> = stores): unknown {
  const resolved = resolveProp(value, s, context);
  return typeof resolved === 'function' ? (resolved as () => unknown)() : resolved;
}

describe('$source', () => {
  it('returns the rows the registered function produces', () => {
    expect(rows({ $source: { name: 'days', options: { count: 3 } } })).toEqual([{ day: 1 }, { day: 2 }, { day: 3 }]);
  });

  it('resolves its options through the dispatcher, so they can be tokens', () => {
    // The point of this: "next month" is a `$setLocal` or a store read, not state hidden inside a
    // component — so the memo re-runs when the argument changes.
    const result = rows(
      { $source: { name: 'days', options: { count: { $store: 'settings.howMany' } } } },
      {},
      {
        ...stores,
        settings: { howMany: 2 },
      },
    );
    expect(result).toEqual([{ day: 1 }, { day: 2 }]);
  });

  it('works with no options at all', () => {
    expect(rows({ $source: { name: 'days' } })).toEqual([]);
  });

  it('is marked reactive when a real memo is supplied, so $count and $find unwrap it', () => {
    // With the default `noMemo` the result is eager — `noMemo` calls the thunk and returns the
    // value, so there is no accessor to mark. Under Solid's `createMemo` it is an accessor, and the
    // mark is what makes `$count` call it rather than treating a function as a non-list.
    const asMemo = <T>(fn: () => T) => fn as unknown as T;
    const resolved = resolveProp({ $source: { name: 'days', options: { count: 2 } } }, stores, {}, asMemo);
    expect(typeof resolved).toBe('function');
    expect(REACTIVE_ACCESSOR in (resolved as object)).toBe(true);
  });

  it('counts, which is the composition a section condition needs', () => {
    const value = resolveProp({ $count: { items: { $source: { name: 'days', options: { count: 4 } } } } }, stores, {});
    expect(value).toBe(4);
  });

  it('reports an unregistered source and degrades to nothing', () => {
    // A template naming a source this deployment did not register should render nothing, the way a
    // query against an unreachable backend does — not take the screen down.
    const errors: string[] = [];
    const result = rows({ $source: { name: 'nope' } }, {}, { ...stores, $onError: (m: string) => errors.push(m) });
    expect(result).toBeUndefined();
    expect(errors[0]).toContain('nope');
  });

  it('reports a throwing source and degrades to empty', () => {
    const errors: string[] = [];
    const result = rows(
      { $source: { name: 'boom' } },
      {},
      {
        $sources: {
          boom: () => {
            throw new Error('bad options');
          },
        },
        $onError: (m: string) => errors.push(m),
      },
    );
    expect(result).toBeUndefined();
    expect(errors[0]).toContain('bad options');
  });

  it('degrades to nothing when the host registered no sources at all', () => {
    expect(rows({ $source: { name: 'days' } }, {}, {})).toBeUndefined();
  });

  it('returns a computed scalar unchanged, not only rows', () => {
    // Rows are the motivating case and not the only one: a month grid needs its days *and* a label
    // for the month and a way to step to the next. A second token for computed scalars would be a
    // worse answer than letting this one return what it computes.
    const result = rows(
      { $source: { name: 'label', options: { month: 8 } } },
      {},
      {
        $sources: { label: (o: Record<string, unknown>) => `Month ${o.month}` },
      },
    );
    expect(result).toBe('Month 8');
  });
});
