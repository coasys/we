/**
 * Moments and spans as data writes them: a record's `createdAt`, an event's `startDate`, "7d".
 *
 * A moment is a number of milliseconds since 1970, which is what everything here compares. Data
 * arrives as an ISO string far more often than as a number, and a template cannot parse one — the
 * expression language has no dates on purpose — so reading them is done once, here.
 */

/**
 * A moment from what a row holds: milliseconds as a number, an ISO date or date-time, or a `Date`.
 * `undefined` for anything else, including a string that does not parse.
 *
 * A bare day (`2026-10-06`) is midnight UTC, which is how `Date.parse` reads one and what makes a
 * day the same moment for everybody looking at it.
 */
export function toTime(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const time = Date.parse(value.trim());
  return Number.isFinite(time) ? time : undefined;
}

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  // A month and a year are spans to read data over, not calendar arithmetic: thirty days, 365.
  mo: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

/**
 * A span from how a template writes one: `"7d"`, `"12h"`, `"30m"`, `"90s"`, `"2w"`, `"3mo"`, `"1y"`,
 * or a number of milliseconds. `undefined` for anything else, and for a span that is not positive.
 */
export function parseDuration(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|mo|s|m|h|d|w|y)\s*$/i.exec(value);
  if (!match) return undefined;
  const span = Number(match[1]) * UNITS[match[2].toLowerCase()];
  return span > 0 ? span : undefined;
}

/** A moment as an ISO string, for a timestamp to show. Empty for no moment. */
export function toIso(time: number | null | undefined): string {
  return typeof time === 'number' && Number.isFinite(time) ? new Date(time).toISOString() : '';
}

/** The UTC day a moment falls in, as `YYYY-MM-DD`. */
export function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export const DAY = UNITS.d;
