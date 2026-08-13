/**
 * Speech-to-text, as a capability rather than a model to administer.
 *
 * `RuntimeAdminPort` already knows about transcription models — it lists them, adds them, downloads
 * them and picks a default. What it cannot do is *use* one. That gap is why transcription could not
 * be ported without a module reaching for `@coasys/ad4m` directly and declaring `backends: ['ad4m']`,
 * which is the coupling the module contract exists to avoid.
 *
 * ## Why a stream rather than a function
 *
 * The obvious shape — `transcribe(audio): Promise<string>` — is wrong for speech. A caller does not
 * have "the audio"; it has a microphone producing samples indefinitely, and it wants text as soon as
 * a sentence is finished rather than when the speaker stops for the day. So the port is a session:
 * open one, feed it utterances as they occur, and receive text through a callback.
 *
 * Segmenting continuous audio into utterances is the caller's job, not this port's. It needs an
 * `AudioWorklet` running on the audio thread, which is a browser concern and has no place behind a
 * backend port — and the caller is the only one who knows what it is listening to.
 */

/** A transcription model the backend can run. */
export interface TranscriptionModel {
  id: string;
  name: string;
  /** True for the one the backend uses when asked for transcription without naming a model. */
  isDefault: boolean;
  /** False while weights are still downloading — opening a stream on it will fail or stall. */
  ready: boolean;
}

/**
 * How eagerly a stream decides that speech has started and stopped.
 *
 * Backend-tunable because the same audio serves two different purposes: a low-latency preview wants
 * to emit a word the moment it is heard, while the transcript of record would rather wait and be
 * right. Every field is optional and the backend's defaults are reasonable; a caller that does not
 * care should pass nothing.
 */
export interface TranscriptionTuning {
  /** Loudness at which speech is considered to have begun. Lower catches quieter speakers. */
  startThreshold?: number;
  /** How long that must hold before it counts, in milliseconds. Lower reacts faster. */
  startWindow?: number;
  /** Loudness below which speech is considered over. */
  endThreshold?: number;
  /** How long silence must hold before an utterance is closed, in milliseconds. */
  endWindow?: number;
  /** Audio to keep from before speech was detected, so a sentence does not lose its first word. */
  timeBeforeSpeech?: number;
}

/** An open transcription session. Closing it releases the backend's side. */
export interface TranscriptionStream {
  /**
   * Hand over one utterance of 16 kHz mono PCM.
   *
   * Never throws for an empty buffer or a closed stream — audio arrives on a timer the caller does
   * not fully control, and a feed racing a teardown is ordinary rather than exceptional.
   */
  feed(audio: Float32Array): Promise<void>;
  close(): Promise<void>;
}

export interface TranscriptionPort {
  /**
   * Whether this backend can transcribe at all — as opposed to being able to, with no model
   * installed. Two different sentences to a user: one is "this node cannot do that", the other is
   * "install a model".
   *
   * Optional so an existing adapter keeps working; absent reads as "yes, ask me". It exists because
   * a *host* may forward to a port that is not there — see `createModuleStoreDeps`, which always
   * supplies a wrapper so a module built before the backend binds still reaches it later. That
   * wrapper made the port itself non-optional from the module's side, which turned every
   * "this backend cannot transcribe" branch into dead code.
   */
  available?(): boolean;
  /** Transcription models this backend can run. Empty when none is installed. */
  models(): Promise<TranscriptionModel[]>;
  /**
   * Begin a session. `onText` fires once per utterance the backend resolves.
   *
   * Rejects if the model is unknown or unavailable, so a caller can tell "no model installed" from
   * "transcription produced nothing" — which look identical from the callback's point of view and
   * mean very different things to a user.
   */
  open(modelId: string, onText: (text: string) => void, tuning?: TranscriptionTuning): Promise<TranscriptionStream>;
}
