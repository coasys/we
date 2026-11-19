/**
 * Every class the space already has — registered by another app, not adopted in WE — can be picked
 * for call extraction. A class that says how it should be read sorts first; WE's own plumbing never
 * appears, and a class named like one of WE's content classes is reported rather than offered.
 */
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { foreignExtractionCandidates, WE_PLUMBING_CLASSES } from '../src/shared/shapes/extractionCandidates';

const NATIVE = ['TaskBlock', 'EventBlock', 'Relationship', 'Topic', 'Space', 'CollectionBlock', 'AgentSettings'];

describe('foreignExtractionCandidates', () => {
  it('offers a class that carries an interpretation hint', () => {
    const { offered } = foreignExtractionCandidates(
      [{ name: 'DiscussionTopic', interpretationHint: 'A subject the call spends time on.' }],
      { taken: NATIVE, adopted: [] },
    );
    expect(offered).toEqual(['DiscussionTopic']);
  });

  it('offers a class without a hint too, after the hinted ones', () => {
    const { offered, shadowed } = foreignExtractionCandidates(
      [
        { name: 'AppSettings' },
        { name: 'Blank', interpretationHint: '  ' },
        { name: 'Question', interpretationHint: 'Something asked and not yet answered.' },
        { name: 'Answer' },
      ],
      { taken: NATIVE, adopted: [] },
    );
    expect(offered).toEqual(['Question', 'Answer', 'AppSettings', 'Blank']);
    expect(shadowed).toEqual([]);
  });

  it("reports a class named like WE's own content instead of offering it, since the name resolves to WE's", () => {
    const { offered, shadowed } = foreignExtractionCandidates(
      [{ name: 'Topic', interpretationHint: 'A subject.' }, { name: 'Position' }],
      { taken: NATIVE, adopted: [] },
    );
    expect(offered).toEqual(['Position']);
    expect(shadowed).toEqual(['Topic']);
  });

  it("never offers WE's own plumbing, and does not report it either", () => {
    const { offered, shadowed } = foreignExtractionCandidates(
      [{ name: 'Space' }, { name: 'CollectionBlock', interpretationHint: 'A container.' }, { name: 'AgentSettings' }],
      { taken: NATIVE, adopted: [] },
    );
    expect(offered).toEqual([]);
    expect(shadowed).toEqual([]);
  });

  it("leaves a community's adopted shape to its own manifest, without reporting it", () => {
    const { offered, shadowed } = foreignExtractionCandidates(
      [{ name: 'Sighting', interpretationHint: 'A bird seen.' }, { name: 'Nest' }],
      { taken: NATIVE, adopted: ['Sighting', 'Nest'] },
    );
    expect(offered).toEqual([]);
    expect(shadowed).toEqual([]);
  });

  it('names only classes WE actually defines, none of them an extraction target', () => {
    for (const name of WE_PLUMBING_CLASSES) {
      expect(CORE_MANIFEST.entities[name], name).toBeDefined();
      expect(CORE_MANIFEST.entities[name]?.extractable, name).not.toBe(true);
    }
  });
});
