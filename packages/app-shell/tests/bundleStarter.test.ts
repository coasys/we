/**
 * Which starter a new space gets: the app's, when it came in a bundle the seed builds in, and
 * otherwise the deployment's.
 */
import { newSpaceStarter } from '@shared/bundles/bundleStarter';
import type { SpaceStarter } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const seedStarter: SpaceStarter = { id: 'seed' };
const appStarter: SpaceStarter = { id: 'app', description: 'A tree and a view' };
const builtIn = [
  { bundleId: 'coasys', name: 'Coasys app', brand: { name: 'Coasys' }, starters: [appStarter] },
  { bundleId: 'plain', name: 'Plain', starters: [] },
];
const inApp = (bundle?: string) => ({ source: bundle ? { bundle, version: '1', piece: 'app' } : undefined });

describe('the starter a new space gets', () => {
  it('is the app’s, named by its brand, while an app that brings one is in use', () => {
    expect(newSpaceStarter({ app: inApp('coasys'), builtIn, seed: [seedStarter] })).toEqual({
      starter: appStarter,
      app: 'Coasys',
    });
  });

  it('is the deployment’s in WE’s own app, and in an app that brings none', () => {
    expect(newSpaceStarter({ app: inApp(), builtIn, seed: [seedStarter] })).toEqual({ starter: seedStarter });
    expect(newSpaceStarter({ app: inApp('plain'), builtIn, seed: [seedStarter] })).toEqual({ starter: seedStarter });
  });

  it('is the deployment’s in an installed app — its starter is somebody else’s, and not asked about yet', () => {
    // An installed app's bundle is never among the seed's, whatever starters it carries.
    expect(newSpaceStarter({ app: inApp('stranger'), builtIn, seed: [seedStarter] })).toEqual({ starter: seedStarter });
  });

  it('is nothing when neither has one', () => {
    expect(newSpaceStarter({ app: inApp(), builtIn, seed: undefined })).toEqual({ starter: undefined });
  });
});
