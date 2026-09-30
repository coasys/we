/**
 * The model registry — the lookup every dynamic model resolution goes through.
 *
 * Its own doc comments describe two failure modes worth pinning: the
 * globalThis keying that makes split-bundle registries impossible, and the
 * `uuid`-not-`id` rule for perspective handles (a PerspectiveProxy carries an
 * unrelated subscription `id` that must not win).
 */
import { describe, expect, it } from 'vitest';

import {
  type EntityClass,
  getEntity,
  getEntityForDataset,
  getRegisteredEntityNames,
  registerDynamicEntities,
  registerEntity,
  unregisterEntity,
} from '../src/entityRegistry';

class FakeNative {}
class FakeSynth {}
const Native = FakeNative as unknown as EntityClass;
const Synth = FakeSynth as unknown as EntityClass;

describe('global registry', () => {
  it('register → get → unregister round-trips, and getEntity throws on a miss', () => {
    registerEntity('Thing', Native);
    expect(getEntity('Thing')).toBe(Native);
    expect(getRegisteredEntityNames()).toContain('Thing');
    unregisterEntity('Thing');
    expect(() => getEntity('Thing')).toThrow(/not found in registry/);
  });

  it('is keyed on globalThis, so a second copy of the module sees the same state', () => {
    registerEntity('SharedThing', Native);
    const other = (globalThis as never as Record<symbol, Record<string, unknown>>)[Symbol.for('we.models.registry')];
    expect(other.SharedThing).toBe(Native);
    unregisterEntity('SharedThing');
  });
});

describe('getEntityForDataset', () => {
  it('prefers the globally registered native class over a synthesised one', () => {
    registerEntity('Post', Native);
    registerDynamicEntities('uuid-1', { Post: Synth });
    // Native classes carry decorator metadata a SHACL-synthesised class never has.
    expect(getEntityForDataset('Post', { uuid: 'uuid-1' })).toBe(Native);
    unregisterEntity('Post');
  });

  it('falls back to the per-perspective registry for external models', () => {
    registerDynamicEntities('uuid-2', { Channel: Synth });
    expect(getEntityForDataset('Channel', { uuid: 'uuid-2' })).toBe(Synth);
    expect(getEntityForDataset('Channel', { uuid: 'other-uuid' })).toBeUndefined();
  });

  it('reads uuid, never id — a proxy also carries an unrelated subscription id', () => {
    registerDynamicEntities('uuid-3', { Message: Synth });
    expect(getEntityForDataset('Message', { id: 'uuid-3' })).toBeUndefined();
    expect(getEntityForDataset('Message', { uuid: 'uuid-3', id: 'subscription-9' })).toBe(Synth);
  });

  it('returns undefined rather than throwing, so callers can fall back', () => {
    expect(getEntityForDataset('Nothing', undefined)).toBeUndefined();
  });
});
