/**
 * The record URI's grammar, and the two properties everything downstream leans on: an id that
 * carries its own slashes survives a round trip, and a personal dataset never claims to be portable.
 */
import { describe, expect, it } from 'vitest';

import {
  datasetIdOf,
  datasetKey,
  datasetKindOf,
  formatAgentRef,
  formatRef,
  isPortableRef,
  parseRef,
} from './recordRef';

const AD4M_ID = 'ad4m://obj/8f14e45f-ea8f-4b0e-9c1a-1d2e3f4a5b6c';

describe('naming a dataset', () => {
  it('prefers the CID, which is the same string for every agent who joined', () => {
    expect(datasetKey({ cid: 'Qm123', uuid: 'local-uuid' })).toBe('n:Qm123');
  });

  it('strips the scheme, so the two spellings of one neighbourhood are one key', () => {
    expect(datasetKey({ cid: 'neighbourhood://Qm123' })).toBe('n:Qm123');
  });

  it('falls back to the local uuid for a personal dataset', () => {
    expect(datasetKey({ uuid: 'local-uuid' })).toBe('p:local-uuid');
  });

  it('says which kind a key names', () => {
    expect(datasetKindOf('n:Qm123')).toBe('neighbourhood');
    expect(datasetKindOf('p:abc')).toBe('personal');
    expect(datasetKindOf('agent')).toBe('agent');
    expect(datasetKindOf('nonsense')).toBeNull();
  });

  it('gives the id back without its prefix', () => {
    expect(datasetIdOf('n:Qm123')).toBe('Qm123');
    expect(datasetIdOf('p:abc')).toBe('abc');
  });
});

describe('round trips', () => {
  it('survives an id that carries its own slashes', () => {
    // The whole reason the grammar takes "everything after the second slash" as the id.
    const ref = formatRef({ datasetKey: 'n:Qm123', entity: 'CollectionBlock', id: AD4M_ID });
    expect(ref).toBe(`we:n:Qm123/CollectionBlock/${AD4M_ID}`);
    expect(parseRef(ref)).toEqual({ datasetKey: 'n:Qm123', entity: 'CollectionBlock', id: AD4M_ID });
  });

  it('round trips a personal dataset', () => {
    const ref = formatRef({ datasetKey: 'p:abc', entity: 'TextBlock', id: AD4M_ID });
    expect(parseRef(ref)?.datasetKey).toBe('p:abc');
  });

  it('round trips a person', () => {
    const did = 'did:key:z6MkabcDEF';
    expect(parseRef(formatAgentRef(did))).toEqual({ datasetKey: 'agent', entity: 'Agent', id: did });
  });

  it('round trips the bare dataset form — the space that dataset is', () => {
    // A space dragged out of a sidebar has a dataset before its Space record has loaded.
    const ref = formatRef({ datasetKey: 'n:Qm123' });
    expect(ref).toBe('we:n:Qm123');
    expect(parseRef(ref)).toEqual({ datasetKey: 'n:Qm123', entity: '', id: '' });
  });
});

describe('the relative form', () => {
  it('names a record in whatever dataset the reference is read in', () => {
    // What the composer writes: it has no store, so it cannot name a dataset — and naming one
    // would be wrong anyway, since a copied post would carry an address back to where it came from.
    const ref = formatRef({ datasetKey: '.', entity: 'CollectionBlock', id: AD4M_ID });
    expect(ref).toBe(`we:./CollectionBlock/${AD4M_ID}`);
    expect(parseRef(ref)).toEqual({ datasetKey: '.', entity: 'CollectionBlock', id: AD4M_ID });
  });

  it('is its own kind, and counts as portable', () => {
    expect(datasetKindOf('.')).toBe('relative');
    expect(isPortableRef(`we:./TextBlock/${AD4M_ID}`)).toBe(true);
  });

  it('refuses the bare form, which would name nothing', () => {
    expect(parseRef('we:.')).toBeNull();
  });
});

describe('refusing what is not a reference', () => {
  it.each([
    ['empty', ''],
    ['undefined', undefined],
    ['another scheme', 'https://example.com/thing'],
    ['a bare id', AD4M_ID],
    ['the scheme alone', 'we:'],
    ['an unknown dataset kind', 'we:x:123/TextBlock/abc'],
    ['a dataset and an entity but no id', 'we:n:Qm123/TextBlock'],
    ['an agent with no did', 'we:agent/'],
  ])('answers null for %s', (_name, value) => {
    expect(parseRef(value as string | undefined)).toBeNull();
  });

  it('answers null rather than throwing, because these come out of stored data', () => {
    // A record written by an older version must degrade to "cannot resolve this", never take a
    // render down.
    expect(() => parseRef('we:garbage')).not.toThrow();
  });
});

describe('portability', () => {
  it('a neighbourhood reference means the same thing to somebody else', () => {
    expect(isPortableRef(`we:n:Qm123/CollectionBlock/${AD4M_ID}`)).toBe(true);
  });

  it('an agent reference does too — a DID is global', () => {
    expect(isPortableRef('we:agent/did:key:z6Mkabc')).toBe(true);
  });

  it('a personal reference does not, and must not be shared as though it did', () => {
    expect(isPortableRef(`we:p:local-uuid/CollectionBlock/${AD4M_ID}`)).toBe(false);
  });

  it('nonsense is not portable either', () => {
    expect(isPortableRef('not a ref')).toBe(false);
  });
});
