/** One number for the nightly performance history (ad4m's `scripts/perf/record` format). */
export interface Metric {
  metric: string;
  value: number;
  unit: string;
  better: 'lower' | 'higher';
  params: Record<string, unknown>;
}

/** The middle value; the mean of the two middle ones for an even count. `null` for none. */
export function median(values: number[]): number | null;

/** The largest value, or `null` for none. */
export function max(values: number[]): number | null;

/** `n` to `places` decimals; `null` stays `null`. */
export function round(n: number | null, places?: number): number | null;

/**
 * Writes `metrics.json` (`{...doc, metrics}`) in `dir`, and the metrics alone as `<job>.json` in
 * `PERF_RESULTS_DIR` when it is set. Returns the paths written.
 */
export function writeMetrics(options: {
  dir: string;
  job: string;
  metrics: Metric[];
  doc?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): string[];
