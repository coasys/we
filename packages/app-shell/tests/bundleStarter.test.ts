/**
 * What a new space can start with: the app's starters when it came in a bundle the seed builds in,
 * otherwise the deployment's, then an empty space — and what each one writes, counted from its records.
 */
import { NO_STARTER, spaceStarterChoices, starterIncludes } from '@shared/bundles/bundleStarter';
import type { SpaceStarter } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const seedStarter: SpaceStarter = { id: 'seed', name: 'Workshop' };
const appStarter: SpaceStarter = { id: 'app', name: 'Kit', description: 'A tree and a view', icon: 'dna' };
const builtIn = [
  { bundleId: 'coasys', name: 'Coasys app', brand: { name: 'Coasys' }, starters: [appStarter] },
  { bundleId: 'plain', name: 'Plain', starters: [] },
];
const inApp = (bundle?: string) => ({ source: bundle ? { bundle, version: '1', piece: 'app' } : undefined });
const ids = (facts: Parameters<typeof spaceStarterChoices>[0]) => spaceStarterChoices(facts).map((c) => c.id);

describe('what a new space can start with', () => {
  it('leads with the app’s starter, named by its brand, while an app that brings one is in use', () => {
    const [first] = spaceStarterChoices({ app: inApp('coasys'), builtIn, seed: [seedStarter] });
    expect(first).toMatchObject({ id: 'app', name: 'Kit', icon: 'dna', app: 'Coasys', starter: appStarter });
    // In place of the deployment's, not beside it.
    expect(ids({ app: inApp('coasys'), builtIn, seed: [seedStarter] })).toEqual(['app', NO_STARTER]);
  });

  it('leads with the deployment’s in WE’s own app, and in an app that brings none', () => {
    expect(ids({ app: inApp(), builtIn, seed: [seedStarter] })).toEqual(['seed', NO_STARTER]);
    expect(ids({ app: inApp('plain'), builtIn, seed: [seedStarter] })).toEqual(['seed', NO_STARTER]);
  });

  it('leaves out an installed app’s starter — it is somebody else’s, and not asked about yet', () => {
    // An installed app's bundle is never among the seed's, whatever starters it carries.
    expect(ids({ app: inApp('stranger'), builtIn, seed: [seedStarter] })).toEqual(['seed', NO_STARTER]);
  });

  it('always offers an empty space, last, which applies no starter', () => {
    const choices = spaceStarterChoices({ app: inApp(), builtIn, seed: undefined });
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ id: NO_STARTER, name: 'Empty space', starter: undefined });
  });
});

describe('what a starter includes', () => {
  it('counts what it writes by what each record is, and a collection by its kind', () => {
    const starter: SpaceStarter = {
      id: 'kit',
      records: [
        { entity: 'SignalType' },
        { entity: 'TaskState' },
        { entity: 'TaskState' },
        { entity: 'InvolvementType' },
        { $id: 'canvas', entity: 'CollectionBlock', fields: { kind: 'canvas' }, in: '$root' },
        { $id: 'board', entity: 'CollectionBlock', fields: { kind: 'board' }, in: '$root' },
      ],
    };
    expect(starterIncludes(starter)).toBe('1 reaction · 2 task states · 1 way to be involved · a canvas · a board');
  });

  it('leaves out what sits inside another of its records — a board’s columns are the board', () => {
    const starter: SpaceStarter = {
      id: 'kit',
      records: [
        { $id: 'board', entity: 'CollectionBlock', fields: { kind: 'board' }, in: '$root' },
        { entity: 'CollectionBlock', fields: { kind: 'column' }, in: '$board' },
        { entity: 'CollectionBlock', fields: { kind: 'column' }, in: '$board' },
      ],
    };
    expect(starterIncludes(starter)).toBe('a board');
  });

  it('names an entity it has no word for by the entity', () => {
    expect(starterIncludes({ id: 'kit', records: [{ entity: 'Badge' }, { entity: 'Badge' }] })).toBe('2 Badges');
  });

  it('is empty for a starter that writes nothing', () => {
    expect(starterIncludes({ id: 'settings-only', settings: { autoInterpret: true } })).toBe('');
  });
});
