/**
 * The timings the suite reports to ad4m's nightly performance history: how long the product takes from
 * a person's action to what they see. The README's "Timings" section lists each one.
 *
 * A step measures while it runs (`probe.mjs` takes the times in the page) and hands each number to
 * {@link createTimings}, which holds them until the step has passed (`commit`) and drops them when it
 * fails (`discard`). A step that fails or is skipped records nothing, so its metrics are left out of the
 * file: a metric is never written as 0. A measurement that cannot be taken never fails a step.
 */
import { max, median, round } from '@we/e2e/metrics';

export const JOB = 'coasys-spaces';

/** The metrics that repeat within a run; each also reports its largest sample, as `<name>_max_ms`. */
const WITH_MAX = ['transcript.line_ms', 'graph.zoom_ms', 'graph.pan_ms', 'graph.drag_ms', 'graph.select_ms'];

/**
 * What the numbers depend on, so a run of one tier is never compared with a run of another. The stub
 * tier has a scripted language model and typed lines. The real tier names its language model, and its
 * transcription model, or says the stub server wrote the transcript (`transcriber.stubbed`).
 */
export function paramsFor(tier, { llm, transcriber } = {}) {
  if (tier !== 'real') return { tier: 'stub' };
  return {
    tier: 'real',
    llm: llm?.model ?? 'unknown',
    transcription: transcriber ? (transcriber.stubbed ? 'stub transcript' : transcriber.model) : 'none',
  };
}

/** A collector of samples, by metric name, in milliseconds. */
export function createTimings() {
  const samples = new Map();
  // The running step's samples: in `samples` only once the step has passed.
  let staged = [];
  return {
    /** Stages one sample of the running step. A value that is not a finite, non-negative number is not a measurement and is dropped. */
    add(metric, value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
      staged.push([metric, value]);
    },
    /** The step passed: its staged samples are kept. */
    commit() {
      for (const [metric, value] of staged) samples.set(metric, [...(samples.get(metric) ?? []), value]);
      staged = [];
    },
    /** The step failed: its staged samples are dropped. */
    discard() {
      staged = [];
    },
    /** What was measured, as metric records: the median of each metric's samples, and the largest where {@link WITH_MAX} says. */
    metrics(params) {
      const out = [];
      const put = (metric, value) => out.push({ metric, value: round(value, 1), unit: 'ms', better: 'lower', params });
      for (const [metric, values] of samples) {
        put(metric, median(values));
        if (WITH_MAX.includes(metric)) put(metric.replace(/_ms$/, '_max_ms'), max(values));
      }
      return out;
    },
    /**
     * Runs a measurement. One that throws is said and left out, so measuring never fails the step it
     * sits in.
     */
    async attempt(what, fn) {
      try {
        await fn();
      } catch (error) {
        console.log(`[coasys-spaces] not timed (${what}): ${error.message}`);
      }
    },
    /** Every kept sample, for the run's `detail`. */
    samples() {
      return Object.fromEntries(samples);
    },
  };
}
