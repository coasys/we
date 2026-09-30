import { describe, expect, it } from 'vitest';

import { resolveProp } from './dispatcher';
import { REACTIVE_ACCESSOR } from './reactive';

const unwrap = (value: unknown): unknown =>
  typeof value === 'function' && REACTIVE_ACCESSOR in value ? (value as unknown as () => unknown)() : value;

// The neutral-vocabulary globals: a host-injected `$<key>` store global (identity/dataset vocab —
// `$me`, `$currentDataset`, …) is what an expression's `me` / `currentDataset` root reads.
describe('resolveProp — neutral global refs (me etc.)', () => {
  it('resolves me from a $me store global (accessor called)', () => {
    expect(unwrap(resolveProp({ $: 'me' }, { $me: () => 'did:key:z6Mk' }, {}))).toBe('did:key:z6Mk');
  });

  it('resolves me from a plain (non-accessor) global too', () => {
    expect(unwrap(resolveProp({ $: 'me' }, { $me: 'did:plain' }, {}))).toBe('did:plain');
  });

  it('local context wins over the global (so item/space are never shadowed)', () => {
    expect(unwrap(resolveProp({ $: 'me' }, { $me: () => 'did:global' }, { me: 'ctx-me' }))).toBe('ctx-me');
  });

  it('walks a dotted path after the global (e.g. an object-valued global)', () => {
    expect(unwrap(resolveProp({ $: 'viewer.did' }, { $viewer: () => ({ did: 'did:x' }) }, {}))).toBe('did:x');
  });

  it('reads nothing when neither context nor a $-global provides it', () => {
    expect(unwrap(resolveProp({ $: 'unknown' }, {}, {}))).toBeUndefined();
  });
});

describe('resolveProp — strings are text', () => {
  it('returns a dollar-prefixed string verbatim rather than resolving it', () => {
    expect(resolveProp('$me.did', { $me: () => ({ did: 'x' }) }, { me: { did: 'y' } })).toBe('$me.did');
    expect(resolveProp('$item.name', {}, { item: { name: 'z' } })).toBe('$item.name');
  });
});
