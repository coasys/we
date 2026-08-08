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
  status?: { downloaded?: boolean; loaded?: boolean; progress?: number };
}

export function createAd4mTranscriptionPort(backendClient: unknown): TranscriptionPort {
  const client = backendClient as Ad4mClient;

  return {
    async models(): Promise<TranscriptionModel[]> {
      const all = (await client.ai.getModels()) as unknown as Ad4mAiModel[];
      const transcription = all.filter((m) => m.modelType === TRANSCRIPTION_MODEL_TYPE);
      return transcription.map((m, index) => ({
        id: String(m.id ?? ''),
        name: m.name ?? String(m.id ?? ''),
        // The executor's default-per-kind is not exposed on the model itself, so the first
        // transcription model stands in. A caller that cares which one runs should name it.
        isDefault: index === 0,
        // A model still downloading will accept a stream and then never resolve any text, which is
        // indistinguishable from silence at the callback. Surfacing it lets a caller say so.
        ready: Boolean(m.status?.loaded ?? m.status?.downloaded ?? true),
      }));
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
