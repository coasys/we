/**
 * Voice-activity detection on the audio thread, as source text.
 *
 * ## Why a worklet
 *
 * The backend transcribes an utterance, not a microphone. Something has to decide where one ends,
 * and that decision happens on every 128-sample frame — which rules out the main thread, where a
 * slow render would drop audio. An `AudioWorkletProcessor` runs on the audio thread and cannot be
 * blocked by anything the UI does. It also resamples: browsers capture at the device rate, usually
 * 48 kHz, and Whisper wants 16 kHz, so converting here means a third of the bytes cross the thread
 * boundary and none of the arithmetic happens where it could stutter.
 *
 * ## Why a string
 *
 * A worklet is instantiated in a separate global scope with no module resolution and no bundler,
 * reached only by URL. It cannot import anything and nothing can import it. The two ways to give it
 * a URL are to ship a file every host app serves from its public directory, or to build one at
 * runtime from source the module already carries. The second keeps the module self-contained, which
 * matters more than type-checking a hundred lines of arithmetic with no dependencies to get wrong.
 *
 * ## What it emits
 *
 * Two kinds of tagged message on the port:
 *
 * - `{ kind: 'utterance', audio }` — one span of speech, 16 kHz mono PCM. Silence emits none, which
 *   is what makes muting the call stop the transcript: a muted track is disabled rather than removed,
 *   so it produces zeros, the RMS never crosses the onset threshold, and this never fires.
 * - `{ kind: 'level', rms, speaking }` — the loudness this processor is deciding on, throttled.
 *
 * The level exists so a meter can show *the number the decision is actually made on*. Flux runs a
 * second `AnalyserNode` and a `requestAnimationFrame` loop to draw its bar, which measures the same
 * signal a second time and can disagree with the VAD about it. This cannot.
 *
 * ## Thresholds
 *
 * Ported from Flux's `audio-processor.js` — including its defaults, which Flux itself overrides at
 * startup. Kept as they are so this file stays a faithful copy of what it came from; the values that
 * actually run are sent from the store, which is where the deviation is stated. See `VAD` there.
 */
export const WORKLET_NAME = 'we-transcription-vad';

export const WORKLET_SOURCE = String.raw`
const DEFAULTS = {
  // RMS above which audio is a speech candidate. Well above a typical noise floor.
  speechOnsetThreshold: 0.08,
  // RMS below which audio is a silence candidate.
  silenceThreshold: 0.05,
  // Frames speech must hold before it counts — rejects coughs and transients under ~30ms.
  onsetHoldFrames: 12,
  // Frames of silence that close an utterance. ~500ms at 128 samples / 48 kHz.
  silenceTimeoutFrames: 188,
  // 30s at 16 kHz. A speaker who never pauses still gets transcribed in pieces.
  maxUtteranceSamples: 480000,
  // 500ms at 16 kHz. Below this it is a cough, a sigh or a breath, not speech.
  minUtteranceSamples: 8000,
  // 500ms kept from before onset, so a sentence does not lose its first word.
  preRollSamples: 8000,
  // Mean RMS an utterance must reach to be sent at all. Not redundant with the onset threshold:
  // onset looks at one frame, this looks at the whole utterance. A near-silent segment that briefly
  // spiked makes Whisper hallucinate — most often the single word "you" — and a transcript that
  // invents speech is worse than one that misses some.
  minUtteranceRms: 0.04,
};

const TARGET_SAMPLE_RATE = 16000;

// How many frames between level reports. Overridable, like the thresholds.
const DEFAULT_LEVEL_EVERY_FRAMES = 24;

class TranscriptionVad extends AudioWorkletProcessor {
  constructor() {
    super();
    this.config = Object.assign({}, DEFAULTS);
    this.inputSampleRate = sampleRate;
    this.utterance = [];
    this.preRoll = [];
    this.state = 'silent';
    this.onsetFrames = 0;
    this.silenceFrames = 0;
    this.levelFrames = 0;
    this.levelEveryFrames = DEFAULT_LEVEL_EVERY_FRAMES;
    this.port.onmessage = (event) => {
      const cfg = event.data || {};
      if (cfg.levelEveryFrames) this.levelEveryFrames = cfg.levelEveryFrames;
      Object.assign(this.config, cfg);
    };
  }

  // Box-average downsample. Cheap, and adequate for speech at this ratio.
  downsample(buffer) {
    const ratio = this.inputSampleRate / TARGET_SAMPLE_RATE;
    const result = new Float32Array(Math.round(buffer.length / ratio));
    let read = 0;
    for (let write = 0; write < result.length; write++) {
      const next = Math.round((write + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let i = read; i < next && i < buffer.length; i++) {
        sum += buffer[i];
        count++;
      }
      result[write] = count ? sum / count : 0;
      read = next;
    }
    return result;
  }

  static rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  emit() {
    const enough = this.utterance.length >= this.config.minUtteranceSamples;
    if (enough && TranscriptionVad.rms(this.utterance) >= this.config.minUtteranceRms) {
      this.port.postMessage({ kind: 'utterance', audio: new Float32Array(this.utterance) });
    }
    this.utterance = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      // The microphone went away mid-sentence — flush what there is rather than lose it.
      if (this.utterance.length > 0) this.emit();
      this.state = 'silent';
      this.onsetFrames = 0;
      this.silenceFrames = 0;
      this.preRoll = [];
      return true;
    }

    const frame = input[0];
    const downsampled = this.downsample(frame);
    // Measured on the original-rate frame: downsampling averages away exactly the transients that
    // distinguish speech onset from room noise.
    const level = TranscriptionVad.rms(frame);

    // Throttled, and reported whether or not anything is being captured — a meter that only moved
    // once speech was already detected could not help anyone work out why it was not being detected.
    if (++this.levelFrames >= this.levelEveryFrames) {
      this.levelFrames = 0;
      this.port.postMessage({ kind: 'level', rms: level, speaking: this.state === 'speaking' });
    }

    for (let i = 0; i < downsampled.length; i++) this.preRoll.push(downsampled[i]);
    if (this.preRoll.length > this.config.preRollSamples) {
      this.preRoll = this.preRoll.slice(this.preRoll.length - this.config.preRollSamples);
    }

    if (this.state === 'silent') {
      if (level > this.config.speechOnsetThreshold) {
        this.onsetFrames++;
        if (this.onsetFrames >= this.config.onsetHoldFrames) {
          this.state = 'speaking';
          this.onsetFrames = 0;
          this.silenceFrames = 0;
          // The pre-roll is the beginning of the sentence: onset is only detected once someone is
          // already talking, so without it every utterance starts a word late.
          this.utterance = this.preRoll.concat(this.utterance);
          this.preRoll = [];
        }
      } else {
        this.onsetFrames = 0;
      }
      return true;
    }

    for (let i = 0; i < downsampled.length; i++) this.utterance.push(downsampled[i]);

    if (level < this.config.silenceThreshold) {
      this.silenceFrames++;
      if (this.silenceFrames >= this.config.silenceTimeoutFrames) {
        this.emit();
        this.state = 'silent';
        this.silenceFrames = 0;
      }
    } else {
      this.silenceFrames = 0;
    }

    // Stays in 'speaking' — the speaker has not paused, so the next chunk continues the same thought.
    if (this.utterance.length >= this.config.maxUtteranceSamples) this.emit();

    return true;
  }
}

registerProcessor('${WORKLET_NAME}', TranscriptionVad);
`;
