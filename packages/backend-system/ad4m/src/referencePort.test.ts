/**
 * A reference carries the executor's verdict on its author when the author is not confirmed, and a
 * refused link is never a referrer.
 */
import { describe, expect, it } from 'vitest';

import { authorVerdictOf, createAd4mReferencePort } from './referencePort';

const ME = 'did:key:z6MkMe';

const link = (source: string, author: string, timestamp: string, verdict?: unknown) => ({
  author,
  timestamp,
  data: { source, predicate: 'we://mention', target: ME },
  proof: { key: '', signature: '' },
  ...(verdict ? { verdict } : {}),
});

describe('authorVerdictOf', () => {
  it('marks only what is shown unconfirmed', () => {
    expect(authorVerdictOf({ kind: 'cantCheck' })).toBe('cantCheck');
    expect(authorVerdictOf({ kind: 'flagged' })).toBe('flagged');
    expect(authorVerdictOf({ kind: 'valid' })).toBeUndefined();
    expect(authorVerdictOf({ kind: 'invalid', reason: 'revoked' })).toBeUndefined();
    expect(authorVerdictOf(undefined)).toBeUndefined();
  });
});

describe('createAd4mReferencePort', () => {
  it('carries cantCheck and flagged, and leaves out a link the executor refused', async () => {
    const links = [
      link('msg-1', 'did:key:z6MkAnn', '2026-11-01T10:00:00Z', { kind: 'valid' }),
      link('msg-2', 'did:key:z6MkBen', '2026-11-01T11:00:00Z', { kind: 'cantCheck' }),
      link('msg-3', 'did:key:z6MkOld', '2026-11-01T12:00:00Z', { kind: 'flagged' }),
      link('msg-4', 'did:key:z6MkBad', '2026-11-01T13:00:00Z', { kind: 'invalid', reason: 'revoked' }),
      link('msg-5', 'did:key:z6MkAnn', '2026-11-01T09:00:00Z'),
    ];
    const dataset = { get: () => Promise.resolve(links) };

    const rows = await createAd4mReferencePort().referrers(dataset, { relation: 'mentions', entity: 'TextBlock' }, ME);

    expect(rows.map((r) => [r.id, r.verdict])).toEqual([
      ['msg-3', 'flagged'],
      ['msg-2', 'cantCheck'],
      ['msg-1', undefined],
      ['msg-5', undefined],
    ]);
    expect(rows[2]).not.toHaveProperty('verdict');
  });
});
