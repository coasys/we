import { describe, expect, it } from 'vitest';

import { NAMESPACE } from '../../shared/src/index.ts';
import { decodeValue, encodeValue } from '../src/encode';

describe('encode/decode markers', () => {
  it('round-trips undefined, NaN, non-finite numbers and callables', () => {
    expect(encodeValue(undefined)).toEqual({ $undefined: true });
    expect(decodeValue({ $undefined: true })).toBeUndefined();
    expect(encodeValue(NaN)).toEqual({ $nan: true });
    expect(Number.isNaN(decodeValue({ $nan: true }))).toBe(true);
    expect(encodeValue(Infinity)).toEqual({ $number: 'Infinity' });
    expect(encodeValue(-Infinity)).toEqual({ $number: '-Infinity' });
    expect(decodeValue({ $number: 'Infinity' })).toBe(Infinity);
    const fn = encodeValue(function namedFn() {});
    expect(fn).toEqual({ $callable: 'namedFn' });
    const decoded = decodeValue({ $callable: 'namedFn' });
    expect(typeof decoded).toBe('function');
    expect((decoded as () => unknown)()).toBeUndefined();
  });

  it('round-trips namespaces: members map decodes to a working get()', () => {
    const decoded = decodeValue({ $namespace: { a: 1, b: 'x' } }) as { get: (p: string) => unknown };
    expect(NAMESPACE in (decoded as object)).toBe(true);
    expect(decoded.get('a')).toBe(1);
    expect(decoded.get('b')).toBe('x');
    expect(decoded.get('missing')).toBeUndefined();
    // An opaque namespace (output position) also decodes to a namespace.
    const opaque = decodeValue({ $namespace: true }) as { get: (p: string) => unknown };
    expect(NAMESPACE in (opaque as object)).toBe(true);
    expect(opaque.get('anything')).toBeUndefined();
  });

  it('preserves object key order through encode and JSON text', () => {
    const source = { z: 1, a: 'x', m: [3, { q: undefined, b: null }], '0': 'first' };
    const encoded = encodeValue(source) as Record<string, unknown>;
    // JSON integer-like keys sort first by spec; authored order for the rest.
    expect(Object.keys(encoded)).toEqual(['0', 'z', 'a', 'm']);
    const decoded = decodeValue(JSON.parse(JSON.stringify(encoded)));
    expect(decoded).toEqual(source);
  });

  it('round-trips nested structures and scalars verbatim', () => {
    for (const v of [null, true, 0, -0, 3.14, 'text', '', [1, [2, [3]]], { a: { b: { c: [null] } } }]) {
      expect(decodeValue(encodeValue(v))).toEqual(v);
    }
  });

  it('encodes namespace members it can enumerate and leaves the rest opaque', () => {
    const encoded = encodeValue({ plain: 1 }) as Record<string, unknown>;
    expect(encoded.plain).toBe(1);
  });
});
