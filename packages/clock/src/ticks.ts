/**
 * Marks along a clock's range, labelled at the scale the range calls for: hours across a day, days
 * across a month, months across a year, years across a decade.
 *
 * A scrubber with no marks says only "somewhere between the start and the end". With them, a reader
 * can find a day without dragging past it. A template could not work these out: it has no dates, and
 * which step suits a range is a judgement over its length.
 *
 * Marks fall on round moments in the reader's own time zone — midnight, the first of the month, New
 * Year — so a label reads as a date rather than as a fraction of the range.
 */

export interface ClockTick {
  /** The moment, in milliseconds since 1970. */
  at: number;
  /** How far along the range it is, 0 to 1. */
  fraction: number;
  label: string;
}

type Unit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The steps marks may be spaced at, smallest first, with roughly how long each is. */
const STEPS: [Unit, number, number][] = [
  ['minute', 1, MINUTE],
  ['minute', 5, 5 * MINUTE],
  ['minute', 15, 15 * MINUTE],
  ['minute', 30, 30 * MINUTE],
  ['hour', 1, HOUR],
  ['hour', 3, 3 * HOUR],
  ['hour', 6, 6 * HOUR],
  ['hour', 12, 12 * HOUR],
  ['day', 1, DAY],
  ['day', 2, 2 * DAY],
  ['week', 1, 7 * DAY],
  ['month', 1, 30 * DAY],
  ['month', 3, 91 * DAY],
  ['month', 6, 182 * DAY],
  ['year', 1, 365 * DAY],
  ['year', 2, 730 * DAY],
  ['year', 5, 1826 * DAY],
  ['year', 10, 3652 * DAY],
  ['year', 25, 9131 * DAY],
  ['year', 50, 18262 * DAY],
  ['year', 100, 36524 * DAY],
];

/** The first round moment of this step at or before `time`. */
function floorTo(time: number, unit: Unit, every: number): Date {
  const date = new Date(time);
  date.setSeconds(0, 0);
  if (unit === 'minute') date.setMinutes(Math.floor(date.getMinutes() / every) * every);
  else date.setMinutes(0);
  if (unit === 'hour') date.setHours(Math.floor(date.getHours() / every) * every);
  else if (unit !== 'minute') date.setHours(0);
  if (unit === 'week') date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  if (unit === 'month' || unit === 'year') date.setDate(1);
  if (unit === 'month') date.setMonth(Math.floor(date.getMonth() / every) * every);
  if (unit === 'year') {
    date.setMonth(0);
    date.setFullYear(Math.floor(date.getFullYear() / every) * every);
  }
  return date;
}

function advance(date: Date, unit: Unit, every: number): void {
  if (unit === 'minute') date.setMinutes(date.getMinutes() + every);
  else if (unit === 'hour') date.setHours(date.getHours() + every);
  else if (unit === 'day') date.setDate(date.getDate() + every);
  else if (unit === 'week') date.setDate(date.getDate() + 7 * every);
  else if (unit === 'month') date.setMonth(date.getMonth() + every);
  else date.setFullYear(date.getFullYear() + every);
}

function labelOf(date: Date, unit: Unit, first: boolean, locale?: string): string {
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date);
  if (unit === 'minute' || unit === 'hour') {
    // Midnight names the day, so a range across two days says which is which.
    return date.getHours() === 0 && date.getMinutes() === 0
      ? format({ day: 'numeric', month: 'short' })
      : format({ hour: '2-digit', minute: '2-digit' });
  }
  if (unit === 'day' || unit === 'week') return format({ day: 'numeric', month: 'short' });
  if (unit === 'month') {
    return first || date.getMonth() === 0 ? format({ month: 'short', year: 'numeric' }) : format({ month: 'short' });
  }
  return format({ year: 'numeric' });
}

/**
 * Marks across `from`–`to`, no more than `most` of them, on the smallest round step that keeps to
 * that. Empty for a range with no length.
 */
export function clockTicks(from: number, to: number, most = 6, locale?: string): ClockTick[] {
  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return [];
  const [unit, every] = STEPS.find(([, , length]) => span / length <= most) ?? STEPS[STEPS.length - 1];
  const ticks: ClockTick[] = [];
  const date = floorTo(from, unit, every);
  for (let guard = 0; guard < 1000 && date.getTime() <= to; guard++) {
    const at = date.getTime();
    if (at >= from) {
      ticks.push({ at, fraction: (at - from) / span, label: labelOf(date, unit, ticks.length === 0, locale) });
    }
    advance(date, unit, every);
  }
  return ticks;
}

/**
 * A moment written as precisely as the range calls for: with the time of day across a couple of
 * days, the day across a couple of years, and the month beyond that. Empty for no moment.
 */
export function momentLabel(at: number | null, from: number | null, to: number | null, locale?: string): string {
  if (at === null || !Number.isFinite(at)) return '';
  const span = from !== null && to !== null ? to - from : 0;
  const options: Intl.DateTimeFormatOptions =
    span > 0 && span <= 2 * DAY
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : span > 2 * 365 * DAY
        ? { month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(new Date(at));
}
