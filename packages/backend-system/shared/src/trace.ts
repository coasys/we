/**
 * Tracing for the ephemeral path — off by default, and free when off.
 *
 * Presence problems are almost never logic problems, which is what makes them expensive: every hop
 * between "publish this" and "the other agent sees it" is fire-and-forget, so a message that is
 * suppressed, queued, dropped by the executor, or never delivered by the network all look identical
 * from either end — nothing throws and nothing logs. The only way to tell them apart is to watch the
 * hops, on both agents, with timestamps.
 *
 * A sink rather than `console.log` because the packages that need to emit are backend-agnostic and
 * DOM-free: `presence.ts` is consumed by a Node CLI, and the AD4M adapter has no business deciding
 * what a log line looks like. The host installs a sink and picks the switch — see
 * `installConsoleTrace` in the app shell.
 */

/** Where trace events go. Scopes are coarse (`presence`, `ephemeral`, `tabs`); events are verbs. */
export type TraceSink = (scope: string, event: string, detail?: Record<string, unknown>) => void;

let sink: TraceSink | null = null;

/** Install a sink, or `null` to turn tracing off again. */
export function setTraceSink(next: TraceSink | null): void {
  sink = next;
}

/** True while something is listening — for skipping work that only exists to be traced. */
export function tracing(): boolean {
  return sink !== null;
}

/**
 * Emit a trace event. A no-op — one null check — unless a sink is installed.
 *
 * `detail` is built by the caller, so keep it cheap: this is called on every heartbeat of every
 * peer. Anything expensive belongs behind {@link tracing}.
 */
export function trace(scope: string, event: string, detail?: Record<string, unknown>): void {
  sink?.(scope, event, detail);
}
