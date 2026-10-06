import { Clock } from '@we/clock';
import { describe, expect, it } from 'vitest';

import { ClockLink } from './clockLink';
import { pointFeatures } from './features';
import { TimeIndex } from './time';

const DAY = 86_400_000;
const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();

const rows = [
  { id: 'a', when: day(1), latitude: 1, longitude: 1 },
  { id: 'b', when: day(5), latitude: 2, longitude: 2 },
  { id: 'c', when: day(10), latitude: 3, longitude: 3 },
  { id: 'd', when: 'whenever', latitude: 4, longitude: 4 },
];
const at = (n: number) => Date.UTC(2026, 9, n);

describe('TimeIndex', () => {
  it('shows every row with no moment set, and with no time field', () => {
    expect(new TimeIndex(rows, { time: 'when' }).slice(null)).toBeNull();
    expect(new TimeIndex(rows, {}).slice(at(3))).toBeNull();
  });

  it('shows rows up to the moment, and those with no readable moment throughout', () => {
    const slice = new TimeIndex(rows, { time: 'when' }).slice(at(6))!;
    expect(slice.rows.map((row) => row.id).sort()).toEqual(['a', 'b', 'd']);
    expect(slice.age(rows[1])).toBe(1);
    expect(slice.age(rows[3])).toBeUndefined();
  });

  it('keeps only the recent ones with a window, fading those about to leave', () => {
    const index = new TimeIndex(rows, { time: 'when', window: '4d' });
    const slice = index.slice(at(8) + DAY / 2)!;
    expect(slice.rows.map((row) => row.id).sort()).toEqual(['b', 'd']);
    // b is three and a half days old in a four-day window: inside the last quarter, so fading.
    expect(slice.fade(rows[1])).toBeGreaterThan(0);
    expect(slice.fade(rows[1])).toBeLessThan(1);
    expect(index.slice(at(6))!.fade(rows[1])).toBe(1);
    expect(new TimeIndex(rows, { time: 'when', window: '4d', fade: false }).slice(at(8) + DAY / 2)!.fade(rows[1])).toBe(
      1,
    );
  });

  it('changes its signature only when what shows changes', () => {
    const index = new TimeIndex(rows, { time: 'when' });
    expect(index.signature(at(2))).toBe(index.signature(at(4)));
    expect(index.signature(at(2))).not.toBe(index.signature(at(6)));
    expect(index.signature(null)).toBe('all');
  });

  it('covers the span of its rows', () => {
    expect(new TimeIndex(rows, { time: 'when' }).extent()).toEqual([at(1), at(10)]);
  });

  it('puts the age where a style rule reads it, and fades the opacity', () => {
    const slice = new TimeIndex(rows, { time: 'when', window: '4d' }).slice(at(8) + DAY / 2);
    const features = pointFeatures(
      { data: rows, style: [{ when: { 'data.age': { gt: 2 } }, style: { size: 30 } }] },
      slice,
    );
    const b = features.find((feature) => feature.id === 'b')!;
    expect(b.size).toBe(30);
    expect(b.opacity).toBeLessThan(1);
    expect(features.map((feature) => feature.id)).not.toContain('a');
  });
});

describe('ClockLink', () => {
  it('reads null with no clock, and the clock once attached', () => {
    const link = new ClockLink();
    const layer = link.forLayer('pins');
    expect(layer.at()).toBeNull();
    const clock = new Clock();
    clock.seek(5);
    link.attach(clock);
    expect(layer.at()).toBe(5);
  });

  it('carries each layer’s span over to a new clock, and withdraws it from the old', () => {
    const link = new ClockLink();
    const first = new Clock();
    link.attach(first);
    link.forLayer('pins').extent([0, 10 * DAY]);
    expect(first.get().to).toBe(10 * DAY);
    const second = new Clock();
    link.attach(second);
    expect(first.get().to).toBeNull();
    expect(second.get().to).toBe(10 * DAY);
    link.forLayer('pins').extent(null);
    expect(second.get().to).toBeNull();
  });

  it('tells layers when the moment may have moved', () => {
    const link = new ClockLink();
    let heard = 0;
    link.forLayer('pins').subscribe(() => heard++);
    const clock = new Clock({ from: 0, to: 10 });
    link.attach(clock);
    clock.seek(3);
    expect(heard).toBe(2);
  });
});
