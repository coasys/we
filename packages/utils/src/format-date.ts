// in milliseconds
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 24 * 60 * 60 * 1000 * 365],
  ['month', (24 * 60 * 60 * 1000 * 365) / 12],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

/**
 * Return a human-readable relative time string ("3 minutes ago", "in 2 days").
 *
 * @param date   The target date
 * @param now    Reference point (default: current time)
 * @param locale BCP 47 locale string (default: 'en')
 */
export function formatRelativeTime(date: Date, now = new Date(), locale = 'en'): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' });
  const elapsed = date.getTime() - now.getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms || unit === 'second') {
      return rtf.format(Math.round(elapsed / ms), unit);
    }
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
