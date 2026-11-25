/**
 * The numbers a suite hands to ad4m's nightly performance history, and how it writes them.
 *
 * A metric is `{metric, value, unit, better, params}` — the record format of ad4m's
 * `scripts/perf/record`. `params` holds what the number depends on, so a run under other conditions
 * is never compared with it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The middle value; the mean of the two middle ones for an even count. `null` for none. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The largest value, or `null` for none. */
export const max = (values) => (values.length ? Math.max(...values) : null);

/** `n` to `places` decimals; `null` stays `null`. */
export const round = (n, places = 1) => (n === null ? null : Math.round(n * 10 ** places) / 10 ** places);

/**
 * Writes a suite's metrics where the nightly reads them: `metrics.json` in `dir` (`{...doc, metrics}`:
 * `doc` adds what a reader wants beside the metrics, such as `job` and `detail`), and, when
 * `PERF_RESULTS_DIR` is set, the metrics alone as `<job>.json` there. Returns the paths written.
 */
export function writeMetrics({ dir, job, metrics, doc = {}, env = process.env }) {
  const written = [];
  mkdirSync(dir, { recursive: true });
  const own = join(dir, 'metrics.json');
  writeFileSync(own, `${JSON.stringify({ ...doc, metrics }, null, 2)}\n`);
  written.push(own);
  if (env.PERF_RESULTS_DIR) {
    mkdirSync(env.PERF_RESULTS_DIR, { recursive: true });
    const shared = join(env.PERF_RESULTS_DIR, `${job}.json`);
    writeFileSync(shared, `${JSON.stringify({ metrics }, null, 2)}\n`);
    written.push(shared);
  }
  return written;
}
