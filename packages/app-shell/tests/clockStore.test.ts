/**
 * The app's clocks as a template reads and drives them: every clock published by name, at once on a
 * press, and nothing heard from them once the store's owner is gone.
 *
 * A plain store test, run once under each reactivity port.
 */
import type { ClockRegistry } from '@we/clock';
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppClocks } from '../src/shared/clocks';
import { createTestPlatform, type TestPlatform } from '../src/shared/platform/testPlatform';
import { type ClockStore, createClockStore } from '../src/shared/stores/ClockStore';
import { reactivityPorts } from './support/engines';

const DAY = 86_400_000;
let named = 0;
/** A clock name no other case has used, so a case reads only the clock it made. */
const fresh = (label: string) => `${label}-${++named}`;

describe.each(reactivityPorts)('clockStore, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  let platform: TestPlatform;
  let clockRegistry: ClockRegistry;
  const disposers: (() => void)[] = [];

  function mountStore(): ClockStore {
    let store!: ClockStore;
    disposers.push(port.root(() => (store = createClockStore({ reactivity: port, clocks: clockRegistry }))));
    return store;
  }

  beforeEach(() => {
    port = makePort();
    platform = createTestPlatform();
    clockRegistry = createAppClocks(platform);
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    clockRegistry.dispose();
    vi.restoreAllMocks();
  });

  it('plays on the platform’s frames, so a clock moves only when the host paints', () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const id = fresh('frames');
    const store = mountStore();
    store.configure(id, { from: 0, to: DAY, duration: 10 });
    store.play(id);
    now += 1_000;
    // No frame has been painted: the clock has not moved, however much time went by.
    expect(clockRegistry.get(id).get().at).toBe(0);
    platform.flushFrames();
    // A tenth of its ten-second run, at the frame.
    expect(clockRegistry.get(id).get().at).toBe(DAY / 10);
    store.pause(id);
  });

  it('publishes the clocks that exist, and each one made later, by name', () => {
    const before = fresh('before');
    clockRegistry.get(before).configure({ from: 0, to: DAY });
    const store = mountStore();
    expect(store.clocks()[before]).toMatchObject({ from: 0, to: DAY, playing: false, canPlay: true });

    const later = fresh('later');
    clockRegistry.get(later);
    expect(store.clocks()[later]).toMatchObject({ at: null, canPlay: false });
    // Publishing a second clock kept the first.
    expect(store.clocks()[before]).toBeDefined();
  });

  it('shows a seek at once, from milliseconds or an ISO date, and goes back to everything on null', () => {
    const id = fresh('seek');
    const store = mountStore();
    store.configure(id, { from: 0, to: 10 * DAY });
    const seen: (number | null)[] = [];
    disposers.push(port.root(() => port.effect(() => void seen.push(store.clocks()[id]?.at ?? null))));

    store.seek(id, 2 * DAY);
    expect(seen.at(-1)).toBe(2 * DAY);
    expect(store.clocks()[id].progress).toBeCloseTo(0.2);

    store.seek(id, '1970-01-04T00:00:00.000Z');
    expect(store.clocks()[id].at).toBe(3 * DAY);

    store.seekProgress(id, 0.5);
    expect(store.clocks()[id].at).toBe(5 * DAY);

    store.seek(id, null);
    expect(seen.at(-1)).toBeNull();
    expect(store.clocks()[id].progress).toBe(1);
  });

  it('ignores what is not a moment or a fraction', () => {
    const id = fresh('junk');
    const store = mountStore();
    store.configure(id, { from: 0, to: DAY });
    store.seek(id, DAY / 2);
    store.seek(id, 'not a date');
    store.seekProgress(id, Number.NaN);
    expect(store.clocks()[id].at).toBe(DAY / 2);
  });

  it('plays, pauses and toggles, and takes speed and loop', () => {
    const id = fresh('play');
    const store = mountStore();
    store.configure(id, { from: 0, to: DAY });
    store.play(id);
    expect(store.clocks()[id].playing).toBe(true);
    store.toggle(id);
    expect(store.clocks()[id].playing).toBe(false);
    store.setSpeed(id, 4);
    store.setLoop(id, true);
    expect(store.clocks()[id]).toMatchObject({ speed: 4, loop: true });
    store.pause(id);
  });

  it('hears nothing from the clocks once its owner is disposed', () => {
    const id = fresh('gone');
    clockRegistry.get(id).configure({ from: 0, to: DAY });
    const store = mountStore();
    disposers.splice(0).forEach((dispose) => dispose());

    clockRegistry.get(id).seek(DAY / 4);
    clockRegistry.get(fresh('after'));
    expect(store.clocks()[id].at).toBeNull();
    expect(Object.keys(store.clocks())).not.toContain(`after-${named}`);
  });
});
