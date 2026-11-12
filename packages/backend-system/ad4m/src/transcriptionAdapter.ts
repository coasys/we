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
const OFFERED_MODEL: TranscriptionModelOffer = {
  name: 'Whisper (on-device)',
  // The executor's stt plan picks the model for the device; ~1 GB is the right order for the
  // Whisper-class download it installs.
  downloadBytes: 967_000_000,
};

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
      const status = await client.ai.modelStatus(modelId);
      if (!status) return { ready: true };
      // `READY` is the one state that takes audio; `PULLING` is the download in flight with its
      // percentage; `ENDPOINT_DOWN`/`MISSING` cannot be fed and are read as not ready.
      const ready = status.state === 'READY';
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

      // `tuning` is no longer forwarded: the executor applies its own fixed voice-activity gate and
      // never read the parameters it was sent, so the client dropped the argument entirely.
      void tuning;
      const streamId = await client.ai.openTranscriptionStream(modelId, onText);

      // Guards every call rather than trusting the caller to stop feeding first. Audio arrives from
      // an audio-thread worklet on its own schedule, so a buffer in flight when the user hangs up is
      // the ordinary case, not a mistake worth throwing over.
      let open = true;

      return {
        async feed(audio: Float32Array): Promise<void> {
          if (!open || audio.length === 0) return;
          /*
            Rejects whenever the utterance did not land, and the reasons are not all about the
            stream: this is an HTTP POST of raw audio, so a node reached over the network refuses one
            for a dropped connection or a timeout as readily as for a stream it no longer has. None
            of those is a closed stream from the caller's side, so none is swallowed — the caller
            holds the utterance and re-establishes the stream.

            **How big an utterance may be is not this executor's answer to give.** It accepts 10 MB;
            the reverse proxy in front of a hosted node typically accepts 1 MB, and refuses the rest
            with a 413 that carries no CORS headers — so a browser reports a failed fetch and the
            status never reaches this code. There is nothing to branch on here, which is why the
            worklet's utterance cap is the thing that keeps a body under it.

            Note the executor is *supposed* to reap a stream nobody has fed for thirty seconds, and
            does not: its cleanup task is shut down moments after the node starts, so an abandoned
            stream lives until the process ends. Worth knowing in both directions — a long pause in a
            call is not what ends a stream today, and a node that has been up a while is carrying
            every stream every client ever abandoned.
          */
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
      Runs the executor's own local-AI install for the speech-to-text service.

      Per-model local installs are gone with the `local` block: `ai.localInstall` downloads the
      stt runtime and the model the executor's own plan picks for this device, starts it and
      registers it as a managed endpoint with its models — and resolves when all of that is done.
      The offer's name and size are therefore approximate: the plan chooses, which is what the
      `whisper_small` preset used to approximate anyway.
    */
    async installOfferedModel(): Promise<void> {
      // A second press, or two panels, must not install twice.
      if ((await transcriptionModels()).length > 0) return;

      await client.ai.localInstall({ services: ['stt'] });

      if ((await transcriptionModels()).length === 0) {
        throw new Error('transcription: the install finished but no speech-to-text model was registered');
      }
    },
  };
}
