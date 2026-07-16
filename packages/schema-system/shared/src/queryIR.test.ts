import { describe, expect, it } from 'vitest';

import { validateQueryIR, type QueryIR } from './queryIR';

// The worked example from the IR spec: a post feed — text filter (title OR content), most-liked
// first, live, with the author hydrated and a per-row like count.
const feed: QueryIR = {
  irVersion: 1,
  entity: 'Post',
  filter: {
    or: [
      { field: 'title', op: 'contains', value: 'climate' },
      { field: 'content', op: 'contains', value: 'climate' },
    ],
  },
  aggregate: [
    { as: 'likeCount', over: 'signals', fn: 'count', filter: { field: 'signalTypeId', op: 'eq', value: 'like' } },
  ],
  sort: [{ by: 'likeCount', dir: 'desc' }],
  page: { limit: 20 },
  include: {
    author: true,
    signals: {
      filter: {
        and: [
          { field: 'signalTypeId', op: 'eq', value: 'like' },
          { field: 'author', op: 'eq', value: 'did:key:z6Mk' },
        ],
      },
      first: true,
    },
  },
  live: true,
};

describe('QueryIR', () => {
  it('validates the worked-example feed (nested filter tree, aggregate, include, sort-by-aggregate)', () => {
    const result = validateQueryIR(feed);
    expect(result.valid).toBe(true);
  });

  it('validates a minimal query', () => {
    expect(validateQueryIR({ irVersion: 1, entity: 'Post' }).valid).toBe(true);
  });

  it('rejects a wrong irVersion', () => {
    const r = validateQueryIR({ irVersion: 2, entity: 'Post' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].path).toBe('irVersion');
  });

  it('rejects an unknown filter operator', () => {
    const r = validateQueryIR({ irVersion: 1, entity: 'Post', filter: { field: 'title', op: 'like', value: 'x' } });
    expect(r.valid).toBe(false);
  });

  it('rejects a missing entity', () => {
    const r = validateQueryIR({ irVersion: 1 });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.some((e) => e.path === 'entity')).toBe(true);
  });

  it('accepts deeply nested boolean combinators and recursive includes', () => {
    const q: QueryIR = {
      irVersion: 1,
      entity: 'Channel',
      filter: { and: [{ or: [{ field: 'a', op: 'eq', value: 1 }] }, { not: { field: 'b', op: 'exists', value: true } }] },
      include: { conversations: { include: { messages: { page: { limit: 20 } } } } },
    };
    expect(validateQueryIR(q).valid).toBe(true);
  });
});
