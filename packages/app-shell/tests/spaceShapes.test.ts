/**
 * The rules the shape store applies to a space's models, asked directly: which stored models stand,
 * what an interpretation pass could write, and what a relationship may point at.
 */
import type { EntityManifest, StoredShape } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { draftMember, draftToManifest, emptyShapeDraft } from '../src/shared/shapes/shapeDraft';
import {
  BLOCK_ICONS,
  interpretationCandidatesOf,
  knownEntityNames,
  relationshipTargetOptions,
  shapeViewsOf,
} from '../src/shared/shapes/spaceShapes';

/** A model as the wizard would save it: one text field, and a relationship when `to` names a target. */
function manifestOf(name: string, options: { to?: string; extractable?: boolean } = {}): EntityManifest {
  const members = [draftMember({ name: 'title', required: true })];
  if (options.to) members.push(draftMember({ kind: 'relationship', name: 'about', target: options.to }));
  const lowered = draftToManifest(
    { ...emptyShapeDraft(), name, extractable: options.extractable ?? false, members },
    `${name.toLowerCase()}-uuid`,
  );
  if (!lowered.ok) throw new Error(lowered.errors.join('; '));
  return lowered.manifest;
}

const stored = (name: string, manifest: EntityManifest | null): StoredShape => ({
  id: `record-${name}`,
  name,
  description: '',
  icon: '',
  shapeId: `we://shapes/${name.toLowerCase()}-uuid`,
  version: 1,
  forkedFrom: '',
  manifest,
  editable: true,
});

describe('shapeViewsOf', () => {
  it('resolves a reference to a sibling model whatever the record order', () => {
    const views = shapeViewsOf(
      [stored('Note', manifestOf('Note', { to: 'Sighting' })), stored('Sighting', manifestOf('Sighting'))],
      [],
    );
    expect(views.map((v) => [v.name, v.problems])).toEqual([
      ['Note', []],
      ['Sighting', []],
    ]);
    expect(views[0].manifest).not.toBeNull();
    expect(views[0].propertyCount).toBe(2);
  });

  it('resolves a reference to a class the space already had', () => {
    const [view] = shapeViewsOf([stored('Note', manifestOf('Note', { to: 'Channel' }))], ['Channel']);
    expect(view.problems).toEqual([]);
  });

  it('says why a model does not stand, and gives it no manifest', () => {
    const [missing, dangling] = shapeViewsOf(
      [stored('Lost', null), stored('Note', manifestOf('Note', { to: 'Nowhere' }))],
      [],
    );
    expect(missing.problems).toEqual(['definition document missing or unreadable']);
    expect(missing.manifest).toBeNull();
    expect(dangling.problems.length).toBeGreaterThan(0);
    expect(dangling.manifest).toBeNull();
  });

  it('keeps the manifest of a record named for an entity it does not declare, and says so', () => {
    const [view] = shapeViewsOf([stored('Renamed', manifestOf('Sighting'))], []);
    expect(view.manifest).not.toBeNull();
    expect(view.problems).toEqual(['definition does not declare an entity named "Renamed"']);
  });
});

describe('interpretationCandidatesOf', () => {
  it('lists core vocabulary first, then extractable models, then the space’s own classes', () => {
    const { candidates, shadowed } = interpretationCandidatesOf(
      [
        { name: 'Sighting', manifest: manifestOf('Sighting', { extractable: true }) },
        { name: 'Diary', manifest: manifestOf('Diary') },
        { name: 'Broken', manifest: null },
      ],
      [{ name: 'Recipe', interpretationHint: 'A dish' }],
      [],
    );
    expect([...candidates.slice(0, 3)].sort()).toEqual(['EventBlock', 'Relationship', 'TaskBlock']);
    expect(candidates[3]).toBe('Sighting');
    expect(candidates).toContain('Sighting');
    expect(candidates).not.toContain('Diary');
    expect(candidates).not.toContain('Broken');
    expect(candidates.at(-1)).toBe('Recipe');
    expect(shadowed).toEqual([]);
  });

  it('does not offer a class of the space’s whose name WE already has, and says it is shadowed', () => {
    const { candidates, shadowed } = interpretationCandidatesOf(
      [],
      [{ name: 'Recipe', interpretationHint: 'x' }],
      ['Recipe'],
    );
    expect(candidates).not.toContain('Recipe');
    expect(shadowed).toEqual(['Recipe']);
  });

  it('names a model once when it is named after core vocabulary', () => {
    const { candidates } = interpretationCandidatesOf(
      [{ name: 'TaskBlock', manifest: manifestOf('TaskBlock', { extractable: true }) }],
      [],
      [],
    );
    expect(candidates.filter((n) => n === 'TaskBlock')).toHaveLength(1);
  });
});

describe('relationshipTargetOptions', () => {
  it('groups the space’s models, the blocks and the other classes, each sorted and deduplicated', () => {
    const options = relationshipTargetOptions(
      [
        { name: 'Zebra', icon: '', manifest: manifestOf('Zebra') },
        { name: 'Apple', icon: 'leaf', manifest: manifestOf('Apple') },
        { name: 'Broken', icon: '', manifest: null },
      ],
      [{ name: 'Channel' }, { name: 'Channel' }],
    );
    const groups = [...new Set(options.map((o) => o.group))];
    expect(groups).toEqual(['This space', 'Blocks', 'Other models in this space']);
    expect(options.filter((o) => o.group === 'This space')).toEqual([
      { label: 'Apple', value: 'Apple', group: 'This space', icon: 'leaf' },
      { label: 'Zebra', value: 'Zebra', group: 'This space', icon: 'cube' },
    ]);
    const blocks = options.filter((o) => o.group === 'Blocks');
    expect(blocks.every((o) => o.value.endsWith('Block'))).toBe(true);
    expect(blocks.find((o) => o.value === 'ImageBlock')?.icon).toBe(BLOCK_ICONS.ImageBlock);
    expect(options.filter((o) => o.value === 'Channel')).toHaveLength(1);
  });
});

describe('knownEntityNames', () => {
  it('names core, the space’s classes and every model but the one being edited', () => {
    const names = knownEntityNames(
      [
        { id: 'a', name: 'Sighting' },
        { id: 'b', name: 'Note' },
      ],
      [{ name: 'Channel' }],
      'a',
    );
    expect(names).toContain('TaskBlock');
    expect(names).toContain('Channel');
    expect(names).toContain('Note');
    expect(names).not.toContain('Sighting');
  });
});
