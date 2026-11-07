/**
 * Speech-to-text, as a capability rather than a model to administer.
 *
 * `ModelAdminPort` already knows about transcription models — it lists them, adds them and picks a
 * default. What it cannot do is *use* one. That gap is why transcription could not
 * be ported without a module reaching for a backend's client directly and declaring itself
 * backend-specific, which is the coupling the module contract exists to avoid.
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
export interface TranscriptionRecord {
  id: string;
  name: string;
  /** True for the one the backend uses when asked for transcription without naming a model. */
  isDefault: boolean;
  /**
   * False while the model cannot run — still downloading, or its server is not answering or no
   * longer has it. Opening a stream on it will fail or stall.
   */
  ready: boolean;
  /**
   * How far a download has got, 0–100, while `ready` is false — when the backend reports it.
   *
   * Absent rather than 0 where nothing is known, so "not started" and "no idea" do not read alike.
   */
  progress?: number;
  /** Why it cannot run, in words, while `ready` is false. Empty when the backend cannot say. */
  detail?: string;
}

/**
 * How transcription could be set up from here, for a caller that would rather offer one button than
 * send somebody to a settings page.
 *
 * The backend looks, because only it can see the machine it runs on: a speech server already running
 * there is one press from working. Where there is none, the caller still has somewhere to point.
 */
export interface TranscriptionSetup {
  /**
   * A speech server found on the backend's machine, as a button names it — "Use the speech server at
   * localhost:8000". Empty when none was found that serves a transcription model.
   */
  found: string;
  /** Where to get a speech server, for when none was found. */
  installUrl: string;
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
  models(): Promise<TranscriptionRecord[]>;
  /**
   * Begin a session. `onText` fires once per utterance the backend resolves.
   *
   * Rejects if the model is unknown or unavailable, so a caller can tell "no model installed" from
   * "transcription produced nothing" — which look identical from the callback's point of view and
   * mean very different things to a user.
   */
  open(modelId: string, onText: (text: string) => void): Promise<TranscriptionStream>;
  /**
   * What setting transcription up from here would use, or null when this connection may not set it
   * up.
   *
   * Null — or the member absent — on a node somebody else runs: adding a model changes a machine
   * other people share, which is the operator's decision even where the grant would allow it.
   */
  setup?(): Promise<TranscriptionSetup | null>;
  /**
   * Connect the server {@link setup} found and make its transcription model the default. Resolves
   * once the model is registered; `models()` then says whether it can run.
   */
  connectFound?(): Promise<void>;
}
