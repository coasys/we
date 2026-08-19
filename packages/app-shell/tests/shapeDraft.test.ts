/**
 * The wizard draft ↔ stored manifest conversion. The properties that matter:
 *
 * - a lowered draft passes the real gate (`validateManifest`) — the wizard can never produce a
 *   definition the adoption path refuses for structural reasons;
 * - predicates are minted once and preserved through edit round-trips — a rename in the form must
 *   never re-mint the storage key existing data lives under;
 * - the additive guard names exactly what an edit would break, including the redefinitions that
 *   keep a predicate but change what it means.
 */
import { validateManifest } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  additiveViolations,
  draftToManifest,
  emptyDraftProperty,
  emptyDraftRelationship,
  emptyShapeDraft,
  manifestToDraft,
  NO_DEFAULT,
  type ShapeDraft,
  syncDerived,
} from '../src/shared/shapes/shapeDraft';

const UUID = 'abc-123';

/** The canonical mixed draft: scalars of every flavour, plus a relationship. */
function sightingDraft(): ShapeDraft {
  const species = { ...emptyDraftProperty(), name: 'species', type: 'text' as const, required: true };
  const draft: ShapeDraft = {
    name: 'Sighting',
    description: 'A bird sighting',
    icon: 'binoculars',
    classHint: 'A specific observation of a bird.',
    identityMember: species.rowId,
    members: [
      { ...species, hint: 'The common name.' },
      { ...emptyDraftProperty(), name: 'seenAt', type: 'date', required: true },
      {
        ...emptyDraftProperty(),
        name: 'certainty',
        type: 'select',
        options: 'certain, probable, unsure',
        defaultValue: 'certain',
      },
      { ...emptyDraftProperty(), name: 'count', type: 'number', defaultValue: '1' },
      { ...emptyDraftRelationship(), name: 'location', target: 'LocationBlock' },
    ],
  };
  return draft;
}

describe('draftToManifest', () => {
  it('lowers a mixed draft onto a manifest the real gate accepts', () => {
    const result = draftToManifest(sightingDraft(), UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateManifest(result.manifest, { externalEntities: ['LocationBlock'] }).valid).toBe(true);

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
    // Only the chosen member carries identity — the picker can express nothing else.
    expect(Object.values(entity.properties).filter((p) => p.identity)).toHaveLength(1);
  });

  it('lowers a to-many relationship as a many cardinality', () => {
    const draft = sightingDraft();
    draft.members.push({ ...emptyDraftRelationship(), name: 'photos', target: 'ImageBlock', many: true });
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.entities.Sighting.relations.photos.cardinality).toBe('many');
  });

  it('refuses the form-level mistakes with wizard-facing messages', () => {
    const draft: ShapeDraft = {
      ...emptyShapeDraft(),
      name: 'my model',
      members: [
        { ...emptyDraftProperty(), name: 'due date' },
        { ...emptyDraftProperty(), name: 'status', type: 'select' },
        { ...emptyDraftProperty(), name: 'count', type: 'number', defaultValue: 'many' },
        { ...emptyDraftProperty(), name: 'dupe' },
        { ...emptyDraftRelationship(), name: 'dupe', target: 'ImageBlock' },
        { ...emptyDraftRelationship(), name: 'orphan' },
      ],
    };
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const all = result.errors.join('\n');
    expect(all).toContain('Model');
    expect(all).toContain('"due date"');
    expect(all).toContain('Select property "status"');
    expect(all).toContain('Default for "count"');
    // Properties and relationships share one namespace, since both become predicates.
    expect(all).toContain('Duplicate name "dupe"');
    expect(all).toContain('Relationship "orphan" needs something to point at');
  });

  it('names the fixed spelling rather than restating the rule', () => {
    // "must be a single identifier" read as "one word only", when multi-word names are the normal
    // case and need only their spaces closing up. The message now does that transformation.
    const draft: ShapeDraft = {
      ...emptyShapeDraft(),
      name: 'Book Recommendation',
      members: [{ ...emptyDraftProperty(), name: 'due date' }],
    };
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const all = result.errors.join('\n');
    expect(all).toContain('try "BookRecommendation" instead of "Book Recommendation"');
    expect(all).toContain('try "dueDate" instead of "due date"');
  });

  it('asks for a name rather than suggesting one when the field is empty', () => {
    const result = draftToManifest({ ...emptyShapeDraft(), members: [{ ...emptyDraftProperty(), hint: 'x' }] }, UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('Model needs a name');
  });

  it('offers no suggestion it would refuse again', () => {
    // Joining words cannot rescue a name that starts with a digit, so the rule is stated instead.
    const result = draftToManifest({ ...emptyShapeDraft(), name: '2 good things' }, UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.errors.find((e) => e.startsWith('Model')) ?? '';
    expect(message).toContain('must start with a letter');
    expect(message).not.toContain('try "');
  });

  it('refuses an identity pointing at a relationship, or at a deleted row', () => {
    const withRelationIdentity = sightingDraft();
    withRelationIdentity.identityMember = withRelationIdentity.members[4].rowId; // the relationship
    const a = draftToManifest(withRelationIdentity, UUID);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.join(' ')).toContain('is a relationship');

    const dangling = sightingDraft();
    dangling.identityMember = 'gone';
    const b = draftToManifest(dangling, UUID);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(' ')).toContain('no longer exists');
  });

  it('refuses an empty draft rather than minting an empty entity', () => {
    const result = draftToManifest({ ...emptyShapeDraft(), name: 'Empty' }, UUID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('at least one property');
  });

  it('keeps a stored predicate through a display rename', () => {
    const draft = sightingDraft();
    draft.members[0] = { ...draft.members[0], name: 'speciesName', predicate: 'we://shape/abc-123/species' };
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.entities.Sighting.properties.speciesName.predicate).toBe('we://shape/abc-123/species');
  });
});

describe('typed defaults', () => {
  it('treats the picker sentinel as no default at all', () => {
    // The default pickers open on "No default", which must not reach the manifest as a value.
    const draft = sightingDraft();
    draft.members[3] = { ...draft.members[3], defaultValue: NO_DEFAULT };
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.entities.Sighting.properties.count).not.toHaveProperty('default');
  });

  it('builds a three-valued picker for a boolean, since unset is not false', () => {
    const row = syncDerived({ ...emptyDraftProperty(), type: 'boolean' });
    expect(row.defaultOptions.map((o) => o.value)).toEqual([NO_DEFAULT, 'true', 'false']);
  });

  it("builds a select's picker from the values it declares", () => {
    const row = syncDerived({ ...emptyDraftProperty(), type: 'select', options: 'fiction, poetry' });
    expect(row.defaultOptions.map((o) => o.value)).toEqual([NO_DEFAULT, 'fiction', 'poetry']);
  });

  it('lowers a picked boolean to a real boolean', () => {
    const draft = sightingDraft();
    draft.members.push({ ...emptyDraftProperty(), name: 'signed', type: 'boolean', defaultValue: 'false' });
    const result = draftToManifest(draft, UUID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.entities.Sighting.properties.signed.default).toBe(false);
  });
});

describe('error attribution', () => {
  it('names the rows a refusal is about, so a collapsed one can be opened', () => {
    const bad = { ...emptyDraftProperty(), name: 'due date' };
    const fine = { ...emptyDraftProperty(), name: 'notes' };
    const result = draftToManifest({ ...emptyShapeDraft(), name: 'Thing', members: [fine, bad] }, UUID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rows).toEqual([bad.rowId]);
  });

  it('attributes nothing to a row for a model-level complaint', () => {
    const result = draftToManifest({ ...emptyShapeDraft(), name: 'bad name' }, UUID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rows).toEqual([]);
  });
});

describe('manifestToDraft', () => {
  it('round-trips: lower, lift, lower again — identical manifest', () => {
    const first = draftToManifest(sightingDraft(), UUID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const lifted = manifestToDraft('Sighting', first.manifest, { description: 'A bird sighting', icon: 'binoculars' });
    expect(lifted.members.map((m) => m.name)).toEqual(['species', 'seenAt', 'certainty', 'count', 'location']);
    expect(lifted.members.map((m) => m.kind)).toEqual(['property', 'property', 'property', 'property', 'relationship']);
    const second = draftToManifest(lifted, UUID);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.manifest).toEqual(first.manifest);
  });

  it('lifts identity onto the row that holds it, not onto its name', () => {
    const first = draftToManifest(sightingDraft(), UUID);
    if (!first.ok) throw new Error('fixture failed');
    const lifted = manifestToDraft('Sighting', first.manifest);
    const identity = lifted.members.find((m) => m.rowId === lifted.identityMember);
    expect(identity?.name).toBe('species');
  });
});

describe('additiveViolations', () => {
  /** Lower two drafts and diff them, the way an edit does. */
  const diff = (before: ShapeDraft, after: ShapeDraft) => {
    const a = draftToManifest(before, UUID);
    const b = draftToManifest(after, UUID);
    if (!a.ok || !b.ok) throw new Error(`fixture failed: ${[...(a.ok ? [] : a.errors), ...(b.ok ? [] : b.errors)]}`);
    return additiveViolations(a.manifest, b.manifest);
  };

  it('accepts a pure addition', () => {
    const after = sightingDraft();
    after.members.push({ ...emptyDraftProperty(), name: 'notes' });
    expect(diff(sightingDraft(), after)).toEqual([]);
  });

  it('names the storage key a removal would orphan', () => {
    const after = sightingDraft();
    after.members = after.members.filter((m) => m.name !== 'count');
    const violations = diff(sightingDraft(), after);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('Sighting.count');
    expect(violations[0]).toContain('we://shape/abc-123/count');
  });

  it('treats a rename without its stored predicate as a removal', () => {
    const after = sightingDraft();
    after.members[3] = { ...after.members[3], name: 'howMany' }; // count → howMany, no predicate carried
    expect(diff(sightingDraft(), after).join(' ')).toContain('Sighting.count');
  });

  it('catches a type change that keeps the predicate', () => {
    // The hazard the predicate check alone misses: same storage key, different reading of every
    // value already written under it.
    const after = sightingDraft();
    after.members[3] = { ...after.members[3], type: 'text', defaultValue: '' };
    const violations = diff(sightingDraft(), after);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('changed type from number to string');
  });

  it('catches a property becoming a relationship under the same predicate', () => {
    const after = sightingDraft();
    after.members[1] = { ...after.members[1], kind: 'relationship', target: 'ImageBlock' };
    expect(diff(sightingDraft(), after).join(' ')).toContain('from a property to a relationship');
  });

  it('catches a relationship re-pointed at a different model', () => {
    const after = sightingDraft();
    after.members[4] = { ...after.members[4], target: 'ImageBlock' };
    expect(diff(sightingDraft(), after).join(' ')).toContain('now points at ImageBlock');
  });

  it('allows one → many but refuses many → one', () => {
    const widened = sightingDraft();
    widened.members[4] = { ...widened.members[4], many: true };
    expect(diff(sightingDraft(), widened)).toEqual([]);
    expect(diff(widened, sightingDraft()).join(' ')).toContain('changed from many to one');
  });

  it('is unmoved by reordering — order is not a storage fact', () => {
    const after = sightingDraft();
    after.members = [...after.members].reverse();
    expect(diff(sightingDraft(), after)).toEqual([]);
  });
});
