/**
 * The operation suites that need no backend, held to the committed files twice over: each file
 * re-records to what is committed, and each case is run again from the file alone, as another
 * implementation would run it, through the reference's own functions.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { type EffectCase, permissionOf, recordEffects, summaryOf } from '../src/suites/effects';
import { derivedId, type IdCase, recordIds, segmentsOf } from '../src/suites/ids';
import { recordStaticChecks, staticIssues } from '../src/suites/staticChecks';

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../vectors/operations/${name}`, import.meta.url), 'utf8')) as T;

describe('static-checks.json', () => {
  const file = load<ReturnType<typeof recordStaticChecks>>('static-checks.json');

  it('re-records to the committed content', () => {
    expect(recordStaticChecks()).toEqual(file);
  });

  for (const c of file.cases)
    it(`${c.id}: ${c.refused ? 'refused at its paths' : 'accepted'}`, () => {
      const paths = staticIssues(c.operations);
      expect(paths.length > 0).toBe(c.refused);
      expect(paths).toEqual(c.paths);
    });

  it('has a refused case for every check the spec lists, and one that passes', () => {
    const refused = new Set(file.cases.filter((c) => c.refused).map((c) => c.check));
    expect([...Array(15).keys()].map((i) => i + 1).filter((n) => !refused.has(n))).toEqual([]);
    expect(file.cases.some((c) => !c.refused)).toBe(true);
  });
});

describe('effects.json', () => {
  const file = load<ReturnType<typeof recordEffects>>('effects.json');

  it('re-records to the committed content', () => {
    expect(recordEffects()).toEqual(file);
  });

  for (const c of file.cases)
    it(`${c.id}: the summary and what invoking it needs`, () => {
      const summary = summaryOf(c as unknown as EffectCase);
      expect(summary).toEqual(c.summary);
      expect(permissionOf(summary, file.groups)).toEqual(c.permission);
    });
});

describe('ids.json', () => {
  const file = load<{ cases: (IdCase & { framed: string; result: string })[] }>('ids.json');

  it('re-records to the committed content', async () => {
    expect(await recordIds()).toEqual(file);
  });

  for (const c of file.cases)
    it(`${c.id}: ${c.result}`, async () => {
      // The framing as the spec words it, written out here rather than taken from the reference.
      const framed = segmentsOf(c)
        .map((part) => `${new TextEncoder().encode(part).length}:${part}`)
        .join('');
      expect(framed).toBe(c.framed);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(framed)));
      const bytes = digest.slice(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x80;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      const uuid = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      expect(uuid).toBe(c.result);
      expect(await derivedId(c)).toBe(c.result);
    });
});
