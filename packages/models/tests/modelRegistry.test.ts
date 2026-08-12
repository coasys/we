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
  getModel,
  getModelForPerspective,
  getRegisteredModelNames,
  type ModelClass,
  registerDynamicModels,
  registerModel,
  unregisterModel,
} from '../src/modelRegistry';

class FakeNative {}
class FakeSynth {}
const Native = FakeNative as unknown as ModelClass;
const Synth = FakeSynth as unknown as ModelClass;

describe('global registry', () => {
  it('register → get → unregister round-trips, and getModel throws on a miss', () => {
    registerModel('Thing', Native);
    expect(getModel('Thing')).toBe(Native);
    expect(getRegisteredModelNames()).toContain('Thing');
    unregisterModel('Thing');
    expect(() => getModel('Thing')).toThrow(/not found in registry/);
  });

  it('is keyed on globalThis, so a second copy of the module sees the same state', () => {
    registerModel('SharedThing', Native);
    const other = (globalThis as never as Record<symbol, Record<string, unknown>>)[
      Symbol.for('we.models.registry')
    ];
    expect(other.SharedThing).toBe(Native);
    unregisterModel('SharedThing');
  });
});

describe('getModelForPerspective', () => {
  it('prefers the globally registered native class over a synthesised one', () => {
    registerModel('Post', Native);
    registerDynamicModels('uuid-1', { Post: Synth });
    // Native classes carry decorator metadata a SHACL-synthesised class never has.
    expect(getModelForPerspective('Post', { uuid: 'uuid-1' })).toBe(Native);
    unregisterModel('Post');
  });

  it('falls back to the per-perspective registry for external models', () => {
    registerDynamicModels('uuid-2', { Channel: Synth });
    expect(getModelForPerspective('Channel', { uuid: 'uuid-2' })).toBe(Synth);
    expect(getModelForPerspective('Channel', { uuid: 'other-uuid' })).toBeUndefined();
  });

  it('reads uuid, never id — a proxy also carries an unrelated subscription id', () => {
    registerDynamicModels('uuid-3', { Message: Synth });
    expect(getModelForPerspective('Message', { id: 'uuid-3' })).toBeUndefined();
    expect(getModelForPerspective('Message', { uuid: 'uuid-3', id: 'subscription-9' })).toBe(Synth);
  });

  it('returns undefined rather than throwing, so callers can fall back', () => {
    expect(getModelForPerspective('Nothing', undefined)).toBeUndefined();
  });
});
