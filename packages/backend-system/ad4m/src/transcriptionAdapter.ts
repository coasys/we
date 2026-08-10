/**
 * `TranscriptionPort` over AD4M's AI client.
 *
 * Thin by design: the executor already runs Whisper and already segments what it is fed, so this is
 * a translation between two vocabularies rather than an implementation of anything. What it does add
 * is the guarantees the port promises and the client does not — that feeding a closed stream is
 * harmless, and that opening an unusable model fails loudly rather than producing silence.
 */
import type { Ad4mClient } from '@coasys/ad4m';
import type {
  TranscriptionModel,
  TranscriptionPort,
  TranscriptionStream,
  TranscriptionTuning,
} from '@we/backend-shared';

/** The executor's own name for what the port calls a transcription model. */
const TRANSCRIPTION_MODEL_TYPE = 'TRANSCRIPTION';

interface Ad4mAiModel {
  id?: string;
  name?: string;
  modelType?: string;
}

export function createAd4mTranscriptionPort(backendClient: unknown): TranscriptionPort {
  const client = backendClient as Ad4mClient;

  /**
   * Whether a model can actually run right now.
   *
   * A separate call per model, because readiness is not on `Model` — the executor keeps it in
   * `modelLoadingStatus`, which is a different query. Cheap in practice: a deployment has one
   * transcription model, rarely two.
   *
   * Defaults to ready when the query fails. This flag exists so a caller can say "no model is
   * installed" instead of showing an empty transcript, and refusing to open a stream because a
   * *diagnostic* call failed would trade a working feature for a better error message.
   */
  async function isReady(modelId: string): Promise<boolean> {
    try {
      const status = await client.ai.modelLoadingStatus(modelId);
      if (!status) return true;
      // `downloaded`, not `loaded`. `loaded` is only ever set true by the executor's LLM spawn path;
      // `load_transcriber_model` finishes with `("Loaded", downloaded: true, loaded: false)`, so a
      // working Whisper model reports `loaded: false` forever. Reading it first marked every
      // transcription model unready.
      return Boolean(status.downloaded || status.loaded);
    } catch {
      // No row yet — the executor raises ModelNotFound rather than returning an empty status, and an
      // API-backed model has nothing to download so may never get one.
      return true;
    }
  }

  return {
    async models(): Promise<TranscriptionModel[]> {
      const all = (await client.ai.getModels()) as unknown as Ad4mAiModel[];
      const transcription = all.filter((m) => m.modelType === TRANSCRIPTION_MODEL_TYPE);

      // Asked for rather than guessed at. It throws when the user has never chosen one, which is
      // ordinary on a fresh install — the first model then stands in, so `isDefault` still names
      // something a caller can open.
      let defaultId = '';
      try {
        defaultId = String((await client.ai.getDefaultModel(TRANSCRIPTION_MODEL_TYPE))?.id ?? '');
      } catch {
        defaultId = String(transcription[0]?.id ?? '');
      }

      return Promise.all(
        transcription.map(async (m) => {
          const id = String(m.id ?? '');
          return {
            id,
            name: m.name ?? id,
            isDefault: id === defaultId,
            // A model still downloading accepts a stream and then never resolves any text, which is
            // indistinguishable from silence at the callback. Surfacing it lets a caller say so.
            ready: await isReady(id),
          };
        }),
      );
    },

    async open(
      modelId: string,
      onText: (text: string) => void,
      tuning?: TranscriptionTuning,
    ): Promise<TranscriptionStream> {
      if (!modelId) throw new Error('transcription: no model given');

      const streamId = await client.ai.openTranscriptionStream(modelId, onText, tuning);

      // Guards every call rather than trusting the caller to stop feeding first. Audio arrives from
      // an audio-thread worklet on its own schedule, so a buffer in flight when the user hangs up is
      // the ordinary case, not a mistake worth throwing over.
      let open = true;

      return {
        async feed(audio: Float32Array): Promise<void> {
          if (!open || audio.length === 0) return;
          await client.ai.feedTranscriptionStream(streamId, audio);
        },
        async close(): Promise<void> {
          if (!open) return;
          open = false;
          await client.ai.closeTranscriptionStream(streamId);
        },
      };
    },
  };
}
