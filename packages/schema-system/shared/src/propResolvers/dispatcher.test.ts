import { describe, expect, it } from 'vitest';

import { resolveProp } from './dispatcher';

// The neutral-vocabulary fallback: a `$<key>` ref not in the local render context resolves from a
// host-injected `$<key>` store global (identity/dataset vocab — `$me`, `$currentDataset`, …).
describe('resolveProp — neutral global refs ($me etc.)', () => {
  it('resolves $me from a $me store global (accessor called)', () => {
    expect(resolveProp('$me', { $me: () => 'did:key:z6Mk' }, {})).toBe('did:key:z6Mk');
  });

  it('resolves $me from a plain (non-accessor) global too', () => {
    expect(resolveProp('$me', { $me: 'did:plain' }, {})).toBe('did:plain');
  });

  it('local context wins over the global (so $item/$space are never shadowed)', () => {
    expect(resolveProp('$me', { $me: () => 'did:global' }, { me: 'ctx-me' })).toBe('ctx-me');
  });

  it('walks a dotted path after the global (e.g. an object-valued global)', () => {
    expect(resolveProp('$viewer.did', { $viewer: () => ({ did: 'did:x' }) }, {})).toBe('did:x');
  });

  it('returns the raw string when neither context nor a $-global provides it', () => {
    expect(resolveProp('$unknown', {}, {})).toBe('$unknown');
  });
});
