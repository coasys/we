/**
 * The month grid, as data.
 *
 * Date maths is exactly the kind of thing that looks obviously right and is wrong at the edges, and
 * the edges here are the ones every calendar gets wrong once: February in a leap year, a month that
 * starts on the week's first day (so no leading cells at all), and January reaching back into the
 * previous December.
 */
import { calendarMonth, calendarMonths, monthLabel, yearLabel } from '@shared/sources/calendarMonth';
import { describe, expect, it } from 'vitest';

const dates = (options: Parameters<typeof calendarMonth>[0]) => calendarMonth(options).map((cell) => cell.date);
const inMonth = (options: Parameters<typeof calendarMonth>[0]) => calendarMonth(options).filter((cell) => cell.inMonth);

describe('calendarMonth', () => {
  it('returns six whole weeks by default, so the grid does not change height', () => {
    expect(calendarMonth({ month: '2026-08-14' })).toHaveLength(42);
    expect(calendarMonth({ month: '2026-02-01' })).toHaveLength(42);
  });

  it('covers exactly the days of the month', () => {
    expect(inMonth({ month: '2026-08-14' })).toHaveLength(31);
    expect(inMonth({ month: '2026-04-10' })).toHaveLength(30);
  });

  it('knows February in a leap year and out of one', () => {
    expect(inMonth({ month: '2024-02-05' })).toHaveLength(29);
    expect(inMonth({ month: '2026-02-05' })).toHaveLength(28);
  });

  it('leads with the tail of the previous month, across a year boundary', () => {
    // 2026-01-01 is a Thursday, so a Sunday-start grid leads with four days of December 2025.
    const cells = calendarMonth({ month: '2026-01-15' });
    expect(cells[0].date).toBe('2025-12-28');
    expect(cells[0].inMonth).toBe(false);
    expect(cells.find((cell) => cell.date === '2026-01-01')?.inMonth).toBe(true);
  });

  it('emits no leading cells when the 1st already falls on the first day of the week', () => {
    // 2026-02-01 is a Sunday.
    const cells = calendarMonth({ month: '2026-02-10' });
    expect(cells[0].date).toBe('2026-02-01');
    expect(cells[0].inMonth).toBe(true);
  });

  it('honours a Monday week start', () => {
    // The same Sunday 1st now needs six leading cells rather than none.
    const cells = calendarMonth({ month: '2026-02-10', weekStartsOn: 1 });
    expect(cells[0].date).toBe('2026-01-26');
    expect(cells.find((cell) => cell.date === '2026-02-01')?.inMonth).toBe(true);
  });

  it('trims to whole weeks when fixed weeks are off', () => {
    const cells = calendarMonth({ month: '2026-02-10', fixedWeeks: false });
    expect(cells).toHaveLength(28);
    expect(cells[cells.length - 1].date).toBe('2026-02-28');
  });

  it('is contiguous — every cell is the day after the one before it', () => {
    const all = dates({ month: '2026-08-01' });
    for (let index = 1; index < all.length; index += 1) {
      const previous = new Date(all[index - 1]);
      previous.setDate(previous.getDate() + 1);
      expect(all[index]).toBe(previous.toISOString().slice(0, 10));
    }
  });

  it('marks exactly one day as today, when today is in view', () => {
    const cells = calendarMonth({});
    expect(cells.filter((cell) => cell.isToday)).toHaveLength(1);
  });

  it('falls back to the current month rather than emitting NaN cells', () => {
    // An unparseable month would otherwise produce `NaN-NaN-NaN` dates, which render as text and
    // look like a styling problem rather than a bad argument.
    const cells = calendarMonth({ month: 'not a date' });
    expect(cells).toHaveLength(42);
    expect(cells.every((cell) => /^\d{4}-\d{2}-\d{2}$/.test(cell.date))).toBe(true);
  });

  it('accepts a full ISO datetime, not only a date', () => {
    expect(dates({ month: '2026-02-10T14:30:00.000Z' })[0]).toBe('2026-02-01');
  });
});

describe('paging by offset', () => {
  it('steps forward and back from a given month', () => {
    expect(calendarMonth({ month: '2026-08-14', offset: 1 }).find((c) => c.inMonth)?.date).toBe('2026-09-01');
    expect(calendarMonth({ month: '2026-08-14', offset: -1 }).find((c) => c.inMonth)?.date).toBe('2026-07-01');
  });

  it('crosses a year boundary in both directions', () => {
    expect(calendarMonth({ month: '2026-01-15', offset: -1 }).find((c) => c.inMonth)?.date).toBe('2025-12-01');
    expect(calendarMonth({ month: '2026-12-15', offset: 1 }).find((c) => c.inMonth)?.date).toBe('2027-01-01');
  });

  it('does not skip a month when stepping from a long one', () => {
    // The classic bug: `setMonth` overflows rather than clamping, so stepping one month from
    // 31 January lands on 3 March. Anchoring to the 1st is what avoids it.
    expect(calendarMonth({ month: '2026-01-31', offset: 1 }).find((c) => c.inMonth)?.date).toBe('2026-02-01');
  });

  it('labels the month it is showing, offset included', () => {
    expect(monthLabel({ month: '2026-01-15', offset: 1 })).toContain('February');
    expect(monthLabel({ month: '2026-01-15', offset: -1 })).toContain('December');
  });
});

/*
  The jump picker.

  `calendarMonths` exists for one reason: `$setLocal` sets a literal or adds a constant, so a
  template cannot work out how far away March 2027 is. Each row carries its own offset from today,
  and the picker reads it back with `from: '$month.offset'` — arithmetic done here, arriving as
  data. So the offsets are the whole contract, and they are what these test.
*/
describe('calendarMonths', () => {
  /** Today, resolved the way the source does, so the expectations move with the clock. */
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();

  it('returns the twelve months of the year the offset lands in', () => {
    const months = calendarMonths({ month: '2026-08-14' });
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.month)).toEqual([...Array(12).keys()]);
    expect(months.every((m) => m.year === 2026)).toBe(true);
  });

  it('carries each month offset from today, so a jump is a single write', () => {
    const months = calendarMonths({});
    // Every row round-trips: stepping by a row's own offset must land on that row's month.
    for (const row of months) {
      expect(calendarMonth({ offset: row.offset }).find((c) => c.inMonth)?.date).toBe(
        `${row.year}-${String(row.month + 1).padStart(2, '0')}-01`,
      );
    }
    expect(months[thisMonth].offset).toBe(0);
  });

  it('keeps the offsets right a year out, where a naive month subtraction breaks', () => {
    const next = calendarMonths({ offset: 12 });
    expect(next[0].year).toBe(thisYear + 1);
    expect(next[thisMonth].offset).toBe(12);
    const back = calendarMonths({ offset: -12 });
    expect(back[thisMonth].offset).toBe(-12);
  });

  it('marks the real current month even while another year is on screen', () => {
    // What keeps "where am I relative to now" legible after paging away.
    const away = calendarMonths({ offset: 12 });
    expect(away.some((m) => m.isThisMonth)).toBe(false);
    const here = calendarMonths({});
    expect(here.filter((m) => m.isThisMonth).map((m) => m.month)).toEqual([thisMonth]);
  });

  it('marks exactly one month as the one being shown', () => {
    const shown = calendarMonths({ month: '2026-08-14' }).filter((m) => m.isShown);
    expect(shown.map((m) => m.month)).toEqual([7]);
  });

  it('labels the year on its own, for a picker that steps years separately', () => {
    expect(yearLabel({ month: '2026-08-14' })).toBe('2026');
    expect(yearLabel({ month: '2026-12-15', offset: 1 })).toBe('2027');
  });
});
