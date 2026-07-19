/**
 * The AD4M QueryAdapter — focus on the logic that isn't just `planQuery`/`irToFlatQuery`: the two
 * conditional degradations `plan()` folds in, which no capability boolean can express.
 */
import type { QueryIR } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { ad4mQueryAdapter } from '../src/shared/ad4mAdapter';

const base = (extra: Partial<QueryIR>): QueryIR => ({ irVersion: 1, entity: 'Post', ...extra });

describe('ad4mQueryAdapter.plan — native cases (no gaps)', () => {
  it('scalar filter + single property sort + limit pushes down fully', () => {
    const ir = base({
      filter: { field: 'status', op: 'eq', value: 'active' },
      sort: [{ by: 'createdAt', dir: 'desc' }],
      page: { limit: 20 },
    });
    expect(ad4mQueryAdapter.plan(ir).gaps).toEqual([]);
  });

  it('a projection-count sort WITH a limit is native (AD4M pushes it down)', () => {
    const ir = base({
      sort: [{ by: '$likeCount', dir: 'desc' }],
      page: { limit: 20 },
      aggregate: [{ as: '$likeCount', over: 'likes', fn: 'count' }],
    });
    expect(ad4mQueryAdapter.plan(ir).gaps).toEqual([]);
  });
});

describe('ad4mQueryAdapter.plan — AD4M conditional degradations', () => {
  it('OR in where + a sort → sort:under-boolean (AD4M drops the sort pushdown)', () => {
    const ir = base({
      filter: {
        or: [
          { field: 'a', op: 'eq', value: 1 },
          { field: 'b', op: 'eq', value: 2 },
        ],
      },
      sort: [{ by: 'createdAt', dir: 'desc' }],
      page: { limit: 20 },
    });
    const features = ad4mQueryAdapter.plan(ir).gaps.map((g) => g.feature);
    expect(features).toContain('sort:under-boolean');
  });

  it('a projection sort WITHOUT a limit → sort:needs-limit', () => {
    const ir = base({
      sort: [{ by: '$likeCount', dir: 'desc' }],
      aggregate: [{ as: '$likeCount', over: 'likes', fn: 'count' }],
    });
    const features = ad4mQueryAdapter.plan(ir).gaps.map((g) => g.feature);
    expect(features).toContain('sort:needs-limit');
  });

  it('a relation-path sort WITHOUT a limit → sort:needs-limit', () => {
    const ir = base({ sort: [{ by: 'location.country', dir: 'asc' }] });
    const features = ad4mQueryAdapter.plan(ir).gaps.map((g) => g.feature);
    expect(features).toContain('sort:needs-limit');
  });

  it('no sort → no degradation gaps even under OR', () => {
    const ir = base({
      filter: {
        or: [
          { field: 'a', op: 'eq', value: 1 },
          { field: 'b', op: 'eq', value: 2 },
        ],
      },
    });
    expect(ad4mQueryAdapter.plan(ir).gaps).toEqual([]);
  });
});

describe('ad4mQueryAdapter.lower', () => {
  it('lowers to the flat dialect and omits `model` (selected via getModel separately)', () => {
    const opts = ad4mQueryAdapter.lower(
      base({ filter: { field: 'status', op: 'eq', value: 'active' }, page: { limit: 5 } }),
    );
    expect(opts).not.toHaveProperty('model');
    expect(opts).toMatchObject({ where: { status: 'active' }, limit: 5 });
  });
});
