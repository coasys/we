import { describe, expect, it } from 'vitest';

import type { EntityManifest } from './manifest';
import type { QueryIR } from './queryIR';
import { validateQueryAgainstManifest } from './queryValidation';

// A small WE-ish manifest to validate queries against.
const manifest: EntityManifest = {
  version: '1',
  entities: {
    Post: {
      properties: { title: { type: 'string' }, content: { type: 'string' }, createdAt: { type: 'datetime' } },
      relations: {
        author: { target: 'Agent', cardinality: 'one', reverseOf: 'posts' },
        signals: { target: 'Signal', cardinality: 'many' },
      },
    },
    Agent: {
      properties: { name: { type: 'string' } },
      relations: { posts: { target: 'Post', cardinality: 'many', reverseOf: 'author' } },
    },
    Signal: {
      properties: { signalTypeId: { type: 'string' }, author: { type: 'string' }, value: { type: 'number' } },
      relations: {},
    },
  },
};

// The worked-example feed, this time validated against the manifest above.
const feed: QueryIR = {
  irVersion: 1,
  entity: 'Post',
  filter: {
    or: [
      { field: 'title', op: 'contains', value: 'x' },
      { field: 'content', op: 'contains', value: 'x' },
    ],
  },
  aggregate: [
    { as: 'likeCount', over: 'signals', fn: 'count', filter: { field: 'signalTypeId', op: 'eq', value: 'like' } },
  ],
  sort: [
    { by: 'likeCount', dir: 'desc' },
    { by: 'author.name', dir: 'asc' },
  ],
  include: {
    author: true,
    signals: { filter: { field: 'signalTypeId', op: 'eq', value: 'like' }, first: true },
  },
};

const ok = (q: QueryIR) => validateQueryAgainstManifest(q, manifest);

describe('validateQueryAgainstManifest', () => {
  it('accepts the worked-example feed (aggregate, sort-by-aggregate + relation path, nested include)', () => {
    expect(ok(feed).valid).toBe(true);
  });

  it('rejects an unknown entity', () => {
    const r = ok({ irVersion: 1, entity: 'Ghost' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('unknown entity "Ghost"');
  });

  it('rejects a filter on a non-existent property', () => {
    const r = ok({ irVersion: 1, entity: 'Post', filter: { field: 'titel', op: 'eq', value: 'x' } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('"titel" is not a property of "Post"');
  });

  it('rejects an include of something that is not a relation', () => {
    const r = ok({ irVersion: 1, entity: 'Post', include: { title: true } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('"title" is not a relation on "Post"');
  });

  it('validates include specs against the TARGET entity (catches a bad nested filter)', () => {
    const r = ok({
      irVersion: 1,
      entity: 'Post',
      include: { author: { filter: { field: 'nope', op: 'eq', value: 1 } } },
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('"nope" is not a property of "Agent"');
  });

  it('rejects an aggregate over a non-relation', () => {
    const r = ok({ irVersion: 1, entity: 'Post', aggregate: [{ as: 'x', over: 'title', fn: 'count' }] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('"title" is not a relation on "Post"');
  });

  it('rejects sum/min/max/avg without a field, and a field not on the related entity', () => {
    expect(ok({ irVersion: 1, entity: 'Post', aggregate: [{ as: 'x', over: 'signals', fn: 'sum' }] }).valid).toBe(
      false,
    );
    const r = ok({ irVersion: 1, entity: 'Post', aggregate: [{ as: 'x', over: 'signals', fn: 'sum', field: 'nope' }] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('"nope" is not a property of "Signal"');
  });

  it('rejects an aggregate alias that shadows a real property', () => {
    const r = ok({ irVersion: 1, entity: 'Post', aggregate: [{ as: 'title', over: 'signals', fn: 'count' }] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('shadows a property of "Post"');
  });

  it('rejects a sort key that resolves to nothing, and a sort path through a to-many relation', () => {
    expect(ok({ irVersion: 1, entity: 'Post', sort: [{ by: 'nope', dir: 'asc' }] }).valid).toBe(false);
    // signals is to-many → can't sort by signals.value
    expect(ok({ irVersion: 1, entity: 'Post', sort: [{ by: 'signals.value', dir: 'asc' }] }).valid).toBe(false);
  });

  it('accepts a drill-down scope whose anchor relation targets the entity', () => {
    // Agent.posts → Post, so scoping Posts to an Agent is valid.
    expect(ok({ irVersion: 1, entity: 'Post', scope: { via: 'posts', anchorId: 'a1', anchor: 'Agent' } }).valid).toBe(
      true,
    );
  });

  it('skips scope validation when the anchor type is absent (the legacy-shim case)', () => {
    expect(ok({ irVersion: 1, entity: 'Post', scope: { via: 'whatever', anchorId: 'a1' } }).valid).toBe(true);
  });

  it('rejects a scope via a non-relation, or one whose target is not the queried entity', () => {
    const r1 = ok({ irVersion: 1, entity: 'Post', scope: { via: 'nope', anchorId: 'a1', anchor: 'Agent' } });
    expect(r1.valid).toBe(false);
    if (!r1.valid) expect(r1.errors[0].message).toContain('"nope" is not a relation on "Agent"');
    // Post.signals → Signal, so scoping *Posts* via Post.signals (target Signal, not Post) is wrong.
    const r2 = ok({ irVersion: 1, entity: 'Post', scope: { via: 'signals', anchorId: 'x', anchor: 'Post' } });
    expect(r2.valid).toBe(false);
    if (!r2.valid) expect(r2.errors[0].message).toContain('targets "Signal", not "Post"');
  });

  it('rejects a scope with an unknown anchor entity', () => {
    const r = ok({ irVersion: 1, entity: 'Post', scope: { via: 'posts', anchorId: 'a1', anchor: 'Ghost' } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('unknown anchor entity "Ghost"');
  });

  it('accepts an aliased include (`over`) and validates its filter against the relation target', () => {
    expect(
      ok({
        irVersion: 1,
        entity: 'Post',
        include: {
          $myLike: { over: 'signals', filter: { field: 'signalTypeId', op: 'eq', value: 'like' }, first: true },
        },
      }).valid,
    ).toBe(true);
  });

  it('rejects an aliased include whose `over` is not a relation', () => {
    const r = ok({ irVersion: 1, entity: 'Post', include: { $x: { over: 'title' } } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('"title" (aliased as "$x") is not a relation on "Post"');
  });

  it('rejects an aliased include whose alias shadows a real property', () => {
    const r = ok({ irVersion: 1, entity: 'Post', include: { title: { over: 'signals' } } });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0].message).toContain('include alias "title" shadows a property of "Post"');
  });
});
