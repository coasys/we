import { describe, expect, it } from 'vitest';

import { hasToken, isDeepEqual, isObject, isPrimitive } from '../src/shared/predicates';

describe('predicates', () => {
  it('isObject detects plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject(() => ({}))).toBe(false);
  });

  it('isPrimitive detects primitives', () => {
    expect(isPrimitive(null)).toBe(true);
    expect(isPrimitive(undefined)).toBe(true);
    expect(isPrimitive('hello')).toBe(true);
    expect(isPrimitive(3)).toBe(true);
    expect(isPrimitive({})).toBe(false);
    expect(isPrimitive(() => {})).toBe(false);
  });

  it('isDeepEqual compares nested values', () => {
    expect(isDeepEqual(1, 1)).toBe(true);
    expect(isDeepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(isDeepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(isDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(isDeepEqual([1, 2], [1])).toBe(false);
  });

  it('hasToken checks token presence and type', () => {
    expect(hasToken({ $store: 'user.name' }, '$store', 'string')).toBe(true);
    expect(hasToken({ $map: {} }, '$map', 'object')).toBe(true);
    expect(hasToken({ $map: [] }, '$map', 'array')).toBe(true);
    expect(hasToken({}, '$store', 'string')).toBe(false);
  });
});
