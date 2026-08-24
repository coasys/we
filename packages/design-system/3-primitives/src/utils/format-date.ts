// in milliseconds
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 24 * 60 * 60 * 1000 * 365],
  ['month', (24 * 60 * 60 * 1000 * 365) / 12],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * Return a human-readable relative time string ("3 minutes ago", "in 2 days").
 *
 * Anything under a minute reads as "now" rather than counting seconds, and that is a correctness
 * point rather than a style one. `we-timestamp`, the only consumer, refreshes once a minute — so a
 * rendered "12 seconds ago" was frozen at twelve for the next fifty-eight, saying something false
 * for almost all of the time it was on screen. A formatter cannot claim finer precision than the
 * thing displaying it can refresh at.
 *
 * `numeric: 'auto'` is what turns the zero into "now" (and 1 into "yesterday" rather than "1 day
 * ago") — the whole reason it is set.
 *
 * @param date   The target date
 * @param now    Reference point (default: current time)
 * @param locale BCP 47 locale string (default: 'en')
 */
export function formatRelativeTime(date: Date, now = new Date(), locale = 'en'): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' });
  const elapsed = date.getTime() - now.getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) return rtf.format(Math.round(elapsed / ms), unit);
  }
  return rtf.format(0, 'second');
}

/**
 * Format a date using Intl.DateTimeFormat.
 *
 * @param date    The date to format
 * @param options Intl.DateTimeFormatOptions
 * @param locale  BCP 47 locale string (default: 'en')
 */
export function formatDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
  locale = 'en',
): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}
