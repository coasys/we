/**
 * The connection key kernel: the format an interpretation pass dedups a connection against. Replayed
 * from its recorded vectors, the contract a second host writes the same keys against.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { connectionKey } from '../src/shared/kernels/connectionKey';

const vectors = JSON.parse(
  readFileSync(new URL('../src/shared/kernels/vectors/connectionKey.json', import.meta.url), 'utf8'),
) as { name: string; input: { source: string; target: string; label?: unknown }; output: string }[];

describe('connectionKey', () => {
  it('trims, and leaves the label off when there is none', () => {
    expect(connectionKey(' Launch ', 'Guide', '  depends on ')).toBe('Launch → Guide: depends on');
    expect(connectionKey('Launch', 'Guide', '')).toBe('Launch → Guide');
    expect(connectionKey('Launch', 'Guide')).toBe('Launch → Guide');
  });
});

describe('the recorded vectors', () => {
  it.each(vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, vector) => {
    expect(connectionKey(vector.input.source, vector.input.target, vector.input.label)).toBe(vector.output);
  });
});
