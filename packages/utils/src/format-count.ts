/**
 * Format a number with K/M/B abbreviations for large values.
 *
 * @param value     The number to format
 * @param precision Decimal places to show for abbreviated values (default: 1)
 * @param locale    BCP 47 locale string (default: 'en')
 *
 * @example
 * formatCount(0)        // "0"
 * formatCount(999)      // "999"
 * formatCount(1000)     // "1K"
 * formatCount(1234)     // "1.2K"
 * formatCount(1234567)  // "1.2M"
 * formatCount(-4200)    // "-4.2K"
 */
export function formatCount(value: number, precision = 1, locale = 'en'): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  const fmt = (n: number, suffix: string) => {
    const fixed = parseFloat(n.toFixed(precision));
    const str = fixed.toLocaleString(locale, { maximumFractionDigits: precision });
    return `${sign}${str}${suffix}`;
  };

  if (abs >= 1_000_000_000) return fmt(abs / 1_000_000_000, 'B');
  if (abs >= 1_000_000) return fmt(abs / 1_000_000, 'M');
  if (abs >= 1_000) return fmt(abs / 1_000, 'K');
  return `${sign}${abs.toLocaleString(locale)}`;
}
