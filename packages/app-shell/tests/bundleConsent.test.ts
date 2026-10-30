/**
 * An update does not inherit consent it was never given: what a newer version asks for beyond what the
 * installed one was agreed to is worked out from both judgements, and said on its own.
 */
import { asksForMore, bundleDigest, grantOf, whatIsNew } from '@shared/bundles/consent';
import { installedEntry, readInstalledBundles, withInstalled } from '@shared/bundles/installedBundles';
import type { CapabilityGroup } from '@shared/registries/templateSurface';
import { CAPABILITY_GROUPS } from '@shared/registries/templateSurface';
import { describe, expect, it } from 'vitest';

const groups = Object.keys(CAPABILITY_GROUPS) as CapabilityGroup[];
const [first, second, third] = groups;

const judged = (over: { groups?: CapabilityGroup[]; modules?: string[]; recordTypes?: string[] } = {}) => ({
  groups: over.groups ?? [first],
  modules: over.modules ?? ['polls'],
  adds: { spaceTemplates: [], sections: [], pages: [], themes: [], recordTypes: over.recordTypes ?? ['Species'] },
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
    pages: [],
    themes: [],
    recordTypes: [],
  } as never;

  it('is kept, and read back with the record', () => {
    const granted = grantOf(judged({ groups: [first, second] }));
    const entry = installedEntry(pieces, { name: 'Field guide', icon: 'leaf', at: 'now', granted, digest: 'abc' });
    const [read] = readInstalledBundles(JSON.stringify(withInstalled([], entry)));
    expect(read.granted).toEqual(granted);
    expect(read.digest).toBe('abc');
    expect(whatIsNew(judged({ groups: [first, second] }), read.granted)).toEqual({
      capabilities: [],
      modules: [],
      recordTypes: [],
    });
  });
});

describe('whether a file is the one installed', () => {
  const bundle = { id: 'field-guide', version: '1.0.0', templates: [{ id: 'a', meta: { name: 'A', icon: 'x' } }] };

  it('reads the same for the same content, whatever order its keys were written in', async () => {
    const reordered = { templates: [{ meta: { icon: 'x', name: 'A' }, id: 'a' }], version: '1.0.0', id: 'field-guide' };
    expect(await bundleDigest(reordered)).toBe(await bundleDigest(bundle));
  });

  it('differs for different content, even under the same version', async () => {
    const edited = { ...bundle, templates: [{ id: 'a', meta: { name: 'B', icon: 'x' } }] };
    expect(await bundleDigest(edited)).not.toBe(await bundleDigest(bundle));
  });
});
