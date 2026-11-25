/** A date, unix seconds, as the settings pages show it: in the person's own locale, without a time. */
export function dateOf(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
