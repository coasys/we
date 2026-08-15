/**
 * Hoisting a `$query` out of an items-taking token.
 *
 * The bug this exists for was silent in the worst way. `$query` has no branch in the prop
 * dispatcher — it is a subscription, not a value — so a site that fails to hoist hands the raw
 * `{ $query: … }` object to the token resolver, which reads it as a non-list. `$count` then returns
 * 0 and `$find` returns undefined, both indistinguishable from a query that genuinely matched
 * nothing. A call card counting its own utterances that way reported zero with the transcript
 * rendered directly beneath it.
 */
import { describe, expect, it } from 'vitest';

import { hoistQueryItems } from '../src/queryHoist';

const QUERY = { $query: { entity: 'TextBlock', scope: { anchor: 'CollectionBlock', via: 'children' } } };

/** Stands in for the real signal factory; records what it was asked to subscribe to. */
function factory() {
  const seen: unknown[] = [];
  const signal = () => [] as unknown[];
  return {
    seen,
    signal,
    create: ((descriptor: unknown) => {
      seen.push(descriptor);
      return signal;
    }) as never,
  };
}

const hoist = (value: unknown, f = factory()) => ({
  result: hoistQueryItems(value, {} as never, {}, f.create),
  f,
});

describe('hoistQueryItems', () => {
  it('replaces a $count over a query with a live signal', () => {
    const { result, f } = hoist({ $count: { items: QUERY } });
    expect(f.seen).toHaveLength(1);
    expect((result as { $count: { items: unknown } }).$count.items).toBe(f.signal);
  });

  it.each(['$map', '$count', '$find', '$some', '$every', '$filter'])('handles %s', (token) => {
    const { result, f } = hoist({ [token]: { items: QUERY } });
    expect(f.seen).toHaveLength(1);
    expect((result as Record<string, { items: unknown }>)[token].items).toBe(f.signal);
  });

  it('reaches a query nested inside a condition, which is where the section bug lived', () => {
    const { result, f } = hoist({ $if: { condition: { $count: { items: QUERY } }, then: 'yes' } });
    expect(f.seen).toHaveLength(1);
    const condition = (result as { $if: { condition: { $count: { items: unknown } } } }).$if.condition;
    expect(condition.$count.items).toBe(f.signal);
  });

  it('reaches into arrays', () => {
    const { result, f } = hoist([{ $count: { items: QUERY } }, 'untouched']);
    expect(f.seen).toHaveLength(1);
    expect((result as [{ $count: { items: unknown } }, string])[1]).toBe('untouched');
  });

  it('leaves a token whose items are not a query alone', () => {
    const input = { $count: { items: '$call.children' } };
    const { result, f } = hoist(input);
    expect(f.seen).toHaveLength(0);
    expect(result).toBe(input);
  });

  it('returns the same object when there is nothing to hoist', () => {
    // Identity matters: this walks every prop of every node, and rebuilding untouched structures
    // would defeat the memo comparisons downstream.
    const input = { props: { width: '100%', nested: { deep: [1, 2, 3] } } };
    expect(hoist(input).result).toBe(input);
  });

  it('subscribes once per query, not once per traversal step', () => {
    const { f } = hoist({ a: { $count: { items: QUERY } }, b: { $find: { items: QUERY } } });
    expect(f.seen).toHaveLength(2);
  });

  it('passes primitives and null through untouched', () => {
    expect(hoist(null).result).toBeNull();
    expect(hoist('plain').result).toBe('plain');
    expect(hoist(7).result).toBe(7);
  });
});

describe('composed items-taking tokens', () => {
  /*
    The calendar's day cell, exactly: "are any of this month's events on my date". Two items-taking
    tokens nested, with the query at the bottom.

    The walk used to stop at the outer token the moment its own `items` was not a query, so the
    inner one was never reached and the count came back 0 — every cell deciding nothing happened
    that day, on a month with events in it.
  */
  it('hoists a query nested one items-token deeper', () => {
    const { result, f } = hoist({
      $count: { items: { $filter: { items: QUERY, where: { startDate: { startsWith: '2026-08-15' } } } } },
    });

    expect(f.seen).toHaveLength(1);
    const inner = (result as { $count: { items: { $filter: { items: unknown; where: unknown } } } }).$count.items;
    expect(inner.$filter.items).toBe(f.signal);
    // The rest of the spec survives the rebuild — a filter that lost its `where` would match
    // everything and dot every day of the month.
    expect(inner.$filter.where).toEqual({ startDate: { startsWith: '2026-08-15' } });
  });

  it('leaves a token alone when there is no query anywhere beneath it', () => {
    const value = { $count: { items: { $filter: { items: { $local: 'rows' } } } } };
    expect(hoist(value).result).toBe(value);
  });
});
