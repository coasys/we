/**
 * An update does not inherit consent it was never given: what a newer version asks for beyond what the
 * installed one was agreed to is worked out from both judgements, and said on its own.
 */
import { asksForMore, grantOf, whatIsNew } from '@shared/bundles/consent';
import { installedEntry, readInstalledBundles, withInstalled } from '@shared/bundles/installedBundles';
import type { CapabilityGroup } from '@shared/registries/templateSurface';
import { CAPABILITY_GROUPS } from '@shared/registries/templateSurface';
import { describe, expect, it } from 'vitest';

const groups = Object.keys(CAPABILITY_GROUPS) as CapabilityGroup[];
const [first, second, third] = groups;

const judged = (over: { groups?: CapabilityGroup[]; modules?: string[]; recordTypes?: string[] } = {}) => ({
  groups: over.groups ?? [first],
  modules: over.modules ?? ['polls'],
  adds: { spaceTemplates: [], sections: [], recordTypes: over.recordTypes ?? ['Species'] },
});

describe('what a newer version asks for', () => {
  it('is nothing when it asks for what was agreed', () => {
    const news = whatIsNew(judged(), grantOf(judged()));
    expect(news).toEqual({ capabilities: [], modules: [], recordTypes: [] });
    expect(asksForMore(news!)).toBe(false);
  });

  it('names only what is new, in the words a person reads', () => {
    const news = whatIsNew(
      judged({ groups: [first, second], modules: ['polls', 'call'], recordTypes: ['Species', 'Sighting'] }),
      grantOf(judged()),
    );
    expect(news).toEqual({ capabilities: [CAPABILITY_GROUPS[second]], modules: ['call'], recordTypes: ['Sighting'] });
    expect(asksForMore(news!)).toBe(true);
  });

  it('does not count something dropped as new', () => {
    const news = whatIsNew(
      judged({ groups: [], modules: [], recordTypes: [] }),
      grantOf(judged({ groups: [first, third] })),
    );
    expect(asksForMore(news!)).toBe(false);
  });

  it('cannot say, for an install from before agreements were kept', () => {
    expect(whatIsNew(judged(), undefined)).toBeNull();
  });
});

describe('the agreement on the install record', () => {
  const pieces = {
    bundleId: 'field-guide',
    version: '1.0.0',
    shells: [],
    sections: [],
    recordTypes: [],
  } as never;

  it('is kept, and read back with the record', () => {
    const granted = grantOf(judged({ groups: [first, second] }));
    const entry = installedEntry(pieces, { name: 'Field guide', icon: 'leaf', at: 'now', granted });
    const [read] = readInstalledBundles(JSON.stringify(withInstalled([], entry)));
    expect(read.granted).toEqual(granted);
    expect(whatIsNew(judged({ groups: [first, second] }), read.granted)).toEqual({
      capabilities: [],
      modules: [],
      recordTypes: [],
    });
  });
});
