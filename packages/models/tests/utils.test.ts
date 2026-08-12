/**
 * The pure model utilities: signal normalisation/aggregation and the
 * file-storage decoders (whose error paths silently return '' / {} — pinned
 * here so that behaviour is a decision, not an accident).
 */
import { describe, expect, it } from 'vitest';

import type { Signal } from '../src/entities/Signal';
import type { SignalType } from '../src/entities/SignalType';
import { decodeFileAsJson, decodeFileAsString } from '../src/utils/fileTransforms';
import { aggregateSignals } from '../src/utils/signalAggregate';
import { denormalizeSignal, normalizeSignal } from '../src/utils/signalNormalize';

describe('normalizeSignal / denormalizeSignal', () => {
  it('maps the declared range onto [0, 1] and back', () => {
    expect(normalizeSignal(5, 0, 10)).toBe(0.5);
    expect(normalizeSignal(-1, -1, 1)).toBe(0);
    expect(denormalizeSignal(0.5, 0, 10)).toBe(5);
    expect(denormalizeSignal(normalizeSignal(7, 2, 12), 2, 12)).toBeCloseTo(7);
  });

  it('a zero-width range (pure veto) normalises to 0 by convention', () => {
    expect(normalizeSignal(-1, -1, -1)).toBe(0);
  });
});

describe('aggregateSignals', () => {
  const signals = (...values: number[]) => values.map((value) => ({ value }) as Signal);
  const type = (aggregate: string) => ({ aggregate }) as SignalType;

  it('count, sum, mean', () => {
    expect(aggregateSignals(signals(1, 0, 3), type('count'))).toBe(3);
    expect(aggregateSignals(signals(1, 2, 3), type('sum'))).toBe(6);
    expect(aggregateSignals(signals(1, 2, 3), type('mean'))).toBe(2);
    expect(aggregateSignals([], type('mean'))).toBe(0);
  });

  it('median for odd and even counts', () => {
    expect(aggregateSignals(signals(3, 1, 2), type('median'))).toBe(2);
    expect(aggregateSignals(signals(4, 1, 2, 3), type('median'))).toBe(2.5);
  });
});

describe('file decoders', () => {
  const encode = (text: string) => `data:text/plain;base64,${Buffer.from(text, 'utf-8').toString('base64')}`;

  it('decodes a data URI to text, including UTF-8', () => {
    expect(decodeFileAsString(encode('hello'))).toBe('hello');
    expect(decodeFileAsString(encode('héllo — ✓'))).toBe('héllo — ✓');
  });

  it('returns empty for non-data-URI or malformed input rather than throwing', () => {
    expect(decodeFileAsString(null)).toBe('');
    expect(decodeFileAsString('not a data uri')).toBe('');
    expect(decodeFileAsString('data:text/plain;base64,@@@not-base64@@@')).toBe('');
  });

  it('decodes JSON payloads, and empty-objects malformed JSON', () => {
    expect(decodeFileAsJson(encode('{"a":1}'))).toEqual({ a: 1 });
    expect(decodeFileAsJson(encode('{broken'))).toEqual({});
    expect(decodeFileAsJson(undefined)).toEqual({});
  });
});
