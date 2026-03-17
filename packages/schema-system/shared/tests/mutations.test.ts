import { describe, expect, it } from 'vitest';

import { findMutations } from '../src/shared/mutations';

describe('mutations.findMutations (combined)', () => {
  it('detects primitive change', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['x'], value: 2 }]);
  });

  it('detects nested object changes', () => {
    const a = { user: { name: 'A', age: 10 } };
    const b = { user: { name: 'B', age: 10 } };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['user', 'name'], value: 'B' }]);
  });

  it('detects array additions', () => {
    const a = { list: [1, 2] };
    const b = { list: [1, 2, 3] };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['list', 2], value: 3 }]);
  });

  it('detects array removal (undefined)', () => {
    const a = { list: [1, 2, 3] };
    const b = { list: [1, 2] };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['list', 2], value: undefined }]);
  });

  it('detects nested array element change', () => {
    const a = { list: [[1], [2]] };
    const b = { list: [[1], [3]] };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['list', 1, 0], value: 3 }]);
  });

  it('detects object deletion and addition', () => {
    const a = { a: 1, b: 2 };
    const b = { a: 1, c: 3 };
    // @ts-expect-error test
    const muts = findMutations(a, b);
    expect(muts).toEqual(
      expect.arrayContaining([
        { path: ['b'], value: undefined },
        { path: ['c'], value: 3 },
      ]),
    );
  });

  it('replaces mismatched array/object', () => {
    const a = { v: [1, 2] };
    const b = { v: { a: 1 } };
    const muts = findMutations(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
    expect(muts).toEqual([{ path: ['v'], value: { a: 1 } }]);
  });

  it('handles array/object mismatch and primitive replace', () => {
    const a1 = [1];
    const b1 = { a: 1 };
    const muts1 = findMutations(a1 as unknown as Record<string, unknown>, b1 as unknown as Record<string, unknown>);
    expect(muts1).toEqual([{ path: [], value: b1 }]);

    const a2 = 1;
    const b2 = 2;
    const muts2 = findMutations(a2 as unknown as Record<string, unknown>, b2 as unknown as Record<string, unknown>);
    expect(muts2).toEqual([{ path: [], value: 2 }]);
  });

  it('detects function replacement inside arrays', () => {
    const a = { arr: [() => 1] };
    const b = { arr: [() => 2] };
    const muts = findMutations(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
    expect(muts.length).toBe(1);
    expect(muts[0].path).toEqual(['arr', 0]);
    expect(typeof muts[0].value).toBe('function');
  });
});
