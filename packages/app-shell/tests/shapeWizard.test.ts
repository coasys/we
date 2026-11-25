/**
 * The wizard's decisions over a draft, asked directly: what the generate button would do, whether
 * closing loses work, what a generation is asked, how its answer lands, and which field names a record.
 */
import { describe, expect, it } from 'vitest';

import { draftMember, emptyShapeDraft, memberSignature, type ShapeDraft } from '../src/shared/shapes/shapeDraft';
import {
  draftHasWork,
  draftNameMemberOf,
  generateIntentOf,
  generationPrompt,
  landGeneratedFields,
  nameOptionsOf,
} from '../src/shared/shapes/shapeWizard';

const named = (name: string, extra: Partial<ShapeDraft> = {}): ShapeDraft => ({ ...emptyShapeDraft(), name, ...extra });

describe('generateIntentOf', () => {
  it('has nothing to generate from a closed wizard or an empty draft', () => {
    expect(generateIntentOf(null, null)).toBe('none');
    expect(generateIntentOf(emptyShapeDraft(), null)).toBe('none');
  });

  it('generates when no row is touched, and regenerates rows nobody has changed', () => {
    const draft = named('Sighting');
    expect(generateIntentOf(draft, null)).toBe('generate');
    const rows = [draftMember({ name: 'species' })];
    const generated = { ...draft, members: rows };
    const last = { name: '', description: '', icon: '', classHint: '', members: memberSignature(rows) };
    expect(generateIntentOf(generated, last)).toBe('regenerate');
  });

  it('asks before replacing rows somebody wrote', () => {
    expect(generateIntentOf(named('Sighting', { members: [draftMember({ name: 'species' })] }), null)).toBe('replace');
  });
});

describe('draftHasWork', () => {
  it('closes a pristine new draft without asking, and asks once anything is written', () => {
    expect(draftHasWork(emptyShapeDraft(), null)).toBe(false);
    expect(draftHasWork(named('Sighting'), null)).toBe(true);
    expect(draftHasWork({ ...emptyShapeDraft(), members: [draftMember({ hint: 'x' })] }, null)).toBe(true);
  });

  it('asks about an edit only once it differs from what opened', () => {
    const draft = named('Sighting');
    const opened = JSON.stringify(draft);
    expect(draftHasWork(draft, { opened })).toBe(false);
    expect(draftHasWork({ ...draft, description: 'changed' }, { opened })).toBe(true);
  });
});

describe('generationPrompt', () => {
  it('asks with the author’s words only', () => {
    const draft = named('MovieNight', { description: 'about books' });
    expect(generationPrompt(draft, { name: 'MovieNight', description: '', icon: '', classHint: '' })).toBe(
      'The model is called "MovieNight".',
    );
  });

  it('falls back to what the form holds when nothing of the author’s is left', () => {
    const draft = named('', { description: ' A dish ', classHint: 'Food' });
    expect(generationPrompt(draft, { name: '', description: '', icon: '', classHint: '' })).toBe(
      'Description: A dish\nGuidance for AI interpretation: Food',
    );
  });
});

describe('landGeneratedFields', () => {
  it('keeps the author’s words, takes the rest from the generation, and records only what it wrote', () => {
    const current = named('Sighting', { description: 'old generated text' });
    const generated = named('Ignored', {
      description: 'A bird seen',
      icon: 'bird',
      classHint: 'hint',
      members: [draftMember({ name: 'species' })],
    });
    const { draft, last } = landGeneratedFields(current, generated, {
      name: 'Sighting',
      description: '',
      icon: '',
      classHint: '',
    });
    expect(draft.name).toBe('Sighting');
    expect(draft.description).toBe('A bird seen');
    expect(draft.members).toBe(generated.members);
    expect(last).toEqual({
      name: '',
      description: 'A bird seen',
      icon: 'bird',
      classHint: 'hint',
      members: memberSignature(generated.members),
    });
  });
});

describe('naming a record', () => {
  it('works out the field a card is headed with, and says so in the picker', () => {
    const title = draftMember({ name: 'title' });
    const draft = named('Book', { members: [draftMember({ name: 'pages', type: 'number' }), title] });
    expect(draftNameMemberOf(draft)).toBe(title.rowId);
    expect(nameOptionsOf(draft, title.rowId)[0]).toEqual({ label: 'Work it out (title)', value: 'none' });
  });

  it('keeps a chosen field, and the picker stops saying what it worked out', () => {
    const species = draftMember({ name: 'species' });
    const draft = named('Sighting', { members: [species], nameMember: species.rowId });
    expect(draftNameMemberOf(draft)).toBe(species.rowId);
    expect(nameOptionsOf(draft, species.rowId)[0]).toEqual({ label: 'Work it out', value: 'none' });
  });
});
