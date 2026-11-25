/**
 * The parts of the suite's timings that need no browser: what is a measurement, how samples become
 * metric records, which params say the tier, and that an unmeasured metric is left out.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeMetrics } from '@we/e2e/metrics';
import { describe, expect, it, vi } from 'vitest';

import { JOB, createTimings, paramsFor } from './timings.mjs';
import { ms } from './probe.mjs';

const STUB = { tier: 'stub' };

describe('the params of a run', () => {
  it('say the stub tier and nothing else', () => {
    expect(paramsFor('stub')).toEqual(STUB);
    // The stub tier never names a model, whatever the environment holds.
    expect(paramsFor('stub', { llm: { model: 'qwen' }, transcriber: { model: 'whisper' } })).toEqual(STUB);
  });

  it('name the real tier’s language model and its transcription model', () => {
    const llm = { model: 'qwen3' };
    expect(paramsFor('real', { llm, transcriber: { model: 'whisper-small', stubbed: false } })).toEqual({
      tier: 'real',
      llm: 'qwen3',
      transcription: 'whisper-small',
    });
  });

  it('say when the stub server wrote the real tier’s transcript', () => {
    const params = paramsFor('real', { llm: { model: 'qwen3' }, transcriber: { model: 'stub-stt', stubbed: true } });
    expect(params.transcription).toBe('stub transcript');
  });

  it('are different between tiers, so their metrics are never compared', () => {
    expect(paramsFor('stub')).not.toEqual(paramsFor('real', { llm: { model: 'm' }, transcriber: null }));
  });
});

describe('the timings of a run', () => {
  it('report the median of a metric, in ms, lower being better, with the run’s params', () => {
    const timings = createTimings();
    for (const v of [30, 10, 20]) timings.add('call.join_ms', v);
    expect(timings.metrics(STUB)).toEqual([
      { metric: 'call.join_ms', value: 20, unit: 'ms', better: 'lower', params: STUB },
    ]);
  });

  it('report the largest sample beside the median of a repeated gesture', () => {
    const timings = createTimings();
    for (const v of [4, 9, 5, 6, 5]) timings.add('graph.pan_ms', v);
    for (const v of [100, 300]) timings.add('call.leave_ms', v);
    const by = Object.fromEntries(timings.metrics(STUB).map((m) => [m.metric, m.value]));
    expect(by).toEqual({ 'graph.pan_ms': 5, 'graph.pan_max_ms': 9, 'call.leave_ms': 200 });
  });

  it('leave out a metric nothing measured, rather than write 0', () => {
    const timings = createTimings();
    timings.add('call.join_ms', 800);
    for (const bad of [null, undefined, NaN, Infinity, -5, '12']) timings.add('graph.zoom_ms', bad);
    expect(timings.metrics(STUB).map((m) => m.metric)).toEqual(['call.join_ms']);
    expect(createTimings().metrics(STUB)).toEqual([]);
  });

  it('keep a zero reading as a measurement', () => {
    const timings = createTimings();
    timings.add('graph.select_ms', 0);
    expect(timings.metrics(STUB).map((m) => m.value)).toEqual([0, 0]);
  });

  it('round to a tenth of a millisecond', () => {
    const timings = createTimings();
    timings.add('call.join_ms', 812.3456);
    expect(timings.metrics(STUB)[0].value).toBe(812.3);
  });

  it('keep every sample for the run’s detail', () => {
    const timings = createTimings();
    timings.add('transcript.line_ms', 10);
    timings.add('transcript.line_ms', 20);
    expect(timings.samples()).toEqual({ 'transcript.line_ms': [10, 20] });
  });

  it('say a measurement that throws, and go on', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await createTimings().attempt('call.join_ms', () => {
        throw new Error('page closed');
      });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('call.join_ms'));
    } finally {
      log.mockRestore();
    }
  });
});

describe('a time between two marks', () => {
  it('is the end less the start', () => {
    expect(ms(1_000, 1_250)).toBe(250);
  });

  it('is missing when a mark was not taken, or the end came first', () => {
    expect(ms(null, 1_250)).toBe(null);
    expect(ms(1_000, null)).toBe(null);
    expect(ms(undefined, undefined)).toBe(null);
    // A mark taken before the start: the page already showed it when the clock started.
    expect(ms(1_250, 1_000)).toBe(null);
  });
});

describe('the files a run writes', () => {
  it('are metrics.json with the job and detail, and the metrics alone for the nightly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coasys-timings-'));
    const perf = join(mkdtempSync(join(tmpdir(), 'coasys-perf-')), 'out');
    const timings = createTimings();
    timings.add('call.join_ms', 700);
    const metrics = timings.metrics(STUB);
    const detail = { params: STUB, samples: timings.samples() };
    writeMetrics({ dir, job: JOB, metrics, doc: { job: JOB, detail }, env: { PERF_RESULTS_DIR: perf } });
    expect(JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf8'))).toEqual({
      job: 'coasys-spaces',
      detail,
      metrics,
    });
    expect(JSON.parse(readFileSync(join(perf, 'coasys-spaces.json'), 'utf8'))).toEqual({ metrics });
  });
});
