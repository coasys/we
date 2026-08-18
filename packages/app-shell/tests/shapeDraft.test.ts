/**
 * The wizard draft ↔ stored manifest conversion. The properties that matter:
 *
 * - a lowered draft passes the real gate (`validateManifest`) — the wizard can never produce a
 *   definition the adoption path refuses for structural reasons;
 * - predicates are minted once and preserved through edit round-trips — a rename in the form must
 *   never re-mint the storage key existing data lives under;
 * - the additive guard names exactly the storage keys an edit would orphan.
 */
import { validateManifest } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  additiveViolations,
  draftToManifest,
  emptyDraftProperty,
  emptyShapeDraft,
  manifestToDraft,
  type ShapeDraft,
} from '../src/shared/shapes/shapeDraft';

const UUID = 'abc-123';

const sightingDraft = (): ShapeDraft => ({
  name: 'Sighting',
  description: 'A bird sighting',
  icon: 'binoculars',
  classHint: 'A specific observation of a bird.',
  properties: [
    {
      ...emptyDraftProperty(),
      name: 'species',
      type: 'text',
      required: true,
      identity: true,
      hint: 'The common name.',
    },
    { ...emptyDraftProperty(), name: 'seenAt', type: 'date', required: true },
    {
      ...emptyDraftProperty(),
      name: 'certainty',
      type: 'select',
      options: 'certain, probable, unsure',
      defaultValue: 'certain',
    },
    { ...emptyDraftProperty(), name: 'count', type: 'number', defaultValue: '1' },
    { ...emptyDraftProperty(), name: 'location', type: 'reference', target: 'LocationBlock' },
  ],
});

describe('draftToManifest', () => {
  it('lowers a full draft onto a manifest the real gate accepts', () => {
    const result = draftToManifest(sightingDraft(), UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gate = validateManifest(result.manifest, { externalEntities: ['LocationBlock'] });
    expect(gate.valid).toBe(true);

    const entity = result.manifest.entities.Sighting;
    expect(entity.flag).toEqual({ predicate: 'we://flag', value: 'we://shape/abc-123/sighting' });
    expect(entity.interpretationHint).toBe('A specific observation of a bird.');
    expect(entity.properties.species).toMatchObject({
      type: 'string',
      required: true,
      identity: true,
      interpretationHint: 'The common name.',
      predicate: 'we://shape/abc-123/species',
    });
    expect(entity.properties.seenAt).toMatchObject({ type: 'datetime', predicate: 'we://shape/abc-123/seen_at' });
    expect(entity.properties.certainty).toMatchObject({
      options: ['certain', 'probable', 'unsure'],
      default: 'certain',
    });
    expect(entity.properties.count).toMatchObject({ type: 'number', default: 1 });
    expect(entity.relations.location).toEqual({
      target: 'LocationBlock',
      cardinality: 'one',
      predicate: 'we://shape/abc-123/location',
    });
  });

  it('refuses the form-level mistakes with wizard-facing messages', () => {
    const draft: ShapeDraft = {
      ...emptyShapeDraft(),
      name: 'my model',
      properties: [
        { ...emptyDraftProperty(), name: 'due date' },
        { ...emptyDraftProperty(), name: 'status', type: 'select' },
        { ...emptyDraftProperty(), name: 'count', type: 'number', defaultValue: 'many' },
        { ...emptyDraftProperty(), name: 'a', identity: true },
        { ...emptyDraftProperty(), name: 'b', identity: true },
        { ...emptyDraftProperty(), name: 'ref', type: 'reference' },
      ],
    };
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const all = result.errors.join('\n');
    expect(all).toContain('Model name');
    expect(all).toContain('"due date"');
    expect(all).toContain('Select property "status"');
    expect(all).toContain('Default for "count"');
    expect(all).toContain('Only one property can be the identity');
    expect(all).toContain('Reference property "ref"');
  });

  it('refuses an empty draft rather than minting an empty entity', () => {
    const result = draftToManifest({ ...emptyShapeDraft(), name: 'Empty' }, UUID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('at least one property');
  });

  it('keeps a stored predicate through a display rename', () => {
    const draft = sightingDraft();
    draft.properties[0] = { ...draft.properties[0], name: 'speciesName', predicate: 'we://shape/abc-123/species' };
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.entities.Sighting.properties.speciesName.predicate).toBe('we://shape/abc-123/species');
  });
});

describe('manifestToDraft', () => {
  it('round-trips: lower, lift, lower again — identical manifest', () => {
    const first = draftToManifest(sightingDraft(), UUID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const lifted = manifestToDraft('Sighting', first.manifest, { description: 'A bird sighting', icon: 'binoculars' });
    expect(lifted.properties.map((p) => p.name)).toEqual(['species', 'seenAt', 'certainty', 'count', 'location']);
    const second = draftToManifest(lifted, UUID);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.manifest).toEqual(first.manifest);
  });
});

describe('additiveViolations', () => {
  it('accepts a pure addition', () => {
    const before = draftToManifest(sightingDraft(), UUID);
    const withExtra = sightingDraft();
    withExtra.properties.push({ ...emptyDraftProperty(), name: 'notes' });
    const after = draftToManifest(withExtra, UUID);
    if (!before.ok || !after.ok) throw new Error('fixture failed');
    expect(additiveViolations(before.manifest, after.manifest)).toEqual([]);
  });

  it('names the storage key a removal would orphan', () => {
    const before = draftToManifest(sightingDraft(), UUID);
    const shrunk = sightingDraft();
    shrunk.properties = shrunk.properties.filter((p) => p.name !== 'count');
    const after = draftToManifest(shrunk, UUID);
    if (!before.ok || !after.ok) throw new Error('fixture failed');
    const violations = additiveViolations(before.manifest, after.manifest);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('Sighting.count');
    expect(violations[0]).toContain('we://shape/abc-123/count');
  });

  it('treats a rename without its stored predicate as a removal', () => {
    const before = draftToManifest(sightingDraft(), UUID);
    const renamed = sightingDraft();
    renamed.properties[3] = { ...renamed.properties[3], name: 'howMany' }; // count → howMany, no predicate carried
    const after = draftToManifest(renamed, UUID);
    if (!before.ok || !after.ok) throw new Error('fixture failed');
    expect(additiveViolations(before.manifest, after.manifest).join(' ')).toContain('Sighting.count');
  });
});
