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
  TranscriptionModelOffer,
  TranscriptionPort,
  TranscriptionRecord,
  TranscriptionStream,
  TranscriptionTuning,
} from '@we/backend-shared';

import { CAP_DOMAIN, CAP_VERB, createCapabilityCheck } from './capabilities';
import type { Ad4mRuntimeOptions } from './runtimeAdminAdapter';

/** The executor's own name for what the port calls a transcription model. */
const TRANSCRIPTION_MODEL_TYPE = 'TRANSCRIPTION';

/**
 * The model the transcribe panel offers to install.
 *
 * `whisper_small` because the executor runs Whisper on the CPU unless it was built with a GPU feature
 * explicitly, and on a CPU the larger models fall behind speech — the executor queues audio without
 * limit, so a model slower than real time delays every line further than the last. `small` keeps up
 * and is a clear step above `tiny`. Changing the choice is this constant and its size.
 */
const OFFERED_PRESET = 'whisper_small';
const OFFERED_MODEL: TranscriptionModelOffer = {
  name: 'Whisper small',
  // `openai/whisper-small`'s weights; the tokenizer and config beside them are a rounding error.
  downloadBytes: 967_000_000,
};

/** How long {@link installOfferedModel} waits to see the model's row appear before calling it failed. */
const REGISTER_TIMEOUT_MS = 20_000;
const REGISTER_POLL_MS = 250;

interface Ad4mAiModel {
  id?: string;
  name?: string;
  modelType?: string;
}

/** What a model's loading status says about whether it can run, and how far it has got if not. */
interface Readiness {
  ready: boolean;
  progress?: number;
}

export function createAd4mTranscriptionPort(
  backendClient: unknown,
  options: Ad4mRuntimeOptions = {},
): TranscriptionPort {
  const client = backendClient as Ad4mClient;
  const granted = createCapabilityCheck(options.capabilities ?? null);
  // The same two halves `createAd4mRuntimeAdmin` requires before offering "Add a model": the grant,
  // and the node being ours. A guest's grant includes AI CREATE; a guest adding a gigabyte to a node
  // other people share is still not a button to offer.
  const canInstall = (options.administersNode ?? true) && granted(CAP_DOMAIN.ai, CAP_VERB.create);

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
  async function readiness(modelId: string): Promise<Readiness> {
    try {
      const status = await client.ai.modelLoadingStatus(modelId);
      if (!status) return { ready: true };
      // `downloaded`, not `loaded`. `loaded` is only ever set true by the executor's LLM spawn path;
      // `load_transcriber_model` finishes with `("Loaded", downloaded: true, loaded: false)`, so a
      // working Whisper model reports `loaded: false` forever. Reading it first marked every
      // transcription model unready.
      const ready = Boolean(status.downloaded || status.loaded);
      // Per file rather than overall: the executor reports the tokenizer, the weights and the config
      // each from 0 to 100. The weights are nearly all of it, so the number is honest where it
      // matters and briefly optimistic at either end.
      return ready ? { ready } : { ready, progress: Math.max(0, Math.min(100, Math.round(status.progress ?? 0))) };
    } catch {
      // No row yet — the executor raises EntityNotFound rather than returning an empty status, and an
      // API-backed model has nothing to download so may never get one.
      return { ready: true };
    }
  }

  async function transcriptionModels(): Promise<Ad4mAiModel[]> {
    const all = (await client.ai.getModels()) as unknown as Ad4mAiModel[];
    return all.filter((m) => m.modelType === TRANSCRIPTION_MODEL_TYPE);
  }

  const port: TranscriptionPort = {
    async models(): Promise<TranscriptionRecord[]> {
      const transcription = await transcriptionModels();

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
            ...(await readiness(id)),
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

      // `tuning` is forwarded and, today, ignored: the executor applies its own fixed voice-activity
      // gate and never reads the parameters it is sent. Passed anyway so a caller's intent reaches
      // an executor that starts honouring it without this adapter having to change.
      const streamId = await client.ai.openTranscriptionStream(modelId, onText, tuning);

      // Guards every call rather than trusting the caller to stop feeding first. Audio arrives from
      // an audio-thread worklet on its own schedule, so a buffer in flight when the user hangs up is
      // the ordinary case, not a mistake worth throwing over.
      let open = true;

      return {
        async feed(audio: Float32Array): Promise<void> {
          if (!open || audio.length === 0) return;
          // Rejects when the executor has let the stream go — it reaps one that has not been fed for
          // thirty seconds, which a caller feeding only utterances hits in any long pause. That is
          // not a closed stream from the caller's side, so it is not swallowed: the caller reopens.
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

  if (!canInstall) return port;

  return {
    ...port,

    offeredModel: () => OFFERED_MODEL,

    /*
      Registers the model, then returns as soon as its row exists.

      `ai.addModel` does not answer until the executor has downloaded the weights — and then loaded
      them, and thrown them away — so on any real download the client's thirty-second RPC timeout
      fires long before it would. The row is written first and the download carries on regardless,
      which makes that timeout a lie about the outcome rather than a failure. So the call is left
      running, and the row is what decides: here means installed, and the download is then
      `models()`'s to report.

      A rejection that arrives before the row does is a real refusal (no permission, an executor that
      rejects the input) and is thrown.
    */
    async installOfferedModel(): Promise<void> {
      // A second press, or two panels, must not register the model twice: the executor keeps both.
      if ((await transcriptionModels()).length > 0) return;

      let refused: unknown = null;
      client.ai
        .addModel({
          name: OFFERED_MODEL.name,
          local: { fileName: OFFERED_PRESET },
          modelType: TRANSCRIPTION_MODEL_TYPE,
        } as Parameters<Ad4mClient['ai']['addModel']>[0])
        .catch((cause: unknown) => {
          refused = cause;
        });

      const deadline = Date.now() + REGISTER_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, REGISTER_POLL_MS));
        if ((await transcriptionModels()).length > 0) return;
        if (refused) throw refused;
      }
      throw new Error('transcription: the model was not registered');
    },
  };
}
