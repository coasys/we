/**
 * TEMPORARY — tracing for "space settings slides in twice" (Oct 30). Revert with its commit.
 *
 * Every line is `[panels] <ms since load> <what> …`, so a paste of the console can be read as one
 * timeline.
 */
export function panelTrace(what: string, ...details: unknown[]): void {
  const at = typeof performance !== 'undefined' ? `${Math.round(performance.now())}ms` : '';
  console.log(
    '[panels]',
    at,
    what,
    ...details.map((detail) => (typeof detail === 'object' ? JSON.stringify(detail) : detail)),
  );
}
