import { describe, expect, it } from 'vitest';

import { type AdapterCapabilities, planQuery } from './queryCapabilities';
import type { QueryIR } from './queryIR';

// A fully-featured adapter (SPARQL-like): everything native.
const full: AdapterCapabilities = {
  operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'exists'],
  booleanCombinators: true,
  relationFilters: true,
  include: { supported: true },
  aggregate: ['count', 'sum', 'min', 'max', 'avg'],
  sort: { multiKey: true, byRelationPath: true, byAggregate: true },
  pagination: ['offset', 'cursor'],
  live: 'push',
};

// A minimal L1-ish adapter: flat equality reads, no include/aggregate/combinators, poll-only.
const minimal: AdapterCapabilities = {
  operators: ['eq'],
  booleanCombinators: false,
  relationFilters: false,
  include: { supported: false },
  aggregate: [],
  sort: { multiKey: false, byRelationPath: false, byAggregate: false },
  pagination: ['offset'],
  live: 'poll',
};

const feed: QueryIR = {
  irVersion: 1,
  entity: 'Post',
  filter: {
    or: [
      { field: 'title', op: 'contains', value: 'x' },
      { field: 'content', op: 'contains', value: 'x' },
    ],
  },
  aggregate: [{ as: 'likeCount', over: 'signals', fn: 'count' }],
  sort: [
    { by: 'likeCount', dir: 'desc' },
    { by: 'author.name', dir: 'asc' },
  ],
  include: { author: true, signals: { first: true } },
  live: true,
};

describe('planQuery', () => {
  it('a full-featured adapter runs the feed with everything native (no gaps)', () => {
    const plan = planQuery(feed, full);
    expect(plan.runnable).toBe(true);
    expect(plan.gaps).toEqual([]);
  });

  it('a minimal adapter runs the feed via compute-up fallbacks (runnable, but with gaps)', () => {
    const plan = planQuery(feed, minimal);
    expect(plan.runnable).toBe(true); // nothing is unsupported — all compute-up
    const features = plan.gaps.map((g) => g.feature).sort();
    // or/contains/include/aggregate/multi-key + relation-path sort + poll fallback all fall to compute-up
    expect(features).toContain('booleanCombinators');
    expect(features).toContain('operator:contains');
    expect(features).toContain('include');
    expect(features).toContain('aggregate:count');
    expect(features).toContain('sort:multiKey');
    expect(features).toContain('sort:byAggregate');
    expect(features).toContain('sort:byRelationPath');
    expect(features).toContain('live:push'); // poll fallback
    expect(plan.gaps.every((g) => g.disposition === 'compute-up')).toBe(true);
  });

  it('cursor pagination on a cursor-less adapter is UNSUPPORTED (hard fail, not fakeable)', () => {
    const q: QueryIR = { irVersion: 1, entity: 'Post', page: { limit: 10, after: 'abc' } };
    const plan = planQuery(q, minimal);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps).toContainEqual(
      expect.objectContaining({ feature: 'pagination:cursor', disposition: 'unsupported' }),
    );
  });

  it('a live query on a no-change-feed adapter is UNSUPPORTED', () => {
    const noneLive: AdapterCapabilities = { ...minimal, live: 'none' };
    const q: QueryIR = { irVersion: 1, entity: 'Post', live: true };
    const plan = planQuery(q, noneLive);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps).toContainEqual(expect.objectContaining({ feature: 'live:none', disposition: 'unsupported' }));
  });

  it('offset on an offset-capable adapter is native; a bare limit needs nothing', () => {
    expect(planQuery({ irVersion: 1, entity: 'Post', page: { limit: 10, offset: 20 } }, minimal).gaps).toEqual([]);
    expect(planQuery({ irVersion: 1, entity: 'Post', page: { limit: 10 } }, minimal).gaps).toEqual([]);
  });

  it('scope (drill-down) is native with relation filters, compute-up without them', () => {
    const q: QueryIR = { irVersion: 1, entity: 'Conversation', scope: { via: 'conversations', anchorId: 'ch1' } };
    expect(planQuery(q, full).gaps.some((g) => g.feature === 'scope')).toBe(false);
    const noRelFilters: AdapterCapabilities = { ...full, relationFilters: false };
    const plan = planQuery(q, noRelFilters);
    expect(plan.runnable).toBe(true); // compute-up, not a hard fail
    expect(plan.gaps).toContainEqual(expect.objectContaining({ feature: 'scope', disposition: 'compute-up' }));
  });
});
