/**
 * TEMPORARY — tracing for "spaces flash as cards on the first space opened after a reboot" (Oct 30).
 * Revert with its commit. Every line is `[space-open] <ms since load> <what> …`.
 */
export function spaceOpenTrace(what: string, ...details: unknown[]): void {
  const at = typeof performance !== 'undefined' ? `${Math.round(performance.now())}ms` : '';
  console.log(
    '[space-open]',
    at,
    what,
    ...details.map((detail) => (typeof detail === 'object' ? JSON.stringify(detail) : detail)),
  );
}
