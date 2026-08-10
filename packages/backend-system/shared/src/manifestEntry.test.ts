/**
 * Projecting a declared manifest onto the flat entry form.
 *
 * The entries are what a query's `scope` resolves `via` against, so what matters here is narrow and
 * specific: does an **untyped** relation still come through with its predicate? That is the case
 * that broke — a heterogeneous edge (a collection's children) carries no target class, and anything
 * that treats "no target" as "not a relation" makes every drill-down through it unresolvable.
 */
import { describe, expect, it } from 'vitest';

import { type ModelManifest } from './manifest';
import { manifestEntries } from './manifestEntry';

const manifest: ModelManifest = {
  version: '1',
  entities: {
    Node: {
      properties: {},
      relations: {
        // No target: links to whatever, like a node's comments.
        comments: { target: '', cardinality: 'many', predicate: 'we://comment' },
      },
    },
    Collection: {
      extends: 'Node',
      flag: { predicate: 'we://flag', value: 'we://collection' },
      properties: {
        kind: { type: 'string', predicate: 'we://kind' },
        indent: { type: 'number', predicate: 'we://indent' },
        allDay: { type: 'boolean', predicate: 'we://all_day' },
        // Declared, but bound to no predicate — see below.
        unbound: { type: 'string' },
      },
      relations: {
        children: { target: '', cardinality: 'many', predicate: 'we://children' },
        cover: { target: 'Image', cardinality: 'one', predicate: 'we://cover' },
      },
    },
    Image: { properties: { src: { type: 'string', predicate: 'we://src' } }, relations: {} },
  },
};

const entry = (name: string) => manifestEntries(manifest).find((e) => e.name === name)!;
const prop = (name: string, propName: string) => entry(name).properties.find((p) => p.name === propName);

describe('manifestEntries', () => {
  it('keeps the predicate of an untyped relation', () => {
    // The whole point. `scope` reads only the predicate, so a heterogeneous edge resolves fine —
    // it is `include` that needs a target class, because hydration must know what to hydrate into.
    expect(prop('Collection', 'children')).toMatchObject({
      predicate: 'we://children',
      type: 'uri',
      isCollection: true,
    });
    expect(prop('Collection', 'children')).not.toHaveProperty('relatedModel');
  });

  it('names the target of a typed relation, so include has something to hydrate into', () => {
    expect(prop('Collection', 'cover')).toMatchObject({ relatedModel: 'Image', isCollection: false });
  });

  it('carries inherited relations onto the child, since scope resolves on the child name', () => {
    // A drill-down says `{ anchor: 'Collection', via: 'comments' }` — it does not know or care that
    // `comments` is declared on the base.
    expect(prop('Collection', 'comments')?.predicate).toBe('we://comment');
  });

  it('skips a property with no predicate rather than minting one', () => {
    // A minted predicate here would resolve to something nothing was ever written under, so the
    // drill-down would return nothing at all instead of failing where it can be seen.
    expect(prop('Collection', 'unbound')).toBeUndefined();
  });

  it('narrows declared scalars to the three the entry form carries', () => {
    expect(prop('Collection', 'kind')?.type).toBe('string');
    expect(prop('Collection', 'indent')?.type).toBe('number');
    expect(prop('Collection', 'allDay')?.type).toBe('boolean');
  });

  it('carries the flag value as the target class, and tolerates its absence', () => {
    expect(entry('Collection').targetClass).toBe('we://collection');
    expect(entry('Image').targetClass).toBe('');
  });
});
