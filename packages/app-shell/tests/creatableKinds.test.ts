/**
 * The record store's kinds as plain rules: what can be made, what can be shown, which schema a name
 * means, and how a class nothing in WE describes is shown anyway.
 */
import type { EntityManifestEntry, EntitySchema } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  coreCreatables,
  displayableKinds,
  foreignDisplays,
  imagePropertyOf,
  inlineEditorFor,
  kindSchemaOf,
  shapeCreatables,
  titleFieldOf,
} from '../src/shared/shapes/creatableKinds';
import type { SpaceShapeView } from '../src/shared/shapes/spaceShapes';

const schema = (properties: EntitySchema['properties']): EntitySchema =>
  ({ properties, relations: {} }) as EntitySchema;

const shape = (name: string, healthy = true): SpaceShapeView =>
  ({
    id: `shape-${name}`,
    name,
    description: `${name}s seen`,
    icon: '',
    problems: healthy ? [] : ['broken'],
    manifest: { entities: { [name]: schema({ title: { type: 'string' } }) } },
  }) as unknown as SpaceShapeView;

describe('what can be made', () => {
  it('lists the core blocks with a way to make them, sorted by label, each saying how', () => {
    const core = coreCreatables();
    expect(core.length).toBeGreaterThan(3);
    expect(core.map((row) => row.label)).toEqual([...core.map((row) => row.label)].sort((a, b) => a.localeCompare(b)));
    expect(core.every((row) => row.group === 'Built in' && (row.via === 'form' || row.via === 'composer'))).toBe(true);
    expect(core.find((row) => row.value === 'TaskBlock')?.via).toBe('form');
  });

  it('lists only the space’s healthy shapes, as forms', () => {
    const rows = shapeCreatables([shape('Sighting'), shape('Broken', false), shape('Alpha')]);
    expect(rows.map((row) => row.value)).toEqual(['Alpha', 'Sighting']);
    expect(rows[1]).toMatchObject({ group: 'This space', icon: 'cube', via: 'form', description: 'Sightings seen' });
  });
});

describe('what can be shown', () => {
  it('adds a connection and every core block to what can be made', () => {
    const shown = displayableKinds(coreCreatables()).map((row) => row.value);
    expect(shown).toContain('Relationship');
    expect(shown).toContain('CollectionBlock');
  });

  it('leaves a space’s own model of the same name as it is', () => {
    const own = {
      label: 'Mine',
      value: 'Relationship',
      icon: 'x',
      hue: 'h',
      group: 'This space',
      description: '',
      via: 'form' as const,
    };
    const shown = displayableKinds([own]);
    expect(shown.filter((row) => row.value === 'Relationship')).toEqual([own]);
  });
});

describe('which schema a name means', () => {
  it('prefers the space’s own shape over a core entity of the same name', () => {
    const own = { ...shape('TaskBlock') };
    expect(kindSchemaOf([own], 'TaskBlock')).toMatchObject({ authorable: true, label: 'TaskBlock' });
    expect(kindSchemaOf([], 'TaskBlock')).toMatchObject({ authorable: false });
    expect(kindSchemaOf([], 'Nothing')).toBeUndefined();
  });
});

describe('relation targets', () => {
  it('finds a picture by a file property whose name reads as one', () => {
    expect(imagePropertyOf(schema({ photo: { type: 'string', format: 'file' } as never }))).toBe('photo');
    expect(imagePropertyOf(schema({ attachment: { type: 'string', format: 'file' } as never }))).toBe('');
  });

  it('edits a place on a map and a required picture with the image editor', () => {
    expect(inlineEditorFor('LocationBlock', schema({}))).toBe('location');
    expect(inlineEditorFor('Photo', schema({ src: { type: 'string', format: 'file', required: true } as never }))).toBe(
      'image',
    );
    expect(inlineEditorFor('Photo', schema({ src: { type: 'string', format: 'file' } as never }))).toBe('');
  });

  it('names a record by its identity property, else its name', () => {
    expect(titleFieldOf(schema({ key: { type: 'string', identity: true } as never, name: { type: 'string' } }))).toBe(
      'key',
    );
    expect(titleFieldOf(schema({ name: { type: 'string' } }))).toBe('name');
  });
});

describe('a class the dataset already had', () => {
  const entry = (name: string): EntityManifestEntry =>
    ({
      name,
      properties: [
        { name: 'title', type: 'string' },
        { name: 'url', type: 'uri' },
        { name: 'owner', type: 'string', relatedEntity: 'Person' },
      ],
    }) as unknown as EntityManifestEntry;

  it('lists its scalar properties, and leaves WE’s own and the ones already shown alone', () => {
    const out = foreignDisplays([entry('Channel'), entry('Space'), entry('Known')], { Known: {} as never });
    expect(Object.keys(out)).toEqual(['Channel']);
    expect(out.Channel.fields.map((field) => field.name)).toEqual(['title', 'url']);
  });
});
