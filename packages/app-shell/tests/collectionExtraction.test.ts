/**
 * Extraction settings belong to the collection, and a space's settings are only where a new one
 * starts.
 *
 * Every other capability setting in WE resolves by *who is asking* — deployment, agent everywhere,
 * community here, agent here — which `moduleSettings.ts` implements. `autoInterpret` and
 * `extractionTargets` are different in kind: the space holds defaults a new collection copies, and
 * the answer that counts is then the collection's own, belonging to whoever is in that conversation.
 *
 * That has no natural guard. `Space.moduleSettings` is the obvious home for these two settings, so
 * a reasonable person doing a tidy-up will try to migrate them, and the generic resolver would then
 * let a space's setting overrule every conversation. These assertions are what fails instead.
 */
import { describe, expect, it } from 'vitest';

import {
  collectionExtractionDefaults,
  LEGACY_EXTRACTION_TARGETS,
  parseEntityList,
  resolveCollectionAutoExtract,
  resolveCollectionExtractionTargets,
  resolveSpaceExtractionTargets,
} from '../src/shared/collectionExtraction';

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

describe("the collection level — a collection's own list is the answer", () => {
  const SPACE = '["TaskBlock","EventBlock"]';

  it('defers to the space only for a collection made without a copy', () => {
    expect(resolveCollectionExtractionTargets(CANDIDATES, SPACE, undefined)).toEqual(['TaskBlock', 'EventBlock']);
    expect(resolveCollectionExtractionTargets(CANDIDATES, SPACE, '')).toEqual(['TaskBlock', 'EventBlock']);
  });

  it('takes the collection over the space when it holds a list', () => {
    expect(resolveCollectionExtractionTargets(CANDIDATES, SPACE, '["Sighting"]')).toEqual(['Sighting']);
  });

  it('lets a collection extract nothing while the space still defaults to something', () => {
    // The case a migration into the generic settings resolver would lose: [] on the collection is a
    // decision, and it has to beat a space that says otherwise.
    expect(resolveCollectionExtractionTargets(CANDIDATES, SPACE, '[]')).toEqual([]);
  });

  it('narrows the collection list to the candidates too', () => {
    expect(resolveCollectionExtractionTargets(CANDIDATES, SPACE, '["Sighting","Gone"]')).toEqual(['Sighting']);
  });
});

describe('autoExtract on a collection', () => {
  it('defers to the space only when the collection holds no answer', () => {
    expect(resolveCollectionAutoExtract(true, undefined)).toBe(true);
    expect(resolveCollectionAutoExtract(false, null)).toBe(false);
  });

  it('lets a collection stay off while the space defaults to on, and the reverse', () => {
    expect(resolveCollectionAutoExtract(true, false)).toBe(false);
    expect(resolveCollectionAutoExtract(false, true)).toBe(true);
  });
});

describe('the copy a new collection is made with', () => {
  it("copies the space's defaults as they stand", () => {
    expect(collectionExtractionDefaults({ autoInterpret: true, extractionTargets: '["Sighting"]' })).toEqual({
      autoExtract: true,
      extractionTargets: '["Sighting"]',
    });
  });

  it('writes the floor for a space that never chose a list, so the copy is a real answer', () => {
    // Copying '' would leave the collection unset, and it would then follow the space's later
    // changes — the live inheritance the copy exists to avoid.
    expect(collectionExtractionDefaults({ autoInterpret: false })).toEqual({
      autoExtract: false,
      extractionTargets: JSON.stringify(LEGACY_EXTRACTION_TARGETS),
    });
  });

  it('copies nothing where there is no space, leaving the collection unset', () => {
    expect(collectionExtractionDefaults(null)).toBeUndefined();
  });
});
