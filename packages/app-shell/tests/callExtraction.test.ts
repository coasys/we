/**
 * Extraction settings resolve along two axes, and this file exists for the second one.
 *
 * Every other capability setting in WE resolves by *who is asking* — deployment, agent everywhere,
 * community here, agent here — which `moduleSettings.ts` implements and `moduleSettings.test.ts`
 * covers. `autoInterpret` and `extractionTargets` also resolve by *which call*: a decision belonging
 * to that call's participants rather than to whoever administers the space.
 *
 * That second axis is the one with no natural guard. `Space.moduleSettings` is the obvious home for
 * these two settings, and its own docblock describes the bespoke columns as the shape it replaces —
 * so a reasonable person doing a tidy-up will try to migrate them. The generic resolver has no
 * subject axis, so that migration compiles, passes every other test, and silently stops
 * participants from being able to overrule the space. These assertions are what fails instead.
 */
import { describe, expect, it } from 'vitest';

import {
  LEGACY_EXTRACTION_TARGETS,
  parseEntityList,
  resolveCallAutoInterpret,
  resolveCallExtractionTargets,
  resolveSpaceExtractionTargets,
} from '../src/shared/callExtraction';

const CANDIDATES = ['TaskBlock', 'EventBlock', 'Sighting', 'Decision'];

describe('parseEntityList — absent, empty and broken are three different answers', () => {
  it('reads nothing written as "no opinion"', () => {
    expect(parseEntityList(undefined)).toBeNull();
    expect(parseEntityList('')).toBeNull();
    expect(parseEntityList(null)).toBeNull();
  });

  it('reads an empty array as a decision, not as silence', () => {
    // The distinction the record exists to make: a group that turned everything off.
    expect(parseEntityList('[]')).toEqual([]);
  });

  it('keeps only the strings in a list', () => {
    expect(parseEntityList('["TaskBlock", 7, null, "Sighting"]')).toEqual(['TaskBlock', 'Sighting']);
  });

  it('falls back rather than throwing on a value that is not a JSON array', () => {
    expect(parseEntityList('not json')).toBeNull();
    expect(parseEntityList('{"a":1}')).toBeNull();
  });
});

describe('the space level', () => {
  it('falls back to the migration floor when the space has never been asked', () => {
    expect(resolveSpaceExtractionTargets(CANDIDATES, undefined)).toEqual(LEGACY_EXTRACTION_TARGETS);
    expect(resolveSpaceExtractionTargets(CANDIDATES, '')).toEqual(LEGACY_EXTRACTION_TARGETS);
  });

  it('narrows to what is extractable here, so a deleted model cannot take a pass down', () => {
    expect(resolveSpaceExtractionTargets(CANDIDATES, '["Sighting","Retired","TaskBlock"]')).toEqual([
      'TaskBlock',
      'Sighting',
    ]);
  });

  it('orders by the candidates, not by the order somebody ticked things', () => {
    expect(resolveSpaceExtractionTargets(CANDIDATES, '["Decision","TaskBlock"]')).toEqual(['TaskBlock', 'Decision']);
  });

  it('lets a space turn everything off', () => {
    expect(resolveSpaceExtractionTargets(CANDIDATES, '[]')).toEqual([]);
  });
});

describe("the call level — a call's participants overrule the space", () => {
  const SPACE = '["TaskBlock","EventBlock"]';

  it('defers to the space when the call has no record at all', () => {
    expect(resolveCallExtractionTargets(CANDIDATES, SPACE, undefined)).toEqual(['TaskBlock', 'EventBlock']);
  });

  it('defers to the space when the record exists but named no entities', () => {
    // A CallExtraction row is created the moment somebody sets `auto`, so an untouched `entities`
    // on it must not read as "extract nothing".
    expect(resolveCallExtractionTargets(CANDIDATES, SPACE, '')).toEqual(['TaskBlock', 'EventBlock']);
  });

  it('takes the call over the space when its participants chose something else', () => {
    expect(resolveCallExtractionTargets(CANDIDATES, SPACE, '["Sighting"]')).toEqual(['Sighting']);
  });

  it('lets a call extract nothing while the space still extracts', () => {
    // The case a migration into the generic settings resolver would lose: [] at the call level is a
    // decision, and it has to beat a space that says otherwise.
    expect(resolveCallExtractionTargets(CANDIDATES, SPACE, '[]')).toEqual([]);
  });

  it('narrows the call list to the candidates too', () => {
    expect(resolveCallExtractionTargets(CANDIDATES, SPACE, '["Sighting","Gone"]')).toEqual(['Sighting']);
  });
});

describe('autoInterpret at the call level — three states, not two', () => {
  it('defers to the space when the call has not answered', () => {
    expect(resolveCallAutoInterpret(true, undefined)).toBe(true);
    expect(resolveCallAutoInterpret(false, undefined)).toBe(false);
  });

  it('treats the empty string as silence, not as a refusal', () => {
    // A record created to narrow targets carries `auto: ''`. Reading that as `false` would switch
    // extraction off for every call whose participants had only changed which models it writes.
    expect(resolveCallAutoInterpret(true, '')).toBe(true);
  });

  it('lets a call switch extraction off while the space leaves it on', () => {
    expect(resolveCallAutoInterpret(true, 'off')).toBe(false);
  });

  it('lets a call switch extraction on while the space leaves it off', () => {
    expect(resolveCallAutoInterpret(false, 'on')).toBe(true);
  });

  it('ignores a value that is neither on nor off rather than guessing', () => {
    expect(resolveCallAutoInterpret(true, 'maybe')).toBe(true);
    expect(resolveCallAutoInterpret(false, 'true')).toBe(false);
  });
});
