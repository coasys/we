import { describe, expect, it } from 'vitest';

import { isCollectionMode, isReconcilable } from './modes';

describe('isCollectionMode', () => {
  it('accepts the three declared modes', () => {
    expect(isCollectionMode('document')).toBe(true);
    expect(isCollectionMode('feed')).toBe(true);
    expect(isCollectionMode('collaborative')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isCollectionMode('')).toBe(false);
    expect(isCollectionMode('post')).toBe(false);
    expect(isCollectionMode(undefined)).toBe(false);
    expect(isCollectionMode(null)).toBe(false);
    expect(isCollectionMode(1)).toBe(false);
  });
});

describe('isReconcilable', () => {
  it('allows document mode', () => {
    expect(isReconcilable('document')).toBe(true);
  });

  it('refuses feed mode — reconcile would delete other agents content', () => {
    expect(isReconcilable('feed')).toBe(false);
  });

  it('refuses collaborative mode: the allow-list, not a deny-list on feed', () => {
    expect(isReconcilable('collaborative')).toBe(false);
  });

  it('refuses an unrecognised mode, for the same reason', () => {
    expect(isReconcilable('something-later')).toBe(false);
  });

  it('allows an absent mode — every post predating the field', () => {
    expect(isReconcilable(undefined)).toBe(true);
    expect(isReconcilable(null)).toBe(true);
    expect(isReconcilable('')).toBe(true);
  });
});
