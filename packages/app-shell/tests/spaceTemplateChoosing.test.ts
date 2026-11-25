/**
 * A space opened for the first time after a reboot, before its template has been read: the host
 * shows that it is loading, rather than the space's address drawn in the template before — which
 * flashed the landing page's spaces, as cards, before the space's own template arrived.
 *
 * A plain store test, run once under each reactivity port.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHOOSING_GIVE_UP_MS, createSpaceTemplateChoosing } from '../src/shared/stores/spaceTemplateChoosing';

const ports: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

describe.each(ports)('a space waiting for its template, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  const disposers: (() => void)[] = [];

  function harness() {
    const [currentId, setCurrentId] = port.signal<string | null>('space-a');
    let choosing!: ReturnType<typeof createSpaceTemplateChoosing>;
    disposers.push(port.root(() => (choosing = createSpaceTemplateChoosing({ reactivity: port, currentId }))));
    return { choosing, setCurrentId };
  }

  beforeEach(() => {
    port = makePort();
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.useRealTimers();
  });

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

  it('wakes nothing that reads it when a template is put up with nothing waiting', () => {
    // `done()` runs on every template put up, nearly always with nothing waiting.
    const { choosing } = harness();
    const seen: boolean[] = [];
    disposers.push(port.root(() => port.effect(() => void seen.push(choosing.choosing()))));
    const before = seen.length;
    choosing.done();
    choosing.done('space-a');
    expect(seen.length).toBe(before);
    choosing.start('space-a');
    expect(seen.at(-1)).toBe(true);
  });
});
