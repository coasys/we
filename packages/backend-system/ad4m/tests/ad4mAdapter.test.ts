/**
 * The AD4M QueryAdapter — focus on the logic that isn't just `planQuery`/`irToFlatQuery`: the two
 * conditional degradations `plan()` folds in, and the `scope`→`parent` predicate resolution.
 */

import type { EntityManifestEntry } from '@we/backend-ad4m';
import { ad4mCapabilities, createAd4mQueryAdapter } from '@we/backend-ad4m';
import { CONTAINMENT_PREDICATE, type Filter, type IncludeMap, type QueryIR, type Scope } from '@we/backend-shared';
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

  it('a numeric range bound is native, and a string one is refused rather than matching nothing', () => {
    expect(adapter.plan(base({ filter: { field: 'price', op: 'gte', value: 10 } })).gaps).toEqual([]);
    const plan = adapter.plan(base({ filter: { field: 'dueDate', op: 'lt', value: '2026-10-01' } }));
    expect(plan.gaps).toContainEqual(expect.objectContaining({ feature: 'operator:lt:string' }));
  });

  it('a relation quantifier is native — it compiles to a SPARQL EXISTS group', () => {
    expect(adapter.plan(base({ filter: { rel: 'comments', op: 'none' } })).gaps).toEqual([]);
    expect(
      adapter.plan(base({ filter: { rel: 'comments', op: 'some', where: { field: 'body', op: 'eq', value: 'x' } } }))
        .gaps,
    ).toEqual([]);
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
  it('OR in where + a sort is native now — the pushdown survives a combinator', () => {
    // This asserted `sort:under-boolean` until the executor's where clause got a single compiler:
    // `all_where_pushable` is now that compiler's own completeness flag, and OR and NOT compile, so
    // there is no longer a pushdown to lose. Kept rather than deleted because the shape is worth
    // holding — a feed filtering on either of two fields and sorting by date is ordinary.
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
    expect(adapter.plan(ir).gaps).toEqual([]);
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

  it('a projection with a select, at any depth → refused, not sent with the select dropped', () => {
    const projection = { over: 'replies', select: ['body'] };
    const includes: IncludeMap[] = [{ $latest: projection }, { children: { include: { $latest: projection } } }];
    for (const include of includes) {
      const plan = adapter.plan(base({ include }));
      expect(plan.gaps.map((g) => g.feature)).toContain('projection:select');
      expect(plan.runnable).toBe(false);
    }
    expect(adapter.plan(base({ include: { children: { select: ['body'] } } })).gaps).toEqual([]);
  });

  it("a projection's or a count's where beyond equality, at any depth → refused, not sent with it dropped", () => {
    const beyond: Filter[] = [
      { field: 'stars', op: 'gt', value: 3 },
      { field: 'stars', op: 'ne', value: 1 },
      { field: 'body', op: 'contains', value: 'x' },
      {
        or: [
          { field: 'stars', op: 'eq', value: 1 },
          { field: 'stars', op: 'eq', value: 5 },
        ],
      },
      { not: { field: 'stars', op: 'eq', value: 1 } },
      { rel: 'author', op: 'some', where: { field: 'name', op: 'eq', value: 'a' } },
    ];
    for (const filter of beyond) {
      const shapes: Partial<QueryIR>[] = [
        { include: { $good: { over: 'replies', filter } } },
        { aggregate: [{ as: '$good', over: 'replies', fn: 'count', filter }] },
        { include: { children: { aggregate: [{ as: '$good', over: 'replies', fn: 'count', filter }] } } },
      ];
      for (const shape of shapes) {
        const plan = adapter.plan(base(shape));
        expect(
          plan.gaps.map((g) => g.feature),
          JSON.stringify(shape),
        ).toContain('projection:where');
        expect(plan.runnable).toBe(false);
      }
    }
    // Equality, a list, and several fields named once each compile.
    const equality: Filter = {
      and: [
        { field: 'kind', op: 'eq', value: 'reply' },
        { field: 'author', op: 'in', value: ['a', 'b'] },
      ],
    };
    expect(adapter.plan(base({ include: { $mine: { over: 'replies', filter: equality } } })).gaps).toEqual([]);
    expect(
      adapter.plan(base({ aggregate: [{ as: '$n', over: 'replies', fn: 'count', filter: equality }] })).gaps,
    ).toEqual([]);
    // A sub-query include is not a projection: its where is the top-level grammar.
    expect(adapter.plan(base({ include: { children: { filter: beyond[0] } } })).gaps).toEqual([]);
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

  it('classifies the remaining quirk as `degraded`, not `compute-up`, and stays runnable', () => {
    // This is an AD4M *bug*: it returns the correct rows and silently ignores the ordering. Marking
    // it `compute-up` promised a JS fallback that nothing provides, so the renderer failed loud and
    // blocked working screens. `degraded` = run it, warn once.
    const plan = adapter.plan(base({ sort: [{ by: 'location.country', dir: 'asc' }] }));
    expect(plan.runnable).toBe(true);
    expect(plan.gaps.every((g) => g.disposition === 'degraded')).toBe(true);
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

describe('adapter.lower — select', () => {
  /**
   * `Ad4mModel` names the field list `properties`. Passed as `select`, it is ignored and the executor
   * answers with every field — relation id lists included, which on a container is everything in it.
   */
  it('names the field list the way the model reads it, at the root and on a relation sub-query', () => {
    const opts = adapter.lower(
      base({
        select: ['title'],
        include: { signals: { select: ['value'] } },
        aggregate: [{ fn: 'count', over: 'signals', as: '$signalCount' }],
      }),
    ) as Record<string, unknown>;
    expect(opts.properties).toEqual(['title']);
    expect(opts).not.toHaveProperty('select');
    const include = opts.include as Record<string, Record<string, unknown>>;
    expect(include.signals).toMatchObject({ properties: ['value'] });
    expect(include.signals).not.toHaveProperty('select');
    // A projection takes no field list, and is passed on as it was.
    expect(include.$signalCount).toEqual({ from: 'signals', count: true });
  });

  it('asks for every field when nothing is selected', () => {
    expect(adapter.lower(base({}))).not.toHaveProperty('properties');
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

  it('stores a core containment scope under AD4M’s has_child, whichever form it lowers to', () => {
    // A core entry names containment by its neutral key; the query has to read the predicate the
    // models wrote, or every drill-down into a container answers empty.
    const core = createAd4mQueryAdapter(() => [
      {
        name: 'CollectionBlock',
        targetClass: 'we://collection_block',
        properties: [
          {
            name: 'children',
            predicate: CONTAINMENT_PREDICATE,
            type: 'uri',
            isCollection: true,
            required: false,
            writable: true,
          },
        ],
      },
    ]);
    const scoped = (extra: Partial<Scope> = {}): QueryIR => ({
      irVersion: 1,
      entity: 'TextBlock',
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: 'c1', ...extra },
    });
    expect(core.lower(scoped())).toMatchObject({ parent: { id: 'c1', predicate: 'ad4m://has_child' } });
    expect(core.lower(scoped({ levels: [10, 5] }))).toMatchObject({
      parent: { ids: ['c1'], predicate: 'ad4m://has_child', levels: [10, 5] },
    });
  });

  it('asks incoming links for a reverse relation — a belongsTo’s children point at the anchor', () => {
    /*
      `Author.posts` is declared `belongsToMany`: the link lives on the post (`post.author →
      author`), so the author's posts arrive over the anchor's *incoming* links. The plain
      `{ id, predicate }` form walks only the outgoing ones and would answer every belongsTo
      drill with nothing — which is exactly what a relation tree pulling `Author.posts`
      children saw on AD4M. The traverse form carries `direction: 'in'`.
    */
    const withReverse = createAd4mQueryAdapter(() => [
      {
        name: 'Author',
        targetClass: 'flux://author',
        properties: [
          {
            name: 'posts',
            predicate: 'flux://wrote',
            type: 'uri',
            isCollection: true,
            required: false,
            writable: true,
            relatedEntity: 'Post',
            reverse: true,
          },
        ],
      },
    ]);
    const opts = withReverse.lower({
      irVersion: 1,
      entity: 'Post',
      scope: { anchor: 'Author', via: 'posts', anchorId: 'a1' },
    });
    expect(opts).toMatchObject({ parent: { ids: ['a1'], predicate: 'flux://wrote', direction: 'in' } });
  });

  it('reads an inbound scope through the result’s own relation when the anchor does not declare it', () => {
    /*
      "What points at this topic through `about`": `about` is the position's field, not the topic's.
      `direction: 'in'` reads `result --via--> anchor`, so `via` belongs to the entity being read —
      looked up on the anchor alone, the graph's backward read (`entityExpander`) threw for every
      relation a class holds toward another.
    */
    const inbound = createAd4mQueryAdapter(() => [
      { name: 'Topic', targetClass: 'x://topic', properties: [] },
      {
        name: 'Position',
        targetClass: 'x://position',
        properties: [
          {
            name: 'about',
            predicate: 'x://about',
            type: 'uri',
            isCollection: false,
            required: false,
            writable: true,
            relatedEntity: 'Topic',
          },
        ],
      },
    ]);
    const opts = inbound.lower({
      irVersion: 1,
      entity: 'Position',
      scope: { anchor: 'Topic', via: 'about', anchorId: ['t1', 't2'], direction: 'in' },
    });
    expect(opts).toMatchObject({ parent: { ids: ['t1', 't2'], predicate: 'x://about', direction: 'in' } });
  });

  it('reads an inbound scope through the result’s relation when anchor and result both declare the name', () => {
    // Both classes hold an `about`, over different predicates. `result --about--> anchor` is the result's.
    const prop = (predicate: string, relatedEntity: string) => ({
      name: 'about',
      predicate,
      type: 'uri' as const,
      isCollection: false,
      required: false,
      writable: true,
      relatedEntity,
    });
    const both = createAd4mQueryAdapter(() => [
      { name: 'Topic', targetClass: 'x://topic', properties: [prop('x://topic_about', 'Topic')] },
      { name: 'Position', targetClass: 'x://position', properties: [prop('x://position_about', 'Topic')] },
    ]);
    const opts = both.lower({
      irVersion: 1,
      entity: 'Position',
      scope: { anchor: 'Topic', via: 'about', anchorId: ['t1'], direction: 'in' },
    });
    expect(opts).toMatchObject({ parent: { predicate: 'x://position_about', direction: 'in' } });
  });

  it('reads, for a scope naming no anchor, the relation called `via` that holds the query entity', () => {
    const rel = (predicate: string, relatedEntity: string) => ({
      name: 'sections',
      predicate,
      type: 'uri' as const,
      isCollection: true,
      required: false,
      writable: true,
      relatedEntity,
    });
    const models = (...entries: Array<[string, ReturnType<typeof rel>]>) =>
      createAd4mQueryAdapter(() =>
        entries.map(([name, property]) => ({ name, targetClass: `x://${name}`, properties: [property] })),
      );
    const scoped = (scope: Partial<Scope> = {}): QueryIR => ({
      irVersion: 1,
      entity: 'Section',
      scope: { via: 'sections', anchorId: 'r1', ...scope },
    });

    // One entity's `sections` holds sections; another's of the same name holds something else.
    const one = models(['Book', rel('x://book_sections', 'Section')], ['Shelf', rel('x://shelf_sections', 'Shelf')]);
    expect(one.lower(scoped())).toMatchObject({ parent: { id: 'r1', predicate: 'x://book_sections' } });
    // Two that agree on the predicate are one relation.
    const agree = models(['Book', rel('x://sections', 'Section')], ['Part', rel('x://sections', 'Section')]);
    expect(agree.lower(scoped())).toMatchObject({ parent: { predicate: 'x://sections' } });
    // Two that disagree are ambiguous, and refused rather than read along the first found.
    const disagree = models(
      ['Book', rel('x://book_sections', 'Section')],
      ['Part', rel('x://part_sections', 'Section')],
    );
    expect(() => disagree.lower(scoped())).toThrow(/cannot resolve scope/);
    // A named anchor still decides, whatever else declares the name.
    expect(disagree.lower(scoped({ anchor: 'Part' }))).toMatchObject({ parent: { predicate: 'x://part_sections' } });
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
  it('does not claim `exists`, which the executor has no operator for', () => {
    // Not a preference. `WhereOps` declares no `exists` and uses `deny_unknown_fields`, so
    // `{ field: { exists: true } }` is re-read as a nested where clause, compiles incomplete, and
    // reaches the post-hydration filter — where a `SubClause` at a value comparison returns false.
    // Every row is rejected and the query answers nothing, always, with no error.
    //
    // Claiming it here made that outcome silent. Refusing the query is worse than working and better
    // than lying, and it is what makes the gap findable when somebody reaches for the operator.
    expect(ad4mCapabilities.operators).not.toContain('exists');
    const plan = adapter.plan(base({ filter: { field: 'retired', op: 'exists', value: false } }));
    expect(plan.gaps.map((g) => g.feature)).toContain('operator:exists');
  });
});
