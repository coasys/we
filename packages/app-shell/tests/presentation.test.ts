/**
 * A type's presentation: the model's defaults, with a space's overrides laid over them slot by slot.
 */
import type { EntitySchema } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { presentationFields, presentationOf, withPresentation } from '../src/shared/shapes/presentation';

const SIGHTING: EntitySchema = {
  display: { title: 'species', summary: 'notes' },
  authoring: { fields: ['species', 'notes'] },
  properties: {
    species: { type: 'string' },
    notes: { type: 'string', control: 'textarea' },
    place: { type: 'string' },
    photo: { type: 'string', format: 'file' },
  },
  relations: {},
};

describe('withPresentation', () => {
  it('is the model itself with nothing laid over it', () => {
    expect(withPresentation(SIGHTING)).toBe(SIGHTING);
    expect(withPresentation(SIGHTING, undefined, {})).toEqual(SIGHTING);
  });

  it('overrides a display slot by slot, keeping what a layer leaves out', () => {
    const shown = withPresentation(SIGHTING, { display: { title: 'place', media: 'photo' } });
    expect(shown.display).toEqual({ title: 'place', summary: 'notes', media: 'photo' });
  });

  it('sets a control per field and replaces the authoring list whole', () => {
    const shown = withPresentation(SIGHTING, { controls: { place: 'url' }, authoring: ['place', 'species'] });
    expect(shown.properties.place.control).toBe('url');
    expect(shown.properties.notes.control).toBe('textarea');
    expect(shown.authoring).toEqual({ fields: ['place', 'species'] });
  });

  it('lets the more specific layer win', () => {
    const shown = withPresentation(SIGHTING, { display: { title: 'place' } }, { display: { title: 'notes' } });
    expect(shown.display?.title).toBe('notes');
  });

  it('ignores fields the model does not have, so an older override cannot break a newer model', () => {
    const shown = withPresentation(SIGHTING, {
      display: { title: 'gone', fields: ['gone', 'species'] },
      controls: { gone: 'textarea' },
      authoring: ['gone', 'notes'],
    });
    expect(shown.display).toEqual({ title: 'species', summary: 'notes', fields: ['species'] });
    expect(shown.properties).not.toHaveProperty('gone');
    expect(shown.authoring).toEqual({ fields: ['notes'] });
  });
});

describe('a TypeStyle record’s presentation', () => {
  it('round-trips through the fields a record stores', () => {
    const layer = { display: { title: 'place' }, controls: { notes: 'textarea' as const }, authoring: ['place'] };
    expect(presentationOf(presentationFields(layer))).toEqual(layer);
  });

  it('reads an empty or unreadable field as unset', () => {
    expect(presentationOf({ display: '', controls: '{not json', authoring: '"one"' })).toEqual({});
    expect(presentationFields({})).toEqual({ display: '', controls: '', authoring: '' });
  });
});
