/**
 * A suggestion's kind, as the executor actually sends it.
 *
 * `list_overlays` passes `kind` through as the raw link target — an encoded literal, and for a
 * subject property a signed expression envelope inside it — so comparing it to `'create'` failed for
 * every suggestion, and every one of them drew as accepted.
 */
import { Literal } from '@coasys/ad4m';
import { describe, expect, it } from 'vitest';

import { overlayKind } from '../src/interpretationAdapter';

const envelope = (data: unknown) =>
  Literal.from({
    author: 'did:key:z6Mk',
    timestamp: '2026-09-14T12:00:00Z',
    data,
    proof: { signature: 'x', key: 'y' },
  }).toUrl();

describe('the kind of a staged suggestion', () => {
  it('reads a signed envelope, the way the executor stores it', () => {
    expect(overlayKind(envelope('update'))).toBe('update');
    expect(overlayKind(envelope('create'))).toBe('create');
  });

  it('reads a plain string literal, and a bare word from an executor that already decodes it', () => {
    expect(overlayKind(Literal.from('update').toUrl())).toBe('update');
    expect(overlayKind('update')).toBe('update');
    expect(overlayKind('create')).toBe('create');
  });

  it('reads an envelope whose data is itself a literal', () => {
    expect(overlayKind(envelope(Literal.from('update').toUrl()))).toBe('update');
  });

  it('treats anything it cannot read as a draft, the safe way to be wrong', () => {
    // Drawn as provisional is recoverable at a glance; drawn as agreed is the bug this guards.
    expect(overlayKind(undefined)).toBe('create');
    expect(overlayKind('literal:json:%7Bnot-json')).toBe('create');
  });
});
