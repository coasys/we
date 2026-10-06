import { describe, expect, it, vi } from 'vitest';

import { Clock, type ClockScheduler, type ClockState, throttle } from './clock';
import { ClockRegistry } from './registry';
import { clockTicks, momentLabel } from './ticks';
import { parseDuration, toTime } from './time';

/** A scheduler a test steps by hand: `advance(ms)` moves real time on and runs one frame. */
function manual() {
  let now = 0;
  let pending: (() => void) | null = null;
  const scheduler: ClockScheduler = {
    now: () => now,
    frame(callback) {
      pending = callback;
      return () => {
        if (pending === callback) pending = null;
      };
    },
  };
  return {
    scheduler,
    advance(ms: number) {
      now += ms;
      const run = pending;
      pending = null;
      run?.();
    },
    get waiting() {
      return pending !== null;
    },
  };
}

const DAY = 86_400_000;

describe('Clock', () => {
  it('starts unset, which shows everything, and stays so until touched', () => {
    const clock = new Clock();
    clock.contribute('a', [0, 10 * DAY]);
    expect(clock.get().at).toBeNull();
    expect(clock.progress()).toBe(1);
  });

  it('takes its range from what followers contribute, until one is set', () => {
    const clock = new Clock();
    clock.contribute('a', [5, 10]);
    clock.contribute('b', [0, 7]);
    expect([clock.get().from, clock.get().to]).toEqual([0, 10]);
    clock.contribute('a', null);
    expect([clock.get().from, clock.get().to]).toEqual([0, 7]);
    clock.configure({ to: 100 });
    expect([clock.get().from, clock.get().to]).toEqual([0, 100]);
  });

  it('plays the range in its duration, from the start, and stops at the end', () => {
    const time = manual();
    const clock = new Clock({ duration: 10 }, time.scheduler);
    clock.contribute('a', [0, 1000]);
    clock.play();
    expect(clock.get().at).toBe(0);
    time.advance(5000);
    expect(clock.get().at).toBe(500);
    time.advance(6000);
    expect(clock.get()).toMatchObject({ at: 1000, playing: false });
    expect(time.waiting).toBe(false);
  });

  it('plays again from the start after running to the end', () => {
    const time = manual();
    const clock = new Clock({ duration: 1 }, time.scheduler);
    clock.contribute('a', [0, 100]);
    clock.seek(100);
    clock.play();
    expect(clock.get().at).toBe(0);
  });

  it('loops when asked to', () => {
    const time = manual();
    const clock = new Clock({ duration: 10, loop: true }, time.scheduler);
    clock.contribute('a', [0, 1000]);
    clock.play();
    time.advance(12_000);
    expect(clock.get()).toMatchObject({ at: 200, playing: true });
  });

  it('runs at a fixed pace with a rate, whatever its range', () => {
    const time = manual();
    const clock = new Clock({ rate: 1, from: 0, to: 600_000 }, time.scheduler);
    clock.play();
    time.advance(1500);
    expect(clock.get().at).toBe(1500);
  });

  it('does not play with nothing to cross', () => {
    const clock = new Clock();
    clock.play();
    expect(clock.get().playing).toBe(false);
  });

  it('keeps a seek inside the range', () => {
    const clock = new Clock({ from: 10, to: 20 });
    clock.seek(50);
    expect(clock.get().at).toBe(20);
    clock.seekFraction(0.5);
    expect(clock.get().at).toBe(15);
  });

  it('tells listeners why: ticks while playing, changes otherwise', () => {
    const time = manual();
    const clock = new Clock({ duration: 1 }, time.scheduler);
    clock.contribute('a', [0, 1000]);
    const causes: string[] = [];
    clock.subscribe((_, cause) => causes.push(cause));
    clock.play();
    time.advance(100);
    time.advance(100);
    clock.pause();
    expect(causes).toEqual(['change', 'tick', 'tick', 'change']);
  });

  it('takes its moment from a driver every frame', () => {
    const time = manual();
    const clock = new Clock({ from: 0, to: 100 }, time.scheduler);
    let position = 30;
    clock.drive(() => position);
    time.advance(16);
    expect(clock.get().at).toBe(30);
    position = 500;
    time.advance(16);
    expect(clock.get().at).toBe(100);
    clock.drive(null);
    expect(time.waiting).toBe(false);
  });

  it('keeps one snapshot until something changes', () => {
    const clock = new Clock();
    const first = clock.get();
    expect(clock.get()).toBe(first);
    clock.configure({ speed: 2 });
    expect(clock.get()).not.toBe(first);
  });
});

describe('throttle', () => {
  it('passes changes at once and ticks at most once an interval', () => {
    vi.useFakeTimers();
    const time = manual();
    const clock = new Clock({ duration: 10 }, time.scheduler);
    clock.contribute('a', [0, 10_000]);
    const heard: ClockState[] = [];
    throttle(clock, 100, (state) => heard.push(state), time.scheduler);
    clock.play();
    for (let i = 0; i < 10; i++) time.advance(16);
    // The play, then one tick roughly every hundred milliseconds of the 160 that passed.
    expect(heard.length).toBeLessThanOrEqual(3);
    clock.pause();
    expect(heard[heard.length - 1]?.playing).toBe(false);
    vi.useRealTimers();
  });

  it('delivers a held tick once the interval is up', () => {
    vi.useFakeTimers();
    const time = manual();
    const clock = new Clock({ from: 0, to: 100 }, time.scheduler);
    let position = 10;
    clock.drive(() => position);
    const heard: (number | null)[] = [];
    throttle(clock, 100, (state) => heard.push(state.at), time.scheduler);
    time.advance(16);
    position = 20;
    time.advance(16);
    clock.drive(null);
    vi.advanceTimersByTime(200);
    expect(heard[heard.length - 1]).toBe(20);
    vi.useRealTimers();
  });
});

describe('ClockRegistry', () => {
  it('gives the same clock for the same name', () => {
    const registry = new ClockRegistry();
    const created: string[] = [];
    registry.onCreate((id) => created.push(id));
    expect(registry.get('events')).toBe(registry.get('events'));
    expect(registry.peek('other')).toBeUndefined();
    expect(created).toEqual(['events']);
  });
});

describe('time', () => {
  it('reads moments from numbers, ISO text and dates', () => {
    expect(toTime(5)).toBe(5);
    expect(toTime('2026-10-06')).toBe(Date.UTC(2026, 9, 6));
    expect(toTime(new Date(7))).toBe(7);
    expect(toTime('soon')).toBeUndefined();
    expect(toTime(null)).toBeUndefined();
  });

  it('reads spans as a template writes them', () => {
    expect(parseDuration('7d')).toBe(7 * DAY);
    expect(parseDuration('12h')).toBe(12 * 3_600_000);
    expect(parseDuration('1.5s')).toBe(1500);
    expect(parseDuration('3mo')).toBe(90 * DAY);
    expect(parseDuration(250)).toBe(250);
    expect(parseDuration('-1d')).toBeUndefined();
    expect(parseDuration('a week')).toBeUndefined();
  });
});

describe('ticks', () => {
  const at = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime();

  it('marks a day in hours', () => {
    const ticks = clockTicks(at(2026, 9, 6, 1), at(2026, 9, 6, 23), 6, 'en-GB');
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[0].label).toMatch(/^\d\d:00$/);
  });

  it('marks a month in days or weeks, a year in months, decades in years', () => {
    expect(clockTicks(at(2026, 9, 1), at(2026, 9, 31), 6, 'en-GB')[0].label).toMatch(/Oct/);
    const year = clockTicks(at(2026, 0, 15), at(2026, 11, 15), 6, 'en-GB');
    expect(year.every((tick) => !/^\d+$/.test(tick.label))).toBe(true);
    expect(clockTicks(at(2001, 0, 1), at(2026, 0, 1), 6, 'en-GB').map((tick) => tick.label)).toContain('2010');
  });

  it('places each mark by how far along the range it is', () => {
    const ticks = clockTicks(at(2026, 0, 1), at(2027, 0, 1), 6);
    for (const tick of ticks) expect(tick.fraction).toBeGreaterThanOrEqual(0);
    for (const tick of ticks) expect(tick.fraction).toBeLessThanOrEqual(1);
    expect(clockTicks(5, 5)).toEqual([]);
  });

  it('writes the moment as precisely as the range calls for', () => {
    const day = momentLabel(at(2026, 9, 6, 14), at(2026, 9, 6), at(2026, 9, 7), 'en-GB');
    expect(day).toMatch(/14:00/);
    expect(momentLabel(at(2026, 9, 6), at(2000, 0, 1), at(2026, 0, 1), 'en-GB')).toBe('Oct 2026');
    expect(momentLabel(null, 0, 1)).toBe('');
  });
});
