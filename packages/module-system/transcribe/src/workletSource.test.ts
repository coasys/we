/**
 * The VAD, exercised as the audio thread would run it.
 *
 * Worth testing despite being a straight port, because it is the one piece of this module that is
 * neither type-checked nor reachable from the app under test: it ships as a string, is compiled by
 * the browser at runtime, and runs in a scope where a thrown error surfaces as silence rather than as
 * a stack trace. A typo in it would look exactly like nobody speaking.
 *
 * The two behaviours that matter are opposite sides of the same threshold — that speech produces an
 * utterance, and that silence produces nothing. The second is what makes muting a call stop the
 * transcript, so it is a requirement rather than an implementation detail.
 */
import { describe, expect, it } from 'vitest';

import { WORKLET_NAME, WORKLET_SOURCE } from './workletSource';

const SAMPLE_RATE = 48_000;
const FRAME = 128;

type WorkletMessage = { kind: 'utterance'; audio: Float32Array } | { kind: 'level'; rms: number; speaking: boolean };

interface Processor {
  process(inputs: Float32Array[][]): boolean;
  port: { postMessage(data: WorkletMessage): void };
}

/**
 * Compile the source in a scope carrying the three globals the worklet scope provides.
 *
 * `new Function` rather than an import: the point is to run the string exactly as the browser will,
 * so anything that would only work after bundling fails here too.
 */
function instantiate(): {
  processor: Processor;
  /** Utterances only — the level stream is checked separately. */
  emitted: Float32Array[];
  messages: WorkletMessage[];
  name: string;
} {
  let name = '';
  let Processor: new () => Processor = null as never;

  class AudioWorkletProcessor {
    port = { postMessage() {}, onmessage: null as unknown };
  }
  const registerProcessor = (id: string, cls: new () => Processor) => {
    name = id;
    Processor = cls;
  };

  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', WORKLET_SOURCE)(
    AudioWorkletProcessor,
    SAMPLE_RATE,
    registerProcessor,
  );

  const processor = new Processor();
  const messages: WorkletMessage[] = [];
  const emitted: Float32Array[] = [];
  processor.port.postMessage = (data) => {
    messages.push(data);
    if (data.kind === 'utterance') emitted.push(data.audio);
  };
  return { processor, emitted, messages, name };
}

/** One 128-sample frame at the input rate. `at` is the running sample index, for a continuous tone. */
function frame(fill: (at: number) => number, offset: number): Float32Array[][] {
  const samples = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) samples[i] = fill(offset + i);
  return [[samples]];
}

function feed(processor: Processor, frames: number, fill: (at: number) => number, from = 0): number {
  let at = from;
  for (let i = 0; i < frames; i++) {
    processor.process(frame(fill, at));
    at += FRAME;
  }
  return at;
}

const silence = () => 0;
const speech = (at: number) => 0.5 * Math.sin((2 * Math.PI * 440 * at) / SAMPLE_RATE);

describe('transcription VAD worklet', () => {
  it('registers under the name the store instantiates', () => {
    expect(instantiate().name).toBe(WORKLET_NAME);
  });

  it('emits one 16 kHz utterance per span of speech', () => {
    const { processor, emitted } = instantiate();

    let at = feed(processor, 20, silence);
    at = feed(processor, 600, speech, at); // ~1.6s
    feed(processor, 250, silence, at); // past the 500ms close timeout

    expect(emitted).toHaveLength(1);
    // 1.6s of speech plus the 500ms pre-roll, at the downsampled rate. Loose bounds: the pre-roll is
    // what is being checked here, not the exact frame the onset landed on.
    const seconds = emitted[0].length / 16_000;
    expect(seconds).toBeGreaterThan(1.9);
    expect(seconds).toBeLessThan(2.4);
  });

  it('emits nothing at all for silence — a muted call must produce no transcript', () => {
    const { processor, emitted } = instantiate();
    feed(processor, 2_000, silence);
    expect(emitted).toHaveLength(0);
  });

  it('splits speech that never pauses, rather than growing without bound', () => {
    const { processor, emitted } = instantiate();
    // 45s of unbroken tone, against a 30s cap.
    feed(processor, Math.ceil((45 * SAMPLE_RATE) / FRAME), speech);
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    // The cap is checked once per frame, after the whole frame has been appended, so an utterance can
    // overshoot by up to one downsampled frame. Splitting mid-frame would buy nothing.
    const ceiling = 480_000 + Math.ceil(FRAME / (SAMPLE_RATE / 16_000));
    for (const utterance of emitted) expect(utterance.length).toBeLessThanOrEqual(ceiling);
  });

  it('reports the level it is deciding on, throttled, whether or not anyone is speaking', () => {
    const { processor, messages } = instantiate();

    // Silence: no utterance, but the meter must still move — a bar that only came alive once speech
    // was already detected could not help anyone work out why it was not being detected.
    feed(processor, 100, silence);
    const levels = messages.filter((m) => m.kind === 'level');

    expect(levels.length).toBeGreaterThan(0);
    // Throttled to one report per 24 frames, not one per frame.
    expect(levels.length).toBeLessThan(100 / 4);
    expect(levels.every((m) => m.kind === 'level' && m.speaking === false)).toBe(true);
  });

  it('reports a higher level, and speaking, once speech is under way', () => {
    const { processor, messages } = instantiate();

    feed(processor, 400, speech);
    const levels = messages.filter((m) => m.kind === 'level') as { rms: number; speaking: boolean }[];
    const last = levels[levels.length - 1];

    // A 0.5-amplitude sine sits around 0.35 RMS, well past the 0.08 default onset threshold.
    expect(last.rms).toBeGreaterThan(0.08);
    expect(last.speaking).toBe(true);
  });

  it('takes threshold overrides from the main thread', () => {
    // The store sends Flux's *effective* values, which are roughly half the defaults this file
    // carries. Without this path the port would run at the numbers Flux ships and never uses, which
    // is the bug that made ordinary speech go unheard.
    const { processor } = instantiate();
    (processor.port as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage({
      data: { speechOnsetThreshold: 0.9, onsetHoldFrames: 1 },
    });

    const collected: Float32Array[] = [];
    processor.port.postMessage = (data) => {
      if (data.kind === 'utterance') collected.push(data.audio);
    };

    // Loud enough for the default 0.08, nowhere near the 0.9 just set.
    const at = feed(processor, 400, speech);
    feed(processor, 250, silence, at);
    expect(collected).toHaveLength(0);
  });

  it('flushes what it has when the microphone disappears mid-sentence', () => {
    const { processor, emitted } = instantiate();
    feed(processor, 600, speech);
    expect(emitted).toHaveLength(0); // still speaking

    processor.process([]); // the source went away
    expect(emitted).toHaveLength(1);
  });
});
