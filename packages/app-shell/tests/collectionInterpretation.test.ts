/**
 * Interpretation settings belong to the collection, and a space's settings are only where a new one
 * starts.
 *
 * Every other capability setting in WE resolves by *who is asking* — deployment, agent everywhere,
 * community here, agent here — which `moduleSettings.ts` implements. `autoInterpret` and
 * `interpretationTargets` are different in kind: the space holds defaults a new collection copies, and
 * the answer that counts is then the collection's own, belonging to whoever is in that conversation.
 *
 * That has no natural guard. `Space.moduleSettings` is the obvious home for these two settings, so
 * a reasonable person doing a tidy-up will try to migrate them, and the generic resolver would then
 * let a space's setting overrule every conversation. These assertions are what fails instead.
 */
import {
  collectionInterpretationDefaults,
  LEGACY_INTERPRETATION_TARGETS,
  parseEntityList,
  resolveCollectionAutoInterpret,
  resolveCollectionInterpretationTargets,
  resolveSpaceInterpretationTargets,
} from '@we/entities';
import { describe, expect, it } from 'vitest';

const CANDIDATES = ['TaskBlock', 'EventBlock', 'Sighting', 'Decision'];

describe('parseEntityList — absent, empty and broken are three different answers', () => {
  it('reads nothing written as "no opinion"', () => {
    expect(parseEntityList(undefined)).toBeNull();
    expect(parseEntityList('')).toBeNull();
    expect(parseEntityList(null)).toBeNull();
  });

  it('reads an empty array as a decision, not as silence', () => {
    // A conversation whose participants turned everything off, which is not the same as unset.
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
    expect(resolveSpaceInterpretationTargets(CANDIDATES, undefined)).toEqual(LEGACY_INTERPRETATION_TARGETS);
    expect(resolveSpaceInterpretationTargets(CANDIDATES, '')).toEqual(LEGACY_INTERPRETATION_TARGETS);
  });

  it('narrows to what is interpretable here, so a deleted model cannot take a pass down', () => {
    expect(resolveSpaceInterpretationTargets(CANDIDATES, '["Sighting","Retired","TaskBlock"]')).toEqual([
      'TaskBlock',
      'Sighting',
    ]);
  });

  it('orders by the candidates, not by the order somebody ticked things', () => {
    expect(resolveSpaceInterpretationTargets(CANDIDATES, '["Decision","TaskBlock"]')).toEqual([
      'TaskBlock',
      'Decision',
    ]);
  });

  it('lets a space turn everything off', () => {
    expect(resolveSpaceInterpretationTargets(CANDIDATES, '[]')).toEqual([]);
  });
});

describe("the collection level — a collection's own list is the answer", () => {
  const SPACE = '["TaskBlock","EventBlock"]';

  it('defers to the space only for a collection made without a copy', () => {
    expect(resolveCollectionInterpretationTargets(CANDIDATES, SPACE, undefined)).toEqual(['TaskBlock', 'EventBlock']);
    expect(resolveCollectionInterpretationTargets(CANDIDATES, SPACE, '')).toEqual(['TaskBlock', 'EventBlock']);
  });

  it('takes the collection over the space when it holds a list', () => {
    expect(resolveCollectionInterpretationTargets(CANDIDATES, SPACE, '["Sighting"]')).toEqual(['Sighting']);
  });

  it('lets a collection interpret nothing while the space still defaults to something', () => {
    // The case a migration into the generic settings resolver would lose: [] on the collection is a
    // decision, and it has to beat a space that says otherwise.
    expect(resolveCollectionInterpretationTargets(CANDIDATES, SPACE, '[]')).toEqual([]);
  });

  it('narrows the collection list to the candidates too', () => {
    expect(resolveCollectionInterpretationTargets(CANDIDATES, SPACE, '["Sighting","Gone"]')).toEqual(['Sighting']);
  });
});

describe('autoInterpret on a collection', () => {
  it('defers to the space only when the collection holds no answer', () => {
    expect(resolveCollectionAutoInterpret(true, undefined)).toBe(true);
    expect(resolveCollectionAutoInterpret(false, null)).toBe(false);
  });

  it('lets a collection stay off while the space defaults to on, and the reverse', () => {
    expect(resolveCollectionAutoInterpret(true, false)).toBe(false);
    expect(resolveCollectionAutoInterpret(false, true)).toBe(true);
  });
});

describe('the copy a new collection is made with', () => {
  it("copies the space's defaults as they stand", () => {
    expect(collectionInterpretationDefaults({ autoInterpret: true, interpretationTargets: '["Sighting"]' })).toEqual({
      autoInterpret: true,
      interpretationTargets: '["Sighting"]',
    });
  });

  it('writes the floor for a space that never chose a list, so the copy is a real answer', () => {
    // Copying '' would leave the collection unset, and it would then follow the space's later
    // changes — the live inheritance the copy exists to avoid.
    expect(collectionInterpretationDefaults({ autoInterpret: false })).toEqual({
      autoInterpret: false,
      interpretationTargets: JSON.stringify(LEGACY_INTERPRETATION_TARGETS),
    });
  });

  it('copies nothing where there is no space, leaving the collection unset', () => {
    expect(collectionInterpretationDefaults(null)).toBeUndefined();
  });
});
