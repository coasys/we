import type { ModuleStoreDeps } from '@we/module-shared';

import { WORKLET_NAME, WORKLET_SOURCE } from './workletSource';

/**
 * How eagerly the backend closes an utterance.
 *
 * Deliberately less twitchy than the preview settings Flux runs alongside its main stream: this is
 * the transcript of record, so it would rather wait and be right. A second, faster stream for live
 * word-by-word feedback is a later addition and does not change anything here.
 */
const TUNING = { startThreshold: 0.8 };

/**
 * Characters of transcript held before writing a block.
 *
 * Flux's number, kept. One block per utterance would be truer to the source but writes a record
 * every few seconds for every participant, into a perspective that syncs to all of them; one block
 * per call would be a single unreadable wall by the end. This is the compromise, and it is the level
 * a later knowledge map would want to re-segment from anyway.
 */
const MAX_CHARS = 1000;

/** Silence after which whatever has accumulated is written, so a short remark is not held forever. */
const FLUSH_AFTER_MS = 3_000;

/** The tag distinguishing transcript text from the text blocks that make up a post. */
export const TRANSCRIPT_TAG = 'transcript';

export type TranscribeStatus =
  | 'idle'
  | 'no-backend'
  | 'no-model'
  | 'no-audio'
  | 'starting'
  | 'listening'
  | 'error';

/**
 * Speech to text for the call this agent is in.
 *
 * ## What it listens to
 *
 * The call's own microphone, borrowed through `deps.audioInput` rather than opened here. That is
 * what makes muting the call stop the transcript: a muted track is disabled rather than removed, so
 * the worklet receives silence, the VAD never fires, and nothing is produced. A second
 * `getUserMedia` would have kept listening through the mute.
 *
 * ## What it writes
 *
 * `TextBlock`s tagged {@link TRANSCRIPT_TAG}, into the space the call is in. Not posts: a transcript
 * is not authored content and should not arrive in a feed as though it were. The tag is what lets a
 * later reader tell transcript text from the blocks that make up a post, since both are `TextBlock`
 * in the same perspective.
 *
 * Author and timestamp come free from the model, so a block already knows who said it and when
 * without this module recording either.
 */
export function createTranscribeStore(deps: ModuleStoreDeps) {
  const { signal, effect, audioInput, transcription, createEntity, dataset } = deps;

  const [status, setStatus] = signal<TranscribeStatus>('idle');
  const [enabled, setEnabled] = signal(false);
  const [error, setError] = signal<string>('');
  /** What has been heard but not yet written — shown live, so the user can see it working. */
  const [pending, setPending] = signal<string>('');
  /** The most recent blocks written this session, newest first. Display only. */
  const [recent, setRecent] = signal<string[]>([]);

  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stream: Awaited<ReturnType<NonNullable<typeof transcription>['open']>> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let buffer = '';

  function clearTimer() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  }

  /** Write what has accumulated, if anything. Safe to call at any point, including teardown. */
  async function flush(): Promise<void> {
    clearTimer();
    const text = buffer.trim();
    buffer = '';
    setPending('');
    if (!text) return;

    setRecent([text, ...recent()].slice(0, 20));
    try {
      await createEntity?.('TextBlock', { text, tag: TRANSCRIPT_TAG });
    } catch (cause) {
      // Reported but not surfaced as a failed state: the transcript continues, and losing one block
      // is better than stopping a call's transcription over a single write.
      console.error('transcribe: could not write block', cause);
    }
  }

  function onText(text: string): void {
    if (!text.trim()) return;
    buffer = buffer ? `${buffer} ${text.trim()}` : text.trim();
    setPending(buffer);
    if (buffer.length >= MAX_CHARS) {
      void flush();
      return;
    }
    clearTimer();
    flushTimer = setTimeout(() => void flush(), FLUSH_AFTER_MS);
  }

  async function start(audio: MediaStream): Promise<void> {
    if (!transcription) {
      setStatus('no-backend');
      return;
    }
    setStatus('starting');
    setError('');

    try {
      const models = await transcription.models();
      const model = models.find((m) => m.isDefault && m.ready) ?? models.find((m) => m.ready);
      if (!model) {
        // Distinguished from a silent failure on purpose: no model and nobody talking look identical
        // from here, and only one of them is something the user can act on.
        setStatus('no-model');
        return;
      }

      stream = await transcription.open(model.id, onText, TUNING);

      context = new AudioContext();
      // Built here rather than fetched: see `workletSource`. Revoked as soon as it is registered —
      // `addModule` has finished with it, and an un-revoked object URL keeps its blob alive for the
      // lifetime of the document.
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      node = new AudioWorkletNode(context, WORKLET_NAME);
      source = context.createMediaStreamSource(audio);
      source.connect(node);
      // Not connected to the destination: this is a listener, and routing the microphone to the
      // speakers would echo the speaker back to themselves.
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        void stream?.feed(event.data);
      };

      setStatus('listening');
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : String(cause));
      await stop();
    }
  }

  async function stop(): Promise<void> {
    // Flush first: whatever was said before hanging up is still worth keeping.
    await flush();

    node?.port.close();
    node?.disconnect();
    source?.disconnect();
    await context?.close().catch(() => {});
    await stream?.close().catch(() => {});
    node = null;
    source = null;
    context = null;
    stream = null;

    if (status() !== 'error') setStatus('idle');
  }

  /**
   * Follow the audio.
   *
   * Keyed on the stream's presence rather than on the call's state, because this module has no view
   * of calls — it listens to whatever the host is capturing, and stops when that goes away. Which
   * also means it does the right thing if audio ever comes from somewhere other than a call.
   */
  effect?.(() => {
    const audio = audioInput?.() ?? null;
    const on = enabled();

    if (!on || !audio) {
      if (context) void stop();
      else if (on && !audio) setStatus('no-audio');
      else if (!on) setStatus('idle');
      return;
    }

    if (!context) void start(audio);
  });

  // Leaving the space ends the session — the blocks belong to the space that was being spoken in,
  // and continuing to write into a perspective the user has navigated away from would be wrong.
  effect?.(() => {
    if (!dataset?.()) {
      setEnabled(false);
      if (context) void stop();
    }
  });

  return {
    // ── State ────────────────────────────────────────────────────────────────
    status,
    error,
    pending,
    recent,
    enabled,
    /** True only while actually producing — what the launcher highlights on. */
    listening: () => status() === 'listening',
    /** There is audio to listen to. Without it, offering the control is offering nothing. */
    available: () => (audioInput?.() ?? null) !== null,

    // ── Actions ──────────────────────────────────────────────────────────────
    toggle: () => setEnabled(!enabled()),
    /** Write what has been heard so far without waiting for the buffer to fill. */
    flushNow: () => void flush(),
  };
}
