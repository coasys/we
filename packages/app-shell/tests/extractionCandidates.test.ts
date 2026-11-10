/**
 * A class the space already has — registered by another app, not adopted in WE — can be picked for
 * call extraction when it says it is meant for it, and only then.
 */
import { describe, expect, it } from 'vitest';

import { foreignExtractionCandidates } from '../src/shared/shapes/extractionCandidates';

const NATIVE = ['TaskBlock', 'EventBlock', 'Relationship', 'Topic'];

describe('foreignExtractionCandidates', () => {
  it('offers a class that carries an interpretation hint', () => {
    const { offered } = foreignExtractionCandidates(
      [{ name: 'DiscussionTopic', interpretationHint: 'A subject the call spends time on.' }],
      { taken: NATIVE, adopted: [] },
    );
    expect(offered).toEqual(['DiscussionTopic']);
  });

  it('does not offer a class without one — nothing says it was meant for extraction', () => {
    const { offered, shadowed } = foreignExtractionCandidates(
      [{ name: 'AppSettings' }, { name: 'Blank', interpretationHint: '  ' }],
      { taken: NATIVE, adopted: [] },
    );
    expect(offered).toEqual([]);
    expect(shadowed).toEqual([]);
  });

  it("reports a class named like WE's own instead of offering it, since the name resolves to WE's", () => {
    const { offered, shadowed } = foreignExtractionCandidates(
      [
        { name: 'Topic', interpretationHint: 'A subject.' },
        { name: 'Position', interpretationHint: 'A stance.' },
      ],
      { taken: NATIVE, adopted: [] },
    );
    expect(offered).toEqual(['Position']);
    expect(shadowed).toEqual(['Topic']);
  });

  it("leaves a community's adopted shape to its own manifest, without reporting it", () => {
    const { offered, shadowed } = foreignExtractionCandidates(
      [{ name: 'Sighting', interpretationHint: 'A bird seen.' }],
      { taken: NATIVE, adopted: ['Sighting'] },
    );
    expect(offered).toEqual([]);
    expect(shadowed).toEqual([]);
  });
});
