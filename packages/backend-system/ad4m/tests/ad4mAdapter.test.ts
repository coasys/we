/**
 * The AD4M QueryAdapter — focus on the logic that isn't just `planQuery`/`irToFlatQuery`: the two
 * conditional degradations `plan()` folds in, and the `scope`→`parent` predicate resolution.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { EntityManifestEntry } from '@we/backend-ad4m';
import { createAd4mQueryAdapter, VERIFIED_AGAINST_AD4M } from '@we/backend-ad4m';
import type { QueryIR } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

// A minimal perspective manifest: Conversation has a `subgroupEntities` relation bound to a predicate.
const MODELS: EntityManifestEntry[] = [
  {
    name: 'Conversation',
    targetClass: 'flux://conversation',
    properties: [
      {
        name: 'subgroupEntities',
        predicate: 'ad4m://has_child',
        type: 'uri',
        isCollection: true,
        required: false,
        writable: true,
        relatedEntity: 'ConversationSubgroup',
      },
    ],
  },
];
const adapter = createAd4mQueryAdapter(() => MODELS);

const base = (extra: Partial<QueryIR>): QueryIR => ({ irVersion: 1, entity: 'Post', ...extra });

describe('adapter.plan — native cases (no gaps)', () => {
  it('scalar filter + single property sort + limit pushes down fully', () => {
    const ir = base({
      filter: { field: 'status', op: 'eq', value: 'active' },
      sort: [{ by: 'createdAt', dir: 'desc' }],
      page: { limit: 20 },
    });
    expect(adapter.plan(ir).gaps).toEqual([]);
  });

  it('a projection-count sort WITH a limit is native (AD4M pushes it down)', () => {
    const ir = base({
      sort: [{ by: '$likeCount', dir: 'desc' }],
      page: { limit: 20 },
      aggregate: [{ as: '$likeCount', over: 'likes', fn: 'count' }],
    });
    expect(adapter.plan(ir).gaps).toEqual([]);
  });
});

describe('adapter.plan — AD4M conditional degradations', () => {
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
    const features = adapter.plan(ir).gaps.map((g) => g.feature);
    expect(features).toContain('sort:under-boolean');
  });

  it('a projection sort WITHOUT a limit → sort:needs-limit', () => {
    const ir = base({
      sort: [{ by: '$likeCount', dir: 'desc' }],
      aggregate: [{ as: '$likeCount', over: 'likes', fn: 'count' }],
    });
    const features = adapter.plan(ir).gaps.map((g) => g.feature);
    expect(features).toContain('sort:needs-limit');
  });

  it('a relation-path sort WITHOUT a limit → sort:needs-limit', () => {
    const ir = base({ sort: [{ by: 'location.country', dir: 'asc' }] });
    const features = adapter.plan(ir).gaps.map((g) => g.feature);
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
    expect(adapter.plan(ir).gaps).toEqual([]);
  });

  it('classifies both quirks as `degraded`, not `compute-up`, and stays runnable', () => {
    // These are AD4M *bugs*: it returns the correct rows and silently ignores the ordering. Marking
    // them `compute-up` promised a JS fallback that nothing provides, so the renderer failed loud and
    // blocked working screens. `degraded` = run it, warn once.
    const underBoolean = base({
      filter: {
        or: [
          { field: 'a', op: 'eq', value: 1 },
          { field: 'b', op: 'eq', value: 2 },
        ],
      },
      sort: [{ by: 'createdAt', dir: 'desc' }],
      page: { limit: 20 },
    });
    const needsLimit = base({ sort: [{ by: 'location.country', dir: 'asc' }] });

    for (const ir of [underBoolean, needsLimit]) {
      const plan = adapter.plan(ir);
      expect(plan.runnable).toBe(true);
      expect(plan.gaps.every((g) => g.disposition === 'degraded')).toBe(true);
    }
  });

  it('an implicit conjunction (sibling where keys) + sort is native — NOT a degradation', () => {
    // Regression: `where: { a, b }` compiles to an `and` node, which an IR-level `'and' in filter`
    // check mistook for an explicit combinator — flagging a gap on the most ordinary query shape
    // there is and breaking the post list. It lowers back to sibling keys, which AD4M pushes down.
    const ir = base({
      filter: {
        and: [
          { field: 'type', op: 'eq', value: 'root' },
          { field: 'textContent', op: 'contains', value: 'x' },
        ],
      },
      sort: [{ by: 'createdAt', dir: 'desc' }],
      page: { limit: 20 },
    });
    expect(adapter.plan(ir).gaps).toEqual([]);
  });
});

describe('adapter.lower', () => {
  it('lowers to the flat dialect and omits `model` (selected via getEntity separately)', () => {
    const opts = adapter.lower(base({ filter: { field: 'status', op: 'eq', value: 'active' }, page: { limit: 5 } }));
    expect(opts).not.toHaveProperty('model');
    expect(opts).toMatchObject({ where: { status: 'active' }, limit: 5 });
  });
});

describe('adapter.lower — scope → parent (Tier-2 adapter-rewrite)', () => {
  const scopedIr = (): QueryIR => ({
    irVersion: 1,
    entity: 'ConversationSubgroup',
    scope: { anchor: 'Conversation', via: 'subgroupEntities', anchorId: 'c1' },
  });

  it('resolves scope.via on scope.anchor to the relation predicate → AD4M parent form', () => {
    const opts = adapter.lower(scopedIr());
    expect(opts).toMatchObject({ parent: { id: 'c1', predicate: 'ad4m://has_child' } });
    expect(opts).not.toHaveProperty('scope'); // consumed, not passed through
    expect(opts).not.toHaveProperty('model');
  });

  it('plan treats scope as native (AD4M does drill-down)', () => {
    expect(adapter.plan(scopedIr()).gaps).toEqual([]);
  });

  it('throws (surfaced, not silent) when the relation is not in the manifest', () => {
    const ir: QueryIR = {
      irVersion: 1,
      entity: 'X',
      scope: { anchor: 'Conversation', via: 'nope', anchorId: 'c1' },
    };
    expect(() => adapter.lower(ir)).toThrow(/cannot resolve scope/);
  });
});

describe('the capability profile and the executor it describes', () => {
  it('names the executor build it was checked against, and that is the one installed', () => {
    /*
      `ad4mCapabilities` and the two degradations in `plan()` are claims about somebody else's
      software, and nothing checks them at build time. `planQuery` is exact about what WE does with
      the answers and completely credulous about the answers themselves — so a release that changes
      AD4M's sort pushdown shows up as *wrong rows in the right shape*: a feed silently in the wrong
      order, a "top posts" list that is not. There is no error channel at all.

      The executor exposes no query-capability report to handshake against, so this is the next best
      thing: the pin moving without anybody re-checking the profile is exactly the silent case, and
      this makes it a loud one. When the pin moves, verify against a running executor — the tests
      above pin what the *planner* says, which is a different question — and move the constant.
    */
    const root = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8'),
    ) as { pnpm?: { overrides?: Record<string, string> } };

    const pinned = root.pnpm?.overrides?.['@coasys/ad4m'];
    expect(pinned, 'no @coasys/ad4m override in the root package.json').toBeTruthy();
    expect(pinned).toBe(VERIFIED_AGAINST_AD4M);
  });
});
