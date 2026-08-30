/**
 * The lending mechanism the ten back-channels now use.
 *
 * Four audits running have named these: a lower store hands a closure upward, the upper store keeps
 * it in a `let`, and nothing ever takes it back — so a provider that unmounts leaves the upper store
 * reading signals from a disposed scope, answering with whatever was true when the provider died.
 *
 * `hostSlot` and `hostListeners` are three lines each, and the only part with any subtlety is the
 * one that is easy to get wrong in exactly the direction that reintroduces the bug: a disposer must
 * clear the slot **only if the slot is still the one it set**. In Solid a replacement provider
 * mounts before its predecessor disposes, so the naive `() => { current = null }` has the dying
 * provider blank the live value on its way out — turning "stale value" into "no value", which is
 * worse and harder to see.
 */
import { describe, expect, it, vi } from 'vitest';

import { hostListeners, hostSlot } from '../src/shared/hostSlot';

describe('hostSlot', () => {
  it('is empty until something is lent', () => {
    // Absent, not a default: what "nothing lent" means is the caller's decision, and the callers
    // disagree — `autoInterpretGate` reads off, `extractionCandidatesGate` reads none, and
    // `callExtraction` falls back to the candidates.
    expect(hostSlot<string>().get()).toBeNull();
  });

  it('gives back what was lent, and takes it back on dispose', () => {
    const slot = hostSlot<string>();

    const dispose = slot.provide('first');
    expect(slot.get()).toBe('first');

    dispose();
    expect(slot.get()).toBeNull();
  });

  it('does not let a superseded provider clear its successor', () => {
    /*
      The case the whole design is for. Solid mounts the replacement before disposing the one it
      replaced, so this ordering — provide, provide, dispose-the-first — is the ordinary one rather
      than a corner. Under a naive disposer the second provider's value is destroyed by the first
      provider's cleanup, and the symptom is a feature that works until you switch template and then
      is simply gone.
    */
    const slot = hostSlot<string>();

    const disposeFirst = slot.provide('first');
    slot.provide('second');
    disposeFirst();

    expect(slot.get()).toBe('second');
  });

  it('is idempotent, so a disposer running twice is harmless', () => {
    const slot = hostSlot<string>();
    const dispose = slot.provide('value');

    dispose();
    slot.provide('later');
    dispose();

    expect(slot.get()).toBe('later');
  });
});

describe('hostListeners', () => {
  it('calls everyone, and stops calling whoever unsubscribed', () => {
    const listeners = hostListeners<(uuid: string) => void>('test');
    const stayed = vi.fn();
    const left = vi.fn();

    listeners.add(stayed);
    const unsubscribe = listeners.add(left);

    listeners.emit('ds-1');
    expect(stayed).toHaveBeenCalledWith('ds-1');
    expect(left).toHaveBeenCalledWith('ds-1');

    unsubscribe();
    listeners.emit('ds-2');
    expect(stayed).toHaveBeenCalledTimes(2);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('lets one listener fail without silencing the rest', () => {
    /*
      These are teardown paths — "this dataset went away, forget what you knew about it". One
      module failing to let go is a reason to log; it is never a reason to leave every module after
      it in the list holding a dataset that no longer exists.
    */
    const listeners = hostListeners<(uuid: string) => void>('test');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();

    listeners.add(() => {
      throw new Error('nope');
    });
    listeners.add(after);
    listeners.emit('ds-1');

    expect(after).toHaveBeenCalledWith('ds-1');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('survives a listener that unsubscribes itself while being called', () => {
    // Iterating the live set would skip whichever listener came next, which is the quietest
    // possible failure: everything works except that one subscriber, intermittently.
    const listeners = hostListeners<() => void>('test');
    const after = vi.fn();

    const unsubscribe = listeners.add(() => unsubscribe());
    listeners.add(after);
    listeners.emit();

    expect(after).toHaveBeenCalledTimes(1);
  });
});
