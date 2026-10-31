/**
 * `TranscriptionPort` over AD4M's AI client.
 *
 * Thin by design: the executor forwards what it is fed to the speech server a transcription model
 * runs on and publishes the text, so this is a translation between two vocabularies rather than an
 * implementation of anything. What it does add is the guarantees the port promises and the client
 * does not — that feeding a closed stream is harmless, and that opening an unusable model fails
 * loudly rather than producing silence.
 */
import { type Ad4mClient, AI_RECOMMENDED_MODELS, AI_SERVER_INSTALL_LINKS, type AIModel } from '@coasys/ad4m';
import type {
  TranscriptionPort,
  TranscriptionRecord,
  TranscriptionSetup,
  TranscriptionStream,
} from '@we/backend-shared';

import { CAP_DOMAIN, CAP_VERB, createCapabilityCheck } from './capabilities';
import type { Ad4mRuntimeOptions } from './runtimeAdminAdapter';

/** The executor's own name for what the port calls a transcription model. */
const TRANSCRIPTION_MODEL_TYPE = 'TRANSCRIPTION';

/** The model a speech server is asked for first: the one AD4M recommends, when the server has it. */
const RECOMMENDED_MODEL = AI_RECOMMENDED_MODELS.find((m) => m.modelType === TRANSCRIPTION_MODEL_TYPE)?.openAiAudio;

/** A model's readiness, in the port's words, from the status its endpoint last reported. */
function readiness(model: AIModel): Pick<TranscriptionRecord, 'ready' | 'progress' | 'detail'> {
  const status = model.status;
  switch (status?.state) {
    case 'READY':
      return { ready: true };
    case 'PULLING':
      return {
        ready: false,
        progress: Math.max(0, Math.min(100, Math.round(status.progress ?? 0))),
        detail: 'The speech model is downloading',
      };
    case 'MISSING':
      return { ready: false, detail: `The speech server does not have ${model.remoteModel}` };
    case 'ENDPOINT_DOWN':
      return { ready: false, detail: 'The speech server is not answering' };
    default:
      return { ready: false, detail: 'Waiting for the speech server to be checked' };
  }
}

/** `localhost:8000` from `http://127.0.0.1:8000`, for a sentence. */
function hostOf(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    return `${loopback ? 'localhost' : url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return baseUrl;
  }
}

export function createAd4mTranscriptionPort(
  backendClient: unknown,
  options: Ad4mRuntimeOptions = {},
): TranscriptionPort {
  const client = backendClient as Ad4mClient;
  const granted = createCapabilityCheck(options.capabilities ?? null);
  // The same two halves `createAd4mModelAdmin` requires before offering "Add a model": the grant,
  // and the node being ours. A guest's grant includes AI CREATE; a guest wiring a server into a node
  // other people share is still not a button to offer.
  const canSetUp = (options.administersNode ?? true) && granted(CAP_DOMAIN.ai, CAP_VERB.create);

  async function transcriptionModels(): Promise<AIModel[]> {
    return (await client.ai.getModels()).filter((m) => m.modelType === TRANSCRIPTION_MODEL_TYPE);
  }

  /** A server on the executor's machine that says it transcribes — a speech server before anything else. */
  async function findSpeechServer() {
    const found = (await client.ai.detectEndpoints()).filter((e) => e.capabilities.includes('transcription'));
    return found.find((e) => e.kind === 'OPEN_AI_AUDIO') ?? found[0] ?? null;
  }

  const port: TranscriptionPort = {
    async models(): Promise<TranscriptionRecord[]> {
      const transcription = await transcriptionModels();

      // No default is ordinary on a fresh node — the first model then stands in, so `isDefault`
      // still names something a caller can open.
      let defaultId = '';
      try {
        defaultId = (await client.ai.getDefaultModel(TRANSCRIPTION_MODEL_TYPE))?.id ?? '';
      } catch {
        // An older refusal for "none set" — the same answer.
      }
      if (!defaultId) defaultId = transcription[0]?.id ?? '';

      return transcription.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        isDefault: m.id === defaultId,
        // A model its server cannot run accepts a stream and then never resolves any text, which is
        // indistinguishable from silence at the callback. Surfacing it lets a caller say so.
        ...readiness(m),
      }));
    },

    async open(modelId: string, onText: (text: string) => void): Promise<TranscriptionStream> {
      if (!modelId) throw new Error('transcription: no model given');

      const streamId = await client.ai.openTranscriptionStream(modelId, onText);

      // Guards every call rather than trusting the caller to stop feeding first. Audio arrives from
      // an audio-thread worklet on its own schedule, so a buffer in flight when the user hangs up is
      // the ordinary case, not a mistake worth throwing over.
      let open = true;

      return {
        async feed(audio: Float32Array): Promise<void> {
          if (!open || audio.length === 0) return;
          /*
            Resolves once the speech server has answered for this utterance and its text is
            published, and rejects whenever the utterance did not land. The reasons are not all about
            the stream: this is an HTTP POST of raw audio, so a node reached over the network refuses
            one for a dropped connection or a timeout as readily as for a stream it no longer has, and
            the speech server can fail it too. None of those is a closed stream from the caller's
            side, so none is swallowed — the caller holds the utterance and re-establishes the stream.

            **How big an utterance may be is not this executor's answer to give.** It accepts 10 MB;
            the reverse proxy in front of a hosted node typically accepts 1 MB, and refuses the rest
            with a 413 that carries no CORS headers — so a browser reports a failed fetch and the
            status never reaches this code. There is nothing to branch on here, which is why the
            worklet's utterance cap is the thing that keeps a body under it.

            The executor reaps a stream nobody has fed for a while, so a long pause in a call can end
            one; the caller's re-establishing covers that the same way.
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

  if (!canSetUp) return port;

  return {
    ...port,

    /** Looks on the executor's machine for a speech server. A failed look is "nothing found". */
    async setup(): Promise<TranscriptionSetup> {
      const server = await findSpeechServer().catch(() => null);
      return {
        found: server ? `Use the speech server at ${hostOf(server.baseUrl)}` : '',
        installUrl: AI_SERVER_INSTALL_LINKS.speaches,
      };
    },

    /*
      Registers the server as an endpoint — or reuses the one already registered at that address —
      then the model on it, and makes it the default when there is none. `ai.addModel` answers once
      the row is written, so there is nothing to wait out here; whether it can run is `models()`'s to
      report.
    */
    async connectFound(): Promise<void> {
      // A second press, or two panels, must not register the model twice: the executor keeps both.
      if ((await transcriptionModels()).length > 0) return;

      const server = await findSpeechServer();
      if (!server) throw new Error('No speech server is running on the node’s machine');

      const offered = (await client.ai.discoverModels({ kind: server.kind, baseUrl: server.baseUrl })).filter((m) =>
        m.capabilities.includes('transcription'),
      );
      const remoteModel = (offered.find((m) => m.id === RECOMMENDED_MODEL) ?? offered[0])?.id;
      if (!remoteModel) throw new Error(`The speech server at ${hostOf(server.baseUrl)} has no transcription model`);

      const endpoint =
        (await client.ai.endpoints()).find(
          (e) => e.baseUrl.replace(/\/+$/, '') === server.baseUrl.replace(/\/+$/, ''),
        ) ??
        (await client.ai.addEndpoint({
          name: `Speech server (${hostOf(server.baseUrl)})`,
          kind: server.kind,
          baseUrl: server.baseUrl,
        }));

      const id = await client.ai.addModel({
        name: remoteModel,
        modelType: TRANSCRIPTION_MODEL_TYPE,
        endpointId: endpoint.id,
        remoteModel,
      });
      if (!(await client.ai.getDefaultModel(TRANSCRIPTION_MODEL_TYPE).catch(() => null))) {
        await client.ai.setDefaultModel(TRANSCRIPTION_MODEL_TYPE, id);
      }
    },
  };
}
