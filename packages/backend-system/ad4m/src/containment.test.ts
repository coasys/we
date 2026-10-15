/**
 * Containment is named by its neutral key everywhere above this backend, and stored as AD4M's own
 * `has_child`. A missed translation is silent in both directions — a record written under one
 * predicate and read under the other is simply not in its container — so each surface is pinned.
 */
import { CONTAINMENT_PREDICATE } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { AD4M_CONTAINMENT_PREDICATE, installContainmentPredicate, toAd4mPredicate, toAd4mScope } from './containment';

describe('toAd4mPredicate', () => {
  it('stores the neutral containment key as has_child', () => {
    expect(toAd4mPredicate(CONTAINMENT_PREDICATE)).toBe(AD4M_CONTAINMENT_PREDICATE);
  });

  it('leaves every other predicate alone, the AD4M spelling included', () => {
    expect(toAd4mPredicate('we://response')).toBe('we://response');
    expect(toAd4mPredicate(AD4M_CONTAINMENT_PREDICATE)).toBe(AD4M_CONTAINMENT_PREDICATE);
    expect(toAd4mPredicate(undefined)).toBeUndefined();
  });
});

describe('toAd4mScope', () => {
  it('translates the raw form and the traverse form', () => {
    expect(toAd4mScope({ id: 'c1', predicate: CONTAINMENT_PREDICATE })).toEqual({
      id: 'c1',
      predicate: AD4M_CONTAINMENT_PREDICATE,
    });
    expect(toAd4mScope({ ids: ['a', 'b'], predicate: CONTAINMENT_PREDICATE, transitive: true })).toEqual({
      ids: ['a', 'b'],
      predicate: AD4M_CONTAINMENT_PREDICATE,
      transitive: true,
    });
  });

  it('hands back the same object when there is nothing to translate', () => {
    const other = { id: 'c1', predicate: 'we://response' };
    const model = { model: class {}, id: 'c1' };
    expect(toAd4mScope(other)).toBe(other);
    expect(toAd4mScope(model)).toBe(model);
    expect(toAd4mScope(undefined)).toBeUndefined();
  });
});

describe('installContainmentPredicate', () => {
  /** A stand-in for `Ad4mModel`: statics that record what they were called with. */
  function makeModelClass() {
    const seen: Record<string, unknown[]> = {};
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        seen[name] = args;
        return name;
      };
    class FakeModel {
      static create = record('create');
      static findAll = record('findAll');
      static findOne = record('findOne');
      static findAllAndCount = record('findAllAndCount');
      static count = record('count');
      static query = record('query');
      static paginate = record('paginate');
    }
    return { FakeModel, seen };
  }

  const neutral = { id: 'channel-1', predicate: CONTAINMENT_PREDICATE };
  const stored = { id: 'channel-1', predicate: AD4M_CONTAINMENT_PREDICATE };

  it('translates the parent scope on every static that takes one', () => {
    const { FakeModel, seen } = makeModelClass();
    installContainmentPredicate(FakeModel as never);

    FakeModel.create('p', { text: 'hi' }, { parent: neutral, batchId: 'b' });
    FakeModel.findAll('p', { parent: neutral, include: { children: true } });
    FakeModel.findOne('p', { parent: neutral });
    FakeModel.findAllAndCount('p', { parent: neutral });
    FakeModel.count('p', { parent: neutral });
    FakeModel.query('p', { parent: neutral });
    FakeModel.paginate('p', 10, 1, { parent: neutral });

    expect(seen.create).toEqual(['p', { text: 'hi' }, { parent: stored, batchId: 'b' }]);
    expect(seen.findAll).toEqual(['p', { parent: stored, include: { children: true } }]);
    expect(seen.findOne).toEqual(['p', { parent: stored }]);
    expect(seen.findAllAndCount).toEqual(['p', { parent: stored }]);
    expect(seen.count).toEqual(['p', { parent: stored }]);
    expect(seen.query).toEqual(['p', { parent: stored }]);
    expect(seen.paginate).toEqual(['p', 10, 1, { parent: stored }]);
  });

  it('reaches a subclass, and keeps `this` as the class it was called on', () => {
    const { FakeModel } = makeModelClass();
    const findAll = vi.fn(function (this: unknown) {
      return this;
    });
    FakeModel.findAll = findAll as never;
    installContainmentPredicate(FakeModel as never);
    class Sub extends FakeModel {}

    expect(Sub.findAll('p', { parent: neutral })).toBe(Sub);
    expect(findAll).toHaveBeenCalledWith('p', { parent: stored });
  });

  it('installs once, however many times it is asked', () => {
    const { FakeModel, seen } = makeModelClass();
    installContainmentPredicate(FakeModel as never);
    const wrapped = FakeModel.findAll;
    installContainmentPredicate(FakeModel as never);
    expect(FakeModel.findAll).toBe(wrapped);

    FakeModel.findAll('p');
    expect(seen.findAll).toEqual(['p']);
  });
});
