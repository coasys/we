/**
 * What a "create something" picker offers, and how each is made.
 *
 * Content is a block there is a way to make. It used to be anything with a form, less whatever said
 * `offered: false` — a flag asked to mean both "made somewhere specific" (a drawn connection, a
 * vocabulary entry) and "a picture on its own is not a thing" (which did not hold). The first half is
 * already true of what is not a block; the second is gone.
 */
import { creationPath } from '@shared/shapes/recordDraft';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

const path = (name: string) => creationPath(CORE_MANIFEST.entities[name]);

describe('what a person can create', () => {
  it('offers every kind of block with a form — media and text as much as tasks', () => {
    for (const name of [
      'TaskBlock',
      'EventBlock',
      'LinkBlock',
      'LocationBlock',
      'ImageBlock',
      'TextBlock',
      'VideoBlock',
      'AudioBlock',
      'FileBlock',
      'CalloutBlock',
      'EmbedBlock',
    ]) {
      expect(path(name), name).toBe('form');
    }
  });

  it('makes a collection in the composer', () => {
    expect(path('CollectionBlock')).toBe('composer');
  });

  it('leaves out what is not content, form or no form, without a flag', () => {
    for (const name of ['Relationship', 'RelationshipType']) {
      expect(CORE_MANIFEST.entities[name].authoring?.fields.length).toBeGreaterThan(0);
      expect(path(name), name).toBeNull();
    }
    for (const name of ['SignalType', 'Space', 'AgentSettings']) expect(path(name), name).toBeNull();
  });

  it('leaves out a block there is nothing to make of', () => {
    expect(path('DividerBlock')).toBeNull();
  });

  it('says in a line what each creatable block is, for the chooser’s card', () => {
    for (const [name, entity] of Object.entries(CORE_MANIFEST.entities)) {
      if (creationPath(entity)) expect(entity.description, name).toBeTruthy();
    }
  });
});
