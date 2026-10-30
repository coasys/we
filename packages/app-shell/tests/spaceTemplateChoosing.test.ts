/**
 * A space opened for the first time after a reboot, before its template has been read: the host
 * shows that it is loading, rather than the space's address drawn in the template before — which
 * flashed the landing page's spaces, as cards, before the space's own template arrived.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHOOSING_GIVE_UP_MS, createSpaceTemplateChoosing } from '../src/frameworks/solid/stores/spaceTemplateChoosing';

function harness() {
  const [currentId, setCurrentId] = createSignal<string | null>('space-a');
  const choosing = createRoot(() => createSpaceTemplateChoosing({ currentId }));
  return { choosing, setCurrentId };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a space waiting for its template', () => {
  it('is not, until the arrival says nothing was put up for it', () => {
    // Every switch is unsettled for a moment; a space whose template is held must not show a spinner.
    const { choosing } = harness();
    expect(choosing.choosing()).toBe(false);
    choosing.start('space-a');
    expect(choosing.choosing()).toBe(true);
  });

  it('stops waiting the moment a template is put up, or choosing for it ends', () => {
    const { choosing } = harness();
    choosing.start('space-a');
    choosing.done();
    expect(choosing.choosing()).toBe(false);

    choosing.start('space-a');
    choosing.done('space-a');
    expect(choosing.choosing()).toBe(false);
  });

  it('is about the space on screen: one left behind, or ending for another, changes nothing here', () => {
    const { choosing, setCurrentId } = harness();
    choosing.start('space-a');
    choosing.done('space-b');
    expect(choosing.choosing()).toBe(true);
    setCurrentId('space-b');
    expect(choosing.choosing()).toBe(false);
  });

  it('gives up after a while, so a template that never arrives cannot hold the space behind a spinner', () => {
    const { choosing } = harness();
    choosing.start('space-a');
    vi.advanceTimersByTime(CHOOSING_GIVE_UP_MS - 1);
    expect(choosing.choosing()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(choosing.choosing()).toBe(false);
  });
});
